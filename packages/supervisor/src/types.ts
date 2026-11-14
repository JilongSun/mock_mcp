/** Shared types for worker records, registry state and reported status. */

import type { AccessUrl } from "./network.js";

export type WorkerStatus =
  | "running"
  | "starting"
  | "unresponsive"
  | "stopping"
  | "stopped"
  | "exited";

export type DesiredState = "running" | "stopped";

/** Reserved: which MCP protocol era a worker serves. Not wired up yet. */
export interface WorkerProtocol {
  mcpVersion: "v1" | "v2";
  legacy?: "stateless" | "reject";
}

export interface WorkerRecord {
  /** Stable id, derived from the port (`w-8760`), so restarts reuse it. */
  id: string;
  name: string;
  /** Runtime id, see `listRuntimes()`. */
  runtime: string;
  port: number;
  /** Bind address: `127.0.0.1` (this machine) or `0.0.0.0` (LAN). */
  host: string;
  /** Last known OS pid; `null` when the record never spawned anything. */
  pid: number | null;
  createdAt: string;
  /** Last successful spawn; used for uptime. */
  startedAt: string | null;
  updatedAt: string;
  desiredState: DesiredState;
  /** Workers started together share a group (and its log naming convention). */
  groupId: string;
  logFile: string;
  /** Reserved: empty array means "all capabilities". */
  capabilities: string[];
  /** Reserved: protocol selection for this worker. */
  protocol: WorkerProtocol | null;
}

export interface RegistryState {
  version: number;
  workers: WorkerRecord[];
}

export interface WorkerView extends WorkerRecord {
  runtimeLabel: string;
  status: WorkerStatus;
  alive: boolean;
  listening: boolean;
  /** True when something else holds the port, so the worker cannot bind it. */
  portTakenByOther: boolean;
  /** Client-facing URLs; LAN entries come first for a wildcard bind. */
  urls: AccessUrl[];
  /** Whether this runtime's build includes the MCP inspector. */
  inspectorBuilt: boolean;
  /** Milliseconds since the last spawn; `null` when not alive. */
  uptimeMs: number | null;
}
