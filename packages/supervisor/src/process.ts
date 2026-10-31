/**
 * Process primitives: liveness, port probing, detached spawning and
 * SIGTERM → SIGKILL termination.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
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
 * whichever family the OS resolves first (`[::1]` on macOS, `127.0.0.1`
 * elsewhere), so probing only IPv4 would report a healthy server as down.
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

/** True when something currently accepts connections on either loopback family. */
function probePort(port: number, timeoutMs = 500): Promise<boolean> {
  return Promise.all([
    probeHost("127.0.0.1", port, timeoutMs),
    probeHost("::1", port, timeoutMs),
  ]).then(([ipv4, ipv6]) => ipv4 || ipv6);
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

export interface ReadyResult {
  ready: boolean;
  elapsedMs: number;
  /** `exited` — the worker died while booting; `timeout` — still not listening. */
  reason?: "exited" | "timeout";
}

/** Poll until the worker listens on its port, dies, or the budget runs out. */
export async function waitForPort(
  port: number,
  opts: { pid: number | null; timeoutMs: number },
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

export function workerEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PORT: String(port),
    // mcp-use defaults its listen host to `localhost`, which resolves to a
    // different family depending on the machine — so pin it to IPv4 loopback,
    // the address `.mcp.json` and the docs advertise. Override with HOST=... .
    HOST: process.env.HOST ?? "127.0.0.1",
    MCP_URL: `http://localhost:${port}`,
  };
}

/**
 * Spawn one detached worker that keeps running after this process (and its
 * terminal) goes away. Output is appended to `logFile`.
 */
export function spawnDetachedWorker(
  runtime: ResolvedRuntime,
  opts: { port: number; logFile: string },
): number {
  ensureRunDirs();
  const { cmd, args, shell } = resolveRuntimeCommand(runtime);
  const fd = fs.openSync(opts.logFile, "a");

  try {
    const child = spawn(cmd, [...args, "start", "--port", String(opts.port)], {
      cwd: runtime.packagePath,
      env: workerEnv(opts.port),
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
): ChildProcess {
  const { cmd, args, shell } = resolveRuntimeCommand(runtime);
  return spawn(cmd, [...args, "start", "--port", String(port)], {
    cwd: runtime.packagePath,
    env: workerEnv(port),
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
