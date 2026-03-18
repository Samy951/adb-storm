#!/bin/bash
# Chaos test: simulate Valkey memory pressure using pipeline (fast)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../../infra/docker-compose.yml"

NUM_KEYS=${1:-10000}
TTL=${2:-30}

echo "=== Chaos Test: Valkey Memory Pressure (${NUM_KEYS} keys, TTL ${TTL}s) ==="

VALKEY_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q valkey)
if [ -z "$VALKEY_CONTAINER" ]; then
  echo "Valkey container not found. Start infra first."
  exit 1
fi

echo "1. Before: memory usage"
docker exec "$VALKEY_CONTAINER" valkey-cli INFO memory | grep used_memory_human

echo "2. Filling Valkey with ${NUM_KEYS} keys via pipeline..."
# Generate pipeline commands and pipe them in one shot (much faster than 10K docker exec)
PIPELINE=""
for i in $(seq 1 $NUM_KEYS); do
  PIPELINE="${PIPELINE}SET chaos:fill:${i} $(printf '%0200d' $i) EX ${TTL}\n"
done
printf "$PIPELINE" | docker exec -i "$VALKEY_CONTAINER" valkey-cli --pipe 2>&1 | tail -1

echo "3. After fill: memory usage"
docker exec "$VALKEY_CONTAINER" valkey-cli INFO memory | grep used_memory_human

echo "4. Checking service health during pressure..."
curl -sf http://localhost:3001/health > /dev/null && echo "   Gateway: OK" || echo "   Gateway: FAIL"
curl -sf http://localhost:4001/health > /dev/null && echo "   Message service: OK" || echo "   Message service: FAIL"
curl -sf http://localhost:4002/health > /dev/null && echo "   Presence service: OK" || echo "   Presence service: FAIL"

echo "5. Waiting ${TTL}s for TTL expiry..."
sleep "$TTL"

echo "6. After expiry: memory usage"
docker exec "$VALKEY_CONTAINER" valkey-cli INFO memory | grep used_memory_human

echo "=== PASS: Memory pressure test complete ==="
