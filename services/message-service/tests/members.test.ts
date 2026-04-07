import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { authMiddleware } from "../src/middleware/auth";
import { memberRoutes } from "../src/routes/members";
import { generateToken, TEST_JWT_SECRET } from "./helpers";

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_USER_ID = "660e8400-e29b-41d4-a716-446655440001";
const THIRD_USER_ID = "770e8400-e29b-41d4-a716-446655440002";

interface Channel {
  id: string;
  is_private?: boolean;
}

interface Member {
  channel_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  username: string;
  display_name: string;
}

function createMockDb(channels: Channel[] = [], members: Member[] = []) {
  const db = (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?");

    // Check channel with is_private (join route): SELECT id, is_private FROM channels WHERE id = ?
    if (query.includes("is_private") && query.includes("FROM channels")) {
      const id = values[0];
      const found = channels.find((c) => c.id === id);
      return found ? [{ id: found.id, is_private: found.is_private ?? false }] : [];
    }

    // Check channel exists: SELECT id FROM channels WHERE id = ?
    if (query.includes("SELECT id FROM channels")) {
      const id = values[0];
      const found = channels.find((c) => c.id === id);
      return found ? [found] : [];
    }

    // List members with JOIN users
    if (query.includes("FROM channel_members cm") && query.includes("JOIN users")) {
      const channelId = values[0];
      return members
        .filter((m) => m.channel_id === channelId)
        .map((m) => ({
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          username: m.username,
          display_name: m.display_name,
        }));
    }

    // Check caller role: SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?
    if (query.includes("SELECT role FROM channel_members")) {
      const channelId = values[0];
      const userId = values[1];
      const found = members.find((m) => m.channel_id === channelId && m.user_id === userId);
      return found ? [{ role: found.role }] : [];
    }

    // INSERT member
    if (query.includes("INSERT INTO channel_members")) {
      const channelId = values[0];
      const userId = values[1];
      // role may be in values[2] (admin add) or hardcoded in the SQL template (self-join)
      const role = values[2] || "member";
      const exists = members.find((m) => m.channel_id === channelId && m.user_id === userId);
      if (!exists) {
        members.push({
          channel_id: channelId,
          user_id: userId,
          role,
          joined_at: new Date().toISOString(),
          username: "newuser",
          display_name: "New User",
        });
      }
      return [];
    }

    // DELETE member
    if (query.includes("DELETE FROM channel_members")) {
      const channelId = values[0];
      const userId = values[1];
      const idx = members.findIndex((m) => m.channel_id === channelId && m.user_id === userId);
      if (idx >= 0) members.splice(idx, 1);
      return [];
    }

    return [];
  };

  return db;
}

function createApp(db: any) {
  return new Elysia()
    .decorate("db", db)
    .use(authMiddleware(TEST_JWT_SECRET))
    .use(memberRoutes);
}

function authHeaders(userId: string = USER_ID) {
  return { Authorization: `Bearer ${generateToken(userId)}` };
}

describe("member routes", () => {
  describe("GET /channels/:id/members", () => {
    it("returns members of a channel", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "admin", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
        { channel_id: "ch-1", user_id: OTHER_USER_ID, role: "member", joined_at: "2025-01-02", username: "bob", display_name: "Bob" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toHaveLength(2);
      expect(body.members[0].username).toBe("alice");
      expect(body.members[0].role).toBe("admin");
      expect(body.members[1].username).toBe("bob");
    });

    it("returns 404 for nonexistent channel", async () => {
      const app = createApp(createMockDb([], []));

      const res = await app.handle(
        new Request("http://localhost/channels/nonexistent/members", { headers: authHeaders() })
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Channel not found");
    });

    it("returns empty list when channel has no members", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", { headers: authHeaders() })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toHaveLength(0);
    });
  });

  describe("POST /channels/:id/members", () => {
    it("allows admin to add a member", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "admin", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: OTHER_USER_ID }),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(members).toHaveLength(2);
      expect(members[1].user_id).toBe(OTHER_USER_ID);
      expect(members[1].role).toBe("member");
    });

    it("allows admin to add a member with a specific role", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "admin", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: OTHER_USER_ID, role: "admin" }),
        })
      );

      expect(res.status).toBe(200);
      expect(members[1].role).toBe("admin");
    });

    it("returns 403 when non-admin tries to add a member", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "member", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: OTHER_USER_ID }),
        })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Only channel admins can add members");
    });

    it("returns 403 when non-member tries to add a member", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const app = createApp(createMockDb(channels, []));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/members", {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: OTHER_USER_ID }),
        })
      );

      expect(res.status).toBe(403);
    });
  });

  describe("POST /channels/:id/join", () => {
    it("allows self-join on a public channel", async () => {
      const channels: Channel[] = [{ id: "ch-1", is_private: false }];
      const members: Member[] = [];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/join", {
          method: "POST",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(USER_ID);
      expect(members[0].role).toBe("member");
    });

    it("returns 403 when trying to self-join a private channel", async () => {
      const channels: Channel[] = [{ id: "ch-priv", is_private: true }];
      const members: Member[] = [];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-priv/join", {
          method: "POST",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Cannot self-join a private channel");
      expect(members).toHaveLength(0);
    });

    it("returns 404 for non-existent channel", async () => {
      const app = createApp(createMockDb([], []));

      const res = await app.handle(
        new Request("http://localhost/channels/nonexistent/join", {
          method: "POST",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Channel not found");
    });

    it("handles self-join when already a member (idempotent)", async () => {
      const channels: Channel[] = [{ id: "ch-1", is_private: false }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "member", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request("http://localhost/channels/ch-1/join", {
          method: "POST",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // ON CONFLICT DO NOTHING: member count stays the same
      expect(members).toHaveLength(1);
    });
  });

  describe("DELETE /channels/:id/members/:userId", () => {
    it("allows admin to remove another member", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "admin", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
        { channel_id: "ch-1", user_id: OTHER_USER_ID, role: "member", joined_at: "2025-01-02", username: "bob", display_name: "Bob" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request(`http://localhost/channels/ch-1/members/${OTHER_USER_ID}`, {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(USER_ID);
    });

    it("allows a member to leave (self-remove)", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "member", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
        { channel_id: "ch-1", user_id: OTHER_USER_ID, role: "admin", joined_at: "2025-01-02", username: "bob", display_name: "Bob" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request(`http://localhost/channels/ch-1/members/${USER_ID}`, {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(members).toHaveLength(1);
      expect(members[0].user_id).toBe(OTHER_USER_ID);
    });

    it("returns 403 when non-admin tries to remove another member", async () => {
      const channels: Channel[] = [{ id: "ch-1" }];
      const members: Member[] = [
        { channel_id: "ch-1", user_id: USER_ID, role: "member", joined_at: "2025-01-01", username: "alice", display_name: "Alice" },
        { channel_id: "ch-1", user_id: OTHER_USER_ID, role: "member", joined_at: "2025-01-02", username: "bob", display_name: "Bob" },
      ];
      const app = createApp(createMockDb(channels, members));

      const res = await app.handle(
        new Request(`http://localhost/channels/ch-1/members/${OTHER_USER_ID}`, {
          method: "DELETE",
          headers: authHeaders(),
        })
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Only admins can remove other members");
      expect(members).toHaveLength(2);
    });
  });
});
