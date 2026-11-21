import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";
import { after, before, test } from "node:test";

let child;
let endpoint;
let output = "";
let requestId = 0;

const clientMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "mock-mcp-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
  },
};

async function rpc(method, params = {}, modern = true, capabilities = clientMeta["io.modelcontextprotocol/clientCapabilities"]) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (modern) {
    headers["Mcp-Method"] = method;
    headers["Mcp-Protocol-Version"] = "2026-07-28";
    if (params.name || params.uri) headers["Mcp-Name"] = params.name || params.uri;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params: modern ? { ...params, _meta: { ...clientMeta, "io.modelcontextprotocol/clientCapabilities": capabilities } } : params }),
  });
  const body = await response.text();
  const payload = body.startsWith("event:") ? body.match(/^data: (.*)$/m)?.[1] : body;
  assert.ok(payload, `missing RPC response: ${body}`);
  const parsed = JSON.parse(payload);
  assert.equal(response.status, 200, JSON.stringify(parsed));
  assert.equal(parsed.error, undefined, JSON.stringify(parsed.error));
  return parsed.result;
}

before(async () => {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  endpoint = `http://127.0.0.1:${port}/mcp`;
  child = spawn("./node_modules/.bin/mcp-use", ["start", "--port", String(port)], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), MCP_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited: ${output}`);
    try {
      await rpc("server/discover");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server did not become ready: ${output}`);
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
});

test("modern and legacy protocol discovery and primitives", async () => {
  const discovery = await rpc("server/discover");
  assert.ok(discovery.supportedVersions.includes("2026-07-28"));
  const legacy = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "legacy-test", version: "1.0.0" },
  }, false);
  assert.equal(legacy.protocolVersion, "2025-11-25");
  for (const modern of [true, false]) {
    const tools = await rpc("tools/list", {}, modern);
    assert.equal(tools.tools.length, 17);
    const resource = await rpc("resources/read", { uri: "data://poi-types" }, modern);
    assert.equal(resource.contents[0].mimeType, "application/json");
    assert.equal(JSON.parse(resource.contents[0].text).types.length, 7);
    const prompt = await rpc("prompts/get", { name: "explore-locations", arguments: { area: "NYC" } }, modern);
    assert.match(prompt.messages[0].content.text, /NYC/);
    const product = await rpc("tools/call", { name: "get-product-details", arguments: { productId: "p-001" } }, modern);
    assert.equal(product.structuredContent.id, "p-001");
    const app = tools.tools.find((entry) => entry.name === "manage-orders");
    const appResource = await rpc("resources/read", { uri: app._meta.ui.resourceUri }, modern);
    assert.match(appResource.contents[0].mimeType, /^text\/html/);
  }
});

test("modern client input flows resume with validated responses", async () => {
  const capabilities = { elicitation: { form: {} }, sampling: {}, roots: {} };
  const cases = [
    { name: "request-approval", args: { action: "deploy" }, key: "approval", method: "elicitation/create", response: { action: "accept", content: { approved: true, reason: "OK" } }, verify: (data) => assert.equal(data.approved, true) },
    { name: "collect-feedback", args: { topic: "search" }, key: "feedback", method: "elicitation/create", response: { action: "accept", content: { rating: 5, comment: "good" } }, verify: (data) => assert.equal(data.rating, 5) },
    { name: "list-roots", args: {}, key: "roots", method: "roots/list", response: { roots: [{ uri: "file:///test", name: "test" }] }, verify: (data) => assert.equal(data.roots[0].uri, "file:///test") },
    { name: "summarize-text", args: { text: "A sufficiently long test input" }, key: "summary", method: "sampling/createMessage", response: { role: "assistant", content: { type: "text", text: "Summary" }, model: "test" }, verify: (data) => assert.equal(data.summary, "Summary") },
  ];
  for (const entry of cases) {
    const request = { name: entry.name, arguments: entry.args };
    const pending = await rpc("tools/call", request, true, capabilities);
    assert.equal(pending.resultType, "input_required", entry.name);
    assert.equal(pending.inputRequests[entry.key].method, entry.method);
    const done = await rpc("tools/call", { ...request, inputResponses: { [entry.key]: entry.response } }, true, capabilities);
    entry.verify(done.structuredContent);
  }

  const approval = { name: "request-approval", arguments: { action: "deploy" } };
  const declined = await rpc("tools/call", { ...approval, inputResponses: { approval: { action: "decline" } } }, true, capabilities);
  assert.equal(declined.structuredContent.approved, false);
  const invalid = await rpc("tools/call", { ...approval, inputResponses: { approval: { action: "accept", content: { approved: "yes" } } } }, true, capabilities);
  assert.equal(invalid.resultType, "input_required");
  assert.equal(invalid.inputRequests.approval.method, "elicitation/create");

  const feedback = await rpc("tools/call", { name: "collect-feedback", arguments: { topic: "search" }, inputResponses: { feedback: { action: "cancel" } } }, true, capabilities);
  assert.equal(feedback.isError, true);
});

test("view resources and interactive order mutation and undo", async () => {
  const tools = (await rpc("tools/list")).tools;
  for (const name of ["search-users", "list-orders", "get-location-info", "manage-orders"]) {
    const tool = tools.find((entry) => entry.name === name);
    const uri = tool._meta.ui.resourceUri;
    const resource = await rpc("resources/read", { uri });
    assert.match(resource.contents[0].mimeType, /^text\/html/);
    assert.match(resource.contents[0].text, /<html/i);
  }
  const initial = await rpc("tools/call", { name: "manage-orders", arguments: {} });
  const order = initial.structuredContent.orders[0];
  const status = order.status === "cancelled" ? "pending" : "cancelled";
  const update = await rpc("tools/call", { name: "apply-order-action", arguments: { action: "update-status", orderId: order.id, status, visibleIds: [order.id] } });
  assert.equal(update.structuredContent.orders[0].status, status);
  const undo = await rpc("tools/call", { name: "apply-order-action", arguments: { action: "undo", visibleIds: [order.id] } });
  assert.equal(undo.structuredContent.orders[0].status, order.status);
  assert.equal(undo.structuredContent.orders[0].shippedAt, order.shippedAt);
});
