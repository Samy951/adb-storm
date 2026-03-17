import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { createValkeyClient, startStreamConsumer } from "./src/valkey";
import { createDb } from "./src/db";
import { authMiddleware } from "./src/middleware/auth";
import { authRoutes } from "./src/routes/auth";
import { messageRoutes } from "./src/routes/messages";
import { channelRoutes } from "./src/routes/channels";
import { memberRoutes } from "./src/routes/members";
import { metricsRoute } from "./src/metrics";

const PORT = process.env.PORT || 4001;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

async function main() {
  const db = createDb();
  const valkey = createValkeyClient();

  startStreamConsumer(valkey, db);

  const app = new Elysia()
    .use(swagger({
      documentation: {
        info: { title: "STORM Message Service", version: "1.0.0", description: "Message and channel management API" },
        tags: [
          { name: "auth", description: "Authentication endpoints" },
          { name: "channels", description: "Channel management" },
          { name: "messages", description: "Message retrieval" },
          { name: "members", description: "Channel membership" },
        ],
      },
    }))
    .decorate("db", db)
    .decorate("valkey", valkey)
    .get("/health", () => "OK")
    .use(metricsRoute)
    .use(authRoutes)
    .use(authMiddleware(JWT_SECRET))
    .use(channelRoutes)
    .use(messageRoutes)
    .use(memberRoutes)
    .listen(PORT);

  console.log(`Message service listening on port ${PORT}`);
}

main().catch(console.error);
