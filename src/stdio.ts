import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

const FORCE_EXIT_TIMEOUT_MS = 10_000;

// ── Graceful shutdown ────────────────────────────────────────────────────
let isShuttingDown = false;

async function cleanup(reason: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.error(`[shutdown] ${reason} — cleaning up...`);

  // Safety net: force exit if graceful shutdown hangs
  const forceExitTimer = setTimeout(() => {
    console.error(`[shutdown] Force exit after ${FORCE_EXIT_TIMEOUT_MS}ms`);
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  forceExitTimer.unref();

  // Close MCP transport
  try {
    await transport.close();
    console.error("[mcp] Transport closed");
    clearTimeout(forceExitTimer);
  } catch {
    // Transport may already be closed
  }

  console.error("[shutdown] Done");
  process.exit(0);
}

// Only respond to explicit termination signals.
// Do NOT listen on stdin "end" — some MCP clients (e.g. Hermes) may
// transiently close the stdin pipe during initialization, which would
// trigger a premature shutdown. StdioServerTransport handles its own
// connection lifecycle internally.
process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));

// ── MCP protocol over stdio ──────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.nativeServer.connect(transport);

console.error("🚀 Mock MCP Server running (stdio mode)");
console.error("   Tools: 15 | Resources: 4 | Prompts: 3");
console.error("   All data is MOCK — no real operations are performed.");
