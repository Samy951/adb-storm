import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { authMiddleware } from "../src/middleware/auth";
import { presenceRoutes } from "../src/routes/presence";
import { generateToken, TEST_JWT_SECRET } from "./helpers";

// In-memory mock Redis
function createMockRedis() {
  const store = new Map<string, { value: string; ttl?: number }>();
  const sets = new Map<string, Set<string>>();

  return {
    async set(key: string, value: string, _mode?: string, _ttl?: number) {
      store.set(key, { value, ttl: _ttl });
      return "OK";
    },
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async del(key: string) {
      store.delete(key);
      return 1;
    },
    async exists(key: string) {
      return store.has(key) ? 1 : 0;
    },
    async sadd(key: string, ...members: string[]) {
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      for (const m of members) s.add(m);
      return members.length;
    },
    async srem(key: string, ...members: string[]) {
      const s = sets.get(key);
      if (!s) return 0;
      let count = 0;
      for (const m of members) { if (s.delete(m)) count++; }
      return count;
    },
    async smembers(key: string) {
      return Array.from(sets.get(key) ?? []);
    },
    async expire(_key: string, _ttl: number) {
      return 1;
    },
    // Expose internals for assertions
    _store: store,
    _sets: sets,
  };
}

function createApp(valkey: ReturnType<typeof createMockRedis>) {
  return new Elysia()
    .decorate("valkey", valkey as any)
    .use(authMiddleware(TEST_JWT_SECRET))
    .use(presenceRoutes);
}

describe("presence routes", () => {
  // --- Heartbeat ---
  it("POST /presence/heartbeat — sets presence key", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    const res = await app.handle(
      new Request("http://localhost/presence/heartbeat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify presence key was set
    const stored = await valkey.get("presence:user-1");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.user_id).toBe("user-1");
  });

  it("POST /presence/heartbeat — adds user to channel online set", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    const res = await app.handle(
      new Request("http://localhost/presence/heartbeat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel_id: "chan-1" }),
      })
    );

    expect(res.status).toBe(200);
    const members = await valkey.smembers("channel:online:chan-1");
    expect(members).toContain("user-1");
  });

  it("POST /presence/heartbeat — rejects without token", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);

    const res = await app.handle(
      new Request("http://localhost/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(401);
  });

  it("POST /presence/heartbeat — uses token userId, ignores body manipulation", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("real-user");

    await app.handle(
      new Request("http://localhost/presence/heartbeat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );

    // Should set presence for the token user, not any spoofed user
    expect(await valkey.exists("presence:real-user")).toBe(1);
    expect(await valkey.exists("presence:spoofed-user")).toBe(0);
  });

  // --- Offline ---
  it("POST /presence/offline — removes presence key", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    // Set presence first
    await valkey.set("presence:user-1", JSON.stringify({ user_id: "user-1" }));
    expect(await valkey.exists("presence:user-1")).toBe(1);

    const res = await app.handle(
      new Request("http://localhost/presence/offline", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(res.status).toBe(200);
    expect(await valkey.exists("presence:user-1")).toBe(0);
  });

  it("POST /presence/offline — rejects without token", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);

    const res = await app.handle(
      new Request("http://localhost/presence/offline", {
        method: "POST",
      })
    );

    expect(res.status).toBe(401);
  });

  // --- Online users ---
  it("GET /channels/:id/online — returns online users", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    // Simulate two users online
    await valkey.sadd("channel:online:chan-1", "user-1", "user-2");
    await valkey.set("presence:user-1", "{}");
    await valkey.set("presence:user-2", "{}");

    const res = await app.handle(
      new Request("http://localhost/channels/chan-1/online", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel_id).toBe("chan-1");
    expect(body.online).toContain("user-1");
    expect(body.online).toContain("user-2");
    expect(body.online.length).toBe(2);
  });

  it("GET /channels/:id/online — filters out stale users", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    // user-1 is online, user-2 is stale (no presence key)
    await valkey.sadd("channel:online:chan-1", "user-1", "user-2");
    await valkey.set("presence:user-1", "{}");
    // user-2 has no presence key => stale

    const res = await app.handle(
      new Request("http://localhost/channels/chan-1/online", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.online).toEqual(["user-1"]);

    // Stale user should be removed from the set
    const remaining = await valkey.smembers("channel:online:chan-1");
    expect(remaining).not.toContain("user-2");
  });

  it("GET /channels/:id/online — returns empty for unknown channel", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);
    const token = generateToken("user-1");

    const res = await app.handle(
      new Request("http://localhost/channels/nonexistent/online", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.online).toEqual([]);
  });

  it("GET /channels/:id/online — rejects without token", async () => {
    const valkey = createMockRedis();
    const app = createApp(valkey);

    const res = await app.handle(
      new Request("http://localhost/channels/chan-1/online")
    );

    expect(res.status).toBe(401);
  });
});
