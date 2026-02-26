import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

// Custom metrics
const messagesReceived = new Counter("ws_messages_received");
const messagesSent = new Counter("ws_messages_sent");
const messageLatency = new Trend("ws_message_latency", true);

// Test configuration - ramp up progressively
export const options = {
  stages: [
    { duration: "30s", target: 100 },   // Warm up
    { duration: "1m", target: 1000 },    // Ramp to 1K
    { duration: "2m", target: 5000 },    // Ramp to 5K
    { duration: "3m", target: 10000 },   // Ramp to 10K
    { duration: "2m", target: 10000 },   // Hold 10K
    { duration: "1m", target: 0 },       // Ramp down
  ],
  thresholds: {
    ws_message_latency: ["p(95)<100"],   // 95th percentile < 100ms
    ws_messages_received: ["count>1000"],
  },
};

const BASE_URL = __ENV.WS_URL || "ws://localhost:8080/ws";
const JWT_TOKEN = __ENV.JWT_TOKEN || "test-token";

// Channel IDs to distribute load across
const CHANNEL_IDS = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
];

export default function () {
  const url = `${BASE_URL}?token=${JWT_TOKEN}`;
  const channelId = CHANNEL_IDS[Math.floor(Math.random() * CHANNEL_IDS.length)];

  const res = ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      // Send a message every 1-3 seconds
      socket.setInterval(() => {
        const sendTime = Date.now();
        const msg = JSON.stringify({
          type: "send_message",
          channel_id: channelId,
          content: `Load test message at ${sendTime}`,
        });
        socket.send(msg);
        messagesSent.add(1);
      }, Math.random() * 2000 + 1000);

      // Send periodic pings
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 10000);
    });

    socket.on("message", (data) => {
      messagesReceived.add(1);
      try {
        const msg = JSON.parse(data);
        if (msg.type === "new_message" && msg.created_at) {
          const latency = Date.now() - new Date(msg.created_at).getTime();
          if (latency > 0 && latency < 30000) {
            messageLatency.add(latency);
          }
        }
      } catch (_) {}
    });

    socket.on("error", (e) => {
      console.error("WS error:", e);
    });

    // Keep connection alive for the test duration
    sleep(30);
    socket.close();
  });

  check(res, {
    "WebSocket connected": (r) => r && r.status === 101,
  });
}
