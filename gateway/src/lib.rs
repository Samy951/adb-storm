pub mod auth;
pub mod state;
pub mod valkey;
pub mod ws;

use axum::{routing::get, Router};
use tower_http::cors::CorsLayer;

use crate::state::AppState;

/// Build the Axum router with all routes. Used by main and integration tests.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/ws", get(ws::handler::ws_upgrade))
        .route("/health", get(|| async { "OK" }))
        .layer(CorsLayer::permissive())
        .with_state(state)
}
