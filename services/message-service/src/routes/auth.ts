import { Elysia, t } from "elysia";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export const authRoutes = new Elysia({ prefix: "/auth" })
  // Register a new user
  .post(
    "/register",
    async ({ body, db, set }) => {
      // Check if username already taken
      const [existing] = await db`
        SELECT id FROM users WHERE username = ${body.username}
      `;
      if (existing) {
        set.status = 409;
        return { error: "Username already taken" };
      }

      const passwordHash = await Bun.password.hash(body.password, {
        algorithm: "bcrypt",
        cost: 10,
      });

      const [user] = await db`
        INSERT INTO users (username, display_name, password_hash)
        VALUES (${body.username}, ${body.display_name || body.username}, ${passwordHash})
        RETURNING id, username, display_name, created_at
      `;

      const token = jwt.sign(
        { sub: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      return { user, token };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        password: t.String({ minLength: 6 }),
        display_name: t.Optional(t.String()),
      }),
    }
  )

  // Login
  .post(
    "/login",
    async ({ body, db, set }) => {
      const [user] = await db`
        SELECT id, username, display_name, password_hash, created_at
        FROM users
        WHERE username = ${body.username}
      `;
      if (!user) {
        set.status = 401;
        return { error: "Invalid credentials" };
      }

      const valid = await Bun.password.verify(body.password, user.password_hash);
      if (!valid) {
        set.status = 401;
        return { error: "Invalid credentials" };
      }

      const token = jwt.sign(
        { sub: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      return {
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          created_at: user.created_at,
        },
        token,
      };
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
      }),
    }
  );
