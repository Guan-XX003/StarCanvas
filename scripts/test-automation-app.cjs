#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { createCandidateLaunchPlan } = require("./candidate-launch-plan.cjs");

const projectRoot = path.resolve(__dirname, "..");
const mode = process.argv.includes("--packaged") ? "packaged" : "dev";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wanjuan-automation-${mode}-`));
const userDataPath = path.join(tempRoot, "user-data");
const infoFile = path.join(userDataPath, "starcanvas-automation.json");
const staleToken = "stale-test-token-000000000000000000000001";
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
fs.mkdirSync(userDataPath, { recursive: true });
fs.writeFileSync(infoFile, JSON.stringify({ host: "127.0.0.1", port: 9, token: staleToken, pid: 99999999 }));

function findPackagedApp() {
  const explicit = process.env.WANJUAN_PACKAGED_APP;
  const candidates = [
    explicit,
    path.join(projectRoot, "release", "mac-arm64", "StarCanvas.app"),
    path.join(projectRoot, "release", "mac", "StarCanvas.app"),
    path.join(projectRoot, "release", "mac-universal", "StarCanvas.app"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

let command;
let cliRoot;
if (mode === "packaged") {
  if (process.platform !== "darwin") throw new Error("当前打包版冒烟脚本仅在 macOS 运行；Windows 使用 build:win 后检查 resources/starcanvas-cli");
  const appBundle = findPackagedApp();
  if (!appBundle) throw new Error("找不到打包后的StarCanvas.app，请先运行 npm run build");
  command = path.join(appBundle, "Contents", "MacOS", "StarCanvas");
  cliRoot = path.join(appBundle, "Contents", "Resources", "starcanvas-cli");
} else {
  command = require("electron");
  cliRoot = path.join(projectRoot, "bin");
}

const cliPath = path.join(cliRoot, "starcanvas.mjs");
const mcpPath = path.join(cliRoot, "starcanvas-mcp.mjs");
assert.equal(fs.existsSync(cliPath), true, `${mode} CLI 文件应存在`);
assert.equal(fs.existsSync(mcpPath), true, `${mode} MCP 文件应存在`);
assert.equal(fs.existsSync(path.join(cliRoot, "wanjuan.mjs")), true, `${mode} 旧 CLI 兼容入口应存在`);
assert.equal(fs.existsSync(path.join(cliRoot, "wanjuan-mcp.mjs")), true, `${mode} 旧 MCP 兼容入口应存在`);

const launch = createCandidateLaunchPlan({env:{
  ...process.env,
  STARCANVAS_CANDIDATE_APP:mode === "packaged" ? path.dirname(path.dirname(path.dirname(command))) : projectRoot,
  STARCANVAS_CANDIDATE_USER_DATA:userDataPath,
  WANJUAN_GPU_MODE:"off",
  WANJUAN_AUTOMATION_TEST_ENDPOINTS:"1",
}});
const child = spawn(launch.command, launch.args, {
  cwd: launch.cwd,
  stdio: "ignore",
  env: launch.env,
});
const ownExit = new Promise(resolve => child.once("exit", resolve));

const cliEnv = { ...process.env, STARCANVAS_AUTOMATION_FILE: infoFile };
function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: projectRoot, env: cliEnv, encoding: "utf8", timeout: 15000 });
  if (result.status !== 0) throw new Error((result.stderr || `CLI ${args.join(" ")} 失败`).trim());
  return JSON.parse(result.stdout);
}
async function requestApp(method, endpoint, payload, allowError = false) {
  const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
  const response = await fetch(`http://127.0.0.1:${info.port}${endpoint}`, {
    method,
    headers: { authorization: `Bearer ${info.token}`, ...(payload ? { "content-type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!allowError) assert.equal(response.ok, true, JSON.stringify(result));
  return result;
}
async function waitForStatus() {
  const deadline = Date.now() + 45000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${mode} App 提前退出，exitCode=${child.exitCode}`);
    if (fs.existsSync(infoFile)) {
      try {
        const currentInfo = JSON.parse(fs.readFileSync(infoFile, "utf8"));
        // 测试会预置一份失效凭据。只有待测 App 已写入自身 PID 和新 token 后，
        // 才允许 CLI 冒烟，避免 CLI 自动跳过失效项后误连到同时运行的正式 App。
        if (currentInfo.pid === child.pid && currentInfo.token !== staleToken) return runCli(["status"]);
      } catch (error) { lastError = error; }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw lastError || new Error(`${mode} App 自动化服务启动超时`);
}

async function inspectMcp() {
  const mcp = spawn(process.execPath, [mcpPath], { cwd: projectRoot, env: cliEnv, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise(resolve=>mcp.once("exit",(code,signal)=>resolve({code,signal})));
  const replies = new Map();
  readline.createInterface({ input: mcp.stdout }).on("line", (line) => {
    try { const value = JSON.parse(line); replies.set(value.id, value); } catch {}
  });
  const send = (value) => mcp.stdin.write(`${JSON.stringify(value)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "automation-smoke", version: "1" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const deadline = Date.now() + 5000;
  while (replies.size < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  mcp.stdin.end();
  const exit = await Promise.race([exited,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
  if (!exit) { mcp.kill("SIGTERM"); throw new Error("MCP shutdown unconfirmed"); }
  assert.equal(exit.code,0);
  assert.equal(replies.get(1)?.result?.serverInfo?.name, "starcanvas");
  assert.equal(replies.get(2)?.result?.tools?.length, 14);
  for (const name of ["starcanvas_submit_operation", "starcanvas_get_operation", "starcanvas_cancel_operation", "starcanvas_import_media", "starcanvas_export_task"]) assert(replies.get(2).result.tools.some(tool => tool.name === name));
  assert.equal(replies.get(2)?.result?.tools?.every((tool) => tool.name.startsWith("starcanvas_")), true);
}

(async () => {
  try {
    const status = await waitForStatus();
    const refreshedInfo = JSON.parse(fs.readFileSync(infoFile, "utf8"));
    assert.notEqual(refreshedInfo.token, staleToken, "App 启动应替换旧自动化凭据");
    assert.equal(refreshedInfo.pid, child.pid, "自动化凭据应属于当前 App 进程");
    const models = runCli(["models"]);
    const tasks = runCli(["tasks"]);
    assert.equal(status.ok, true);
    assert.equal(status.ready, true);
    assert.equal(models.ok, true);
    assert.equal(Array.isArray(models.image), true);
    assert.equal(Array.isArray(models.video), true);
    assert.equal(Array.isArray(models.text), true);
    assert.equal(tasks.ok, true);
    assert.equal(Array.isArray(tasks.tasks), true);
    if (mode === "dev") {
      const mediaRoot = path.join(userDataPath, "media-root");
      const denied = await requestApp("POST", "/v1/automation-test/materialize", { kind: "image", dataUrl: tinyPng, directory: mediaRoot }, true);
      assert.equal(denied.ok, false);
      assert.equal(denied.code, "OPERATION_PERMISSION_REQUIRED");
      assert.equal(denied.permission, "media.export");
      assert.equal(fs.existsSync(mediaRoot), false, "未获应用端确认时不能借旧测试入口写入媒体");
    }
    await inspectMcp();
    console.log(`automation ${mode} app: status/models/tasks and MCP initialize/tools/list passed`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([
      ownExit,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([ownExit,new Promise(resolve=>setTimeout(resolve,3000))]);
    }
    if (child.exitCode === null && child.signalCode === null) throw new Error(`Candidate exit unconfirmed; isolated data retained at ${tempRoot}`);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
