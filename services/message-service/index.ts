import { Elysia } from "elysia";
import { createValkeyClient, startStreamConsumer } from "./src/valkey";
import { createDb } from "./src/db";
import { authMiddleware } from "./src/middleware/auth";
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
    .decorate("db", db)
    .decorate("valkey", valkey)
    .get("/health", () => "OK")
    .use(metricsRoute)
    .use(authMiddleware(JWT_SECRET))
    .use(channelRoutes)
    .use(messageRoutes)
    .use(memberRoutes)
    .listen(PORT);

  console.log(`Message service listening on port ${PORT}`);
}

main().catch(console.error);
