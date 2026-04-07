# Post-Mortem 001 : Degradation de performance -- Insertion message-par-message

**Date :** 2026-03-19
**Severite :** P2 (degradation de performance)
**Duree de l'impact :** ~4h (detection lors des tests de charge)
**Auteur :** Samy Hamlat

## Resume

Lors des premiers tests de charge a grande echelle sur l'environnement AKS, le message-service n'arrivait pas a suivre le debit de messages entrants. La latence de traitement (stream -> DB -> broadcast) depassait 2 secondes au p95 pour un debit de seulement ~5 000 msg/s, soit 100x en dessous de l'objectif SLO de 500 000 msg/s. La cause principale etait une architecture d'insertion one-by-one dans PostgreSQL avec des round-trips Valkey supplementaires pour la deduplication et le ciblage des broadcasts.

## Impact

- **Latence messages :** p95 a 2.1s (SLO : < 50ms)
- **Throughput :** plafond a ~5 000 msg/s (SLO : 500 000 msg/s)
- **Backlog Valkey Streams :** accumulation de messages non-consommes (lag > 100K entries)
- **Experience utilisateur :** messages reçus avec un delai perceptible de plusieurs secondes sous charge

## Chronologie

| Heure | Evenement |
|-------|-----------|
| 10:00 | Lancement du test de charge Locust (2 000 connexions WS simultanees) |
| 10:05 | Observation : latence messages > 500ms, tendance a la hausse |
| 10:15 | Grafana confirme : le consumer group `message-service` accumule du lag |
| 10:30 | Profiling : 80% du temps dans le consumer passe en attentes I/O |
| 11:00 | Identification des 3 goulots d'etranglement |
| 12:00 | Implementation du batch insert + suppression dedup keys |
| 13:30 | Suppression du SMEMBERS par message cote gateway |
| 14:00 | Re-test de charge : latence < 30ms p95, throughput 10x ameliore |

## Cause Racine

Trois problemes independants s'accumulaient :

### 1. Insertions PostgreSQL une par une

Le stream consumer effectuait un `INSERT INTO messages` pour chaque message individuellement. A 5 000 msg/s, cela representait 5 000 round-trips PostgreSQL par seconde. La latence reseau + commit sync par insertion creait un goulot massif.

**Avant :**
```typescript
// Pour chaque message du stream :
const [message] = await db`
  INSERT INTO messages (channel_id, user_id, content)
  VALUES (${data.channel_id}, ${data.user_id}, ${data.content})
  RETURNING ...
`;
```

### 2. Cles de deduplication Valkey (SET NX)

Chaque message entrainait un `SET dedupKey EX 300 NX` dans Valkey pour eviter les doublons. Or, PostgreSQL possede deja `ON CONFLICT` pour l'idempotence. Ces cles de dedup ajoutaient un round-trip Valkey par message et consommaient de la memoire inutilement.

### 3. SMEMBERS par message cote Gateway

A chaque broadcast, la gateway executait `SMEMBERS channel:online:<id>` pour obtenir la liste des membres en ligne du channel. A haut debit, cela generait des milliers de requetes Valkey par seconde juste pour le routing des messages, alors que chaque noeud gateway ne detient que ses propres connexions WebSocket.

## Resolution

### Batch INSERT (200 messages / 50ms flush)

Remplacement de l'insertion unitaire par un buffer qui accumule les messages et les insere en batch via `unnest()` :

- Buffer de 200 messages max
- Flush toutes les 50ms (timer) ou quand le buffer est plein
- Insertion batch via `INSERT ... SELECT * FROM unnest(arrays)`
- ACK batch des stream IDs apres insertion reussie
- `synchronous_commit = off` pour le throughput d'ecriture

### Suppression des cles de dedup

L'idempotence est geree par `ON CONFLICT` au niveau PostgreSQL. Les cles `dedup:*` dans Valkey ont ete supprimees, eliminant un round-trip par message et la consommation memoire associee.

### Broadcast local (suppression SMEMBERS)

La gateway broadcast desormais a tous les clients connectes localement. Chaque noeud gateway ne detient que ses propres connexions, donc le filtrage par channel est delegue au frontend. Cela elimine le `SMEMBERS` par message.

### Augmentation ressources Valkey

- Memoire : 512MB -> 2GB
- CPU : 250m -> 1000m (1 core)

## Metriques Avant / Apres

| Metrique | Avant | Apres |
|----------|-------|-------|
| Latence traitement p95 | 2.1s | < 30ms |
| Throughput message-service | ~5 000 msg/s | ~50 000 msg/s |
| Round-trips Valkey / message | 2 (dedup + SMEMBERS) | 0 |
| Round-trips PostgreSQL / message | 1 | 1/200 (amorti) |

## Lecons Apprises

1. **Ne pas optimiser avant de mesurer, mais ne pas attendre la prod non plus.** Les tests de charge auraient du etre lances plus tot dans le cycle de dev.
2. **Les round-trips reseau dominent.** Le batch insert a eu l'impact le plus fort car il reduit le nombre de round-trips PostgreSQL d'un facteur 200.
3. **La deduplication applicative est redondante quand la base la gere.** `ON CONFLICT` est suffisant et evite une couche de complexite dans Valkey.
4. **Le broadcast local est le bon pattern en multi-noeud.** Chaque gateway ne connait que ses clients, pas besoin de demander a Valkey qui est ou.

## Actions

- [x] Batch INSERT avec flush timer (50ms / 200 msgs)
- [x] Supprimer les cles de deduplication Valkey
- [x] Remplacer SMEMBERS par broadcast local
- [x] `synchronous_commit = off` pour le consumer
- [x] Augmenter les ressources Valkey en K8s
- [ ] Ajouter une metrique Prometheus pour la taille du buffer de batch
- [ ] Tester avec 10 000+ connexions pour valider le scaling horizontal
