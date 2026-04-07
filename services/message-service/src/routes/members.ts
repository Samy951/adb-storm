import { Elysia, t } from "elysia";

export const memberRoutes = new Elysia({ prefix: "/channels" })
  // Self-join a public channel
  .post(
    "/:id/join",
    async ({ params, db, userId, valkey, set }) => {
      const [channel] = await db`
        SELECT id, is_private FROM channels WHERE id = ${params.id}
      `;
      if (!channel) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      if (channel.is_private) {
        set.status = 403;
        return { error: "Cannot self-join a private channel" };
      }
      await db`
        INSERT INTO channel_members (channel_id, user_id, role)
        VALUES (${params.id}, ${userId}, 'member')
        ON CONFLICT (channel_id, user_id) DO NOTHING
      `;
      // Sync membership to Valkey cache and notify gateways
      await valkey.sadd(`channel:${params.id}:members`, userId);
      await valkey.publish("channel_membership_changed", JSON.stringify({ channel_id: params.id }));
      return { ok: true };
    },
    { params: t.Object({ id: t.String() }), auth: true }
  )

  // List members of a channel
  .get(
    "/:id/members",
    async ({ params, db, set }) => {
      const [channel] = await db`
        SELECT id FROM channels WHERE id = ${params.id}
      `;
      if (!channel) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      const members = await db`
        SELECT cm.user_id, cm.role, cm.joined_at, u.username, u.display_name
        FROM channel_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.channel_id = ${params.id}
        ORDER BY cm.joined_at ASC
      `;
      return { members };
    },
    { params: t.Object({ id: t.String() }), auth: true }
  )

  // Add a member (admin only)
  .post(
    "/:id/members",
    async ({ params, body, db, userId, valkey, set }) => {
      const [caller] = await db`
        SELECT role FROM channel_members
        WHERE channel_id = ${params.id} AND user_id = ${userId}
      `;
      if (!caller || caller.role !== "admin") {
        set.status = 403;
        return { error: "Only channel admins can add members" };
      }
      await db`
        INSERT INTO channel_members (channel_id, user_id, role)
        VALUES (${params.id}, ${body.user_id}, ${body.role || "member"})
        ON CONFLICT (channel_id, user_id) DO NOTHING
      `;
      // Sync membership to Valkey cache and notify gateways
      await valkey.sadd(`channel:${params.id}:members`, body.user_id);
      await valkey.publish("channel_membership_changed", JSON.stringify({ channel_id: params.id }));
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        user_id: t.String(),
        role: t.Optional(t.String()),
      }),
      auth: true,
    }
  )

  // Remove a member (admin or self-leave)
  .delete(
    "/:id/members/:userId",
    async ({ params, db, userId, valkey, set }) => {
      const isSelf = params.userId === userId;
      if (!isSelf) {
        const [caller] = await db`
          SELECT role FROM channel_members
          WHERE channel_id = ${params.id} AND user_id = ${userId}
        `;
        if (!caller || caller.role !== "admin") {
          set.status = 403;
          return { error: "Only admins can remove other members" };
        }
      }
      await db`
        DELETE FROM channel_members
        WHERE channel_id = ${params.id} AND user_id = ${params.userId}
      `;
      // Sync membership removal to Valkey cache and notify gateways
      await valkey.srem(`channel:${params.id}:members`, params.userId);
      await valkey.publish("channel_membership_changed", JSON.stringify({ channel_id: params.id }));
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String(), userId: t.String() }),
      auth: true,
    }
  );
