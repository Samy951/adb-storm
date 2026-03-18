import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";

// Custom metrics
const messagesReceived = new Counter("ws_messages_received");
const messagesSent = new Counter("ws_messages_sent");
const messageLatency = new Trend("ws_message_latency", true);
const connectionErrors = new Rate("ws_connection_errors");

// Local test: ramp to 500 max (safe for macOS)
export const options = {
  stages: [
    { duration: "15s", target: 50 },    // Warm up
    { duration: "30s", target: 200 },   // Ramp to 200
    { duration: "30s", target: 500 },   // Ramp to 500
    { duration: "1m", target: 500 },    // Hold 500
    { duration: "15s", target: 0 },     // Ramp down
  ],
  thresholds: {
    ws_message_latency: ["p(95)<500"],    // p95 < 500ms (local)
    ws_connection_errors: ["rate<0.1"],   // < 10% connection failures
  },
};

const BASE_URL = __ENV.WS_URL || "ws://localhost:8080/ws";
const JWT_TOKEN = __ENV.JWT_TOKEN || "test-token";

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
      socket.setInterval(() => {
        const msg = JSON.stringify({
          type: "send_message",
          channel_id: channelId,
          content: `Load test ${Date.now()}`,
        });
        socket.send(msg);
        messagesSent.add(1);
      }, Math.random() * 2000 + 1000);

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

    socket.on("error", () => {
      connectionErrors.add(1);
    });

    sleep(20);
    socket.close();
  });

  const connected = check(res, {
    "WebSocket connected": (r) => r && r.status === 101,
  });
  if (!connected) {
    connectionErrors.add(1);
  }
}
