import { server } from "./src/server.js";

server.listen(8760).then(() => {
  const baseUrl = process.env.MCP_URL || "http://localhost:8760";
  console.log("🚀 Mock MCP Server is running (HTTP mode)");
  console.log(`   Inspector: ${baseUrl}/inspector`);
  console.log(`   MCP endpoint: ${baseUrl}/mcp`);
});
