import { describe, it, expect, beforeAll } from "bun:test";
import { PRESENCE_URL, MESSAGE_URL, register, authHeader } from "./helpers";

describe("e2e: presence", () => {
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const a = await register(`pres_user_a_${Date.now()}`, "password123");
    tokenA = a.body.token;

    const b = await register(`pres_user_b_${Date.now()}`, "password123");
    tokenB = b.body.token;
  });

  it("heartbeat sets user online", async () => {
    const res = await fetch(`${PRESENCE_URL}/presence/heartbeat`, {
      method: "POST",
      headers: { ...authHeader(tokenA), "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "e2e-chan" }),
    });
    expect(res.status).toBe(200);
  });

  it("shows user as online in channel", async () => {
    // User A sent heartbeat above
    const res = await fetch(`${PRESENCE_URL}/channels/e2e-chan/online`, {
      headers: authHeader(tokenA),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.online.length).toBeGreaterThanOrEqual(1);
  });

  it("second user heartbeat shows both online", async () => {
    await fetch(`${PRESENCE_URL}/presence/heartbeat`, {
      method: "POST",
      headers: { ...authHeader(tokenB), "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: "e2e-chan" }),
    });

    const res = await fetch(`${PRESENCE_URL}/channels/e2e-chan/online`, {
      headers: authHeader(tokenA),
    });
    const body = await res.json() as any;
    expect(body.online.length).toBe(2);
  });

  it("offline removes user from presence", async () => {
    const res = await fetch(`${PRESENCE_URL}/presence/offline`, {
      method: "POST",
      headers: authHeader(tokenA),
    });
    expect(res.status).toBe(200);
  });

  it("rejects heartbeat without token", async () => {
    const res = await fetch(`${PRESENCE_URL}/presence/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
