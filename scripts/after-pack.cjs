const path = require("node:path");
const copyPlatformToolRuntime = require("./copy-platform-tool-runtime.cjs");
const { verifyPackagedRuntimeDeps } = require("./verify-packaged-runtime-deps.cjs");
const packagedResourceRoot = require("./packaged-resource-root.cjs");
const copyMacAccountKeychain = require("./copy-macos-account-keychain.cjs");

module.exports = async function afterPack(context) {
  await copyPlatformToolRuntime(context);
  const resources = packagedResourceRoot(context);
  copyMacAccountKeychain(context);
  const result = verifyPackagedRuntimeDeps(path.join(resources, "app.asar"));
  console.log(`Packaged main-process runtime dependencies verified: ${result.dependencies.join(", ")}`);
};
