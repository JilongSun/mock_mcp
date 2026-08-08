# ADR 001: Monorepo Architecture & Protocol Version Strategy

- **Date:** 2026-08-08
- **Status:** Accepted
- **Deciders:** User + GitHub Copilot

---

## Context

This project is a **mock MCP server** designed to test MCP bridges (specifically [mcpapps-bridge](https://github.com)) and MCP clients against different protocol versions. It simulates an enterprise operations platform with 15 tools, 7 resources, and 3 prompts — all backed by static mock data.

We needed to:

1. Migrate from npm to pnpm as the package manager
2. Prepare for MCP protocol evolution: the upstream `@modelcontextprotocol/sdk` and `mcp-use` have released v2 (2026-07-28 spec), which introduced breaking API changes
3. Enable running both v1 (legacy) and v2 (modern) protocol servers from the same codebase for side-by-side testing

---

## Findings

### npm → pnpm

No blockers. The existing `pnpm-workspace.yaml` and `package.json` scripts (which use `mcp-use` CLI, not npm/pnpm wrappers) already supported pnpm. Only the README referenced `npm`. Migration was a mechanical change: replace `package-lock.json` with `pnpm-lock.yaml`, update README commands.

### mcp-use v1 → v2 API Break

A thorough diff between `mcp-use@1.32.1` and `mcp-use@2.0.4` revealed:

| Area | v1 | v2 | Impact |
|------|----|----|--------|
| **Import path** | `mcp-use/server` | `mcp-use` (root) | Breaking |
| **MCPServer constructor** | `{ name, title, version, description, instructions, baseUrl, favicon, websiteUrl, icons }` | `ServerConfig<TUser>` — `baseUrl` removed, `instructions` optional, new fields (`basePath`, `legacy`, `allowedHosts`, `logging`, etc.) | Breaking |
| **Tool registration** | `.tool(name, description, schema, handler)` variadic | `.tool({ name, description, inputSchema, outputSchema, ... }, callback)` config-object form | Breaking |
| **Response helpers** | `error()`, `text()`, `markdown()`, `object()`, `widget()` | Same but **`@deprecated`** | Warning |
| **React widgets** | `McpUseProvider`, `useWidget`, `useWidgetTheme`, `WidgetMetadata` | All **removed**. Replaced by `bootstrapView`, `useToolContext`, `useViewTool`, `ErrorBoundary`, `ThemeProvider` | Breaking (5 files) |

Estimated migration cost: ~20+ compile errors across `src/server.ts` and all 5 widget files.

### Protocol Compatibility

The v2 TypeScript SDK (`@modelcontextprotocol/server@2`) **does support** legacy clients through protocol version negotiation — both v1 (1.29.x) and v2 ship overlapping `supportedProtocolVersions`. The v2 SDK's migration guide confirms:

> *"the two sides negotiate a protocol version through the ordinary 2025-era `initialize` handshake and settle on the newest revision both packages support"*

`mcp-use@2` exposes this via `ServerConfig.legacy`: `"stateless"` (default, serves v1 clients in stateless mode) or `"reject"` (modern-only). So a single v2 build can serve both eras.

### mcp-use v2 Stability Concern

As of 2026-08-08, `mcp-use` publishes canary versions up to `3.0.0-canary.11`, indicating the v2 API surface is still evolving. Deferring v2 migration avoids churn from API instability.

---

## Decision: Monorepo with Deferred v2

```
mock_mcp/
├── packages/
│   ├── shared/        # @mock-mcp/shared — mock data & utilities
│   ├── v1/            # @mock-mcp/v1    — mcp-use@1.32.1 (implemented)
│   └── v2/            # @mock-mcp/v2    — mcp-use@2.x   (planned)
├── docs/
│   ├── tools-reference.md
│   └── adr/           # Architecture Decision Records
├── public/
└── README.md
```

### Rationale

1. **Shared data extraction:** `@mock-mcp/shared` prevents duplication of `mock-data.ts` and `mock-delay.ts` between versions
2. **v1 pinned:** `mcp-use@1.32.1` exact version — stable, tested, the reference implementation
3. **v2 deferred:** API instability risk. Will develop when `mcp-use@2` reaches a stable release (post-canary). The README documents intent.

### Future v2 Package Spec

When developed, `@mock-mcp/v2` will:

- Depend on `mcp-use@^2.x` (stable)
- Use `ServerConfig.legacy` with env-var override (`LEGACY=stateless|reject`)
- Replace `McpUseProvider`/`useWidget` with `bootstrapView`/`useToolContext` widget runtime
- Replace deprecated response helpers (`error()`, `text()`, etc.) with raw `CallToolResult`/`ReadResourceResult`/`GetPromptResult` shapes
- Import mock data from `@mock-mcp/shared`

Root scripts to add:

```json
{
  "dev:v2:dual":    "pnpm --filter @mock-mcp/v2 dev",
  "dev:v2:modern":  "cross-env LEGACY=reject pnpm --filter @mock-mcp/v2 dev",
  "build:v2":       "pnpm --filter @mock-mcp/v2 build",
  "start:v2:dual":  "LEGACY=stateless pnpm --filter @mock-mcp/v2 start",
  "start:v2:modern":"LEGACY=reject pnpm --filter @mock-mcp/v2 start"
}
```

---

## Consequences

- **Positive:** Clean separation of protocol versions; shared mock data avoids duplication; pnpm workspace enables parallel development
- **Negative:** v2 widget files (~5) require full rewrite (different component model); `mcp-use@2` API surface still evolving
- **Risk:** If `mcp-use@2` drops `legacy: "stateless"` or changes the dual-era behavior, the v2 package design may need adjustment

---

## References

- [MCP Specification 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [mcp-use v1→v2 Migration Guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- `docs/tools-reference.md` — full tool/resource/prompt catalog
