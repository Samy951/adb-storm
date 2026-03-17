import { Elysia } from "elysia";
import Redis from "ioredis";
import { Registry, collectDefaultMetrics, Gauge } from "prom-client";
import { authMiddleware } from "./src/middleware/auth";
import { presenceRoutes } from "./src/routes/presence";

const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const VALKEY_URL = process.env.VALKEY_URL || "redis://127.0.0.1:6379";

const valkey = new Redis(VALKEY_URL);

// Metrics
const register = new Registry();
collectDefaultMetrics({ register });

const app = new Elysia()
  .get("/health", () => "OK")
  .get("/metrics", async () => {
    return new Response(await register.metrics(), {
      headers: { "Content-Type": register.contentType },
    });
  })
  .decorate("valkey", valkey)
  .use(authMiddleware(JWT_SECRET))
  .use(presenceRoutes)
  .listen(PORT);

console.log(`Presence service listening on port ${PORT}`);

export { app };
