/**
 * process-manager.ts — Local process registry & lifecycle helpers.
 *
 * Shared primitives used by `cli.ts`:
 *
 *   - A small JSON state file (`.run/processes.json`) that records every
 *     background job — single worker or multi worker — together with the
 *     ports and PIDs it owns. This is the "local record" that lets `stop`
 *     work without having to remember what was launched.
 *   - Detached spawning (`detached: true` + `unref()`) so background workers
 *     keep running after the launching terminal is closed.
 *   - A graceful SIGTERM → SIGKILL escalation used by `stop`.
 *
 * State lives in `packages/v1/.run/` (git-ignored) and logs in `.run/logs/`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Paths ──────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `packages/v1` — the workspace package that owns this script. */
export const PACKAGE_ROOT = path.resolve(HERE, "..");
export const RUN_DIR = path.join(PACKAGE_ROOT, ".run");
export const LOG_DIR = path.join(RUN_DIR, "logs");
export const STATE_FILE = path.join(RUN_DIR, "processes.json");

export const DEFAULT_PORT = 8760;
const STATE_VERSION = 1;
const STOP_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 100;

// ─── Types ──────────────────────────────────────────────────────────────
export type RunMode = "single" | "multi";

export interface WorkerRecord {
  /** TCP port this worker listens on. */
  port: number;
  /** OS process id of the detached `mcp-use start` process. */
  pid: number;
}

export interface JobRecord {
  /** Stable id, e.g. `single-8760` or `multi-8760x3`. */
  id: string;
  mode: RunMode;
  createdAt: string;
  /** Highest port of the range; workers count down from here. */
  basePort: number;
  logFile: string;
  workers: WorkerRecord[];
  /** Only set when a multi-worker launcher was recorded instead of raw workers. */
  launcherPid?: number;
}

interface StateFile {
  version: number;
  jobs: JobRecord[];
}

// ─── Filesystem helpers ─────────────────────────────────────────────────
export function ensureRunDirs(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readState(): StateFile {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as StateFile;
    if (!Array.isArray(parsed.jobs)) return { version: STATE_VERSION, jobs: [] };
    return { version: parsed.version ?? STATE_VERSION, jobs: parsed.jobs };
  } catch {
    // Missing or corrupt state file — start clean.
    return { version: STATE_VERSION, jobs: [] };
  }
}

function writeState(state: StateFile): void {
  ensureRunDirs();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// ─── Process helpers ────────────────────────────────────────────────────
/** True when `pid` exists and we are allowed to signal it. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Best-effort guard against PID reuse: only kill a process whose command line
 * still looks like ours. On platforms without `/proc` (macOS/Windows) we
 * cannot verify, so we optimistically return true.
 */
function looksLikeOurWorker(pid: number): boolean {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes("mcp-use");
  } catch {
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let remaining = pids.filter(isAlive);

  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    remaining = remaining.filter(isAlive);
  }
  return remaining;
}

// ─── Readiness probing ──────────────────────────────────────────────────
/**
 * Cold boot is slow: `mcp-use start` prints nothing for ~10–20s and only binds
 * the port at the very end (its child `node dist/index.js` does the listening).
 * So "spawned" is not "ready" — callers must probe the port instead of trusting
 * the spawn.
 */
function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** True when something currently accepts connections on 127.0.0.1:port. */
export function isPortOpen(port: number): Promise<boolean> {
  return probePort(port);
}

export interface ReadyResult {
  ready: boolean;
  elapsedMs: number;
  /** `exited` — the worker died while booting; `timeout` — still not listening. */
  reason?: "exited" | "timeout";
}

/** Poll until the worker listens on its port, dies, or the budget runs out. */
export async function waitForPort(
  port: number,
  opts: { pid: number; timeoutMs: number },
): Promise<ReadyResult> {
  const startedAt = Date.now();
  for (;;) {
    if (await probePort(port)) {
      return { ready: true, elapsedMs: Date.now() - startedAt };
    }
    if (!isAlive(opts.pid)) {
      return { ready: false, elapsedMs: Date.now() - startedAt, reason: "exited" };
    }
    if (Date.now() - startedAt >= opts.timeoutMs) {
      return { ready: false, elapsedMs: Date.now() - startedAt, reason: "timeout" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── Resolving the mcp-use binary ───────────────────────────────────────
interface Command {
  cmd: string;
  args: string[];
  shell: boolean;
}

function resolveMcpUse(): Command {
  const bin = path.join(PACKAGE_ROOT, "node_modules", ".bin", "mcp-use");
  if (fs.existsSync(bin)) return { cmd: bin, args: [], shell: false };
  // Fallback: let npx find a globally installed mcp-use.
  return { cmd: "npx", args: ["mcp-use"], shell: true };
}

function workerEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(port),
    MCP_URL: `http://localhost:${port}`,
  };
}

/** Ports used by a multi-worker run: basePort, basePort-1, … */
export function workerPorts(basePort: number, workers: number): number[] {
  return Array.from({ length: workers }, (_, i) => basePort - i);
}

export function jobIdFor(mode: RunMode, basePort: number, workers: number): string {
  return mode === "single" ? `single-${basePort}` : `multi-${basePort}x${workers}`;
}

export function logFileFor(jobId: string): string {
  return path.join(LOG_DIR, `${jobId}.log`);
}

/**
 * Spawn one detached worker that keeps running after this process (and its
 * terminal) goes away. Output is appended to `logFile`.
 */
export function spawnDetachedWorker(port: number, logFile: string): WorkerRecord {
  ensureRunDirs();
  const { cmd, args, shell } = resolveMcpUse();
  const fd = fs.openSync(logFile, "a");

  try {
    const child = spawn(cmd, [...args, "start", "--port", String(port)], {
      cwd: PACKAGE_ROOT,
      env: workerEnv(port),
      detached: true,
      stdio: ["ignore", fd, fd],
      shell,
    });

    // Detached children are unref'd so the launcher can exit immediately.
    child.unref();

    if (child.pid === undefined) {
      child.on("error", () => {});
      throw new Error(`failed to spawn worker for port ${port}`);
    }
    return { port, pid: child.pid };
  } finally {
    fs.closeSync(fd);
  }
}

/** Spawn a foreground worker whose stdio is attached to the terminal. */
export function spawnForegroundWorker(port: number): ChildProcess {
  const { cmd, args, shell } = resolveMcpUse();
  return spawn(cmd, [...args, "start", "--port", String(port)], {
    cwd: PACKAGE_ROOT,
    env: workerEnv(port),
    stdio: "inherit",
    shell,
  });
}

// ─── Job registry ───────────────────────────────────────────────────────
export function listJobs(): JobRecord[] {
  return readState().jobs;
}

/** Jobs selected by `stop`; no `port` means "everything". */
export function selectJobs(port?: number): JobRecord[] {
  const jobs = listJobs();
  if (port === undefined) return jobs;
  return jobs.filter(
    (job) => job.basePort === port || job.workers.some((w) => w.port === port),
  );
}

export function saveJob(job: JobRecord): void {
  const state = readState();
  const jobs = state.jobs.filter((j) => j.id !== job.id);
  jobs.push(job);
  writeState({ version: STATE_VERSION, jobs });
}

export function removeJobs(ids: string[]): void {
  const state = readState();
  const jobs = state.jobs.filter((j) => !ids.includes(j.id));
  writeState({ version: STATE_VERSION, jobs });
}

// ─── Stopping ───────────────────────────────────────────────────────────
export interface StopResult {
  job: JobRecord;
  /** PIDs that were asked to terminate and exited in time. */
  stopped: number[];
  /** PIDs that ignored SIGTERM and had to be SIGKILLed. */
  killed: number[];
  /** PIDs that were already gone (stale record). */
  stale: number[];
  /** PIDs skipped because they no longer look like our worker. */
  skipped: number[];
}

export async function stopJob(job: JobRecord): Promise<StopResult> {
  const pids = [
    ...(job.launcherPid !== undefined ? [job.launcherPid] : []),
    ...job.workers.map((w) => w.pid),
  ].filter((pid, i, arr) => arr.indexOf(pid) === i);

  const result: StopResult = { job, stopped: [], killed: [], stale: [], skipped: [] };
  const targets: number[] = [];

  for (const pid of pids) {
    if (!isAlive(pid)) {
      result.stale.push(pid);
      continue;
    }
    if (!looksLikeOurWorker(pid)) {
      result.skipped.push(pid);
      continue;
    }
    targets.push(pid);
  }

  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      result.stale.push(pid);
    }
  }

  const survivors = await waitForExit(targets, STOP_TIMEOUT_MS);
  result.stopped = targets.filter((pid) => !survivors.includes(pid));

  for (const pid of survivors) {
    try {
      process.kill(pid, "SIGKILL");
      result.killed.push(pid);
    } catch {
      result.stale.push(pid);
    }
  }

  return result;
}

/** Format an ISO timestamp as a short relative age, e.g. `3m12s ago`. */
export function formatAge(iso: string): string {
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
