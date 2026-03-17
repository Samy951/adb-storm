# Scaling Runbook

## Scaling horizontal de la gateway

La gateway Rust est le composant critique : elle gere toutes les connexions WebSocket. Pour atteindre 100K connexions, il faut plusieurs instances.

### 1. Ajouter des instances gateway

Dans `infra/docker-compose.yml`, dupliquer le service gateway :

```yaml
gateway-1:
  build:
    context: ../gateway
  environment:
    PORT: "3001"
    VALKEY_URL: "redis://valkey:6379"
    JWT_SECRET: "${JWT_SECRET}"

gateway-2:
  build:
    context: ../gateway
  environment:
    PORT: "3001"
    VALKEY_URL: "redis://valkey:6379"
    JWT_SECRET: "${JWT_SECRET}"
```

Ou utiliser `docker compose up --scale gateway=3` (necessite de retirer le mapping de port fixe).

### 2. Mettre a jour HAProxy

Ajouter les nouveaux backends dans `infra/haproxy/haproxy.cfg` :

```
backend ws_back
    balance source
    option httpchk GET /health
    timeout tunnel 3600s
    timeout server 3600s
    cookie SERVERID insert indirect nocache

    server gateway-1 gateway-1:3001 check cookie gw1
    server gateway-2 gateway-2:3001 check cookie gw2
    server gateway-3 gateway-3:3001 check cookie gw3
```

`balance source` assure que les connexions d'un meme client vont au meme backend (sticky session par IP). Le cookie `SERVERID` ajoute une couche de sticky session HTTP.

Recharger HAProxy sans downtime :

```bash
docker compose kill -s HUP haproxy
```

### 3. Tuning systeme pour 100K connexions

Sur chaque noeud gateway, augmenter les limites :

```bash
# Limites fichiers ouverts
ulimit -n 200000

# Parametres sysctl
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.ipv4.ip_local_port_range="1024 65535"
sysctl -w net.core.netdev_max_backlog=65535
```

Dans Docker, ajouter au service :

```yaml
gateway:
  ulimits:
    nofile:
      soft: 200000
      hard: 200000
```

## Scaling de Valkey

### Tuning memoire

Valkey est configure avec 256MB par defaut (`--maxmemory 256mb`). Pour la production :

```bash
# Verifier l'utilisation memoire actuelle
docker compose exec valkey valkey-cli INFO memory | grep used_memory_human
```

Ajuster dans docker-compose :

```yaml
valkey:
  command: valkey-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
```

Politiques d'eviction recommandees :
- `allkeys-lru` : evicte les cles les moins recemment utilisees (recommande pour le cache)
- `volatile-lru` : evicte uniquement les cles avec TTL

### Monitoring des performances Valkey

```bash
# Statistiques en temps reel
docker compose exec valkey valkey-cli --stat

# Latence
docker compose exec valkey valkey-cli --latency

# Clients connectes
docker compose exec valkey valkey-cli CLIENT LIST

# Channels pub/sub actifs
docker compose exec valkey valkey-cli PUBSUB CHANNELS "*"
```

### Valkey en cluster (si besoin)

Pour depasser les limites d'une seule instance, passer en mode cluster avec 3+ noeuds. Cela necessite de modifier la configuration des clients dans chaque service.

## Scaling de PostgreSQL

### Connection pooling

Avec plusieurs instances de message-service, le nombre de connexions PostgreSQL peut exploser. Utiliser PgBouncer :

```yaml
pgbouncer:
  image: edoburu/pgbouncer:1.21.0
  environment:
    DATABASE_URL: "postgres://storm:storm_dev@postgres:5432/storm"
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 1000
    DEFAULT_POOL_SIZE: 50
  ports:
    - "6432:6432"
```

Pointer `DATABASE_URL` des services vers PgBouncer (`postgres://storm:storm_dev@pgbouncer:6432/storm`).

### Tuning PostgreSQL

Dans un fichier `postgresql.conf` custom :

```
# Connexions
max_connections = 200

# Memoire
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 4MB

# WAL
wal_buffers = 16MB
checkpoint_completion_target = 0.9

# Replication (pour un replica read-only)
wal_level = replica
max_wal_senders = 3
```

### Read replicas

Pour les requetes de lecture (historique messages), ajouter un replica :

```yaml
postgres-replica:
  image: postgres:16-alpine
  environment:
    POSTGRES_MASTER_HOST: postgres
    POSTGRES_REPLICATION_USER: replicator
```

## Scaling du message-service et presence-service

Ces services TypeScript/Bun sont stateless. Les scaler horizontalement :

```bash
docker compose up --scale message-service=3 --scale presence-service=2 -d
```

La coordination se fait via Valkey pub/sub, donc aucune configuration supplementaire n'est necessaire. Chaque instance s'abonne aux memes channels Valkey.

## Capacite estimee par composant

| Composant | 1 instance | Scaled |
|-----------|-----------|--------|
| Gateway | ~25K connexions WS | 4 instances = ~100K |
| Valkey | ~100K ops/sec | Cluster 3 noeuds = ~300K ops/sec |
| PostgreSQL | ~5K writes/sec | + PgBouncer + replica = ~15K writes/sec |
| Message Service | ~10K req/sec | 3 instances = ~30K req/sec |
| Presence Service | ~20K req/sec | 2 instances = ~40K req/sec |
