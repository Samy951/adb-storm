#!/bin/bash
# Chaos test: simulate Valkey memory pressure
set -e

DURATION=${1:-30}

echo "=== Chaos Test: Valkey Memory Pressure for ${DURATION}s ==="

VALKEY_CONTAINER=$(docker compose -f ../../infra/docker-compose.yml ps -q valkey)

echo "Filling Valkey with temporary data..."
for i in $(seq 1 10000); do
  docker exec "$VALKEY_CONTAINER" valkey-cli SET "chaos:fill:$i" "$(head -c 1024 /dev/urandom | base64)" EX "$DURATION" > /dev/null 2>&1
done

echo "Memory filled. Check metrics for impact."
echo "Waiting ${DURATION}s for TTL expiry..."
sleep "$DURATION"

echo "Chaos data expired. Valkey should recover."
docker exec "$VALKEY_CONTAINER" valkey-cli INFO memory | grep used_memory_human
