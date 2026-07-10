import { MCPServer, error, markdown, object, text, widget } from "mcp-use/server";
import { z } from "zod";
import {
  getMockServerStatus,
  mockDocuments,
  mockKnowledgeBase,
  mockLocations,
  mockOrders,
  mockProducts,
  mockUsers,
  paginate,
} from "./mock-data.js";
import { mockDelay } from "./mock-delay.js";
import type { MockLocation, MockOrder } from "./mock-data.js";

// ─── Server ──────────────────────────────────────────────────────────
export const server = new MCPServer({
  name: "enterprise-ops-hub",
  title: "Enterprise Operations Hub",
  version: "1.0.0",
  description:
    "Enterprise operations platform providing team directory, product catalog, order management, knowledge base, location intelligence, analytics, and DevOps monitoring — all accessible through MCP tools, resources, prompts, and interactive visual widgets.",
  instructions:
    "You have access to the Enterprise Operations Hub. Use the tools to search users, browse products, manage orders, explore locations, generate reports, search the knowledge base, and monitor system health. Use the visual widgets for rich data presentation. For sensitive actions, use the approval workflow tools.",
  baseUrl: process.env.MCP_URL || `http://localhost:${process.env.PORT || "8760"}`,
  favicon: "favicon.ico",
  websiteUrl: "https://github.com",
  icons: [
    { src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] },
  ],
});

// ─── Reusable Schemas ───────────────────────────────────────────────
const userRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["admin", "editor", "viewer", "developer"]),
  avatar: z.string(),
  department: z.string(),
  joinedAt: z.string(),
});

const productRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number(),
  currency: z.string(),
  stock: z.number(),
  rating: z.number(),
  description: z.string(),
});

const orderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

const orderRowSchema = z.object({
  id: z.string(),
  customer: z.string(),
  items: z.array(orderItemSchema),
  total: z.number(),
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  placedAt: z.string(),
  shippedAt: z.string().nullable(),
});

const locationRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  type: z.enum(["restaurant", "park", "museum", "cafe", "hotel", "shopping", "landmark"]),
  rating: z.number(),
  address: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. search-users (with widget) ───────────────────────────────────
server.tool(
  {
    name: "search-users",
    description:
      "Search users across the organization by name, role, or department. Returns results in a visual widget with user cards showing avatars, roles, and departments.",
    schema: z.object({
      query: z.string().optional().describe("Search query to match against user name or email"),
      role: z.enum(["admin", "editor", "viewer", "developer"]).optional().describe("Filter users by role"),
      limit: z.number().min(1).max(50).optional().default(20).describe("Maximum number of results to return"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ query: z.string(), role: z.string().nullable(), results: z.array(userRowSchema), total: z.number() }),
    widget: { name: "user-search-results", invoking: "Searching users...", invoked: "User search results loaded" },
  },
  async ({ query, role, limit }) => {
    await mockDelay(400, 1200);
    let results = mockUsers;
    if (query) {
      const q = query.toLowerCase();
      results = results.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q));
    }
    if (role) results = results.filter((u) => u.role === role);
    results = results.slice(0, limit);
    return widget({
      props: { query: query ?? "", role: role ?? null, results, total: results.length },
      output: text(`Found ${results.length} user(s)${query ? ` matching "${query}"` : ""}${role ? ` with role "${role}"` : ""}`),
    });
  }
);

// ─── 2. get-product-details (no widget) ─────────────────────────────
server.tool(
  {
    name: "get-product-details",
    description: "Get detailed product information including pricing, stock levels, ratings, and full description by product ID",
    schema: z.object({ productId: z.string().describe("The product ID (e.g., 'p-001')") }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: productRowSchema,
  },
  async ({ productId }) => {
    await mockDelay(200, 600);
    const product = mockProducts.find((p) => p.id === productId);
    if (!product) return error(`Product "${productId}" not found. Available: ${mockProducts.map((p) => p.id).join(", ")}`);
    return object(product);
  }
);

// ─── 3. list-orders (with widget) ────────────────────────────────────
server.tool(
  {
    name: "list-orders",
    description: "List orders with pagination and optional status filter. Displays in a visual widget with color-coded status badges and expandable line items.",
    schema: z.object({
      status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]).optional().describe("Filter orders by status"),
      page: z.number().min(1).optional().default(1).describe("Page number (1-based)"),
      pageSize: z.number().min(5).max(50).optional().default(10).describe("Number of orders per page"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ orders: z.array(orderRowSchema), page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    widget: { name: "order-list", invoking: "Loading orders...", invoked: "Orders loaded" },
  },
  async ({ status, page, pageSize }) => {
    await mockDelay(500, 1500);
    const filtered = status ? mockOrders.filter((o) => o.status === status) : mockOrders;
    const paginated = paginate(filtered, page, pageSize);
    return widget({
      props: { orders: paginated.data as MockOrder[], page: paginated.page, pageSize: paginated.pageSize, total: paginated.total, totalPages: paginated.totalPages },
      output: text(`Showing page ${paginated.page} of ${paginated.totalPages} (${paginated.total} total orders)`),
    });
  }
);

// ─── 4. create-document (no widget) ──────────────────────────────────
server.tool(
  {
    name: "create-document",
    description: "Create a new document (report, memo, guide, or spec) with tags for categorization. Returns the created document metadata.",
    schema: z.object({
      title: z.string().min(1).describe("Document title"),
      content: z.string().min(1).describe("Document body content"),
      type: z.enum(["report", "memo", "guide", "spec"]).describe("Document type"),
      tags: z.array(z.string()).optional().default([]).describe("List of tags for categorization"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: z.object({ id: z.string(), title: z.string(), type: z.string(), createdAt: z.string(), tags: z.array(z.string()) }),
  },
  async ({ title, content, type, tags }) => {
    await mockDelay(300, 1000);
    const docId = `doc-${String(mockDocuments.length + 1).padStart(3, "0")}`;
    return object({
      id: docId, title, type, createdAt: new Date().toISOString(), tags,
      status: "created", contentLength: content.length,
    });
  }
);

// ─── 5. get-location-info (with map widget) ──────────────────────────
server.tool(
  {
    name: "get-location-info",
    description: "Discover nearby points of interest (POIs) around any latitude/longitude coordinate. Returns results in an interactive map widget with color-coded pins by POI type — restaurants, parks, museums, cafés, hotels, shopping, and landmarks.",
    schema: z.object({
      lat: z.number().min(-90).max(90).describe("Latitude of the center point"),
      lng: z.number().min(-180).max(180).describe("Longitude of the center point"),
      radius: z.number().min(0.01).max(50).optional().default(5).describe("Search radius in kilometers"),
      types: z.array(z.enum(["restaurant", "park", "museum", "cafe", "hotel", "shopping", "landmark"])).optional().describe("Filter by POI types"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ centerLat: z.number(), centerLng: z.number(), radius: z.number(), locations: z.array(locationRowSchema), total: z.number() }),
    widget: { name: "location-map", invoking: "Searching nearby locations...", invoked: "Location results loaded" },
  },
  async ({ lat, lng, radius, types }) => {
    await mockDelay(600, 2000);
    let results = types && types.length > 0 ? mockLocations.filter((loc) => types.includes(loc.type)) : mockLocations;
    const shuffled = [...results].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(shuffled.length, 8));
    return widget({
      props: { centerLat: lat, centerLng: lng, radius, locations: selected as MockLocation[], total: selected.length },
      output: text(`Found ${selected.length} location(s) near (${lat.toFixed(4)}, ${lng.toFixed(4)}) within ${radius}km`),
    });
  }
);

// ─── 6. generate-report (no widget) ──────────────────────────────────
server.tool(
  {
    name: "generate-report",
    description: "Generate an analytics report with key metrics across sales, usage, performance, or security domains. Supports multiple date ranges.",
    schema: z.object({
      reportType: z.enum(["sales", "usage", "performance", "security"]).describe("Type of report to generate"),
      dateRange: z.enum(["7d", "30d", "90d", "1y"]).optional().default("30d").describe("Date range for the report data"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ reportType: z.string(), dateRange: z.string(), generatedAt: z.string(), metrics: z.record(z.string(), z.number()), summary: z.string() }),
  },
  async ({ reportType, dateRange }) => {
    await mockDelay(800, 2500);
    const metrics: Record<string, Record<string, number>> = {
      sales: { totalRevenue: 125000 + Math.floor(Math.random() * 50000), avgOrderValue: 245 + Math.floor(Math.random() * 100), conversionRate: Math.round((0.032 + Math.random() * 0.02) * 10000) / 10000, newCustomers: 340 + Math.floor(Math.random() * 200), churnRate: Math.round((0.05 + Math.random() * 0.03) * 10000) / 10000 },
      usage: { dailyActiveUsers: 12500 + Math.floor(Math.random() * 5000), avgSessionMinutes: 12 + Math.floor(Math.random() * 20), apiCalls: 850000 + Math.floor(Math.random() * 200000), errorRate: Math.round((0.001 + Math.random() * 0.005) * 10000) / 10000, p99LatencyMs: 120 + Math.floor(Math.random() * 200) },
      performance: { uptimePercent: Math.round((99.9 + Math.random() * 0.099) * 100) / 100, avgResponseTimeMs: 45 + Math.floor(Math.random() * 80), throughputRps: 320 + Math.floor(Math.random() * 200), errorCount: Math.floor(Math.random() * 50), cpuAvgPercent: 35 + Math.floor(Math.random() * 40) },
      security: { blockedAttempts: 1200 + Math.floor(Math.random() * 3000), vulnerabilitiesFound: Math.floor(Math.random() * 15), patchesApplied: 8 + Math.floor(Math.random() * 12), mfaEnrollmentRate: Math.round((0.72 + Math.random() * 0.25) * 100) / 100, auditScore: 85 + Math.floor(Math.random() * 15) },
    };
    const summaries: Record<string, string> = {
      sales: `Sales report covering the last ${dateRange}. Key metrics include total revenue, average order value, conversion rate, new customer acquisition, and churn rate.`,
      usage: `Usage report covering the last ${dateRange}. Key metrics include DAU, average session duration, API call volume, error rate, and P99 latency.`,
      performance: `Performance report covering the last ${dateRange}. Key metrics include uptime, average response time, throughput, error count, and CPU utilization.`,
      security: `Security report covering the last ${dateRange}. Key metrics include blocked attempts, vulnerabilities found, patches applied, MFA enrollment, and audit score.`,
    };
    return object({ reportType, dateRange, generatedAt: new Date().toISOString(), metrics: metrics[reportType], summary: summaries[reportType] });
  }
);

// ─── 7. search-knowledge (no widget) ─────────────────────────────────
server.tool(
  {
    name: "search-knowledge",
    description: "Search the knowledge base for help articles and documentation. Supports filtering by category (account, API, general).",
    schema: z.object({
      query: z.string().describe("Search query for knowledge base articles"),
      category: z.enum(["account", "api", "general"]).optional().describe("Filter by knowledge base category"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ query: z.string(), results: z.array(z.object({ id: z.string(), title: z.string(), content: z.string(), category: z.string() })), total: z.number() }),
  },
  async ({ query, category }) => {
    await mockDelay(300, 900);
    const q = query.toLowerCase();
    let results = mockKnowledgeBase.filter((k) => k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q));
    if (category) results = results.filter((k) => k.category === category);
    return object({ query, results, total: results.length });
  }
);

// ─── 8. get-server-status (no widget) ────────────────────────────────
server.tool(
  {
    name: "get-server-status",
    description: "Get current server health status including uptime, request volume, active connections, memory usage, and CPU load.",
    schema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ uptime: z.number(), version: z.string(), requestCount: z.number(), activeConnections: z.number(), memoryUsageMB: z.number(), cpuPercent: z.number(), lastRestart: z.string() }),
  },
  async () => {
    await mockDelay(100, 400);
    return object(getMockServerStatus());
  }
);

// ─── 9. list-roots (Roots capability) ─────────────────────────────────
server.tool(
  {
    name: "list-roots",
    description: "List filesystem roots shared by the client. Tests the roots capability of the MCP bridge — if the bridge correctly forwards this capability from the host, you will see the host's shared directories.",
    schema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ supported: z.boolean(), roots: z.array(z.object({ uri: z.string(), name: z.string().optional() })), note: z.string() }),
  },
  async (_params, ctx) => {
    await mockDelay(100, 300);
    if (!ctx.client.can("roots")) {
      return object({ supported: false, roots: [], note: "Client does not support roots capability. The bridge may not be forwarding this." });
    }
    const roots = await server.listRoots(ctx.session.sessionId);
    return object({ supported: true, roots: roots ?? [], note: `Found ${roots?.length ?? 0} root(s) from client.` });
  }
);

// ─── 10. request-approval (Elicitation — simple form) ─────────────────
server.tool(
  {
    name: "request-approval",
    description: "Request user approval via an elicitation form. Asks the user to approve or reject an action. Tests the elicitation capability of the MCP bridge.",
    schema: z.object({
      action: z.string().describe("The action requiring approval (e.g., 'delete-user', 'deploy-release')"),
      details: z.string().optional().describe("Additional context for the approval request"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    outputSchema: z.object({ approved: z.boolean(), reason: z.string(), note: z.string() }),
  },
  async (params, ctx) => {
    await mockDelay(200, 500);
    if (!ctx.client.can("elicitation")) {
      return object({ approved: false, reason: "", note: "Client does not support elicitation capability. The bridge may not be forwarding this." });
    }
    const result = await ctx.elicit(
      `Approval needed: **${params.action}**${params.details ? `\n\n${params.details}` : ""}\n\nDo you approve this action?`,
      z.object({
        approved: z.boolean().describe("Approve this action?"),
        reason: z.string().optional().describe("Reason for your decision"),
      }),
    );
    return object({ approved: result.data.approved, reason: result.data.reason ?? "", note: "Approval collected via elicitation." });
  }
);

// ─── 11. collect-feedback (Elicitation — rating form) ─────────────────
server.tool(
  {
    name: "collect-feedback",
    description: "Collect structured user feedback via an elicitation form with rating and comments. Tests complex elicitation schemas.",
    schema: z.object({
      topic: z.string().describe("What the feedback is about (e.g., 'search feature', 'order UI')"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ supported: z.boolean(), rating: z.number(), comment: z.string(), note: z.string() }),
  },
  async (params, ctx) => {
    await mockDelay(300, 600);
    if (!ctx.client.can("elicitation")) {
      return object({ supported: false, rating: 0, comment: "", note: "Client does not support elicitation capability." });
    }
    const result = await ctx.elicit(
      `Please rate your experience with: **${params.topic}**`,
      z.object({
        rating: z.number().min(1).max(5).describe("Rating (1 = poor, 5 = excellent)"),
        comment: z.string().optional().describe("Any additional comments?"),
      }),
    );
    return object({ supported: true, rating: result.data.rating, comment: result.data.comment ?? "", note: "Feedback collected via elicitation." });
  }
);

// ─── 12. summarize-text (Sampling capability) ─────────────────────────
server.tool(
  {
    name: "summarize-text",
    description: "Send text to the client's LLM for summarization via the sampling capability. The server delegates LLM work back to the client.",
    schema: z.object({
      text: z.string().min(10).describe("Text to summarize (min 10 chars)"),
      maxLength: z.number().min(10).max(500).optional().default(80).describe("Target summary length in words"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ supported: z.boolean(), summary: z.string(), model: z.string(), note: z.string() }),
  },
  async (params, ctx) => {
    await mockDelay(400, 1000);
    if (!ctx.client.can("sampling")) {
      return object({ supported: false, summary: "", model: "", note: "Client does not support sampling capability. The bridge may not be forwarding this." });
    }
    try {
      const result = await ctx.sample(
        `Summarize the following text in no more than ${params.maxLength} words:\n\n${params.text}`,
        { maxTokens: params.maxLength * 3 },
      );
      // content is a discriminated union in newer SDK (not an array)
      const summary = result.content.type === "text" ? result.content.text : "";
      return object({ supported: true, summary, model: result.model ?? "unknown", note: "Summary generated via client sampling." });
    } catch (err) {
      return object({ supported: true, summary: `Sampling failed: ${err instanceof Error ? err.message : String(err)}`, model: "", note: "Sampling request failed. The client may have rejected it." });
    }
  }
);

// ─── 13. list-client-capabilities (Capabilities introspection) ────────
server.tool(
  {
    name: "list-client-capabilities",
    description: "Returns the full set of client capabilities advertised during initialization. Useful for debugging what the MCP bridge forwards from the host.",
    schema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ capabilities: z.record(z.string(), z.unknown()), clientInfo: z.object({ name: z.string(), version: z.string() }), supportsApps: z.boolean(), user: z.unknown() }),
  },
  async (_params, ctx) => {
    await mockDelay(50, 150);
    const clientInfo = ctx.client.info();
    return object({
      capabilities: ctx.client.capabilities(),
      clientInfo: { name: clientInfo.name ?? "unknown", version: clientInfo.version ?? "unknown" },
      supportsApps: ctx.client.supportsApps(),
      user: ctx.client.user() ?? null,
    });
  }
);

// ─── 14. get-user-context (User context) ──────────────────────────────
server.tool(
  {
    name: "get-user-context",
    description: "Returns the current user's context information (locale, location, timezone) as provided by the client.",
    schema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ user: z.object({ subject: z.string(), locale: z.string(), timezone: z.string(), location: z.string() }).nullable(), sessionId: z.string(), note: z.string() }),
  },
  async (_params, ctx) => {
    await mockDelay(50, 150);
    const user = ctx.client.user();
    const loc = user?.location;
    return object({
      user: user ? {
        subject: user.subject ?? "unknown",
        locale: user.locale ?? "unknown",
        timezone: user.location?.timezone ?? `UTC${user.timezoneOffsetMinutes != null ? (user.timezoneOffsetMinutes >= 0 ? "+" : "") + user.timezoneOffsetMinutes / 60 : "?"}`,
        location: loc ? [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || "unknown" : "unknown",
      } : null,
      sessionId: ctx.session.sessionId,
      note: "User context provided by the client. If user is null, the bridge may not be forwarding user identity.",
    });
  }
);

// ─── 15. slow-operation (Progress reporting) ──────────────────────────
server.tool(
  {
    name: "slow-operation",
    description: "Simulate a long-running operation with progress notifications. Tests the progress reporting capability.",
    schema: z.object({
      steps: z.number().min(3).max(20).optional().default(5).describe("Number of simulated steps"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    outputSchema: z.object({ completed: z.boolean(), steps: z.number(), elapsedMs: z.number(), note: z.string() }),
  },
  async (params, ctx) => {
    const startTime = Date.now();
    const steps = params.steps;

    for (let i = 1; i <= steps; i++) {
      await mockDelay(300, 800);
      if (ctx.reportProgress) {
        await ctx.reportProgress(i, steps, `Step ${i} of ${steps} completed`);
      }
      await ctx.log("info", `slow-operation: step ${i}/${steps} done`);
    }

    return object({
      completed: true,
      steps,
      elapsedMs: Date.now() - startTime,
      note: `Completed ${steps} steps with progress reporting.${ctx.reportProgress ? "" : " Progress reporting was not requested by the client."}`,
    });
  }
);

// ═══════════════════════════════════════════════════════════════════════
// RESOURCES
// ═══════════════════════════════════════════════════════════════════════

server.resource(
  { name: "poi_types", uri: "data://poi-types", title: "Available POI Types", description: "List of supported point-of-interest types for the location map feature", mimeType: "application/json" },
  async () => object({ types: [{ id: "restaurant", label: "Restaurant", icon: "🍽️", color: "#ef4444" }, { id: "park", label: "Park", icon: "🌳", color: "#22c55e" }, { id: "museum", label: "Museum", icon: "🏛️", color: "#a855f7" }, { id: "cafe", label: "Café", icon: "☕", color: "#f59e0b" }, { id: "hotel", label: "Hotel", icon: "🏨", color: "#3b82f6" }, { id: "shopping", label: "Shopping", icon: "🛍️", color: "#ec4899" }, { id: "landmark", label: "Landmark", icon: "📍", color: "#f97316" }], updatedAt: new Date().toISOString() })
);

server.resource(
  { name: "server_info", uri: "config://server-info", title: "Server Configuration", description: "Mock server version, capabilities, and configuration details", mimeType: "application/json" },
  async () => object({ name: "enterprise-ops-hub", version: "1.0.0", environment: "production", capabilities: { tools: true, resources: true, prompts: true, widgets: true, logging: true, sampling: false }, limits: { maxPageSize: 50, maxSearchRadiusKm: 50, maxResultsPerQuery: 100 } })
);

server.resource(
  { name: "api_reference", uri: "docs://api-reference", title: "API Reference", description: "Documentation for all available mock tools and their parameters", mimeType: "text/markdown" },
  async () => markdown(`# Mock MCP Server — API Reference

## Tools

| Tool | Description | Widget |
|------|-------------|--------|
| \`search-users\` | Search mock users by name/role | ✅ user-search-results |
| \`get-product-details\` | Get product by ID | ❌ |
| \`list-orders\` | Paginated order listing | ✅ order-list |
| \`create-document\` | Simulate document creation | ❌ |
| \`get-location-info\` | Find nearby POIs | ✅ location-map |
| \`generate-report\` | Generate mock analytics report | ❌ |
| \`search-knowledge\` | Search knowledge base | ❌ |
| \`get-server-status\` | Server health & metrics | ❌ |

## Resources

| URI | Description |
|-----|-------------|
| \`data://poi-types\` | Available POI types |
| \`config://server-info\` | Server configuration |
| \`docs://api-reference\` | This document |
| \`data://mock-stats\` | Current mock statistics |

## Notes

- **Widgets** are available for \`search-users\`, \`list-orders\`, and \`get-location-info\`
- Use the **request-approval** tool for actions that require human confirmation
- Use the **generate-report** tool for analytics across sales, usage, performance, and security domains
`)
);

server.resource(
  { name: "mock_stats", uri: "data://mock-stats", title: "Mock Data Statistics", description: "Counts and metadata about the current mock datasets", mimeType: "application/json" },
  async () => object({ generatedAt: new Date().toISOString(), datasets: { users: mockUsers.length, products: mockProducts.length, orders: mockOrders.length, locations: mockLocations.length, documents: mockDocuments.length, knowledgeBase: mockKnowledgeBase.length }, orderStatusDistribution: { pending: mockOrders.filter((o) => o.status === "pending").length, processing: mockOrders.filter((o) => o.status === "processing").length, shipped: mockOrders.filter((o) => o.status === "shipped").length, delivered: mockOrders.filter((o) => o.status === "delivered").length, cancelled: mockOrders.filter((o) => o.status === "cancelled").length }, locationTypeDistribution: { restaurant: mockLocations.filter((l) => l.type === "restaurant").length, park: mockLocations.filter((l) => l.type === "park").length, museum: mockLocations.filter((l) => l.type === "museum").length, cafe: mockLocations.filter((l) => l.type === "cafe").length, hotel: mockLocations.filter((l) => l.type === "hotel").length, shopping: mockLocations.filter((l) => l.type === "shopping").length, landmark: mockLocations.filter((l) => l.type === "landmark").length } })
);

// ═══════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════

server.prompt(
  { name: "explore-locations", description: "Generate a prompt for exploring nearby points of interest around a location", schema: z.object({ area: z.string().describe('Area name (e.g., "Downtown Manhattan")'), interests: z.enum(["food", "culture", "nature", "shopping", "all"]).optional().default("all").describe("Type of places to look for") }) },
  async ({ area, interests }) => {
    const m: Record<string, string> = { food: "restaurants and cafés", culture: "museums and landmarks", nature: "parks and outdoor spaces", shopping: "shopping districts", all: "restaurants, parks, museums, cafés, hotels, shopping, and landmarks" };
    return text(`Explore points of interest around ${area}.\n\nFocus on: ${m[interests]}\n\nUse the **get-location-info** tool to search for nearby locations. The tool returns a visual map widget showing colored pins:\n- 🔴 Red: Restaurants\n- 🟢 Green: Parks\n- 🟣 Purple: Museums\n- 🟡 Yellow: Cafés\n- 🔵 Blue: Hotels\n- 🩷 Pink: Shopping\n- 🟠 Orange: Landmarks\n\nFilter by types and adjust the search radius (in km).`);
  }
);

server.prompt(
  { name: "analyze-orders", description: "Generate a prompt for analyzing mock order data", schema: z.object({ focusArea: z.enum(["status", "revenue", "customers", "trends"]).optional().default("status").describe("What aspect of orders to focus on") }) },
  async ({ focusArea }) => {
    const fp: Record<string, string> = { status: "Analyze distribution of order statuses. Identify bottlenecks.", revenue: "Calculate total revenue, identify high-value customers and popular products.", customers: "Identify repeat customers, analyze purchase patterns.", trends: "Look for temporal patterns and seasonal trends." };
    return text(`Analyze order data with focus on: ${focusArea}\n\n${fp[focusArea]}\n\nUse the **list-orders** tool to fetch paginated order data. Supports filtering by status and returns a visual table widget with expandable line items. For product details, use **get-product-details**.`);
  }
);

server.prompt(
  { name: "generate-data", description: "Generate a prompt template for creating structured data records", schema: z.object({ dataType: z.enum(["users", "products", "orders", "locations", "documents", "knowledge"]).describe("Type of data to generate a template for"), count: z.number().min(1).max(100).optional().default(10).describe("Suggested number of records") }) },
  async ({ dataType, count }) => {
    const tmpl: Record<string, string> = { users: `Generate ${count} user records with fields: id (u-NNN), name, email, role (admin|editor|viewer|developer), avatar (emoji), department, joinedAt.`, products: `Generate ${count} product records with fields: id (p-NNN), name, category, price (USD), currency, stock, rating (1-5), description.`, orders: `Generate ${count} order records with fields: id (ord-NNNN), customer, items[], total, status, placedAt, shippedAt.`, locations: `Generate ${count} location records with fields: id (loc-NNN), name, lat, lng, type, rating, address.`, documents: `Generate ${count} document records with fields: id (doc-NNN), title, content, type, author, createdAt, tags[].`, knowledge: `Generate ${count} knowledge base entries with fields: id (kb-NNN), title, content, category.` };
    return text(`Template for generating ${count} ${dataType} records:\n\n${tmpl[dataType]}\n\nUse realistic data. IDs follow the specified format.`);
  }
);
