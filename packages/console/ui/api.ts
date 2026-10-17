/** Typed fetch client for the console API. */

import type {
  ActionResponseDto,
  CreateWorkerRequestDto,
  CreateWorkersResponseDto,
  LogsResponseDto,
  MetaDto,
  PortsResponseDto,
  RuntimesResponseDto,
  WorkerDto,
  WorkersResponseDto,
} from "../src/types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text !== "") {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.message ?? `HTTP ${response.status}`,
      error?.code ?? "HTTP_ERROR",
      response.status,
    );
  }

  return payload as T;
}

export const api = {
  meta: () => request<MetaDto>("/api/meta"),

  runtimes: () => request<RuntimesResponseDto>("/api/runtimes"),

  workers: () => request<WorkersResponseDto>("/api/workers"),

  worker: (id: string) =>
    request<{ worker: WorkerDto }>(`/api/workers/${encodeURIComponent(id)}`),

  createWorkers: (body: CreateWorkerRequestDto) =>
    request<CreateWorkersResponseDto>("/api/workers", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  action: (id: string, action: "start" | "stop" | "restart") =>
    request<ActionResponseDto>(
      `/api/workers/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
    ),

  remove: (id: string) =>
    request<void>(`/api/workers/${encodeURIComponent(id)}`, { method: "DELETE" }),

  logs: (id: string, lines = 300) =>
    request<LogsResponseDto>(
      `/api/workers/${encodeURIComponent(id)}/logs?lines=${lines}`,
    ),

  nextPorts: (runtime: string, count: number) =>
    request<PortsResponseDto>(
      `/api/ports/next?runtime=${encodeURIComponent(runtime)}&count=${count}`,
    ),
};
