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

export interface WorkerDto {
  id: string;
  name: string;
  runtime: string;
  runtimeLabel: string;
  port: number;
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
  workspaceRoot: string;
  runDir: string;
  logDir: string;
  pollIntervalMs: number;
  startedAt: string;
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
