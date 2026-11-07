#!/usr/bin/env node
/**
 * server.ts — Worker console.
 *
 * Serves the JSON API (see `src/api.ts`) and, unless `--dev` is used, the built
 * UI from `dist/ui`. The console never runs a worker itself: it drives the same
 * registry and spawn/stop primitives as the CLI, so workers started in a
 * terminal show up here and vice versa.
 *
 * Usage:
 *   tsx server.ts                 # http://127.0.0.1:8790 (built UI)
 *   tsx server.ts --dev           # Vite dev server with HMR on :5173
 *   tsx server.ts --port 8791     # custom console port
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_HOSTS,
  LOG_DIR,
  LOOPBACK_HOST,
  RUN_DIR,
  SupervisorError,
  WILDCARD_HOST,
  accessUrls,
  listLanAddresses,
  listRuntimes,
} from "@mock-mcp/supervisor";
import { handleApiRequest } from "./src/api.js";
import { HttpError, sendError } from "./src/http.js";
import { createStaticHandler } from "./src/static.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, "dist", "ui");
const VERSION = "1.0.0";
const DEFAULT_PORT = 8790;
const DEFAULT_HOST = LOOPBACK_HOST;
const POLL_INTERVAL_MS = 2_000;

interface Options {
  port: number;
  host: string;
  dev: boolean;
}

const USAGE = `
mock-mcp worker console

Usage:
  tsx server.ts [options]

Options:
  -p, --port <n>   Console port (default: ${DEFAULT_PORT})
      --host <h>   Bind address (default: ${DEFAULT_HOST}, loopback only)
      --dev        Serve the UI through Vite (HMR) and proxy the API here
  -h, --help       Show this help

The console starts, stops and supervises workers, but never runs one itself —
it shares the registry with the CLI (pnpm start:v1 / stop:v1 / status:v1).
`.trim();

function fail(message: string): never {
  console.error(`Error: ${message}\n`);
  console.error(USAGE);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;
  let dev = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "-p":
      case "--port": {
        const next = argv[++index];
        if (next === undefined) fail(`${arg} requires a value`);
        port = Number(next);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          fail(`${arg} must be a port between 1 and 65535 (got "${next}")`);
        }
        break;
      }
      case "--host": {
        const next = argv[++index];
        if (next === undefined) fail(`${arg} requires a value`);
        host = next;
        break;
      }
      case "--dev":
        dev = true;
        break;
      case "--":
        break;
      default:
        fail(`unknown option "${arg}"`);
    }
  }

  return { port, host, dev };
}

function startVite(): ChildProcess {
  const bin = path.join(HERE, "node_modules", ".bin", "vite");
  const exists = fs.existsSync(bin);
  const child = spawn(exists ? bin : "npx", exists ? [] : ["vite"], {
    cwd: HERE,
    stdio: "inherit",
    env: process.env,
  });
  return child;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!(ALLOWED_HOSTS as readonly string[]).includes(options.host)) {
    fail(`--host must be one of ${ALLOWED_HOSTS.join(", ")} (got "${options.host}")`);
  }
  if (options.host === WILDCARD_HOST && listLanAddresses().length === 0) {
    console.warn(
      "⚠  no LAN address found — the console is only reachable from this machine for now.\n",
    );
  }

  const startedAt = new Date().toISOString();
  const apiContext = {
    host: options.host,
    consolePort: options.port,
    version: VERSION,
    startedAt,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
  const serveStatic = createStaticHandler(UI_DIR);

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      try {
        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
          await handleApiRequest(req, res, url, apiContext);
          return;
        }
        if (url.pathname === "/favicon.ico") {
          res.writeHead(204).end();
          return;
        }
        if (options.dev) {
          sendError(res, 404, "NOT_FOUND", "dev mode serves the UI from Vite on :5173");
          return;
        }
        serveStatic(res, url.pathname);
      } catch (err) {
        if (res.headersSent) {
          res.destroy();
          return;
        }
        if (err instanceof SupervisorError) {
          sendError(res, err.status, err.code, err.message);
          return;
        }
        if (err instanceof HttpError) {
          sendError(res, err.status, err.code, err.message);
          return;
        }
        console.error("[console] request failed:", err);
        sendError(res, 500, "INTERNAL_ERROR", (err as Error).message);
      }
    })();
  });

  let shuttingDown = false;
  let vite: ChildProcess | null = null;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[console] received ${signal}, closing...`);
    if (vite && vite.exitCode === null) vite.kill("SIGTERM");
    server.close(() => process.exit(0));
    // Workers are detached; the console exiting never stops them.
    setTimeout(() => process.exit(0), 1_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  const runtimes = listRuntimes();

  console.log("\n🛰  mock-mcp worker console\n");
  if (options.dev) {
    console.log("   UI:       http://127.0.0.1:5173 (vite dev)");
  } else {
    for (const url of accessUrls(options.host, options.port, "/")) {
      console.log(`   ${url.scope === "lan" ? "LAN:     " : "UI:      "} ${url.url}`);
    }
  }
  for (const url of accessUrls(options.host, options.port, "/api")) {
    console.log(`   ${url.scope === "lan" ? "LAN API: " : "API:     "} ${url.url}`);
  }
  console.log(`   Registry: ${path.join(RUN_DIR, "workers.json")}`);
  console.log(`   Logs:     ${LOG_DIR}`);
  console.log(
    `   Runtimes: ${runtimes.map((runtime) => runtime.label).join(", ") || "none"}`,
  );
  console.log(`\n   Polling every ${POLL_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);

  if (runtimes.length === 0) {
    console.warn("⚠  No worker runtime found — is the workspace built? (pnpm install)\n");
  }

  if (options.dev) {
    vite = startVite();
    vite.on("exit", (code) => {
      if (shuttingDown) return;
      console.error(`[console] vite exited (code ${code ?? 0}); stopping the console.`);
      process.exit(code ?? 0);
    });
  }
}

await main();
