#!/bin/bash
# Chaos test: inject network latency on Valkey
set -e

LATENCY_MS=${1:-200}
DURATION=${2:-30}

echo "=== Chaos Test: Inject ${LATENCY_MS}ms latency on Valkey for ${DURATION}s ==="

VALKEY_CONTAINER=$(docker compose -f ../../infra/docker-compose.yml ps -q valkey)

echo "Adding ${LATENCY_MS}ms latency..."
docker exec "$VALKEY_CONTAINER" tc qdisc add dev eth0 root netem delay ${LATENCY_MS}ms 2>/dev/null || \
docker exec "$VALKEY_CONTAINER" tc qdisc change dev eth0 root netem delay ${LATENCY_MS}ms

echo "Latency injected. Waiting ${DURATION}s..."
sleep "$DURATION"

echo "Removing latency..."
docker exec "$VALKEY_CONTAINER" tc qdisc del dev eth0 root 2>/dev/null || true

echo "Done. Latency removed."
