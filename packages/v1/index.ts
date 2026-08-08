import { server } from "./src/server.js";

// Read port from PORT env var (set by cli.ts for multi-worker mode),
// falling back to 8760 for single-instance or direct `npm start` usage.
const port = parseInt(process.env.PORT || "8760", 10);

server.listen(port).then(() => {
  const baseUrl = process.env.MCP_URL || `http://localhost:${port}`;
  console.log("🚀 Mock MCP Server is running (HTTP mode)");
  console.log(`   Inspector: ${baseUrl}/inspector`);
  console.log(`   MCP endpoint: ${baseUrl}/mcp`);
});
