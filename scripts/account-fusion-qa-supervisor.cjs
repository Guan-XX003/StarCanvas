#!/usr/bin/env node

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const childCloseStates = new WeakMap();

// Register immediately after spawn. exitCode/signalCode prove exit, not that
// inherited stdio handles have closed (a descendant may still hold a pipe).
function trackChildClose(child) {
  if (!child || childCloseStates.has(child)) return child;
  const state = { closed: false };
  childCloseStates.set(child, state);
  child.once("close", () => { state.closed = true; });
  return child;
}

async function waitForPort(port, host = "127.0.0.1", timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ port, host });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await sleep(100);
  }
  throw new Error("QA loopback tunnel did not become ready");
}

async function waitForChildClose(child, timeoutMs) {
  if (!child) return true;
  trackChildClose(child);
  if (childCloseStates.get(child).closed) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
}

async function terminate(child, signal = "SIGTERM", options = {}) {
  if (!child) return { cleanupConfirmed: true, forced: false };
  trackChildClose(child);
  if (childCloseStates.get(child).closed) return { cleanupConfirmed: true, forced: false };
  const termTimeoutMs = Number(options.termTimeoutMs || 3_000);
  const killTimeoutMs = Number(options.killTimeoutMs || 3_000);
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill(signal); } catch {}
  }
  if (await waitForChildClose(child, termTimeoutMs)) return { cleanupConfirmed: true, forced: false };
  if (child.exitCode === null && !child.signalCode) {
    try { child.kill("SIGKILL"); } catch {}
  }
  const cleanupConfirmed = await waitForChildClose(child, killTimeoutMs);
  if (!cleanupConfirmed) throw new Error("QA child did not close after SIGKILL");
  return { cleanupConfirmed: true, forced: true };
}

async function supervise({ spawnImpl = spawn, waitForPortImpl = waitForPort, env = process.env } = {}) {
  const port = Number(env.WANJUAN_ACCOUNT_QA_TUNNEL_PORT || 0);
  const target = String(env.WANJUAN_ACCOUNT_QA_SSH_TARGET || "").trim();
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("WANJUAN_ACCOUNT_QA_TUNNEL_PORT is invalid");
  if (!/^[A-Za-z0-9_.@-]+$/.test(target)) throw new Error("WANJUAN_ACCOUNT_QA_SSH_TARGET is invalid");
  if (!String(env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR || "").trim()) throw new Error("WANJUAN_ACCOUNT_QA_OUTPUT_DIR is required");
  if (!String(env.WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT || "").trim()) throw new Error("WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT is required");
  if (!/^[a-f0-9]{64}$/i.test(String(env.WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256 || ""))) throw new Error("WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256 is required");

  const tunnel = trackChildClose(spawnImpl("ssh", [
    "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
    "-N", "-L", `${port}:127.0.0.1:${port}`, target,
  ], { stdio: ["ignore", "ignore", "inherit"], env }));
  let runner = null;
  let stopPromise = null;
  let interruptedSignal = "";
  const stop = async (signal = "SIGTERM") => {
    if (!stopPromise) stopPromise = (async () => {
      await terminate(runner, signal);
      await terminate(tunnel, signal);
    })();
    await stopPromise;
  };
  const onSigint = () => { interruptedSignal = "SIGINT"; void stop("SIGINT"); };
  const onSigterm = () => { interruptedSignal = "SIGTERM"; void stop("SIGTERM"); };
  const onSighup = () => { interruptedSignal = "SIGHUP"; void stop("SIGHUP"); };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  process.once("SIGHUP", onSighup);
  try {
    await Promise.race([
      waitForPortImpl(port),
      new Promise((_, reject) => tunnel.once("exit", (code) => reject(new Error(`QA tunnel exited before ready (${code})`)))),
    ]);
    if (interruptedSignal) return { code: interruptedSignal === "SIGINT" ? 130 : 143, signal: interruptedSignal };
    runner = trackChildClose(spawnImpl(process.execPath, [path.join(__dirname, "test-account-fusion-real-candidate.cjs")], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env,
    }));
    const result = await new Promise((resolve, reject) => {
      runner.once("error", reject);
      runner.once("exit", (code, signal) => resolve({ code: Number(code ?? 1), signal: signal || "" }));
    });
    if (interruptedSignal) return { code: 128 + (interruptedSignal === "SIGINT" ? 2 : 15), signal: interruptedSignal };
    return result;
  } catch (error) {
    if (interruptedSignal) return { code: interruptedSignal === "SIGINT" ? 130 : 143, signal: interruptedSignal };
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("SIGHUP", onSighup);
    await stop();
  }
}

if (require.main === module) {
  supervise().then(({ code }) => { process.exitCode = code; }).catch((error) => {
    console.error(JSON.stringify({ ok: false, errorClass: "qa_supervisor_failed", message: String(error?.message || error) }));
    process.exitCode = 1;
  });
}

module.exports = { supervise, terminate, trackChildClose, waitForChildClose, waitForPort };
