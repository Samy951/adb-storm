# Service Level Objectives (SLO)

## WebSocket Gateway

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Disponibilité | 99.9% (43s downtime max par Storm Day) | Health check HAProxy |
| Latence connexion WS | p95 < 50ms | `ws_connecting` k6 |
| Latence messages | p95 < 100ms (envoi → réception client) | `ws_message_latency` k6 |
| Connexions simultanées | 100 000 | `ws_connections_active` Prometheus |
| Taux d'erreur connexion | < 1% | `ws_connection_errors` k6 |

## Message Service

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Throughput | 500 000 msg/s traités | `messages_processed_total` Prometheus |
| Latence traitement | p95 < 50ms (stream → DB → broadcast) | `message_processing_duration_seconds` Prometheus |
| Disponibilité API | 99.9% | Health check |
| Taux d'erreur | < 0.1% des messages perdus | Comparaison messages envoyés vs persistés |

## Presence Service

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Latence heartbeat | p95 < 20ms | Mesure directe |
| Précision online | TTL 30s max de décalage | Valkey TTL |
| Disponibilité | 99.9% | Health check |

## Infrastructure

| Composant | Métrique | Objectif |
|-----------|----------|----------|
| HAProxy | Taux d'erreur 5xx | < 0.1% |
| Valkey | Mémoire utilisée | < 80% du max (256MB) |
| PostgreSQL | Connexions actives | < 80% du pool (20) |
| Valkey | Latence commandes | p99 < 10ms |

## Alertes recommandées (Prometheus)

```promql
# Gateway : connexions qui chutent brutalement
delta(ws_connections_active[1m]) < -1000

# Message service : latence en hausse
histogram_quantile(0.95, rate(message_processing_duration_seconds_bucket[5m])) > 0.05

# Valkey : mémoire critique
redis_memory_used_bytes / redis_memory_max_bytes > 0.8

# PostgreSQL : connexions saturées
pg_stat_activity_count > 16
```
