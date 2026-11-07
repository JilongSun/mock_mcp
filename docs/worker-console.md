# Worker Console

English | [简体中文](./worker-console_zh.md)

The worker console (`@mock-mcp/console`) is a light web UI plus a small HTTP API for managing
every mock-mcp worker from one place: start, stop, restart, remove, watch status, tail logs.

```bash
pnpm console         # build the UI if needed, then serve in the BACKGROUND on :8790
pnpm console:status  # is it still running / serving?
pnpm console:stop    # stop the console — workers keep running
pnpm console:run     # foreground instead (Ctrl+C stops the console)
pnpm console:dev     # Vite dev server with HMR on :5173 (API proxied to :8790)
pnpm build:console   # UI build only
```

## Running in the background

`pnpm console` is detached, exactly like `pnpm start:v1` for workers: closing the terminal does not
stop it. It records its PID/port in `.run/console.json` and logs to
`.run/logs/console-<port>.log`, so `console:status` and `console:stop` work without remembering
anything.

```bash
pnpm console -- --port 8791        # a second console on another port
pnpm console -- --host 0.0.0.0     # reachable from the LAN
pnpm console:stop -- --port 8791   # stop just that one
```

`--host` accepts `127.0.0.1` (default) or `0.0.0.0`. Binding the console to the LAN exposes an API
that starts and stops processes **with no authentication**, so it warns when you do it.

Starting a console on a port that is already recorded and alive fails with
`the console is already running on ... (PID n)` rather than spawning a duplicate.

## Lifecycle: control plane, not parent

```
console (detached) ──spawn──▶ worker A (detached, survives the console)
                   ──spawn──▶ worker B (detached, survives the console)
```

- Workers are spawned `detached: true` and `unref()`-ed, and the console keeps no
  `ChildProcess` handle — only numeric PIDs in the registry.
- Therefore **stopping the console never stops a worker**: `pnpm console:stop`, `Ctrl+C` on a
  foreground console, or killing the console all leave workers running and listening.
- Stop workers with `pnpm stop:v1` or the UI's Stop/Remove buttons.
- The reverse also holds: workers started by `pnpm start:v1` are managed by the console as soon as
  it starts, because both read the same `.run/workers.json`.

The only thing the console stops on exit is its own HTTP server (and the Vite child in `--dev`).

---

## It is a supervisor, not a worker

The console never runs an MCP server itself. It spawns and signals *other* processes, so:

- a single console manages any number of workers, including workers of different runtimes;
- workers are detached and keep running when the console exits;
- the console and the CLI share one registry, so a worker started in a terminal shows up in the UI
  and can be stopped from it (and vice versa).

```
┌────────────┐   spawn/SIGTERM    ┌──────────────┐
│  console   │ ─────────────────▶ │ worker :8760 │  (mcp-use, detached)
│  :8790     │                    └──────────────┘
│            │   read/write       ┌──────────────┐
│  HTTP API  │ ◀────────────────▶ │ .run/        │ ◀── also used by pnpm start:v1 /
└────────────┘   registry+logs    │ workers.json │     stop:v1 / status:v1
                                  └──────────────┘
```

Ports: the console defaults to **8790**, deliberately *above* the worker range, because workers
count **down** from their base port (8760, 8759, 8758, …) and would otherwise collide with it.

---

## Registry

All supervisor state lives in the repository-root `.run/` directory (git-ignored):

| Path | Purpose |
|------|---------|
| `.run/workers.json` | Worker registry (schema version 2) |
| `.run/console.json` | Background console instances (PID/port/log) |
| `.run/logs/<worker-id>.log` | One log file per worker |
| `.run/logs/console-<port>.log` | One log file per background console |

- The file is written atomically (temp file + `rename`), so a reader never sees a partial file.
- Worker ids are derived from the port (`w-8760`), so restarting a worker reuses its record and log.
- Workers started together share a `groupId` (`single-8760`, `multi-8760x3`), which is what the CLI
  groups its output by.
- A registry written by the pre-supervisor CLI (`packages/v1/.run/processes.json`, job-centric) is
  migrated automatically on first read and then left untouched.
- Set `MOCK_MCP_RUN_DIR` to move all of it elsewhere (used by the tests, handy for isolated runs).

---

## Status model

Status is computed from the recorded PID **and** who owns the port, never from the PID alone — a
crashed worker whose port was taken over by another process must not look healthy.

| Status | Meaning |
|--------|---------|
| `running` | Process alive and the port is bound by this worker (or one of its children) |
| `starting` | Alive, port not bound yet, less than 60s since the last start |
| `unresponsive` | Alive, port still not bound after the grace period (hung or blocked) |
| `stopping` | Stop requested, process has not exited yet |
| `stopped` | Stopped on purpose; the record is kept so it can be started again |
| `exited` | Process is gone without a stop request (crash) |

`listening` and `portTakenByOther` are reported alongside so the UI can flag the case where
something else holds the port. The API is polled every 2s by the UI (`pollIntervalMs` is exposed by
`GET /api/meta`).

### Polling cost

The ownership check dominates the cost of a status poll: `lsof` scans every process on the machine
(~40ms per call here) and it used to be paid for every worker on every poll. Two things keep that
cheap without weakening the answer:

- The ownership verdict is cached for `OWNERSHIP_TTL_MS` (20s) and invalidated by every
  start/stop/restart/remove.
- "Is anything listening?" is always re-probed with a single loopback connect, and the cached
  verdict is only reused while it agrees with that fresh signal. So a worker that stops listening is
  reported immediately — the cache never claims a quiet port is busy, it only avoids re-deriving
  *who* is there. The residual window is a port that stays busy while changing hands, which is
  reported as ours for at most the TTL.

Measured with 3 workers: ~120ms per poll cold (cache expired) vs ~1.4ms warm, i.e. roughly **10×
less sustained work** at a 2s interval. Dead and stopped workers cost nothing (liveness is checked
before ownership). The safety path — reclaiming a port while stopping or restarting — always
measures ownership live and never reads the cache.

Nothing polls when no page is open: the console server has no timers of its own, only the browser
does, and it skips requests while the tab is hidden.

---

## HTTP API

Everything is JSON, bound to loopback. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/meta` | Console version, host/port, registry paths, poll interval |
| `GET` | `/api/runtimes` | Startable runtimes (id, label, default port, reserved capability/protocol options) |
| `GET` | `/api/workers` | All workers with live status plus a summary (counts, ports in use) |
| `POST` | `/api/workers` | Create + start worker(s): `{ runtime, host?, port?, count?, name? }` |
| `GET` | `/api/workers/:id` | One worker |
| `POST` | `/api/workers/:id/start` | Start a recorded worker that is stopped or exited |
| `POST` | `/api/workers/:id/stop` | Stop it (SIGTERM → SIGKILL, then free the port) |
| `POST` | `/api/workers/:id/restart` | Stop and respawn with the recorded configuration |
| `DELETE` | `/api/workers/:id` | Stop (if needed) and drop the record |
| `GET` | `/api/workers/:id/logs?lines=200` | Tail of the worker log (`lines` ≤ 2000, tailed from the last 256 KiB) |
| `GET` | `/api/ports/next?runtime=v1&count=2` | Which ports auto-assignment would pick |

`port` accepts a number or `"auto"` (the default) — auto-assignment walks down from the runtime's
default port and skips recorded or bound ports. With `count > 1` the ports are consecutive and
count down, matching `pnpm start:v1 -- --workers N`.

`host` accepts `127.0.0.1` (default) or `0.0.0.0`. Every worker in the response carries `host` and a
`urls` array — for a wildcard bind the LAN entries come first, each tagged `scope: "lan"` with the
interface it belongs to, so the UI can offer them for copying. `GET /api/meta` exposes the same for
the console itself, plus `lanAddresses` and the allowed hosts.

```bash
# Start two workers on free ports
curl -s -X POST http://127.0.0.1:8790/api/workers \
  -H 'content-type: application/json' \
  -d '{"runtime":"v1","port":"auto","count":2,"name":"demo"}'

# Watch them, then read one log
curl -s http://127.0.0.1:8790/api/workers
curl -s "http://127.0.0.1:8790/api/workers/w-8760/logs?lines=50"
```

Useful error codes: `WORKER_EXISTS` (port already recorded — start/restart/remove that worker
instead), `UNKNOWN_RUNTIME`, `ALREADY_RUNNING`, `PORT_BUSY` (the port is held by something that is
not this worker, so a restart would only produce a worker that cannot bind), `NOT_FOUND`.

---

## Terminal and console side by side

Both entry points go through `@mock-mcp/supervisor`, so behaviour is shared rather than
reimplemented:

| Terminal | Console |
|----------|---------|
| `pnpm start:v1 -- --workers 3` | “New worker”, count = 3 |
| `pnpm status:v1` | worker table + summary cards |
| `pnpm stop:v1` | Stop / Remove |
| `pnpm run:v1` (foreground, attached) | not managed — a foreground instance is owned by its terminal |

The foreground `run` command stays exactly as it was: the console manages background (detached)
workers only.

---

## Deliberate design choices

- **No auto-restart.** The console reports an unhealthy worker; restarting is a click. Automatic
  restarts would mask crashes and make a broken build look healthy (see
  [ADR 002](./adr/002-worker-console-and-supervisor.md)).
- **Port release safety net.** The recorded PID is the `mcp-use` wrapper; the process that actually
  binds the port is its child. If the wrapper is killed with `SIGKILL`, the child is re-parented and
  keeps the port — so `stop` also checks who listens on the port and signals it, but only when the
  process is verifiably ours (its command line or working directory points into the worker's
  package). A foreign service on that port is reported, never killed.
- **Loopback by default, LAN on request.** `--host` only accepts `127.0.0.1` or `0.0.0.0`; other
  values are refused. There is no authentication, so wildcard mode is an explicit choice and the
  console prints a warning plus the exact URLs that become reachable.
- **Reserved fields.** Every record already carries `capabilities` and `protocol`, and every runtime
  can advertise capability/protocol options. Nothing consumes them yet; the detail panel shows them
  read-only so the data model does not have to change when those features land.

---

## Roadmap hooks

The next two features on this console are already prepared:

1. **Per-worker capabilities** — choose which capability groups a worker starts with
   (`capabilities: []` currently means "runtime default = all").
2. **Protocol version per worker** — MCP v1 vs v2 (`protocol: null` currently means "decided by the
   runtime"). `packages/v2` is declared in `@mock-mcp/supervisor` already; it appears in the runtime
   list automatically once the package exists.

---

## Development

```bash
pnpm console:dev     # Vite HMR on :5173, API proxied to :8790
```

| Concern | Location |
|---------|----------|
| HTTP API | `packages/console/src/api.ts` |
| Static serving | `packages/console/src/static.ts` |
| Server entry / flags | `packages/console/server.ts` |
| UI | `packages/console/ui/` (React + Tailwind, zh/en toggle) |
| Worker lifecycle | `packages/supervisor/src/lifecycle.ts` |

`tsx cli.ts start --port 8791` runs a second console in the background on another port;
`tsx cli.ts run --dev` runs it in the foreground with Vite.
