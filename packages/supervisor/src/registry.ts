/**
 * Worker registry — the single source of truth shared by the CLI and the
 * console. Records live in `<workspace root>/.run/workers.json` and are written
 * atomically (temp file + rename) so a concurrent reader never sees a partial
 * file.
 */

import fs from "node:fs";
import path from "node:path";
import { LOOPBACK_HOST } from "./network.js";
import { LEGACY_STATE_FILE, LOG_DIR, STATE_FILE, ensureRunDirs } from "./paths.js";
import type { RegistryState, WorkerRecord } from "./types.js";

// v3 added `host`; v2 and the legacy job file are read with a loopback default.
const STATE_VERSION = 3;

export function workerIdFor(port: number): string {
  return `w-${port}`;
}

/** Group label for workers started together; matches the pre-supervisor naming. */
export function groupIdFor(count: number, basePort: number): string {
  return count > 1 ? `multi-${basePort}x${count}` : `single-${basePort}`;
}

export function logFileFor(workerId: string): string {
  return path.join(LOG_DIR, `${workerId}.log`);
}

/** Ports used by a batch starting at `basePort`, counting down. */
export function portsFor(basePort: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => basePort - index);
}

interface LegacyJob {
  id: string;
  createdAt: string;
  logFile: string;
  workers: { port: number; pid: number }[];
}

/** Convert the pre-supervisor job-centric state file into worker records. */
function migrateLegacy(raw: string): RegistryState | null {
  try {
    const parsed = JSON.parse(raw) as { jobs?: LegacyJob[] };
    if (!Array.isArray(parsed.jobs)) return null;

    const workers: WorkerRecord[] = [];
    for (const job of parsed.jobs) {
      for (const worker of job.workers ?? []) {
        workers.push({
          id: workerIdFor(worker.port),
          name: `worker-${worker.port}`,
          runtime: "v1",
          port: worker.port,
          host: LOOPBACK_HOST,
          pid: worker.pid ?? null,
          createdAt: job.createdAt,
          startedAt: job.createdAt,
          updatedAt: job.createdAt,
          desiredState: "running",
          groupId: job.id,
          logFile: job.logFile,
          capabilities: [],
          protocol: null,
        });
      }
    }
    return { version: STATE_VERSION, workers };
  } catch {
    return null;
  }
}

/** Fill in fields added after a record was written (currently `host`). */
function normalizeWorker(worker: WorkerRecord): WorkerRecord {
  return { ...worker, host: worker.host ?? LOOPBACK_HOST };
}

function readState(): RegistryState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as RegistryState;
    if (Array.isArray(parsed.workers)) {
      return {
        version: parsed.version ?? STATE_VERSION,
        workers: parsed.workers.map(normalizeWorker),
      };
    }
  } catch {
    // Missing or unreadable — fall through to the legacy file / empty state.
  }

  try {
    const migrated = migrateLegacy(fs.readFileSync(LEGACY_STATE_FILE, "utf8"));
    if (migrated) {
      writeState(migrated);
      return migrated;
    }
  } catch {
    // No legacy state to adopt.
  }

  return { version: STATE_VERSION, workers: [] };
}

function writeState(state: RegistryState): void {
  ensureRunDirs();
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, STATE_FILE);
}

export function listWorkers(): WorkerRecord[] {
  return [...readState().workers].sort((a, b) => b.port - a.port);
}

export function getWorker(id: string): WorkerRecord | undefined {
  return readState().workers.find((worker) => worker.id === id);
}

export function upsertWorker(record: WorkerRecord): WorkerRecord {
  const state = readState();
  const workers = state.workers.filter((worker) => worker.id !== record.id);
  workers.push(record);
  writeState({ version: STATE_VERSION, workers });
  return record;
}

export function patchWorker(
  id: string,
  patch: Partial<WorkerRecord>,
): WorkerRecord | undefined {
  const state = readState();
  const index = state.workers.findIndex((worker) => worker.id === id);
  if (index === -1) return undefined;

  const updated: WorkerRecord = { ...state.workers[index], ...patch };
  state.workers[index] = updated;
  writeState({ version: STATE_VERSION, workers: state.workers });
  return updated;
}

export function removeWorkerRecord(id: string): boolean {
  const state = readState();
  const workers = state.workers.filter((worker) => worker.id !== id);
  if (workers.length === state.workers.length) return false;
  writeState({ version: STATE_VERSION, workers });
  return true;
}
