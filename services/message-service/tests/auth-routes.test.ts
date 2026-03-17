import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { authRoutes } from "../src/routes/auth";

// auth routes use process.env.JWT_SECRET || "dev-secret-change-me"
const AUTH_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Mock database
function createMockDb() {
  const users: any[] = [];

  const db = Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join("?");

      if (query.includes("SELECT") && query.includes("FROM users") && query.includes("username")) {
        const username = values[0];
        const found = users.find((u) => u.username === username);
        return found ? [found] : [];
      }

      if (query.includes("INSERT INTO users")) {
        const user = {
          id: "test-uuid-" + users.length,
          username: values[0],
          display_name: values[1],
          password_hash: values[2],
          created_at: new Date().toISOString(),
        };
        users.push(user);
        return [{ id: user.id, username: user.username, display_name: user.display_name, created_at: user.created_at }];
      }

      return [];
    },
    { begin: () => {}, end: () => {} }
  );

  return { db, users };
}

function createApp(db: any) {
  // Override JWT_SECRET for tests
  process.env.JWT_SECRET = AUTH_SECRET;
  return new Elysia().decorate("db", db).use(authRoutes);
}

describe("auth routes", () => {
  it("POST /auth/register — creates user and returns token", async () => {
    const { db } = createMockDb();
    const app = createApp(db);

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "newuser",
          password: "password123",
          display_name: "New User",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe("newuser");
    expect(body.token).toBeDefined();

    // Verify token is valid
    const decoded = jwt.verify(body.token, AUTH_SECRET) as any;
    expect(decoded.sub).toBe(body.user.id);
    expect(decoded.username).toBe("newuser");
  });

  it("POST /auth/register — rejects duplicate username", async () => {
    const { db, users } = createMockDb();
    users.push({ id: "existing", username: "taken", display_name: "Taken", password_hash: "x" });
    const app = createApp(db);

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "taken",
          password: "password123",
        }),
      })
    );

    expect(res.status).toBe(409);
  });

  it("POST /auth/register — rejects short username", async () => {
    const { db } = createMockDb();
    const app = createApp(db);

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "ab",
          password: "password123",
        }),
      })
    );

    expect(res.status).toBe(422);
  });

  it("POST /auth/register — rejects short password", async () => {
    const { db } = createMockDb();
    const app = createApp(db);

    const res = await app.handle(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "validuser",
          password: "123",
        }),
      })
    );

    expect(res.status).toBe(422);
  });
});
