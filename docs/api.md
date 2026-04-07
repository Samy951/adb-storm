# API Reference

## Authentication

Tous les endpoints marques **Auth: required** necessitent un header `Authorization: Bearer <JWT>`.

Le JWT est obtenu via `/auth/register` ou `/auth/login`. Il contient :
- `sub` : UUID de l'utilisateur
- `username` : nom d'utilisateur
- `exp` : expiration (24h)

---

## Message Service (port 4001)

### POST /auth/register

Creer un nouveau compte utilisateur.

**Auth:** non requis

**Request body:**
```json
{
  "username": "string (3-50 chars, requis)",
  "password": "string (min 6 chars, requis)",
  "display_name": "string (optionnel)"
}
```

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "created_at": "timestamp"
  },
  "token": "jwt-string"
}
```

**Response 409:** `{ "error": "Username already taken" }`

---

### POST /auth/login

Authentifier un utilisateur existant.

**Auth:** non requis

**Request body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response 200:**
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "created_at": "timestamp"
  },
  "token": "jwt-string"
}
```

**Response 401:** `{ "error": "Invalid credentials" }`

---

### GET /channels

Lister les channels accessibles (publics + channels dont l'utilisateur est membre).

**Auth:** requis

**Response 200:**
```json
{
  "channels": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string",
      "is_private": false,
      "created_by": "uuid",
      "created_at": "timestamp"
    }
  ]
}
```

---

### GET /channels/:id

Recuperer le detail d'un channel.

**Auth:** requis

**Response 200:**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "is_private": false,
  "created_by": "uuid",
  "created_at": "timestamp"
}
```

**Response 404:** `{ "error": "Channel not found" }`

**Response 403:** `{ "error": "Access denied" }` (channel prive, non-membre)

---

### POST /channels

Creer un nouveau channel. Le createur est automatiquement ajoute comme admin.

**Auth:** requis

**Request body:**
```json
{
  "name": "string (requis)",
  "description": "string (optionnel)",
  "is_private": "boolean (optionnel, defaut: false)"
}
```

**Response 200:**
```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "is_private": false,
  "created_by": "uuid",
  "created_at": "timestamp"
}
```

---

### DELETE /channels/:id

Supprimer un channel. Seul le createur peut supprimer.

**Auth:** requis

**Response 200:** `{ "deleted": true }`

**Response 403:** `{ "error": "Only the channel creator can delete it" }`

**Response 404:** `{ "error": "Channel not found" }`

---

### POST /channels/:id/join

Rejoindre un channel public (self-join). Idempotent (ON CONFLICT DO NOTHING).

**Auth:** requis

**Response 200:** `{ "ok": true }`

**Response 403:** `{ "error": "Cannot self-join a private channel" }`

**Response 404:** `{ "error": "Channel not found" }`

---

### GET /channels/:id/members

Lister les membres d'un channel.

**Auth:** requis

**Response 200:**
```json
{
  "members": [
    {
      "user_id": "uuid",
      "role": "admin | member",
      "joined_at": "timestamp",
      "username": "string",
      "display_name": "string"
    }
  ]
}
```

**Response 404:** `{ "error": "Channel not found" }`

---

### POST /channels/:id/members

Ajouter un membre a un channel (admin uniquement).

**Auth:** requis

**Request body:**
```json
{
  "user_id": "uuid (requis)",
  "role": "string (optionnel, defaut: 'member')"
}
```

**Response 200:** `{ "ok": true }`

**Response 403:** `{ "error": "Only channel admins can add members" }`

---

### DELETE /channels/:id/members/:userId

Retirer un membre. Un utilisateur peut se retirer lui-meme, sinon il faut etre admin.

**Auth:** requis

**Response 200:** `{ "ok": true }`

**Response 403:** `{ "error": "Only admins can remove other members" }`

---

### GET /channels/:id/messages

Recuperer l'historique des messages d'un channel (pagination cursor-based).

**Auth:** requis

**Query parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | string (number) | 50 | Nombre max de messages |
| `before` | string (timestamp) | - | Curseur : messages avant cette date |

**Response 200:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "channel_id": "uuid",
      "user_id": "uuid",
      "content": "string",
      "created_at": "timestamp",
      "username": "string"
    }
  ]
}
```

Les messages sont retournes dans l'ordre chronologique (plus ancien en premier).

**Response 403:** `{ "error": "Access denied" }` (channel prive, non-membre)

**Response 404:** `{ "error": "Channel not found" }`

---

## Presence Service (port 4002)

### POST /presence/heartbeat

Signaler que l'utilisateur est en ligne. Doit etre appele regulierement (TTL = 30s).

**Auth:** requis

**Request body:**
```json
{
  "channel_id": "uuid (optionnel - associe l'utilisateur au channel)",
  "connected_at": "string ISO date (optionnel)"
}
```

**Response 200:** `{ "ok": true }`

**Comportement:** Met a jour la cle `presence:<user_id>` dans Valkey avec un TTL de 30s. Si `channel_id` est fourni, ajoute l'utilisateur au set `channel:online:<channel_id>` (TTL 60s).

---

### POST /presence/offline

Marquer l'utilisateur comme hors-ligne immediatement.

**Auth:** requis

**Response 200:** `{ "ok": true }`

**Comportement:** Supprime la cle `presence:<user_id>` de Valkey.

---

### GET /channels/:channelId/online

Lister les membres actuellement en ligne dans un channel.

**Auth:** requis

**Response 200:**
```json
{
  "channel_id": "uuid",
  "online": ["user-uuid-1", "user-uuid-2"]
}
```

**Comportement:** Verifie le set `channel:online:<channelId>` puis filtre les membres dont la cle `presence:<uid>` a expire (nettoyage lazy).

---

## WebSocket Protocol (Gateway - port 3001)

### Connexion

```
ws://host:3001/ws?token=<JWT>
```

Le JWT est passe en query parameter. Si le token est invalide ou absent, le serveur repond **401 Unauthorized** et refuse l'upgrade WebSocket.

Une fois connecte, le client est enregistre dans une DashMap locale a l'instance gateway. A la deconnexion, le client est automatiquement retire et la tache d'envoi est annulee.

---

### Messages Client -> Serveur

#### send_message

Envoyer un message dans un channel. Le message est publie dans Valkey Streams (`stream:messages`) pour traitement asynchrone par le message-service.

```json
{
  "type": "send_message",
  "channel_id": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Hello world"
}
```

#### typing

Signaler que l'utilisateur est en train de taper. Publie via Valkey Pub/Sub sur le channel `typing:<channel_id>`.

```json
{
  "type": "typing",
  "channel_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### ping

Heartbeat WebSocket applicatif.

```json
{
  "type": "ping"
}
```

---

### Messages Serveur -> Client

#### new_message

Nouveau message persiste et broadcast via Valkey Pub/Sub.

```json
{
  "type": "new_message",
  "id": "msg-uuid",
  "channel_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "660e8400-e29b-41d4-a716-446655440000",
  "content": "Hello world",
  "created_at": "2026-03-17T12:00:00Z"
}
```

#### user_typing

Indicateur de frappe d'un autre utilisateur.

```json
{
  "type": "user_typing",
  "channel_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "660e8400-e29b-41d4-a716-446655440000"
}
```

#### pong

Reponse au ping.

```json
{
  "type": "pong"
}
```

#### error

Erreur de traitement (JSON invalide, type inconnu, champs manquants).

```json
{
  "type": "error",
  "message": "Invalid message format"
}
```

---

## Flow d'un Message

```
Client WebSocket
    |
    | {"type":"send_message", "channel_id":"...", "content":"..."}
    v
Gateway (Rust)
    |
    | XADD stream:messages * user_id <uid> channel_id <cid> content <text>
    v
Valkey Streams
    |
    | XREADGROUP (consumer group: message-service)
    v
Message Service (Bun/TS)
    |
    | Batch INSERT INTO messages (...) -- flush toutes les 50ms ou 200 msgs
    | PUBLISH broadcast:<channel_id> {...}
    v
Valkey Pub/Sub
    |
    | Chaque gateway ecoute broadcast:* et typing:*
    v
Gateway (Rust)
    |
    | Forward via WebSocket a tous les clients connectes localement
    v
Client(s) WebSocket
```
