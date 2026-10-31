/**
 * Console instance registry — lets the console itself run in the background,
 * with `start` / `stop` / `status` from the terminal, mirroring the worker CLI.
 *
 * This manages the console's *own* lifecycle and is deliberately kept apart
 * from the worker registry (`.run/workers.json`): stopping the console never
 * touches a worker. The console is a control plane for workers, not their
 * parent supervisor.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOG_DIR,
  RUN_DIR,
  SupervisorError,
  ensureRunDirs,
  isAlive,
  isPortOpen,
  pidCommand,
  terminatePids,
  waitForPort,
  type ReadyResult,
  type TerminateResult,
} from "@mock-mcp/supervisor";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `packages/console` — the package that owns `server.ts`. */
export const PACKAGE_ROOT = path.resolve(HERE, "..");

export const CONSOLE_STATE_FILE = path.join(RUN_DIR, "console.json");

const STATE_VERSION = 1;
export const DEFAULT_READY_TIMEOUT_MS = 20_000;

export interface ConsoleInstance {
  port: number;
  host: string;
  /** PID of the detached `tsx server.ts` process. */
  pid: number;
  startedAt: string;
  /** True when the UI is served by Vite instead of the built assets. */
  dev: boolean;
  logFile: string;
  url: string;
}

interface StateFile {
  version: number;
  instances: ConsoleInstance[];
}

export interface StartConsoleOptions {
  port: number;
  host: string;
  dev: boolean;
  timeoutMs: number;
}

// ─── Registry ───────────────────────────────────────────────────────────
function readState(): StateFile {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(CONSOLE_STATE_FILE, "utf8"),
    ) as StateFile;
    if (Array.isArray(parsed.instances)) {
      return { version: parsed.version ?? STATE_VERSION, instances: parsed.instances };
    }
  } catch {
    // Missing or unreadable — start clean.
  }
  return { version: STATE_VERSION, instances: [] };
}

function writeState(state: StateFile): void {
  ensureRunDirs();
  const tmp = `${CONSOLE_STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, CONSOLE_STATE_FILE);
}

export function listInstances(): ConsoleInstance[] {
  return [...readState().instances].sort((a, b) => b.port - a.port);
}

export function findInstance(port: number): ConsoleInstance | undefined {
  return readState().instances.find((instance) => instance.port === port);
}

function upsertInstance(instance: ConsoleInstance): void {
  const state = readState();
  const instances = state.instances.filter((entry) => entry.port !== instance.port);
  instances.push(instance);
  writeState({ version: STATE_VERSION, instances });
}

function removeInstance(port: number): void {
  const state = readState();
  writeState({
    version: STATE_VERSION,
    instances: state.instances.filter((entry) => entry.port !== port),
  });
}

/** Drop records whose process is gone, so `status` never shows ghosts. */
export function pruneInstances(): ConsoleInstance[] {
  const state = readState();
  const instances = state.instances.filter((entry) => isAlive(entry.pid));
  if (instances.length !== state.instances.length) {
    writeState({ version: STATE_VERSION, instances });
  }
  return instances;
}

// ─── Spawning ───────────────────────────────────────────────────────────
function resolveTsx(): { cmd: string; args: string[]; shell: boolean } {
  const bin = path.join(PACKAGE_ROOT, "node_modules", ".bin", "tsx");
  if (fs.existsSync(bin)) return { cmd: bin, args: [], shell: false };
  return { cmd: "npx", args: ["tsx"], shell: true };
}

function serverArgs(options: StartConsoleOptions): string[] {
  const args = ["server.ts", "--port", String(options.port), "--host", options.host];
  if (options.dev) args.push("--dev");
  return args;
}

export function consoleUrl(instance: Pick<ConsoleInstance, "host" | "port" | "dev">): string {
  return instance.dev
    ? "http://127.0.0.1:5173"
    : `http://${instance.host}:${instance.port}`;
}

/** Spawn the console attached to the terminal (used by `run`). */
export function spawnForegroundConsole(options: StartConsoleOptions) {
  const { cmd, args, shell } = resolveTsx();
  return spawn(cmd, [...args, ...serverArgs(options)], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: "inherit",
    shell,
  });
}

/**
 * Start the console detached, so it keeps running after the terminal closes.
 * Waits until it actually serves its port before reporting success.
 */
export async function startConsole(
  options: StartConsoleOptions,
): Promise<{ instance: ConsoleInstance; ready: ReadyResult }> {
  const existing = findInstance(options.port);
  if (existing && isAlive(existing.pid)) {
    throw new SupervisorError(
      "ALREADY_RUNNING",
      `the console is already running on ${consoleUrl(existing)} (PID ${existing.pid})`,
      409,
    );
  }
  if (await isPortOpen(options.port)) {
    throw new SupervisorError(
      "PORT_BUSY",
      `port ${options.port} is already in use by another process`,
      409,
    );
  }

  ensureRunDirs();
  const logFile = path.join(LOG_DIR, `console-${options.port}.log`);
  const { cmd, args, shell } = resolveTsx();
  const fd = fs.openSync(logFile, "a");

  let pid: number;
  try {
    const child = spawn(cmd, [...args, ...serverArgs(options)], {
      cwd: PACKAGE_ROOT,
      env: process.env,
      detached: true,
      stdio: ["ignore", fd, fd],
      shell,
    });
    child.unref();

    if (child.pid === undefined) {
      child.on("error", () => {});
      throw new SupervisorError(
        "SPAWN_FAILED",
        `failed to spawn the console on port ${options.port}`,
        500,
      );
    }
    pid = child.pid;
  } finally {
    fs.closeSync(fd);
  }

  const instance: ConsoleInstance = {
    port: options.port,
    host: options.host,
    pid,
    startedAt: new Date().toISOString(),
    dev: options.dev,
    logFile,
    url: consoleUrl({ host: options.host, port: options.port, dev: options.dev }),
  };
  upsertInstance(instance);

  const ready = await waitForPort(options.port, {
    pid,
    timeoutMs: options.timeoutMs,
  });

  if (!ready.ready) {
    // Never leave a record (or a half-booted process) behind on failure.
    await terminatePids([pid]).catch(() => undefined);
    removeInstance(options.port);
    return { instance, ready };
  }

  return { instance, ready };
}

// ─── Stopping ───────────────────────────────────────────────────────────
export interface ConsoleStopReport extends TerminateResult {
  instance: ConsoleInstance;
  portReleased: boolean;
}

/** Only signal a PID that still looks like our console (guards PID reuse). */
function looksLikeOurConsole(pid: number): boolean {
  const command = pidCommand(pid);
  return command !== null && /server\.ts|console/.test(command);
}

export async function stopConsole(
  instance: ConsoleInstance,
): Promise<ConsoleStopReport> {
  const alive = isAlive(instance.pid);
  const targets = alive && looksLikeOurConsole(instance.pid) ? [instance.pid] : [];

  const result = await terminatePids(targets);
  const portReleased = !(await isPortOpen(instance.port));

  removeInstance(instance.port);
  return { instance, portReleased, ...result };
}

export interface ConsoleStatus {
  instance: ConsoleInstance;
  alive: boolean;
  listening: boolean;
  uptimeMs: number | null;
}

export async function inspectInstance(
  instance: ConsoleInstance,
): Promise<ConsoleStatus> {
  const alive = isAlive(instance.pid);
  const listening = alive ? await isPortOpen(instance.port) : false;
  return {
    instance,
    alive,
    listening,
    uptimeMs: alive ? Date.now() - new Date(instance.startedAt).getTime() : null,
  };
}
