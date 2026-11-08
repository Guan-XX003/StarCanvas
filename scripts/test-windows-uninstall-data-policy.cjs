const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const installer = fs.readFileSync(path.join(root, "build/installer.nsh"), "utf8");
const config = fs.readFileSync(path.join(root, "electron/main/config.cjs"), "utf8");

assert.notEqual(packageJson.build?.deleteAppDataOnUninstall, true,
  "Uninstall must not silently delete app data");
assert.doesNotMatch(installer, /RMDir\s+\/r\s+"\$APPDATA\\[^\"]+"/i,
  "Custom NSIS uninstall hooks must not recursively remove user data");
assert.match(config, /TEST_USER_DATA_DIR\s*=\s*["']wanjuan-ai-canvas-desktop-test["']/,
  "The uninstall policy must cover the actual custom Windows userData directory");
assert.match(fs.readFileSync(path.join(root, "electron/main/index.cjs"), "utf8"),
  /app\.setPath\(["']userData["'],\s*isolatedUserDataPath\s*\|\|\s*stableUserDataPath\)/,
  "Packaged builds must continue to use the preserved custom userData location");

console.log("Windows uninstall preserves StarCanvas userData: PASS");
