import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { authMiddleware } from "../src/middleware/auth";
import { messageRoutes } from "../src/routes/messages";
import { generateToken, TEST_JWT_SECRET } from "./helpers";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";

interface Channel {
  id: string;
  is_private: boolean;
}

interface ChannelMember {
  channel_id: string;
  user_id: string;
}

interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

function createMockDb(
  channels: Channel[] = [],
  members: ChannelMember[] = [],
  messages: Message[] = []
) {
  const db = (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?");

    // Check channel exists: SELECT is_private FROM channels WHERE id = ?
    if (query.includes("SELECT") && query.includes("is_private") && query.includes("FROM channels")) {
      const id = values[0];
      const found = channels.find((c) => c.id === id);
      return found ? [{ is_private: found.is_private }] : [];
    }

    // Check membership
    if (query.includes("SELECT 1 FROM channel_members")) {
      const channelId = values[0];
      const userId = values[1];
      const found = members.find((m) => m.channel_id === channelId && m.user_id === userId);
      return found ? [found] : [];
    }

    // Messages with before cursor
    if (query.includes("FROM messages") && query.includes("created_at <")) {
      const channelId = values[0];
      const before = values[1];
      const limit = values[2];
      return messages
        .filter((m) => m.channel_id === channelId && m.created_at < before)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }

    // Messages without cursor
    if (query.includes("FROM messages") && query.includes("channel_id")) {
      const channelId = values[0];
      const limit = values[1];
      return messages
        .filter((m) => m.channel_id === channelId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }

    return [];
  };

  return db;
}

function createApp(db: any) {
  return new Elysia()
    .decorate("db", db)
    .use(authMiddleware(TEST_JWT_SECRET))
    .use(messageRoutes);
}

function authHeaders(userId: string = USER_ID) {
  return { Authorization: `Bearer ${generateToken(userId)}` };
}

describe("message routes", () => {
  describe("GET /channels/:id/messages", () => {
    it("returns messages for a public channel", async () => {
      const channels: Channel[] = [{ id: "ch-1", is_private: false }];
      const messages: Message[] = [
        { id: "m-1", channel_id: "ch-1", user_id: USER_ID, content: "Hello", created_at: "2025-01-01T10:00:00Z" },
        { id: "m-2", channel_id: "ch-1", user_id: USER_ID, content: "World", created_at: "2025-01-01T10:01:00Z" },
      ];
      const app = createApp(createMockDb(channels, [], messages));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/messages", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(2);
      // Messages should be in chronological order (reversed from DESC)
      expect(body.messages[0].content).toBe("Hello");
      expect(body.messages[1].content).toBe("World");
    });

    it("returns 403 for private channel when not a member", async () => {
      const channels: Channel[] = [{ id: "ch-priv", is_private: true }];
      const app = createApp(createMockDb(channels, [], []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-priv/messages", { headers: authHeaders() })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Access denied");
    });

    it("returns messages for private channel when user is a member", async () => {
      const channels: Channel[] = [{ id: "ch-priv", is_private: true }];
      const members: ChannelMember[] = [{ channel_id: "ch-priv", user_id: USER_ID }];
      const messages: Message[] = [
        { id: "m-1", channel_id: "ch-priv", user_id: USER_ID, content: "Secret msg", created_at: "2025-01-01T10:00:00Z" },
      ];
      const app = createApp(createMockDb(channels, members, messages));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-priv/messages", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe("Secret msg");
    });

    it("returns 404 for missing channel", async () => {
      const app = createApp(createMockDb([], [], []));

      const res = await app.handle(
        new Request("http://localhost/channels/nonexistent/messages", { headers: authHeaders() })
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Channel not found");
    });

    it("supports pagination with before cursor", async () => {
      const channels: Channel[] = [{ id: "ch-1", is_private: false }];
      const messages: Message[] = [
        { id: "m-1", channel_id: "ch-1", user_id: USER_ID, content: "Old", created_at: "2025-01-01T09:00:00Z" },
        { id: "m-2", channel_id: "ch-1", user_id: USER_ID, content: "Middle", created_at: "2025-01-01T10:00:00Z" },
        { id: "m-3", channel_id: "ch-1", user_id: USER_ID, content: "Recent", created_at: "2025-01-01T11:00:00Z" },
      ];
      const app = createApp(createMockDb(channels, [], messages));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/messages?before=2025-01-01T11:00:00Z", {
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].content).toBe("Old");
      expect(body.messages[1].content).toBe("Middle");
    });

    it("respects the limit query parameter", async () => {
      const channels: Channel[] = [{ id: "ch-1", is_private: false }];
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        id: `m-${i}`,
        channel_id: "ch-1",
        user_id: USER_ID,
        content: `Message ${i}`,
        created_at: `2025-01-01T${String(i).padStart(2, "0")}:00:00Z`,
      }));
      const app = createApp(createMockDb(channels, [], messages));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/messages?limit=3", {
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(3);
    });
  });
});
