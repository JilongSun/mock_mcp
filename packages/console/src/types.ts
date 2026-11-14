/**
 * HTTP DTOs of the console API.
 *
 * Kept free of Node imports so the browser bundle can `import type` them and
 * stay in sync with the server.
 */

export type WorkerStatusDto =
  | "running"
  | "starting"
  | "unresponsive"
  | "stopping"
  | "stopped"
  | "exited";

export interface AccessUrlDto {
  url: string;
  /** `local` = this machine only; `lan` = other machines on the network. */
  scope: "local" | "lan";
  iface?: string;
}

export interface WorkerDto {
  id: string;
  name: string;
  runtime: string;
  runtimeLabel: string;
  port: number;
  /** Bind address: `127.0.0.1` or `0.0.0.0`. */
  host: string;
  /** Client-facing MCP URLs; LAN entries come first for a wildcard bind. */
  urls: AccessUrlDto[];
  /** Whether this runtime's build includes the MCP inspector. */
  inspectorBuilt: boolean;
  pid: number | null;
  status: WorkerStatusDto;
  alive: boolean;
  listening: boolean;
  /** True when something else holds the port, so the worker cannot bind it. */
  portTakenByOther: boolean;
  uptimeMs: number | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  desiredState: "running" | "stopped";
  groupId: string;
  logFile: string;
  /** Reserved: empty means "all capabilities". */
  capabilities: string[];
  /** Reserved: protocol selection for this worker. */
  protocol: { mcpVersion: string; legacy?: string } | null;
}

export interface WorkersSummaryDto {
  total: number;
  running: number;
  starting: number;
  unresponsive: number;
  stopping: number;
  stopped: number;
  exited: number;
  ports: number[];
}

export interface WorkersResponseDto {
  workers: WorkerDto[];
  summary: WorkersSummaryDto;
  generatedAt: string;
}

export interface CapabilityDto {
  id: string;
  label: string;
  defaultEnabled: boolean;
}

export interface ProtocolDto {
  id: string;
  label: string;
  available: boolean;
}

export interface RuntimeDto {
  id: string;
  label: string;
  description: string;
  defaultPort: number;
  /** Reserved: empty until per-worker capability selection lands. */
  capabilities: CapabilityDto[];
  /** Reserved: empty until MCP v1/v2 selection lands. */
  protocols: ProtocolDto[];
}

export interface MetaDto {
  name: string;
  version: string;
  host: string;
  port: number;
  /** URLs this console itself is reachable at (LAN entries first when wildcard). */
  urls: AccessUrlDto[];
  /** LAN addresses of this machine, for the "how do others reach me" hint. */
  lanAddresses: { address: string; iface: string }[];
  allowedHosts: string[];
  workspaceRoot: string;
  runDir: string;
  logDir: string;
  pollIntervalMs: number;
  /** Health of `.run/workers.json`; `ok: false` means it could not be used. */
  registry: { ok: boolean; fault: string | null };
  startedAt: string;
}

export type InspectorReason =
  /** The worker build does not include the inspector. */
  | "not-built"
  | "not-running"
  | "unreachable"
  | "remote-loopback";

export interface InspectorDto {
  workerId: string;
  /** True when the inspector can be embedded for this worker. */
  available: boolean;
  /** Inspector URL ready to embed (already carries `?autoConnect=`). */
  url: string | null;
  /** MCP endpoint the inspector will connect to. */
  mcpUrl: string | null;
  /** Why `available` is false. */
  reason: InspectorReason | null;
}

export interface LogsResponseDto {
  id: string;
  logFile: string;
  lines: string[];
  totalLines: number | null;
  truncated: boolean;
}

export interface ActionResponseDto {
  worker: WorkerDto;
  warnings?: string[];
}

export interface CreateWorkersResponseDto {
  workers: WorkerDto[];
  warnings?: string[];
}

export interface PortsResponseDto {
  ports: number[];
}

export interface RuntimesResponseDto {
  runtimes: RuntimeDto[];
}

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
  };
}

export interface CreateWorkerRequestDto {
  runtime: string;
  /** Bind address: `127.0.0.1` (default) or `0.0.0.0` for LAN access. */
  host?: string;
  /** `"auto"` (or omitted) lets the console pick free ports. */
  port?: number | "auto";
  name?: string;
  /** Number of workers to start as one group, counting down from `port`. */
  count?: number;
  /** Reserved. */
  capabilities?: string[];
  /** Reserved. */
  protocol?: { mcpVersion: string; legacy?: string } | null;
}
