use dashmap::DashMap;
use fred::prelude::*;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Sender half to push messages to a connected WebSocket client.
pub type ClientSender = mpsc::UnboundedSender<String>;

/// Shared application state across all handlers and tasks.
#[derive(Clone)]
pub struct AppState {
    /// Connected clients: user_id -> sender
    pub clients: Arc<DashMap<Uuid, ClientSender>>,
    /// Valkey client for Streams (XADD)
    pub valkey: RedisClient,
    /// JWT secret for token validation
    pub jwt_secret: String,
}

impl AppState {
    pub async fn new(valkey_url: &str, jwt_secret: &str) -> Self {
        let config = RedisConfig::from_url(valkey_url).expect("Invalid Valkey URL");
        let valkey = Builder::from_config(config)
            .build()
            .expect("Failed to build Valkey client");

        valkey.init().await.expect("Failed to connect to Valkey");
        tracing::info!("Connected to Valkey");

        Self {
            clients: Arc::new(DashMap::new()),
            valkey,
            jwt_secret: jwt_secret.to_string(),
        }
    }

    /// Send a message to a specific connected client.
    pub fn send_to_client(&self, user_id: &Uuid, message: &str) {
        if let Some(sender) = self.clients.get(user_id) {
            let _ = sender.send(message.to_string());
        }
    }

    /// Broadcast a message to all connected clients.
    pub fn broadcast(&self, message: &str) {
        for entry in self.clients.iter() {
            let _ = entry.value().send(message.to_string());
        }
    }

    /// Broadcast to clients in a channel (by user IDs).
    pub fn broadcast_to(&self, user_ids: &[Uuid], message: &str) {
        for uid in user_ids {
            self.send_to_client(uid, message);
        }
    }
}
