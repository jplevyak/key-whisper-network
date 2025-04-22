use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use fjall::{Config, Keyspace, PartitionCreateOptions};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::Path, sync::Arc};
use tracing::error;

// --- Data Structures ---

#[derive(Deserialize)]
struct PutMessageRequest {
    message_id: String, // Hex encoded SHA256
    message: String,    // Base64 encoded
}

#[derive(Deserialize)]
struct GetMessagesRequest {
    message_ids: Vec<String>, // List of Hex encoded SHA256
}

#[derive(Serialize, Deserialize, Debug)]
struct MessageRecord {
    message_base64: String,
    timestamp: DateTime<Utc>,
}

// Modified FoundMessage to include the timestamp
#[derive(Serialize)]
struct FoundMessage {
    message_id: String,       // Hex encoded SHA256
    message: String,          // Base64 encoded
    timestamp: DateTime<Utc>, // Added timestamp
}

#[derive(Serialize)]
struct GetMessagesResponse {
    results: Vec<FoundMessage>,
}

// --- Shared State ---

type SharedState = Arc<Keyspace>;

// --- Error Handling (No changes from previous AppError) ---

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("Fjall DB error: {0}")]
    Fjall(#[from] fjall::Error),
    #[error("JSON serialization/deserialization error: {0}")]
    SerdeJson(#[from] serde_json::Error),
    #[error("Hex decoding error: {0}")]
    Hex(#[from] hex::FromHexError),
    #[error("Base64 decoding error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!("Error processing request: {:?}", self);
        let (status, message) = match self {
            AppError::Fjall(_) | AppError::SerdeJson(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
            AppError::Hex(_) => (
                StatusCode::BAD_REQUEST,
                "Invalid message ID format".to_string(),
            ),
            AppError::Base64(_) => (
                StatusCode::BAD_REQUEST,
                "Invalid message base64 format".to_string(),
            ),
            AppError::InvalidInput(msg) => (StatusCode::BAD_REQUEST, msg),
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
    let key_bytes = hex::decode(&payload.message_id)?;
    if key_bytes.len() != 32 {
        return Err(AppError::InvalidInput(
            "message_id must be a 32-byte SHA256 hash (64 hex characters)".to_string(),
        ));
    }
    if BASE64_STANDARD.decode(&payload.message).is_err() {
        return Err(AppError::InvalidInput(
            "Invalid base64 encoding for message".to_string(),
        ));
    }
    let record = MessageRecord {
        message_base64: payload.message,
        timestamp: Utc::now(),
    };
    let value_bytes = serde_json::to_vec(&record)?;
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;
    messages_partition.insert(&key_bytes, value_bytes)?;
    // Optionally persist explicitly
    // keyspace.persist(PersistMode::BufferAsync)?;
    Ok(StatusCode::CREATED)
}

// Modified get_messages_handler for transactional read-then-delete
async fn get_messages_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<GetMessagesRequest>,
) -> Result<Json<GetMessagesResponse>, AppError> {
    // Open the partition handle needed for operations inside the transaction
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;

    // Perform the get-and-delete operations within a single transaction
    // The transaction function takes a closure. If the closure returns Ok,
    // the transaction is committed. If it returns Err, it's rolled back.
    // Dereference the Arc<Keyspace> to call the method on Keyspace
    let mut write_tx = keyspace.write_tx();
    let mut results = Vec::new();

    for hex_id in &payload.message_ids {
        // Iterate over borrows
        match hex::decode(hex_id) {
            Ok(key_bytes) => {
                if key_bytes.len() != 32 {
                    // Skip invalid length keys
                    tracing::warn!("Skipping invalid length key: {}", hex_id);
                    continue;
                }

                // Attempt to get the message within the transaction using the partition handle
                match write_tx.get(&messages_partition, &key_bytes)? {
                    Some(value_ivec) => {
                        // Found: Deserialize (IVec derefs to &[u8])
                        match serde_json::from_slice::<MessageRecord>(value_ivec) { // Pass IVec directly
                            Ok(record) => {
                                // Add to results list
                                results.push(FoundMessage {
                                    message_id: hex_id.clone(), // Clone hex string for result
                                    message: record.message_base64,
                                    timestamp: record.timestamp, // Include timestamp
                                });

                                // Successfully retrieved and deserialized, now remove within the same transaction using the partition handle
                                write_tx.remove(&messages_partition, &key_bytes)?;
                            }
                            Err(e) => {
                                // Deserialization error - potentially corrupt data.
                                // Fail the entire transaction to avoid inconsistent state.
                                error!("Failed to deserialize record for key {}: {}", hex_id, e);
                                // Convert serde error to fjall::Error or a custom transaction error
                                // For simplicity, let's return a generic IO error kind
                                return Err(AppError::Fjall(fjall::Error::Io(
                                    std::io::Error::new(
                                        std::io::ErrorKind::InvalidData,
                                        format!("Deserialization failed for key {}", hex_id),
                                    ),
                                )));
                            }
                        }
                    }
                    None => {
                        // Key not found, do nothing
                    }
                }
            }
            Err(_) => {
                // Skip invalid hex IDs
                tracing::warn!("Skipping invalid hex key: {}", hex_id);
                continue;
            }
        }
    }

    write_tx.commit()?;
    // If all operations succeeded, return the collected messages from the closure
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
        .route("/put-message", post(put_message_handler))
        .route("/get-messages", post(get_messages_handler))
        .with_state(shared_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
