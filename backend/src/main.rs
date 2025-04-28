use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use fjall::{Config, PartitionCreateOptions, TransactionalKeyspace};
use futures::future;
use futures::stream::{self, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{convert::Infallible, net::SocketAddr, path::Path, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Notify};
use tokio::time::interval;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tracing::{debug, error, info, instrument, trace, warn};

#[derive(Deserialize, Debug)]
struct PutMessageRequest {
    message_id: String,
    message: String,
}

#[derive(Deserialize, Debug)]
struct GetMessagesParams {
    // Expect comma-separated string like "id1,id2,id3"
    message_ids: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct MessageRecord {
    message: String,
    timestamp: DateTime<Utc>,
}

#[derive(Serialize, Debug, Clone)]
struct FoundMessage {
    message_id: String,
    message: String,
    timestamp: DateTime<Utc>,
}

// GetMessagesResponse is no longer needed for the SSE handler

#[derive(Deserialize, Debug)]
struct AckMessageRequest {
    message_id: String,
    timestamp: DateTime<Utc>,
}

#[derive(Deserialize, Debug)]
struct AckMessagesPayload {
    acks: Vec<AckMessageRequest>,
}

#[derive(Clone)]
struct AppState {
    keyspace: Arc<TransactionalKeyspace>,
    notifier_map: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("Fjall DB error: {0}")]
    Fjall(#[from] fjall::Error),
    #[error("JSON serialization/deserialization error: {0}")]
    SerdeJson(#[from] serde_json::Error),
    #[error("Payload too large: {0}")]
    PayloadTooLarge(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        error!("Error: {:?}", self); // Log the error regardless
        let (status, message) = match self {
            AppError::Fjall(_) | AppError::SerdeJson(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
            AppError::PayloadTooLarge(details) => (StatusCode::PAYLOAD_TOO_LARGE, details),
        };
        (status, message).into_response()
    }
}

#[instrument(skip(state, payload))]
async fn put_message_handler(
    State(state): State<AppState>,
    Json(payload): Json<PutMessageRequest>,
) -> Result<StatusCode, AppError> {
    const MAX_MESSAGE_ID_BYTES: usize = 100;
    const MAX_MESSAGE_BYTES: usize = 2048;

    if payload.message_id.len() > MAX_MESSAGE_ID_BYTES {
        return Err(AppError::PayloadTooLarge(format!(
            "message_id exceeds maximum size of {} bytes",
            MAX_MESSAGE_ID_BYTES
        )));
    }
    if payload.message.len() > MAX_MESSAGE_BYTES {
        return Err(AppError::PayloadTooLarge(format!(
            "message exceeds maximum size of {} bytes",
            MAX_MESSAGE_BYTES
        )));
    }

    let timestamp = Utc::now();
    let record = MessageRecord {
        message: payload.message,
        timestamp,
    };
    let value_bytes = serde_json::to_vec(&record)?;
    let messages_partition = state
        .keyspace
        .open_partition("messages", PartitionCreateOptions::default())?;

    let mut key_bytes = Vec::new();
    key_bytes.extend_from_slice(payload.message_id.as_bytes());
    key_bytes.extend_from_slice(&timestamp.timestamp_millis().to_be_bytes());

    messages_partition.insert(key_bytes, value_bytes)?;
    let message_id_prefix = payload.message_id.clone();
    let notifiers = state.notifier_map.lock().await;
    if let Some(notifier) = notifiers.get(&message_id_prefix) {
        debug!(message_id = %message_id_prefix, "Notifying waiters");
        notifier.notify_waiters();
    }
    Ok(StatusCode::CREATED)
}

#[instrument(skip(state, payload))]
async fn ack_messages_handler(
    State(state): State<AppState>,
    Json(payload): Json<AckMessagesPayload>,
) -> Result<StatusCode, AppError> {
    if payload.acks.is_empty() {
        return Ok(StatusCode::OK);
    }

    let messages_partition = state
        .keyspace
        .open_partition("messages", PartitionCreateOptions::default())?;
    let mut write_tx = state.keyspace.write_tx();

    for ack in payload.acks {
        let mut key_bytes = Vec::new();
        key_bytes.extend_from_slice(ack.message_id.as_bytes());
        key_bytes.extend_from_slice(&ack.timestamp.timestamp_millis().to_be_bytes());
        write_tx.remove(&messages_partition, key_bytes);
        debug!(message_id = %ack.message_id, timestamp = %ack.timestamp, "Acknowledged and marked message for deletion");
    }
    write_tx.commit()?;
    Ok(StatusCode::OK)
}

#[instrument(skip(state, params))]
#[axum::debug_handler]
async fn get_messages_sse_handler(
    State(state): State<AppState>,
    Query(params): Query<GetMessagesParams>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let message_ids: Vec<String> = params
        .message_ids
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    info!(?message_ids, "SSE connection established for message IDs");

    let mut notifiers = Vec::new();
    {
        // Scope for the map lock
        let mut map_guard = state.notifier_map.lock().await;
        for id in &message_ids {
            let notifier = map_guard
                .entry(id.clone())
                .or_insert_with(|| Arc::new(Notify::new())) // Create notifier if it doesn't exist
                .clone(); // Clone the Arc<Notify>
            notifiers.push(notifier);
        }
    } // Mutex guard dropped here

    // Create a stream that checks for messages periodically
    let stream = stream::unfold(
        (state.keyspace, message_ids), // Initial state: keyspace and the IDs to watch
        move |(keyspace, ids)| {
            let notifiers_clone = notifiers.clone();
            async move {
            let notification_futures = notifiers_clone
                .iter()
                .map(|notifier| Box::pin(notifier.notified())); // Pin futures
            if !notifiers_clone.is_empty() {
                 debug!("Waiting for notifications on {} IDs", ids.len());
                 future::select_all(notification_futures).await;
                 debug!("Received notification, checking for new messages...");
            } else {
                 warn!("SSE handler started with no message IDs requested.");
            }
            // Wait for the next interval tick. Check every 1 second. Adjust as needed.
            // Use a local interval; it restarts if the stream logic takes longer.
            let mut interval = interval(Duration::from_secs(1));
            interval.tick().await; // Wait for the first tick

            let mut found_messages_this_cycle = Vec::new();

            // --- Database Check Logic (similar to original, but adapted) ---
            match keyspace.open_partition("messages", PartitionCreateOptions::default()) {
                Ok(messages_partition) => {
                    let read_tx = keyspace.read_tx();
                    for message_id_str in &ids {
                        let key_prefix = message_id_str.as_bytes();
                        trace!(message_id = %message_id_str, "Scanning prefix");

                        // Iterate directly, handle errors inline
                        let iter = read_tx.prefix(&messages_partition, key_prefix);
                        for result in iter {
                             match result {
                                Ok((_key, value_slice)) => {
                                    match serde_json::from_slice::<MessageRecord>(&value_slice) {
                                        Ok(record) => {
                                            found_messages_this_cycle.push(FoundMessage {
                                                message_id: message_id_str.clone(),
                                                message: record.message,
                                                timestamp: record.timestamp,
                                            });
                                        }
                                        Err(e) => {
                                            // *** Corrected: Log serde error, don't use fjall::Error::Corruption ***
                                            error!(message_id = %message_id_str, error = %e, "Failed to deserialize record, skipping.");
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!(message_id = %message_id_str, error = %e, "Database error during prefix scan");
                                    // Break inner loop for this ID on DB error? Or continue? Logged for now.
                                }
                            }
                        } // End iteration for one message_id
                    } // End loop through all message_ids

                }
                Err(e) => {
                    error!(error = %e, "Failed to open messages partition");
                    // If partition fails, serious issue. Maybe stop the stream?
                    // For now, we'll just log and the stream will continue trying.
                }
            } // read_tx goes out of scope here
            // --- End Database Check Logic ---

            // --- Event Creation Logic (Yields Option<Event>) ---
            let event_option: Option<Event> = if !found_messages_this_cycle.is_empty() {
                debug!(count = found_messages_this_cycle.len(), "Found messages to send via SSE");
                match serde_json::to_string(&found_messages_this_cycle) {
                    Ok(json_data) => {
                        Some(Event::default().data(json_data).event("message"))
                    }
                    Err(e) => {
                        error!(error = %e, "Failed to serialize found messages for SSE");
                        None // Don't send event if serialization fails
                    }
                }
            } else {
                trace!("No new messages found in this interval.");
                None // No messages found
            };

            // Yield Option<Event> and the state for the next iteration
            Some((event_option, (keyspace, ids)))
        }
        }
    )
    // *** Corrected: Filter out None values using filter_map ***
    .filter_map(|item| async { item }); // item is Option<Event>, filter_map unwraps Some and discards None

    // *** Corrected: Wrap the resulting Event in Ok<_, Infallible> ***
    Sse::new(stream.map(Ok)) // stream now yields Event, map it to Result<Event, Infallible>
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive-text"),
        )
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let db_path = Path::new("./message_db");
    std::fs::create_dir_all(db_path)?;
    let keyspace = Arc::new(Config::new(db_path).open_transactional()?);
    let state = AppState {
        keyspace: keyspace.clone(),
        notifier_map: Arc::new(Mutex::new(HashMap::new())),
    };

    // --- Governor setup (unchanged) ---
    let governor_config = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .per_second(5)
            .burst_size(5)
            .finish()
            .unwrap(),
    );
    let governor_limiter = governor_config.limiter().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        info!("rate limiting storage size: {}", governor_limiter.len());
        governor_limiter.retain_recent();
    });

    let app = Router::new()
        .route("/api/put-message", post(put_message_handler))
        // --- Use GET for SSE endpoint and new handler ---
        .route("/api/get-messages-sse", get(get_messages_sse_handler)) // Changed route and method
        .route("/api/ack-messages", post(ack_messages_handler))
        .with_state(state)
        .layer(GovernorLayer {
            config: governor_config,
        });

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
