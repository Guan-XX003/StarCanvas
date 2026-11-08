const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const http = require("node:http");
const Module = require("node:module");
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadRenderer(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  let source = readFileSync(filename, "utf8");
  if (process.env.STARCANVAS_TEST_TINY_CHUNKS === "1" && ["cloud-portable-assets", "cloud-project-sync"].includes(name)) {
    assert.equal(source.split("128 * 1024 * 1024").length, 2);
    source = source.replace("128 * 1024 * 1024", "16");
  }
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const previous = mod.require.bind(mod);
  mod.require = (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : previous(id);
  mod._compile(js, filename); return mod.exports;
}
const safety = loadRenderer("cloud-project-safety"), resource = loadRenderer("resource");
const portableChunks = loadRenderer("cloud-portable-chunks", { "./cloud-project-safety": safety });
const portableMedia = loadRenderer("cloud-portable-assets", { "./cloud-project-safety": safety, "./cloud-portable-chunks": portableChunks });
const media = loadRenderer("cloud-project-media", { "./cloud-project-safety": safety, "./resource": resource });
const barrier = loadRenderer("storage-write-barrier");
const restore = loadRenderer("backup-restore-transaction", { "./storage-write-barrier": barrier });
const { syncCloudProject, restoreCloudProjectAsNew } = loadRenderer("cloud-project-sync", {
  "./cloud-project-media": media, "./backup-restore-transaction": restore,
  "./cloud-portable-assets": portableMedia, "./cloud-portable-chunks": portableChunks,
});

test("experimental bridge authorizes saved project assets and guards state", async (t) => {
  const temp = await fsp.realpath(await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()), "sc-cloud-bridge-")));
  const mediaRoot = path.join(temp, "media"), stagingRoot = path.join(temp, "stage"), projectId = "proj-synthetic";
  await fsp.mkdir(path.join(mediaRoot, projectId, "assets"), { recursive: true });
  await fsp.mkdir(path.join(mediaRoot, "proj-other", "assets"), { recursive: true });
  await fsp.mkdir(path.join(mediaRoot, "_projects"), { recursive: true });
  await fsp.mkdir(stagingRoot, { mode: 0o700 });
  const source = path.join(mediaRoot, projectId, "assets", "test.png"), foreign = path.join(mediaRoot, "proj-other", "assets", "other.png");
  const sample = Buffer.from("synthetic media"); await fsp.writeFile(source, sample); await fsp.writeFile(foreign, sample);
  const manifestPath = path.join(mediaRoot, "_projects", `${projectId}.json`);
  const manifest = (refs) => fsp.writeFile(manifestPath, JSON.stringify({ projectId, complete: true, references: refs }));
  await manifest([source]);
  const fakeElectron = { app: { getPath: () => temp, getVersion: () => "test", isPackaged: false },
    safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
      decryptStringAsync: async (buffer) => ({ result: buffer.toString().replace(/^encrypted:/, ""), shouldReEncrypt: false }) } };
  const oldLoad = Module._load, oldUrl = process.env.WANJUAN_ACCOUNT_API_URL;
  Module._load = function (request, parent, main) {
    if (request === "electron" || request === "electron/main") return fakeElectron;
    if (request === "selfsigned") return { generate: () => { throw new Error("not used by cloud test"); } };
    return oldLoad.call(this, request, parent, main);
  };
  const account = require("../electron/main/account-service.cjs");
  const { createCloudProjectBridge } = require("../electron/main/cloud-project-bridge.cjs");
  Module._load = oldLoad;
  const blobs = new Map(), reservations = new Map(), commits = new Map(), versions = new Map();
  let revision = 0, loseCommitResponse = false, corruptDownload = false;
  let networkWrites = 0;
  const user = { user: { id: "synthetic-user", email: "synthetic@example.com" }, device: { id: "synthetic-device" },
    featureFlags: {}, relay: null, wallet: null, entitlements: [] };
  const json = (response, status, value) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    try { for await (const chunk of request) chunks.push(chunk); } catch { return; }
    const url = new URL(request.url, "http://127.0.0.1"), bytes = Buffer.concat(chunks);
    if (url.pathname === "/auth/password/login") return json(response, 200, { ...user, accessToken: "synthetic-access", refreshToken: "synthetic-refresh" });
    if (url.pathname === "/auth/logout") return json(response, 200, { ok: true });
    if (url.pathname === "/me/organizations") return json(response, 200, { items: [] });
    if (url.pathname === "/cloud-projects/blobs/reserve") {
      networkWrites++; const body = JSON.parse(bytes); reservations.set(body.sha256, body.size);
      return json(response, 200, { status: blobs.has(body.sha256) ? "ready" : "reserved" });
    }
    if (url.pathname === "/cloud-projects/snapshots" && request.method === "POST") {
      const body = JSON.parse(bytes), key = request.headers["idempotency-key"];
      if (commits.has(key)) return json(response, 200, { ...commits.get(key), replayed: true });
      if (body.baseRevision !== revision) return json(response, 409, { code: "PROJECT_REVISION_CONFLICT" });
      assert.ok(blobs.has(body.state.sha256));
      for (const ref of body.assets) assert.ok(blobs.has(ref.blob.sha256));
      const result = { projectId: body.projectId, revision: ++revision };
      commits.set(key, result);
      versions.set(`${body.projectId}:${revision}`, { ...body, revision });
      if (loseCommitResponse) { loseCommitResponse = false; return json(response, 503, { code: "NETWORK_ERROR" }); }
      return json(response, 200, { ...result, replayed: false });
    }
    const projectMatch = url.pathname.match(/^\/cloud-projects\/([a-f0-9]{64})$/);
    if (projectMatch && request.method === "GET") {
      const requested = url.searchParams.get("revision") || String(revision);
      const item = versions.get(`${projectMatch[1]}:${requested}`);
      return item ? json(response, 200, item) : json(response, 404, { code: "PROJECT_NOT_FOUND" });
    }
    const match = url.pathname.match(/^\/cloud-projects\/blobs\/([a-f0-9]{64})$/);
    if (match && request.method === "PUT") {
      networkWrites++; assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), match[1]);
      assert.equal(bytes.length, reservations.get(match[1])); blobs.set(match[1], bytes);
      return json(response, 200, { status: "ready", replayed: false });
    }
    if (match && request.method === "GET") {
      const value = blobs.get(match[1]); if (!value) return json(response, 404, { code: "BLOB_NOT_FOUND" });
      const output = corruptDownload && value.length > 16 ? Buffer.from(value) : value;
      if (output !== value) output[0] ^= 0xff;
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": output.length }); return response.end(output);
    }
    return json(response, 404, { code: "NOT_FOUND" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.WANJUAN_ACCOUNT_API_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (oldUrl === undefined) delete process.env.WANJUAN_ACCOUNT_API_URL; else process.env.WANJUAN_ACCOUNT_API_URL = oldUrl;
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await fsp.rm(temp, { recursive: true, force: true });
  });
  const login = () => account.loginAccount({ identifier: "synthetic@example.com", password: "synthetic-password" });
  await login();
  const disabled = createCloudProjectBridge({ enabled: false, mediaRoot, stagingRoot });
  await assert.rejects(disabled.invoke({ operation: "begin", projectId }), (error) => error.code === "CLOUD_PROJECTS_DISABLED");
  const bridge = createCloudProjectBridge({ enabled: true, mediaRoot, stagingRoot });
  const { handle, accountId } = await bridge.invoke({ operation: "begin", projectId });
  assert.equal(accountId, "synthetic-user");
  const digest = crypto.createHash("sha256").update(sample).digest("hex");
  const inspected = await bridge.invoke({ operation: "inspect-asset", handle, localPath: source, sha256: digest, size: sample.length });
  assert.equal(inspected.sha256, digest); assert.equal(networkWrites, 0);
  const asset = await bridge.invoke({ operation: "upload-asset", handle, localPath: source, sha256: digest, size: sample.length });
  assert.equal(asset.sha256, digest); assert.deepEqual(blobs.get(digest), sample);
  const portableBytes = Buffer.from("synthetic indexeddb asset");
  const portableHash = crypto.createHash("sha256").update(portableBytes).digest("hex");
  const portable = await bridge.invoke({ operation: "upload-portable-asset", handle, bytes: portableBytes, sha256: portableHash });
  assert.equal(portable.sha256, portableHash);
  assert.deepEqual(blobs.get(portableHash), portableBytes);
  const portableDownload = await bridge.invoke({ operation: "download-portable-asset", handle, sha256: portableHash, size: portableBytes.length });
  assert.deepEqual(Buffer.from(portableDownload.bytes), portableBytes);
  const chunkBytes = Buffer.from("synthetic independently chunked content");
  const chunkHash = crypto.createHash("sha256").update(chunkBytes).digest("hex");
  const chunked = await bridge.invoke({ operation: "portable-chunks-begin", handle, size: chunkBytes.length });
  await bridge.invoke({ operation: "portable-chunks-append", handle, chunkHandle: chunked.id, offset: 0, bytes: chunkBytes.subarray(0, 10) });
  await assert.rejects(bridge.invoke({ operation: "portable-chunks-append", handle, chunkHandle: chunked.id,
    offset: 0, bytes: chunkBytes.subarray(10) }), error => error.code === "CLOUD_CHUNK_ARGUMENT_INVALID");
  await bridge.invoke({ operation: "portable-chunks-append", handle, chunkHandle: chunked.id, offset: 10, bytes: chunkBytes.subarray(10) });
  const chunkResult = await bridge.invoke({ operation: "portable-chunks-upload", handle, chunkHandle: chunked.id });
  assert.deepEqual(chunkResult, {sha256: chunkHash, size: chunkBytes.length});
  assert.deepEqual(blobs.get(chunkHash), chunkBytes);
  const chunkDownload = await bridge.invoke({ operation: "portable-chunks-download", handle, sha256: chunkHash, size: chunkBytes.length });
  assert.equal(chunkDownload.sha256, chunkHash);
  const downloadedChunk = await bridge.invoke({ operation: "portable-chunks-read", handle, chunkHandle: chunkDownload.id, offset: 0 });
  assert.deepEqual(downloadedChunk.bytes, chunkBytes);
  assert.equal(downloadedChunk.offset, chunkBytes.length);
  await bridge.invoke({ operation: "portable-chunks-abort", handle, chunkHandle: chunkDownload.id });
  const disposable = await bridge.invoke({ operation: "begin", projectId });
  const pending = await bridge.invoke({ operation: "portable-chunks-begin", handle: disposable.handle, size: 4 });
  await bridge.invoke({ operation: "portable-chunks-append", handle: disposable.handle, chunkHandle: pending.id, offset: 0, bytes: Buffer.from("xx") });
  await bridge.invoke({ operation: "end", handle: disposable.handle });
  assert.deepEqual(await fsp.readdir(stagingRoot), []);
  const portableWrites = networkWrites;
  await assert.rejects(bridge.invoke({ operation: "upload-portable-asset", handle, bytes: portableBytes, sha256: "0".repeat(64) }),
    error => error.code === "CLOUD_INTEGRITY_FAILED");
  await assert.rejects(bridge.invoke({ operation: "upload-portable-asset", handle, bytes: "not bytes", sha256: portableHash }),
    error => error.code === "CLOUD_MEDIA_ARGUMENT_INVALID");
  assert.equal(networkWrites, portableWrites);
  assert.deepEqual(await fsp.readdir(stagingRoot), []);
  const download = { operation: "download-asset", handle, sha256: digest, size: sample.length, mime: "image/png", filename: "test.png" };
  const savedAsset = await bridge.invoke(download);
  assert.deepEqual(await fsp.readFile(savedAsset.localPath), sample);
  assert.equal(savedAsset.deduplicated, false);
  assert.equal((await bridge.invoke(download)).deduplicated, true);
  await fsp.writeFile(savedAsset.localPath, "existing changed content");
  await assert.rejects(bridge.invoke(download), (error) => error.code === "CLOUD_LOCAL_ASSET_CONFLICT");
  assert.equal(await fsp.readFile(savedAsset.localPath, "utf8"), "existing changed content");
  const writesBefore = networkWrites;
  await assert.rejects(bridge.invoke({ operation: "upload-asset", handle, localPath: foreign }),
    (error) => error.code === "CLOUD_PROJECT_ASSET_NOT_REFERENCED");
  await manifest([source, foreign]);
  await assert.rejects(bridge.invoke({ operation: "upload-asset", handle, localPath: foreign }),
    (error) => error.code === "CLOUD_PROJECT_ASSET_OUTSIDE_ROOT");
  assert.equal(networkWrites, writesBefore);
  const input = { nodes: [{ id: "node", data: { prompt: "synthetic", audioApiKey: "private-value" } }], edges: [] };
  const saved = await bridge.invoke({ operation: "upload-state", handle, state: input });
  assert.equal(saved.removedSecretFields, 1);
  assert.equal(blobs.get(saved.sha256).toString().includes("private-value"), false);
  assert.equal(input.nodes[0].data.audioApiKey, "private-value");
  const restored = await bridge.invoke({ operation: "read-state", handle, sha256: saved.sha256, size: saved.size });
  assert.equal(restored.state.nodes[0].data.prompt, "synthetic");
  assert.equal("audioApiKey" in restored.state.nodes[0].data, false);
  await manifest([source]);
  const sourceUrl = resource.buildProjectMediaFileUrl(source);
  const legacyRef = "project-asset-v2-proj-synthetic-node-nested-thumbnail";
  const bindingRef = "project-asset-v2-proj-synthetic-node-preview";
  const legacyData = "data:image/png;base64," + portableBytes.toString("base64");
  const canvas = { nodes: [{ id: "node", data: { prompt: "synthetic", imageUrl: sourceUrl, projectId,
    nested: [{ thumbnailRef: legacyRef, thumbnail: legacyData }],
    textApiKey: "private-synthetic", projectAssetBindings: { imageUrl: { localPath: source, sha256: digest,
      size: sample.length, mime: "image/png", kind: "image", filename: "test.png", sourceSignature: sourceUrl },
      previewUrl: { portableDataRef: bindingRef, kind: "image", mime: "image/png", originalName: "preview.png" } } } }], edges: [] };
  const records = new Map();
  const storage = { async keys() { return [...records.keys()]; },
    async getItem(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async setItem(key, value) { records.set(key, structuredClone(value)); }, async removeItem(key) { records.delete(key); } };
  records.set(legacyRef, legacyData);
  records.set(bindingRef, legacyData);
  const bridgeCall = async (payload) => {
    try { return { ok: true, ...(await bridge.invoke(payload)) }; }
    catch (error) { return { ok: false, code: error.code || "CLOUD_PROJECT_FAILED" }; }
  };
  const syncOptions = { bridge: bridgeCall, storage, localProjectId: projectId, projectName: "合成项目", state: canvas,
    getCurrentState: async () => canvas, withLock: async (_name, task) => task() };
  loseCommitResponse = true;
  await assert.rejects(syncCloudProject(syncOptions), (error) => error.code === "NETWORK_ERROR");
  assert.ok([...records.values()].find(value => value && value.pending)?.pending); assert.equal(revision, 1);
  const synced = await syncCloudProject(syncOptions);
  assert.equal(synced.revision, 2); assert.equal(synced.dirty, false); assert.equal(commits.size, 2);
  assert.equal(JSON.stringify([...records.values()].find(value => value && value.remoteId)).includes("private-synthetic"), false);
  const chromeValues = { projects: [{ id: projectId, name: "原项目" }] };
  const chromeStorage = { get(keys, callback) { callback(Object.fromEntries(keys.filter((key) => Object.hasOwn(chromeValues, key)).map((key) => [key, chromeValues[key]]))); },
    set(values, callback) { Object.assign(chromeValues, structuredClone(values)); callback?.(); },
    remove(keys, callback) { for (const key of keys) delete chromeValues[key]; callback?.(); } };
  records.set("canvas-state-v1-proj-existing", { untouched: true });
  const restoredProject = await restoreCloudProjectAsNew({ bridge: bridgeCall, storage, chromeStorage,
    remoteId: synced.remoteId, newProjectId: "recovered-synthetic", withLock: async (_name, task) => task() });
  assert.equal(restoredProject.revision, 2); assert.equal(restoredProject.reloadRequired, true);
  const restoredCanvas = records.get("canvas-state-v1-recovered-synthetic");
  assert.equal(restoredCanvas.nodes[0].data.projectId, "recovered-synthetic");
  assert.equal(restoredCanvas.nodes[0].data.prompt, "synthetic");
  const restoredRef = restoredCanvas.nodes[0].data.nested[0].thumbnailRef;
  assert.notEqual(restoredRef, legacyRef);
  assert.equal(records.get(restoredRef), legacyData);
  assert.equal(restoredCanvas.nodes[0].data.nested[0].thumbnail, undefined);
  assert.equal(canvas.nodes[0].data.nested[0].thumbnailRef, legacyRef);
  assert.equal("textApiKey" in restoredCanvas.nodes[0].data, false);
  assert.deepEqual(await fsp.readFile(restoredCanvas.nodes[0].data.projectAssetBindings.imageUrl.localPath), sample);
  const recoveredBinding = restoredCanvas.nodes[0].data.projectAssetBindings.previewUrl;
  assert.equal(recoveredBinding.portableDataRef, restoredCanvas.nodes[0].data.previewUrlRef);
  assert.notEqual(recoveredBinding.portableDataRef, bindingRef);
  assert.equal(recoveredBinding.originalName, "preview.png");
  assert.equal(records.get(recoveredBinding.portableDataRef), legacyData);
  assert.equal(records.get(bindingRef), legacyData);
  assert.deepEqual(records.get("canvas-state-v1-proj-existing"), { untouched: true });
  assert.deepEqual(chromeValues.projects.map((item) => item.id), [projectId, "recovered-synthetic"]);
  corruptDownload = true;
  await assert.rejects(restoreCloudProjectAsNew({ bridge: bridgeCall, storage, chromeStorage,
    remoteId: synced.remoteId, newProjectId: "recovered-corrupt", withLock: async (_name, task) => task() }));
  corruptDownload = false;
  assert.equal(records.has("canvas-state-v1-recovered-corrupt"), false);
  assert.equal(chromeValues.projects.some(item => item.id === "recovered-corrupt"), false);
  await assert.rejects(restoreCloudProjectAsNew({ bridge: bridgeCall, storage, chromeStorage,
    remoteId: synced.remoteId, newProjectId: "recovered-synthetic", withLock: async (_name, task) => task() }),
    (error) => error.code === "CLOUD_LOCAL_PROJECT_EXISTS");
  let injected = false;
  const failingStorage = { ...storage, async setItem(key, value) {
    if (!injected && key.startsWith("project-asset-v2-recovered-rollback-")) {
      injected = true; throw new Error("synthetic write failure");
    }
    return storage.setItem(key, value);
  } };
  await assert.rejects(restoreCloudProjectAsNew({ bridge: bridgeCall, storage: failingStorage, chromeStorage,
    remoteId: synced.remoteId, newProjectId: "recovered-rollback", withLock: async (_name, task) => task() }));
  assert.equal(injected, true);
  assert.equal(records.has("canvas-state-v1-recovered-rollback"), false);
  assert.equal([...records.keys()].some(key => key.startsWith("project-asset-v2-recovered-rollback-")), false);
  assert.deepEqual(records.get("canvas-state-v1-proj-existing"), { untouched: true });
  assert.equal(records.get(legacyRef), legacyData);
  assert.equal(chromeValues.projects.some(item => item.id === "recovered-rollback"), false);
  await assert.rejects(bridge.invoke({ operation: "upload-state", handle, state: { prompt: "not a project" } }),
    (error) => error.code === "CLOUD_PROJECT_INVALID_STATE");
  assert.deepEqual(await fsp.readdir(stagingRoot), []);
  const interrupted = await bridge.invoke({ operation: "portable-chunks-begin", handle, size: 8 });
  await bridge.invoke({ operation: "portable-chunks-append", handle, chunkHandle: interrupted.id, offset: 0, bytes: Buffer.from("part") });
  await account.logoutAccount(); await login();
  await assert.rejects(bridge.invoke({ operation: "read-state", handle, sha256: saved.sha256, size: saved.size }),
    (error) => error.code === "ACCOUNT_SESSION_CHANGED");
  assert.deepEqual(await fsp.readdir(stagingRoot), []);
});
