import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { authMiddleware } from "../src/middleware/auth";
import { channelRoutes } from "../src/routes/channels";
import { generateToken, TEST_JWT_SECRET } from "./helpers";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";

interface Channel {
  id: string;
  name: string;
  description: string;
  is_private: boolean;
  created_by: string;
  created_at: string;
}

interface ChannelMember {
  channel_id: string;
  user_id: string;
  role: string;
}

function createMockDb(channels: Channel[] = [], members: ChannelMember[] = []) {
  const db = (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?");

    // LIST: SELECT channels WHERE is_private = false OR member
    if (query.includes("SELECT") && query.includes("FROM channels") && query.includes("is_private = false")) {
      const userId = values[0];
      return channels.filter(
        (c) => !c.is_private || members.some((m) => m.channel_id === c.id && m.user_id === userId)
      );
    }

    // GET by ID: SELECT ... FROM channels WHERE id = ?
    if (query.includes("SELECT") && query.includes("FROM channels") && query.includes("WHERE id")) {
      const id = values[0];
      const found = channels.find((c) => c.id === id);
      return found ? [found] : [];
    }

    // Check membership
    if (query.includes("SELECT 1 FROM channel_members")) {
      const channelId = values[0];
      const userId = values[1];
      const found = members.find((m) => m.channel_id === channelId && m.user_id === userId);
      return found ? [found] : [];
    }

    // SELECT created_by (for delete)
    if (query.includes("SELECT created_by FROM channels")) {
      const id = values[0];
      const found = channels.find((c) => c.id === id);
      return found ? [{ created_by: found.created_by }] : [];
    }

    // INSERT channel
    if (query.includes("INSERT INTO channels")) {
      const channel: Channel = {
        id: "new-channel-id",
        name: values[0],
        description: values[1],
        is_private: values[2],
        created_by: values[3],
        created_at: new Date().toISOString(),
      };
      channels.push(channel);
      return [channel];
    }

    // INSERT channel_members (auto-add creator)
    // Note: role 'admin' is a literal in the SQL template, not an interpolated value
    if (query.includes("INSERT INTO channel_members")) {
      members.push({
        channel_id: values[0],
        user_id: values[1],
        role: "admin",
      });
      return [];
    }

    // DELETE channel
    if (query.includes("DELETE FROM channels")) {
      const id = values[0];
      const idx = channels.findIndex((c) => c.id === id);
      if (idx >= 0) channels.splice(idx, 1);
      return [];
    }

    return [];
  };

  return db;
}

const mockValkey = { sadd: async () => {}, srem: async () => {}, del: async () => {}, publish: async () => {} };

function createApp(db: any) {
  return new Elysia()
    .decorate("db", db)
    .decorate("valkey", mockValkey)
    .use(authMiddleware(TEST_JWT_SECRET))
    .use(channelRoutes);
}

function authHeaders(userId: string = USER_ID) {
  return { Authorization: `Bearer ${generateToken(userId)}` };
}

describe("channel routes", () => {
  describe("GET /channels", () => {
    it("returns public channels", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "", is_private: false, created_by: USER_ID, created_at: "2025-01-01" },
        { id: "ch-2", name: "random", description: "", is_private: false, created_by: USER_ID, created_at: "2025-01-02" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toHaveLength(2);
      expect(body.channels[0].name).toBe("general");
    });

    it("excludes private channels user is not a member of", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "", is_private: false, created_by: USER_ID, created_at: "2025-01-01" },
        { id: "ch-priv", name: "secret", description: "", is_private: true, created_by: OTHER_USER_ID, created_at: "2025-01-02" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].name).toBe("general");
    });

    it("includes private channels user is a member of", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "", is_private: false, created_by: USER_ID, created_at: "2025-01-01" },
        { id: "ch-priv", name: "secret", description: "", is_private: true, created_by: OTHER_USER_ID, created_at: "2025-01-02" },
      ];
      const members: ChannelMember[] = [
        { channel_id: "ch-priv", user_id: USER_ID, role: "member" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toHaveLength(2);
    });
  });

  describe("GET /channels/:id", () => {
    it("returns a public channel by ID", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "Main channel", is_private: false, created_by: USER_ID, created_at: "2025-01-01" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("general");
      expect(body.description).toBe("Main channel");
    });

    it("returns 404 for missing channel", async () => {
      const app = createApp(createMockDb([], []));

      const res = await app.handle(
        new Request("http://localhost/channels/nonexistent", { headers: authHeaders() })
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Channel not found");
    });

    it("returns 403 for private channel when not a member", async () => {
      const channels: Channel[] = [
        { id: "ch-priv", name: "secret", description: "", is_private: true, created_by: OTHER_USER_ID, created_at: "2025-01-01" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-priv", { headers: authHeaders() })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Access denied");
    });

    it("returns private channel when user is a member", async () => {
      const channels: Channel[] = [
        { id: "ch-priv", name: "secret", description: "", is_private: true, created_by: OTHER_USER_ID, created_at: "2025-01-01" },
      ];
      const members: ChannelMember[] = [
        { channel_id: "ch-priv", user_id: USER_ID, role: "member" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-priv", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("secret");
    });
  });

  describe("POST /channels", () => {
    it("creates a channel and auto-adds creator as admin", async () => {
      const channels: Channel[] = [];
      const members: ChannelMember[] = [];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "new-channel", description: "A new channel" }),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("new-channel");
      expect(body.created_by).toBe(USER_ID);

      // Verify creator was added as admin member
      expect(members).toHaveLength(1);
      expect(members[0].channel_id).toBe("new-channel-id");
      expect(members[0].user_id).toBe(USER_ID);
      expect(members[0].role).toBe("admin");
    });

    it("creates a private channel", async () => {
      const channels: Channel[] = [];
      const members: ChannelMember[] = [];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "private-room", is_private: true }),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.is_private).toBe(true);
    });
  });

  describe("DELETE /channels/:id", () => {
    it("allows creator to delete channel", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "", is_private: false, created_by: USER_ID, created_at: "2025-01-01" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1", {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
      expect(channels).toHaveLength(0);
    });

    it("returns 403 when non-creator tries to delete", async () => {
      const channels: Channel[] = [
        { id: "ch-1", name: "general", description: "", is_private: false, created_by: OTHER_USER_ID, created_at: "2025-01-01" },
      ];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1", {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Only the channel creator can delete it");
      expect(channels).toHaveLength(1);
    });

    it("returns 404 when deleting nonexistent channel", async () => {
      const app = createApp(createMockDb([], []));

      const res = await app.handle(
        new Request("http://localhost/channels/nonexistent", {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(404);
    });
  });
});
