import { describe, it, expect, beforeAll } from "bun:test";
import { MESSAGE_URL, register, authHeader } from "./helpers";

describe("e2e: channels", () => {
  let tokenA: string;
  let tokenB: string;
  let userAId: string;
  let publicChannelId: string;
  let privateChannelId: string;

  beforeAll(async () => {
    const a = await register(`chan_user_a_${Date.now()}`, "password123");
    tokenA = a.body.token;
    userAId = a.body.user.id;

    const b = await register(`chan_user_b_${Date.now()}`, "password123");
    tokenB = b.body.token;
  });

  it("creates a public channel", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`, {
      method: "POST",
      headers: { ...authHeader(tokenA), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "public-test", description: "A public channel" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe("public-test");
    expect(body.created_by).toBe(userAId);
    publicChannelId = body.id;
  });

  it("creates a private channel", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`, {
      method: "POST",
      headers: { ...authHeader(tokenA), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "private-test", is_private: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.is_private).toBe(true);
    privateChannelId = body.id;
  });

  it("user A sees both channels", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`, {
      headers: authHeader(tokenA),
    });
    const body = await res.json() as any;
    const names = body.channels.map((c: any) => c.name);
    expect(names).toContain("public-test");
    expect(names).toContain("private-test");
  });

  it("user B sees public but not private channel", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels`, {
      headers: authHeader(tokenB),
    });
    const body = await res.json() as any;
    const names = body.channels.map((c: any) => c.name);
    expect(names).toContain("public-test");
    expect(names).not.toContain("private-test");
  });

  it("user B cannot access private channel by ID", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels/${privateChannelId}`, {
      headers: authHeader(tokenB),
    });
    expect(res.status).toBe(403);
  });

  it("user B cannot delete user A's channel", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels/${publicChannelId}`, {
      method: "DELETE",
      headers: authHeader(tokenB),
    });
    expect(res.status).toBe(403);
  });

  it("user A can delete their own channel", async () => {
    const res = await fetch(`${MESSAGE_URL}/channels/${publicChannelId}`, {
      method: "DELETE",
      headers: authHeader(tokenA),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deleted).toBe(true);
  });
});
