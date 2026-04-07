use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use metrics::{counter, gauge};
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::auth::validate_token;
use crate::state::AppState;
use crate::valkey;
use crate::ws::messages::{ClientMessage, ServerMessage};

#[derive(Deserialize)]
pub struct WsQuery {
    token: String,
}

/// HTTP upgrade handler: validates JWT then upgrades to WebSocket.
pub async fn ws_upgrade(
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    // Validate JWT before upgrading
    match validate_token(&query.token, &state.jwt_secret) {
        Ok(user_id) => {
            tracing::info!(%user_id, "WebSocket upgrade accepted");
            ws.on_upgrade(move |socket| handle_socket(socket, state, user_id))
        }
        Err(e) => {
            tracing::warn!("WebSocket upgrade rejected: {}", e);
            // Return 401 - axum will not upgrade
            axum::http::StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

/// Handle an established WebSocket connection.
async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Bounded channel: backpressure — drop slow clients instead of OOM
    let (tx, mut rx) = mpsc::channel::<String>(256);

    // Register client
    state.clients.insert(user_id, tx);
    gauge!("ws_connections_active").set(state.clients.len() as f64);
    counter!("ws_connections_total").increment(1);
    tracing::info!(%user_id, connections = state.clients.len(), "Client connected");

    // Task: forward messages from channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                counter!("ws_messages_received").increment(1);
                handle_client_message(&state, &user_id, &text).await;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup
    state.clients.remove(&user_id);
    gauge!("ws_connections_active").set(state.clients.len() as f64);
    send_task.abort();
    tracing::info!(%user_id, connections = state.clients.len(), "Client disconnected");
}

/// Parse and process a client message.
async fn handle_client_message(state: &AppState, user_id: &Uuid, raw: &str) {
    let msg: ClientMessage = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(%user_id, "Invalid message: {}", e);
            let err = ServerMessage::Error {
                message: "Invalid message format".to_string(),
            };
            state.send_to_client(user_id, &serde_json::to_string(&err).unwrap());
            return;
        }
    };

    match msg {
        ClientMessage::SendMessage {
            channel_id,
            content,
        } => {
            let cid = channel_id.to_string();

            // Verify user is a member of the channel before publishing
            if !state.is_channel_member(&cid, user_id).await {
                tracing::warn!(%user_id, %channel_id, "Rejected message: user not a channel member");
                let err = ServerMessage::Error {
                    message: "You are not a member of this channel".to_string(),
                };
                state.send_to_client(user_id, &serde_json::to_string(&err).unwrap());
                return;
            }

            // Publish to Valkey Streams for processing by message-service
            if let Err(e) = valkey::publish_message(state, user_id, &channel_id, &content).await {
                tracing::error!("Failed to publish message: {}", e);
            }
        }
        ClientMessage::Typing { channel_id } => {
            let cid = channel_id.to_string();

            // Only allow typing indicator if user is a channel member
            if !state.is_channel_member(&cid, user_id).await {
                return;
            }

            // Publish typing event via Valkey Pub/Sub
            if let Err(e) = valkey::publish_typing(state, user_id, &channel_id).await {
                tracing::error!("Failed to publish typing: {}", e);
            }
        }
        ClientMessage::Ping => {
            let pong = serde_json::to_string(&ServerMessage::Pong).unwrap();
            state.send_to_client(user_id, &pong);
        }
    }
}
