const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { verifyElectronRuntime } = require("./verify-electron-runtime.cjs");

function fixture(installed, runTest, expected = "42.11.15", locked = expected) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-runtime-check-"));
  try {
    fs.mkdirSync(path.join(root, "node_modules/electron"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { electron: expected } }));
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/electron": { version: locked } } }));
    fs.writeFileSync(path.join(root, "node_modules/electron/package.json"), JSON.stringify({ version: installed }));
    runTest(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("stale installed runtime stops before native binary invocation", () => {
  fixture("39.8.5", root => assert.throws(() => verifyElectronRuntime(root, {
    load() { assert.fail("stale runtime must not execute"); },
  }), /ELECTRON_RUNTIME_VERSION_MISMATCH/));
});

test("range or inconsistent lock cannot pass the runtime gate", () => {
  for (const [expected, locked] of [["^42.11.15", "42.11.15"], ["42.11.15", "39.8.5"]]) {
    fixture("42.11.15", root => assert.throws(() => verifyElectronRuntime(root), /ELECTRON_RUNTIME_LOCK_MISMATCH/), expected, locked);
  }
});

test("real binary is checked in Node mode without launching app or native storage", () => {
  fixture("42.11.15", root => {
    const result = verifyElectronRuntime(root, {
      load: () => "/fixture/electron",
      run(binary, args, options) {
        assert.equal(binary, "/fixture/electron");
        assert.deepEqual(args, ["-p", "JSON.stringify({electron:process.versions.electron})"]);
        assert.equal(options.env.ELECTRON_RUN_AS_NODE, "1");
        assert.equal(options.env.NODE_OPTIONS, "");
        assert.equal(options.timeout, 10000);
        return JSON.stringify({ electron: "42.11.15" });
      },
    });
    assert.equal(result.appLaunched, false);
    assert.equal(result.nativeStorageTested, false);
  });
});

test("package version alone cannot hide a mismatching binary", () => {
  fixture("42.11.15", root => assert.throws(() => verifyElectronRuntime(root, {
    load: () => "/fixture/electron", run: () => JSON.stringify({ electron: "39.8.5" }),
  }), /ELECTRON_BINARY_VERSION_MISMATCH/));
});

test("launch and build entrypoints all retain the runtime guard", () => {
  const pkg = require("../package.json");
  for (const name of ["start", "start:dev", "debug", "build", "build:win", "build:win:x64", "build:win:x86", "build:win:ia32"]) {
    assert.equal(pkg.scripts[`pre${name}`], "node scripts/verify-electron-runtime.cjs", name);
  }
  const dev = fs.readFileSync(path.join(__dirname, "start-dev.cjs"), "utf8");
  assert.ok(dev.indexOf("verifyElectronRuntime(projectRoot)") < dev.indexOf("fs.mkdirSync"));
  // Packaged candidates must not load source Electron. The source branch now
  // delegates its pre-profile runtime gate to the shared launch-plan owner.
  const launcher = fs.readFileSync(path.join(__dirname, "start-candidate-isolated.cjs"), "utf8");
  assert.ok(launcher.indexOf("createCandidateLaunchPlan()") < launcher.indexOf("spawn(plan.command"));
  const plan = fs.readFileSync(path.join(__dirname, "candidate-launch-plan.cjs"), "utf8");
  const guard = plan.indexOf("verifySourceRuntime(root)");
  assert.ok(guard >= 0 && guard < plan.indexOf("command = sourceElectron()"));
  assert.ok(guard < plan.indexOf("fs.mkdirSync(profile"));
});
