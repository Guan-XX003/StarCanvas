#!/usr/bin/env node
// Verify the real development runtime without opening an App or probing safeStorage.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function verifyElectronRuntime(root = path.resolve(__dirname, ".."), options = {}) {
  const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
  const expected = readJson(path.join(root, "package.json")).devDependencies?.electron;
  const locked = readJson(path.join(root, "package-lock.json")).packages?.["node_modules/electron"]?.version;
  if (!/^\d+\.\d+\.\d+$/.test(expected || "") || expected !== locked) {
    throw new Error("ELECTRON_RUNTIME_LOCK_MISMATCH: Electron 必须固定版本并与 package-lock.json 一致");
  }
  const installed = readJson(path.join(root, "node_modules/electron/package.json")).version;
  if (installed !== expected) {
    throw new Error(`ELECTRON_RUNTIME_VERSION_MISMATCH: 需要 Electron ${expected}，已安装 ${installed}；请按锁文件恢复依赖后重试`);
  }
  const load = options.load || require;
  const binary = load(path.join(root, "node_modules/electron"));
  const run = options.run || execFileSync;
  // Node mode does not construct app, initialize OSCrypt or access any userData.
  const actual = JSON.parse(run(binary, ["-p", "JSON.stringify({electron:process.versions.electron})"], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "", NODE_PATH: "" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  if (actual.electron !== expected) {
    throw new Error("ELECTRON_BINARY_VERSION_MISMATCH: Electron 可执行文件与锁定版本不一致");
  }
  return { status: "PASS_ELECTRON_RUNTIME_VERSION", electron: expected, appLaunched: false, nativeStorageTested: false };
}

module.exports = { verifyElectronRuntime };
if (require.main === module) {
  try { console.log(JSON.stringify(verifyElectronRuntime())); }
  catch (error) {
    // Do not echo arbitrary child stderr, environment, or paths from package code.
    console.error(/^(ELECTRON_RUNTIME_|ELECTRON_BINARY_)/.test(error.message)
      ? error.message : "ELECTRON_RUNTIME_CHECK_FAILED: 无法核验 Electron，已停止启动或打包");
    process.exitCode = 1;
  }
}
