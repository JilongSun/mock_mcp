# Enterprise Operations Hub (MCP Server)

An **MCP-native enterprise operations platform** that unifies team management, product catalog, order processing, knowledge base, location intelligence, analytics, and DevOps monitoring into a single server — all accessible from any MCP-compatible AI agent or client.

With 15 tools, 4 resources, 3 prompts, and 3 rich visual widgets, agents can search users, browse product catalogs, manage orders, generate reports, explore points of interest on interactive maps, and monitor system health — without switching contexts or integrating multiple APIs.

---

## Use Cases

### 🤖 AI-Powered Enterprise Assistant

Equip your AI agent with direct access to company data. Ask natural language questions like:

- *"Find all developers in the Engineering team"* → `search-users` tool with role filter and visual user cards
- *"Show me shipped orders from this week"* → `list-orders` tool with paginated table and status badges
- *"What's our top-selling product?"* → `get-product-details` across the catalog with ratings and inventory data
- *"Generate a sales report for Q4"* → `generate-report` with revenue, conversion, and customer metrics

### 🗺️ Location-Based Decision Making

The `get-location-info` tool + `location-map` widget delivers an interactive point-of-interest explorer:

- *"Find restaurants near the conference venue"* → visual map with colored pins by POI type
- *"Are there any parks close to the hotel?"* → filtered by park type, with ratings and addresses
- Filter by restaurant, park, museum, café, hotel, shopping, or landmark — adjust radius from 0.01 to 50 km

### 📋 Workflow Automation with Approvals

The server supports human-in-the-loop elicitation workflows:

- **Approval gates** — `request-approval` tool presents confirmation dialogs for sensitive actions (deploy, delete, grant access)
- **Feedback collection** — `collect-feedback` tool gathers structured ratings and comments from users
- **Text summarization** — `summarize-text` delegates to the client's LLM for on-demand summarization via the sampling protocol

### 📊 Real-Time Operations Dashboard

Monitor system health through the agent:

- `get-server-status` — uptime, request volume, active connections, CPU/memory usage
- `list-client-capabilities` — introspect what the connected client supports (roots, sampling, elicitation, apps)
- `get-user-context` — retrieve the current user's locale, timezone, and location for personalized responses

### 📚 Knowledge Management

- `search-knowledge` — full-text search across the knowledge base (account, API, and general categories)
- `create-document` — create reports, memos, guides, or specs with tag-based categorization
- Resources provide structured reference data: POI type catalog, server configuration, API docs, and dataset statistics

---

## Capabilities at a Glance

### Tools (15)

| Category | Tool | Widget | Description |
|----------|------|--------|-------------|
| **People** | `search-users` | ✅ User Cards | Search team members by name, role, or department |
| **Catalog** | `get-product-details` | ❌ | Look up product info, stock, and ratings by ID |
| **Orders** | `list-orders` | ✅ Data Table | Paginated orders with status filtering and expandable items |
| **Content** | `create-document` | ❌ | Create reports, memos, guides, and specs |
| **Content** | `search-knowledge` | ❌ | Full-text search across help articles and documentation |
| **Location** | `get-location-info` | ✅ Interactive Map | Explore nearby POIs with colored pins and details |
| **Analytics** | `generate-report` | ❌ | Sales, usage, performance, or security reports with metrics |
| **DevOps** | `get-server-status` | ❌ | Uptime, connections, CPU, memory, and request metrics |
| **Workflow** | `request-approval` | ❌ | Human-in-the-loop approval for sensitive actions |
| **Workflow** | `collect-feedback` | ❌ | Structured rating and comment collection |
| **AI** | `summarize-text` | ❌ | Delegate summarization to the client's LLM |
| **Debug** | `list-client-capabilities` | ❌ | Introspect connected client features |
| **Debug** | `get-user-context` | ❌ | Current user identity, locale, and timezone |
| **Debug** | `list-roots` | ❌ | Filesystem roots shared by the client |
| **Debug** | `slow-operation` | ❌ | Multi-step operation with progress notifications |

### Resources (4)

| URI | Content |
|-----|---------|
| `data://poi-types` | POI type catalog with icons, labels, and colors |
| `config://server-info` | Server version, capabilities, and configuration limits |
| `docs://api-reference` | Markdown API reference for all tools and parameters |
| `data://mock-stats` | Live dataset counts and distribution breakdowns |

### Prompts (3)

| Prompt | Purpose |
|--------|---------|
| `explore-locations` | Guided template for POI discovery workflows |
| `analyze-orders` | Template for order data analysis (status, revenue, customers, trends) |
| `generate-data` | Template for creating structured data records |

### Visual Widgets (3)

| Widget | Triggered By | Experience |
|--------|-------------|------------|
| **User Search Results** | `search-users` | Role-badged user cards with avatars, departments, and join dates |
| **Order List** | `list-orders` | Paginated table with color-coded status badges, expandable line items |
| **Location Map** | `get-location-info` | CSS grid map with colored POI pins, clickable details with ratings and addresses |

---

## Quick Start

```bash
npm install
npm run dev        # HTTP mode with hot reload + inspector + widgets
```

Open [http://localhost:8760/inspector](http://localhost:8760/inspector) to explore all tools, resources, and widgets interactively.

## Client Configuration

### HTTP mode

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

### stdio mode (with widget asset serving)

```json
{
  "servers": {
    "enterprise-ops-hub": {
      "command": "npx",
      "args": ["tsx", "src/stdio.ts"],
      "cwd": "/path/to/mock_mcp",
      "env": {
        "WIDGET_PORT": "8761"
      }
    }
  }
}
```

The server exposes **identical capabilities** in both modes. In stdio mode, MCP protocol messages flow over stdin/stdout, while widget assets are served on `WIDGET_PORT` (default `8761`).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with hot reload, inspector, and widgets |
| `npm run build` | Production build (TypeScript compilation + widget bundling) |
| `npm run start` | Production HTTP server |
| `npx tsx src/stdio.ts` | stdio mode for local agent integration |
