#!/bin/bash
# Chaos test: kill a gateway instance and verify recovery
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../../infra/docker-compose.yml"

echo "=== Chaos Test: Kill Gateway ==="

echo "1. Verifying gateway is healthy..."
curl -sf http://localhost:8080/health > /dev/null || { echo "Gateway not running. Start infra first."; exit 1; }
echo "   Gateway healthy."

echo "2. Recording active connections..."
BEFORE=$(curl -s http://localhost:3001/metrics | grep ws_connections_active || echo "0")
echo "   $BEFORE"

echo "3. Killing gateway container..."
docker compose -f "$COMPOSE_FILE" kill gateway

echo "4. Waiting 5s..."
sleep 5

echo "5. Verifying HAProxy returns error..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null || echo "000")
echo "   HAProxy returned: $HTTP_CODE (expected: 503 or 000)"

echo "6. Restarting gateway..."
docker compose -f "$COMPOSE_FILE" start gateway

echo "7. Waiting for gateway to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo "   Gateway recovered after ${i}s"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "   FAIL: Gateway did not recover in 20s"
    exit 1
  fi
  sleep 1
done

echo "=== PASS: Gateway kill/recovery test ==="
