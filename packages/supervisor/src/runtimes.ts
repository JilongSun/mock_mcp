/**
 * Worker runtimes.
 *
 * A "runtime" is a startable kind of worker (a workspace package that owns an
 * MCP server). Add one entry per runtime; entries whose package directory does
 * not exist yet are skipped, so a runtime can be declared before it lands.
 */

import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_ROOT } from "./paths.js";

export interface CapabilitySpec {
  id: string;
  label: string;
  /** Shown in the console next to the option. */
  description?: string;
  defaultEnabled: boolean;
  /** Environment variables applied when the capability is enabled. */
  env?: Record<string, string>;
  /** Environment variables applied when it is disabled. */
  envDisabled?: Record<string, string>;
}

export interface ProtocolSpec {
  id: "v1" | "v2";
  label: string;
  available: boolean;
}

export interface WorkerRuntimeSpec {
  id: string;
  label: string;
  description: string;
  /** Workspace-relative directory owning the server; used as the spawn cwd. */
  packageDir: string;
  defaultPort: number;
  inspector: {
    path: string;
    serverParam: string;
    manifest: string;
    startFlag?: string;
  };
  /** Capability groups a worker may be started with. */
  capabilities: CapabilitySpec[];
  /** Reserved: protocol eras a worker may be started with. */
  protocols: ProtocolSpec[];
}

export interface ResolvedRuntime extends Omit<WorkerRuntimeSpec, "packageDir"> {
  /** Absolute path of the runtime's package directory. */
  packagePath: string;
}

const RUNTIME_SPECS: WorkerRuntimeSpec[] = [
  {
    id: "v1",
    label: "v1 · mcp-use 1.32.1",
    description:
      "Enterprise Operations Hub on the pinned mcp-use 1.x runtime (SEP-1865 widgets).",
    packageDir: "packages/v1",
    defaultPort: 8760,
    inspector: { path: "/inspector", serverParam: "autoConnect", manifest: "dist/mcp-use.json" },
    capabilities: [],
    protocols: [],
  },
  {
    id: "v2",
    label: "v2 · mcp-use 2.x",
    description: "MCP 2026 runtime with stateless legacy compatibility and MCP Apps.",
    packageDir: "packages/v2",
    defaultPort: 8770,
    inspector: {
      path: "/mcp/inspector",
      serverParam: "server",
      manifest: ".mcp-use/build/inspector.json",
      startFlag: "--with-inspector",
    },
    capabilities: [
      {
        id: "legacy",
        label: "MCP v1 compatibility (legacy HTTP)",
        description:
          "Serve 2025-era initialize/tools/resources/prompts requests from older clients. Disable for modern-only strict serving.",
        defaultEnabled: true,
        env: { MCP_LEGACY: "stateless" },
        envDisabled: { MCP_LEGACY: "reject" },
      },
    ],
    protocols: [],
  },
];

/**
 * Enabled capability ids. `undefined` means "runtime defaults"; an explicit
 * array is authoritative, so `[]` disables everything.
 */
export function resolveCapabilities(
  runtime: ResolvedRuntime,
  requested: readonly string[] | undefined,
): string[] {
  if (requested === undefined) {
    return runtime.capabilities.filter((entry) => entry.defaultEnabled).map((entry) => entry.id);
  }
  const known = new Set(runtime.capabilities.map((entry) => entry.id));
  const unknown = requested.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    const available = runtime.capabilities.map((entry) => entry.id).join(", ") || "none";
    throw new Error(
      `unknown capability ${unknown.join(", ")} for runtime "${runtime.id}" (available: ${available})`,
    );
  }
  return [...new Set(requested)];
}

/** Environment implied by a resolved capability set. */
export function capabilityEnv(
  runtime: ResolvedRuntime,
  enabled: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const spec of runtime.capabilities) {
    Object.assign(env, enabled.includes(spec.id) ? spec.env : spec.envDisabled);
  }
  return env;
}

export function listRuntimes(): ResolvedRuntime[] {
  return RUNTIME_SPECS.filter((spec) =>
    fs.existsSync(path.join(WORKSPACE_ROOT, spec.packageDir, "package.json")),
  ).map(({ packageDir, ...spec }) => ({
    ...spec,
    packagePath: path.join(WORKSPACE_ROOT, packageDir),
  }));
}

export function getRuntime(id: string): ResolvedRuntime | undefined {
  return listRuntimes().find((runtime) => runtime.id === id);
}

/**
 * Whether a runtime's current build includes the MCP inspector.
 *
 * Read from the runtime's inspector build manifest.
 * Cached briefly: a rebuild flips this, but not often enough to read the file
 * on every status poll.
 */
const INSPECTOR_BUILD_TTL_MS = 10_000;
const inspectorBuiltCache = new Map<string, { value: boolean; at: number }>();

export function isInspectorBuilt(runtimeId: string, fresh = false): boolean {
  const cached = inspectorBuiltCache.get(runtimeId);
  const now = Date.now();
  if (!fresh && cached !== undefined && now - cached.at < INSPECTOR_BUILD_TTL_MS) {
    return cached.value;
  }

  const runtime = getRuntime(runtimeId);
  let value = false;
  if (runtime !== undefined) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(runtime.packagePath, runtime.inspector.manifest), "utf8"),
      ) as { includeInspector?: boolean };
      value = manifest.includeInspector === true;
    } catch {
      // No build output (or an unreadable manifest) means no inspector to serve.
      value = false;
    }
  }

  inspectorBuiltCache.set(runtimeId, { value, at: now });
  return value;
}

export function resolveRuntimeCommand(runtime: ResolvedRuntime): {
  cmd: string;
  args: string[];
  shell: boolean;
} {
  const bin = path.join(runtime.packagePath, "node_modules", ".bin", "mcp-use");
  if (fs.existsSync(bin)) return { cmd: bin, args: [], shell: false };
  // Fallback: let npx find a globally installed mcp-use.
  return { cmd: "npx", args: ["mcp-use"], shell: true };
}
