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

#[derive(Serialize)]
struct FoundMessage {
    message_id: String, // Hex encoded SHA256
    message: String,    // Base64 encoded
}

#[derive(Serialize)]
struct GetMessagesResponse {
    results: Vec<FoundMessage>,
}

// --- Shared State ---

type SharedState = Arc<Keyspace>;

// --- Error Handling ---

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

// Implement IntoResponse for AppError to convert errors into HTTP responses
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Log the error for debugging
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

async fn put_message_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<PutMessageRequest>,
) -> Result<StatusCode, AppError> {
    // 1. Decode Hex Message ID to bytes (Fjall uses byte slices as keys)
    let key_bytes = hex::decode(&payload.message_id)?;

    // Basic validation (ensure it's 32 bytes for SHA256)
    if key_bytes.len() != 32 {
        return Err(AppError::InvalidInput(
            "message_id must be a 32-byte SHA256 hash (64 hex characters)".to_string(),
        ));
    }

    // 2. Basic Base64 validation (optional, but good practice)
    // We don't strictly need to decode it here unless we want to validate content
    if BASE64_STANDARD.decode(&payload.message).is_err() {
        return Err(AppError::InvalidInput(
            "Invalid base64 encoding for message".to_string(),
        ));
    }

    // 3. Prepare record
    let record = MessageRecord {
        message_base64: payload.message,
        timestamp: Utc::now(),
    };

    // 4. Serialize record to bytes (using JSON for simplicity here, bincode recommended for prod)
    let value_bytes = serde_json::to_vec(&record)?;

    // 5. Open the partition (table/bucket)
    // Caching this partition handle might be more efficient in a real app
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;

    // 6. Insert into Fjall
    messages_partition.insert(&key_bytes, value_bytes)?;

    // 7. Persist (optional, choose desired durability)
    // Default only flushes to OS buffer. Use PersistMode::Sync for disk durability.
    // keyspace.persist(PersistMode::BufferAsync)?; // Example

    Ok(StatusCode::CREATED) // Or StatusCode::OK if updates are allowed
}

async fn get_messages_handler(
    State(keyspace): State<SharedState>,
    Json(payload): Json<GetMessagesRequest>,
) -> Result<Json<GetMessagesResponse>, AppError> {
    let messages_partition =
        keyspace.open_partition("messages", PartitionCreateOptions::default())?;
    let mut results = Vec::new();

    for hex_id in payload.message_ids {
        match hex::decode(&hex_id) {
            Ok(key_bytes) => {
                // Skip invalid length keys silently, or return error
                if key_bytes.len() != 32 {
                    continue;
                }

                match messages_partition.get(&key_bytes)? {
                    Some(value_ivec) => {
                        // Found the key, deserialize value
                        match serde_json::from_slice::<MessageRecord>(&value_ivec) {
                            Ok(record) => {
                                results.push(FoundMessage {
                                    message_id: hex_id, // Use original hex string
                                    message: record.message_base64,
                                });
                            }
                            Err(e) => {
                                // Log data corruption error but continue?
                                error!("Failed to deserialize record for key {}: {}", hex_id, e);
                                // Optionally return an error for the whole request here
                            }
                        }
                    }
                    None => {
                        // Key not found, simply skip it
                    }
                }
            }
            Err(_) => {
                // Skip invalid hex IDs silently, or return error
                continue;
            }
        }
    }

    Ok(Json(GetMessagesResponse { results }))
}

// --- Main Application Setup ---

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Setup tracing/logging
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Configure and open Fjall Keyspace
    let db_path = Path::new("./message_db"); // Make this configurable
    std::fs::create_dir_all(db_path)?; // Ensure directory exists
    let keyspace = Config::new(db_path).open()?;

    // Create shared state
    let shared_state = Arc::new(keyspace);

    // Build Axum router
    let app = Router::new()
        .route("/put-message", post(put_message_handler))
        .route("/get-messages", post(get_messages_handler))
        .with_state(shared_state); // Provide the shared state to handlers

    // Define server address
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000)); // Make this configurable
    tracing::info!("Listening on {}", addr);

    // Create TCP listener
    let listener = tokio::net::TcpListener::bind(addr).await?;

    // Run the Axum server
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
