# Mock MCP Server

English | [简体中文](./README_zh.md)

A mock [Model Context Protocol](https://modelcontextprotocol.io) server for testing independent hosts that implement the MCP Apps SEP-1865 protocol. It provides a realistic enterprise operations dataset with tools, resources, prompts, and interactive widgets — no real APIs or databases required.

Detailed tool reference, capability descriptions, and client configuration guides are in [`docs/`](./docs/).

---

## Project Structure

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared — mock data & utilities
│   └── v1/            # @mock-mcp/v1    — mcp-use@1.32.1 server
├── public/            # Static assets
├── docs/              # Tool reference, capability docs & ADRs
└── README.md
```

---

## Quick Start

```bash
pnpm install
pnpm dev:v1       # Run the SEP-1865 MCP Apps server
```

Open [http://localhost:8760/inspector](http://localhost:8760/inspector) to explore tools, resources, and widgets interactively.

`manage-orders` renders the **Order Manager** — an interactive widget whose buttons call the
`update-order-status` tool back on the server, and whose **Undo** button calls `undo-order-status`.
It is the quickest way to check that a host wires the MCP Apps bridge end to end: in the inspector,
execute `manage-orders`, switch the response panel to **Component (MCP Apps)**, then press a status
button and watch `tools/call: update-order-status` appear in the server log. Press **Undo** to roll
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

# Background — records its ports/PIDs locally and logs to packages/v1/.run/logs/
pnpm start:v1

# Inspect & stop background jobs
pnpm status:v1
pnpm stop:v1                    # stops EVERY recorded job
pnpm stop:v1 -- --port 8760     # stops only the job on that port
```

Background records live in `packages/v1/.run/` (git-ignored): `processes.json` holds
the port/PID records, `logs/` holds one log file per job.

`start` waits for the server to **actually bind its port** before reporting success —
cold boot takes ~10–20s and `mcp-use` prints nothing in the meantime, so an
immediate success message would be misleading. If a worker dies or never binds, the
job is rolled back (stopped + removed from the record) and `start` exits non-zero.
Tune the budget with `--timeout <seconds>` (default `45`).

`pnpm status:v1` probes the port too, so it distinguishes `running` from
`alive but NOT listening (booting or hung)`.

### Multi-Worker (background only)

Multi-worker mode is exclusive to `start`. `run` is always a single foreground instance.

Add `--workers N`. Workers listen on sequential ports counting down from the base port
(8760, 8759, 8758, …) and are recorded as **one job**, so a single `pnpm stop:v1` shuts
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
| `-w, --workers <n>` | (`start` only) number of background workers (default `1`) |
| `-t, --timeout <s>` | (`start` only) seconds to wait for readiness (default `45`) |
| `-a, --all` | (`stop`) stop every recorded job — already the default |
| `-h, --help` | Show usage |

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev:v1` | v1 dev server (hot reload + inspector + widgets) |
| `pnpm build:v1` | v1 production build |
| `pnpm run:v1` | v1 server in the **foreground** (port 8760) |
| `pnpm start:v1` | v1 server in the **background** (survives closing the terminal) |
| `pnpm status:v1` | List recorded background job(s) |
| `pnpm stop:v1` | Stop background job(s) — all of them by default |

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

Widgets (`ui://widget/*`) are HTTP-only. All other capabilities — tools, static resources, prompts, elicitation, sampling, roots, progress, logging — are available over stdio.

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

---

## Runtime and Build Strategy

The `v1` package name identifies the pinned `mcp-use@1.32.1` runtime; it does not identify a legacy MCP Apps protocol. The server exposes SEP-1865 `ui.resourceUri` metadata, and widgets use the MCP Apps bridge rather than the OpenAI compatibility provider.

Each workspace package owns its compiled output:

- `@mock-mcp/shared` builds to `packages/shared/dist` and exports JavaScript and declarations from that directory.
- `@mock-mcp/v1` builds the server and widgets to `packages/v1/dist`.

Keeping these outputs package-local preserves Node package export resolution. The root package orchestrates builds but does not flatten independently versioned workspace packages into a shared root `dist`.

For full capability details, see [`docs/server-capabilities.md`](./docs/server-capabilities.md). For architecture decisions, see [`docs/adr/`](./docs/adr/).
