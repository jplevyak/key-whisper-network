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
use std::{net::SocketAddr, path::Path, sync::Arc};
use tokio::task::spawn_blocking; // Import spawn_blocking
use tokio::time::{sleep, Duration, Instant};
use tracing::{error, instrument}; // Import instrument

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

#[instrument(skip(keyspace, payload))] // Add tracing instrumentation
async fn put_message_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<PutMessageRequest>,
) -> Result<StatusCode, AppError> {
    let timestamp = Utc::now();
    let record = MessageRecord {
        message: payload.message, // Consider cloning if payload is used after move
        timestamp,
    };
    let value_bytes = serde_json::to_vec(&record)?; // Handle potential serde error before blocking

    // Create the key before moving data into the blocking task
    let mut key_bytes = Vec::new();
    key_bytes.extend_from_slice(payload.message_id.as_bytes()); // payload.message_id is String, implicitly cloned by as_bytes? No, it borrows. Clone explicitly if needed.
    key_bytes.extend_from_slice(&timestamp.timestamp_millis().to_be_bytes());

    // Clone Arc for moving into the blocking task
    let keyspace_clone = Arc::clone(&keyspace);

    // Spawn the blocking database operation
    spawn_blocking(move || -> Result<(), fjall::Error> {
        let messages_partition =
            keyspace_clone.open_partition("messages", PartitionCreateOptions::default())?;
        messages_partition.insert(key_bytes, value_bytes)?;
        // Optionally persist explicitly inside blocking task if needed
        // keyspace_clone.persist(PersistMode::BufferAsync)?;
        Ok(())
    })
    .await
    .map_err(|e| {
        error!("Blocking task panicked for put_message: {:?}", e);
        // Convert JoinError to a generic internal server error or a specific AppError variant
        AppError::Fjall(fjall::Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            "Blocking task panicked",
        )))
    })??; // First '?' handles JoinError, second '?' handles inner fjall::Error

    Ok(StatusCode::CREATED)
}

// Modified get_messages_handler for transactional read-then-delete
#[instrument(skip(keyspace, payload))] // Add tracing instrumentation
#[axum::debug_handler]
async fn get_messages_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<GetMessagesRequest>,
) -> Result<Json<GetMessagesResponse>, AppError> {
    let requested_timeout_ms = payload.timeout_ms.unwrap_or(30000); // Default 30s
    let deadline = Instant::now() + Duration::from_millis(requested_timeout_ms);
    let check_interval = Duration::from_millis(500); // Check DB every 500ms

    loop {
        // Clone data needed for the blocking task
        let keyspace_clone = Arc::clone(&keyspace);
        let message_ids_clone = payload.message_ids.clone(); // Clone the vec of strings

        // Spawn the blocking database transaction
        let db_result = spawn_blocking(
            move || -> Result<Vec<FoundMessage>, AppError> {
                let messages_partition = keyspace_clone
                    .open_partition("messages", PartitionCreateOptions::default())?;

                let mut found_messages = Vec::new();
                let mut keys_to_remove = Vec::new();

                // --- Transaction Scope ---
                {
                    let mut write_tx = keyspace_clone.write_tx();
                    for message_id_str in &message_ids_clone {
                        let key_prefix = message_id_str.as_bytes();
                        let mut found_item: Option<(Vec<u8>, Vec<u8>)> = None;

                        // Scope for the iterator borrow
                        {
                            let mut iter = write_tx.prefix(&messages_partition, key_prefix);
                            if let Some(result) = iter.next() {
                                match result {
                                    Ok((key_slice, value_slice)) => {
                                        found_item =
                                            Some((key_slice.to_vec(), value_slice.to_vec()));
                                    }
                                    Err(e) => {
                                        // Log error but return AppError from the closure
                                        error!(
                                            "Database error during prefix scan for {}: {}",
                                            message_id_str, e
                                        );
                                        return Err(AppError::Fjall(e));
                                    }
                                }
                            }
                        } // Iterator goes out of scope

                        if let Some((full_key, value_bytes)) = found_item {
                            match serde_json::from_slice::<MessageRecord>(&value_bytes) {
                                Ok(record) => {
                                    found_messages.push(FoundMessage {
                                        message_id: message_id_str.clone(),
                                        message: record.message,
                                        timestamp: record.timestamp,
                                    });
                                    keys_to_remove.push(full_key);
                                }
                                Err(e) => {
                                    // Log error but return AppError from the closure
                                    error!(
                                        "Failed to deserialize record for key prefix {}: {}",
                                        message_id_str, e
                                    );
                                    return Err(AppError::SerdeJson(e));
                                }
                            }
                        }
                    } // End loop through message_ids

                    // Perform removals if messages were found
                    if !keys_to_remove.is_empty() {
                        for key in &keys_to_remove {
                            write_tx.remove(&messages_partition, key);
                        }
                    }

                    // Commit the transaction (even if read-only)
                    write_tx.commit()?;
                }
                // --- End Transaction Scope ---

                Ok(found_messages) // Return the messages found in this transaction
            },
        )
        .await
        .map_err(|e| {
            error!("Blocking task panicked for get_messages: {:?}", e);
            // Convert JoinError to AppError
            AppError::Fjall(fjall::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "Blocking task panicked",
            )))
        })?; // Propagate JoinError converted to AppError

        // Check the result from the blocking task
        let found_messages_this_iteration = db_result?; // Propagate AppError from within the closure

        if !found_messages_this_iteration.is_empty() {
            // We found messages. Return them.
            tracing::debug!(
                "Found {} messages in blocking task, returning.",
                found_messages_this_iteration.len()
            );
            return Ok(Json(GetMessagesResponse {
                results: found_messages_this_iteration,
            }));
        } else {
            // No messages were found in this iteration. Check timeout and potentially sleep.
            let now = Instant::now();
            if now >= deadline {
                tracing::debug!("Long poll timeout reached.");
                return Ok(Json(GetMessagesResponse { results: vec![] })); // Timeout, return empty
            }

            // Wait before the next check, respecting the deadline
            let remaining_time = deadline - now;
            let sleep_duration = std::cmp::min(check_interval, remaining_time);

            // Sleep (await point) - The WriteTransaction is no longer alive here.
            tokio::select! {
                _ = sleep(sleep_duration) => {
                    tracing::trace!("Slept for {:?}, checking again.", sleep_duration);
                }
            }
        }
    } // End loop
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
