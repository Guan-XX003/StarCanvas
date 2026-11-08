// Build-input validation only. Never imports Electron or reads user credentials.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function assertContainedLinks(root) {
  const base = fs.realpathSync(root);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        const resolved = fs.realpathSync(file);
        if (path.isAbsolute(link) || !resolved.startsWith(base + path.sep)) {
          throw new Error("PORTABLE_PYTHON_EXTERNAL_SYMLINK");
        }
      } else if (entry.isDirectory()) visit(file);
    }
  }
  visit(base);
}

function assertStandalonePython(root, version) {
  if (!/^3\.\d+$/.test(version)) throw new Error("PORTABLE_PYTHON_VERSION_REQUIRED");
  const lib = path.join(root, "lib", `python${version}`);
  for (const relative of [`bin/python${version}`, `lib/python${version}/encodings/__init__.py`,
    `lib/python${version}/os.py`, `lib/python${version}/lib-dynload`]) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error("PORTABLE_PYTHON_INCOMPLETE");
  }
  if (fs.existsSync(path.join(root, "pyvenv.cfg"))) throw new Error("PORTABLE_PYTHON_IS_VENV");
  assertContainedLinks(root);
  const site = path.join(lib, "site-packages");
  if (fs.existsSync(site)) {
    for (const name of fs.readdirSync(site).filter(name => name.endsWith(".pth"))) {
      for (const line of fs.readFileSync(path.join(site, name), "utf8").split(/\r?\n/)) {
        const value = line.trim();
        if (!value || value.startsWith("#") || /^import[ \t]/.test(value)) continue;
        const resolved = path.resolve(site, value);
        if (path.isAbsolute(value) || !resolved.startsWith(path.resolve(root) + path.sep)) {
          throw new Error("PORTABLE_PYTHON_EXTERNAL_SITE_PATH");
        }
      }
    }
  }
  return { python: path.join(root, "bin", `python${version}`), version };
}

function assertMacDefaceRuntime(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "deface", "wanjuan-bundled-deface.json"), "utf8"));
  if (manifest.platform !== "darwin" || manifest.runtime !== "cpython-standalone" ||
      manifest.requiresSystemPython !== false || manifest.command !== "bin/deface") {
    throw new Error("MAC_DEFACE_REQUIRES_STANDALONE_PYTHON");
  }
  const runtime = path.join(root, "deface", "python");
  const result = assertStandalonePython(runtime, manifest.pythonVersion);
  for (const relative of ["bin/deface", "deface/run.py", "deface/LICENSES.md",
    `deface/python/lib/python${manifest.pythonVersion}/site-packages/deface/centerface.onnx`]) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error("MAC_DEFACE_INCOMPLETE");
  }
  // Do not accidentally ship a second developer-dependent venv alongside it.
  if (fs.existsSync(path.join(root, "deface", "venv"))) throw new Error("MAC_DEFACE_LEGACY_VENV_PRESENT");
  return result;
}

function assembleStandalonePython({ baseRoot, siteRoot, targetRoot, version }) {
  if (fs.existsSync(targetRoot)) throw new Error("PORTABLE_PYTHON_NEW_TARGET_REQUIRED");
  // uv's stable-version directory may itself be a symlink. Copy its contents,
  // never reproduce a link back to the build host as the standalone root.
  baseRoot = fs.realpathSync(baseRoot);
  siteRoot = fs.realpathSync(siteRoot);
  assertStandalonePython(baseRoot, version);
  assertContainedLinks(siteRoot);
  if (!fs.existsSync(path.join(siteRoot, "deface", "centerface.onnx"))) {
    throw new Error("PORTABLE_PYTHON_DEFACE_DEPENDENCIES_REQUIRED");
  }
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(targetRoot), ".python-build-"));
  try {
    fs.cpSync(baseRoot, staging, { recursive: true, verbatimSymlinks: true,
      mode: fs.constants.COPYFILE_FICLONE });
    const site = path.join(staging, "lib", `python${version}`, "site-packages");
    fs.mkdirSync(site, { recursive: true });
    fs.cpSync(siteRoot, site, { recursive: true, verbatimSymlinks: true,
      mode: fs.constants.COPYFILE_FICLONE });
    assertStandalonePython(staging, version);
    fs.renameSync(staging, targetRoot);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

function basePythonInfo(python) {
  const probe = "import json,sys; print(json.dumps({'baseRoot':sys.base_prefix,'version':f'{sys.version_info.major}.{sys.version_info.minor}'}))";
  return JSON.parse(execFileSync(python, ["-I", "-c", probe], { encoding: "utf8", timeout: 30000 }));
}

module.exports = { assertContainedLinks, assertStandalonePython, assertMacDefaceRuntime,
  assembleStandalonePython, basePythonInfo };
