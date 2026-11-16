const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const asar = require("@electron/asar");
const { test } = require("node:test");
const { verifyPackagedRuntimeDeps } = require("./verify-packaged-runtime-deps.cjs");

async function fixture(missing, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-package-fixture-"));
  try {
    const source = path.join(root, "source");
    const archive = path.join(root, "app.asar");
    for (const [relative, content] of Object.entries({
      "package.json": JSON.stringify({ name: "synthetic-package", version: "1.0.0" }),
      "node_modules/selfsigned/index.js": "module.exports=require('synthetic-child');",
      "node_modules/yaml/index.js": "module.exports={parse:()=>({synthetic:true})};",
      ...(!missing ? { "node_modules/synthetic-child/index.js": "module.exports={synthetic:true};" } : {}),
    })) {
      const target = path.join(source, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    await asar.createPackage(source, archive);
    await body(archive, root);
    assert.deepEqual(fs.readdirSync(root).sort(), ["app.asar", "source"]);
    assert.equal(Object.keys(require.cache).some(name => name.includes("starcanvas-asar-deps-")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("actual package transitive imports load without launching Electron", async () => {
  await fixture(false, (archive, root) => {
    const result = verifyPackagedRuntimeDeps(archive, { tempParent: root });
    assert.deepEqual(result.dependencies, ["selfsigned", "yaml"]);
    assert.equal(result.appLaunched, false);
    assert.equal(result.releaseReady, false);
  });
});

test("missing indirect dependency fails and cleans only the fresh extraction", async () => {
  await fixture(true, (archive, root) => {
    assert.throws(() => verifyPackagedRuntimeDeps(archive, { tempParent: root }), { code: "MODULE_NOT_FOUND" });
  });
});

test("afterPack preserves platform copying then checks the actual platform ASAR", async () => {
  const source = fs.readFileSync(path.join(__dirname, "after-pack.cjs"), "utf8");
  for (const platform of ["darwin", "win32"]) {
    const calls = [];
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, console: { log() {} },
      require(name) {
        if (name === "node:path") return path;
        if (name === "./copy-platform-tool-runtime.cjs") return async () => calls.push("copy");
        if (name === "./packaged-resource-root.cjs") return require("./packaged-resource-root.cjs");
        if (name === "./copy-macos-account-keychain.cjs") return () => calls.push("keychain");
        if (name === "./verify-packaged-assistant-runtime.cjs") return {
          verifyPackagedAssistantRuntime() { calls.push("assistant"); return { supported: true, target: "synthetic" }; },
        };
        if (name === "./verify-packaged-runtime-deps.cjs") return {
          verifyPackagedRuntimeDeps(file) { calls.push(file); return { dependencies: [] }; },
        };
        throw new Error("UNEXPECTED_REQUIRE");
      },
    });
    await module.exports({ electronPlatformName: platform, appOutDir: "/synthetic/output" });
    assert.equal(calls[0], "copy");
    assert.equal(calls[1], "keychain");
    assert.equal(calls[2], "assistant");
    assert.equal(calls[3], platform === "darwin"
      ? "/synthetic/output/StarCanvas.app/Contents/Resources/app.asar"
      : "/synthetic/output/resources/app.asar");
  }
});

test("packaging resource path follows the actual safe product filename", () => {
  const root = require("./packaged-resource-root.cjs");
  assert.equal(root({electronPlatformName:"darwin",appOutDir:"/out",packager:{appInfo:{productFilename:"QA App"}}}),
    "/out/QA App.app/Contents/Resources");
  assert.throws(() => root({electronPlatformName:"darwin",appOutDir:"/out",packager:{appInfo:{productFilename:"../unsafe"}}}));
  assert.equal(root({electronPlatformName:"win32",appOutDir:"/out"}), "/out/resources");
});

test("packaging config cannot omit the main-process runtime guard", () => {
  const pkg = require("../package.json");
  assert.equal(pkg.build.afterPack, "scripts/after-pack.cjs");
});

test("macOS packaging copies only the pinned helper and rejects an existing destination", () => {
  const copy = require("./copy-macos-account-keychain.cjs");
  const contract = require("../electron/shared/macos-account-helper.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-helper-package-"));
  try {
    const resources = path.join(root, "Fixture.app", "Contents", "Resources");
    fs.mkdirSync(resources, {recursive:true});
    const context = {electronPlatformName:"darwin", appOutDir:root, packager:{appInfo:{productFilename:"Fixture"}}};
    copy(context);
    const target = path.join(resources, contract.resourceDirectory, contract.executable);
    assert.equal(require("node:crypto").createHash("sha256").update(fs.readFileSync(target)).digest("hex"), contract.sha256);
    assert.throws(() => copy(context));
    copy({electronPlatformName:"win32", appOutDir:root});
  } finally {fs.rmSync(root,{recursive:true});}
});
