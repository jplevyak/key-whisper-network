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
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;

    let mut write_tx = keyspace.write_tx();
    let mut results = Vec::new();

    // Store keys to remove after iterating
    let mut keys_to_remove: Vec<Vec<u8>> = Vec::new();

    for message_id_str in &payload.message_ids {
        let key_prefix = message_id_str.as_bytes();
        let mut found_item: Option<(Vec<u8>, Vec<u8>)> = None; // To store (full_key, value_bytes)

        // --- Scope for the iterator borrow ---
        {
            let mut iter = write_tx.prefix(&messages_partition, key_prefix);
            if let Some(result) = iter.next() {
                match result {
                    Ok((key_slice, value_slice)) => {
                        // Store the full key and value bytes to process after the iterator's borrow ends
                        found_item = Some((key_slice.to_vec(), value_slice.to_vec()));
                    }
                    Err(e) => {
                        error!(
                            "Database error while iterating prefix {}: {}",
                            message_id_str, e
                        );
                        // Abort the transaction on DB error
                        return Err(AppError::Fjall(e));
                    }
                }
                // Note: We only process the *first* item found by the prefix iterator.
            }
            // Iterator goes out of scope here, releasing the borrow on write_tx
        }
        // --- End of iterator borrow scope ---

        // Now process the found item (if any) outside the iterator's borrow scope
        if let Some((full_key, value_bytes)) = found_item {
            match serde_json::from_slice::<MessageRecord>(&value_bytes) {
                Ok(record) => {
                    results.push(FoundMessage {
                        message_id: message_id_str.clone(), // Use the original requested ID
                        message: record.message,
                        timestamp: record.timestamp,
                    });
                    // Mark this key for removal later
                    keys_to_remove.push(full_key);
                }
                Err(e) => {
                    error!(
                        "Failed to deserialize record for key prefix {}: {}",
                        message_id_str, e
                    );
                    // Decide how to handle deserialization errors, e.g., skip or fail transaction
                    // For now, let's propagate the error, which will abort the transaction
                    return Err(AppError::SerdeJson(e));
                }
            }
        }
        // If found_item is None, the prefix wasn't found, so we do nothing for this message_id.
    }

    // Now perform all removals within the transaction
    for key in keys_to_remove {
        write_tx.remove(&messages_partition, key); // No '?' needed here
    }

    write_tx.commit()?;
    // If all operations succeeded, return the collected messages
    Ok(Json(GetMessagesResponse { results }))
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
