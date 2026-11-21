import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../..", import.meta.url));
let runDir;
let worker;
let supervisor;
let consoleProcess;
let consoleUrl;
let output = "";

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  runDir = await mkdtemp(path.join(os.tmpdir(), "mock-mcp-inspector-"));
  process.env.MOCK_MCP_RUN_DIR = runDir;
  supervisor = await import("@mock-mcp/supervisor");
  const workerPort = await freePort();
  const consolePort = await freePort();
  worker = await supervisor.startWorker({ runtime: "v2", port: workerPort });
  const ready = await supervisor.waitForWorker(worker.id, 30_000);
  assert.equal(ready.ready, true, `worker failed to start: ${ready.reason}`);

  consoleUrl = `http://127.0.0.1:${consolePort}`;
  consoleProcess = spawn(path.join(root, "packages/console/node_modules/.bin/tsx"), [
    path.join(root, "packages/console/server.ts"), "--port", String(consolePort),
  ], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  consoleProcess.stdout.on("data", (chunk) => { output += chunk; });
  consoleProcess.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (consoleProcess.exitCode !== null) throw new Error(`console exited: ${output}`);
    try {
      const response = await fetch(`${consoleUrl}/api/workers`);
      if (response.ok) return;
    } catch {
      // Wait until the console is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`console did not start: ${output}`);
});

after(async () => {
  if (consoleProcess && consoleProcess.exitCode === null) {
    consoleProcess.kill("SIGTERM");
    await once(consoleProcess, "exit");
  }
  if (worker) {
    const report = await supervisor.stopWorker(worker.id);
    assert.equal(report.portReleased, true, "worker port was not released");
    await supervisor.removeWorker(worker.id, { stop: false });
  }
  if (runDir) await rm(runDir, { recursive: true, force: true });
});

test("production v2 Inspector is exposed and connected through the console", async () => {
  const workers = await (await fetch(`${consoleUrl}/api/workers`)).json();
  const view = workers.workers.find((entry) => entry.id === worker.id);
  assert.equal(view.inspectorBuilt, true);
  assert.equal(view.listening, true);

  const response = await fetch(`${consoleUrl}/api/workers/${worker.id}/inspector`);
  assert.equal(response.status, 200);
  const inspector = await response.json();
  assert.equal(inspector.available, true);
  const url = new URL(inspector.url);
  assert.equal(url.pathname, "/mcp/inspector");
  assert.equal(url.searchParams.get("server"), inspector.mcpUrl);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /Inspector/);

  const remoteResult = await new Promise((resolve, reject) => {
    http.get(`${consoleUrl}/api/workers/${worker.id}/inspector`, {
      headers: { Host: "192.0.2.1:8790" },
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
  assert.equal(remoteResult.reason, "remote-loopback", JSON.stringify(remoteResult));
});

test("a normal rebuild disables the Inspector for new workers", async () => {
  const packageDir = path.join(root, "packages/v2");
  await promisify(execFile)(path.join(packageDir, "node_modules/.bin/mcp-use"), ["build"], { cwd: packageDir });
  assert.equal(supervisor.isInspectorBuilt("v2", true), false);

  const port = await freePort();
  const plainWorker = await supervisor.startWorker({ runtime: "v2", port });
  try {
    const ready = await supervisor.waitForWorker(plainWorker.id, 30_000);
    assert.equal(ready.ready, true, `worker failed to start: ${ready.reason}`);
    const response = await fetch(`http://127.0.0.1:${port}/mcp/inspector`);
    assert.equal(response.status, 404);
    const payload = await (await fetch(`${consoleUrl}/api/workers/${plainWorker.id}/inspector`)).json();
    assert.equal(payload.available, false);
    assert.equal(payload.reason, "not-built");
  } finally {
    const report = await supervisor.stopWorker(plainWorker.id);
    assert.equal(report.portReleased, true, "worker port was not released");
    await supervisor.removeWorker(plainWorker.id, { stop: false });
  }
});
