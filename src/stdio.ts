import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

// ── Side HTTP server for pre-built widget assets ─────────────────────────
// MCP protocol → stdio (identical to HTTP mode: 15 tools, 4 resources, 3 prompts, 3 widgets)
// Widget JS/CSS → HTTP on WIDGET_PORT (assets are pre-built by `npm run build`)
const WIDGET_PORT = parseInt(process.env.WIDGET_PORT || "8761", 10);

// IMPORTANT: Set MCP_URL BEFORE importing server, so widget URLs in MCP
// responses point to the correct widget asset HTTP server (not localhost:3000).
process.env.MCP_URL = `http://localhost:${WIDGET_PORT}`;

// Dynamic import — evaluated after MCP_URL is set above
const { server } = await import("./server.js");
const FORCE_EXIT_TIMEOUT_MS = 10_000;

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(baseDir: string): Parameters<typeof createServer>[0] {
  return (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${WIDGET_PORT}`);
    const filePath = join(baseDir, url.pathname.replace(/^\/+/, ""));
    const ext = extname(filePath).toLowerCase();

    if (existsSync(filePath) && MIME[ext]) {
      res.writeHead(200, { "Content-Type": MIME[ext], "Access-Control-Allow-Origin": "*" });
      res.end(readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  };
}

// ── Graceful shutdown ────────────────────────────────────────────────────
let isShuttingDown = false;

async function cleanup(reason: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.error(`[shutdown] ${reason} — cleaning up...`);

  // Close widget HTTP server (no-op if not listening)
  if (widgetServer.listening) {
    await new Promise<void>((resolve) => {
      widgetServer.close(() => {
        console.error(`[widgets] Port ${WIDGET_PORT} released`);
        resolve();
      });
    });
  }

  // Close MCP transport
  try {
    await transport.close();
    console.error("[mcp] Transport closed");
  } catch {
    // Transport may already be closed
  }

  console.error("[shutdown] Done");
  process.exit(0);
}

// Safety net: force exit if graceful shutdown hangs
const forceExitTimer = setTimeout(() => {
  console.error(`[shutdown] Force exit after ${FORCE_EXIT_TIMEOUT_MS}ms`);
  process.exit(1);
}, FORCE_EXIT_TIMEOUT_MS);
// Don't keep the timer alive if we exit cleanly
forceExitTimer.unref();

// stdin close = parent process (MCP client) disconnected — primary trigger
process.stdin.on("end", () => cleanup("stdin closed (client disconnected)"));

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));

// Prevent unhandled rejections from crashing the process during shutdown
process.on("unhandledRejection", (reason) => {
  console.error(`[shutdown] Unhandled rejection: ${reason}`);
});

// ── Widget HTTP server ───────────────────────────────────────────────────
const widgetServer: Server = createServer(serveStatic(join("dist", "resources", "widgets")));

try {
  await new Promise<void>((resolve, reject) => {
    widgetServer.once("error", reject);
    widgetServer.listen(WIDGET_PORT, () => {
      console.error(`[widgets] Assets served at http://localhost:${WIDGET_PORT}`);
      resolve();
    });
  });
} catch (err: any) {
  if (err?.code === "EADDRINUSE") {
    console.error(`[widgets] WARNING: Port ${WIDGET_PORT} is in use — widget assets unavailable`);
    console.error(`[widgets] Free the port or set WIDGET_PORT to a different value`);
  } else {
    throw err;
  }
}

// ── MCP protocol over stdio ──────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.nativeServer.connect(transport);

console.error("🚀 Mock MCP Server running (stdio mode + HTTP widgets)");
console.error(`   Widget assets: http://localhost:${WIDGET_PORT}`);
console.error(`   Set WIDGET_PORT env var to change the widget asset port`);
console.error("   All data is MOCK — no real operations are performed.");
console.error("   Capabilities: IDENTICAL to HTTP mode (15 tools, 4 resources, 3 prompts, 3 widgets)");
