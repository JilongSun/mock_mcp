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
 *   Multi-worker mode is exclusive to `start` (background): pass `--workers N`
 *   (or `-w N`). Workers listen on sequential ports counting down from the base
 *   port (8760, 8759, 8758, …) and are recorded under a single job, so one
 *   `stop` closes them all.
 *
 *   `run` is always a single foreground instance — background workers are the
 *   only thing worth scaling out, and a detached pool is what `stop` manages.
 *
 * Usage
 * ─────
 *   pnpm run:v1                                   # foreground, port 8760
 *   pnpm start:v1                                 # background, 1 worker
 *   pnpm start:v1 -- --workers 3                  # background, 3 workers
 *   pnpm start:v1 -- --workers 3 --port 8760      # background, 3 workers
 *   pnpm stop:v1                                  # stop ALL background jobs
 *   pnpm stop:v1  -- --port 8760                  # stop just this job
 *   pnpm status:v1                                # list background jobs
 */

import {
  DEFAULT_PORT,
  formatAge,
  isAlive,
  isPortOpen,
  jobIdFor,
  logFileFor,
  removeJobs,
  saveJob,
  selectJobs,
  spawnDetachedWorker,
  spawnForegroundWorker,
  stopJob,
  waitForPort,
  workerPorts,
  type JobRecord,
} from "./scripts/process-manager.js";

// ─── Argument parsing ───────────────────────────────────────────────────
type Command = "run" | "start" | "stop" | "status";

/** How long `start` waits for the workers to actually bind their ports. */
const DEFAULT_START_TIMEOUT_MS = 45_000;

interface Options {
  command: Command;
  port: number;
  /** True when the user passed -p/--port explicitly. */
  portExplicit: boolean;
  /** Number of background workers; always 1 for `run`. */
  workers: number;
  /** Readiness budget for `start`. */
  timeoutMs: number;
  all: boolean;
}

const USAGE = `
mock-mcp process manager

Usage:
  tsx cli.ts <run|start|stop|status> [options]

Commands:
  run       Run in the foreground (Ctrl+C to stop) — always a single instance
  start     Run in the background (survives closing the terminal)
  stop      Stop background process(es) — stops everything by default
  status    List recorded background process(es)

Options:
  -p, --port <n>      Base port (default: ${DEFAULT_PORT})
  -w, --workers <n>   (start only) number of background workers (default: 1)
  -t, --timeout <s>   (start only) seconds to wait for readiness (default: 45)
  -a, --all           (stop) stop every recorded job — this is the default
  -h, --help          Show this help

Cold boot takes ~10-20s: "start" only reports success once every worker is
actually listening, and rolls back the job if a worker dies or never binds.
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
  let workersExplicit = false;
  let timeoutMs = DEFAULT_START_TIMEOUT_MS;
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
        portExplicit = true;
        break;
      }
      case "-w":
      case "--workers": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        workers = parsePositiveInt(next, arg);
        workersExplicit = true;
        break;
      }
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
        // Argument separator forwarded by pnpm (`pnpm start:v1 -- -w 3`) — ignore.
        break;
      default:
        fail(`unknown option "${arg}"`);
    }
  }

  if (port - workers + 1 < 1) {
    fail(`workers=${workers} would produce a port below 1 (base port ${port})`);
  }
  if (workersExplicit && command !== "start") {
    fail(`--workers only applies to "start" (background mode)`);
  }
  if (timeoutExplicit && command !== "start") {
    fail(`--timeout only applies to "start" (background mode)`);
  }
  if (command === "stop" && all && portExplicit) {
    fail(`"stop" accepts either --all or --port, not both`);
  }
  if ((command === "status" || command === "run" || command === "start") && all) {
    fail(`--all only applies to "stop"`);
  }

  return { command, port, portExplicit, workers, timeoutMs, all };
}

// ─── Foreground (`run`) ─────────────────────────────────────────────────
const FORCE_KILL_TIMEOUT_MS = 5_000;

async function runForeground(basePort: number): Promise<void> {
  let shuttingDown = false;

  console.log(`\n🚀 Running in the foreground on port ${basePort}...\n`);

  const child = spawnForegroundWorker(basePort);
  console.log(`  PID: ${child.pid ?? "starting..."}`);
  console.log(`\n✅ Running. Press Ctrl+C to stop.\n`);

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] Received ${signal}, stopping...\n`);

    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");

    // Safety net: force kill if the server hangs during shutdown.
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        console.log(`  PID ${child.pid} ignored SIGTERM → SIGKILL`);
        child.kill("SIGKILL");
      }
    }, FORCE_KILL_TIMEOUT_MS);
    forceKill.unref();

    await exited;
    clearTimeout(forceKill);
    console.log("[shutdown] Done\n");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const exitCode = await exited;
  if (!shuttingDown) console.error(`\n[run] Server exited (code ${exitCode}).\n`);
  process.exit(exitCode);
}

// ─── Background (`start`) ───────────────────────────────────────────────
async function startBackground(
  basePort: number,
  workers: number,
  timeoutMs: number,
): Promise<void> {
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
    console.log(`  Spawned → port ${port} (PID ${worker.pid})`);
  }

  // Persist before waiting, so a Ctrl+C during boot still leaves `stop` something to clean up.
  saveJob(record);

  // The port is only bound at the very end of the cold boot, so wait for real readiness.
  console.log(`\n⏳ Waiting for the server to bind (cold boot takes ~10–20s)...\n`);
  const results = await Promise.all(
    record.workers.map(async (worker) => ({
      worker,
      result: await waitForPort(worker.port, { pid: worker.pid, timeoutMs }),
    })),
  );

  const failed = results.filter((entry) => !entry.result.ready);
  for (const { worker, result } of results) {
    const seconds = (result.elapsedMs / 1000).toFixed(1);
    console.log(
      result.ready
        ? `  ✅ port ${worker.port} listening after ${seconds}s (PID ${worker.pid})`
        : `  ❌ port ${worker.port} NOT listening — ${
            result.reason === "exited" ? "worker exited" : `timed out after ${seconds}s`
          } (PID ${worker.pid})`,
    );
  }

  if (failed.length > 0) {
    console.error(`\n[error] ${failed.length}/${workers} worker(s) failed to start.`);
    console.error(`        Rolling back the job and cleaning up...`);
    console.error(`        Check the log for the reason: ${logFile}\n`);

    await stopJob(record);
    removeJobs([record.id]);
    process.exit(1);
  }

  console.log(`\n✅ Running in the background — closing this terminal will not stop it.`);
  console.log(`   Job:    ${id}`);
  console.log(
    `   Ports:  ${record.workers.map((worker) => worker.port).join(", ")}`,
  );
  console.log(`   MCP:    http://localhost:${basePort}/mcp`);
  console.log(`   Logs:   ${logFile}`);
  console.log(`   Status: pnpm status:v1`);
  console.log(`   Stop:   pnpm stop:v1\n`);
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
async function status(filterPort: number | undefined): Promise<void> {
  const jobs = selectJobs(filterPort);

  if (jobs.length === 0) {
    console.log("No recorded background job. Start one with: pnpm start:v1");
    return;
  }

  console.log("");
  for (const job of jobs) {
    console.log(`● ${job.id}  (${job.mode}, started ${formatAge(job.createdAt)})`);
    for (const worker of job.workers) {
      // A PID alone is not enough: the process can be alive but still booting,
      // or hung, so probe the port to report the state that actually matters.
      const alive = isAlive(worker.pid);
      const listening = alive && (await isPortOpen(worker.port));
      const state = !alive
        ? "DEAD (stale record)"
        : listening
          ? "running"
          : "alive but NOT listening (booting or hung)";
      console.log(`    port ${worker.port}  PID ${worker.pid}  ${state}`);
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
    await runForeground(options.port);
    break;
  case "start":
    await startBackground(options.port, options.workers, options.timeoutMs);
    break;
  case "stop":
    await stop(scope);
    break;
  case "status":
    await status(scope);
    break;
}
