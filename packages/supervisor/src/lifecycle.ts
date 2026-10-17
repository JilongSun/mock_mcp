/**
 * Worker lifecycle: start, stop, restart, remove and inspect.
 *
 * The console and the CLI both go through this module, so a worker started in
 * one place is fully visible and manageable from the other.
 */

import {
  hasAncestor,
  isAlive,
  isPortOpen,
  pidCommand,
  pidCwd,
  pidsListeningOn,
  spawnDetachedWorker,
  terminatePids,
  waitForPort,
  type ReadyResult,
  type TerminateResult,
} from "./process.js";
import {
  getWorker,
  groupIdFor,
  listWorkers,
  logFileFor,
  patchWorker,
  removeWorkerRecord,
  upsertWorker,
  workerIdFor,
} from "./registry.js";
import { getRuntime, listRuntimes, type ResolvedRuntime } from "./runtimes.js";
import type {
  WorkerProtocol,
  WorkerRecord,
  WorkerStatus,
  WorkerView,
} from "./types.js";

/** A worker is only reported as "starting" for this long after a spawn. */
export const STARTING_GRACE_MS = 60_000;

/**
 * How long a port-ownership answer may be reused on the *display* path.
 *
 * `lsof` scans every process on the machine (~30–100ms here), so paying it for
 * every worker on every poll is wasteful — ownership does not change from one
 * second to the next. The safety-critical path (reclaiming a port while
 * stopping) always measured it live and still does.
 */
export const OWNERSHIP_TTL_MS = 20_000;
const MIN_PORT = 1024;
const MAX_PORT = 65_535;

export class SupervisorError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SupervisorError";
    this.code = code;
    this.status = status;
  }
}

export interface StartWorkerOptions {
  runtime: string;
  port: number;
  name?: string;
  capabilities?: string[];
  protocol?: WorkerProtocol | null;
  groupId?: string;
}

function requireRuntime(id: string): ResolvedRuntime {
  const runtime = getRuntime(id);
  if (!runtime) {
    const available = listRuntimes().map((entry) => entry.id).join(", ") || "none";
    throw new SupervisorError(
      "UNKNOWN_RUNTIME",
      `unknown runtime "${id}" (available: ${available})`,
    );
  }
  return runtime;
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new SupervisorError(
      "INVALID_PORT",
      `port must be an integer between ${MIN_PORT} and ${MAX_PORT} (got "${port}")`,
    );
  }
}

/**
 * Start a detached worker and record it. Returns as soon as the process is
 * spawned — callers that need "actually listening" should await
 * `waitForWorker()` (the console polls instead, so the UI can show "starting").
 */
export function startWorker(options: StartWorkerOptions): WorkerRecord {
  const runtime = requireRuntime(options.runtime);
  assertPort(options.port);

  const existing = getWorker(workerIdFor(options.port));
  if (existing) {
    throw new SupervisorError(
      "WORKER_EXISTS",
      `port ${options.port} is already recorded as worker "${existing.id}" — start, restart or remove it instead`,
      409,
    );
  }

  const now = new Date().toISOString();
  const id = workerIdFor(options.port);
  const record: WorkerRecord = {
    id,
    name: options.name?.trim() || `worker-${options.port}`,
    runtime: runtime.id,
    port: options.port,
    pid: null,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    desiredState: "running",
    groupId: options.groupId ?? groupIdFor(1, options.port),
    logFile: logFileFor(id),
    capabilities: options.capabilities ?? [],
    protocol: options.protocol ?? null,
  };

  record.pid = spawnDetachedWorker(runtime, { port: record.port, logFile: record.logFile });
  invalidatePortOwnership(record.port);
  return upsertWorker(record);
}

export interface WorkerStopReport extends TerminateResult {
  worker: WorkerRecord;
  /** Whether the worker's port is free again after stopping. */
  portReleased: boolean;
}

/**
 * True when the process on `pid` still looks like the worker we recorded:
 * either the `mcp-use` wrapper itself, or a process running from the worker's
 * package directory (the wrapper's child, which is what binds the port).
 */
function isOurProcess(pid: number, runtime: ResolvedRuntime | undefined): boolean {
  const command = pidCommand(pid);
  if (command === null) return false;
  if (command.includes("mcp-use")) return true;
  if (runtime === undefined) return false;

  if (command.includes(runtime.packagePath)) return true;
  const cwd = pidCwd(pid);
  return cwd !== null && cwd.startsWith(runtime.packagePath);
}

export interface PortOwnership {
  /** PIDs currently listening on the worker's port. */
  owners: number[];
  /** True when the recorded PID (or one of its children) owns the port. */
  owned: boolean;
}

/**
 * Who holds the worker's port. A PID alone is not enough to call a worker
 * "running": the port could be held by an unrelated service, which would make
 * a crashed worker look healthy.
 */
export function inspectPortOwnership(record: WorkerRecord): PortOwnership {
  const owners = pidsListeningOn(record.port);
  if (owners.length === 0) return { owners, owned: false };
  if (record.pid === null) return { owners, owned: false };

  const owned = owners.some((pid) => hasAncestor(pid, record.pid as number));
  return { owners, owned };
}

// ─── Cached ownership (display path only) ───────────────────────────────
interface OwnershipCacheEntry {
  /** `null` matches a record that never spawned anything. */
  pid: number | null;
  owners: number[];
  owned: boolean;
  at: number;
}

const ownershipCache = new Map<number, OwnershipCacheEntry>();

/** Forget a port's cached ownership; called whenever we change its state. */
function invalidatePortOwnership(port: number): void {
  ownershipCache.delete(port);
}

/**
 * Port ownership, reused for `OWNERSHIP_TTL_MS`.
 *
 * `anythingListening` is the caller's freshly probed answer to "is something on
 * this port right now", which is cheap (one loopback connect). The cached answer
 * is only reused while it agrees with that signal, so the cache can never claim
 * a quiet port is occupied — it only avoids re-running `lsof` to re-derive *who*
 * is there. The residual window is a port that stays busy while changing hands,
 * which is reported as ours for at most the TTL.
 */
function cachedPortOwnership(
  record: WorkerRecord,
  anythingListening: boolean,
): PortOwnership {
  const now = Date.now();
  const cached = ownershipCache.get(record.port);
  const usable =
    cached !== undefined &&
    cached.pid === record.pid &&
    now - cached.at < OWNERSHIP_TTL_MS &&
    cached.owners.length > 0 === anythingListening;

  if (usable) return { owners: cached.owners, owned: cached.owned };

  const fresh = inspectPortOwnership(record);
  ownershipCache.set(record.port, {
    pid: record.pid,
    owners: fresh.owners,
    owned: fresh.owned,
    at: now,
  });
  return fresh;
}

/**
 * The recorded PID is the `mcp-use start` wrapper; the process that actually
 * holds the port is its child. After the wrapper is gone the child is
 * re-parented, so the port is freed by signalling whatever still listens on it
 * — but only when that process still looks like ours, so an unrelated service
 * is never killed.
 */
async function releasePort(record: WorkerRecord): Promise<boolean> {
  if (!(await isPortOpen(record.port))) return true;

  const runtime = getRuntime(record.runtime);
  const ownership = inspectPortOwnership(record);
  const candidates = (ownership.owners.length > 0 ? ownership.owners : []).filter(
    (pid) => ownership.owned || isOurProcess(pid, runtime),
  );
  if (candidates.length === 0) return false;

  await terminatePids(candidates);
  return !(await isPortOpen(record.port));
}

export async function stopWorker(id: string): Promise<WorkerStopReport> {
  const record = getWorker(id);
  if (!record) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }

  const result = await terminatePids(record.pid === null ? [] : [record.pid]);
  const portReleased = await releasePort(record);

  patchWorker(id, {
    desiredState: "stopped",
    updatedAt: new Date().toISOString(),
  });
  invalidatePortOwnership(record.port);

  return { worker: { ...record, desiredState: "stopped" }, portReleased, ...result };
}

export interface RemoveWorkerOptions {
  /** `false` when the caller already stopped the worker. */
  stop?: boolean;
}

export async function removeWorker(
  id: string,
  options: RemoveWorkerOptions = {},
): Promise<void> {
  const record = getWorker(id);
  if (record === undefined) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }
  if (options.stop !== false) await stopWorker(id);
  removeWorkerRecord(id);
  invalidatePortOwnership(record.port);
}

/** Stop and respawn a worker with its recorded configuration. */
export async function restartWorker(id: string): Promise<WorkerRecord> {
  const record = getWorker(id);
  if (!record) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }

  const runtime = requireRuntime(record.runtime);
  const stopped = await stopWorker(id);
  if (!stopped.portReleased) {
    throw new SupervisorError(
      "PORT_BUSY",
      `port ${record.port} is still held by a process that is not this worker`,
      409,
    );
  }

  const now = new Date().toISOString();
  const pid = spawnDetachedWorker(runtime, {
    port: record.port,
    logFile: record.logFile,
  });
  invalidatePortOwnership(record.port);

  return (
    patchWorker(id, {
      pid,
      desiredState: "running",
      startedAt: now,
      updatedAt: now,
    }) ?? record
  );
}

/** Start a recorded worker that is currently stopped or exited. */
export async function startRecordedWorker(id: string): Promise<WorkerRecord> {
  const record = getWorker(id);
  if (!record) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }
  if (isAlive(record.pid)) {
    throw new SupervisorError(
      "ALREADY_RUNNING",
      `worker "${id}" is already running (PID ${record.pid})`,
      409,
    );
  }
  if (!(await releasePort(record))) {
    throw new SupervisorError(
      "PORT_BUSY",
      `port ${record.port} is still held by another process`,
      409,
    );
  }

  const runtime = requireRuntime(record.runtime);
  const now = new Date().toISOString();
  const pid = spawnDetachedWorker(runtime, {
    port: record.port,
    logFile: record.logFile,
  });
  invalidatePortOwnership(record.port);

  return (
    patchWorker(id, { pid, desiredState: "running", startedAt: now, updatedAt: now }) ??
    record
  );
}

/** Wait until a worker is listening, exits, or the budget runs out. */
export function waitForWorker(id: string, timeoutMs: number): Promise<ReadyResult> {
  const record = getWorker(id);
  if (!record) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }
  return waitForPort(record.port, { pid: record.pid, timeoutMs });
}

export async function inspectWorker(record: WorkerRecord): Promise<WorkerView> {
  const alive = isAlive(record.pid);
  // "Is anything listening?" is one loopback connect — cheap, so always fresh.
  // "Is it *ours*?" needs lsof, so that part is cached (see cachedPortOwnership).
  const anythingListening = alive ? await isPortOpen(record.port) : false;
  const ownership = anythingListening
    ? cachedPortOwnership(record, anythingListening)
    : { owners: [] as number[], owned: false };
  const listening = ownership.owned;
  const portTakenByOther = anythingListening && !ownership.owned;
  const startedAt = record.startedAt ?? record.createdAt;
  const age = Date.now() - new Date(startedAt).getTime();

  let status: WorkerStatus;
  if (record.desiredState === "stopped") {
    status = alive ? "stopping" : "stopped";
  } else if (!alive) {
    status = "exited";
  } else if (listening) {
    status = "running";
  } else {
    status = age < STARTING_GRACE_MS ? "starting" : "unresponsive";
  }

  return {
    ...record,
    runtimeLabel: getRuntime(record.runtime)?.label ?? record.runtime,
    status,
    alive,
    listening,
    portTakenByOther,
    uptimeMs: alive ? Date.now() - new Date(startedAt).getTime() : null,
  };
}

export async function inspectWorkers(): Promise<WorkerView[]> {
  return Promise.all(listWorkers().map((record) => inspectWorker(record)));
}

export async function inspectWorkerById(id: string): Promise<WorkerView> {
  const record = getWorker(id);
  if (!record) {
    throw new SupervisorError("NOT_FOUND", `no worker with id "${id}"`, 404);
  }
  return inspectWorker(record);
}

/** Highest port at or below the runtime default that is recorded-free and unbound. */
export async function findFreePort(
  runtimeId: string,
  options: { exclude?: number[] } = {},
): Promise<number> {
  const runtime = requireRuntime(runtimeId);
  const taken = new Set(listWorkers().map((worker) => worker.port));
  for (const port of options.exclude ?? []) taken.add(port);

  for (let port = runtime.defaultPort; port >= MIN_PORT; port--) {
    if (taken.has(port)) continue;
    if (await isPortOpen(port)) continue;
    return port;
  }
  throw new SupervisorError(
    "NO_FREE_PORT",
    `no free port at or below ${runtime.defaultPort}`,
    409,
  );
}
