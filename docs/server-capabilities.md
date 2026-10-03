# Server Capabilities

> 17 tools · 9 resources (4 data + 5 interactive widgets) · 3 prompts  
> Built for testing [mcpapps-bridge](https://github.com) with Hermes and other MCP clients.

---

## Use Cases

### AI-Powered Enterprise Assistant

Equip your AI agent with direct access to company data. Ask natural language questions like:

- *"Find all developers in the Engineering team"* → `search-users` tool with role filter and visual user cards
- *"Show me shipped orders from this week"* → `list-orders` tool with paginated table and status badges
- *"What's our top-selling product?"* → `get-product-details` across the catalog with ratings and inventory data
- *"Generate a sales report for Q4"* → `generate-report` with revenue, conversion, and customer metrics

### Location-Based Decision Making

The `get-location-info` tool + `location-map` widget delivers an interactive point-of-interest explorer:

- *"Find restaurants near the conference venue"* → visual map with colored pins by POI type
- *"Are there any parks close to the hotel?"* → filtered by park type, with ratings and addresses
- Filter by restaurant, park, museum, café, hotel, shopping, or landmark — adjust radius from 0.01 to 50 km

### Workflow Automation with Approvals

The server supports human-in-the-loop elicitation workflows:

- **Approval gates** — `request-approval` tool presents confirmation dialogs for sensitive actions (deploy, delete, grant access)
- **Feedback collection** — `collect-feedback` tool gathers structured ratings and comments from users
- **Text summarization** — `summarize-text` delegates to the client's LLM for on-demand summarization via the sampling protocol

### Real-Time Operations Dashboard

Monitor system health through the agent:

- `get-server-status` — uptime, request volume, active connections, CPU/memory usage
- `list-client-capabilities` — introspect what the connected client supports (roots, sampling, elicitation, apps)
- `get-user-context` — retrieve the current user's locale, timezone, and location for personalized responses

### Knowledge Management

- `search-knowledge` — full-text search across the knowledge base (account, API, and general categories)
- `create-document` — create reports, memos, guides, or specs with tag-based categorization
- Resources provide structured reference data: POI type catalog, server configuration, API docs, dataset statistics, and interactive visual widgets

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

## Tools (17)

### Base CRUD (8 tools)

| # | Tool | Category | Description |
|---|------|----------|-------------|
| 1 | `search-users` | People | Search mock users by name, role, or department |
| 2 | `get-product-details` | Catalog | Get detailed product info, stock, and ratings by ID |
| 3 | `list-orders` | Orders | Paginated order listing with status filter |
| 4 | `create-document` | Content | Simulate document creation (report, memo, guide, spec) |
| 5 | `get-location-info` | Location | Find nearby POIs around a lat/lng coordinate |
| 6 | `generate-report` | Analytics | Generate mock reports (sales, usage, performance, security) |
| 7 | `search-knowledge` | Content | Full-text search the mock knowledge base |
| 8 | `get-server-status` | DevOps | Mock server health, uptime, and resource metrics |

### Interactive Widget Tools (2 tools)

Unlike the other widgets (populated by a tool, then read-only), `order-actions` sends work back to
the server: every button press inside the widget performs a `tools/call`.

| # | Tool | Category | Description |
|---|------|----------|-------------|
| 9 | `manage-orders` | Orders | Opens the interactive **Order Manager** widget (optionally filtered by status) |
| 10 | `update-order-status` | Orders | Changes one order's status; called from the widget and directly callable by a model |

`update-order-status` returns `structuredContent.order` so the widget can patch a single row without
refetching, plus `previousStatus` and a human-readable `note`. Changes live in memory and reset on
restart. Unknown order ids are rejected via an `isError: true` tool result.

### Bridge Capability Tests (7 tools) 🧪

Each tool gracefully degrades when the bridge does not forward the required capability.

| # | Tool | Capability | Behavior when unsupported |
|---|------|-----------|--------------------------|
| 11 | `list-roots` | `roots` | Returns `supported: false` with diagnostic note |
| 12 | `request-approval` | `elicitation` | Returns `approved: false` with diagnostic note |
| 13 | `collect-feedback` | `elicitation` | Returns `supported: false` with diagnostic note |
| 14 | `summarize-text` | `sampling` | Returns `supported: false`; also catches client rejection |
| 15 | `list-client-capabilities` | `capabilities` | Always works — shows what bridge actually forwards |
| 16 | `get-user-context` | `user context` | Returns `user: null` if identity not forwarded |
| 17 | `slow-operation` | `progress` | Runs without progress if client didn't request it |

---

## Capability Details

### Roots (`list-roots`)

Calls `server.listRoots()` to retrieve filesystem roots the client has shared. If the bridge forwards `roots` capability, Hermes can expose host directories to the server.

### Elicitation (`request-approval`, `collect-feedback`)

Server sends a form to the client for user interaction:
- **`request-approval`** — boolean approval + optional reason. Use for deploy gates, delete confirmations, access grants.
- **`collect-feedback`** — numeric rating (1-5) + optional comment. Use for UX surveys, feature feedback.

If the bridge forwards `elicitation`, Hermes can present forms to the user and return responses.

### Sampling (`summarize-text`)

Server delegates LLM work to the client via `ctx.sample()`. The mock server sends text + target length, the client's LLM returns a summary. Includes error handling for client rejection of sampling requests.

### Capabilities Introspection (`list-client-capabilities`)

Returns the full `ClientCapabilities` object, client info (name, version), and user identity. Useful for debugging: compare what the bridge advertises vs what Hermes expects. Also reports `supportsApps` status.

### User Context (`get-user-context`)

Returns `ctx.client.user()` — subject, locale, timezone, location. Verifies the bridge forwards the host's user identity.

### Progress (`slow-operation`)

Simulates a multi-step operation (3–20 configurable steps), calling `ctx.reportProgress(i, total)` at each step with log messages. Verifies the bridge forwards progress notifications.

---

## Resources (9)

### Static Data Resources

| URI | Type | Description |
|-----|------|-------------|
| `data://poi-types` | `application/json` | POI type catalog with icons, labels, and colors |
| `config://server-info` | `application/json` | Server version, capabilities, and configuration limits |
| `docs://api-reference` | `text/markdown` | Markdown API reference for all tools and parameters |
| `data://mock-stats` | `application/json` | Live dataset counts and distribution breakdowns |

### Visual Widget Resources

Widgets follow the MCP `ui://` URI scheme (`ui://widget/{name}.html`). Unlike static resources that return raw content, widget resources deliver interactive React-based UIs rendered directly in the MCP client. Each widget is dual-registered as both an MCP tool and a resource — tools populate them with data, and `ui://` URIs provide direct resource access.

| URI | Widget | Triggered By | Visual |
|-----|--------|-------------|--------|
| `ui://widget/user-search-results.html` | **User Search Results** | `search-users` | Role-badged user cards with avatars, departments, and join dates |
| `ui://widget/order-list.html` | **Order List** | `list-orders` | Paginated table with color-coded status badges, expandable line items |
| `ui://widget/order-actions.html` | **Order Manager** | `manage-orders` | Interactive order cards — buttons change status via `update-order-status`, plus an "Ask AI" follow-up button |
| `ui://widget/location-map.html` | **Location Map** | `get-location-info` | CSS grid map with colored POI pins, clickable details with ratings and addresses |

### Widget Interactivity Reference

| Widget | Client-side | Round-trip to server |
|--------|-------------|----------------------|
| `user-search-results` | — | — |
| `order-list` | Expand/collapse line items | — |
| `location-map` | Pin selection, hover | — |
| `order-actions` | Per-row busy state, inline feedback, local row patching | `update-order-status` (**widget → `tools/call`**), `sendFollowUpMessage` (Ask AI) |
| `product-search-result` | Favorites, display mode, accordion | `useCallTool`, `setState`, `sendFollowUpMessage` (template widget, not exposed as a tool) |

`order-actions` is the widget to use when validating that a host really implements the MCP Apps
bridge: if the buttons do nothing, the host is rendering HTML without wiring `tools/call` back to
the server.

---

## Prompts (3)

| Prompt | Purpose |
|--------|---------|
| `explore-locations` | Guided template for POI discovery workflows |
| `analyze-orders` | Template for order data analysis (status, revenue, customers, trends) |
| `generate-data` | Template for creating structured data records |

---

## Mock Data

All data is static and fake. Every tool introduces a simulated delay (100ms–2500ms with random jitter) to mimic real API latency. No real APIs or databases are used.

| Dataset | Count | Description |
|---------|-------|-------------|
| Users | 12 | Roles: admin, developer, editor, viewer — across Engineering, Design, Platform, Marketing, Content, Research |
| Products | 12 | Electronics, furniture, accessories — with pricing, stock, ratings, and descriptions |
| Orders | 12 | All statuses: pending → processing → shipped → delivered + cancelled |
| Locations | 15 | NYC restaurants, parks, museums, cafés, hotels, shops, landmarks with lat/lng |
| Documents | 8 | Reports, memos, guides, specs — with tag-based categorization |
| Knowledge Base | 8 | Account, API, and general articles — full-text searchable |

Order statuses changed through `update-order-status` are held in memory only, so restarting the
server restores the original dataset.

---

## Testing Widgets in the Inspector

The bundled inspector (`@mcp-use/inspector`, shipped with `mcp-use dev` / `mcp-use build`) renders
widgets in an iframe and implements the MCP Apps host side, so interactivity can be exercised
without a separate host:

1. `pnpm dev:v1`, then open <http://localhost:8760/inspector>.
2. Go to **Tools**, pick `manage-orders`, and press **Execute**.
3. The response panel switches to **Component (MCP Apps)** and renders the widget in an iframe.
   **Raw JSON** shows the same response as data.
4. Press a status button inside the widget — the server log shows a `tools/call: update-order-status`
   entry and the row updates in place.
5. Press **Ask AI** — the inspector raises a **Widget follow-up** notification containing the message
   the widget asked the conversation to handle.

The inspector has no LLM attached, so `sendFollowUpMessage` surfaces as a notification rather than
producing an assistant reply. That is expected; a real host would instead start a new turn.

The inspector ships with dev mode only. Production runs skip it — rebuild with
`mcp-use build --with-inspector` to include it. Widgets are served in both modes, at
`/mcp-use/widgets/<name>`.
