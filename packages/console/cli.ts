#!/usr/bin/env node
/**
 * cli.ts — Console process manager.
 *
 * Subcommands
 * ───────────
 *   run     Foreground. Logs stream to the terminal; Ctrl+C stops the console.
 *   start   Background (detached). Survives closing the terminal, records its
 *           PID/port in `.run/console.json` and logs to `.run/logs/`.
 *   stop    Stops background console(s) recorded in the registry.
 *           Defaults to stopping **everything**; use `--port` to narrow it.
 *   status  Shows recorded console(s) and whether they are still serving.
 *
 * Stopping the console never stops a worker: workers are independent detached
 * services, and the console only reads/writes their registry.
 *
 * Usage:
 *   pnpm console                 # background, http://127.0.0.1:8790
 *   pnpm console:run             # foreground, Ctrl+C to stop
 *   pnpm console:status
 *   pnpm console:stop            # stops every console; --port narrows it
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_READY_TIMEOUT_MS,
  PACKAGE_ROOT,
  inspectInstance,
  listInstances,
  pruneInstances,
  spawnForegroundConsole,
  startConsole,
  stopConsole,
  type ConsoleInstance,
} from "./src/instance.js";
import {
  ALLOWED_HOSTS,
  FORCE_KILL_TIMEOUT_MS,
  LOOPBACK_HOST,
  SupervisorError,
  WILDCARD_HOST,
  accessUrls,
} from "@mock-mcp/supervisor";

type Command = "run" | "start" | "stop" | "status";

const DEFAULT_PORT = 8790;
const DEFAULT_HOST = LOOPBACK_HOST;

interface Options {
  command: Command;
  port: number;
  portExplicit: boolean;
  host: string;
  dev: boolean;
  timeoutMs: number;
  all: boolean;
}

const USAGE = `
mock-mcp worker console

Usage:
  tsx cli.ts <run|start|stop|status> [options]

Commands:
  run       Run in the foreground (Ctrl+C to stop)
  start     Run in the background (survives closing the terminal)
  stop      Stop background console(s) — stops everything by default
  status    List recorded background console(s)

Options:
  -p, --port <n>      Console port (default: ${DEFAULT_PORT})
  -H, --host <h>      Bind address: ${LOOPBACK_HOST} (this machine) or 0.0.0.0 (LAN)
      --dev           Serve the UI through Vite (HMR); mostly for \`run\`
  -t, --timeout <s>   (start) seconds to wait for readiness (default: 20)
  -a, --all           (stop) stop every recorded console — this is the default
  -h, --help          Show this help

The console manages workers but never runs one, and stopping the console never
stops a worker. Workers keep running until \`pnpm stop:v1\` (or the UI) stops them.
`.trim();

function fail(message: string): never {
  console.error(`Error: ${message}\n`);
  console.error(USAGE);
  process.exit(1);
}

function parsePositiveInt(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    fail(`${label} must be a positive integer (got "${raw}")`);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const [rawCommand, ...rest] = argv;
  const valid: Command[] = ["run", "start", "stop", "status"];
  if (!valid.includes(rawCommand as Command)) {
    fail(`unknown command "${rawCommand}"`);
  }
  const command = rawCommand as Command;

  let port = DEFAULT_PORT;
  let portExplicit = false;
  let host = DEFAULT_HOST;
  let hostExplicit = false;
  let dev = false;
  let timeoutMs = DEFAULT_READY_TIMEOUT_MS;
  let timeoutExplicit = false;
  let all = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case "-p":
      case "--port": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        port = parsePositiveInt(next, arg);
        if (port > 65_535) fail(`${arg} must be between 1 and 65535`);
        portExplicit = true;
        break;
      }
      case "-H":
      case "--host": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        if (!(ALLOWED_HOSTS as readonly string[]).includes(next)) {
          fail(`${arg} must be one of ${ALLOWED_HOSTS.join(", ")} (got "${next}")`);
        }
        host = next;
        hostExplicit = true;
        break;
      }
      case "--dev":
        dev = true;
        break;
      case "-t":
      case "--timeout": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        timeoutMs = parsePositiveInt(next, arg) * 1000;
        timeoutExplicit = true;
        break;
      }
      case "-a":
      case "--all":
        all = true;
        break;
      case "--":
        // Argument separator forwarded by pnpm — ignore.
        break;
      default:
        fail(`unknown option "${arg}"`);
    }
  }

  if (timeoutExplicit && command !== "start") {
    fail(`--timeout only applies to "start" (background mode)`);
  }
  if (all && command !== "stop") {
    fail(`--all only applies to "stop"`);
  }
  if (command === "stop" && all && portExplicit) {
    fail(`"stop" accepts either --all or --port, not both`);
  }
  if (hostExplicit && command === "status") {
    fail(`--host does not apply to "status"`);
  }

  return { command, port, portExplicit, host, dev, timeoutMs, all };
}

/** The built UI is what `start` serves; warn early instead of at first request. */
function warnIfUiMissing(dev: boolean): void {
  if (dev) return;
  const index = path.join(PACKAGE_ROOT, "dist", "ui", "index.html");
  if (!fs.existsSync(index)) {
    console.warn(
      "⚠  UI not built yet — run `pnpm build:console` first, or use `pnpm console:dev`.\n",
    );
  }
}

// ─── Foreground (`run`) ─────────────────────────────────────────────────
async function runForeground(options: Options): Promise<void> {
  if (options.dev) {
    console.log(`\n🛰  Starting the console in dev mode (Vite HMR)...\n`);
  } else {
    console.log(`\n🛰  Starting the console in the foreground on port ${options.port}...\n`);
    warnIfUiMissing(options.dev);
  }

  const child = spawnForegroundConsole(options);
  console.log(`  PID: ${child.pid ?? "starting..."}`);
  console.log(`\n✅ Press Ctrl+C to stop the console. Workers keep running.\n`);

  let shuttingDown = false;
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] received ${signal}, closing the console...`);

    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");

    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        console.log(`  PID ${child.pid} ignored SIGTERM → SIGKILL`);
        child.kill("SIGKILL");
      }
    }, FORCE_KILL_TIMEOUT_MS);
    forceKill.unref();

    await exited;
    clearTimeout(forceKill);
    console.log("[shutdown] console closed. Workers are still running.\n");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const exitCode = await exited;
  if (!shuttingDown) console.error(`\n[console] exited (code ${exitCode}).\n`);
  process.exit(exitCode);
}

// ─── Background (`start`) ───────────────────────────────────────────────
async function startBackground(options: Options): Promise<void> {
  warnIfUiMissing(options.dev);

  console.log(`\n🛰  Starting the console in the background on port ${options.port}...\n`);

  const { instance, ready } = await startConsole({
    port: options.port,
    host: options.host,
    dev: options.dev,
    timeoutMs: options.timeoutMs,
  });

  if (!ready.ready) {
    console.error(
      `❌ the console did not bind port ${options.port} — ${
        ready.reason === "exited" ? "it exited" : "timed out"
      }.`,
    );
    console.error(`   Check the log: ${instance.logFile}\n`);
    process.exit(1);
  }

  const seconds = (ready.elapsedMs / 1000).toFixed(1);
  console.log(`  ✅ ready after ${seconds}s (PID ${instance.pid})`);
  console.log(`\n✅ Running in the background — closing this terminal will not stop it.`);
  console.log(`   Bind:    ${instance.host}`);
  for (const url of accessUrls(instance.host, instance.port, "/")) {
    console.log(`   ${url.scope === "lan" ? "LAN:    " : "UI:     "} ${url.url}`);
  }
  for (const url of accessUrls(instance.host, instance.port, "/api")) {
    console.log(`   ${url.scope === "lan" ? "LAN API:" : "API:    "} ${url.url}`);
  }
  console.log(`   Logs:    ${instance.logFile}`);
  console.log(`   Status:  pnpm console:status`);
  console.log(`   Stop:    pnpm console:stop`);
  console.log(`\n   Workers are NOT stopped by the console — use pnpm stop:v1 for those.\n`);
}

// ─── Stop ───────────────────────────────────────────────────────────────
function selectInstances(port: number | undefined): ConsoleInstance[] {
  const instances = listInstances();
  return port === undefined
    ? instances
    : instances.filter((instance) => instance.port === port);
}

async function stop(port: number | undefined): Promise<void> {
  const instances = selectInstances(port);

  if (instances.length === 0) {
    const scope = port === undefined ? "" : ` on port ${port}`;
    console.log(`No recorded console${scope}. Nothing to stop.`);
    return;
  }

  console.log(`\n🛑 Stopping ${instances.length} console(s)...\n`);

  for (const instance of instances) {
    const report = await stopConsole(instance);
    const parts: string[] = [];
    if (report.stopped.length > 0) parts.push(`${report.stopped.length} stopped`);
    if (report.killed.length > 0) parts.push(`${report.killed.length} force-killed`);
    if (report.stale.length > 0) parts.push(`${report.stale.length} already dead`);
    if (report.skipped.length > 0) {
      parts.push(`${report.skipped.length} skipped (PID no longer looks like the console)`);
    }

    console.log(`  port ${instance.port} (PID ${instance.pid}) → ${parts.join(", ") || "nothing to do"}`);
    if (!report.portReleased) {
      console.log(`    ⚠ port ${instance.port} is still held by another process`);
    }
  }

  console.log(`\n✅ Removed ${instances.length} record(s).`);
  console.log(`   Workers were left untouched — stop them with pnpm stop:v1.\n`);
}

// ─── Status ─────────────────────────────────────────────────────────────
async function status(port: number | undefined): Promise<void> {
  const instances = pruneInstances();
  const selected = port === undefined
    ? instances
    : instances.filter((instance) => instance.port === port);

  if (selected.length === 0) {
    console.log("No running console. Start one with: pnpm console");
    return;
  }

  console.log("");
  for (const instance of selected) {
    const view = await inspectInstance(instance);
    const state = view.listening
      ? "running"
      : view.alive
        ? "alive but NOT listening (booting or hung)"
        : "DEAD (stale record)";
    console.log(`● console on port ${instance.port}  PID ${instance.pid}  ${state}`);
    for (const url of accessUrls(instance.host, instance.port, "/")) {
      console.log(`    url:  ${url.url}${url.scope === "lan" ? "  (LAN)" : ""}`);
    }
    for (const url of accessUrls(instance.host, instance.port, "/api")) {
      console.log(`    api:  ${url.url}${url.scope === "lan" ? "  (LAN)" : ""}`);
    }
    console.log(`    up:   ${formatAge(instance.startedAt)}`);
    console.log(`    logs: ${instance.logFile}`);
  }
  console.log("\nStop with: pnpm console:stop   (or --port <n> to narrow)\n");
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "unknown";

  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h${m}m ago`;
  if (m > 0) return `${m}m${s}s ago`;
  return `${s}s ago`;
}

// ─── Entry ──────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
const scope = options.portExplicit ? options.port : undefined;

try {
  switch (options.command) {
    case "run":
      await runForeground(options);
      break;
    case "start":
      await startBackground(options);
      break;
    case "stop":
      await stop(scope);
      break;
    case "status":
      await status(scope);
      break;
  }
} catch (err) {
  if (err instanceof SupervisorError) {
    console.error(`Error: ${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
