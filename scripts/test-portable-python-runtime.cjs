const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { assertStandalonePython, assertMacDefaceRuntime, assembleStandalonePython } = require("./portable-python-runtime.cjs");
const copyRuntime = require("./copy-platform-tool-runtime.cjs");

function write(root, relative, contents = "synthetic fixture") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
function fixture(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-python-fixture-"));
  return Promise.resolve().then(() => body(root)).finally(() => fs.rmSync(root, { recursive: true, force: true }));
}
function base(root) {
  for (const name of ["bin/python3.12", "lib/python3.12/encodings/__init__.py", "lib/python3.12/os.py"])
    write(root, name);
  fs.mkdirSync(path.join(root, "lib/python3.12/lib-dynload"), { recursive: true });
}
function macRuntime(root) {
  base(path.join(root, "deface/python"));
  fs.symlinkSync("python3.12", path.join(root, "deface/python/bin/python3"));
  for (const name of ["bin/deface", "deface/run.py", "deface/LICENSES.md",
    "deface/python/lib/python3.12/site-packages/deface/centerface.onnx"]) write(root, name);
  write(root, "deface/wanjuan-bundled-deface.json", JSON.stringify({ platform: "darwin", arch: "arm64",
    runtime: "cpython-standalone", pythonVersion: "3.12", command: "bin/deface", requiresSystemPython: false }));
}

test("standalone assembly contains stdlib and dependencies and refuses overwrites", () => fixture(root => {
  const source = path.join(root, "base"), site = path.join(root, "site"), target = path.join(root, "portable");
  base(source); write(site, "deface/centerface.onnx");
  const alias = path.join(root, "base-alias"); fs.symlinkSync(source, alias);
  assembleStandalonePython({ baseRoot: alias, siteRoot: site, targetRoot: target, version: "3.12" });
  assert.equal(assertStandalonePython(target, "3.12").version, "3.12");
  assert.ok(fs.existsSync(path.join(target, "lib/python3.12/site-packages/deface/centerface.onnx")));
  assert.throws(() => assembleStandalonePython({ baseRoot: source, siteRoot: site, targetRoot: target, version: "3.12" }), /NEW_TARGET_REQUIRED/);
}));

test("missing encodings and a developer venv cannot pass standalone validation", () => fixture(root => {
  base(root);
  write(root, "pyvenv.cfg", "home = /developer/python");
  assert.throws(() => assertStandalonePython(root, "3.12"), /IS_VENV/);
  fs.unlinkSync(path.join(root, "pyvenv.cfg"));
  fs.unlinkSync(path.join(root, "lib/python3.12/encodings/__init__.py"));
  assert.throws(() => assertStandalonePython(root, "3.12"), /INCOMPLETE/);
}));

test("external symlinks and .pth paths are rejected", () => fixture(root => {
  const runtime = path.join(root, "runtime"); base(runtime);
  write(root, "outside");
  fs.symlinkSync(path.join(root, "outside"), path.join(runtime, "external"));
  assert.throws(() => assertStandalonePython(runtime, "3.12"), /EXTERNAL_SYMLINK/);
  fs.unlinkSync(path.join(runtime, "external"));
  write(runtime, "lib/python3.12/site-packages/external.pth", "/developer/python\n");
  assert.throws(() => assertStandalonePython(runtime, "3.12"), /EXTERNAL_SITE_PATH/);
}));

test("Mac copying fails before changing existing resources for legacy venv inputs", () => fixture(async root => {
  const source = path.join(root, "source"), out = path.join(root, "output");
  write(source, "darwin-arm64/deface/wanjuan-bundled-deface.json", JSON.stringify({
    platform: "darwin", arch: "arm64", runtime: "venv", requiresSystemPython: false }));
  const sentinel = "StarCanvas.app/Contents/Resources/tool-runtime/keep.txt";
  write(out, sentinel, "preserve existing resources");
  await assert.rejects(() => copyRuntime({ electronPlatformName: "darwin", arch: 3, appOutDir: out }, { sourceRoot: source }), /REQUIRES_STANDALONE_PYTHON/);
  assert.equal(fs.readFileSync(path.join(out, sentinel), "utf8"), "preserve existing resources");
}));

test("Mac standalone fixture survives resource copy and rejects an extra old venv", () => fixture(async root => {
  const source = path.join(root, "source"), out = path.join(root, "output");
  const runtime = path.join(source, "darwin-arm64"); macRuntime(runtime);
  await copyRuntime({ electronPlatformName: "darwin", arch: 3, appOutDir: out }, { sourceRoot: source });
  assert.equal(assertMacDefaceRuntime(path.join(out, "StarCanvas.app/Contents/Resources/tool-runtime/darwin-arm64")).version, "3.12");
  assert.equal(fs.readlinkSync(path.join(out, "StarCanvas.app/Contents/Resources/tool-runtime/darwin-arm64/deface/python/bin/python3")), "python3.12");
  write(runtime, "deface/venv/pyvenv.cfg");
  assert.throws(() => assertMacDefaceRuntime(runtime), /LEGACY_VENV_PRESENT/);
}));
