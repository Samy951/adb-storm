import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";

const messagesReceived = new Counter("ws_messages_received");
const messagesSent = new Counter("ws_messages_sent");
const messageLatency = new Trend("ws_message_latency", true);
const connectionErrors = new Rate("ws_connection_errors");

// Cloud test: ramp to 2000 connections
export const options = {
  setupTimeout: "5m",
  stages: [
    { duration: "20s", target: 100 },
    { duration: "30s", target: 500 },
    { duration: "30s", target: 1000 },
    { duration: "1m", target: 2000 },
    { duration: "2m", target: 2000 },   // Hold 2K
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    ws_message_latency: ["p(95)<500"],
    ws_connection_errors: ["rate<0.05"],
  },
};

const WS_URL = __ENV.WS_URL || "ws://localhost:8080/ws";
const API_URL = __ENV.API_URL || "http://localhost:4001";
const PRESENCE_URL = __ENV.PRESENCE_URL || "http://localhost:4002";

const CHANNEL_IDS = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
  "00000000-0000-0000-0000-000000000004",
  "00000000-0000-0000-0000-000000000005",
];

// Pre-register users in setup using batch requests
export function setup() {
  const tokens = [];
  const totalUsers = 1000;
  const batchSize = 50;
  const ts = Date.now();

  console.log(`Registering ${totalUsers} users in batches of ${batchSize}...`);
  for (let batch = 0; batch < totalUsers; batch += batchSize) {
    const requests = [];
    for (let i = batch; i < Math.min(batch + batchSize, totalUsers); i++) {
      requests.push(["POST", `${API_URL}/auth/register`, JSON.stringify({
        username: `storm_${ts}_${i}`,
        password: "password123",
      }), { headers: { "Content-Type": "application/json" }, timeout: "30s" }]);
    }
    const responses = http.batch(requests);
    for (const res of responses) {
      if (res.status === 200) {
        tokens.push(JSON.parse(res.body).token);
      }
    }
    if (batch % 200 === 0) console.log(`  ${tokens.length}/${totalUsers} registered`);
  }
  console.log(`Setup complete: ${tokens.length} users registered`);
  return { tokens };
}

export default function (data) {
  const tokenIndex = (__VU - 1) % data.tokens.length;
  const token = data.tokens[tokenIndex];
  if (!token) {
    connectionErrors.add(1);
    return;
  }

  const channelId = CHANNEL_IDS[__VU % CHANNEL_IDS.length];

  // Heartbeat
  http.post(
    `${PRESENCE_URL}/presence/heartbeat`,
    JSON.stringify({ channel_id: channelId }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      timeout: "10s",
    }
  );

  // WebSocket
  const url = `${WS_URL}?token=${token}`;
  const res = ws.connect(url, {}, function (socket) {
    socket.on("open", () => {
      // Send message every 2-4s
      socket.setInterval(() => {
        socket.send(
          JSON.stringify({
            type: "send_message",
            channel_id: channelId,
            content: `Storm ${Date.now()}`,
          })
        );
        messagesSent.add(1);
      }, Math.random() * 2000 + 2000);

      // Heartbeat every 20s
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
      }, 20000);

      // Ping every 15s
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: "ping" }));
      }, 15000);
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

    sleep(25);
    socket.close();
  });

  const connected = check(res, {
    "WebSocket connected": (r) => r && r.status === 101,
  });
  if (!connected) {
    connectionErrors.add(1);
  }
}
