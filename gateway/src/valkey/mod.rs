use fred::prelude::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;
use crate::ws::messages::ServerMessage;

/// Message payload stored in Valkey Streams.
#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct StreamMessage {
    pub user_id: String,
    pub channel_id: String,
    pub content: String,
}

/// Publish a chat message to Valkey Streams (XADD).
/// The message-service will consume this via XREADGROUP.
pub async fn publish_message(
    state: &AppState,
    user_id: &Uuid,
    channel_id: &Uuid,
    content: &str,
) -> Result<(), fred::error::RedisError> {
    let fields: Vec<(&str, String)> = vec![
        ("user_id", user_id.to_string()),
        ("channel_id", channel_id.to_string()),
        ("content", content.to_string()),
    ];

    let _: String = state
        .valkey
        .xadd("stream:messages", false, None, "*", fields)
        .await?;

    tracing::debug!(%user_id, %channel_id, "Message published to stream");
    Ok(())
}

/// Publish a typing indicator via Valkey Pub/Sub.
pub async fn publish_typing(
    state: &AppState,
    user_id: &Uuid,
    channel_id: &Uuid,
) -> Result<(), fred::error::RedisError> {
    let channel = format!("typing:{}", channel_id);
    let payload = serde_json::json!({
        "user_id": user_id.to_string(),
        "channel_id": channel_id.to_string(),
    })
    .to_string();

    let _: i64 = state.valkey.publish(&channel, &payload).await?;
    Ok(())
}

/// Background task: subscribe to Valkey Pub/Sub and broadcast events to connected clients.
pub async fn pubsub_listener(state: AppState) {
    let config = RedisConfig::from_url(
        &std::env::var("VALKEY_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
    )
    .expect("Invalid Valkey URL");

    let subscriber = Builder::from_config(config)
        .build()
        .expect("Failed to build subscriber client");

    subscriber
        .init()
        .await
        .expect("Failed to connect subscriber");

    // Subscribe to message broadcast channel
    let mut message_rx = subscriber.message_rx();

    subscriber
        .psubscribe::<&str>("broadcast:*")
        .await
        .expect("Failed to subscribe to broadcast channels");

    subscriber
        .psubscribe::<&str>("typing:*")
        .await
        .expect("Failed to subscribe to typing channels");

    tracing::info!("Pub/Sub listener started");

    while let Ok(message) = message_rx.recv().await {
        let channel = message.channel.to_string();
        let payload = message.value.convert::<String>().unwrap_or_default();

        if channel.starts_with("broadcast:") {
            // Message broadcast: forward to all connected clients
            state.broadcast(&payload);
        } else if channel.starts_with("typing:") {
            // Typing indicator: forward only to online channel members
            if let Ok(typing) = serde_json::from_str::<serde_json::Value>(&payload) {
                let channel_id = typing["channel_id"].as_str().unwrap_or_default();
                let user_id_str = typing["user_id"].as_str().unwrap_or_default();

                if let (Ok(cid), Ok(uid)) =
                    (channel_id.parse::<Uuid>(), user_id_str.parse::<Uuid>())
                {
                    let msg = serde_json::to_string(&ServerMessage::UserTyping {
                        channel_id: cid,
                        user_id: uid,
                    })
                    .unwrap();

                    // Get online members from Valkey set (maintained by presence-service)
                    let key = format!("channel:online:{}", cid);
                    let members: Vec<String> =
                        state.valkey.smembers(&key).await.unwrap_or_default();
                    let member_uuids: Vec<Uuid> = members
                        .iter()
                        .filter_map(|m| m.parse::<Uuid>().ok())
                        .filter(|id| *id != uid) // don't send typing to the typer
                        .collect();
                    state.broadcast_to(&member_uuids, &msg);
                }
            }
        }
    }
}
