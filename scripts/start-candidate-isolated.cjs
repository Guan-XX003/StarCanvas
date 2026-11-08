#!/usr/bin/env node

// Explicit candidate launcher. Never reuses the formal StarCanvas userData.
// For a packaged candidate, set STARCANVAS_CANDIDATE_APP to the .app path.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
require("./verify-electron-runtime.cjs").verifyElectronRuntime(projectRoot);
const appPath = path.resolve(process.env.STARCANVAS_CANDIDATE_APP || projectRoot);
const userDataPath = path.resolve(
  process.env.STARCANVAS_CANDIDATE_USER_DATA || path.join(os.tmpdir(), "starcanvas-candidate-user-data"),
);
const formalUserData = path.join(os.homedir(), "Library", "Application Support", "wanjuan-ai-canvas-desktop-test");
if (userDataPath === formalUserData || userDataPath.startsWith(`${formalUserData}${path.sep}`)) {
  throw new Error("候选启动器拒绝使用正式 userData");
}
fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });

const electronPath = require("electron");
const child = spawn(electronPath, [appPath], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    WANJUAN_TEST_USER_DATA_PATH: userDataPath,
    WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA: "1",
    WANJUAN_DISABLE_UPDATE_CHECK: process.env.WANJUAN_DISABLE_UPDATE_CHECK || "1",
  },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
