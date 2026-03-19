use dashmap::DashMap;
use fred::prelude::*;
use futures_util::{SinkExt, StreamExt};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use storm_gateway::build_router;
use storm_gateway::state::AppState;

const TEST_SECRET: &str = "integration-test-secret";

#[derive(Serialize)]
struct Claims {
    sub: Uuid,
    username: String,
    exp: usize,
}

fn make_token(user_id: Uuid) -> String {
    let claims = Claims {
        sub: user_id,
        username: "testuser".to_string(),
        exp: (chrono::Utc::now().timestamp() as usize) + 3600,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap()
}

fn test_state() -> AppState {
    let config = RedisConfig::from_url("redis://127.0.0.1:6379").unwrap();
    let valkey = Builder::from_config(config).build().unwrap();
    AppState {
        clients: Arc::new(DashMap::new()),
        valkey,
        jwt_secret: TEST_SECRET.to_string(),
    }
}

/// Start a test server on a random port and return the address.
async fn start_server() -> SocketAddr {
    let state = test_state();
    let app = build_router(state);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

// --- HTTP Tests ---

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let addr = start_server().await;
    let resp = reqwest::get(format!("http://{}/health", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "OK");
}

// --- WebSocket Tests ---

#[tokio::test]
async fn ws_connect_with_valid_token() {
    let addr = start_server().await;
    let user_id = Uuid::new_v4();
    let token = make_token(user_id);

    let url = format!("ws://{}/ws?token={}", addr, token);
    let (ws_stream, response) = connect_async(&url).await.unwrap();
    assert_eq!(response.status(), 101);
    drop(ws_stream);
}

#[tokio::test]
async fn ws_reject_without_token() {
    let addr = start_server().await;
    let url = format!("ws://{}/ws", addr);
    // Should fail — missing token query param
    let result = connect_async(&url).await;
    assert!(
        result.is_err() || {
            let (_, resp) = result.unwrap();
            resp.status() != 101
        }
    );
}

#[tokio::test]
async fn ws_reject_invalid_token() {
    let addr = start_server().await;
    let url = format!("ws://{}/ws?token=garbage", addr);
    let result = connect_async(&url).await;
    assert!(
        result.is_err() || {
            let (_, resp) = result.unwrap();
            resp.status() != 101
        }
    );
}

#[tokio::test]
async fn ws_ping_pong() {
    let addr = start_server().await;
    let token = make_token(Uuid::new_v4());
    let url = format!("ws://{}/ws?token={}", addr, token);

    let (mut ws, _) = connect_async(&url).await.unwrap();

    // Send ping
    ws.send(Message::Text(r#"{"type":"ping"}"#.into()))
        .await
        .unwrap();

    // Should receive pong
    let msg = ws.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["type"], "pong");
}

#[tokio::test]
async fn ws_invalid_message_returns_error() {
    let addr = start_server().await;
    let token = make_token(Uuid::new_v4());
    let url = format!("ws://{}/ws?token={}", addr, token);

    let (mut ws, _) = connect_async(&url).await.unwrap();

    // Send garbage
    ws.send(Message::Text("not json".into())).await.unwrap();

    // Should receive error message
    let msg = ws.next().await.unwrap().unwrap();
    let text = msg.into_text().unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["type"], "error");
    assert!(parsed["message"].as_str().unwrap().contains("Invalid"));
}

#[tokio::test]
async fn ws_disconnect_cleanup() {
    let addr = start_server().await;
    let token = make_token(Uuid::new_v4());
    let url = format!("ws://{}/ws?token={}", addr, token);

    let (ws, _) = connect_async(&url).await.unwrap();
    // Dropping the connection should not crash the server
    drop(ws);

    // Server still responds
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let resp = reqwest::get(format!("http://{}/health", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}
