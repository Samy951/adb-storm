import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { authMiddleware } from "../src/middleware/auth";
import { generateToken, TEST_JWT_SECRET } from "./helpers";

function createTestApp() {
  return new Elysia()
    .use(authMiddleware(TEST_JWT_SECRET))
    .get("/protected", ({ userId }) => ({ userId }), { auth: true });
}

describe("presence auth middleware", () => {
  it("allows request with valid token", async () => {
    const app = createTestApp();
    const token = generateToken("user-1");
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-1");
  });

  it("rejects request without token", async () => {
    const app = createTestApp();
    const res = await app.handle(new Request("http://localhost/protected"));
    expect(res.status).toBe(401);
  });

  it("rejects invalid token", async () => {
    const app = createTestApp();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Authorization: "Bearer invalid" },
      })
    );
    expect(res.status).toBe(401);
  });
});
