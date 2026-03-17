import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../src/middleware/auth";
import { generateToken, generateExpiredToken, TEST_JWT_SECRET } from "./helpers";

function createTestApp() {
  return new Elysia()
    .use(authMiddleware(TEST_JWT_SECRET))
    .get("/protected", ({ userId }) => ({ userId }), { auth: true });
}

describe("auth middleware", () => {
  it("allows request with valid token", async () => {
    const app = createTestApp();
    const token = generateToken("550e8400-e29b-41d4-a716-446655440000");
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects request without token", async () => {
    const app = createTestApp();
    const res = await app.handle(new Request("http://localhost/protected"));
    expect(res.status).toBe(401);
  });

  it("rejects expired token", async () => {
    const app = createTestApp();
    const token = generateExpiredToken("550e8400-e29b-41d4-a716-446655440000");
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid token", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: "Bearer garbage" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects token signed with wrong secret", async () => {
    const app = createTestApp();
    const token = jwt.sign({ sub: "user-1", username: "test" }, "wrong-secret", { expiresIn: "1h" });
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(401);
  });
});
