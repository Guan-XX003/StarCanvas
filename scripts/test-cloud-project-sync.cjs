const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  const js = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const previous = mod.require.bind(mod);
  mod.require = (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : previous(id);
  mod._compile(js, filename); return mod.exports;
}
const safety = load("cloud-project-safety"), resource = load("resource");
const portableChunks = load("cloud-portable-chunks", { "./cloud-project-safety": safety });
const portableMedia = load("cloud-portable-assets", { "./cloud-project-safety": safety, "./cloud-portable-chunks": portableChunks });
const media = load("cloud-project-media", { "./cloud-project-safety": safety, "./resource": resource });
const barrier = load("storage-write-barrier");
const restore = load("backup-restore-transaction", { "./storage-write-barrier": barrier });
const { syncCloudProject, restoreCloudProjectAsNew } = load("cloud-project-sync", {
  "./cloud-project-media": media, "./backup-restore-transaction": restore,
  "./cloud-portable-assets": portableMedia, "./cloud-portable-chunks": portableChunks,
});
const source = "/synthetic/media/image.png", bytes = Buffer.from("synthetic image");
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
const sourceUrl = resource.buildProjectMediaFileUrl(source);
function canvas() { return { nodes: [{ id: "node-a", data: { prompt: "synthetic", imageUrl: sourceUrl,
  textApiKey: "private-synthetic", projectAssetBindings: { imageUrl: { localPath: source,
    sha256: digest, size: bytes.length, mime: "image/png", kind: "image", filename: "image.png", sourceSignature: sourceUrl } } } }],
  edges: [] }; }
function fixture() {
  const records = new Map(), locks = new Set(), blobs = new Map(), commits = new Map();
  const state = { revision: 0, failAfterCommit: false, calls: [], onCommit: null, beforeInspect: null };
  const storage = { async getItem(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async setItem(key, value) { records.set(key, structuredClone(value)); } };
  const withLock = async (name, task) => {
    if (locks.has(name)) throw Object.assign(new Error("busy"), { code: "CLOUD_PROJECT_BUSY" });
    locks.add(name); try { return await task(); } finally { locks.delete(name); }
  };
  const bridge = async (payload) => {
    state.calls.push(payload.operation);
    if (payload.operation === "begin") return { ok: true, handle: "test-handle", accountId: "synthetic-account" };
    if (payload.operation === "end") return { ok: true };
    if (payload.operation === "inspect-asset") {
      if (state.beforeInspect) await state.beforeInspect();
      return { ok: true, sha256: digest, size: bytes.length };
    }
    if (payload.operation === "upload-asset") {
      assert.equal(payload.sha256, digest); blobs.set(digest, bytes); return { ok: true, sha256: digest, size: bytes.length };
    }
    if (payload.operation === "upload-state") {
      const value = Buffer.from(JSON.stringify(payload.state));
      const sha256 = crypto.createHash("sha256").update(value).digest("hex");
      assert.equal(value.includes("private-synthetic"), false);
      blobs.set(sha256, value); return { ok: true, sha256, size: value.length, removedSecretFields: 0 };
    }
    if (payload.operation === "commit") {
      const prior = commits.get(payload.idempotencyKey);
      if (prior) return { ok: true, ...prior, replayed: true };
      if (payload.snapshot.baseRevision !== state.revision) return { ok: false, code: "PROJECT_REVISION_CONFLICT" };
      for (const ref of [payload.snapshot.state, ...payload.snapshot.assets.map((item) => item.blob)]) assert.ok(blobs.has(ref.sha256));
      const result = { projectId: payload.snapshot.projectId, revision: ++state.revision };
      commits.set(payload.idempotencyKey, result);
      state.onCommit?.();
      if (state.failAfterCommit) { state.failAfterCommit = false; return { ok: false, code: "NETWORK_ERROR" }; }
      return { ok: true, ...result, replayed: false };
    }
    throw new Error("unexpected operation");
  };
  return { records, locks, blobs, commits, state, storage, withLock, bridge };
}
function options(f, state, getCurrentState = async () => state) {
  return { bridge: f.bridge, storage: f.storage, withLock: f.withLock,
    localProjectId: "proj-synthetic", projectName: "合成项目", state, getCurrentState };
}

test("uploads verified media and state, then commits only metadata", async () => {
  const f = fixture(), input = canvas();
  const result = await syncCloudProject(options(f, input));
  assert.equal(result.revision, 1); assert.equal(result.dirty, false); assert.equal(result.removedSecretFields, 1);
  assert.equal(input.nodes[0].data.textApiKey, "private-synthetic");
  const record = [...f.records.values()][0];
  assert.equal(record.revision, 1); assert.equal(record.pending, null);
  assert.equal(JSON.stringify(record).includes("private-synthetic"), false);
  assert.equal(JSON.stringify(record).includes(source), false);
  assert.equal(f.state.calls.at(-1), "end");
});

test("lost commit response replays same intent before a new version", async () => {
  const f = fixture(), input = canvas(); f.state.failAfterCommit = true;
  await assert.rejects(syncCloudProject(options(f, input)), (error) => error.code === "NETWORK_ERROR");
  const pending = [...f.records.values()][0];
  assert.equal(pending.revision, 0); assert.ok(pending.pending); assert.equal(f.commits.size, 1);
  const result = await syncCloudProject(options(f, input));
  assert.equal(result.revision, 2); assert.equal(f.commits.size, 2);
  assert.equal([...f.records.values()][0].pending, null);
});

test("local edits remain marked dirty; invalid assets never upload", async () => {
  const f = fixture(), input = canvas(), changed = canvas(); changed.nodes[0].data.prompt = "edited";
  const result = await syncCloudProject(options(f, input, async () => changed));
  assert.equal(result.dirty, true);
  const bad = canvas(); delete bad.nodes[0].data.projectAssetBindings.imageUrl.localPath;
  const before = f.state.calls.filter((call) => call.startsWith("upload")).length;
  await assert.rejects(syncCloudProject(options(f, bad)), (error) => error.code === "MEDIA_NOT_PREPARED");
  assert.equal(f.state.calls.filter((call) => call.startsWith("upload")).length, before);
});

test("an IndexedDB-only reference cannot upload or commit an incomplete snapshot", async () => {
  const f = fixture();
  const input = { nodes: [{ id: "node-a", data: {
    imageUrlRef: "project-asset-v2-proj-synthetic-node-a-imageUrl",
  } }], edges: [] };
  const before = structuredClone(input);
  await assert.rejects(syncCloudProject(options(f, input)), (error) => error.code === "MEDIA_NOT_PREPARED");
  assert.deepEqual(input, before);
  assert.equal(f.state.calls.includes("upload-state"), false);
  assert.equal(f.state.calls.includes("upload-asset"), false);
  assert.equal(f.state.calls.includes("commit"), false);
  assert.equal(f.state.calls.at(-1), "end");
  assert.equal(f.commits.size, 0);
  const binding = [...f.records.values()][0];
  assert.equal(binding.revision, 0);
  assert.equal(binding.pending, null);
});

test("concurrent saves of the same project cannot overlap", async () => {
  const f = fixture(), input = canvas();
  let notify, release;
  const entered = new Promise((resolve) => { notify = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  f.state.beforeInspect = async () => { notify(); await blocked; };
  const first = syncCloudProject(options(f, input)); await entered;
  await assert.rejects(syncCloudProject(options(f, input)), (error) => error.code === "CLOUD_PROJECT_BUSY");
  release(); assert.equal((await first).revision, 1);
  assert.equal(f.locks.size, 0);
});
