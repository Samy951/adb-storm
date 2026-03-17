# Deployment Runbook

## Prerequisites

- Docker >= 24.0 and Docker Compose V2
- Rust toolchain (pour le dev local gateway)
- Bun >= 1.3 (pour le dev local des services TS)
- Ports disponibles : 3000, 3001, 4001, 4002, 5432, 6379, 8080, 8404, 9090

## Deploiement local (Docker Compose)

### 1. Lancer toute la stack

```bash
cd infra
docker compose up -d
```

Cela demarre dans l'ordre : Valkey, PostgreSQL, gateway, message-service, presence-service, HAProxy, Prometheus, Grafana.

### 2. Verifier que tout tourne

```bash
docker compose ps
```

Tous les services doivent etre en etat `running` ou `healthy`.

### 3. Health checks manuels

```bash
# Gateway
curl -s http://localhost:3001/health

# Message service
curl -s http://localhost:4001/health

# Presence service
curl -s http://localhost:4002/health

# HAProxy (via le load balancer)
curl -s http://localhost:8080/health

# HAProxy stats
curl -s http://localhost:8404/stats
```

### 4. Arreter la stack

```bash
cd infra
docker compose down
```

Pour supprimer aussi les volumes (reset complet) :

```bash
docker compose down -v
```

## Deploiement en production

### 1. Build des images

```bash
docker compose -f infra/docker-compose.yml build
```

Ou build individuel :

```bash
docker build -t storm-gateway:latest gateway/
docker build -t storm-message-service:latest services/message-service/
docker build -t storm-presence-service:latest services/presence-service/
```

### 2. Pousser les images vers un registre

```bash
docker tag storm-gateway:latest <registry>/storm-gateway:<version>
docker push <registry>/storm-gateway:<version>
```

Repeter pour chaque service.

### 3. Deployer sur le serveur

Mettre a jour le tag d'image dans le fichier compose de production, puis :

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### 4. Migration de la base

Les migrations SQL dans `migrations/` sont executees automatiquement au demarrage de PostgreSQL via `docker-entrypoint-initdb.d`. Pour une base existante, appliquer manuellement :

```bash
docker compose exec postgres psql -U storm -d storm -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

## Variables d'environnement

| Variable | Service | Description | Exemple |
|----------|---------|-------------|---------|
| `PORT` | Tous | Port d'ecoute du service | `3001` |
| `VALKEY_URL` | Tous | URL de connexion Valkey | `redis://valkey:6379` |
| `DATABASE_URL` | message-service | URL PostgreSQL | `postgres://storm:pwd@postgres:5432/storm` |
| `JWT_SECRET` | Tous | Secret pour la verification des tokens JWT | (chaine aleatoire 64+ chars) |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana | Mot de passe admin Grafana | `storm` |

**Important** : en production, `JWT_SECRET` doit etre un secret genere aleatoirement (min 64 caracteres) et partage entre tous les services via un gestionnaire de secrets (Vault, AWS Secrets Manager, etc.).

## Verification post-deploiement

1. Verifier les health checks (voir section ci-dessus)
2. Ouvrir Grafana sur `http://<host>:3000` et verifier que les metriques remontent
3. Tester une connexion WebSocket :

```bash
websocat ws://localhost:8080/ws
```

4. Verifier les logs pour des erreurs :

```bash
docker compose logs -f --tail=50
```
