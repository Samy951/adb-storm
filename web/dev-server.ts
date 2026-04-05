/**
 * Dev server — serves static files + proxies API/WS to Docker services.
 * Run: bun run dev
 * Then open http://localhost:5173
 */

const API_TARGET = "http://localhost:4001";   // message-service
const WS_TARGET = "ws://localhost:3001";      // gateway
const PRESENCE_TARGET = "http://localhost:4002"; // presence-service

// Build TS with watch mode
const buildProc = Bun.spawn(
  ["bun", "build", "ts/main.ts", "--outdir", "dist/", "--watch"],
  { cwd: import.meta.dir, stdout: "inherit", stderr: "inherit" }
);

process.on("SIGINT", () => {
  buildProc.kill();
  process.exit(0);
});

const server = Bun.serve({
  port: 5173,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade → proxy to gateway
    if (url.pathname === "/ws" && req.headers.get("upgrade") === "websocket") {
      const success = server.upgrade(req, { data: { search: url.search } });
      if (success) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Proxy API routes to message-service
    if (url.pathname.startsWith("/auth") || url.pathname.startsWith("/channels")) {
      const target = `${API_TARGET}${url.pathname}${url.search}`;
      return fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }

    // Proxy presence routes
    if (url.pathname.startsWith("/presence")) {
      const target = `${PRESENCE_TARGET}${url.pathname}${url.search}`;
      return fetch(target, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }

    // Serve static files
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`${import.meta.dir}${filePath}`);
    if (await file.exists()) return new Response(file);

    // SPA fallback
    return new Response(Bun.file(`${import.meta.dir}/index.html`));
  },
  websocket: {
    open(ws) {
      const search = (ws.data as any).search || "";
      const target = `${WS_TARGET}/ws${search}`;
      const upstream = new WebSocket(target);

      upstream.onmessage = (event) => ws.send(event.data);
      upstream.onclose = () => ws.close();
      upstream.onerror = () => ws.close();

      (ws.data as any).upstream = upstream;
    },
    message(ws, message) {
      const upstream = (ws.data as any).upstream as WebSocket;
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(message);
      }
    },
    close(ws) {
      const upstream = (ws.data as any).upstream as WebSocket;
      upstream?.close();
    },
  },
});

console.log(`\n  Dev server running at http://localhost:${server.port}`);
console.log(`  TS watch mode active — edit and refresh\n`);
