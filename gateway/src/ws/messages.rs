use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Incoming message from a WebSocket client.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "send_message")]
    SendMessage { channel_id: Uuid, content: String },
    #[serde(rename = "typing")]
    Typing { channel_id: Uuid },
    #[serde(rename = "ping")]
    Ping,
}

/// Outgoing message to a WebSocket client.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
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
    UserTyping { channel_id: Uuid, user_id: Uuid },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "error")]
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- ClientMessage deserialization ---

    #[test]
    fn deserialize_send_message() {
        let json = r#"{"type":"send_message","channel_id":"550e8400-e29b-41d4-a716-446655440000","content":"hello world"}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::SendMessage {
                channel_id,
                content,
            } => {
                assert_eq!(
                    channel_id.to_string(),
                    "550e8400-e29b-41d4-a716-446655440000"
                );
                assert_eq!(content, "hello world");
            }
            _ => panic!("Expected SendMessage variant"),
        }
    }

    #[test]
    fn deserialize_typing() {
        let json = r#"{"type":"typing","channel_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::Typing { channel_id } => {
                assert_eq!(
                    channel_id.to_string(),
                    "550e8400-e29b-41d4-a716-446655440000"
                );
            }
            _ => panic!("Expected Typing variant"),
        }
    }

    #[test]
    fn deserialize_ping() {
        let json = r#"{"type":"ping"}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMessage::Ping));
    }

    #[test]
    fn reject_invalid_json() {
        let result = serde_json::from_str::<ClientMessage>("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn reject_missing_type_field() {
        let json = r#"{"channel_id":"550e8400-e29b-41d4-a716-446655440000","content":"hello"}"#;
        let result = serde_json::from_str::<ClientMessage>(json);
        assert!(result.is_err());
    }

    #[test]
    fn reject_unknown_type() {
        let json = r#"{"type":"unknown_type","data":"test"}"#;
        let result = serde_json::from_str::<ClientMessage>(json);
        assert!(result.is_err());
    }

    #[test]
    fn reject_send_message_missing_content() {
        let json = r#"{"type":"send_message","channel_id":"550e8400-e29b-41d4-a716-446655440000"}"#;
        let result = serde_json::from_str::<ClientMessage>(json);
        assert!(result.is_err());
    }

    #[test]
    fn reject_send_message_invalid_uuid() {
        let json = r#"{"type":"send_message","channel_id":"not-a-uuid","content":"hello"}"#;
        let result = serde_json::from_str::<ClientMessage>(json);
        assert!(result.is_err());
    }

    // --- ServerMessage serialization ---

    #[test]
    fn serialize_new_message() {
        let msg = ServerMessage::NewMessage {
            id: "msg-1".to_string(),
            channel_id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            user_id: Uuid::parse_str("660e8400-e29b-41d4-a716-446655440000").unwrap(),
            content: "hello".to_string(),
            created_at: "2026-03-17T00:00:00Z".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["type"], "new_message");
        assert_eq!(json["id"], "msg-1");
        assert_eq!(json["content"], "hello");
        assert_eq!(json["channel_id"], "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(json["user_id"], "660e8400-e29b-41d4-a716-446655440000");
        assert_eq!(json["created_at"], "2026-03-17T00:00:00Z");
    }

    #[test]
    fn serialize_user_typing() {
        let msg = ServerMessage::UserTyping {
            channel_id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            user_id: Uuid::parse_str("660e8400-e29b-41d4-a716-446655440000").unwrap(),
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["type"], "user_typing");
        assert_eq!(json["channel_id"], "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(json["user_id"], "660e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn serialize_pong() {
        let msg = ServerMessage::Pong;
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["type"], "pong");
    }

    #[test]
    fn serialize_error() {
        let msg = ServerMessage::Error {
            message: "something went wrong".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["type"], "error");
        assert_eq!(json["message"], "something went wrong");
    }

    #[test]
    fn serialize_pong_is_valid_json_string() {
        let msg = ServerMessage::Pong;
        let s = serde_json::to_string(&msg).unwrap();
        // Should round-trip as valid JSON
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "pong");
    }
}
