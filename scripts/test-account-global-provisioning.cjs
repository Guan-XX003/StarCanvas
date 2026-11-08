const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

function harness() {
  let next = 0, relayReads = 0, walletReads = 0, active = false, relayGate = null;
  const timers = new Map();
  let userId = "synthetic-user";
  const pending = () => ({ ok: true, authenticated: true, user: { id: userId },
    relay: { managed: true, status: "pending" },
    featureFlags: { relayManagedConfig: true, relayWalletUi: true } });
  const context = vm.createContext({ URL, console,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    wanjuanDesktop: {
      accountBootstrap: async () => pending(),
      accountRelay: async () => { relayReads++; if (relayGate) await relayGate; return { ok: true, relay: { managed: true, status: active ? "active" : "pending" } }; },
      accountWallet: async () => { walletReads++; return { ok: true, wallet: { availableAmount: 1 } }; },
      accountContinueLocal: async () => ({ ok: true, authenticated: false, user: null }),
    },
  });
  function load(relative, require) {
    const output = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, "../src/renderer/lib", relative), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInContext(`(function(module, exports, require) { ${compiled}\n})`, context)(output, output.exports, require);
    return output.exports;
  }
  const managed = load("managed-relay.ts", () => { throw new Error("unexpected import"); });
  const account = load("account.ts", (id) => {
    if (id === "./managed-relay") return managed;
    if (id === "./enterprise-runtime") return { clearEnterpriseConfigOverlay() {}, installEnterpriseConfigOverlay() {} };
    throw new Error(`unexpected import ${id}`);
  });
  return { account, timers, activate: () => { active = true; }, reads: () => ({ relayReads, walletReads }),
    switchUser: () => { userId = "another-synthetic-user"; }, blockRelay: (gate) => { relayGate = gate; },
    tick: async () => { assert.equal(timers.size, 1); const [id, timer] = timers.entries().next().value;
      timers.delete(id); await timer.fn(); return timer.delay; } };
}

test("provisioning completes globally without opening the account panel", async () => {
  const h = harness();
  await h.account.bootstrapAccount();
  for (let n = 0; n < 24; n++) await h.tick();
  assert.equal(h.reads().relayReads, 24);
  h.activate();
  assert.equal(await h.tick(), 30000);
  assert.equal(h.account.getAccountState().relay.status, "active");
  assert.equal(h.reads().walletReads, 1);
  assert.equal(h.timers.size, 0);
});

test("leaving the account cancels global provisioning", async () => {
  const h = harness();
  await h.account.bootstrapAccount();
  assert.equal(h.timers.size, 1);
  await h.account.continueWithLocalMode();
  assert.equal(h.timers.size, 0);
  assert.equal(h.reads().relayReads, 0);
});

test("an old in-flight response cannot activate a newly switched account", async () => {
  const h = harness();
  await h.account.bootstrapAccount();
  let release;
  h.blockRelay(new Promise((resolve) => { release = resolve; }));
  const oldRequest = h.tick();
  h.switchUser();
  await h.account.bootstrapAccount();
  h.activate();
  release();
  await oldRequest;
  assert.equal(h.account.getAccountState().user.id, "another-synthetic-user");
  assert.equal(h.account.getAccountState().relay.status, "pending");
  assert.equal(h.reads().walletReads, 0);
  assert.equal(h.timers.size, 1);
});

test("an old in-flight response cannot activate a new session of the same account", async () => {
  const h = harness();
  await h.account.bootstrapAccount();
  let release;
  h.blockRelay(new Promise((resolve) => { release = resolve; }));
  const oldRequest = h.tick();
  await h.account.continueWithLocalMode();
  await h.account.bootstrapAccount();
  h.activate();
  release();
  await oldRequest;
  assert.equal(h.account.getAccountState().user.id, "synthetic-user");
  assert.equal(h.account.getAccountState().relay.status, "pending");
  assert.equal(h.reads().walletReads, 0);
  assert.equal(h.timers.size, 1);
});
