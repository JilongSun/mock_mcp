/**
 * cli.ts — Process manager for the mock-mcp HTTP server.
 *
 * Subcommands
 * ───────────
 *   run     Foreground. Logs stream to the terminal; Ctrl+C stops everything.
 *   start   Background (detached). Survives closing the terminal and records
 *           every worker in the shared registry (`.run/workers.json`), which
 *           the worker console also reads and writes.
 *   stop    Stops background worker(s) recorded in the registry.
 *           Defaults to stopping **everything**; use `--port` to narrow it.
 *   status  Shows recorded background worker(s) and whether they are still alive.
 *
 * Multi-worker
 * ────────────
 *   Multi-worker mode is exclusive to `start` (background): pass `--workers N`
 *   (or `-w N`). Workers listen on sequential ports counting down from the base
 *   port (8760, 8759, 8758, …) and are recorded under a single group, so one
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
 *   pnpm stop:v1                                  # stop ALL background workers
 *   pnpm stop:v1  -- --port 8760                  # stop just this worker
 *   pnpm status:v1                                # list background workers
 *
 * The same workers can be started, stopped and watched from the console:
 *   pnpm console
 */

import {
  ALLOWED_HOSTS,
  FORCE_KILL_TIMEOUT_MS,
  LOG_DIR,
  LOOPBACK_HOST,
  SupervisorError,
  WILDCARD_HOST,
  accessUrls,
  getRuntime,
  groupIdFor,
  inspectWorkers,
  isAlive,
  listWorkers,
  portsFor,
  primaryLanAddress,
  removeWorker,
  spawnForegroundWorker,
  startWorker,
  stopWorker,
  waitForWorker,
  type WorkerRecord,
  type WorkerView,
} from "@mock-mcp/supervisor";

// ─── Argument parsing ───────────────────────────────────────────────────
type Command = "run" | "start" | "stop" | "status";

const RUNTIME_ID = "v1";
const DEFAULT_PORT = getRuntime(RUNTIME_ID)?.defaultPort ?? 8760;
/** How long `start` waits for the workers to actually bind their ports. */
const DEFAULT_START_TIMEOUT_MS = 45_000;

interface Options {
  command: Command;
  port: number;
  /** Bind address for the worker. */
  host: string;
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
  stop      Stop background worker(s) — stops everything by default
  status    List recorded background worker(s)

Options:
  -p, --port <n>      Base port (default: ${DEFAULT_PORT})
  -H, --host <ip>     Bind address: ${LOOPBACK_HOST} (this machine) or 0.0.0.0 (LAN)
  -w, --workers <n>   (start only) number of background workers (default: 1)
  -t, --timeout <s>   (start only) seconds to wait for readiness (default: 45)
  -a, --all           (stop) stop every recorded worker — this is the default
  -h, --help          Show this help

Cold boot takes ~10-20s: "start" only reports success once every worker is
actually listening, and rolls back the group if a worker dies or never binds.
Workers can also be managed from the console: pnpm console
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
  let host = LOOPBACK_HOST;
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
      case "-H":
      case "--host": {
        const next = rest[++i];
        if (next === undefined) fail(`${arg} requires a value`);
        if (!(ALLOWED_HOSTS as readonly string[]).includes(next)) {
          fail(`${arg} must be one of ${ALLOWED_HOSTS.join(", ")} (got "${next}")`);
        }
        host = next;
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

  return { command, port, host, portExplicit, workers, timeoutMs, all };
}

// ─── Foreground (`run`) ─────────────────────────────────────────────────
async function runForeground(basePort: number, host: string): Promise<void> {
  const runtime = getRuntime(RUNTIME_ID);
  if (!runtime) fail(`runtime "${RUNTIME_ID}" is not available in this workspace`);

  let shuttingDown = false;

  console.log(`\n🚀 Running in the foreground on ${host}:${basePort}...\n`);

  const child = spawnForegroundWorker(runtime, basePort, host);
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
  host: string,
): Promise<void> {
  const ports = portsFor(basePort, workers);

  const taken = listWorkers().filter(
    (worker) => ports.includes(worker.port) && isAlive(worker.pid),
  )[0];
  if (taken) {
    console.error(
      `Error: worker "${taken.id}" already owns port ${taken.port} (PID ${taken.pid}).`,
    );
    console.error(`Run "pnpm stop:v1" first, or pass a different --port.\n`);
    process.exit(1);
  }

  const groupId = groupIdFor(workers, basePort);
  console.log(`\n🚀 Starting ${workers} worker(s) in the background...\n`);

  const records: WorkerRecord[] = [];
  for (const port of ports) {
    let record;
    try {
      record = startWorker({ runtime: RUNTIME_ID, port, host, groupId });
    } catch (err) {
      if (err instanceof SupervisorError) {
        console.error(`Error: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
    records.push(record);
    console.log(`  Spawned → port ${record.port} (PID ${record.pid})`);
  }

  // The port is only bound at the very end of the cold boot, so wait for real readiness.
  console.log(`\n⏳ Waiting for the server to bind (cold boot takes ~10–20s)...\n`);
  const results = await Promise.all(
    records.map(async (record) => ({
      record,
      ready: await waitForWorker(record.id, timeoutMs),
    })),
  );

  const failed = results.filter((entry) => !entry.ready.ready);
  for (const { record, ready } of results) {
    const seconds = (ready.elapsedMs / 1000).toFixed(1);
    console.log(
      ready.ready
        ? `  ✅ port ${record.port} listening after ${seconds}s (PID ${record.pid})`
        : `  ❌ port ${record.port} NOT listening — ${
            ready.reason === "exited" ? "worker exited" : `timed out after ${seconds}s`
          } (PID ${record.pid})`,
    );
  }

  if (failed.length > 0) {
    console.error(`\n[error] ${failed.length}/${workers} worker(s) failed to start.`);
    console.error(`        Rolling back the group and cleaning up...`);
    console.error(`        Check the logs for the reason: ${LOG_DIR}\n`);

    for (const record of records) {
      await stopWorker(record.id).catch(() => undefined);
      await removeWorker(record.id, { stop: false }).catch(() => undefined);
    }
    process.exit(1);
  }

  console.log(`\n✅ Running in the background — closing this terminal will not stop it.`);
  console.log(`   Group:  ${groupId}`);
  console.log(`   Ports:  ${records.map((record) => record.port).join(", ")}`);
  console.log(`   Bind:   ${host}`);
  for (const url of accessUrls(host, basePort, "/mcp")) {
    const label = url.scope === "lan" ? "LAN:   " : "Local: ";
    console.log(`   ${label} ${url.url}`);
  }
  if (host === WILDCARD_HOST && primaryLanAddress() === null) {
    console.log(`   ⚠ no LAN address found — remote clients cannot reach it yet`);
  }
  console.log(
    records.length === 1
      ? `   Logs:   ${records[0].logFile}`
      : `   Logs:   ${LOG_DIR} (one file per worker)`,
  );
  console.log(`   Status: pnpm status:v1`);
  console.log(`   Stop:   pnpm stop:v1`);
  console.log(`   Console: pnpm console\n`);
}

// ─── Stop ───────────────────────────────────────────────────────────────
function selectWorkers(filterPort: number | undefined) {
  const workers = listWorkers();
  if (filterPort === undefined) return workers;
  return workers.filter((worker) => worker.port === filterPort);
}

async function stop(filterPort: number | undefined): Promise<void> {
  const workers = selectWorkers(filterPort);

  if (workers.length === 0) {
    const scope = filterPort === undefined ? "" : ` on port ${filterPort}`;
    console.log(`No recorded background worker${scope}. Nothing to stop.`);
    return;
  }

  const groups = groupByGroupId(workers);
  console.log(`\n🛑 Stopping ${groups.length} group(s)...\n`);

  let removed = 0;
  for (const group of groups) {
    const parts: string[] = [];
    const counts = { stopped: 0, killed: 0, stale: 0, skipped: 0 };
    let portStuck = false;

    for (const worker of group.workers) {
      const report = await stopWorker(worker.id);
      counts.stopped += report.stopped.length;
      counts.killed += report.killed.length;
      counts.stale += report.stale.length;
      counts.skipped += report.skipped.length;
      if (!report.portReleased) portStuck = true;
      await removeWorker(worker.id, { stop: false });
      removed++;
    }

    if (counts.stopped > 0) parts.push(`${counts.stopped} stopped`);
    if (counts.killed > 0) parts.push(`${counts.killed} force-killed`);
    if (counts.stale > 0) parts.push(`${counts.stale} already dead`);
    if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);

    const ports = group.workers.map((worker) => worker.port).join(", ");
    console.log(`  ${group.id} (ports ${ports}) → ${parts.join(", ") || "nothing to do"}`);
    if (portStuck) {
      console.log(`    ⚠ port still held by a process that is not our worker`);
    }
  }

  console.log(`\n✅ Removed ${removed} record(s) from the local registry.\n`);
}

interface WorkerGroup<T extends WorkerRecord> {
  id: string;
  workers: T[];
}

/** Workers started together share a `groupId`; order groups by newest first. */
function groupByGroupId<T extends WorkerRecord>(records: T[]): WorkerGroup<T>[] {
  const groups = new Map<string, WorkerGroup<T>>();
  for (const worker of records) {
    const group = groups.get(worker.groupId) ?? { id: worker.groupId, workers: [] };
    group.workers.push(worker);
    groups.set(worker.groupId, group);
  }
  return [...groups.values()].sort((a, b) => newest(b.workers) - newest(a.workers));
}

function newest(workers: WorkerRecord[]): number {
  return Math.max(...workers.map((worker) => new Date(worker.createdAt).getTime()));
}

// ─── Status ─────────────────────────────────────────────────────────────
async function status(filterPort: number | undefined): Promise<void> {
  const workers = selectWorkers(filterPort);

  if (workers.length === 0) {
    console.log("No recorded background worker. Start one with: pnpm start:v1");
    return;
  }

  const views = await inspectWorkers();
  const selected = views.filter((view) =>
    workers.some((worker) => worker.id === view.id),
  );

  console.log("");
  for (const group of groupByGroupId(selected)) {
    const mode = group.workers.length > 1 ? "multi" : "single";
    const started = Math.min(
      ...group.workers.map((worker) => new Date(worker.createdAt).getTime()),
    );
    console.log(
      `● ${group.id}  (${mode}, started ${formatAge(new Date(started).toISOString())})`,
    );
    for (const worker of group.workers) {
      // A PID alone is not enough: the process can be alive but still booting,
      // or hung, so the port is probed to report the state that actually matters.
      const conflict = worker.portTakenByOther ? "  ⚠ port held by another process" : "";
      console.log(
        `    port ${worker.port}  PID ${worker.pid ?? "-"}  ${describeStatus(worker)}${conflict}`,
      );
      console.log(`      logs: ${worker.logFile}`);
    }
  }
  console.log("\nStop with: pnpm stop:v1   (or --port <n> to narrow)");
  console.log("Manage in the console with: pnpm console\n");
}

function describeStatus(worker: WorkerView): string {
  switch (worker.status) {
    case "running":
      return "running";
    case "starting":
    case "unresponsive":
      return "alive but NOT listening (booting or hung)";
    case "stopping":
      return "stopping but still alive";
    case "stopped":
      return "stopped";
    default:
      return "DEAD (stale record)";
  }
}

/** Format an ISO timestamp as a short relative age, e.g. `3m12s ago`. */
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
      await runForeground(options.port, options.host);
      break;
    case "start":
      await startBackground(
        options.port,
        options.workers,
        options.timeoutMs,
        options.host,
      );
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
