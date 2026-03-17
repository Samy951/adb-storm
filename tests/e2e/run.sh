#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.test.yml"

cleanup() {
  echo "Cleaning up test infra..."
  docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
  # Kill background service processes
  [ -n "${MSG_PID:-}" ] && kill "$MSG_PID" 2>/dev/null || true
  [ -n "${PRESENCE_PID:-}" ] && kill "$PRESENCE_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting test infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "Starting message-service..."
DATABASE_URL="postgres://storm:storm_test@localhost:5499/storm_test" \
VALKEY_URL="redis://localhost:6399" \
JWT_SECRET="test-e2e-secret" \
PORT=4011 \
  bun run "$ROOT_DIR/services/message-service/index.ts" &
MSG_PID=$!

echo "Starting presence-service..."
VALKEY_URL="redis://localhost:6399" \
JWT_SECRET="test-e2e-secret" \
PORT=4012 \
  bun run "$ROOT_DIR/services/presence-service/index.ts" &
PRESENCE_PID=$!

# Wait for services to be ready
echo "Waiting for services..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:4011/health > /dev/null 2>&1 && \
     curl -sf http://localhost:4012/health > /dev/null 2>&1; then
    echo "Services ready."
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "Services failed to start"
    exit 1
  fi
  sleep 0.5
done

echo "Running e2e tests..."
E2E_MESSAGE_URL="http://localhost:4011" \
E2E_PRESENCE_URL="http://localhost:4012" \
E2E_JWT_SECRET="test-e2e-secret" \
  bun test "$SCRIPT_DIR" --timeout 10000

echo "All e2e tests passed."
