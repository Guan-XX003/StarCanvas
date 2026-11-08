const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../electron/main/account-secret-storage.cjs"), "utf8");
function load(native, root, legacy = () => { throw new Error("LEGACY_UNEXPECTED"); }, platform = process.platform, helper = null) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Buffer, process: { platform }, setTimeout, clearTimeout,
    require(name) {
      if (name === "./electron-refs.cjs") return { app: { getPath: () => root, isPackaged: !!helper }, safeStorage: native };
      if (name === "./local-secret-storage.cjs") return { decryptLocalSecret: legacy };
      if (name === "./macos-account-secret.cjs" && helper) return helper;
      if (["node:fs", "node:path"].includes(name)) return require(name);
      throw new Error("UNEXPECTED_REQUIRE");
    },
  });
  return module.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test("packaged macOS uses helper ciphertext; old OS ciphertext requires relogin without probing old Keychain", async () => {
  const calls = [];
  const helper = {
    ciphertextPrefix: "wanjuan-keychain-v2.",
    helperError(code) { return Object.assign(new Error("synthetic"), { code }); },
    async request(operation, value) {
      calls.push([operation, value]);
      return operation === "encrypt" ? Buffer.from(value).toString("base64") : Buffer.from(value, "base64").toString();
    },
  };
  const store = load(new Proxy({}, {get() { throw new Error("OLD_KEYCHAIN_FORBIDDEN"); }}), "/unused", undefined, "darwin", helper);
  assert.equal(store.secretStorageMode(), "unchecked");
  const encrypted = await store.encryptSecret("synthetic-account");
  assert.ok(encrypted.startsWith(helper.ciphertextPrefix));
  assert.equal(await store.decryptSecret(encrypted), "synthetic-account");
  await assert.rejects(store.decryptSecret("old-electron-ciphertext"), { code:"SECURE_STORAGE_RELOGIN_REQUIRED" });
  assert.deepEqual(calls.map(row => row[0]), ["encrypt", "decrypt"]);
});
function native(overrides = {}) {
  return {
    isEncryptionAvailable() { throw new Error("SYNC_PROBE_FORBIDDEN"); },
    encryptString() { throw new Error("SYNC_ENCRYPT_FORBIDDEN"); },
    decryptString() { throw new Error("SYNC_DECRYPT_FORBIDDEN"); },
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => Buffer.from("os-protected:" + value),
    decryptStringAsync: async value => ({ result: value.toString().slice("os-protected:".length), shouldReEncrypt: false }),
    ...overrides,
  };
}

test("anonymous status reads do not touch native storage or create files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-async-status-"));
  try {
    const store = load(new Proxy({}, { get() { throw new Error("NATIVE_STATUS_PROBE_FORBIDDEN"); } }), root);
    assert.equal(store.secretStorageMode(), "unchecked");
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("system availability is shared but concurrent native encryption is not duplicated", async () => {
  let count = 0;
  const gate = deferred();
  const store = load(native({ isAsyncEncryptionAvailable: async () => { count++; await gate.promise; return true; } }), "/unused");
  const a = store.encryptSecret("synthetic-a");
  const b = store.encryptSecret("synthetic-b");
  const busy = assert.rejects(b, { code: "SECURE_STORAGE_BUSY" });
  await new Promise(r => setImmediate(r));
  assert.equal(count, 1);
  assert.equal(store.secretStorageMode(), "pending");
  gate.resolve();
  const first = await a;
  await busy;
  const second = await store.encryptSecret("synthetic-b");
  assert.equal(store.secretStorageMode(), "system");
  assert.equal(await store.decryptSecret(first), "synthetic-a");
  assert.equal(await store.decryptSecret(second), "synthetic-b");
  assert.equal(await store.encryptSecret(""), "");
});

test("operation timeout is neutral, bounded and reuses the live OS request", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = deferred();
  let count = 0;
  const store = load(native({ isAsyncEncryptionAvailable: async () => { count++; return gate.promise; } }), "/unused");
  const first = store.encryptSecret("synthetic-timeout");
  const denied = assert.rejects(first, error => {
    assert.equal(error.code, "SECURE_STORAGE_TIMEOUT");
    assert.ok(error.message.includes("操作超时"));
    assert.equal(/授权|系统提示|弹窗/.test(error.message), false);
    return true;
  });
  await Promise.resolve();
  t.mock.timers.tick(8000);
  await denied;
  assert.equal(store.secretStorageMode(), "unavailable");
  const second = store.encryptSecret("synthetic-retry");
  assert.equal(store.secretStorageMode(), "pending");
  await Promise.resolve();
  assert.equal(count, 1);
  gate.resolve(true);
  assert.equal(await store.decryptSecret(await second), "synthetic-retry");
});

test("native failures and unsupported runtime fail closed without fallback or raw errors", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-async-fail-"));
  try {
    for (const bridge of [
      {},
      native({ isAsyncEncryptionAvailable: async () => false }),
      native({ encryptStringAsync: async () => { throw new Error("synthetic-secret-do-not-log"); } }),
    ]) {
      const store = load(bridge, root);
      await assert.rejects(store.encryptSecret("synthetic-secret"), error =>
        error.code.startsWith("SECURE_STORAGE_") && !error.message.includes("synthetic-secret"));
      assert.equal(store.secretStorageMode(), "unavailable");
      assert.deepEqual(fs.readdirSync(root), []);
    }
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("Linux basic_text is not accepted as protected system storage", async () => {
  const store = load(native({ getSelectedStorageBackend: () => "basic_text" }), "/unused", undefined, "linux");
  await assert.rejects(store.encryptSecret("synthetic"), { code: "SECURE_STORAGE_UNAVAILABLE" });
  assert.equal(store.secretStorageMode(), "unavailable");
});

test("legacy local ciphertext can be read, but missing key is never regenerated", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-async-legacy-"));
  let nativeCalls = 0;
  try {
    const store = load(native({ isAsyncEncryptionAvailable: async () => { nativeCalls++; return true; } }), root, () => "legacy-value");
    await assert.rejects(store.decryptSecret("wanjuan-local-v1.fixture"), { code: "SECURE_STORAGE_LEGACY_KEY_UNAVAILABLE" });
    assert.deepEqual(fs.readdirSync(root), []);
    fs.writeFileSync(path.join(root, ".wanjuan-local-secret-key"), Buffer.alloc(32, 7), { mode: 0o600 });
    assert.equal(await store.decryptSecret("wanjuan-local-v1.fixture"), "legacy-value");
    assert.equal(nativeCalls, 0);
    assert.equal(store.secretStorageMode(), "unchecked");
    // New writes still use the actual OS API, not the adjacent legacy key.
    const next = await store.encryptSecret("new-secret");
    assert.equal(next.startsWith("wanjuan-local-v1."), false);
    assert.equal(nativeCalls, 1);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("encryption deadline retains pending native slot without overwriting existing ciphertext", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-encrypt-deadline-"));
  const sentinel = path.join(root, "existing-session.json");
  fs.writeFileSync(sentinel, "existing-ciphertext");
  try {
    const store = load(native({ encryptStringAsync: () => new Promise(() => {}) }), root);
    const encrypted = store.encryptSecret("synthetic-never-persisted");
    const denied = assert.rejects(encrypted, { code: "SECURE_STORAGE_TIMEOUT" });
    await new Promise(r => setImmediate(r));
    assert.equal(store.secretStorageMode(), "pending");
    t.mock.timers.tick(8000);
    await denied;
    assert.equal(store.secretStorageMode(), "pending", "the underlying encryption remains in flight after caller timeout");
    assert.equal(fs.readFileSync(sentinel, "utf8"), "existing-ciphertext");
  } finally { fs.rmSync(root, { recursive: true }); }
});

test("account UI distinguishes unchecked, pending, available and unavailable without claiming authorization", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../src/renderer/components/settings-account-tab.tsx"), "utf8");
  for (const text of ["安全存储尚未检测", "安全存储检测中", "系统安全存储可用", "安全存储不可用"]) assert.ok(ui.includes(text));
  assert.equal(ui.includes("等待系统安全存储授权"), false);
  assert.equal(source.includes("处理系统提示"), false);
});

test("timed-out native encryption holds its slot until late success; B never receives A ciphertext", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const gate = deferred();
  const inputs = [];
  const store = load(native({ encryptStringAsync: value => {
    inputs.push(value);
    return inputs.length === 1 ? gate.promise : Promise.resolve(Buffer.from("os-protected:" + value));
  } }), "/unused");
  const first = store.encryptSecret("synthetic-a");
  const timedOut = assert.rejects(first, { code: "SECURE_STORAGE_TIMEOUT" });
  await new Promise(r => setImmediate(r));
  t.mock.timers.tick(8000);
  await timedOut;
  for (let i = 0; i < 3; i++) {
    await assert.rejects(store.encryptSecret("synthetic-b"), error => error.code === "SECURE_STORAGE_BUSY" && !/授权|弹窗/.test(error.message));
    await assert.rejects(store.decryptSecret(Buffer.from("os-protected:b").toString("base64")), { code: "SECURE_STORAGE_BUSY" });
  }
  assert.deepEqual(inputs, ["synthetic-a"]);
  assert.equal(store.secretStorageMode(), "pending");
  gate.resolve(Buffer.from("os-protected:synthetic-a"));
  await new Promise(r => setImmediate(r));
  assert.equal(store.secretStorageMode(), "system");
  const second = await store.encryptSecret("synthetic-b");
  assert.equal(Buffer.from(second, "base64").toString(), "os-protected:synthetic-b");
  assert.deepEqual(inputs, ["synthetic-a", "synthetic-b"]);
});

test("timed-out decryption rejects reentry, releases on native failure and permits a fresh operation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let rejectNative;
  let calls = 0;
  const store = load(native({ decryptStringAsync: () => {
    calls++;
    return calls === 1 ? new Promise((_resolve, reject) => { rejectNative = reject; })
      : Promise.resolve({ result: "synthetic-b" });
  } }), "/unused");
  const encoded = Buffer.from("os-protected:synthetic-a").toString("base64");
  const first = store.decryptSecret(encoded);
  const timedOut = assert.rejects(first, { code: "SECURE_STORAGE_TIMEOUT" });
  await new Promise(r => setImmediate(r));
  t.mock.timers.tick(8000);
  await timedOut;
  await assert.rejects(store.decryptSecret(encoded), { code: "SECURE_STORAGE_BUSY" });
  await assert.rejects(store.encryptSecret("synthetic-b"), { code: "SECURE_STORAGE_BUSY" });
  assert.equal(calls, 1);
  rejectNative(new Error("synthetic-native-failure"));
  await new Promise(r => setImmediate(r));
  assert.equal(store.secretStorageMode(), "unavailable");
  assert.equal(await store.decryptSecret(encoded), "synthetic-b");
  assert.equal(calls, 2);
});
