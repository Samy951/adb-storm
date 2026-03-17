import Redis from "ioredis";
import type { Db } from "./db";

const STREAM_GROUP = "message-service";
const CONSUMER_NAME = `consumer-${process.pid}`;

export function createValkeyClient() {
  const url = process.env.VALKEY_URL || "redis://127.0.0.1:6379";
  return new Redis(url);
}

/**
 * Consume messages from Valkey Streams (XREADGROUP).
 * After persisting to PostgreSQL, publish a broadcast event via Pub/Sub
 * so gateways can push to connected clients.
 */
export function startStreamConsumer(valkey: Redis, db: Db) {
  const publisher = valkey.duplicate();

  // Create stream + consumer group (ignore error if already exists)
  valkey
    .xgroup("CREATE", "stream:messages", STREAM_GROUP, "0", "MKSTREAM")
    .catch(() => {});

  async function consume() {
    while (true) {
      try {
        const results = await valkey.xreadgroup(
          "GROUP",
          STREAM_GROUP,
          CONSUMER_NAME,
          "COUNT",
          100,
          "BLOCK",
          5000,
          "STREAMS",
          "stream:messages",
          ">"
        );

        if (!results) continue;

        for (const [_stream, entries] of results) {
          for (const [id, fields] of entries) {
            const data = parseStreamFields(fields);
            if (!data) {
              // Invalid message — ACK and skip
              await valkey.xack("stream:messages", STREAM_GROUP, id);
              continue;
            }

            try {
              // Idempotency: skip if already processed
              const dedupKey = `dedup:${id}`;
              const isNew = await valkey.set(dedupKey, "1", "EX", 300, "NX");
              if (!isNew) {
                await valkey.xack("stream:messages", STREAM_GROUP, id);
                continue;
              }

              // Persist to PostgreSQL
              const [message] = await db`
                INSERT INTO messages (channel_id, user_id, content)
                VALUES (${data.channel_id}, ${data.user_id}, ${data.content})
                RETURNING id, channel_id, user_id, content, created_at
              `;

              // Broadcast via Pub/Sub so gateways push to clients
              await publisher.publish(
                `broadcast:${data.channel_id}`,
                JSON.stringify({
                  type: "new_message",
                  id: message.id,
                  channel_id: message.channel_id,
                  user_id: message.user_id,
                  content: message.content,
                  created_at: message.created_at,
                })
              );

              // ACK the message
              await valkey.xack("stream:messages", STREAM_GROUP, id);
            } catch (err) {
              console.error(`Failed to process message ${id}:`, err);
              // Don't ACK — will be retried on next XREADGROUP with pending entries
            }
          }
        }
      } catch (err) {
        console.error("Stream consumer error:", err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  consume();
}

export function parseStreamFields(
  fields: string[]
): { user_id: string; channel_id: string; content: string } | null {
  const map: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    map[fields[i]] = fields[i + 1];
  }
  if (!map.user_id || !map.channel_id || !map.content) return null;
  if (map.content.trim() === "") return null;
  return {
    user_id: map.user_id,
    channel_id: map.channel_id,
    content: map.content,
  };
}
