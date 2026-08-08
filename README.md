# Mock MCP Server

A mock [Model Context Protocol](https://modelcontextprotocol.io) server for testing MCP bridges, clients, and protocol version negotiation. Provides a realistic enterprise operations dataset with tools, resources, prompts, and interactive widgets — no real APIs or databases required.

Detailed tool reference, capability descriptions, and client configuration guides are in [`docs/`](./docs/).

---

## Project Structure

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared — mock data & utilities
│   ├── v1/            # @mock-mcp/v1    — mcp-use@1.32.1 (implemented)
│   └── v2/            # @mock-mcp/v2    — mcp-use@2.x   (planned)
├── public/            # Static assets
├── docs/              # Tool reference, capability docs & ADRs
└── README.md
```

---

## Quick Start

```bash
pnpm install
pnpm dev:v1       # Run the v1 server (legacy MCP protocol)
```

Open [http://localhost:8760/inspector](http://localhost:8760/inspector) to explore tools, resources, and widgets interactively.

> **v2 is currently in planning.** The `mcp-use@2` API surface is still evolving (canary releases). See [ADR 001](./docs/adr/001-monorepo-and-protocol-version-strategy.md) for the migration strategy and rationale. v1 remains the stable, tested version.

---

## Multi-Worker Deployment

```bash
# v1 — 3 workers on ports 8760, 8759, 8758
pnpm start:v1:multi -- --workers 3

# Shorthand
pnpm start:v1:multi -- -w 5
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev:v1` | v1 dev server (hot reload + inspector + widgets) |
| `pnpm build:v1` | v1 production build |
| `pnpm start:v1` | v1 production HTTP server (port 8760) |
| `pnpm start:v1:multi -- --workers N` | v1 multi-worker launcher |

v2 scripts are defined in [ADR 001](./docs/adr/001-monorepo-and-protocol-version-strategy.md) but not yet implemented.

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

## Version Strategy

This project is a mock server for protocol version testing. Two packages serve different MCP protocol eras:

- **`@mock-mcp/v1`** *(implemented)* — mcp-use v1 (pinned to `1.32.1`), implements the legacy MCP protocol. Uses `McpUseProvider`/`useWidget` widget runtime.
- **`@mock-mcp/v2`** *(planned)* — will use mcp-use v2, implementing the 2026-07-28 protocol revision. Targeting dual-era support (`legacy: "stateless"`) and modern-only mode (`legacy: "reject"`). Uses `bootstrapView`/`useToolContext` widget runtime. Deferred until `mcp-use@2` stabilizes (currently in canary).

Both packages share mock data via `@mock-mcp/shared`.

For full capability details, see [`docs/server-capabilities.md`](./docs/server-capabilities.md). For architecture decisions, see [`docs/adr/`](./docs/adr/).
