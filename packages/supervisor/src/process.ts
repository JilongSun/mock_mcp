/**
 * Process primitives: liveness, port probing, detached spawning and
 * SIGTERM → SIGKILL termination.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { isWildcardHost, resolveMcpUrl } from "./network.js";
import { ensureRunDirs } from "./paths.js";
import { resolveRuntimeCommand, type ResolvedRuntime } from "./runtimes.js";

export const STOP_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 100;
const FORCE_KILL_TIMEOUT_MS = 5_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when `pid` exists and we are allowed to signal it. */
export function isAlive(pid: number | null): boolean {
  if (pid === null || pid <= 0) return false;
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

/**
 * Cold boot is slow: `mcp-use start` prints nothing for ~10–20s and only binds
 * the port at the very end (its child `node dist/index.js` does the listening).
 * So "spawned" is not "ready" — callers must probe the port instead.
 *
 * Both loopback families are probed: a server listening on `localhost` binds to
 * whichever family that name resolves to on the host, so probing only one of
 * them would report a healthy server as down.
 */
function probeHost(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
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

/** True when something accepts connections on either loopback family. */
function probeLoopback(port: number, timeoutMs = 500): Promise<boolean> {
  return Promise.all([
    probeHost("127.0.0.1", port, timeoutMs),
    probeHost("::1", port, timeoutMs),
  ]).then(([ipv4, ipv6]) => ipv4 || ipv6);
}

function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  return probeLoopback(port, timeoutMs);
}

/**
 * True when a service bound to `host` is accepting connections.
 *
 * A wildcard bind answers on every interface, so loopback is the cheapest way to
 * ask without depending on a LAN address that may have changed. A specific
 * bind host (e.g. a LAN address) is probed directly instead.
 */
export function probeService(port: number, host: string): Promise<boolean> {
  return isWildcardHost(host) ? probeLoopback(port) : probeHost(host, port, 500);
}

/** True when something currently accepts connections on 127.0.0.1:port. */
export function isPortOpen(port: number): Promise<boolean> {
  return probePort(port);
}

/**
 * PIDs listening on a TCP port, via `lsof` (macOS/Linux). Best effort: returns
 * an empty list when `lsof` is unavailable, so callers must handle "unknown".
 */
export function pidsListeningOn(port: number): number[] {
  try {
    const out = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", timeout: 3_000 },
    );
    if (out.status !== 0 && !out.stdout) return [];
    return out.stdout
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Full command line of a PID via `ps`, or `null` when it cannot be read. */
export function pidCommand(pid: number): string | null {
  try {
    const out = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 3_000,
    });
    const command = out.stdout?.trim();
    return command ? command : null;
  } catch {
    return null;
  }
}

/** Parent PID of a process, or `null` when it cannot be read. */
export function pidParent(pid: number): number | null {
  try {
    const out = spawnSync("ps", ["-p", String(pid), "-o", "ppid="], {
      encoding: "utf8",
      timeout: 3_000,
    });
    const parent = Number.parseInt(out.stdout?.trim() ?? "", 10);
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

/** Working directory of a process, via `lsof`, or `null` when unreadable. */
export function pidCwd(pid: number): string | null {
  try {
    const out = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      timeout: 3_000,
    });
    const line = out.stdout?.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

/** True when `pid` is `ancestor` or runs in its process tree (bounded depth). */
export function hasAncestor(pid: number, ancestor: number, maxHops = 3): boolean {
  let current = pid;
  for (let hop = 0; hop < maxHops; hop++) {
    if (current === ancestor) return true;
    const parent = pidParent(current);
    if (parent === null || parent <= 1) return false;
    current = parent;
  }
  return current === ancestor;
}

/**
 * Whether the listener on `port` is `pid` or one of its descendants.
 *
 * The recorded pid is the `mcp-use` wrapper; the child it spawns is what binds
 * the port. When the ownership cannot be determined (no `lsof`, no visible
 * pid) this returns true, so readiness still works on platforms where the
 * tooling is unavailable.
 */
function portBelongsTo(pid: number | null, port: number): boolean {
  if (pid === null) return true;
  const owners = pidsListeningOn(port);
  if (owners.length === 0) return true;
  return owners.some((owner) => hasAncestor(owner, pid));
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
  opts: { pid: number | null; timeoutMs: number; host?: string },
): Promise<ReadyResult> {
  const startedAt = Date.now();
  const probe = (): Promise<boolean> =>
    opts.host === undefined ? probePort(port) : probeService(port, opts.host);

  for (;;) {
    // Liveness first: a port that answers may belong to some other process, so
    // "the port is open" alone must never be reported as our worker being ready.
    if (!isAlive(opts.pid)) {
      return { ready: false, elapsedMs: Date.now() - startedAt, reason: "exited" };
    }
    if ((await probe()) && (await portBelongsTo(opts.pid, port))) {
      return { ready: true, elapsedMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt >= opts.timeoutMs) {
      return { ready: false, elapsedMs: Date.now() - startedAt, reason: "timeout" };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function workerEnv(port: number, host: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(port),
    // mcp-use defaults its listen host to `localhost`, which resolves to a
    // different family depending on the machine — so always pin it explicitly.
    HOST: host,
    // Baked into the widget HTML and server metadata, so it must be an address
    // clients can reach: loopback for a loopback bind, a LAN address for a
    // wildcard bind (see resolveMcpUrl).
    MCP_URL: resolveMcpUrl(host, port),
  };
}

/**
 * Spawn one detached worker that keeps running after this process (and its
 * terminal) goes away. Output is appended to `logFile`.
 */
export function spawnDetachedWorker(
  runtime: ResolvedRuntime,
  opts: { port: number; host: string; logFile: string },
): number {
  ensureRunDirs();
  const { cmd, args, shell } = resolveRuntimeCommand(runtime);
  const fd = fs.openSync(opts.logFile, "a");

  try {
    const child = spawn(cmd, [...args, "start", "--port", String(opts.port)], {
      cwd: runtime.packagePath,
      env: workerEnv(opts.port, opts.host),
      detached: true,
      stdio: ["ignore", fd, fd],
      shell,
    });

    // Detached children are unref'd so the launcher can exit immediately.
    child.unref();

    if (child.pid === undefined) {
      child.on("error", () => {});
      throw new Error(`failed to spawn worker for port ${opts.port}`);
    }
    return child.pid;
  } finally {
    fs.closeSync(fd);
  }
}

/** Spawn a foreground worker whose stdio is attached to the terminal. */
export function spawnForegroundWorker(
  runtime: ResolvedRuntime,
  port: number,
  host: string,
): ChildProcess {
  const { cmd, args, shell } = resolveRuntimeCommand(runtime);
  return spawn(cmd, [...args, "start", "--port", String(port)], {
    cwd: runtime.packagePath,
    env: workerEnv(port, host),
    stdio: "inherit",
    shell,
  });
}

export interface TerminateResult {
  /** PIDs that were asked to terminate and exited in time. */
  stopped: number[];
  /** PIDs that ignored SIGTERM and had to be SIGKILLed. */
  killed: number[];
  /** PIDs that were already gone (stale record). */
  stale: number[];
  /** PIDs skipped because they no longer look like our worker. */
  skipped: number[];
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let remaining = pids.filter((pid) => isAlive(pid));

  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    remaining = remaining.filter((pid) => isAlive(pid));
  }
  return remaining;
}

/** SIGTERM the given PIDs, escalating to SIGKILL for those that survive. */
export async function terminatePids(
  pids: number[],
  opts: { timeoutMs?: number } = {},
): Promise<TerminateResult> {
  const result: TerminateResult = { stopped: [], killed: [], stale: [], skipped: [] };
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

  const survivors = await waitForExit(targets, opts.timeoutMs ?? STOP_TIMEOUT_MS);
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

export { FORCE_KILL_TIMEOUT_MS };
