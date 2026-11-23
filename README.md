# Mock MCP Server

English | [简体中文](./README_zh.md)

A mock [Model Context Protocol](https://modelcontextprotocol.io) server for testing independent hosts that implement the MCP Apps SEP-1865 protocol. It provides a realistic enterprise operations dataset with tools, resources, prompts, and interactive widgets — no real APIs or databases required.

Detailed tool reference, capability descriptions, and client configuration guides are in [`docs/`](./docs/).

---

## Project Structure

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared     — mock data & utilities
│   ├── supervisor/    # @mock-mcp/supervisor — worker registry & lifecycle
│   ├── console/       # @mock-mcp/console    — multi-worker web console
│   ├── v1/            # @mock-mcp/v1         — mcp-use@1.32.1 server
│   └── v2/            # @mock-mcp/v2         — mcp-use@2.10.0 server
├── public/            # Static assets
├── docs/              # Tool reference, capability docs & ADRs
└── README.md
```

---

## Quick Start

To build all packages with both production inspectors and manage the console
(Node.js >= 22.22.2 is required for v2):

```bash
pnpm install
make build        # or just make
make start        # start the console in the background
make stop         # stop the console; workers keep running
```

Open [http://127.0.0.1:8790](http://127.0.0.1:8790) and create workers in the
console. Building does not restart workers that are already running.

For development:

```bash
pnpm install
pnpm dev:v1       # Run the SEP-1865 MCP Apps server
```

Open [http://localhost:8760/inspector](http://localhost:8760/inspector) to explore tools, resources, and widgets interactively.

For the MCP 2026-07-28 runtime (requires Node.js >= 22.22.2):

```bash
pnpm dev:v2
```

Open [http://localhost:8770/mcp/inspector](http://localhost:8770/mcp/inspector).
The v2 server includes the four tool-bound MCP Apps: user search, orders, locations and
the interactive order manager. To enable the production inspector, run
`pnpm build:v2:inspector` and restart the worker.

`manage-orders` opens the **Order Manager** widget, whose buttons call a separate widget-internal
helper, `apply-order-action` (`action: "update-status"` or `action: "undo"`). Keeping the two apart
means the launcher stays a single-purpose tool and widget-only parameters never reach an agent.
This is the quickest way to check that a host wires the MCP Apps bridge end to end: in the inspector,
execute `manage-orders`, switch the response panel to **Component (MCP Apps)**, then press a status
button and watch `tools/call: apply-order-action` appear in the server log. Press **Undo** to roll
the change back without restarting. See [`docs/server-capabilities.md`](./docs/server-capabilities.md#testing-widgets-in-the-inspector).

> The inspector is only served by `pnpm dev:v1`. Production runs (`pnpm run:v1` / `pnpm start:v1`)
> skip it — build with `mcp-use build --with-inspector` if you need it outside dev mode. Widgets
> themselves are served in both modes at `/mcp-use/widgets/<name>`.
>
> Order status changes are in memory: **Undo** reverses them, and a full restart restores the
> original dataset. A dev-mode code edit does *not* reset them. Full matrix in
> [`docs/server-capabilities.md`](./docs/server-capabilities.md#interactive-state-and-reset-semantics).

---

## Run Modes

`v1` can run **in the foreground** (attached to your terminal) or **in the background**
(detached — it keeps running after you close the terminal).

```bash
# Foreground — logs stream to the terminal, Ctrl+C stops everything
pnpm run:v1

# Background — records its ports/PIDs locally and logs to .run/logs/
pnpm start:v1

# Inspect & stop background workers
pnpm status:v1
pnpm stop:v1                    # stops recorded v1 workers only
pnpm stop:v1 -- --port 8760     # stops only the worker on that port
```

Background records live in the repository-root `.run/` directory (git-ignored): `workers.json`
holds the port/PID records, `logs/` holds one log file per worker. The same registry is shared
with the [worker console](#worker-console), so workers started in a terminal show up there and
vice versa.

The same commands are available as `run:v2`, `start:v2`, `status:v2`, and `stop:v2`;
v2 defaults to port `8770`. Status and stop are scoped to the selected runtime.

Capabilities are chosen at startup. v2 exposes one, `legacy` (MCP v1 compatibility), which is on by
default. Disable it for a modern-only worker:

```bash
pnpm start:v2 -- --no-legacy        # 2025-era clients get -32022 Unsupported protocol version
pnpm start:v2 -- -c legacy          # explicit list; -c "" disables everything
```

The console offers the same choice as checkboxes in **New worker** and shows the recorded set in the
worker details. Restart or re-create a worker to change its capabilities.

`start` waits for the server to **actually bind its port** before reporting success —
cold boot takes ~10–20s and `mcp-use` prints nothing in the meantime, so an
immediate success message would be misleading. If a worker dies or never binds, the
group is rolled back (stopped + removed from the registry) and `start` exits non-zero.
Tune the budget with `--timeout <seconds>` (default `45`).

`pnpm status:v1` probes the port too, and only counts the port as the worker's when the
listening process really belongs to that worker — so it distinguishes `running` from
`alive but NOT listening (booting or hung)` and warns when `port held by another process`.

### Bind address (local vs LAN)

Workers bind **IPv4 loopback** (`127.0.0.1`) by default, which is what `.mcp.json` points at. Pass
`--host 0.0.0.0` to listen on every interface so other machines on your network can connect:

```bash
pnpm start:v1 -- --port 8799 --host 0.0.0.0
#   Bind:   0.0.0.0
#   LAN:    http://192.168.1.20:8799/mcp     ← give this to a client on the LAN
#   Local:  http://127.0.0.1:8799/mcp
```

`0.0.0.0` is a *bind* address, so the LAN URLs are derived from this machine's actual interfaces
(from the machine's own network interfaces) and printed by `start`. The chosen address is also used as the base URL handed to
`mcp-use`, so widgets served to a remote host fetch their assets from this machine instead of from
the client itself.

Only those two values are accepted. Looping back is the default because a LAN-bound server is
reachable by everything on the network.

### Multi-Worker (background only)

Multi-worker mode is exclusive to `start`. `run` is always a single foreground instance.

Add `--workers N`. Workers listen on sequential ports counting down from the base port
(8760, 8759, 8758, …) and are recorded as **one group**, so a single `pnpm stop:v1` shuts
every worker down.

```bash
# Background — 3 workers on ports 8760, 8759, 8758
pnpm start:v1 -- --workers 3 --port 8760

# Shorthand
pnpm start:v1 -- -w 5
```

| Option | Description |
|--------|-------------|
| `-p, --port <n>` | Base port (default `8760`) |
| `-H, --host <ip>` | Bind address: `127.0.0.1` (default) or `0.0.0.0` (LAN) |
| `-w, --workers <n>` | (`start` only) number of background workers (default `1`) |
| `-t, --timeout <s>` | (`start` only) seconds to wait for readiness (default `45`) |
| `-a, --all` | (`stop`) stop every recorded worker — already the default |
| `-h, --help` | Show usage |

---

## Worker Console

`pnpm console` starts a light web console in the **background** at
[http://127.0.0.1:8790](http://127.0.0.1:8790) for managing every worker from one place: start,
stop, restart, remove, watch status and tail logs. It is **a supervisor, not a worker** — it never
runs an MCP server itself and it drives the same registry as the CLI, so both stay in sync.

```bash
pnpm console         # build the UI if needed, start in the BACKGROUND (survives terminal)
pnpm console:status  # where is it, is it still serving
pnpm console:stop    # stop the console — workers keep running
pnpm console:run     # foreground instead (Ctrl+C stops it)
pnpm console:dev     # Vite dev server with HMR on :5173 (API proxied to 8790)
pnpm build:console   # UI build only
pnpm console -- --host 0.0.0.0   # let other machines on the LAN open the console

# Optional: enable the production inspector for the chosen runtime
pnpm build:v1:inspector
pnpm build:v2:inspector
```

### Built-in inspector (optional)

Each worker row has an **Inspector** button that opens the worker's own MCP inspector in a
full-screen panel, already connected to that worker's `/mcp` — browse tools, call them, inspect
resources and prompts without leaving the console.

The inspector is **not** enabled by the default build. Build it once
with `pnpm build:v1:inspector` or `pnpm build:v2:inspector` and restart the workers; until then the
panel explains exactly what to run. The flag lives in the build manifest, which all workers of a
runtime share, so this is a per-build choice rather than a per-worker one.
v1 serves it at `/inspector`; v2 mounts it at `/mcp/inspector` when the worker starts.
Run the inspector build again after a normal rebuild to re-enable it.

The console is detached exactly like a background worker: it records its PID/port in
`.run/console.json`, logs to `.run/logs/console-<port>.log`, and closing the terminal does not stop
it.

**It is a control plane, not a parent.** `pnpm console:stop` (or closing a foreground console) only
closes the console itself; every worker keeps running and listening, because workers are spawned
detached and the console holds no process handles. Stop workers with `pnpm stop:v1` or the UI.

- **Status** is derived from the PID *and* port ownership (`running`, `starting`,
  `unresponsive`, `stopping`, `stopped`, `exited`), refreshed every 2s. The ownership check is
  cached for 20s and invalidated on every action, so polling stays cheap; nothing polls while no
  page is open.
- **Workers never auto-restart.** The console reports a crashed or hung worker; restarting is a
  deliberate click.
- The console binds loopback by default. `--host 0.0.0.0` makes it reachable from the LAN and prints
  the exact URLs to hand out.
- New workers default to an automatically allocated free port, counting down from the selected
  runtime's default port. Per-worker capability and protocol override fields are not yet active.

Full API reference, ports and internals: [`docs/worker-console.md`](./docs/worker-console.md)
([简体中文](./docs/worker-console_zh.md)).

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev:v1` | v1 dev server (hot reload + inspector + widgets) |
| `pnpm build:v1` | v1 production build (no inspector — light) |
| `pnpm build:v1:inspector` | v1 production build **including** the MCP inspector |
| `pnpm run:v1` | v1 server in the **foreground** (port 8760) |
| `pnpm start:v1` | v1 server in the **background** (survives closing the terminal) |
| `pnpm status:v1` | List recorded background worker(s) |
| `pnpm stop:v1` | Stop background worker(s) — all of them by default |
| `pnpm dev:v2` | v2 development server and inspector (port 8770) |
| `pnpm build:v2` | Build v2 server and MCP Apps |
| `pnpm build:v2:inspector` | Build v2 with the production inspector enabled |
| `pnpm run:v2` / `pnpm start:v2` | Run v2 in the foreground / background |
| `pnpm status:v2` / `pnpm stop:v2` | List / stop recorded v2 workers |
| `pnpm console` | Build + start the worker console in the **background** (port 8790) |
| `pnpm console:run` | Worker console in the **foreground** (Ctrl+C stops it) |
| `pnpm console:status` | Show the background console and whether it is serving |
| `pnpm console:stop` | Stop the background console — workers keep running |
| `pnpm console:dev` | Console UI in Vite dev mode (port 5173) |

Add `-- --workers N` to `start:v1` for multi-worker background mode.

---

## Client Configuration

### HTTP Mode

```json
{
  "servers": {
    "enterprise-ops-hub": {
      "url": "http://localhost:8760/mcp",
      "type": "http"
    }
  }
}
```

### stdio Mode

For v1, widgets (`ui://widget/*`) are HTTP-only. Its other capabilities are available over stdio:

```json
{
  "servers": {
    "enterprise-ops-hub": {
      "command": "npx",
      "args": ["tsx", "packages/v1/src/stdio.ts"],
      "cwd": "/path/to/mock_mcp"
    }
  }
}
```

The v2 runtime currently provides HTTP only. Modern clients send protocol version and client
metadata on each request and use multi-round-trip requests for roots, elicitation and sampling.
Older HTTP clients can initialize and use tools, resources, prompts and MCP Apps through stateless
compatibility, unless the worker was started with the `legacy` capability disabled. Unlike v1, the v2 SDK does not retain legacy client capabilities per session:
legacy roots, elicitation and sampling may be reported unsupported even when advertised.
Use v1 when those legacy interactions or stdio are required.

---

## Runtime and Build Strategy

The `v1` package name identifies the pinned `mcp-use@1.32.1` runtime; it does not identify a legacy MCP Apps protocol. The server exposes SEP-1865 `ui.resourceUri` metadata, and widgets use the MCP Apps bridge rather than the OpenAI compatibility provider.

Each workspace package owns its compiled output:

- `@mock-mcp/shared` builds to `packages/shared/dist` and exports JavaScript and declarations from that directory.
- `@mock-mcp/supervisor` builds to `packages/supervisor/dist`; both the `v1` CLI and the console import it, so worker start/stop/status behaves identically in a terminal and in the UI.
- `@mock-mcp/console` builds its UI to `packages/console/dist/ui`; the server itself runs from TypeScript via `tsx`.
- `@mock-mcp/v1` builds the server and widgets to `packages/v1/dist`.
- `@mock-mcp/v2` builds the server and views to `packages/v2/.mcp-use/build`.

Keeping these outputs package-local preserves Node package export resolution. The root package orchestrates builds but does not flatten independently versioned workspace packages into a shared root `dist`.

For full capability details, see [`docs/server-capabilities.md`](./docs/server-capabilities.md) ([简体中文](./docs/server-capabilities_zh.md)). For architecture decisions, see [`docs/adr/`](./docs/adr/).
