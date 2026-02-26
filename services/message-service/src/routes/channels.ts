import { Elysia, t } from "elysia";

export const channelRoutes = new Elysia({ prefix: "/channels" })
  // List all channels
  .get("/", async ({ db }) => {
    const channels = await db`
      SELECT id, name, description, is_private, created_by, created_at
      FROM channels
      ORDER BY created_at ASC
    `;
    return { channels };
  })

  // Get a single channel
  .get(
    "/:id",
    async ({ params, db, set }) => {
      const [channel] = await db`
        SELECT id, name, description, is_private, created_by, created_at
        FROM channels
        WHERE id = ${params.id}
      `;
      if (!channel) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      return channel;
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )

  // Create a channel
  .post(
    "/",
    async ({ body, db }) => {
      const [channel] = await db`
        INSERT INTO channels (name, description, is_private, created_by)
        VALUES (${body.name}, ${body.description || ""}, ${body.is_private || false}, ${body.created_by})
        RETURNING id, name, description, is_private, created_by, created_at
      `;
      return channel;
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        is_private: t.Optional(t.Boolean()),
        created_by: t.String(),
      }),
    }
  )

  // Delete a channel
  .delete(
    "/:id",
    async ({ params, db, set }) => {
      const result = await db`
        DELETE FROM channels WHERE id = ${params.id}
        RETURNING id
      `;
      if (result.length === 0) {
        set.status = 404;
        return { error: "Channel not found" };
      }
      return { deleted: true };
    },
    {
      params: t.Object({ id: t.String() }),
    }
  );
