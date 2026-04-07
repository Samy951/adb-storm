import { Elysia, t } from "elysia";

export const channelRoutes = new Elysia({ prefix: "/channels" })
  // List channels (public + channels user is member of)
  .get("/", async ({ db, userId }) => {
    const channels = await db`
      SELECT id, name, description, is_private, created_by, created_at
      FROM channels
      WHERE is_private = false
         OR id IN (SELECT channel_id FROM channel_members WHERE user_id = ${userId})
      ORDER BY created_at ASC
    `;
    return { channels };
  }, { auth: true })

  // Get a single channel
  .get(
    "/:id",
    async ({ params, db, userId, set }) => {
      const [channel] = await db`
        SELECT id, name, description, is_private, created_by, created_at
        FROM channels
        WHERE id = ${params.id}
      `;
      if (!channel) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      if (channel.is_private) {
        const [member] = await db`
          SELECT 1 FROM channel_members
          WHERE channel_id = ${params.id} AND user_id = ${userId}
        `;
        if (!member) {
          set.status = 403;
          return { error: "Access denied" };
        }
      }
      return channel;
    },
    { params: t.Object({ id: t.String() }), auth: true }
  )

  // Create a channel
  .post(
    "/",
    async ({ body, db, userId, valkey }) => {
      const [channel] = await db`
        INSERT INTO channels (name, description, is_private, created_by)
        VALUES (${body.name}, ${body.description || ""}, ${body.is_private || false}, ${userId})
        RETURNING id, name, description, is_private, created_by, created_at
      `;
      // Auto-add creator as admin member
      await db`
        INSERT INTO channel_members (channel_id, user_id, role)
        VALUES (${channel.id}, ${userId}, 'admin')
      `;
      // Sync membership to Valkey cache
      await valkey.sadd(`channel:${channel.id}:members`, userId);
      return channel;
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        is_private: t.Optional(t.Boolean()),
      }),
      auth: true,
    }
  )

  // Delete a channel (only creator)
  .delete(
    "/:id",
    async ({ params, db, userId, valkey, set }) => {
      const [channel] = await db`
        SELECT created_by FROM channels WHERE id = ${params.id}
      `;
      if (!channel) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      if (channel.created_by !== userId) {
        set.status = 403;
        return { error: "Only the channel creator can delete it" };
      }
      await db`DELETE FROM channels WHERE id = ${params.id}`;
      // Clean up Valkey membership cache and notify gateways
      await valkey.del(`channel:${params.id}:members`);
      await valkey.publish("channel_membership_changed", JSON.stringify({ channel_id: params.id }));
      return { deleted: true };
    },
    { params: t.Object({ id: t.String() }), auth: true }
  );
