import { Elysia, t } from "elysia";
import Redis from "ioredis";
import { Registry, collectDefaultMetrics, Gauge } from "prom-client";
import { authMiddleware } from "./src/middleware/auth";

const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
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
  // Public routes
  .get("/health", () => "OK")
  .get("/metrics", async () => {
    return new Response(await register.metrics(), {
      headers: { "Content-Type": register.contentType },
    });
  })
  // Auth middleware
  .use(authMiddleware(JWT_SECRET))
  // Heartbeat: uses userId from JWT, not from body
  .post(
    "/presence/heartbeat",
    async ({ userId, body }) => {
      const key = `presence:${userId}`;
      await valkey.set(
        key,
        JSON.stringify({
          user_id: userId,
          connected_at: body.connected_at || new Date().toISOString(),
        }),
        "EX",
        PRESENCE_TTL
      );

      if (body.channel_id) {
        await valkey.sadd(`channel:online:${body.channel_id}`, userId);
        await valkey.expire(`channel:online:${body.channel_id}`, PRESENCE_TTL * 2);
      }

      return { ok: true };
    },
    {
      body: t.Object({
        channel_id: t.Optional(t.String()),
        connected_at: t.Optional(t.String()),
      }),
      auth: true,
    }
  )
  // Mark offline (uses userId from JWT)
  .post("/presence/offline", async ({ userId }) => {
    await valkey.del(`presence:${userId}`);
    return { ok: true };
  }, { auth: true })
  // Get online users for a channel
  .get(
    "/channels/:channelId/online",
    async ({ params }) => {
      const members = await valkey.smembers(`channel:online:${params.channelId}`);

      const online: string[] = [];
      for (const uid of members) {
        const exists = await valkey.exists(`presence:${uid}`);
        if (exists) {
          online.push(uid);
        } else {
          await valkey.srem(`channel:online:${params.channelId}`, uid);
        }
      }

      onlineUsersGauge.set(online.length);
      return { channel_id: params.channelId, online };
    },
    { params: t.Object({ channelId: t.String() }), auth: true }
  )
  .listen(PORT);

console.log(`Presence service listening on port ${PORT}`);

export { app };
