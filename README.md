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
