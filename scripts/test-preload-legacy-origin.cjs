const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../electron/preload/legacy-data.cjs"), "utf8");
const decisionKey = "synthetic-legacy-decision";
const decisionVersion = "synthetic-v1";

function load(window) {
  const module = { exports: {} };
  const calls = { theme: 0, databaseList: 0, databaseDeletes: 0, storageWrites: 0 };
  window.indexedDB = {
    async databases() { calls.databaseList++; return [{ name: "old-user-data" }]; },
    deleteDatabase() { calls.databaseDeletes++; throw new Error("DATA_DELETE_FORBIDDEN"); },
  };
  vm.runInNewContext(source, {
    module, window, console,
    require(name) {
      if (name === "./runtime.cjs") return { fs, path };
      if (name === "./constants.cjs") return {
        RECOVERY_MARKER_KEY: "synthetic-recovery", LEGACY_DATA_DECISION_KEY: decisionKey,
        LEGACY_DATA_DECISION_VERSION: decisionVersion, STORAGE_DB_NAME: "current-data",
      };
      if (name === "./boot-theme.cjs") return {
        clearLegacyThemeStorage() { calls.theme++; },
        mergeRecoveredApiConfigs() { throw new Error("UNEXPECTED_RECOVERY"); },
        hasStoredValue: Boolean,
      };
      if (name === "./project-safety.cjs") return {
        clearDesktopStorage() { throw new Error("DATA_DELETE_FORBIDDEN"); },
      };
      if (name === "./storage.cjs") return {
        getDesktopStorageItems() { throw new Error("UNEXPECTED_STORAGE_READ"); },
        setDesktopStorageItems() { calls.storageWrites++; throw new Error("UNEXPECTED_STORAGE_WRITE"); },
        resetStorageDbPromise() { throw new Error("UNEXPECTED_STORAGE_RESET"); },
      };
      throw new Error("UNEXPECTED_REQUIRE");
    },
  });
  return { ...module.exports, calls };
}

test("opaque initial document defers without reading databases or writing user storage", async () => {
  const window = Object.defineProperty({}, "localStorage", {
    get() { throw new Error("SecurityError: opaque origin"); },
  });
  const legacy = load(window);
  assert.equal(legacy.getLegacyDocumentStorage(), null);
  assert.equal(await legacy.confirmLegacyUserDataChoice(), false);
  assert.deepEqual(legacy.calls, { theme: 0, databaseList: 0, databaseDeletes: 0, storageWrites: 0 });
});

test("absent or incomplete document storage never marks migration complete", async () => {
  for (const localStorage of [undefined, {}, { getItem() { throw new Error("UNEXPECTED_READ"); } }]) {
    const legacy = load({ localStorage });
    assert.equal(await legacy.confirmLegacyUserDataChoice(), false);
    assert.equal(legacy.calls.databaseList, 0);
    assert.equal(legacy.calls.theme, 0);
  }
});

test("valid origin preserves legacy data and records the decision once", async () => {
  const values = new Map([["canvas", "synthetic-existing-project"]]);
  const legacy = load({ localStorage: {
    getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
  } });
  assert.equal(await legacy.confirmLegacyUserDataChoice(), true);
  assert.equal(values.get(decisionKey), decisionVersion);
  assert.equal(values.get("canvas"), "synthetic-existing-project");
  assert.equal(legacy.calls.databaseDeletes, 0);
  assert.equal(legacy.calls.storageWrites, 0);
  assert.equal(legacy.calls.databaseList, 1);
  await legacy.confirmLegacyUserDataChoice();
  assert.equal(legacy.calls.databaseList, 1);
  assert.equal(legacy.calls.theme, 1);
});

test("a later valid document can finish after the opaque document was deferred", async () => {
  let available = false;
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const window = Object.defineProperty({}, "localStorage", {
    get() { if (!available) throw new Error("SecurityError"); return storage; },
  });
  const legacy = load(window);
  assert.equal(await legacy.confirmLegacyUserDataChoice(), false);
  available = true;
  assert.equal(await legacy.confirmLegacyUserDataChoice(), true);
  assert.equal(values.get(decisionKey), decisionVersion);
  assert.equal(legacy.calls.databaseList, 1);
  assert.equal(legacy.calls.databaseDeletes, 0);
});

test("preload skips recovery for the opaque page and retains valid-page bootstrap order", async () => {
  const entry = fs.readFileSync(path.join(__dirname, "../electron/preload/index.cjs"), "utf8");
  for (const decision of [false, true, undefined]) {
    const calls = [];
    const modules = {
      "./runtime.cjs": { ipcRenderer: { invoke: async () => {} } },
      "./storage.cjs": { getPerformanceSettings: () => ({}) },
      "./boot-theme.cjs": {
        installBootStabilityStyle() {}, applyInitialThemeClass() {}, resolveBootThemeMode() {},
      },
      "./legacy-data.cjs": {
        async confirmLegacyUserDataChoice() { calls.push("confirm"); return decision; },
        async applyDesktopStorageRecovery() { calls.push("recover"); },
      },
      "./chrome-shim.cjs": { installChromeShim() { calls.push("shim"); } },
      "./fetch-proxy.cjs": { installDesktopFetchProxy() {}, installFetchStabilityShim() {} },
      "./desktop-patches.cjs": { installDesktopPatches() {} },
      "./bridge-api.cjs": {},
    };
    vm.runInNewContext(entry, {
      process: { env: {} }, console,
      window: { addEventListener() {} },
      require(name) {
        assert.ok(Object.hasOwn(modules, name), "unexpected preload dependency");
        return modules[name];
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    if (decision === false) assert.equal(calls.includes("recover"), false);
    else assert.ok(calls.indexOf("recover") > calls.indexOf("confirm"));
    assert.equal(calls.at(-1), "shim");
  }
});
