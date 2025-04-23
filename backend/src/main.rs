use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use chrono::{DateTime, Utc};
use fjall::{Config, PartitionCreateOptions, TransactionalKeyspace};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::Path, sync::Arc, time::Duration as StdDuration}; // Renamed to avoid conflict
use tokio::time::{sleep, Duration, Instant}; // Added tokio time imports
use tracing::error;

// --- Data Structures ---

#[derive(Deserialize, Debug)]
struct PutMessageRequest {
    message_id: String, // Base64 encoded
    message: String,    // Base64 encoded
}

#[derive(Deserialize, Debug)]
struct GetMessagesRequest {
    message_ids: Vec<String>, // List of base64 encoded message IDs
    timeout_ms: Option<u64>,  // Optional timeout for long polling
}

#[derive(Serialize, Deserialize, Debug)]
struct MessageRecord {
    message: String,
    timestamp: DateTime<Utc>,
}

// Modified FoundMessage to include the timestamp
#[derive(Serialize, Debug)]
struct FoundMessage {
    message_id: String,       // Base64 encoded
    message: String,          // Base64 encoded
    timestamp: DateTime<Utc>, // Added timestamp
}

#[derive(Serialize, Debug)]
struct GetMessagesResponse {
    results: Vec<FoundMessage>,
}

// --- Shared State Type ---
// Define the type for the shared application state (the transactional keyspace)
type SharedState = Arc<TransactionalKeyspace>;

// --- Error Handling ---
#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("Fjall DB error: {0}")]
    Fjall(#[from] fjall::Error),
    #[error("JSON serialization/deserialization error: {0}")]
    SerdeJson(#[from] serde_json::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!("Error processing request: {:?}", self);
        let (status, message) = match self {
            AppError::Fjall(_) | AppError::SerdeJson(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
        };
        (status, message).into_response()
    }
}

// --- Axum Handlers ---

// put_message_handler remains the same as before
async fn put_message_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<PutMessageRequest>,
) -> Result<StatusCode, AppError> {
    let timestamp = Utc::now();
    let record = MessageRecord {
        message: payload.message,
        timestamp,
    };
    let value_bytes = serde_json::to_vec(&record)?;
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;

    // Create the key by concatenating message_id bytes and timestamp bytes (big-endian)
    let mut key_bytes = Vec::new();
    key_bytes.extend_from_slice(payload.message_id.as_bytes());
    key_bytes.extend_from_slice(&timestamp.timestamp_millis().to_be_bytes());

    messages_partition.insert(key_bytes, value_bytes)?;
    // Optionally persist explicitly
    // keyspace.persist(PersistMode::BufferAsync)?;
    Ok(StatusCode::CREATED)
}

// Modified get_messages_handler for transactional read-then-delete
async fn get_messages_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<GetMessagesRequest>,
) -> Result<Json<GetMessagesResponse>, AppError> {
    let requested_timeout_ms = payload.timeout_ms.unwrap_or(30000); // Default 30s
    let deadline = Instant::now() + Duration::from_millis(requested_timeout_ms);
    let check_interval = Duration::from_millis(500); // Check DB every 500ms

    loop {
        // --- Transactional Read-then-Delete Logic ---
        let messages_partition =
            keyspace.open_partition("messages", PartitionCreateOptions::default())?;
        let mut write_tx = keyspace.write_tx();
        let mut results = Vec::new();
        let mut keys_to_remove: Vec<Vec<u8>> = Vec::new();
        let mut found_messages_in_tx = false;

        for message_id_str in &payload.message_ids {
            let key_prefix = message_id_str.as_bytes();
            let mut found_item: Option<(Vec<u8>, Vec<u8>)> = None;

            // Scope for the iterator borrow
            {
                let mut iter = write_tx.prefix(&messages_partition, key_prefix);
                if let Some(result) = iter.next() {
                    match result {
                        Ok((key_slice, value_slice)) => {
                            found_item = Some((key_slice.to_vec(), value_slice.to_vec()));
                        }
                        Err(e) => {
                            error!("Database error during prefix scan for {}: {}", message_id_str, e);
                            // Abort transaction immediately on DB error
                            return Err(AppError::Fjall(e));
                        }
                    }
                    // Only process the first item found for this prefix in this check
                }
            } // Iterator goes out of scope

            if let Some((full_key, value_bytes)) = found_item {
                match serde_json::from_slice::<MessageRecord>(&value_bytes) {
                    Ok(record) => {
                        results.push(FoundMessage {
                            message_id: message_id_str.clone(),
                            message: record.message,
                            timestamp: record.timestamp,
                        });
                        keys_to_remove.push(full_key);
                        found_messages_in_tx = true;
                    }
                    Err(e) => {
                        error!("Failed to deserialize record for key prefix {}: {}", message_id_str, e);
                        // Abort transaction on deserialization error
                        return Err(AppError::SerdeJson(e));
                    }
                }
            }
        }

        // --- Decision Point ---
        if found_messages_in_tx {
            // Messages found, perform removals and commit
            for key in keys_to_remove {
                write_tx.remove(&messages_partition, key);
            }
            write_tx.commit()?;
            tracing::debug!("Found {} messages, returning.", results.len());
            return Ok(Json(GetMessagesResponse { results }));
        } else {
            // No messages found in this check. Commit the (read-only) transaction.
            write_tx.commit()?;

            // Check if timeout exceeded
            let now = Instant::now();
            if now >= deadline {
                tracing::debug!("Long poll timeout reached.");
                return Ok(Json(GetMessagesResponse { results: vec![] })); // Timeout, return empty
            }

            // Wait before the next check, respecting the deadline
            let remaining_time = deadline - now;
            let sleep_duration = std::cmp::min(check_interval, remaining_time);

            // Sleep, but allow cancellation if the client disconnects
            tokio::select! {
                _ = sleep(sleep_duration) => {
                    // Continue to the next iteration of the loop
                    tracing::trace!("Slept for {:?}, checking again.", sleep_duration);
                }
                // If the request is cancelled (e.g., client disconnect), the task will be aborted here.
            }
        }
    }
}

// --- Main Application Setup (No changes from previous) ---

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let db_path = Path::new("./message_db");
    std::fs::create_dir_all(db_path)?;
    let keyspace = Config::new(db_path).open_transactional()?;

    let shared_state = Arc::new(keyspace);

    let app = Router::new()
        .route("/api/put-message", post(put_message_handler))
        .route("/api/get-messages", post(get_messages_handler))
        .with_state(shared_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
