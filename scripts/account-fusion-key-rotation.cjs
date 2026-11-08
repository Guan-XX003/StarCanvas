const assert = require("node:assert/strict");

const keyActionFormWaitExpression = (confirmText) => `(() => {
  const page = document.querySelector('.wanjuan-account-settings-page');
  const input = page?.querySelector('.wanjuan-account-inline-form input[placeholder="输入验证码"]');
  const confirm = [...(page?.querySelectorAll('button') || [])].find((button) => (button.textContent || '').includes(${JSON.stringify(confirmText)}));
  const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects?.().length));
  return visible(input) && !input.disabled && visible(confirm);
})()`;
const KEY_REVEAL_FORM_WAIT_EXPRESSION = keyActionFormWaitExpression("查看60秒");
const KEY_ROTATION_FORM_WAIT_EXPRESSION = keyActionFormWaitExpression("确认重新生成");
const KEY_ROTATION_SUBMIT_WAIT_EXPRESSION = `(() => {
  const page = document.querySelector('.wanjuan-account-settings-page');
  const button = [...(page?.querySelectorAll('button') || [])].find((item) => (item.textContent || '').includes('确认重新生成'));
  return Boolean(button && !button.disabled);
})()`;
const KEY_ROTATION_DIAGNOSTIC_EXPRESSION = `(() => {
  const page = document.querySelector('.wanjuan-account-settings-page');
  const input = page?.querySelector('.wanjuan-account-inline-form input[placeholder="输入验证码"]');
  const confirm = [...(page?.querySelectorAll('button') || [])].find((item) => (item.textContent || '').includes('确认重新生成'));
  const toast = document.querySelector('.wanjuan-toast, .wanjuan-account-toast')?.textContent || '';
  return {inputPresent: Boolean(input), codeFilled: Boolean(input && /^\\d{6}$/.test(input.value)),
    confirmPresent: Boolean(confirm), confirmDisabled: Boolean(confirm?.disabled),
    toastClass: /频繁|稍后|rate/i.test(toast) ? 'rate_limited' : /验证码|verification/i.test(toast) ? 'verification' : /失败|错误|error|fail/i.test(toast) ? 'failure' : toast ? 'other' : 'none'};
})()`;

async function runAccountFusionKeyRotation({ ui, email, resolveOtp, checkpoint, sleep, now = Date.now, results }) {
  const rotateButtonEnabled = await ui.evaluate(`Array.from(document.querySelectorAll('.wanjuan-account-settings-page button')).some((button) => (button.textContent || '').trim() === '重新生成' && !button.disabled)`);
  checkpoint("auth-rotate-cooldown-start", { stage: "cooldown-start", keyReveal: results.keyReveal === true, rotateButtonEnabled: rotateButtonEnabled === true });
  await sleep();
  checkpoint("auth-rotate-cooldown-complete", { stage: "cooldown-complete", rotateButtonEnabled: rotateButtonEnabled === true });
  const rotateIssuedAfter = now();
  assert.equal(await ui.clickText("重新生成", ".wanjuan-account-settings-page button"), true);
  checkpoint("auth-rotate-click", { stage: "rotate-click", clicked: true });
  await ui.waitFor(KEY_ROTATION_FORM_WAIT_EXPRESSION, "Key 轮换验证码");
  const rotateRequestCompletedAt = now();
  checkpoint("auth-rotate-form", { stage: "rotate-form", formVisible: true });
  const rotateOtp = await resolveOtp({ email, purpose: "relay_key_rotate", issuedAfter: rotateIssuedAfter });
  checkpoint("auth-rotate-otp-resolved", { stage: "otp-resolved", otpResolved: Boolean(rotateOtp) });
  assert.equal(await ui.fill('.wanjuan-account-settings-page input[placeholder="输入验证码"]', rotateOtp), true);
  try {
    await ui.waitFor(KEY_ROTATION_SUBMIT_WAIT_EXPRESSION, "Key 轮换提交按钮");
    checkpoint("auth-rotate-submit", { stage: "rotate-submit", formFilled: true, submitEnabled: true });
    assert.equal(await ui.clickText("确认重新生成", ".wanjuan-account-settings-page button"), true);
    await ui.waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('新 Key 已生效，旧 Key 已失效')", "Key 轮换结果");
  } catch (error) {
    try {
      const safe = await ui.evaluate(KEY_ROTATION_DIAGNOSTIC_EXPRESSION);
      checkpoint("auth-rotate-diagnostics", {
        inputPresent: safe?.inputPresent === true, codeFilled: safe?.codeFilled === true,
        confirmPresent: safe?.confirmPresent === true, confirmDisabled: safe?.confirmDisabled === true,
        toastClass: ['rate_limited','verification','failure','other','none'].includes(safe?.toastClass) ? safe.toastClass : 'none',
      });
    } catch {}
    throw error;
  }
  results.keyRotate = true;
  const rotateCompletedAt = now();
  checkpoint("auth-key-rotate", { stage: "rotate-result", resultObserved: true });
  return { rotateIssuedAfter, rotateRequestCompletedAt, rotateCompletedAt };
}

async function waitForAccountFusionIdentifierCooldown({ checkpoint, sleep, now = Date.now, requestCompletedAt, cooldownMs, prefix = "auth-login" }) {
  const safePrefix = prefix === "reset" ? "reset" : "auth-login";
  checkpoint(`${safePrefix}-cooldown-start`, { stage: `${safePrefix}-cooldown-start`, cooldownRequired: true });
  const remainingMs = Math.max(0, Number(cooldownMs || 0) - Math.max(0, now() - Number(requestCompletedAt || 0)));
  if (remainingMs > 0) await sleep(remainingMs);
  checkpoint(`${safePrefix}-cooldown-complete`, { stage: `${safePrefix}-cooldown-complete`, cooldownComplete: true });
  return remainingMs;
}

module.exports = { KEY_REVEAL_FORM_WAIT_EXPRESSION, KEY_ROTATION_FORM_WAIT_EXPRESSION, KEY_ROTATION_SUBMIT_WAIT_EXPRESSION, keyActionFormWaitExpression, runAccountFusionKeyRotation, waitForAccountFusionIdentifierCooldown };
