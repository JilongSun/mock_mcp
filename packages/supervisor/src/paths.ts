/**
 * Filesystem layout owned by the supervisor.
 *
 * State lives in `<workspace root>/.run/` (git-ignored) so that the CLI and the
 * console share one registry even though they run from different packages.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this module until the pnpm workspace root is found. */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export const WORKSPACE_ROOT = findWorkspaceRoot(HERE);

/** Overridable so tests (and isolated runs) can keep their state out of the repo. */
export const RUN_DIR = process.env.MOCK_MCP_RUN_DIR
  ? path.resolve(process.env.MOCK_MCP_RUN_DIR)
  : path.join(WORKSPACE_ROOT, ".run");

export const LOG_DIR = path.join(RUN_DIR, "logs");
export const STATE_FILE = path.join(RUN_DIR, "workers.json");

/** Registry written by the pre-supervisor CLI; migrated on first read. */
export const LEGACY_STATE_FILE = path.join(
  WORKSPACE_ROOT,
  "packages",
  "v1",
  ".run",
  "processes.json",
);

export function ensureRunDirs(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}
