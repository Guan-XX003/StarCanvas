#!/usr/bin/env node
// Read-only preview, using the same policy as the macOS startup check.
// This is not an OS sandbox or permission to launch an agent.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const policy = require("../electron/main/assistant-harness-policy.cjs");
const cli = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
const patch = path.resolve(__dirname, "../config/harness/sdk-restricted.patch.yml");

function main() {
  if (process.platform !== "darwin" || !fs.existsSync(cli)) throw new Error("Official local macOS Harness runtime is unavailable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-dsh-preview-"));
  const options = { cwd: dir, env: { PATH: "/usr/bin:/bin", DSH_HOME: dir }, encoding: "utf8", timeout: 15_000, maxBuffer: 250_000 };
  const version = execFileSync(cli, ["--version"], options).trim();
  if (version !== "0.2.2-rc.1") throw new Error("Unsupported Harness version");
  const dump = execFileSync(cli, ["--profile", "sdk-minimal", "--patch", patch, "--dump-config"], options);
  const result = policy.checkDump(dump, "installed");
  if (!result.ok) throw new Error(result.code);
  console.log(`${result.code} version=${version}; no agent, credentials or model request started`);
}
module.exports = policy;
if (require.main === module) {
  try { main(); } catch { console.error("HARNESS_COMPOSITION_PREVIEW_FAILED"); process.exitCode = 1; }
}
