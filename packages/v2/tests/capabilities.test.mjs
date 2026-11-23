import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

let runDir;
let supervisor;

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** Run `fn` against a freshly started worker that has `capabilities` enabled. */
async function withWorker(capabilities, fn) {
  const port = await freePort();
  const record = await supervisor.startWorker({ runtime: "v2", port, capabilities });
  try {
    const ready = await supervisor.waitForWorker(record.id, 30_000);
    assert.equal(ready.ready, true, `worker failed to start: ${ready.reason}`);
    return await fn(port, record);
  } finally {
    const report = await supervisor.stopWorker(record.id);
    assert.equal(report.portReleased, true, "worker port was not released");
    await supervisor.removeWorker(record.id, { stop: false });
  }
}

/** Legacy replies may be SSE, so the JSON-RPC payload is extracted from either form. */
async function legacyInitialize(port, id = 1) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-test", version: "1.0.0" } },
    }),
  });
  const raw = await response.text();
  const json = raw.startsWith("event:") ? raw.match(/^data: (.*)$/m)?.[1] : raw;
  assert.ok(json, `missing RPC payload: ${raw}`);
  return { status: response.status, body: JSON.parse(json) };
}

before(async () => {
  runDir = await mkdtemp(path.join(os.tmpdir(), "mock-mcp-capabilities-"));
  process.env.MOCK_MCP_RUN_DIR = runDir;
  supervisor = await import("@mock-mcp/supervisor");
});

after(async () => {
  if (runDir) await rm(runDir, { recursive: true, force: true });
});

test("the legacy capability is enabled by default and can be selected explicitly", async () => {
  await withWorker(undefined, async (port, record) => {
    assert.deepEqual(record.capabilities, ["legacy"]);
    const response = await legacyInitialize(port);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.protocolVersion, "2025-11-25");
  });

  await withWorker(["legacy"], async (port) => {
    assert.equal((await legacyInitialize(port)).status, 200);
  });
});

test("disabling the legacy capability serves modern clients only", async () => {
  await withWorker([], async (port, record) => {
    assert.deepEqual(record.capabilities, []);
    const response = await legacyInitialize(port);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, -32022);
    assert.deepEqual(response.body.error.data.supported, ["2026-07-28"]);

    // Modern traffic is unaffected.
    const modern = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "server/discover",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "modern-test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    assert.equal(modern.status, 200);
    assert.ok((await modern.json()).result.supportedVersions.includes("2026-07-28"));
  });
});

test("unknown capabilities are rejected before a worker is spawned", async () => {
  await assert.rejects(
    supervisor.startWorker({ runtime: "v2", port: await freePort(), capabilities: ["nope"] }),
    (error) => error.code === "UNKNOWN_CAPABILITY" && /available: legacy/.test(error.message),
  );
});
