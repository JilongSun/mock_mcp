/**
 * cli.ts — Multi-Worker Launcher for mcp-use HTTP Server
 *
 * Launches multiple independent MCP server instances on sequential ports
 * starting from 8760 and decrementing. Each worker runs as a separate child
 * process via `mcp-use start` with its own PORT and MCP_URL environment.
 *
 * Use cases:
 *   - Load balancing: spread MCP client connections across workers behind
 *     a reverse proxy (nginx, HAProxy, etc.)
 *   - Workload isolation: assign different agent teams or environments
 *     (staging / production) to dedicated workers
 *   - Rolling restarts: restart workers individually without downtime
 *
 * Usage:
 *   npm run start:multi -- --workers 3
 *   npm run start:multi -- -w 5
 */

import { spawn, type ChildProcess } from "node:child_process";

// ─── Parse CLI arguments ────────────────────────────────────────────
function parseArgs(args: string[]): { workers: number } {
  const workersIndex =
    args.indexOf("--workers") !== -1
      ? args.indexOf("--workers")
      : args.indexOf("-w");

  if (workersIndex === -1 || workersIndex + 1 >= args.length) {
    console.error("Usage: tsx cli.ts --workers <number>");
    console.error("Example: tsx cli.ts --workers 3");
    process.exit(1);
  }

  const count = parseInt(args[workersIndex + 1], 10);
  if (isNaN(count) || count < 1) {
    console.error("Error: --workers must be a positive integer");
    process.exit(1);
  }

  return { workers: count };
}

// ─── Main ────────────────────────────────────────────────────────────
const START_PORT = 8760;
const { workers } = parseArgs(process.argv.slice(2));
const children: ChildProcess[] = [];

console.log(`\n🚀 Starting ${workers} worker(s)...\n`);

for (let i = 0; i < workers; i++) {
  const port = START_PORT - i;
  const env = {
    ...process.env,
    PORT: String(port),
    MCP_URL: `http://localhost:${port}`,
  };

  const child = spawn("npx", ["mcp-use", "start", "--port", String(port)], {
    env,
    stdio: "inherit",
    shell: true,
  });

  children.push(child);
  console.log(`  Worker ${i + 1}/${workers} → port ${port} (PID: ${child.pid ?? "starting..."})`);

  // Small stagger to avoid port conflicts during startup
  if (i < workers - 1) {
    await new Promise((r) => setTimeout(r, 300));
  }
}

console.log(`\n✅ All ${workers} workers started. Press Ctrl+C to stop all.\n`);

// ─── Graceful shutdown ──────────────────────────────────────────────
let isShuttingDown = false;

function cleanup(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[shutdown] Received ${signal}, stopping all workers...\n`);

  const killed = children.map((child, i) => {
    const port = START_PORT - i;
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      console.log(`  Worker ${i + 1} (port ${port}) → SIGTERM sent`);
    }
    return child;
  });

  // Force kill after 5 seconds
  setTimeout(() => {
    killed.forEach((child, i) => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        console.log(`  Worker ${i + 1} (port ${START_PORT - i}) → force killed`);
      }
    });
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => cleanup("SIGINT"));
process.on("SIGTERM", () => cleanup("SIGTERM"));
