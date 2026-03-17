import { describe, it, expect } from "bun:test";
import { MESSAGE_URL, register, login, authHeader } from "./helpers";

describe("e2e: auth flow", () => {
  const username = `testuser_${Date.now()}`;
  const password = "securepass123";
  let token: string;

  it("registers a new user", async () => {
    const { status, body } = await register(username, password);
    expect(status).toBe(200);
    expect(body.user.username).toBe(username);
    expect(body.token).toBeDefined();
    token = body.token;
  });

  it("rejects duplicate registration", async () => {
    const { status } = await register(username, password);
    expect(status).toBe(409);
  });

  it("logs in with correct credentials", async () => {
    const { status, body } = await login(username, password);
    expect(status).toBe(200);
    expect(body.user.username).toBe(username);
    expect(body.token).toBeDefined();
    token = body.token;
  });

  it("rejects login with wrong password", async () => {
    const { status } = await login(username, "wrongpass");
    expect(status).toBe(401);
  });

  it("rejects login for nonexistent user", async () => {
    const { status } = await login("nonexistent_user_xyz", "pass");
    expect(status).toBe(401);
  });

  it("accesses protected route with token", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`, {
      headers: authHeader(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.channels).toBeDefined();
  });

  it("rejects protected route without token", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`);
    expect(res.status).toBe(401);
  });
});
