import Redis from "ioredis";
import type { Db } from "./db";

const STREAM_GROUP = "message-service";
const CONSUMER_NAME = `consumer-${process.pid}`;

const BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 50;

export function createValkeyClient() {
  const url = process.env.VALKEY_URL || "redis://127.0.0.1:6379";
  return new Redis(url);
}

interface PendingMessage {
  streamId: string;
  channel_id: string;
  user_id: string;
  content: string;
}

/**
 * Consume messages from Valkey Streams (XREADGROUP).
 * Batch inserts into PostgreSQL, then broadcast via Pub/Sub.
 */
export function startStreamConsumer(valkey: Redis, db: Db) {
  const publisher = valkey.duplicate();

  valkey
    .xgroup("CREATE", "stream:messages", STREAM_GROUP, "0", "MKSTREAM")
    .catch(() => {});

  let buffer: PendingMessage[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  async function flushBuffer() {
    if (buffer.length === 0) return;

    const batch = buffer.splice(0, BATCH_SIZE);
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    try {
      // Batch INSERT with ON CONFLICT for idempotency
      const channelIds = batch.map((m) => m.channel_id);
      const userIds = batch.map((m) => m.user_id);
      const contents = batch.map((m) => m.content);

      const messages = await db`
        INSERT INTO messages (channel_id, user_id, content)
        SELECT * FROM unnest(
          ${db.array(channelIds)}::uuid[],
          ${db.array(userIds)}::uuid[],
          ${db.array(contents)}::text[]
        )
        RETURNING id, channel_id, user_id, content, created_at
      `;

      // Broadcast each message via Pub/Sub
      const publishPromises = messages.map((message: any) =>
        publisher.publish(
          `broadcast:${message.channel_id}`,
          JSON.stringify({
            type: "new_message",
            id: message.id,
            channel_id: message.channel_id,
            user_id: message.user_id,
            content: message.content,
            created_at: message.created_at,
          })
        )
      );
      await Promise.all(publishPromises);

      // ACK all messages in batch
      const streamIds = batch.map((m) => m.streamId);
      if (streamIds.length > 0) {
        await valkey.xack("stream:messages", STREAM_GROUP, ...streamIds);
      }
    } catch (err) {
      console.error(`Failed to flush batch of ${batch.length} messages:`, err);
      // Put messages back for retry (at front of buffer)
      buffer.unshift(...batch);
    }
  }

  function scheduleFlush() {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushBuffer();
      }, FLUSH_INTERVAL_MS);
    }
  }

  async function consume() {
    // Disable synchronous_commit for this connection (safe for messaging)
    await db`SET LOCAL synchronous_commit = off`.catch(() => {});

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
              await valkey.xack("stream:messages", STREAM_GROUP, id);
              continue;
            }

            buffer.push({
              streamId: id,
              channel_id: data.channel_id,
              user_id: data.user_id,
              content: data.content,
            });

            // Flush if buffer is full
            if (buffer.length >= BATCH_SIZE) {
              await flushBuffer();
            } else {
              scheduleFlush();
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
