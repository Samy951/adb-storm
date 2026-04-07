# STORM - Distributed Real-Time Messaging System

Backend haute-performance pour une messagerie temps reel type Slack/Discord.

Projet HETIC MT4 -- objectif : 100 000 connexions WebSocket simultanees, 500 000 messages/seconde, budget infra < 700 EUR.

## Architecture

```
                         +-------------------+
                         |    HAProxy :8080   |
                         |   (load balancer)  |
                         +---------+---------+
                                   |
                    +--------------+--------------+
                    |                              |
           +-------+--------+            +--------+-------+
           | Gateway (Rust) |            | Gateway (Rust) |
           |  Axum :3001    |            |  Axum :3001    |
           | WebSocket, JWT |            | WebSocket, JWT |
           +-------+--------+            +--------+-------+
                    |                              |
                    +--------------+--------------+
                                   |
                         +---------+---------+
                         |  Valkey (Redis)   |
                         | pub/sub + streams |
                         +---------+---------+
                              /          \
               +-------------+            +-------------+
               | Message Svc |            | Presence Svc|
               | Bun/TS :4001|            | Bun/TS :4002|
               +------+------+            +-------------+
                      |
               +------+------+
               | PostgreSQL  |
               |    :5432    |
               +-------------+
```

## Stack

| Composant | Technologie | Role |
|-----------|-------------|------|
| Gateway | Rust / Axum | WebSocket, authentification JWT, routage pub/sub via Valkey |
| Message Service | Bun / TypeScript | Persistence des messages dans PostgreSQL |
| Presence Service | Bun / TypeScript | Statut en ligne/hors ligne via Valkey TTL |
| Load Balancer | HAProxy 2.9 | Repartition de charge devant les gateways |
| Cache / Pub-Sub | Valkey 8 | Communication inter-services, streams, presence cache |
| Base de donnees | PostgreSQL 16 | Stockage persistant des messages, users, channels |
| Monitoring | Prometheus + Grafana | Metriques, dashboards, alertes |

## Quick Start

```bash
# Demarrer tous les services
cd infra && docker compose up -d

# Verifier que tout tourne
docker compose ps

# Endpoints disponibles
# - HAProxy (entrypoint):      http://localhost:8080
# - WebSocket Gateway:          ws://localhost:8080/ws?token=<JWT>
# - Message Service API:        http://localhost:4001
# - Presence Service API:       http://localhost:4002
# - Prometheus:                  http://localhost:9090
# - Grafana:                     http://localhost:3000  (admin / storm)
# - Web UI:                      http://localhost:8081
```

## Structure du Projet

```
adb_storm/
├── gateway/                    # Gateway Rust/Axum (WebSocket + JWT)
│   ├── src/
│   │   ├── main.rs            # Point d'entree, serveur HTTP
│   │   ├── auth.rs            # Validation JWT
│   │   ├── ws/
│   │   │   ├── handler.rs     # Gestion connexions WebSocket
│   │   │   └── messages.rs    # Types messages client/serveur
│   │   └── valkey/mod.rs      # Pub/sub, streams, broadcast
│   └── tests/integration.rs   # Tests d'integration WebSocket
├── services/
│   ├── message-service/       # Persistence messages (Bun/TS)
│   │   └── src/routes/        # auth, channels, members, messages
│   └── presence-service/      # Gestion presence (Bun/TS)
│       └── src/routes/        # heartbeat, offline, online members
├── infra/
│   ├── docker-compose.yml     # Orchestration locale
│   ├── haproxy/               # Config load balancer
│   ├── k8s/                   # Manifestes Kubernetes (AKS)
│   ├── prometheus/            # Config scraping metriques
│   └── grafana/               # Dashboards provisioning
├── migrations/                # Scripts SQL init PostgreSQL
├── tests/
│   ├── e2e/                   # Tests end-to-end (auth, channels, presence)
│   ├── load/                  # Tests de charge (k6, Locust)
│   └── chaos/                 # Scripts chaos engineering
└── docs/
    ├── api.md                 # Documentation API complete
    ├── slo.md                 # Service Level Objectives
    ├── runbooks/              # Procedures operationnelles
    └── postmortems/           # Analyses post-incident
```

## API Overview

### REST Endpoints (Message Service - :4001)

| Methode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/auth/register` | Non | Creer un compte |
| POST | `/auth/login` | Non | Se connecter |
| GET | `/channels` | Oui | Lister les channels |
| GET | `/channels/:id` | Oui | Detail d'un channel |
| POST | `/channels` | Oui | Creer un channel |
| DELETE | `/channels/:id` | Oui | Supprimer un channel (createur) |
| POST | `/channels/:id/join` | Oui | Rejoindre un channel public |
| GET | `/channels/:id/members` | Oui | Lister les membres |
| POST | `/channels/:id/members` | Oui | Ajouter un membre (admin) |
| DELETE | `/channels/:id/members/:userId` | Oui | Retirer un membre |
| GET | `/channels/:id/messages` | Oui | Historique des messages |

### REST Endpoints (Presence Service - :4002)

| Methode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/presence/heartbeat` | Oui | Signaler sa presence |
| POST | `/presence/offline` | Oui | Se marquer hors-ligne |
| GET | `/channels/:channelId/online` | Oui | Membres en ligne d'un channel |

### WebSocket Protocol (Gateway - :3001)

Connexion : `ws://host/ws?token=<JWT>`

**Client -> Serveur :**
- `send_message` : envoyer un message dans un channel
- `typing` : indicateur de frappe
- `ping` : heartbeat

**Serveur -> Client :**
- `new_message` : nouveau message dans un channel
- `user_typing` : un utilisateur tape dans un channel
- `pong` : reponse au ping
- `error` : erreur de traitement

Voir [docs/api.md](docs/api.md) pour la documentation complete.

## Tests

```bash
# Tests unitaires gateway (Rust)
cd gateway && cargo test

# Tests unitaires message-service
cd services/message-service && bun test

# Tests e2e (necessite docker compose up)
cd tests/e2e && bun test

# Tests de charge
cd tests/load && k6 run websocket.js
```

## Documentation

- [API Reference](docs/api.md)
- [SLO Definitions](docs/slo.md)
- [Deployment Runbook](docs/runbooks/deployment.md)
- [Incident Response](docs/runbooks/incident-response.md)
- [Monitoring Guide](docs/runbooks/monitoring.md)
- [Scaling Procedures](docs/runbooks/scaling.md)
- [Post-Mortems](docs/postmortems/)
