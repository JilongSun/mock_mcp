/** JSON API of the worker console. */

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ALLOWED_HOSTS,
  LOG_DIR,
  LOOPBACK_HOST,
  RUN_DIR,
  WORKSPACE_ROOT,
  accessUrls,
  findFreePort,
  getRegistryHealth,
  isAllowedHost,
  isLoopbackHost,
  listLanAddresses,
  getWorker,
  groupIdFor,
  inspectWorker,
  inspectWorkerById,
  inspectWorkers,
  listRuntimes,
  portsFor,
  removeWorker,
  restartWorker,
  startRecordedWorker,
  startWorker,
  stopWorker,
  type WorkerProtocol,
  type WorkerView,
} from "@mock-mcp/supervisor";
import { HttpError, readJsonBody, sendJson, sendNoContent } from "./http.js";
import type {
  ActionResponseDto,
  CreateWorkerRequestDto,
  CreateWorkersResponseDto,
  InspectorDto,
  LogsResponseDto,
  MetaDto,
  RuntimeDto,
  WorkerDto,
  WorkersResponseDto,
  WorkersSummaryDto,
} from "./types.js";

export interface ApiContext {
  host: string;
  consolePort: number;
  version: string;
  startedAt: string;
  pollIntervalMs: number;
}

const MAX_WORKERS_PER_REQUEST = 20;
const MAX_LOG_LINES = 2_000;
const DEFAULT_LOG_LINES = 200;
const LOG_TAIL_BYTES = 256 * 1024;

function toDto(view: WorkerView): WorkerDto {
  return {
    id: view.id,
    name: view.name,
    runtime: view.runtime,
    runtimeLabel: view.runtimeLabel,
    port: view.port,
    host: view.host,
    urls: view.urls,
    pid: view.pid,
    status: view.status,
    alive: view.alive,
    listening: view.listening,
    portTakenByOther: view.portTakenByOther,
    uptimeMs: view.uptimeMs,
    createdAt: view.createdAt,
    startedAt: view.startedAt,
    updatedAt: view.updatedAt,
    desiredState: view.desiredState,
    groupId: view.groupId,
    logFile: view.logFile,
    capabilities: view.capabilities,
    protocol: view.protocol,
  };
}

function summarise(workers: WorkerDto[]): WorkersSummaryDto {
  return {
    total: workers.length,
    running: workers.filter((worker) => worker.status === "running").length,
    starting: workers.filter((worker) => worker.status === "starting").length,
    unresponsive: workers.filter((worker) => worker.status === "unresponsive").length,
    stopping: workers.filter((worker) => worker.status === "stopping").length,
    stopped: workers.filter((worker) => worker.status === "stopped").length,
    exited: workers.filter((worker) => worker.status === "exited").length,
    ports: workers.map((worker) => worker.port).sort((a, b) => b - a),
  };
}

async function workersPayload(): Promise<WorkersResponseDto> {
  const workers = (await inspectWorkers()).map(toDto);
  return { workers, summary: summarise(workers), generatedAt: new Date().toISOString() };
}

function runtimesPayload(): RuntimeDto[] {
  return listRuntimes().map((runtime) => ({
    id: runtime.id,
    label: runtime.label,
    description: runtime.description,
    defaultPort: runtime.defaultPort,
    capabilities: runtime.capabilities,
    protocols: runtime.protocols,
  }));
}

function metaPayload(ctx: ApiContext): MetaDto {
  return {
    name: "mock-mcp worker console",
    version: ctx.version,
    host: ctx.host,
    port: ctx.consolePort,
    urls: accessUrls(ctx.host, ctx.consolePort, "/"),
    lanAddresses: listLanAddresses(),
    allowedHosts: [...ALLOWED_HOSTS],
    workspaceRoot: WORKSPACE_ROOT,
    runDir: RUN_DIR,
    logDir: LOG_DIR,
    pollIntervalMs: ctx.pollIntervalMs,
    registry: getRegistryHealth(),
    startedAt: ctx.startedAt,
  };
}

/** Last `maxBytes` of a file, so a huge log cannot blow up the response. */
function readTail(filePath: string, maxBytes: number): string | null {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) return "";

    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function logsPayload(id: string, rawLines: string | null): LogsResponseDto {
  const record = getWorker(id);
  if (!record) throw new HttpError(404, "NOT_FOUND", `no worker with id "${id}"`);

  const limit = (() => {
    const parsed = Number(rawLines);
    if (rawLines === null || !Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOG_LINES;
    return Math.min(Math.floor(parsed), MAX_LOG_LINES);
  })();

  const tail = readTail(record.logFile, LOG_TAIL_BYTES);
  if (tail === null) {
    return { id, logFile: record.logFile, lines: [], totalLines: null, truncated: false };
  }

  const all = tail.split("\n");
  if (all.at(-1) === "") all.pop();
  const lines = all.slice(-limit);

  return {
    id,
    logFile: record.logFile,
    lines,
    totalLines: all.length,
    truncated: all.length > lines.length || tail.length === LOG_TAIL_BYTES,
  };
}

/** Hostname the browser used to reach the console (drives embeddable URLs). */
function requestHostname(req: IncomingMessage): string {
  const raw = req.headers.host ?? "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : LOOPBACK_HOST;
  }
  return raw.split(":")[0] || LOOPBACK_HOST;
}

const INSPECTOR_PROBE_TIMEOUT_MS = 1_500;

/**
 * Whether the worker serves `/inspector`. The inspector is part of the worker
 * build (`--with-inspector`), so a worker built without it answers 404 — that
 * must be reported instead of embedding a broken frame.
 */
async function probeInspector(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSPECTOR_PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${port}/inspector`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    return (response.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function inspectorPayload(id: string, req: IncomingMessage): Promise<InspectorDto> {
  const view = await inspectWorkerById(id);

  if (!view.alive || !view.listening) {
    return { workerId: id, available: false, url: null, mcpUrl: null, reason: "not-running" };
  }

  if (!(await probeInspector(view.port))) {
    return { workerId: id, available: false, url: null, mcpUrl: null, reason: "not-built" };
  }

  const viewHost = requestHostname(req);
  const consoleIsLocal = isLoopbackHost(viewHost);

  // A loopback-bound worker only exists on this machine; a browser opened from
  // elsewhere cannot reach it, so embedding would just hang.
  if (view.host === LOOPBACK_HOST && !consoleIsLocal) {
    return {
      workerId: id,
      available: false,
      url: null,
      mcpUrl: null,
      reason: "remote-loopback",
    };
  }

  const targetHost = consoleIsLocal ? LOOPBACK_HOST : viewHost;
  const mcpUrl = `http://${targetHost}:${view.port}/mcp`;
  // `autoConnect` overrides the loopback-only URL baked into the worker's
  // config.json, so a remote browser connects to the right host.
  const url = `http://${targetHost}:${view.port}/inspector?autoConnect=${encodeURIComponent(mcpUrl)}`;

  return { workerId: id, available: true, url, mcpUrl, reason: null };
}

function parseCount(raw: unknown): number {
  if (raw === undefined || raw === null) return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_WORKERS_PER_REQUEST) {
    throw new HttpError(
      400,
      "INVALID_COUNT",
      `count must be an integer between 1 and ${MAX_WORKERS_PER_REQUEST}`,
    );
  }
  return value;
}

function parseHost(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return LOOPBACK_HOST;
  if (typeof raw !== "string" || !isAllowedHost(raw)) {
    throw new HttpError(
      400,
      "INVALID_HOST",
      `host must be one of ${ALLOWED_HOSTS.join(", ")} (got "${String(raw)}")`,
    );
  }
  return raw;
}

function parseRuntimeId(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new HttpError(400, "INVALID_RUNTIME", "runtime is required");
  }
  return raw.trim();
}

function parsePort(raw: unknown): number | "auto" {
  if (raw === undefined || raw === null || raw === "auto" || raw === "") return "auto";
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new HttpError(400, "INVALID_PORT", "port must be an integer or \"auto\"");
  }
  return value;
}

async function allocatePorts(
  runtimeId: string,
  count: number,
  consolePort: number,
): Promise<number[]> {
  const exclude = [consolePort];
  const ports: number[] = [];
  for (let index = 0; index < count; index++) {
    const port = await findFreePort(runtimeId, { exclude });
    ports.push(port);
    exclude.push(port);
  }
  return ports;
}

async function createWorkers(
  res: ServerResponse,
  req: IncomingMessage,
  ctx: ApiContext,
): Promise<void> {
  const body = (await readJsonBody(req)) as CreateWorkerRequestDto;
  if (body === null || typeof body !== "object") {
    throw new HttpError(400, "INVALID_BODY", "request body must be a JSON object");
  }

  const runtimeId = parseRuntimeId(body.runtime);
  const host = parseHost(body.host);
  const count = parseCount(body.count);
  const requestedPort = parsePort(body.port);

  if (host !== LOOPBACK_HOST && listLanAddresses().length === 0) {
    throw new HttpError(
      409,
      "NO_LAN_ADDRESS",
      "no LAN address is available on this machine — connect to a network first",
    );
  }

  if (requestedPort !== "auto" && requestedPort < count) {
    throw new HttpError(
      400,
      "INVALID_PORT",
      `port ${requestedPort} cannot host ${count} workers counting down`,
    );
  }

  const ports =
    requestedPort === "auto"
      ? await allocatePorts(runtimeId, count, ctx.consolePort)
      : portsFor(requestedPort, count);

  const groupId = groupIdFor(count, ports[0]);
  const baseName = typeof body.name === "string" ? body.name.trim() : "";
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  const protocol = (body.protocol ?? null) as WorkerProtocol | null;

  const started = [];
  try {
    for (const [index, port] of ports.entries()) {
      const name =
        baseName === "" ? undefined : count > 1 ? `${baseName}-${index + 1}` : baseName;
      started.push(
        startWorker({
          runtime: runtimeId,
          port,
          host,
          name,
          capabilities,
          protocol,
          groupId,
        }),
      );
    }
  } catch (err) {
    // Roll back a partially created group so the registry stays consistent.
    for (const record of started) {
      await removeWorker(record.id).catch(() => undefined);
    }
    throw err;
  }

  const views = await Promise.all(started.map((record) => inspectWorker(record)));
  sendJson(res, 201, { workers: views.map(toDto) } satisfies CreateWorkersResponseDto);
}

async function workerAction(
  res: ServerResponse,
  id: string,
  action: string,
): Promise<void> {
  const warnings: string[] = [];

  switch (action) {
    case "start":
      await startRecordedWorker(id);
      break;
    case "stop": {
      const { portReleased } = await stopWorker(id);
      if (!portReleased) {
        warnings.push("the port is still held by a process that is not our worker");
      }
      break;
    }
    case "restart":
      await restartWorker(id);
      break;
    default:
      throw new HttpError(404, "NOT_FOUND", `unknown worker action "${action}"`);
  }

  const view = await inspectWorkerById(id);
  sendJson(res, 200, {
    worker: toDto(view),
    ...(warnings.length > 0 ? { warnings } : {}),
  } satisfies ActionResponseDto);
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ApiContext,
): Promise<boolean> {
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return false;

  const rest = segments.slice(1);
  const method = (req.method ?? "GET").toUpperCase();

  if (rest.length === 0) {
    throw new HttpError(404, "NOT_FOUND", "unknown API route");
  }

  if (rest[0] === "meta" && rest.length === 1 && method === "GET") {
    sendJson(res, 200, metaPayload(ctx));
    return true;
  }

  if (rest[0] === "runtimes" && rest.length === 1 && method === "GET") {
    sendJson(res, 200, { runtimes: runtimesPayload() });
    return true;
  }

  if (rest[0] === "ports" && rest[1] === "next" && method === "GET") {
    const runtimeId = parseRuntimeId(url.searchParams.get("runtime") ?? undefined);
    const count = parseCount(url.searchParams.get("count") ?? undefined);
    const ports = await allocatePorts(runtimeId, count, ctx.consolePort);
    sendJson(res, 200, { ports });
    return true;
  }

  if (rest[0] !== "workers") {
    throw new HttpError(404, "NOT_FOUND", `unknown API route ${method} ${url.pathname}`);
  }

  if (rest.length === 1) {
    if (method === "GET") {
      sendJson(res, 200, await workersPayload());
      return true;
    }
    if (method === "POST") {
      await createWorkers(res, req, ctx);
      return true;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", `${method} is not allowed here`);
  }

  const id = decodeURIComponent(rest[1]);

  if (rest.length === 2 && method === "GET") {
    sendJson(res, 200, { worker: toDto(await inspectWorkerById(id)) });
    return true;
  }

  if (rest.length === 2 && method === "DELETE") {
    await removeWorker(id);
    sendNoContent(res);
    return true;
  }

  if (rest.length === 3 && method === "POST") {
    await workerAction(res, id, rest[2]);
    return true;
  }

  if (rest.length === 3 && rest[2] === "logs" && method === "GET") {
    sendJson(res, 200, logsPayload(id, url.searchParams.get("lines")));
    return true;
  }

  if (rest.length === 3 && rest[2] === "inspector" && method === "GET") {
    sendJson(res, 200, await inspectorPayload(id, req));
    return true;
  }

  throw new HttpError(404, "NOT_FOUND", `unknown API route ${method} ${url.pathname}`);
}
