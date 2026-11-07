# ADR 002: Worker Supervisor & Web Console

- **Date:** 2026-10-16
- **Status:** Accepted
- **Deciders:** User + GitHub Copilot
- **Extends:** [ADR 001](./001-monorepo-and-protocol-version-strategy.md) (adds two packages to the workspace layout)

---

## Context

Multi-worker support originally shipped as a CLI-only feature inside `@mock-mcp/v1`
(`cli.ts` + `scripts/process-manager.ts`): `pnpm start:v1 -- --workers N` spawned N detached
workers, recorded them in `packages/v1/.run/processes.json` as one *job*, and `stop` / `status`
acted on that record.

As the Gateway gets more worker variants (more ports, more capability subsets, and eventually the
MCP v2 runtime from ADR 001), operating the fleet from a terminal does not scale: there is no
single view of what is running, no per-worker control, and no way to see logs without `cat`-ing
files. We need a management console for starting, stopping and supervising workers, with room to
grow into per-worker configuration (capabilities, MCP v1 vs v2).

Constraints that shaped the decision:

- the existing terminal experience (`run` / `start` / `stop` / `status`) must keep working
  unchanged — the console is an addition, not a replacement;
- workers must survive the console exiting (they are detached services, the console is a view/control
  plane);
- the console has to remain cheap to extend as new worker kinds appear.

---

## Decision

1. **Extract `@mock-mcp/supervisor`** — registry, spawn/stop primitives, readiness probing and
   worker runtime declarations move out of `@mock-mcp/v1` into a shared package. Both the v1 CLI and
   the console consume it, so there is exactly one implementation of "what a worker is".
2. **`@mock-mcp/console` is a separate process, never a worker** — a loopback HTTP API (port 8790)
   plus a React/Tailwind SPA. It drives the same registry the CLI uses, so terminal-started workers
   appear in the UI and can be stopped there (and vice versa).
3. **Worker-centric registry** (`.run/workers.json`, schema v2) replaces the job-centric file, with
   automatic migration of an existing `processes.json`. `groupId` preserves the old "started
   together" grouping so `pnpm stop:v1` semantics and CLI output stay the same.
4. **Status is derived from PID *and* port ownership** — "something listens on the port" is not
   proof the worker is healthy, so the port owner must be the recorded PID or one of its children.
5. **No auto-restart.** The console detects `exited` / `unresponsive` and reports it; restarting is
   an explicit action.

---

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Serve the console UI from the existing v1 mcp-use server | The console must manage *all* workers, including v2 and future runtimes; hosting it inside one worker makes it a peer of what it manages, and it would die with that worker |
| Static SPA that shells out to the CLI (`tsx cli.ts start …`) | Every action becomes a process spawn + stdout parsing; no structured errors, and readiness/state questions would be answered by scraping text |
| Duplicate the process logic inside the console | Guaranteed drift between CLI and console behaviour for something as safety-relevant as killing processes |
| Job-centric registry with a per-worker view on top | Per-worker control (start/stop/remove one worker of a group) would need synthetic ids and awkward partial-group semantics |
| TUI instead of a web UI | Weaker for log tailing and for the planned per-worker configuration forms |

---

## Consequences

**Positive**

- One registry, one lifecycle implementation, two front ends; a worker started either way is
  immediately visible and controllable from the other.
- Terminal behaviour is preserved (`run` / `start` / `stop` / `status`, flags and semantics), so
  existing habits and scripts keep working.
- New runtimes are declared in one place (`packages/supervisor/src/runtimes.ts`); a declared entry
  whose package does not exist yet is skipped, so `packages/v2` will appear in the console the moment
  it lands.
- The record already carries `capabilities` and `protocol`, so per-worker capability selection and
  MCP v1/v2 selection do not require a schema migration.

**Negative / accepted trade-offs**

- The registry moved from `packages/v1/.run/` to the repository-root `.run/`, so docs and
  muscle memory about that path changed (mitigated by migrating the old file automatically).
- `host` is fixed when a worker is created: changing it means removing and re-creating the worker,
  since the bind address is baked into the spawned process (and into `MCP_URL`).
- The console has its own detach/attach lifecycle (`console.json`), separate from the worker
  registry. That is intentional: stopping the console must never be able to stop workers, so the two
  lifecycles are not coupled anywhere.
- Logs are now one file per worker instead of one per group, which changes the `Logs:` path printed
  by `start` (the format and the commands are unchanged).
- The console spawns and kills processes with no authentication. It is therefore loopback-only by
  default; `--host 0.0.0.0` is an explicit opt-in for LAN use and warns when used.
- Status checks rely on `lsof` / `ps` for ownership and orphan detection. Both are best-effort: when
  they are unavailable the console reports "cannot confirm" rather than guessing, and never kills a
  process it cannot attribute to a worker.

**Risks**

- Concurrent writers (CLI and console at the same time) are handled with atomic
  write-then-rename, which tolerates interleaving but not simultaneous edits — the last writer
  wins. A lock file is the obvious upgrade if that ever becomes a real problem.
- `SIGKILL` on the `mcp-use` wrapper orphans its child, which keeps the port. `stop` handles this by
  re-checking port ownership, but the general lesson is that MCP workers are two processes.

---

## References

- [Worker console documentation](../worker-console.md) ([简体中文](../worker-console_zh.md))
- [ADR 001](./001-monorepo-and-protocol-version-strategy.md) — monorepo layout and v2 strategy
- `packages/supervisor/src/lifecycle.ts` — status model and lifecycle implementation
