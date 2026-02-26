import { Elysia } from "elysia";
import { Registry, collectDefaultMetrics, Counter, Histogram } from "prom-client";

const register = new Registry();
collectDefaultMetrics({ register });

export const messagesProcessed = new Counter({
  name: "messages_processed_total",
  help: "Total number of messages processed from stream",
  registers: [register],
});

export const messageLatency = new Histogram({
  name: "message_processing_duration_seconds",
  help: "Time to process a message from stream to database",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

export const metricsRoute = new Elysia().get("/metrics", async () => {
  return new Response(await register.metrics(), {
    headers: { "Content-Type": register.contentType },
  });
});
