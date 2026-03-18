#!/bin/bash
# Chaos test: inject network latency on Valkey using tc
# Requires: Valkey container must have NET_ADMIN capability
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../../infra/docker-compose.yml"

LATENCY_MS=${1:-200}
DURATION=${2:-30}

echo "=== Chaos Test: Inject ${LATENCY_MS}ms latency on Valkey for ${DURATION}s ==="

VALKEY_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q valkey)
if [ -z "$VALKEY_CONTAINER" ]; then
  echo "Valkey container not found. Start infra first."
  exit 1
fi

echo "1. Baseline: checking Valkey response time..."
BASELINE=$(docker exec "$VALKEY_CONTAINER" valkey-cli --latency -c 5 2>&1 | tail -1)
echo "   $BASELINE"

echo "2. Adding ${LATENCY_MS}ms latency..."
docker exec "$VALKEY_CONTAINER" tc qdisc add dev eth0 root netem delay ${LATENCY_MS}ms 2>/dev/null || \
docker exec "$VALKEY_CONTAINER" tc qdisc change dev eth0 root netem delay ${LATENCY_MS}ms 2>/dev/null || {
  echo "   WARN: tc not available (missing NET_ADMIN cap). Using Valkey DEBUG SLEEP instead."
  echo "   Simulating slow commands for ${DURATION}s..."
  for i in $(seq 1 $DURATION); do
    docker exec "$VALKEY_CONTAINER" valkey-cli DEBUG SLEEP 0.${LATENCY_MS} > /dev/null 2>&1 &
    sleep 1
  done
  echo "=== Latency simulation complete ==="
  exit 0
}

echo "3. Latency injected. Waiting ${DURATION}s..."
echo "   Monitor: curl http://localhost:3001/metrics | grep latency"
sleep "$DURATION"

echo "4. Removing latency..."
docker exec "$VALKEY_CONTAINER" tc qdisc del dev eth0 root 2>/dev/null || true

echo "5. Post-test: checking Valkey response time..."
POST=$(docker exec "$VALKEY_CONTAINER" valkey-cli --latency -c 5 2>&1 | tail -1)
echo "   $POST"

echo "=== PASS: Latency injection test complete ==="
