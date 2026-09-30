/**
 * cli.ts — Process manager for the mock-mcp HTTP server.
 *
 * Subcommands
 * ───────────
 *   run     Foreground. Logs stream to the terminal; Ctrl+C stops everything.
 *   start   Background (detached). Survives closing the terminal, writes its
 *           PIDs + ports into the local state file (`.run/processes.json`)
 *           and logs to `.run/logs/*.log`.
 *   stop    Stops background job(s) recorded in the state file.
 *           Defaults to stopping **everything**; use `--port` to narrow it.
 *   status  Shows recorded background job(s) and whether they are still alive.
 *
 * Multi-worker
 * ────────────
 *   Pass `--workers N` (or `-w N`) to any of `run` / `start`. Workers listen on
 *   sequential ports counting down from the base port (8760, 8759, 8758, …).
 *   In background mode every worker is recorded under a single job, so one
 *   `stop` closes them all.
 *
 * Usage
 * ─────
 *   pnpm run:v1                                   # foreground, 1 worker
 *   pnpm run:v1   -- --workers 3                  # foreground, 3 workers
 *   pnpm start:v1                                 # background, 1 worker
 *   pnpm start:v1 -- --workers 3 --port 8760      # background, 3 workers
 *   pnpm stop:v1                                  # stop ALL background jobs
 *   pnpm stop:v1  -- --port 8760                  # stop just this job
 *   pnpm status:v1                                # list background jobs
 */

import type { ChildProcess } from "node:child_process";
import {
  DEFAULT_PORT,
  formatAge,
  isAlive,
  jobIdFor,
  logFileFor,
  removeJobs,
  saveJob,
  selectJobs,
  spawnDetachedWorker,
  spawnForegroundWorker,
  stopJob,
  workerPorts,
  type JobRecord,
} from "./scripts/process-manager.js";

// ─── Argument parsing ───────────────────────────────────────────────────
type Command = "run" | "start" | "stop" | "status";

interface Options {
  command: Command;
  port: number;
  /** True when the user passed -p/--port explicitly. */
  portExplicit: boolean;
  workers: number;
  all: boolean;
}

const USAGE = `
mock-mcp process manager

Usage:
  tsx cli.ts <run|start|stop|status> [options]

Commands:
  run       Run in the foreground (Ctrl+C to stop)
  start     Run in the background (survives closing the terminal)
  stop      Stop background process(es) — stops everything by default
  status    List recorded background process(es)

Options:
  -p, --port <n>      Base port (default: ${DEFAULT_PORT})
  -w, --workers <n>   Number of workers (default: 1)
  -a, --all           (stop) stop every recorded job — this is the default
  -h, --help          Show this help
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
  let workers = 1;
  let all = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    switch (arg) {
      case "-p":
      case "--port": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        port = parsePositiveInt(next, arg);
        portExplicit = true;
        break;
      }
      case "-w":
      case "--workers": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        workers = parsePositiveInt(next, arg);
        break;
      }
      case "-a":
      case "--all":
        all = true;
        break;
      case "--":
        // Argument separator forwarded by pnpm (`pnpm start:v1 -- -w 3`) — ignore.
        break;
      default:
        fail(`unknown option "${arg}"`);
    }
  }

  if (port - workers + 1 < 1) {
    fail(`workers=${workers} would produce a port below 1 (base port ${port})`);
  }
  if (command === "stop" && all && portExplicit) {
    fail(`"stop" accepts either --all or --port, not both`);
  }
  if ((command === "status" || command === "run" || command === "start") && all) {
    fail(`--all only applies to "stop"`);
  }

  return { command, port, portExplicit, workers, all };
}

// ─── Foreground (`run`) ─────────────────────────────────────────────────
const FORCE_KILL_TIMEOUT_MS = 5_000;

async function runForeground(basePort: number, workers: number): Promise<void> {
  const ports = workerPorts(basePort, workers);
  const children: ChildProcess[] = [];
  let shuttingDown = false;

  console.log(`\n🚀 Running ${workers} worker(s) in the foreground...\n`);

  for (const port of ports) {
    const child = spawnForegroundWorker(port);
    children.push(child);
    console.log(`  Worker → port ${port} (PID: ${child.pid ?? "starting..."})`);
    // Small stagger to avoid port conflicts during startup
    if (port !== ports[ports.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`\n✅ All ${workers} worker(s) running. Press Ctrl+C to stop.\n`);

  const allExited = new Promise<void>((resolve) => {
    let remaining = children.length;
    for (const child of children) {
      child.on("exit", () => {
        if (--remaining === 0) resolve();
      });
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] Received ${signal}, stopping all workers...\n`);

    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }

    // Safety net: force kill anything still hanging around.
    const forceKill = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          console.log(`  PID ${child.pid} ignored SIGTERM → SIGKILL`);
          child.kill("SIGKILL");
        }
      }
    }, FORCE_KILL_TIMEOUT_MS);
    forceKill.unref();

    await allExited;
    clearTimeout(forceKill);
    console.log("[shutdown] Done\n");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await allExited;

  // A worker died on its own — mirror the first non-zero exit code.
  const exitCode = children.reduce((code, child) => code || child.exitCode || 0, 0);
  if (!shuttingDown) {
    console.error(`\n[run] A worker exited (code ${exitCode}). Shutting down.\n`);
  }
  process.exit(exitCode);
}

// ─── Background (`start`) ───────────────────────────────────────────────
function startBackground(basePort: number, workers: number): void {
  const active = selectJobs(basePort).filter((job) =>
    job.workers.some((worker) => isAlive(worker.pid)),
  );
  if (active.length > 0) {
    console.error(
      `Error: background job "${active[0].id}" already owns port ${basePort}.`,
    );
    console.error(`Run "pnpm stop:v1" first, or pass a different --port.\n`);
    process.exit(1);
  }

  const mode = workers > 1 ? "multi" : "single";
  const id = jobIdFor(mode, basePort, workers);
  const logFile = logFileFor(id);
  const ports = workerPorts(basePort, workers);

  console.log(`\n🚀 Starting ${workers} worker(s) in the background...\n`);

  const record: JobRecord = {
    id,
    mode,
    createdAt: new Date().toISOString(),
    basePort,
    logFile,
    workers: [],
  };

  for (const port of ports) {
    const worker = spawnDetachedWorker(port, logFile);
    record.workers.push(worker);
    console.log(`  Worker → port ${port} (PID: ${worker.pid})`);
  }

  saveJob(record);

  console.log(`\n✅ Running in the background — closing this terminal will not stop it.`);
  console.log(`   Job:  ${id}`);
  console.log(`   Logs: ${logFile}`);
  console.log(`   Stop: pnpm stop:v1\n`);
}

// ─── Stop ───────────────────────────────────────────────────────────────
async function stop(filterPort: number | undefined): Promise<void> {
  const jobs = selectJobs(filterPort);

  if (jobs.length === 0) {
    const scope = filterPort === undefined ? "" : ` on port ${filterPort}`;
    console.log(`No recorded background job${scope}. Nothing to stop.`);
    return;
  }

  console.log(`\n🛑 Stopping ${jobs.length} job(s)...\n`);

  const stoppedIds: string[] = [];
  for (const job of jobs) {
    const result = await stopJob(job);
    stoppedIds.push(job.id);

    const parts: string[] = [];
    if (result.stopped.length > 0) parts.push(`${result.stopped.length} stopped`);
    if (result.killed.length > 0) parts.push(`${result.killed.length} force-killed`);
    if (result.stale.length > 0) parts.push(`${result.stale.length} already dead`);
    if (result.skipped.length > 0) parts.push(`${result.skipped.length} skipped`);

    const ports = job.workers.map((worker) => worker.port).join(", ");
    console.log(`  ${job.id} (ports ${ports}) → ${parts.join(", ") || "nothing to do"}`);
  }

  removeJobs(stoppedIds);
  console.log(`\n✅ Removed ${stoppedIds.length} record(s) from the local state file.\n`);
}

// ─── Status ─────────────────────────────────────────────────────────────
function status(filterPort: number | undefined): void {
  const jobs = selectJobs(filterPort);

  if (jobs.length === 0) {
    console.log("No recorded background job. Start one with: pnpm start:v1");
    return;
  }

  console.log("");
  for (const job of jobs) {
    console.log(`● ${job.id}  (${job.mode}, started ${formatAge(job.createdAt)})`);
    for (const worker of job.workers) {
      const alive = isAlive(worker.pid);
      console.log(
        `    port ${worker.port}  PID ${worker.pid}  ${alive ? "running" : "DEAD (stale record)"}`,
      );
    }
    console.log(`    logs: ${job.logFile}`);
  }
  console.log("\nStop with: pnpm stop:v1   (or --port <n> to narrow)\n");
}

// ─── Entry ──────────────────────────────────────────────────────────────
const options = parseArgs(process.argv.slice(2));
const scope = options.portExplicit ? options.port : undefined;

switch (options.command) {
  case "run":
    await runForeground(options.port, options.workers);
    break;
  case "start":
    startBackground(options.port, options.workers);
    break;
  case "stop":
    await stop(scope);
    break;
  case "status":
    status(scope);
    break;
}
