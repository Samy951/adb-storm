# Incident Response Runbook

## Verification rapide de l'etat du systeme

```bash
# Etat de tous les services
docker compose -f infra/docker-compose.yml ps

# Health checks
curl -sf http://localhost:3001/health && echo "gateway OK" || echo "gateway DOWN"
curl -sf http://localhost:4001/health && echo "message-service OK" || echo "message-service DOWN"
curl -sf http://localhost:4002/health && echo "presence-service OK" || echo "presence-service DOWN"

# Verifier les logs recents pour des erreurs
docker compose -f infra/docker-compose.yml logs --tail=100 --since=5m 2>&1 | grep -i "error\|panic\|fatal"
```

## Incident : Gateway crash ou non-responsive

### Symptomes
- Les clients WebSocket se deconnectent massivement
- HAProxy health check echoue (visible dans les stats `http://localhost:8404/stats`)
- Metriques Prometheus : `up{job="gateway"} == 0`

### Diagnostic

```bash
# Verifier si le process tourne
docker compose -f infra/docker-compose.yml ps gateway

# Logs du crash
docker compose -f infra/docker-compose.yml logs --tail=200 gateway

# Utilisation memoire/CPU
docker stats --no-stream $(docker compose -f infra/docker-compose.yml ps -q gateway)
```

### Resolution

```bash
# Redemarrer la gateway
docker compose -f infra/docker-compose.yml restart gateway

# Si le restart echoue, rebuild et relancer
docker compose -f infra/docker-compose.yml up -d --build gateway
```

Si le crash est lie a un OOM (Out of Memory), augmenter la limite memoire :

```yaml
gateway:
  deploy:
    resources:
      limits:
        memory: 2G
```

Les clients WebSocket se reconnecteront automatiquement via HAProxy une fois la gateway up.

## Incident : Valkey memory pressure

### Symptomes
- Les operations Valkey ralentissent ou echouent
- Logs : `OOM command not allowed when used memory > maxmemory`
- Presence status non mis a jour
- Messages pub/sub perdus

### Diagnostic

```bash
# Utilisation memoire
docker compose -f infra/docker-compose.yml exec valkey valkey-cli INFO memory

# Nombre de cles
docker compose -f infra/docker-compose.yml exec valkey valkey-cli DBSIZE

# Top des cles les plus lourdes
docker compose -f infra/docker-compose.yml exec valkey valkey-cli --bigkeys

# Clients connectes
docker compose -f infra/docker-compose.yml exec valkey valkey-cli CLIENT LIST | wc -l
```

### Resolution

**Action immediate** : augmenter la memoire max :

```bash
docker compose -f infra/docker-compose.yml exec valkey valkey-cli CONFIG SET maxmemory 512mb
```

**Nettoyage des cles expirees** :

```bash
# Forcer le scan des cles expirees
docker compose -f infra/docker-compose.yml exec valkey valkey-cli DEBUG SLEEP 0

# Supprimer les cles de presence obsoletes (pattern)
docker compose -f infra/docker-compose.yml exec valkey valkey-cli --scan --pattern "presence:*" | head -20
```

**Long terme** : ajuster `maxmemory` dans docker-compose.yml et redeployer.

## Incident : PostgreSQL connection exhaustion

### Symptomes
- Le message-service retourne des erreurs 500
- Logs : `too many connections for role "storm"` ou `connection refused`
- Les messages ne sont plus persistes

### Diagnostic

```bash
# Nombre de connexions actives
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SELECT count(*) FROM pg_stat_activity;"

# Connexions par etat
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"

# Connexions max autorisees
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SHOW max_connections;"

# Requetes bloquees
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SELECT pid, state, query, age(clock_timestamp(), query_start) FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;"
```

### Resolution

**Action immediate** : terminer les connexions idle :

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '5 minutes';"
```

**Si ca ne suffit pas** : redemarrer le message-service (qui reinitialisera son pool de connexions) :

```bash
docker compose -f infra/docker-compose.yml restart message-service
```

**Long terme** : deployer PgBouncer en mode `transaction` (voir `scaling.md`).

## Incident : HAProxy ne route plus le trafic

### Symptomes
- Port 8080 ne repond pas ou retourne 503
- La page stats (8404) montre tous les backends en `DOWN`

### Diagnostic

```bash
# Verifier le process HAProxy
docker compose -f infra/docker-compose.yml ps haproxy

# Logs
docker compose -f infra/docker-compose.yml logs --tail=50 haproxy

# Verifier que les backends sont joignables depuis le reseau Docker
docker compose -f infra/docker-compose.yml exec haproxy wget -qO- http://gateway:3001/health
```

### Resolution

```bash
# Recharger la config HAProxy sans couper les connexions existantes
docker compose -f infra/docker-compose.yml kill -s HUP haproxy

# Si le container est mort
docker compose -f infra/docker-compose.yml up -d haproxy
```

## Incident : Latence elevee sur les messages

### Symptomes
- Les messages mettent plusieurs secondes a apparaitre
- Metriques : `message_processing_duration_seconds` en hausse

### Diagnostic

```bash
# Latence Valkey
docker compose -f infra/docker-compose.yml exec valkey valkey-cli --latency-history

# Slow queries PostgreSQL
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U storm -d storm -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;" 2>/dev/null || echo "pg_stat_statements non active"

# CPU/memoire de tous les containers
docker stats --no-stream
```

### Resolution

1. Si la latence vient de Valkey : verifier la memoire (voir section Valkey ci-dessus)
2. Si la latence vient de PostgreSQL : verifier les connexions et ajouter des index si necessaire
3. Si la latence vient du message-service : scaler horizontalement (`docker compose up --scale message-service=3`)

## Procedure de rollback

### Rollback d'un service specifique

```bash
# Identifier la version precedente
docker images <registry>/storm-gateway --format "{{.Tag}} {{.CreatedAt}}" | head -5

# Mettre a jour le tag dans docker-compose et redeployer
docker compose -f infra/docker-compose.yml up -d gateway
```

### Rollback complet

```bash
# Si les images sont taguees par commit
git log --oneline -5
PREVIOUS_TAG="<commit-sha-precedent>"

# Checkout et rebuild
git checkout $PREVIOUS_TAG
docker compose -f infra/docker-compose.yml up -d --build
```

### Rollback de la base de donnees

Les migrations sont additives. Si un rollback de schema est necessaire :

```bash
# Se connecter a PostgreSQL
docker compose -f infra/docker-compose.yml exec postgres psql -U storm -d storm

# Appliquer le script de rollback manuellement
# (les scripts de rollback doivent etre prepares a l'avance dans migrations/)
```

## Matrice de severite

| Severite | Criteres | Temps de reponse | Exemple |
|----------|----------|------------------|---------|
| P1 - Critique | Service completement down, aucun message ne passe | < 5 min | Gateway crash, Valkey OOM |
| P2 - Majeur | Degradation significative, > 50% des requetes echouent | < 15 min | PostgreSQL saturation |
| P3 - Mineur | Degradation legere, fonctionnalites secondaires impactees | < 1h | Presence status en retard |
| P4 - Faible | Impact negligeable, cosmetic | Prochain sprint | Dashboard Grafana casse |
