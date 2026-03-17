import { Elysia, status } from "elysia";
import jwt from "jsonwebtoken";

interface JwtPayload {
  sub: string;
  username: string;
}

export function authMiddleware(secret: string) {
  return new Elysia({ name: "auth" }).macro({
    auth: {
      resolve({ headers }) {
        const header = headers.authorization;
        if (!header?.startsWith("Bearer ")) {
          return status(401, { error: "Unauthorized" });
        }

        const token = header.slice(7);
        try {
          const payload = jwt.verify(token, secret) as JwtPayload;
          return { userId: payload.sub };
        } catch {
          return status(401, { error: "Unauthorized" });
        }
      },
    },
  });
}
