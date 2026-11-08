const path = require("node:path");

module.exports = function packagedResourceRoot(context) {
  if (context.electronPlatformName !== "darwin") return path.join(context.appOutDir, "resources");
  const name = context.packager?.appInfo?.productFilename || "StarCanvas";
  if (typeof name !== "string" || name === "." || name === ".." || /[\\/\0]/.test(name)) {
    throw new Error("Invalid macOS product filename");
  }
  return path.join(context.appOutDir, `${name}.app`, "Contents", "Resources");
};
