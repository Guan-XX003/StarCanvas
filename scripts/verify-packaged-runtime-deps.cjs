#!/usr/bin/env node
// Read-only ASAR validation. Never launches Electron or accesses account storage.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const asar = require("@electron/asar");

const REQUIRED_RUNTIME_DEPS = ["selfsigned", "yaml"];

function verifyPackagedRuntimeDeps(archive, options = {}) {
  assert.ok(path.isAbsolute(archive) && fs.statSync(archive).isFile(), "ABSOLUTE_ASAR_FILE_REQUIRED");
  const temporary = fs.mkdtempSync(path.join(options.tempParent || os.tmpdir(), "starcanvas-asar-deps-"));
  const root = fs.realpathSync(temporary);
  try {
    asar.extractAll(archive, root);
    const load = createRequire(path.join(root, "package.json"));
    const dependencies = [];
    for (const name of REQUIRED_RUNTIME_DEPS) {
      const resolved = fs.realpathSync(load.resolve(name));
      assert.ok(resolved.startsWith(root + path.sep), "PACKAGED_DEPENDENCY_ESCAPED_ARCHIVE");
      // Module loading traverses actual transitive runtime imports. A successful
      // path lookup alone would miss selfsigned -> @peculiar/x509/pkijs.
      load(name);
      dependencies.push(name);
    }
    for (const file of Object.keys(require.cache)) {
      if (!file.startsWith(root + path.sep)) continue;
      for (const child of require.cache[file].children) {
        if (!path.isAbsolute(child.filename)) continue;
        assert.ok(fs.realpathSync(child.filename).startsWith(root + path.sep),
                  "PACKAGED_TRANSITIVE_DEPENDENCY_ESCAPED_ARCHIVE");
      }
    }
    return { status: "PASS_PACKAGED_RUNTIME_DEPS_NOT_GUI", dependencies,
      appLaunched: false, nativeStorageTested: false, releaseReady: false };
  } finally {
    // Only this invocation's fresh temporary extraction is removed.
    for (const name of Object.keys(require.cache)) {
      if (name.startsWith(root + path.sep)) delete require.cache[name];
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { REQUIRED_RUNTIME_DEPS, verifyPackagedRuntimeDeps };
if (require.main === module) {
  try {
    const archive = process.argv[2];
    const tempParent = process.argv[3];
    console.log(JSON.stringify(verifyPackagedRuntimeDeps(archive, { tempParent })));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL_PACKAGED_RUNTIME_DEPS", errorCode: error.code || error.name,
      // Do not dump stack/environment or a dependency's arbitrary error text.
      appLaunched: false, releaseReady: false }));
    process.exitCode = 1;
  }
}
