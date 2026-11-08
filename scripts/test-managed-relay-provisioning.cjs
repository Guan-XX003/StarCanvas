const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

function harness() {
  let nextId = 0;
  const timers = new Map();
  const output = { exports: {} };
  const context = vm.createContext({
    module: output, exports: output.exports, URL,
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/renderer/lib/managed-relay.ts"), "utf8");
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const tick = async () => {
    assert.equal(timers.size, 1, "only one refresh timer may exist");
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    await timer.callback();
    return timer.delay;
  };
  return { start: output.exports.startManagedRelayProvisioningSync, timers, tick };
}

test("pending -> active refreshes serially then stops", async () => {
  const { start, timers, tick } = harness();
  let pending = true, reads = 0;
  const stop = start({ isPending: () => pending, refresh: async () => { if (++reads === 3) pending = false; } });
  assert.equal(reads, 0, "no unbounded synchronous fetch");
  assert.equal(await tick(), 1000);
  assert.equal(await tick(), 2000);
  assert.equal(await tick(), 4000);
  assert.equal(reads, 3);
  assert.equal(timers.size, 0);
  stop();
});

test("transient failures keep retrying at a capped rate until activation", async () => {
  const { start, timers, tick } = harness();
  let reads = 0, pending = true;
  start({ isPending: () => pending, refresh: async () => { reads++; if (reads === 25) pending = false; else throw new Error("offline"); } });
  for (let attempt = 0; attempt < 25; attempt++) assert.equal(await tick(), Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
  assert.equal(reads, 25);
  assert.equal(timers.size, 0);
});

test("logout, account switch and disabled capability stop before reading", async () => {
  for (const boundary of ["logout", "account-switch", "feature-disabled"]) {
    const { start, timers, tick } = harness();
    let current = true, reads = 0;
    start({ isPending: () => current, refresh: async () => { reads++; } });
    current = false;
    await tick();
    assert.equal(reads, 0, boundary);
    assert.equal(timers.size, 0, boundary);
  }
});

test("unmount cancels the timer and an in-flight read cannot reschedule", async () => {
  const { start, timers, tick } = harness();
  const stop = start({ isPending: () => true, refresh: async () => {} });
  stop();
  assert.equal(timers.size, 0);
  let release;
  const stopActive = start({ isPending: () => true, refresh: () => new Promise((resolve) => { release = resolve; }) });
  const running = tick();
  assert.equal(timers.size, 0, "no overlapping request timer");
  stopActive();
  release();
  await running;
  assert.equal(timers.size, 0);
});

test("already-active and logged-out owners schedule nothing", () => {
  const { start, timers } = harness();
  start({ isPending: () => false, refresh: async () => assert.fail("not pending") });
  assert.equal(timers.size, 0);
});
