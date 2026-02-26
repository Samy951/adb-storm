#!/bin/bash
# Chaos test: kill a gateway instance and verify reconnection
set -e

echo "=== Chaos Test: Kill Gateway ==="
echo "Stopping gateway container..."
docker compose -f ../../infra/docker-compose.yml stop gateway

echo "Waiting 10s for clients to detect disconnect..."
sleep 10

echo "Restarting gateway..."
docker compose -f ../../infra/docker-compose.yml start gateway

echo "Waiting 10s for reconnection..."
sleep 10

echo "Checking gateway health..."
curl -sf http://localhost:8080/health && echo " -> Gateway is back!" || echo " -> Gateway NOT responding!"
