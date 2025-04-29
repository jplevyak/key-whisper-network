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
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tracing::{debug, error, info, instrument, trace};

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
    println!("put_message_handler {:?}", payload);
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
        println!("Notifying waiters for message_id: {}", message_id_prefix);
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

#[instrument(skip(keyspace, message_ids_to_check))]
async fn fetch_messages_since(
    keyspace: &TransactionalKeyspace, // Borrow keyspace
    message_ids_to_check: &[String],  // Borrow slice of IDs
    since: Option<DateTime<Utc>>,     // Optional timestamp for filtering
) -> Vec<FoundMessage> // Return Vec directly, handle errors internally by logging
{
    let mut found_messages = Vec::new();
    let fetch_description = if since.is_some() {
        "Notified"
    } else {
        "Initial"
    };

    match keyspace.open_partition("messages", PartitionCreateOptions::default()) {
        Ok(messages_partition) => {
            let read_tx = keyspace.read_tx();
            for message_id_str in message_ids_to_check {
                let key_prefix = message_id_str.as_bytes();
                trace!(message_id = %message_id_str, kind = fetch_description, "Scanning prefix");

                let iter = read_tx.prefix(&messages_partition, key_prefix);
                for result in iter {
                    match result {
                        Ok((_key, value_slice)) => {
                            match serde_json::from_slice::<MessageRecord>(&value_slice) {
                                Ok(record) => {
                                    // Apply time filter only if 'since' is Some
                                    if since.map_or(true, |t| record.timestamp > t) {
                                        found_messages.push(FoundMessage {
                                            message_id: message_id_str.clone(),
                                            message: record.message,
                                            timestamp: record.timestamp,
                                        });
                                    }
                                }
                                Err(e) => {
                                    error!(message_id = %message_id_str, kind = fetch_description, error = %e, "Deserialize failed, skipping.")
                                }
                            }
                        }
                        Err(e) => {
                            error!(message_id = %message_id_str, kind = fetch_description, error = %e, "DB prefix scan error")
                        }
                    }
                } // End iter results
            } // End loop message_ids
        } // read_tx drop
        Err(e) => error!(kind = fetch_description, error = %e, "Failed to open messages partition"),
    }
    found_messages // Return messages found, even if some errors occurred
}

#[instrument(skip(state, params))]
#[axum::debug_handler]
async fn get_messages_sse_handler(
    State(state): State<AppState>,
    Query(params): Query<GetMessagesParams>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let requested_message_ids: Vec<String> = params
        .message_ids
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    info!(?requested_message_ids, "SSE connection established");
    println!("SSE connection established {:?}", requested_message_ids);

    // --- 1. Perform Initial Fetch using Helper ---
    // If requested_message_ids is empty, this will correctly do nothing/return empty Vec
    let initial_messages = fetch_messages_since(
        &state.keyspace,
        &requested_message_ids, // Pass potentially empty Vec
        None,
    )
    .await;
    let connection_time = Utc::now();

    // --- 2. Register interest and get Notifier Arcs ---
    // If requested_message_ids is empty, this loop won't run, notifier_clones will be empty
    let mut notifier_clones = Vec::new();
    {
        let mut map_guard = state.notifier_map.lock().await;
        for id in &requested_message_ids {
            let notifier = map_guard
                .entry(id.clone())
                .or_insert_with(|| Arc::new(Notify::new()))
                .clone();
            notifier_clones.push(notifier);
        }
    }

    // --- 3. Create the Stream ---
    // Initial event logic handles empty initial_messages correctly
    let initial_event: Option<Result<Event, Infallible>> = if !initial_messages.is_empty() {
        debug!(
            count = initial_messages.len(),
            "Sending initial messages via SSE"
        );
        match serde_json::to_string(&initial_messages) {
            Ok(json_data) => Some(Ok(Event::default().data(json_data).event("message"))),
            Err(e) => {
                error!(error = %e, "Failed to serialize initial messages for SSE");
                None
            }
        }
    } else {
        None
    };

    // The notification stream using unfold
    let notification_stream = stream::unfold(
        // Initial state uses connection_time
        (
            state.clone(),
            requested_message_ids.clone(),
            notifier_clones,
            connection_time,
        ),
        move |(state, ids, notifiers, mut last_check_time)| async move {
            // --- Wait for notification ---
            let notification_futures = notifiers
                .iter()
                .map(|notifier| Box::pin(notifier.notified()));

            // *** Modified Handling for Empty Notifiers ***
            if notifiers.is_empty() {
                // If no IDs were requested, notifier_clones (and thus notifiers) will be empty.
                // Instead of returning early or ending the stream, we wait indefinitely.
                // The keep-alive mechanism will keep the SSE connection open.
                // We yield `None` for the event, so filter_map removes it.
                debug!("No message IDs requested, SSE stream active but idle.");
                // A long sleep or pending future prevents a busy loop. `pending()` is cleaner.
                std::future::pending::<()>().await;
                Some((None, (state, ids, notifiers, last_check_time)))
            } else {
                debug!("Waiting for notifications on {} IDs", ids.len());
                println!("Waiting for notifications on {:?} IDs", ids);
                future::select_all(notification_futures).await;
                println!("Received notification, checking for new messages...");
                debug!("Received notification, checking for new messages...");

                // --- Check Database on Notification using Helper ---
                let current_check_time = Utc::now();
                let found_messages = fetch_messages_since(
                    &state.keyspace,
                    &ids,
                    Some(last_check_time), // Fetch incrementally
                )
                .await;
                last_check_time = current_check_time; // Update last check time

                // --- Event Creation Logic ---
                let event_option: Option<Event> = if !found_messages.is_empty() {
                    debug!(
                        count = found_messages.len(),
                        "Found new messages to send via SSE"
                    );
                    match serde_json::to_string(&found_messages) {
                        Ok(json_data) => Some(Event::default().data(json_data).event("message")),
                        Err(e) => {
                            error!(error = %e, "Failed to serialize notified messages for SSE");
                            None
                        }
                    }
                } else {
                    trace!("No new messages found since last notification check.");
                    None
                };

                // Yield Option<Event> and the state for the next iteration
                Some((event_option, (state, ids, notifiers, last_check_time)))
            }
        },
    )
    .filter_map(|item| async { item }) // Filter out None values (including the one yielded in the idle case)
    .map(Ok); // Map Event to Result<Event, Infallible>

    // Combine the initial event (if any) with the notification stream
    let final_stream = stream::iter(initial_event).chain(notification_stream);

    // --- 4. Configure SSE Response ---
    // This now always returns the same *kind* of stream structure
    Sse::new(final_stream).keep_alive(
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
        .route("/api/get-messages-sse", get(get_messages_sse_handler))
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
