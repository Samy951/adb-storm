import jwt from "jsonwebtoken";

export const MESSAGE_URL = process.env.E2E_MESSAGE_URL || "http://localhost:4011";
export const PRESENCE_URL = process.env.E2E_PRESENCE_URL || "http://localhost:4012";
export const JWT_SECRET = process.env.E2E_JWT_SECRET || "test-e2e-secret";

export function signToken(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username }, JWT_SECRET, { expiresIn: "1h" });
}

export async function register(username: string, password: string) {
  const res = await fetch(`${MESSAGE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json() as any };
}

export async function login(username: string, password: string) {
  const res = await fetch(`${MESSAGE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await res.json() as any };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
