const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("account-scoped media upload uses real HTTP and cancels on logout", async (t) => {
  const temporary = await fsp.realpath(await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()), "sc-account-cloud-")));
  const assets = path.join(temporary, "assets"), staging = path.join(temporary, "staging");
  await fsp.mkdir(assets, { mode: 0o700 }); await fsp.mkdir(staging, { mode: 0o700 });
  const sample = Buffer.from("synthetic file content"), sourcePath = path.join(assets, "image.png");
  await fsp.writeFile(sourcePath, sample);
  const digest = crypto.createHash("sha256").update(sample).digest("hex");
  const fakeElectron = {
    app: { getPath: () => temporary, getVersion: () => "synthetic", isPackaged: false },
    safeStorage: { isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
      decryptStringAsync: async (buffer) => ({ result: buffer.toString().replace(/^encrypted:/, ""), shouldReEncrypt: false }) },
  };
  const oldLoad = Module._load, oldUrl = process.env.WANJUAN_ACCOUNT_API_URL;
  Module._load = function (request, parent, main) {
    if (request === "electron" || request === "electron/main") return fakeElectron;
    if (request === "selfsigned") return { generate: () => { throw new Error("not used by cloud upload test"); } };
    return oldLoad.call(this, request, parent, main);
  };
  const service = require("../electron/main/account-service.cjs");
  const { createCloudProjectSession } = require("../electron/main/cloud-project-service.cjs");
  Module._load = oldLoad;
  const state = { mode: "retry", downloadMode: "ok", puts: 0, gets: 0, refreshes: 0, metadataCalls: 0, received: [], notify: null, pendingResponse: null };
  const projectId = "a".repeat(64);
  const json = (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value));
  };
  const account = { user: { id: "synthetic-user", email: "synthetic@example.com" },
    featureFlags: {}, relay: null, wallet: null, device: { id: "synthetic-device" }, entitlements: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    try { for await (const chunk of req) chunks.push(chunk); } catch { return; }
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (pathname === "/auth/password/login") return json(res, 200, { ...account, accessToken: "old-test-token", refreshToken: "test-refresh-one" });
    if (pathname === "/auth/refresh") { state.refreshes++; return json(res, 200, { ...account, accessToken: "fresh-test-token", refreshToken: "test-refresh-two" }); }
    if (pathname === "/auth/logout") return json(res, 200, { ok: true });
    if (pathname === "/me/organizations") return json(res, 200, { items: [] });
    if (pathname === "/cloud-projects/quota") { state.metadataCalls++; return json(res, 200, { limitBytes: 1000, usedBytes: 20, reservedBytes: 5, availableBytes: 975 }); }
    if (pathname === "/cloud-projects") { state.metadataCalls++; return json(res, 200, { items: [{ projectId, revision: 1 }], nextCursor: null }); }
    if (pathname === "/cloud-projects/snapshots" && req.method === "POST") {
      state.metadataCalls++; const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.projectId, projectId); assert.equal(req.headers["idempotency-key"], "synthetic-save-1");
      return json(res, 200, { projectId, revision: 1, replayed: false });
    }
    if (pathname === `/cloud-projects/${projectId}`) { state.metadataCalls++; return json(res, 200, {
      version: 1, projectId, revision: 1, baseRevision: 0, state: { sha256: digest, size: sample.length }, assets: [],
    }); }
    if (pathname === "/cloud-projects/blobs/reserve") {
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.sha256, digest); assert.equal(body.size, sample.length);
      return json(res, 200, { status: state.mode === "ready" ? "ready" : "reserved" });
    }
    if (pathname === `/cloud-projects/blobs/${digest}` && req.method === "GET") {
      state.gets++;
      if (state.downloadMode === "retry" && state.gets === 1) return json(res, 401, { code: "ACCESS_TOKEN_EXPIRED" });
      if (state.downloadMode === "wait") {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": sample.length });
        res.write(sample.subarray(0, 1)); state.pendingResponse = res; state.notify?.(); return;
      }
      const data = state.downloadMode === "tamper" ? Buffer.alloc(sample.length, 88) : sample;
      res.writeHead(200, { "content-type": "application/octet-stream",
        "content-length": data.length + (state.downloadMode === "wrong-length" ? 1 : 0) });
      return res.end(data);
    }
    if (pathname === `/cloud-projects/blobs/${digest}` && req.method === "PUT") {
      state.puts++; state.received.push({ bytes: Buffer.concat(chunks), auth: req.headers.authorization,
        reservation: req.headers["x-upload-reservation"] });
      if (state.mode === "retry" && state.puts === 1) return json(res, 401, { code: "ACCESS_TOKEN_EXPIRED" });
      if (state.mode === "always-expired") return json(res, 401, { code: "ACCESS_TOKEN_EXPIRED" });
      if (state.mode === "oversized") return json(res, 200, { status: "ready", padding: "x".repeat(70000) });
      if (state.mode === "wait") { state.pendingResponse = res; state.notify?.(); return; }
      return json(res, 200, { status: "ready", replayed: false });
    }
    return json(res, 404, { code: "NOT_FOUND" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.WANJUAN_ACCOUNT_API_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (oldUrl === undefined) delete process.env.WANJUAN_ACCOUNT_API_URL; else process.env.WANJUAN_ACCOUNT_API_URL = oldUrl;
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await fsp.rm(temporary, { recursive: true, force: true });
  });
  const login = () => service.loginAccount({ identifier: "synthetic@example.com", password: "synthetic-password" });
  const options = { sourcePath, allowedRoots: [assets], stagingRoot: staging, maxBytes: 1024,
    expectedSha256: digest, expectedSize: sample.length, timeoutMs: 5000 };
  await login();
  const first = await service.uploadCloudProjectAsset(options);
  assert.equal(first.sha256, digest); assert.equal(first.alreadyPresent, false);
  assert.equal(state.refreshes, 1); assert.equal(state.puts, 2);
  assert.deepEqual(state.received.map((item) => item.bytes), [sample, sample]);
  assert.deepEqual(state.received.map((item) => item.auth), ["Bearer old-test-token", "Bearer fresh-test-token"]);
  assert.equal(state.received[0].reservation, state.received[1].reservation);
  assert.deepEqual(await fsp.readdir(staging), []);
  const projectSession = createCloudProjectSession();
  assert.equal((await projectSession.quota()).availableBytes, 975);
  assert.equal((await projectSession.list()).items[0].projectId, projectId);
  const snapshot = { version: 1, projectId, baseRevision: 0, state: { sha256: digest, size: sample.length }, assets: [] };
  assert.equal((await projectSession.commit(snapshot, "synthetic-save-1")).revision, 1);
  assert.equal((await projectSession.read(projectId)).state.sha256, digest);
  const callsBeforeInvalid = state.metadataCalls;
  await assert.rejects(projectSession.commit({ ...snapshot, apiKey: "private" }, "synthetic-save-1"),
    (error) => error.code === "CLOUD_PROJECT_INVALID");
  assert.equal(state.metadataCalls, callsBeforeInvalid);
  const downloadOptions = { sha256: digest, size: sample.length, stagingRoot: staging, maxBytes: 1024, timeoutMs: 5000 };
  state.downloadMode = "retry"; state.gets = 0;
  const refreshed = state.refreshes;
  const download = await service.withDownloadedCloudProjectAsset(downloadOptions, async ({ stagedPath, assertSessionActive }) => {
    assertSessionActive(); assert.deepEqual(await fsp.readFile(stagedPath), sample); return "verified";
  });
  assert.equal(download, "verified"); assert.equal(state.gets, 2); assert.equal(state.refreshes, refreshed + 1);
  state.downloadMode = "tamper";
  await assert.rejects(service.withDownloadedCloudProjectAsset(downloadOptions, () => assert.fail("must not consume")),
    (error) => error.code === "CLOUD_INTEGRITY_FAILED");
  state.downloadMode = "wrong-length";
  await assert.rejects(service.withDownloadedCloudProjectAsset(downloadOptions, () => assert.fail("must not consume")),
    (error) => error.code === "CLOUD_INTEGRITY_FAILED");
  assert.deepEqual(await fsp.readdir(staging), []);
  state.downloadMode = "wait";
  const downloadStarted = new Promise((resolve) => { state.notify = resolve; });
  const pendingDownload = service.withDownloadedCloudProjectAsset(downloadOptions, () => assert.fail("must not consume"));
  await downloadStarted;
  const firstLogout = service.logoutAccount();
  await assert.rejects(pendingDownload, (error) => error.code === "ACCOUNT_SESSION_CHANGED");
  state.pendingResponse?.end(); await firstLogout;
  assert.deepEqual(await fsp.readdir(staging), []);
  await login();
  await assert.rejects(projectSession.quota(), (error) => error.code === "ACCOUNT_SESSION_CHANGED");
  state.mode = "ready";
  const ready = await service.uploadCloudProjectAsset(options);
  assert.equal(ready.alreadyPresent, true); assert.equal(state.puts, 2);
  await assert.rejects(service.uploadCloudProjectAsset({ ...options, sourcePath: path.join(temporary, "outside") }));
  state.mode = "always-expired"; state.puts = 0;
  const refreshBefore = state.refreshes;
  await assert.rejects(service.uploadCloudProjectAsset(options), (error) => error.code === "ACCESS_TOKEN_EXPIRED");
  assert.equal(state.puts, 2); assert.equal(state.refreshes, refreshBefore + 1);
  state.mode = "oversized";
  await assert.rejects(service.uploadCloudProjectAsset(options), (error) => error.code === "CLOUD_RESPONSE_INVALID");
  assert.deepEqual(await fsp.readdir(staging), []);
  state.mode = "wait";
  let notify;
  const started = new Promise((resolve) => { notify = resolve; }); state.notify = notify;
  const pending = service.uploadCloudProjectAsset(options);
  await started;
  const logout = service.logoutAccount();
  await assert.rejects(pending, (error) => error.code === "ACCOUNT_SESSION_CHANGED");
  state.pendingResponse?.end();
  await logout;
  assert.deepEqual(await fsp.readdir(staging), []);
  await assert.rejects(service.uploadCloudProjectAsset(options), (error) => error.code === "AUTH_REQUIRED");
});
