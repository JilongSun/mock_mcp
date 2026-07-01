# Mock MCP Server — Tool Reference

> 15 tools · 4 resources · 3 prompts · 3 widgets  
> Built for testing [mcpapps-bridge](https://github.com) with Hermes and other MCP clients.

---

## Architecture

```
                    stdio / HTTP                    stdio / HTTP
  Hermes Agent  ─────────────────→  mcpapps-bridge  ─────────────────→  Mock MCP Server
  (limited host)                                              (full capabilities)
```

The bridge forwards MCP protocol messages between Hermes and the mock server.  
Tools marked with 🧪 test whether the bridge correctly handles specific `ClientCapabilities`.

---

## Tools

### Base CRUD (8 tools)

| # | Tool | Widget | Description |
|---|------|--------|-------------|
| 1 | `search-users` | ✅ user-search-results | Search mock users by name, role, or department |
| 2 | `get-product-details` | ❌ | Get detailed info about a mock product by ID |
| 3 | `list-orders` | ✅ order-list | Paginated order listing with status filter |
| 4 | `create-document` | ❌ | Simulate document creation (no-op, mock only) |
| 5 | `get-location-info` | ✅ location-map | Find nearby POIs around a lat/lng coordinate |
| 6 | `generate-report` | ❌ | Generate a mock analytics report |
| 7 | `search-knowledge` | ❌ | Full-text search the mock knowledge base |
| 8 | `get-server-status` | ❌ | Mock server health and metrics |

### Bridge Capability Tests (7 tools) 🧪

Each tool gracefully degrades when the bridge does not forward the required capability.

| # | Tool | Capability | Behavior when unsupported |
|---|------|-----------|--------------------------|
| 9 | `list-roots` | `roots` | Returns `supported: false` with diagnostic note |
| 10 | `request-approval` | `elicitation` | Returns `approved: false` with diagnostic note |
| 11 | `collect-feedback` | `elicitation` | Returns `supported: false` with diagnostic note |
| 12 | `summarize-text` | `sampling` | Returns `supported: false`; also catches client rejection |
| 13 | `list-client-capabilities` | `capabilities` | Always works — shows what bridge actually forwards |
| 14 | `get-user-context` | `user context` | Returns `user: null` if identity not forwarded |
| 15 | `slow-operation` | `progress` | Runs without progress if client didn't request it |

---

## Capability Details

### Roots (`list-roots`)
Calls `server.listRoots()` to retrieve filesystem roots the client has shared.
If the bridge forwards `roots` capability, Hermes can expose host directories to the server.

### Elicitation (`request-approval`, `collect-feedback`)
Server sends a form to the client for user interaction.
- `request-approval`: boolean approval + optional reason
- `collect-feedback`: numeric rating (1-5) + optional comment

If the bridge forwards `elicitation`, Hermes can present forms to the user and return responses.

### Sampling (`summarize-text`)
Server delegates LLM work to the client via `ctx.sample()`.
The mock server sends text + target length, the client's LLM returns a summary.

Includes error handling for client rejection of sampling requests.

### Capabilities Introspection (`list-client-capabilities`)
Returns the full `ClientCapabilities` object + client info + user identity.
Useful for debugging: compare what the bridge advertises vs what Hermes expects.

### User Context (`get-user-context`)
Returns `ctx.client.user()` — subject, locale, timezone, location.
Verifies the bridge forwards the host's user identity.

### Progress (`slow-operation`)
Simulates a multi-step operation, calling `ctx.reportProgress(i, total)` at each step.
Verifies the bridge forwards progress notifications.

---

## Resources

| URI | Description |
|-----|-------------|
| `data://poi-types` | Available POI types with icons and colors |
| `config://server-info` | Server version, capabilities, limits |
| `docs://api-reference` | Markdown API reference for all tools |
| `data://mock-stats` | Dataset counts and distributions |

## Prompts

| Name | Description |
|------|-------------|
| `explore-locations` | Template for exploring nearby POIs |
| `analyze-orders` | Template for order data analysis |
| `generate-mock-data` | Template for creating mock data records |

## Widgets

| Name | Tool | Visual |
|------|------|--------|
| `user-search-results` | `search-users` | User cards with role badges and avatars |
| `order-list` | `list-orders` | Paginated table with status badges, expandable items |
| `location-map` | `get-location-info` | CSS grid map with colored POI pins, clickable details |

---

## Configuration

### HTTP mode

```json
{
  "servers": {
    "mock-mcp": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### stdio mode (development)

```json
{
  "servers": {
    "mock-mcp": {
      "command": "npx",
      "args": ["tsx", "src/stdio.ts"],
      "cwd": "/path/to/mock_mcp"
    }
  }
}
```

### stdio mode (production)

```json
{
  "servers": {
    "mock-mcp": {
      "command": "node",
      "args": ["dist/src/stdio.js"],
      "cwd": "/path/to/mock_mcp"
    }
  }
}
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | HTTP dev server with hot reload + inspector |
| `npm run build` | Production build (TypeScript + widgets) |
| `npm run start` | Production HTTP server |
| `npx tsx src/stdio.ts` | stdio mode (for Hermes) |

## Data

All data is static and fake. Every tool introduces a simulated delay (100ms–2500ms with random jitter) to mimic real API latency.

| Dataset | Count | Examples |
|---------|-------|----------|
| Users | 12 | `admin`, `developer`, `editor`, `viewer` |
| Products | 12 | Electronics, furniture, accessories |
| Orders | 12 | All statuses: `pending` → `delivered` |
| Locations | 15 | NYC restaurants, parks, museums, cafés, hotels, shops, landmarks |
| Documents | 8 | Reports, memos, guides, specs |
| Knowledge Base | 8 | Account, API, and general articles |
