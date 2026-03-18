import ws from "k6/ws";
import http from "k6/http";
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
    { duration: "15s", target: 50 },
    { duration: "30s", target: 200 },
    { duration: "30s", target: 500 },
    { duration: "1m", target: 500 },
    { duration: "15s", target: 0 },
  ],
  thresholds: {
    ws_message_latency: ["p(95)<500"],
    ws_connection_errors: ["rate<0.1"],
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:8080/ws";
const API_URL = __ENV.API_URL || "http://localhost:4001";
const PRESENCE_URL = __ENV.PRESENCE_URL || "http://localhost:4002";

const CHANNEL_IDS = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
];

// Each VU registers its own user and gets a unique token
export function setup() {
  // Create test channels if they don't exist (ignored if already created)
  const adminRes = http.post(
    `${API_URL}/auth/register`,
    JSON.stringify({ username: `admin_${Date.now()}`, password: "password123" }),
    { headers: { "Content-Type": "application/json" } }
  );
  return { baseTime: Date.now() };
}

export default function (data) {
  // Register a unique user per VU iteration
  const username = `load_${__VU}_${__ITER}_${data.baseTime}`;
  const regRes = http.post(
    `${API_URL}/auth/register`,
    JSON.stringify({ username, password: "password123" }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (regRes.status !== 200) {
    connectionErrors.add(1);
    return;
  }

  const token = JSON.parse(regRes.body).token;
  const channelId = CHANNEL_IDS[Math.floor(Math.random() * CHANNEL_IDS.length)];

  // Send heartbeat to presence service so broadcast targeting works
  http.post(
    `${PRESENCE_URL}/presence/heartbeat`,
    JSON.stringify({ channel_id: channelId }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  // Connect WebSocket
  const url = `${WS_URL}?token=${token}`;
  const res = ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      // Send messages every 1-3 seconds
      socket.setInterval(() => {
        const msg = JSON.stringify({
          type: "send_message",
          channel_id: channelId,
          content: `Load test ${Date.now()}`,
        });
        socket.send(msg);
        messagesSent.add(1);
      }, Math.random() * 2000 + 1000);

      // Refresh presence heartbeat every 15s
      socket.setInterval(() => {
        http.post(
          `${PRESENCE_URL}/presence/heartbeat`,
          JSON.stringify({ channel_id: channelId }),
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );
      }, 15000);

      // Ping every 10s
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 10000);
    });

    socket.on("message", (rawData) => {
      messagesReceived.add(1);
      try {
        const msg = JSON.parse(rawData);
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
