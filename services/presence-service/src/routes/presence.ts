import { Elysia, t } from "elysia";

const PRESENCE_TTL = 30;

export const presenceRoutes = new Elysia()
  .post(
    "/presence/heartbeat",
    async ({ userId, body, valkey }) => {
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
  .post(
    "/presence/offline",
    async ({ userId, valkey }) => {
      await valkey.del(`presence:${userId}`);
      return { ok: true };
    },
    { auth: true }
  )
  .get(
    "/channels/:channelId/online",
    async ({ params, valkey }) => {
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

      return { channel_id: params.channelId, online };
    },
    { params: t.Object({ channelId: t.String() }), auth: true }
  );
