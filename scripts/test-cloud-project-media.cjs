const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const target = new Module(filename, module);
  target.filename = filename;
  target.paths = module.paths;
  const originalRequire = target.require.bind(target);
  target.require = (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : originalRequire(id);
  target._compile(output, filename);
  return target.exports;
}
const safety = load("cloud-project-safety");
const resource = load("resource");
const { withPreparedCloudAsset } = require("../electron/main/assets/cloud-project-media.cjs");
const { prepareCloudProjectMedia, restoreCloudProjectMedia } = load("cloud-project-media", {
  "./cloud-project-safety": safety, "./resource": resource,
});
const content = Buffer.from("synthetic image bytes");
const sha = crypto.createHash("sha256").update(content).digest("hex");
const sourcePath = "/Users/synthetic/assets/image.png";
const destPath = "C:\\StarCanvasQA\\image.png";
const verified = { localPath: sourcePath, sha256: sha, size: content.length };
const target = { localPath: destPath, sha256: sha, size: content.length };
const sourceUrl = resource.buildProjectMediaFileUrl(sourcePath);
const project = () => ({ nodes: [{ id: "a", data: { prompt: "合成测试", imageUrl: sourceUrl,
  audioApiKey: "secret-value", projectAssetBindings: { imageUrl: { localPath: sourcePath, sha256: sha,
    size: content.length, mime: "image/png", kind: "image", filename: "image.png", sourceSignature: sourceUrl } } } },
  { id: "b", data: { imageUrl: sourceUrl, projectAssetBindings: { imageUrl: { localPath: sourcePath,
    sha256: sha, size: content.length, mime: "image/png", kind: "image", filename: "image.png" } } } }],
  edges: [{ source: "a", target: "b" }] });
const rejects = (fn, code) => assert.throws(fn, (error) => error.code === code);

test("bound media becomes deduplicated cloud references and restores across platforms", () => {
  const input = project();
  const snapshot = prepareCloudProjectMedia(input, [verified]);
  assert.equal(snapshot.assets.length, 1);
  assert.deepEqual(snapshot.assets[0], { assetId: sha, blob: { sha256: sha, size: content.length } });
  assert.equal(snapshot.removedSecretFields, 1);
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes(sourcePath), false);
  assert.equal(encoded.includes("secret-value"), false);
  assert.equal(input.nodes[0].data.imageUrl, sourceUrl);
  const restored = restoreCloudProjectMedia(snapshot.state, [target]);
  assert.equal(restored.nodes[0].data.imageUrl, resource.buildProjectMediaFileUrl(destPath));
  assert.equal(restored.nodes[1].data.projectAssetBindings.imageUrl.localPath, destPath);
  assert.equal(restored.nodes[0].data.projectAssetBindings.imageUrl.sourceSignature, restored.nodes[0].data.imageUrl);
  assert.equal(restored.nodes[0].data.prompt, "合成测试");
  assert.equal(restored.edges[0].target, "b");
});

test("stale, missing or mismatched local bindings fail without mutating inputs", () => {
  const stale = project(); stale.nodes[0].data.imageUrl = "https://example.com/new.png";
  rejects(() => prepareCloudProjectMedia(stale, [verified]), "STALE_MEDIA_BINDING");
  assert.equal(stale.nodes[0].data.imageUrl, "https://example.com/new.png");
  rejects(() => prepareCloudProjectMedia(project(), []), "MEDIA_NOT_PREPARED");
  rejects(() => prepareCloudProjectMedia(project(), [{ ...verified, sha256: "f".repeat(64) }]), "ASSET_METADATA_CONFLICT");
  const unprepared = project(); delete unprepared.nodes[0].data.projectAssetBindings;
  rejects(() => prepareCloudProjectMedia(unprepared, [verified]), "MEDIA_NOT_PREPARED");
  const idb = project(); delete idb.nodes[0].data.projectAssetBindings.imageUrl.localPath;
  rejects(() => prepareCloudProjectMedia(idb, [verified]), "MEDIA_NOT_PREPARED");
});

test("unbound IndexedDB references cannot silently become broken cloud snapshots", () => {
  const unbound = { nodes: [{ id: "a", data: { imageUrlRef: "project-asset-v2-default-node-media" } }], edges: [] };
  rejects(() => prepareCloudProjectMedia(unbound, []), "MEDIA_NOT_PREPARED");
  const nested = { nodes: [{ id: "a", data: { clip: { portableDataRef: "project-asset-v2-default-clip" } } }], edges: [] };
  rejects(() => prepareCloudProjectMedia(nested, []), "MEDIA_NOT_PREPARED");
  assert.equal(unbound.nodes[0].data.imageUrlRef, "project-asset-v2-default-node-media");
});

test("a verified file binding removes only its matching stale local reference", () => {
  const input = project();
  input.nodes[0].data.imageUrlRef = "project-asset-v2-default-node-image";
  input.nodes[0].data.projectAssetBindings.imageUrl.portableDataRef = input.nodes[0].data.imageUrlRef;
  const prepared = prepareCloudProjectMedia(input, [verified]);
  assert.equal(prepared.state.nodes[0].data.imageUrlRef, undefined);
  assert.equal(input.nodes[0].data.imageUrlRef, "project-asset-v2-default-node-image");
  assert.equal(restoreCloudProjectMedia(prepared.state, [target]).nodes[0].data.imageUrl,
    resource.buildProjectMediaFileUrl(destPath));
  const conflict = project();
  conflict.nodes[0].data.imageUrlRef = "project-asset-v2-different-asset";
  conflict.nodes[0].data.projectAssetBindings.imageUrl.portableDataRef = "project-asset-v2-original-asset";
  rejects(() => prepareCloudProjectMedia(conflict, [verified]), "STALE_MEDIA_BINDING");
});

test("restore checks every reference, verified result, metadata and ownership boundary", () => {
  const snapshot = prepareCloudProjectMedia(project(), [verified]);
  rejects(() => restoreCloudProjectMedia(snapshot.state, []), "MEDIA_NOT_DOWNLOADED");
  rejects(() => restoreCloudProjectMedia(snapshot.state, [{ ...target, size: 1 }]), "MEDIA_NOT_DOWNLOADED");
  rejects(() => restoreCloudProjectMedia(snapshot.state, [{ ...target, localPath: "relative/file.png" }]), "INVALID_VERIFIED_ASSET");
  const altered = structuredClone(snapshot.state);
  altered.nodes[0].data.imageUrl = "https://example.com/new.png";
  rejects(() => restoreCloudProjectMedia(altered, [target]), "INVALID_MEDIA_REFERENCE");
  const extra = structuredClone(snapshot.state);
  extra.nodes[0].data.cloudAssetBindings.imageUrl.extra = "unexpected";
  rejects(() => restoreCloudProjectMedia(extra, [target]), "INVALID_MEDIA_REFERENCE");
  const secret = structuredClone(snapshot.state);
  secret.nodes[0].data.textApiKey = "private";
  rejects(() => restoreCloudProjectMedia(secret, [target]), "POTENTIAL_SECRET_IN_CONTENT");
});

test("actual staged file hash drives project conversion and verified local rebinding", async (t) => {
  const base = await fsp.realpath(await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()), "sc-cloud-flow-")));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "assets"), stagingRoot = path.join(base, "stage"), destination = path.join(base, "restored.png");
  await fsp.mkdir(root, { mode: 0o700 }); await fsp.mkdir(stagingRoot, { mode: 0o700 });
  const original = path.join(root, "source.png");
  await fsp.writeFile(original, content);
  const url = resource.buildProjectMediaFileUrl(original);
  const input = { nodes: [{ id: "a", data: { imageUrl: url, projectAssetBindings: { imageUrl: {
    localPath: original, sha256: sha, size: content.length, mime: "image/png", kind: "image",
    filename: "source.png", sourceSignature: url,
  } } } }], edges: [] };
  const cloudState = await withPreparedCloudAsset({ sourcePath: original, allowedRoots: [root], stagingRoot, maxBytes: 1024 },
    async ({ stagedPath, sha256, size }) => {
      const converted = prepareCloudProjectMedia(input, [{ localPath: original, sha256, size }]);
      await fsp.copyFile(stagedPath, destination);
      return converted;
    });
  assert.equal(JSON.stringify(cloudState).includes(original), false);
  const downloadedSha = crypto.createHash("sha256").update(await fsp.readFile(destination)).digest("hex");
  const restored = restoreCloudProjectMedia(cloudState.state, [{ localPath: destination, sha256: downloadedSha, size: content.length }]);
  assert.equal(restored.nodes[0].data.imageUrl, resource.buildProjectMediaFileUrl(destination));
  assert.deepEqual(await fsp.readFile(destination), content);
  assert.deepEqual(await fsp.readdir(stagingRoot), []);
});
