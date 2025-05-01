use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Router,
};
use chrono::{DateTime, Utc};
use dashmap::DashMap;
use fjall::{Config, PartitionCreateOptions, TransactionalKeyspace};
use futures::future::select_all;
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    path::Path,
    sync::{Arc, Weak}, // Import Weak
};
use tokio::sync::Notify;
use tokio::time::{sleep, Duration, Instant};
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tracing::{error, info, instrument, warn};
use web_push::{
    ContentEncoding, SubscriptionInfo, VapidSignatureBuilder, WebPushClient, WebPushError,
    WebPushMessageBuilder,
};

#[derive(Deserialize, Debug)]
struct PutMessageRequest {
    message_id: String,
    message: String,
}

#[derive(Deserialize, Debug)]
struct GetMessagesRequest {
    message_ids: Vec<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug)]
struct MessageRecord {
    message: String,
    timestamp: DateTime<Utc>,
}

#[derive(Serialize, Debug)]
struct FoundMessage {
    message_id: String,
    message: String,
    timestamp: DateTime<Utc>,
}

#[derive(Serialize, Debug)]
struct GetMessagesResponse {
    results: Vec<FoundMessage>,
}

// --- Structs for Acknowledgment ---
#[derive(Deserialize, Debug)]
struct AckMessageRequest {
    message_id: String,
    timestamp: DateTime<Utc>,
}

#[derive(Deserialize, Debug)]
struct AckMessagesPayload {
    acks: Vec<AckMessageRequest>,
}

// Represents the 'keys' object within the PushSubscription
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SubscriptionKeysInfo {
    p256dh: String,
    auth: String,
}

// Represents the main PushSubscription object received from the client
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PushSubscriptionInfo {
    client_id: String,        // Unique identifier for the client
    message_ids: Vec<String>, // Unique identifier for the message
    endpoint: String,         // The push service URL
    keys: SubscriptionKeysInfo,
}

// Example structure for the payload data we want to send in a notification
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NotificationPayload {
    title: String,
    body: String,
    icon: Option<String>,
    url: Option<String>, // URL to open on click
                         // Add any other custom data you need
}

// Structure for the shared application state
struct AppState {
    keyspace: TransactionalKeyspace,
    notifier_map: DashMap<String, Weak<Notify>>, // Store Weak pointers
    subscription_store: tokio::sync::Mutex<Vec<PushSubscriptionInfo>>,
}

// Define the type for the shared application state
type SharedState = Arc<AppState>;

// --- Error Handling ---
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
        error!("Error processing request: {:?}", self);
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
    State(state): State<SharedState>,
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

    // Create the key by concatenating message_id bytes and timestamp bytes (big-endian)
    let message_id_clone = payload.message_id.clone(); // Clone for notifier map key
    let mut key_bytes = Vec::new();
    key_bytes.extend_from_slice(payload.message_id.as_bytes());
    key_bytes.extend_from_slice(&timestamp.timestamp_millis().to_be_bytes());

    messages_partition.insert(key_bytes, value_bytes)?;

    // Notify any waiting getters
    if let Some(weak_notifier_entry) = state.notifier_map.get(&message_id_clone) {
        // Attempt to upgrade the Weak pointer
        if let Some(notifier) = weak_notifier_entry.value().upgrade() {
            tracing::debug!(message_id = %message_id_clone, "Notifying waiters");
            notifier.notify_waiters();
        } else {
            // The Arc was dropped, no one is waiting.
            // Optionally remove the stale Weak ref here, though get_messages will handle it.
            // state.notifier_map.remove(&message_id_clone);
            tracing::trace!(message_id = %message_id_clone, "Notifier existed but was stale (no waiters).");
        }
    }

    // Optionally persist explicitly
    // state.keyspace.persist(PersistMode::BufferAsync)?;
    Ok(StatusCode::CREATED)
}

// --- Handler for Acknowledging/Deleting Messages ---
#[instrument(skip(state, payload))]
async fn ack_messages_handler(
    State(state): State<SharedState>,
    Json(payload): Json<AckMessagesPayload>,
) -> Result<StatusCode, AppError> {
    if payload.acks.is_empty() {
        return Ok(StatusCode::OK);
    }

    let messages_partition = state
        .keyspace
        .open_partition("messages", PartitionCreateOptions::default())?;

    // Use a transaction for batch deletion efficiency
    let mut write_tx = state.keyspace.write_tx();

    for ack in payload.acks {
        // Reconstruct the key used in put_message_handler
        let mut key_bytes = Vec::new();
        key_bytes.extend_from_slice(ack.message_id.as_bytes());
        key_bytes.extend_from_slice(&ack.timestamp.timestamp_millis().to_be_bytes());

        // Remove the message by its reconstructed key
        write_tx.remove(&messages_partition, key_bytes);
        tracing::debug!(message_id = %ack.message_id, timestamp = %ack.timestamp, "Acknowledged and marked message for deletion");
    }

    write_tx.commit()?;

    Ok(StatusCode::OK)
}

#[instrument(skip(state, payload))]
#[axum::debug_handler]
async fn get_messages_handler(
    State(state): State<SharedState>,
    Json(payload): Json<GetMessagesRequest>,
) -> Result<Json<GetMessagesResponse>, AppError> {
    let requested_timeout_ms = payload.timeout_ms.unwrap_or(300_000); // Default 5 minutes
    let deadline = Instant::now() + Duration::from_millis(requested_timeout_ms);
    let check_interval = Duration::from_millis(300_000); // Check DB every 5 minutes

    // Get or create notifiers for the requested message IDs, handling Weak pointers
    let mut notifiers: Vec<Arc<Notify>> = Vec::with_capacity(payload.message_ids.len());
    for id in &payload.message_ids {
        let notifier_arc = loop {
            // Use entry API for atomic operations
            let entry = state.notifier_map.entry(id.clone());
            match entry {
                dashmap::mapref::entry::Entry::Occupied(o) => {
                    if let Some(arc) = o.get().upgrade() {
                        // Successfully upgraded Weak to Arc
                        break arc;
                    } else {
                        // Stale Weak pointer found, remove it and retry loop to insert new
                        tracing::trace!(message_id = %id, "Removing stale notifier entry.");
                        o.remove();
                        continue; // Retry loop to insert new entry
                    }
                }
                dashmap::mapref::entry::Entry::Vacant(v) => {
                    // No entry exists, create new Arc and insert Weak
                    let new_arc = Arc::new(Notify::new());
                    v.insert(Arc::downgrade(&new_arc));
                    tracing::trace!(message_id = %id, "Created new notifier entry.");
                    break new_arc;
                }
            }
        };
        notifiers.push(notifier_arc);
    }

    loop {
        let mut found_messages_this_iteration = Vec::new();

        {
            // Scope for transaction lifetime
            let messages_partition = state
                .keyspace
                .open_partition("messages", PartitionCreateOptions::default())?;
            // Use a write transaction, even for reads in this context
            let write_tx = state.keyspace.write_tx();

            for message_id_str in &payload.message_ids {
                let key_prefix = message_id_str.as_bytes();

                // Scope for the iterator borrow using the transaction
                {
                    let iter = write_tx.prefix(&messages_partition, key_prefix);

                    // Iterate through ALL items matching the prefix
                    for result in iter {
                        match result {
                            Ok((_key_slice, value_slice)) => {
                                let value_bytes = value_slice.to_vec();

                                // Deserialize the found record
                                match serde_json::from_slice::<MessageRecord>(&value_bytes) {
                                    Ok(record) => {
                                        // Store results temporarily for this iteration
                                        found_messages_this_iteration.push(FoundMessage {
                                            message_id: message_id_str.clone(),
                                            message: record.message,
                                            timestamp: record.timestamp,
                                        });
                                        // Deletion happens on ACK
                                    }
                                    Err(e) => {
                                        error!(
                                            "Failed to deserialize record for key prefix {}: {}",
                                            message_id_str, e
                                        );
                                        // Error within transaction scope, return immediately
                                        return Err(AppError::SerdeJson(e));
                                    }
                                }
                            }
                            Err(e) => {
                                error!(
                                    "Database error during prefix scan for {}: {}",
                                    message_id_str, e
                                );
                                // Error within transaction scope, return immediately
                                return Err(AppError::Fjall(e));
                            }
                        }
                    } // End iteration for this prefix
                } // Iterator goes out of scope
            } // End loop through message_ids

            // Commit the (read-only) transaction to release locks/resources
            write_tx.commit()?;
        } // Transaction goes out of scope here

        if !found_messages_this_iteration.is_empty() {
            // We found messages. Return them. Frontend will ACK later.
            tracing::debug!(
                "Found {} messages, returning (no deletion).",
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

            // Prepare notified futures
            let notified_futures = notifiers.iter().map(|n| Box::pin(n.notified()));

            tracing::trace!(
                "No messages found, waiting for notification or timeout ({:?})...",
                sleep_duration
            );

            // Wait for notification or sleep timeout
            tokio::select! {
                // Wait for any of the notifiers to trigger
                _ = select_all(notified_futures) => {
                    tracing::trace!("Notification received, re-checking for messages.");
                    // No sleep, loop immediately to check DB
                }
                // Wait for the calculated sleep duration
                _ = sleep(sleep_duration) => {
                     tracing::trace!("Slept for {:?}, checking again.", sleep_duration);
                     // Continue loop, will check deadline at the top
                }
            }
        }
    } // End loop
}

/// Handler to receive and store a push subscription from the client
#[instrument(skip(state, payload))]
#[axum::debug_handler]
async fn save_subscription_handler(
    State(state): State<SharedState>,          // Extract shared state
    Json(payload): Json<PushSubscriptionInfo>, // Extract JSON payload
) -> Result<StatusCode, AppError> { // <-- Changed return type
    info!("Received subscription request: {:?}", payload.endpoint);

    // In a real app:
    // - Validate the subscription data further.
    // - Associate it with the logged-in user ID.
    // - Check if this exact subscription (endpoint) already exists for the user.
    // - Store it persistently in a database.

    let messages_partition = state
        .keyspace
        .open_partition("subscriptions", PartitionCreateOptions::default())?;

    // Serialize the subscription info to store it
    let payload_bytes = serde_json::to_vec(&payload)?;

    for key in payload.message_ids.iter() {
        // Store the serialized bytes
        messages_partition.insert(key.as_bytes(), &payload_bytes)?;
    }

    info!(
        "Subscription stored successfully for endpoint: {}",
        payload.endpoint
    );

    Ok(StatusCode::CREATED)
}

// Add this dependency to Cargo.toml for real implementation:
// web-push = "0.10"
// We'll use its types but comment out the actual sending part.

/// Handler to trigger sending a push notification (simulation)
pub async fn send_notification_handler(
    State(state): State<SharedState>, // Extract shared state
                                      // Optionally, take a payload from the request body:
                                      // Json(payload): Json<NotificationPayload>,
) -> impl IntoResponse {
    info!("Received request to send push notification.");

    // --- Prepare Notification Content ---
    // In a real app, this content might come from the request body
    // or be determined by backend logic/events.
    let notification_payload = NotificationPayload {
        title: "Server Push!".to_string(),
        body: format!("Notification sent from Axum at {}", chrono::Utc::now()),
        icon: Some("images/icon-192.png".to_string()), // Match service worker expectation
        url: Some("/".to_string()),                    // URL to open on click
    };
    let payload_json_bytes = match serde_json::to_vec(&notification_payload) {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Failed to serialize notification payload: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to create notification payload.",
            )
                .into_response();
        }
    };

    // --- Retrieve Subscription ---
    let subscription_info: PushSubscriptionInfo; // Will hold the sub to send to

    {
        // Scoped lock
        let store = state.subscription_store.lock().await;
        // In a real app: Retrieve subscription(s) based on user ID, topic, etc.
        // For sketch: Get the most recently added subscription.
        if let Some(sub) = store.last() {
            subscription_info = sub.clone(); // Clone to use after unlocking
        } else {
            warn!("No subscriptions found in store to send notification.");
            return (StatusCode::NOT_FOUND, "No subscriptions available.").into_response();
        }
    } // Lock released here

    // --- !!! Web Push Sending Logic (Simulation) !!! ---
    info!(
        "Attempting to send notification to: {}",
        subscription_info.endpoint
    );

    // 1. Convert our stored info to the web_push crate's format
    let push_crate_sub_info = SubscriptionInfo::new(
        subscription_info.endpoint.clone(),
        subscription_info.keys.p256dh.clone(),
        subscription_info.keys.auth.clone(),
    );

    // 2. Prepare the message builder
    // You need VAPID keys generated for your server (e.g., using web-push CLI or library)
    // Load these securely from environment variables or config files!
    // NEVER hardcode private keys.
    let vapid_private_key = "YOUR_PRIVATE_VAPID_KEY_HERE_FROM_ENV"; // Placeholder
    let vapid_subject = "mailto:your_email@example.com"; // Placeholder

    // Build VAPID signature using `?` for error handling
    let signature = VapidSignatureBuilder::from_pem(vapid_private_key.as_bytes(), &push_crate_sub_info)
        .map_err(|e| {
            error!("Failed to create VAPID signature builder (check private key format?): {}", e);
            // Return an AppError or similar if you define one for VAPID issues
            (StatusCode::INTERNAL_SERVER_ERROR, "VAPID configuration error.")
        })?
        .with_subject(vapid_subject) // Set subject here
        .build()
        .map_err(|e| {
            error!("Failed to build VAPID signature: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "VAPID signature build error.")
        })?;


    // Build the message
    let mut message_builder = WebPushMessageBuilder::new(&push_crate_sub_info)
        .map_err(|e| {
            error!("Failed to create message builder: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed preparing push message.")
        })?; // Use ? for concise error handling within the handler

    message_builder.set_payload(ContentEncoding::Aes128Gcm, &payload_json_bytes);
    message_builder.set_vapid_signature(signature);
    message_builder.set_ttl(Duration::from_secs(3600 * 12).as_secs() as u32); // e.g., 12 hours Time To Live

    // 3. Send the message using the web_push client
    let client = WebPushClient::new()
        .map_err(|e| {
            error!("Failed to create web push client: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Failed creating push client.")
        })?; // Apply map_err to the Result of new()

    info!("Sending actual push message...");
    match client
        .send(message_builder.build().map_err(|e| {
            error!("Failed to build web push message: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed building push message.",
            )
        })?)
        .await
    {
        Ok(response) => {
            info!(
                "Push message sent successfully! Response: {:?}",
                response.status()
            );
            // Return the success response directly
            return (StatusCode::OK, "Notification sent successfully.").into_response();
        }
        Err(e) => {
            error!("Failed to send push message: {}", e);
            // Use return in each match arm
            match e {
                // Use tuple variant pattern `Variant(_)`
                WebPushError::EndpointNotValid(_) | WebPushError::EndpointNotFound(_) => {
                    // Consider removing this invalid/expired subscription from your database
                    warn!(
                        "Subscription endpoint invalid or not found: {}",
                        subscription_info.endpoint,
                    );
                    return (
                        StatusCode::GONE,
                        "Subscription endpoint is gone or invalid.",
                    )
                        .into_response();
                }
                // Use tuple variant pattern `Variant(_)`
                WebPushError::Unauthorized(_) => {
                    error!("Push service authorization failed - check VAPID keys!");
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "VAPID authorization failed.",
                    )
                        .into_response();
                }
                _ => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to send push: {}", e),
                    )
                        .into_response();
                }
            // The match arms now return, so this part is unreachable if the match executes.
            // If you intend for the simulation code to run *after* a successful send,
            // it should be placed inside the Ok arm before the `return`.
            // If the simulation is meant as a fallback or alternative path,
            // the logic needs restructuring.
            // Removing the simulation code for now as the `match` handles all cases.
            // info!(
            //     "SIMULATED: Would send payload to endpoint: {} with VAPID subject: {}",
            //     subscription_info.endpoint, vapid_subject
            // );
            // info!("SIMULATED: Payload bytes: {:?}", payload_json_bytes);
            // (StatusCode::OK, "Notification sending simulated.").into_response()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let db_path = Path::new("./message_db");
    std::fs::create_dir_all(db_path)?;

    // Initialize AppState
    let app_state = Arc::new(AppState {
        keyspace: Config::new(db_path).open_transactional()?,
        notifier_map: DashMap::new(),
        subscription_store: tokio::sync::Mutex::new(Vec::new()),
    });

    let governor_config = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor) // Use SmartIpKeyExtractor for X-Real-IP
            .per_second(10)
            .burst_size(10)
            .finish()
            .unwrap(),
    );

    let governor_limiter = governor_config.limiter().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        tracing::info!("rate limiting storage size: {}", governor_limiter.len());
        governor_limiter.retain_recent();
    });

    let app = Router::new()
        .route("/api/put-message", post(put_message_handler))
        .route("/api/get-messages", post(get_messages_handler))
        .route("/api/ack-messages", post(ack_messages_handler))
        .route("/api/save-subscription", post(save_subscription_handler))
        .with_state(app_state) // Use the new AppState
        .layer(GovernorLayer {
            config: governor_config,
        });

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}
