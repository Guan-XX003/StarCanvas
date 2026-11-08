import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { automationCandidates, starcanvasRequest, waitForStarCanvasTask, wanjuanRequest } from "../bin/starcanvas-client.mjs";

const originalCwd = process.cwd();
const originalStarCanvasAutomationFile = process.env.STARCANVAS_AUTOMATION_FILE;
const originalAutomationFile = process.env.WANJUAN_AUTOMATION_FILE;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-client-test-"));
const devData = path.join(tempRoot, ".wanjuan-dev-user-data");
const staleFile = path.join(tempRoot, "stale-automation.json");
const liveFile = path.join(devData, "starcanvas-automation.json");
const legacyFile = path.join(tempRoot, "legacy-automation.json");
const token = "client-test-token-000000000000000000000001";

fs.mkdirSync(devData, { recursive: true });
fs.writeFileSync(staleFile, JSON.stringify({ host: "127.0.0.1", port: 9, token, pid: 99999999 }));

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401);
    return res.end(JSON.stringify({ ok: false }));
  }
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.method === "POST" && pathname === "/v1/tasks/node-failed") {
    const body = JSON.stringify({ ok: true, taskId: "task-failed", nodeId: "node-failed" });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
    return res.end(body);
  }
  if (req.method === "GET" && pathname === "/v1/tasks/node-image") {
    const body = JSON.stringify({ ok: true, task: { id: "task-image", nodeId: "node-image", type: "image", status: "completed", resultUrl: "https://cdn.example.com/result.png", stableResultUrl: "file:///tmp/result.png" } });
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
    return res.end(body);
  }
  const responses = {
    "/v1/status": { ok: true, app: "StarCanvas", ready: true },
    "/v1/models": { ok: true, image: [], video: [], text: [] },
    "/v1/tasks": { ok: true, tasks: [] },
    "/v1/tasks/node-failed": { ok: true, task: { id: "task-failed", nodeId: "node-failed", status: "failed", errorMsg: "test" } },
    "/v1/tasks/node-missing": { ok: true, task: null },
  };
  const body = JSON.stringify(responses[pathname] || { ok: false, error: "not found" });
  res.writeHead(responses[pathname] ? 200 : 404, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
  res.end(body);
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const liveInfo = JSON.stringify({ host: "127.0.0.1", port: server.address().port, token, pid: process.pid });
  fs.writeFileSync(liveFile, liveInfo);
  fs.writeFileSync(legacyFile, liveInfo);
  process.chdir(tempRoot);
  process.env.STARCANVAS_AUTOMATION_FILE = staleFile;
  assert.deepEqual(automationCandidates(), [path.resolve(staleFile)], "显式 StarCanvas 凭据不得回退到其他实例");
  await assert.rejects(starcanvasRequest("GET", "/v1/status"), /没有可用的StarCanvas自动化端点/);
  process.env.STARCANVAS_AUTOMATION_FILE = liveFile;
  assert.equal((await starcanvasRequest("GET", "/v1/status")).ready, true);
  delete process.env.STARCANVAS_AUTOMATION_FILE;
  process.env.WANJUAN_AUTOMATION_FILE = legacyFile;
  assert.equal((await wanjuanRequest("GET", "/v1/status")).ready, true, "旧 WANJUAN_AUTOMATION_FILE 应继续兼容");
  assert.deepEqual(await starcanvasRequest("GET", "/v1/models"), { ok: true, image: [], video: [], text: [] });
  assert.deepEqual(await starcanvasRequest("GET", "/v1/tasks"), { ok: true, tasks: [] });
  assert.equal((await starcanvasRequest("GET", "/v1/tasks/node-image?materialize=1")).task.stableResultUrl, "file:///tmp/result.png");
  assert.equal((await waitForStarCanvasTask("node-failed", { timeoutMs: 1000, intervalMs: 20 })).task.status, "failed");
  assert.equal((await wanjuanRequest("POST", "/v1/tasks/node-failed")).nodeId, "node-failed");
  await assert.rejects(
    waitForStarCanvasTask("node-missing", { timeoutMs: 1000, intervalMs: 20, missingGraceMs: 80 }),
    /任务未创建或已不存在/,
  );
} finally {
  process.chdir(originalCwd);
  if (originalStarCanvasAutomationFile === undefined) delete process.env.STARCANVAS_AUTOMATION_FILE;
  else process.env.STARCANVAS_AUTOMATION_FILE = originalStarCanvasAutomationFile;
  if (originalAutomationFile === undefined) delete process.env.WANJUAN_AUTOMATION_FILE;
  else process.env.WANJUAN_AUTOMATION_FILE = originalAutomationFile;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("automation client: explicit instance isolation, legacy alias, status/models/tasks and fast task failure passed");
