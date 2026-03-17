mod auth;
mod state;
mod valkey;
mod ws;

use axum::{routing::get, Router};
use metrics_exporter_prometheus::PrometheusBuilder;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse()
        .expect("PORT must be a number");

    let valkey_url =
        std::env::var("VALKEY_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let jwt_secret =
        std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string());

    // Setup Prometheus metrics recorder
    let prometheus_handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("Failed to install Prometheus recorder");
    let prometheus_handle = Arc::new(prometheus_handle);

    let state = AppState::new(&valkey_url, &jwt_secret).await;

    // Spawn Pub/Sub listener
    let pubsub_state = state.clone();
    tokio::spawn(async move {
        valkey::pubsub_listener(pubsub_state).await;
    });

    let metrics_handle = prometheus_handle.clone();
    let app = Router::new()
        .route("/ws", get(ws::handler::ws_upgrade))
        .route("/health", get(|| async { "OK" }))
        .route(
            "/metrics",
            get(move || {
                let h = metrics_handle.clone();
                async move { h.render() }
            }),
        )
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Gateway listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
