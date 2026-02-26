import { Elysia, t } from "elysia";
import Redis from "ioredis";
import { Registry, collectDefaultMetrics, Gauge } from "prom-client";

const PORT = process.env.PORT || 4002;
const VALKEY_URL = process.env.VALKEY_URL || "redis://127.0.0.1:6379";
const PRESENCE_TTL = 30; // seconds

const valkey = new Redis(VALKEY_URL);

// Metrics
const register = new Registry();
collectDefaultMetrics({ register });

const onlineUsersGauge = new Gauge({
  name: "users_online_total",
  help: "Number of currently online users",
  registers: [register],
});

const app = new Elysia()
  /**
   * Heartbeat: gateway calls this to signal a user is still connected.
   * Sets a key with TTL in Valkey. If TTL expires, user is considered offline.
   */
  .post(
    "/presence/heartbeat",
    async ({ body }) => {
      const key = `presence:${body.user_id}`;
      await valkey.set(key, JSON.stringify({
        user_id: body.user_id,
        connected_at: body.connected_at || new Date().toISOString(),
      }), "EX", PRESENCE_TTL);

      // Track user in channel set
      if (body.channel_id) {
        await valkey.sadd(`channel:online:${body.channel_id}`, body.user_id);
        await valkey.expire(`channel:online:${body.channel_id}`, PRESENCE_TTL * 2);
      }

      return { ok: true };
    },
    {
      body: t.Object({
        user_id: t.String(),
        channel_id: t.Optional(t.String()),
        connected_at: t.Optional(t.String()),
      }),
    }
  )

  /**
   * Mark a user as offline (called on disconnect).
   */
  .post(
    "/presence/offline",
    async ({ body }) => {
      await valkey.del(`presence:${body.user_id}`);
      return { ok: true };
    },
    {
      body: t.Object({
        user_id: t.String(),
      }),
    }
  )

  /**
   * Get online users for a channel.
   */
  .get(
    "/channels/:channelId/online",
    async ({ params }) => {
      const members = await valkey.smembers(`channel:online:${params.channelId}`);

      // Filter to only actually online users (check presence key)
      const online: string[] = [];
      for (const userId of members) {
        const exists = await valkey.exists(`presence:${userId}`);
        if (exists) {
          online.push(userId);
        } else {
          // Clean up stale member
          await valkey.srem(`channel:online:${params.channelId}`, userId);
        }
      }

      onlineUsersGauge.set(online.length);
      return { channel_id: params.channelId, online };
    },
    {
      params: t.Object({ channelId: t.String() }),
    }
  )

  // Health check
  .get("/health", () => "OK")

  // Prometheus metrics
  .get("/metrics", async () => {
    return new Response(await register.metrics(), {
      headers: { "Content-Type": register.contentType },
    });
  })

  .listen(PORT);

console.log(`Presence service listening on port ${PORT}`);
