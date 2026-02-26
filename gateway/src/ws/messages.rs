use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Incoming message from a WebSocket client.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "send_message")]
    SendMessage {
        channel_id: Uuid,
        content: String,
    },
    #[serde(rename = "typing")]
    Typing {
        channel_id: Uuid,
    },
    #[serde(rename = "ping")]
    Ping,
}

/// Outgoing message to a WebSocket client.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "new_message")]
    NewMessage {
        id: String,
        channel_id: Uuid,
        user_id: Uuid,
        content: String,
        created_at: String,
    },
    #[serde(rename = "user_typing")]
    UserTyping {
        channel_id: Uuid,
        user_id: Uuid,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error {
        message: String,
    },
}
