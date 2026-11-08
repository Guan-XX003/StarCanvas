#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { KEY_REVEAL_FORM_WAIT_EXPRESSION, KEY_ROTATION_FORM_WAIT_EXPRESSION, KEY_ROTATION_SUBMIT_WAIT_EXPRESSION, runAccountFusionKeyRotation, waitForAccountFusionIdentifierCooldown } = require("./account-fusion-key-rotation.cjs");

async function run() {
  const componentSource = fs.readFileSync(path.join(__dirname, "..", "src/renderer/components/account-relay-wallet.tsx"), "utf8");
  assert.equal(componentSource.includes('placeholder="输入验证码"'), true);
  assert.equal(componentSource.includes('确认重新生成'), true);
  const visibleInput = { placeholder: "输入验证码", offsetWidth: 120, offsetHeight: 24, disabled: false, getClientRects: () => [{}] };
  const visibleButton = { textContent: "确认重新生成", offsetWidth: 120, offsetHeight: 24, disabled: true, getClientRects: () => [{}] };
  const page = {
    querySelector: (selector) => selector === '.wanjuan-account-inline-form input[placeholder="输入验证码"]' ? visibleInput : null,
    querySelectorAll: (selector) => selector === "button" ? [visibleButton] : [],
  };
  const evaluateWaitPredicate = (expression, input = visibleInput, button = visibleButton) => {
    const testPage = { querySelector: (selector) => selector === '.wanjuan-account-inline-form input[placeholder="输入验证码"]' ? input : null, querySelectorAll: (selector) => selector === "button" ? [button] : [] };
    return new Function("document", `return ${expression};`)({ querySelector: () => testPage });
  };
  assert.equal(evaluateWaitPredicate(KEY_ROTATION_FORM_WAIT_EXPRESSION), true);
  assert.equal(evaluateWaitPredicate(KEY_ROTATION_FORM_WAIT_EXPRESSION, { ...visibleInput, offsetWidth: 0, offsetHeight: 0, getClientRects: () => [] }), false);
  assert.equal(evaluateWaitPredicate(KEY_ROTATION_FORM_WAIT_EXPRESSION, visibleInput, { ...visibleButton, textContent: "取消" }), false);
  assert.equal(evaluateWaitPredicate(KEY_REVEAL_FORM_WAIT_EXPRESSION, visibleInput, { ...visibleButton, textContent: "查看60秒（剩余）" }), true);
  assert.equal(new Function("document", `return ${KEY_ROTATION_SUBMIT_WAIT_EXPRESSION};`)({ querySelector: () => ({ querySelectorAll: () => [{ textContent: "确认重新生成", disabled: false }] }) }), true);
  assert.equal(new Function("document", `return ${KEY_ROTATION_SUBMIT_WAIT_EXPRESSION};`)({ querySelector: () => ({ querySelectorAll: () => [{ textContent: "确认重新生成", disabled: true }] }) }), false);
  const events = [];
  const checkpoints = [];
  const results = { keyReveal: true, keyRotate: false };
  const ui = {
    evaluate: async () => { events.push("button-enabled"); return true; },
    clickText: async (text) => { events.push(text === "重新生成" ? "rotate-click" : "confirm-click"); return true; },
    waitFor: async (_expression, label) => { events.push(label === "Key 轮换验证码" ? "form-visible" : label === "Key 轮换提交按钮" ? "submit-enabled" : "result-visible"); },
    fill: async () => { events.push("otp-fill"); return true; },
  };
  let clock = 1_800_000_000_000;
  let resolvedIssuedAfter = 0;
  const timing = await runAccountFusionKeyRotation({
    ui, email: "synthetic@example.test", results,
    resolveOtp: async ({ purpose, issuedAfter }) => { assert.equal(purpose, "relay_key_rotate"); resolvedIssuedAfter = issuedAfter; events.push("otp-resolved"); return "000000"; },
    checkpoint: (name, value) => checkpoints.push({ name, ...value }),
    sleep: async () => events.push("cooldown"),
    now: () => { events.push(clock === 1_800_000_000_000 ? "issued-after" : "request-complete"); return clock++; },
  });
  assert.equal(results.keyRotate, true);
  assert.deepEqual(events, ["button-enabled", "cooldown", "issued-after", "rotate-click", "form-visible", "request-complete", "otp-resolved", "otp-fill", "submit-enabled", "confirm-click", "result-visible", "request-complete"]);
  assert.equal(resolvedIssuedAfter, timing.rotateIssuedAfter);
  assert.equal(timing.rotateIssuedAfter < timing.rotateRequestCompletedAt, true);
  assert.equal(timing.rotateRequestCompletedAt < timing.rotateCompletedAt, true);
  assert.deepEqual(checkpoints.map((item) => item.name), [
    "auth-rotate-cooldown-start", "auth-rotate-cooldown-complete", "auth-rotate-click", "auth-rotate-form",
    "auth-rotate-otp-resolved", "auth-rotate-submit", "auth-key-rotate",
  ]);
  assert.equal(JSON.stringify(checkpoints).includes("000000"), false);
  assert.equal(JSON.stringify(checkpoints).includes("synthetic@example.test"), false);
  const loginCooldownCheckpoints = [];
  let waitedMs = -1;
  const remaining = await waitForAccountFusionIdentifierCooldown({
    checkpoint: (name, value) => loginCooldownCheckpoints.push({ name, ...value }),
    sleep: async (ms) => { waitedMs = ms; },
    now: () => timing.rotateCompletedAt + 1_000,
    requestCompletedAt: timing.rotateCompletedAt,
    cooldownMs: 60_500,
  });
  assert.equal(remaining, 59_500);
  assert.equal(waitedMs, 59_500);
  assert.deepEqual(loginCooldownCheckpoints.map((item) => item.name), ["auth-login-cooldown-start", "auth-login-cooldown-complete"]);
  const resetCooldownCheckpoints = [];
  let resetWaitedMs = -1;
  await waitForAccountFusionIdentifierCooldown({
    checkpoint: (name, value) => resetCooldownCheckpoints.push({ name, ...value }),
    sleep: async (ms) => { resetWaitedMs = ms; },
    now: () => timing.rotateCompletedAt,
    requestCompletedAt: timing.rotateCompletedAt,
    cooldownMs: 60_500,
    prefix: "reset",
  });
  assert.equal(resetWaitedMs, 60_500);
  assert.deepEqual(resetCooldownCheckpoints.map((item) => item.name), ["reset-cooldown-start", "reset-cooldown-complete"]);
  console.log(JSON.stringify({ ok: true, networkUsed: false, rotateClicks: 2, checkpoints: checkpoints.length + loginCooldownCheckpoints.length + resetCooldownCheckpoints.length }));
}
run().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
