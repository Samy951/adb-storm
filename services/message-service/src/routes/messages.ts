import { Elysia, t } from "elysia";

export const messageRoutes = new Elysia({ prefix: "/channels" }).get(
  "/:id/messages",
  async ({ params, query, db }) => {
    const limit = Number(query.limit) || 50;
    const before = query.before; // cursor-based pagination

    let messages;
    if (before) {
      messages = await db`
        SELECT id, channel_id, user_id, content, created_at
        FROM messages
        WHERE channel_id = ${params.id}
          AND created_at < ${before}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      messages = await db`
        SELECT id, channel_id, user_id, content, created_at
        FROM messages
        WHERE channel_id = ${params.id}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return { messages: messages.reverse() };
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    query: t.Object({
      limit: t.Optional(t.String()),
      before: t.Optional(t.String()),
    }),
  }
);
