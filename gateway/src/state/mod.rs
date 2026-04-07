use dashmap::DashMap;
use fred::prelude::*;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Sender half to push messages to a connected WebSocket client.
pub type ClientSender = mpsc::Sender<String>;

/// Shared application state across all handlers and tasks.
#[derive(Clone)]
pub struct AppState {
    /// Connected clients: user_id -> sender
    pub clients: Arc<DashMap<Uuid, ClientSender>>,
    /// Local cache of channel membership: channel_id -> set of user_ids
    pub channel_members: Arc<DashMap<String, HashSet<Uuid>>>,
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
            channel_members: Arc::new(DashMap::new()),
            valkey,
            jwt_secret: jwt_secret.to_string(),
        }
    }

    /// Send a message to a specific connected client.
    /// Uses try_send (non-blocking): drops the message if the client's buffer is full.
    pub fn send_to_client(&self, user_id: &Uuid, message: &str) {
        if let Some(sender) = self.clients.get(user_id) {
            let _ = sender.try_send(message.to_string());
        }
    }

    /// Broadcast a message to all connected clients.
    pub fn broadcast(&self, message: &str) {
        for entry in self.clients.iter() {
            let _ = entry.value().try_send(message.to_string());
        }
    }

    /// Broadcast to clients in a channel (by user IDs).
    pub fn broadcast_to(&self, user_ids: &[Uuid], message: &str) {
        for uid in user_ids {
            self.send_to_client(uid, message);
        }
    }

    /// Get channel members from local cache, falling back to Valkey SMEMBERS.
    pub async fn get_channel_members(&self, channel_id: &str) -> Vec<Uuid> {
        // Check local cache first
        if let Some(members) = self.channel_members.get(channel_id) {
            return members.iter().copied().collect();
        }

        // Cache miss: load from Valkey
        let key = format!("channel:{}:members", channel_id);
        let members: Vec<String> = match self.valkey.smembers(&key).await {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(%channel_id, "Failed to load channel members from Valkey: {}", e);
                return Vec::new();
            }
        };

        let uuids: HashSet<Uuid> = members
            .iter()
            .filter_map(|s| s.parse::<Uuid>().ok())
            .collect();

        let result: Vec<Uuid> = uuids.iter().copied().collect();
        self.channel_members.insert(channel_id.to_string(), uuids);
        result
    }

    /// Invalidate the local cache for a specific channel.
    pub fn invalidate_channel_cache(&self, channel_id: &str) {
        self.channel_members.remove(channel_id);
    }

    /// Check if a user is a member of a channel (cache-aware).
    pub async fn is_channel_member(&self, channel_id: &str, user_id: &Uuid) -> bool {
        // Check local cache first
        if let Some(members) = self.channel_members.get(channel_id) {
            return members.contains(user_id);
        }

        // Cache miss: load from Valkey, then check
        let members = self.get_channel_members(channel_id).await;
        members.contains(user_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    /// Build a minimal AppState without a real Valkey connection.
    /// Only the `clients` map and `jwt_secret` are usable.
    fn test_state() -> AppState {
        // We need a RedisClient to satisfy the struct, but we won't call any
        // Valkey methods in these tests. Build one with a dummy config — it
        // won't be connected, which is fine for client-map tests.
        let config = RedisConfig::from_url("redis://127.0.0.1:6379").unwrap();
        let valkey = Builder::from_config(config).build().unwrap();
        AppState {
            clients: Arc::new(DashMap::new()),
            channel_members: Arc::new(DashMap::new()),
            valkey,
            jwt_secret: "test-secret".to_string(),
        }
    }

    #[test]
    fn send_to_unknown_user_does_not_panic() {
        let state = test_state();
        let unknown_id = Uuid::new_v4();
        // Should silently do nothing
        state.send_to_client(&unknown_id, "hello");
    }

    #[test]
    fn send_to_client_delivers_message() {
        let state = test_state();
        let user_id = Uuid::new_v4();
        let (tx, mut rx) = mpsc::channel::<String>(256);

        state.clients.insert(user_id, tx);
        state.send_to_client(&user_id, "test message");

        let received = rx.try_recv().unwrap();
        assert_eq!(received, "test message");
    }

    #[test]
    fn broadcast_sends_to_all_clients() {
        let state = test_state();

        let uid1 = Uuid::new_v4();
        let uid2 = Uuid::new_v4();
        let uid3 = Uuid::new_v4();

        let (tx1, mut rx1) = mpsc::channel::<String>(256);
        let (tx2, mut rx2) = mpsc::channel::<String>(256);
        let (tx3, mut rx3) = mpsc::channel::<String>(256);

        state.clients.insert(uid1, tx1);
        state.clients.insert(uid2, tx2);
        state.clients.insert(uid3, tx3);

        state.broadcast("broadcast msg");

        assert_eq!(rx1.try_recv().unwrap(), "broadcast msg");
        assert_eq!(rx2.try_recv().unwrap(), "broadcast msg");
        assert_eq!(rx3.try_recv().unwrap(), "broadcast msg");
    }

    #[test]
    fn broadcast_to_sends_only_to_specified_users() {
        let state = test_state();

        let uid1 = Uuid::new_v4();
        let uid2 = Uuid::new_v4();
        let uid3 = Uuid::new_v4();

        let (tx1, mut rx1) = mpsc::channel::<String>(256);
        let (tx2, mut rx2) = mpsc::channel::<String>(256);
        let (tx3, mut rx3) = mpsc::channel::<String>(256);

        state.clients.insert(uid1, tx1);
        state.clients.insert(uid2, tx2);
        state.clients.insert(uid3, tx3);

        // Only send to uid1 and uid3
        state.broadcast_to(&[uid1, uid3], "targeted msg");

        assert_eq!(rx1.try_recv().unwrap(), "targeted msg");
        assert!(rx2.try_recv().is_err()); // uid2 should not receive
        assert_eq!(rx3.try_recv().unwrap(), "targeted msg");
    }

    #[test]
    fn broadcast_to_with_unknown_ids_does_not_panic() {
        let state = test_state();
        let unknown = Uuid::new_v4();
        state.broadcast_to(&[unknown], "msg");
        // No panic = success
    }

    #[test]
    fn broadcast_to_empty_list_does_nothing() {
        let state = test_state();
        state.broadcast_to(&[], "msg");
    }

    #[test]
    fn send_to_client_with_dropped_receiver_does_not_panic() {
        let state = test_state();
        let user_id = Uuid::new_v4();
        let (tx, rx) = mpsc::channel::<String>(256);

        state.clients.insert(user_id, tx);
        drop(rx); // simulate disconnected client

        // Should not panic even though receiver is gone
        state.send_to_client(&user_id, "message after disconnect");
    }

    #[test]
    fn invalidate_channel_cache_removes_entry() {
        let state = test_state();
        let channel_id = "test-channel-1";
        let uid = Uuid::new_v4();

        let mut members = HashSet::new();
        members.insert(uid);
        state
            .channel_members
            .insert(channel_id.to_string(), members);

        assert!(state.channel_members.contains_key(channel_id));
        state.invalidate_channel_cache(channel_id);
        assert!(!state.channel_members.contains_key(channel_id));
    }

    #[test]
    fn invalidate_nonexistent_channel_does_not_panic() {
        let state = test_state();
        state.invalidate_channel_cache("nonexistent");
    }

    #[test]
    fn channel_members_cache_populated_manually() {
        let state = test_state();
        let channel_id = "chan-123";
        let uid1 = Uuid::new_v4();
        let uid2 = Uuid::new_v4();

        let mut members = HashSet::new();
        members.insert(uid1);
        members.insert(uid2);
        state
            .channel_members
            .insert(channel_id.to_string(), members);

        let cached = state.channel_members.get(channel_id).unwrap();
        assert!(cached.contains(&uid1));
        assert!(cached.contains(&uid2));
        assert_eq!(cached.len(), 2);
    }

    #[test]
    fn broadcast_to_channel_members_only() {
        let state = test_state();
        let channel_id = "chan-456";

        let uid1 = Uuid::new_v4();
        let uid2 = Uuid::new_v4();
        let uid3 = Uuid::new_v4();

        let (tx1, mut rx1) = mpsc::channel::<String>(256);
        let (tx2, mut rx2) = mpsc::channel::<String>(256);
        let (tx3, mut rx3) = mpsc::channel::<String>(256);

        state.clients.insert(uid1, tx1);
        state.clients.insert(uid2, tx2);
        state.clients.insert(uid3, tx3);

        // Only uid1 and uid3 are members of the channel
        let mut members = HashSet::new();
        members.insert(uid1);
        members.insert(uid3);
        state
            .channel_members
            .insert(channel_id.to_string(), members);

        let cached = state.channel_members.get(channel_id).unwrap();
        let member_list: Vec<Uuid> = cached.iter().copied().collect();
        state.broadcast_to(&member_list, "channel msg");

        assert_eq!(rx1.try_recv().unwrap(), "channel msg");
        assert!(rx2.try_recv().is_err()); // uid2 not a member
        assert_eq!(rx3.try_recv().unwrap(), "channel msg");
    }
}
