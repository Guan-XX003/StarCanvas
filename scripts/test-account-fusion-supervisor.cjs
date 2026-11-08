#!/usr/bin/env node

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { supervise, terminate, trackChildClose, waitForChildClose } = require("./account-fusion-qa-supervisor.cjs");

class FakeChild extends EventEmitter {
  constructor(kind) { super(); this.kind = kind; this.exitCode = null; this.signals = []; }
  kill(signal) { this.signals.push(signal); this.exitCode = 0; queueMicrotask(() => { this.emit("exit", 0, signal); this.emit("close", 0, signal); }); return true; }
  finish(code) { this.exitCode = code; queueMicrotask(() => { this.emit("exit", code, null); this.emit("close", code, null); }); }
}

async function run() {
  const children = [];
  const spawnImpl = (command) => {
    const child = new FakeChild(command === "ssh" ? "tunnel" : "runner");
    children.push(child);
    if (child.kind === "runner") setTimeout(() => child.finish(7), 5);
    return child;
  };
  const result = await supervise({
    spawnImpl,
    waitForPortImpl: async () => {},
    env: {
      WANJUAN_ACCOUNT_QA_TUNNEL_PORT: "49123",
      WANJUAN_ACCOUNT_QA_SSH_TARGET: "synthetic-host",
      WANJUAN_ACCOUNT_QA_OUTPUT_DIR: "/synthetic-owner-only-evidence",
      WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT: "/synthetic-frozen-candidate",
      WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256: "a".repeat(64),
    },
  });
  assert.equal(result.code, 7);
  assert.equal(children.length, 2);
  assert.deepEqual(children[0].signals, ["SIGTERM"], "runner exit must clean up the tunnel");
  assert.deepEqual(children[1].signals, [], "completed runner must not be killed again");
  const interruptedChildren = [];
  const interrupted = supervise({
    spawnImpl: (command) => {
      const child = new FakeChild(command === "ssh" ? "tunnel" : "runner");
      interruptedChildren.push(child);
      if (child.kind === "runner") setTimeout(() => process.emit("SIGINT"), 5);
      return child;
    },
    waitForPortImpl: async () => {},
    env: {
      WANJUAN_ACCOUNT_QA_TUNNEL_PORT: "49124",
      WANJUAN_ACCOUNT_QA_SSH_TARGET: "synthetic-host",
      WANJUAN_ACCOUNT_QA_OUTPUT_DIR: "/synthetic-owner-only-evidence-2",
      WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT: "/synthetic-frozen-candidate",
      WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256: "b".repeat(64),
    },
  });
  const interruptedResult = await interrupted;
  assert.deepEqual(interruptedResult, { code: 130, signal: "SIGINT" });
  assert.deepEqual(interruptedChildren[0].signals, ["SIGINT"]);
  assert.deepEqual(interruptedChildren[1].signals, ["SIGINT"]);

  class StubbornChild extends EventEmitter {
    constructor() { super(); this.exitCode = null; this.signalCode = null; this.signals = []; }
    kill(signal) {
      this.signals.push(signal);
      if (signal === "SIGKILL") queueMicrotask(() => {
        this.signalCode = signal;
        this.emit("exit", null, signal);
        this.emit("close", null, signal);
      });
      return true;
    }
  }
  const stubborn = new StubbornChild();
  assert.deepEqual(await terminate(stubborn, "SIGTERM", { termTimeoutMs: 5, killTimeoutMs: 50 }), { cleanupConfirmed: true, forced: true });
  assert.deepEqual(stubborn.signals, ["SIGTERM", "SIGKILL"], "SIGKILL cleanup must be awaited through close");
  const exitedNotClosed = trackChildClose(new FakeChild("held-pipe"));
  exitedNotClosed.exitCode = 0;
  exitedNotClosed.emit("exit", 0, null);
  assert.equal(await waitForChildClose(exitedNotClosed, 5), false, "exit alone cannot confirm stdio cleanup");
  setTimeout(() => exitedNotClosed.emit("close", 0, null), 10);
  assert.deepEqual(await terminate(exitedNotClosed, "SIGTERM", { termTimeoutMs: 100 }), { cleanupConfirmed: true, forced: false });
  const neverClosed = trackChildClose(new FakeChild("missing-close"));
  neverClosed.exitCode = 0;
  await assert.rejects(terminate(neverClosed, "SIGTERM", { termTimeoutMs: 5, killTimeoutMs: 5 }), /did not close/);
  const real = trackChildClose(spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "pipe"] }));
  try {
    await once(real.stdout, "data");
    assert.deepEqual(await terminate(real, "SIGTERM", { termTimeoutMs: 20, killTimeoutMs: 2000 }), { cleanupConfirmed: true, forced: true });
    assert.equal(real.signalCode, "SIGKILL");
    assert.equal(real.stdout.destroyed, true);
    assert.equal(real.stderr.destroyed, true);
    assert.throws(() => process.kill(real.pid, 0), { code: "ESRCH" });
  } finally {
    if (real.exitCode === null && !real.signalCode) real.kill("SIGKILL");
  }
  console.log(JSON.stringify({ ok: true, runnerExitCodePropagated: 7, tunnelCleaned: true, networkUsed: false }));
}

run().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
