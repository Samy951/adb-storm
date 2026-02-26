import { Elysia } from "elysia";
import { createValkeyClient, startStreamConsumer } from "./src/valkey";
import { createDb } from "./src/db";
import { messageRoutes } from "./src/routes/messages";
import { channelRoutes } from "./src/routes/channels";
import { metricsRoute } from "./src/metrics";

const PORT = process.env.PORT || 4001;

async function main() {
  const db = createDb();
  const valkey = createValkeyClient();

  // Start consuming from Valkey Streams
  startStreamConsumer(valkey, db);

  const app = new Elysia()
    .decorate("db", db)
    .decorate("valkey", valkey)
    .use(messageRoutes)
    .use(channelRoutes)
    .use(metricsRoute)
    .get("/health", () => "OK")
    .listen(PORT);

  console.log(`Message service listening on port ${PORT}`);
}

main().catch(console.error);
