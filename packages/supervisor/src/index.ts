/**
 * @mock-mcp/supervisor — worker registry, lifecycle and readiness probing.
 *
 * Shared by the v1 CLI (`pnpm run:v1` / `start:v1` / `stop:v1` / `status:v1`)
 * and the worker console, so both see and control the same workers.
 */

export type {
  DesiredState,
  RegistryState,
  WorkerProtocol,
  WorkerRecord,
  WorkerStatus,
  WorkerView,
} from "./types.js";

export {
  ALLOWED_HOSTS,
  LOOPBACK_HOST,
  WILDCARD_HOST,
  accessUrls,
  isAllowedHost,
  isLoopbackHost,
  isWildcardHost,
  listLanAddresses,
  primaryLanAddress,
  resolveMcpUrl,
  type AccessScope,
  type AccessUrl,
  type BindHost,
  type LanAddress,
} from "./network.js";

export {
  LOG_DIR,
  RUN_DIR,
  STATE_FILE,
  WORKSPACE_ROOT,
  ensureRunDirs,
} from "./paths.js";

export {
  getRegistryHealth,
  groupIdFor,
  listWorkers,
  getWorker,
  logFileFor,
  patchWorker,
  portsFor,
  removeWorkerRecord,
  upsertWorker,
  workerIdFor,
  type RegistryHealth,
} from "./registry.js";

export {
  getRuntime,
  isInspectorBuilt,
  listRuntimes,
  resolveRuntimeCommand,
  type CapabilitySpec,
  type ProtocolSpec,
  type ResolvedRuntime,
  type WorkerRuntimeSpec,
} from "./runtimes.js";

export {
  FORCE_KILL_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  hasAncestor,
  isAlive,
  isMcpUseProcess,
  isPortOpen,
  pidCommand,
  probeService,
  pidCwd,
  pidParent,
  pidsListeningOn,
  sleep,
  spawnDetachedWorker,
  spawnForegroundWorker,
  terminatePids,
  waitForPort,
  workerEnv,
  type PidVerifier,
  type ReadyResult,
  type TerminateResult,
} from "./process.js";

export {
  OWNERSHIP_TTL_MS,
  STARTING_GRACE_MS,
  SupervisorError,
  findFreePort,
  inspectPortOwnership,
  inspectWorker,
  inspectWorkerById,
  inspectWorkers,
  removeWorker,
  restartWorker,
  startRecordedWorker,
  startWorker,
  stopWorker,
  waitForWorker,
  type PortOwnership,
  type RemoveWorkerOptions,
  type StartWorkerOptions,
  type WorkerStopReport,
} from "./lifecycle.js";
