import jwt from "jsonwebtoken";

export const TEST_JWT_SECRET = "test-secret-key";

export function generateToken(userId: string, username: string = "testuser"): string {
  return jwt.sign({ sub: userId, username }, TEST_JWT_SECRET, { expiresIn: "1h" });
}
