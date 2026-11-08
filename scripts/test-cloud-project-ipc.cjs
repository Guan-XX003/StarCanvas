const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

test("cloud-project IPC is enabled by default, has a kill switch, and rejects untrusted senders", async (t) => {
  const handlers = new Map();
  const previousEnv = process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS;
  let invokes = 0, fail = false;
  const previousLoad = Module._load;
  Module._load = function (id, parent, main) {
    if (parent?.filename?.endsWith(`${path.sep}ipc.cjs`)) {
      if (id === "./electron-refs.cjs") return { ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: () => {} }, dialog: {} };
      if (id === "./runtime-state.cjs") return { getDesktopBaseUrl: () => "http://127.0.0.1:42111" };
      if (id === "./cloud-project-bridge.cjs") return { createCloudProjectBridge: ({ enabled }) => ({
        async invoke() { invokes++; if (!enabled) throw Object.assign(new Error("private path"), { code: "CLOUD_PROJECTS_DISABLED" });
          if (fail) throw Object.assign(new Error("private path"), { code: "CLOUD_PROJECT_INVALID" }); return { handle: "synthetic" }; },
      }) };
      if (id.startsWith("./")) return new Proxy({}, { get: () => () => {} });
    }
    return previousLoad.call(this, id, parent, main);
  };
  t.after(() => { Module._load = previousLoad; if (previousEnv === undefined) delete process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS;
    else process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS = previousEnv; });
  delete process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS;
  const { registerDesktopIpc } = require("../electron/main/ipc.cjs");
  registerDesktopIpc();
  let callback = handlers.get("wanjuan:cloud-projects"); assert.ok(callback);
  const event = (url) => ({ senderFrame: { url } });
  const blocked = await callback(event("http://127.0.0.1:42111.evil.invalid/"), {});
  assert.equal(blocked.ok, false); assert.equal(invokes, 0);
  assert.equal((await callback(event("http://127.0.0.1:42111/index.html"), {})).handle, "synthetic");
  handlers.clear(); process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS = "0";
  registerDesktopIpc(); callback = handlers.get("wanjuan:cloud-projects");
  const disabled = await callback(event("http://127.0.0.1:42111/index.html"), {});
  assert.equal(disabled.code, "CLOUD_PROJECTS_DISABLED"); assert.equal(disabled.error.includes("private"), false);
  handlers.clear(); process.env.WANJUAN_EXPERIMENTAL_CLOUD_PROJECTS = "1";
  registerDesktopIpc(); callback = handlers.get("wanjuan:cloud-projects");
  assert.equal((await callback(event("http://127.0.0.1:42111/index.html"), {})).handle, "synthetic");
  fail = true;
  const result = await callback(event("http://127.0.0.1:42111/index.html"), {});
  assert.equal(result.code, "CLOUD_PROJECT_INVALID"); assert.equal(result.error.includes("private"), false);
});
