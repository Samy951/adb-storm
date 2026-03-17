# Monitoring Runbook

## Acces aux outils

| Outil | URL | Credentials |
|-------|-----|-------------|
| Grafana | http://localhost:3000 | admin / storm |
| Prometheus | http://localhost:9090 | - |
| HAProxy Stats | http://localhost:8404/stats | - |

## Dashboard Grafana

Le dashboard principal **STORM Overview** est provisionne automatiquement au demarrage. Il est accessible dans Grafana > Dashboards > STORM Overview.

Pour importer un dashboard manuellement :
1. Aller dans Grafana > Dashboards > Import
2. Uploader le fichier JSON depuis `infra/grafana/dashboards/`

## Metriques cles a surveiller

### Gateway (Rust/Axum)

| Metrique | Description | Seuil d'alerte |
|----------|-------------|-----------------|
| `ws_connections_active` | Connexions WebSocket ouvertes | > 80K (warning), > 95K (critical) |
| `ws_messages_total` | Messages routes par la gateway | Chute soudaine = probleme |
| `http_request_duration_seconds` | Latence des requetes HTTP | p99 > 100ms |
| `process_resident_memory_bytes` | Memoire RSS du process | > 1.5GB |

### Message Service

| Metrique | Description | Seuil d'alerte |
|----------|-------------|-----------------|
| `messages_persisted_total` | Messages ecrits en base | Chute = probleme persistence |
| `message_persist_duration_seconds` | Temps d'ecriture en base | p99 > 50ms |
| `db_connections_active` | Connexions PostgreSQL actives | > 80% du pool |
| `http_request_duration_seconds` | Latence des endpoints REST | p99 > 200ms |

### Presence Service

| Metrique | Description | Seuil d'alerte |
|----------|-------------|-----------------|
| `users_online_total` | Nombre d'utilisateurs en ligne | Informatif |
| `presence_update_duration_seconds` | Temps de mise a jour du statut | p99 > 20ms |
| `valkey_operations_total` | Operations Valkey | Chute = perte de connectivite |

### Infrastructure

| Metrique | Description | Seuil d'alerte |
|----------|-------------|-----------------|
| `up` | Target Prometheus joignable (1/0) | 0 = service down |
| Container CPU | `rate(container_cpu_usage_seconds_total[1m])` | > 80% sustained |
| Container memoire | `container_memory_usage_bytes` | > 80% de la limite |

## Requetes Prometheus utiles

### Etat general du systeme

```promql
# Tous les services up/down
up

# Services down
up == 0
```

### Performance gateway

```promql
# Connexions WebSocket actives
ws_connections_active

# Debit de messages par seconde (sur 5 min)
rate(ws_messages_total[5m])

# Latence p99 des requetes
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="gateway"}[5m]))
```

### Performance message-service

```promql
# Taux de messages persistes par seconde
rate(messages_persisted_total[5m])

# Latence p95 de persistence
histogram_quantile(0.95, rate(message_persist_duration_seconds_bucket[5m]))

# Erreurs de persistence
rate(messages_persist_errors_total[5m])
```

### Performance presence-service

```promql
# Utilisateurs en ligne
users_online_total

# Taux de mises a jour de presence
rate(presence_updates_total[5m])
```

### Valkey

```promql
# Operations Valkey par seconde
rate(valkey_operations_total[5m])

# Latence Valkey (si exposee)
histogram_quantile(0.99, rate(valkey_operation_duration_seconds_bucket[5m]))
```

### HAProxy

```promql
# Requetes par seconde via HAProxy
rate(haproxy_frontend_http_requests_total[5m])

# Taux d'erreurs 5xx
rate(haproxy_frontend_http_responses_total{code="5xx"}[5m])

# Backends actifs
haproxy_backend_active_servers
```

## Seuils d'alerte recommandes

Ces seuils correspondent aux SLOs du projet (100K connexions, 500K msg/sec) :

### Alertes critiques (P1) - notification immediate

```yaml
# Service down
- alert: ServiceDown
  expr: up == 0
  for: 30s

# Gateway saturee
- alert: GatewayConnectionsSaturated
  expr: ws_connections_active > 95000
  for: 1m

# Valkey OOM proche
- alert: ValkeyMemoryHigh
  expr: valkey_memory_used_bytes / valkey_memory_max_bytes > 0.9
  for: 2m

# PostgreSQL connexions saturees
- alert: PostgresConnectionsHigh
  expr: pg_stat_activity_count > 180  # max_connections = 200
  for: 1m
```

### Alertes warning (P2) - a traiter rapidement

```yaml
# Latence elevee
- alert: HighLatencyGateway
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="gateway"}[5m])) > 0.1
  for: 5m

# Taux d'erreur eleve
- alert: HighErrorRate
  expr: rate(http_requests_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05
  for: 5m

# Memoire container elevee
- alert: ContainerMemoryHigh
  expr: container_memory_usage_bytes / container_spec_memory_limit_bytes > 0.8
  for: 5m
```

## Debugging avec Prometheus

### Identifier un pic de latence

1. Aller sur Prometheus (`http://localhost:9090`)
2. Executer : `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[1m]))`
3. Regarder le graphe sur les dernieres heures pour trouver le moment du pic
4. Croiser avec les logs a cette periode :
   ```bash
   docker compose -f infra/docker-compose.yml logs --since="2024-01-15T14:00:00" --until="2024-01-15T14:30:00"
   ```

### Identifier un service lent

1. Comparer les latences de chaque service :
   ```promql
   histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
   ```
2. Le service avec la latence la plus haute est le bottleneck
3. Consulter le runbook correspondant (scaling.md ou incident-response.md)

### Verifier le debit du systeme

```promql
# Messages par seconde (objectif : 500K/s)
sum(rate(ws_messages_total[1m]))
```

Si le debit est sous l'objectif, verifier dans l'ordre :
1. Saturation CPU des gateways (`rate(process_cpu_seconds_total{job="gateway"}[1m])`)
2. Latence Valkey (goulot d'etranglement pub/sub)
3. Latence PostgreSQL (goulot d'etranglement persistence)
