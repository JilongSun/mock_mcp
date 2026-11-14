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
  defaultEnabled: boolean;
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
  /** Reserved: capability groups a worker may be started with. */
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
    capabilities: [],
    protocols: [],
  },
  // Declared ahead of the implementation — see docs/adr/001. Skipped until the
  // package exists, at which point it shows up in the console automatically.
  {
    id: "v2",
    label: "v2 · mcp-use 2.x",
    description: "Modern MCP protocol era with legacy negotiation. Not implemented yet.",
    packageDir: "packages/v2",
    defaultPort: 8770,
    capabilities: [],
    protocols: [],
  },
];

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
 * Read from the build manifest written by `mcp-use build --with-inspector`.
 * Cached briefly: a rebuild flips this, but not often enough to read the file
 * on every status poll.
 */
const INSPECTOR_BUILD_TTL_MS = 10_000;
const inspectorBuiltCache = new Map<string, { value: boolean; at: number }>();

export function isInspectorBuilt(runtimeId: string): boolean {
  const cached = inspectorBuiltCache.get(runtimeId);
  const now = Date.now();
  if (cached !== undefined && now - cached.at < INSPECTOR_BUILD_TTL_MS) {
    return cached.value;
  }

  const runtime = getRuntime(runtimeId);
  let value = false;
  if (runtime !== undefined) {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(runtime.packagePath, "dist", "mcp-use.json"), "utf8"),
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
