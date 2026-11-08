const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

test("cloud capabilities are authenticated, fail closed on unsupported routes and retry transient outages", async (t) => {
  let calls = 0, failure = null;
  const previousLoad = Module._load;
  Module._load = function (id, parent, main) {
    if (parent?.filename?.endsWith(`${path.sep}cloud-project-bridge.cjs`)) {
      if (id === "./cloud-project-service.cjs") return { createCloudProjectSession: () => ({
        quota: async () => { calls++; if (failure) throw failure; return { limitBytes: 1, usedBytes: 0, reservedBytes: 0, availableBytes: 1 }; },
      }) };
      if (id === "./electron-refs.cjs") return { app: { getPath: () => "/unused" } };
    }
    return previousLoad.call(this, id, parent, main);
  };
  t.after(() => { Module._load = previousLoad; });
  const { createCloudProjectBridge } = require("../electron/main/cloud-project-bridge.cjs");
  const disabled = createCloudProjectBridge({ enabled: false, mediaRoot: "/unused", stagingRoot: "/unused" });
  assert.deepEqual(await disabled.invoke({ operation: "capabilities" }), { enabled: false, available: false });
  assert.equal(calls, 0);
  const bridge = createCloudProjectBridge({ enabled: true, mediaRoot: "/unused", stagingRoot: "/unused" });
  assert.deepEqual(await bridge.invoke({ operation: "capabilities" }), { enabled: true, available: true });
  for (const error of [{ status: 404 }, { status: 401 }, { code: "AUTH_REQUIRED" }, { code: "ACCOUNT_SESSION_CHANGED" }]) {
    failure = error;
    assert.deepEqual(await bridge.invoke({ operation: "capabilities" }), { enabled: false, available: false });
  }
  failure = { status: 503, message: "private server details" };
  assert.deepEqual(await bridge.invoke({ operation: "capabilities" }), { enabled: true, available: false });
  failure = null;
  assert.deepEqual(await bridge.invoke({ operation: "capabilities" }), { enabled: true, available: true });
  assert.equal(calls, 7);
});
