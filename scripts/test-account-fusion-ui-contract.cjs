#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const candidateRoot = path.resolve(process.env.WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT || root);
const runner = fs.readFileSync(path.join(__dirname, "test-account-fusion-real-candidate.cjs"), "utf8");
const rotation = fs.readFileSync(path.join(__dirname, "account-fusion-key-rotation.cjs"), "utf8");
const accountGate = fs.readFileSync(path.join(candidateRoot, "src/renderer/components/account-gate.tsx"), "utf8");
const accountWallet = fs.readFileSync(path.join(candidateRoot, "src/renderer/components/account-relay-wallet.tsx"), "utf8");
const accountSettings = fs.readFileSync(path.join(candidateRoot, "src/renderer/components/settings-account-tab.tsx"), "utf8");
const i18n = fs.readFileSync(path.join(candidateRoot, "src/renderer/lib/i18n-deep-packs.json"), "utf8");

for (const label of ["登录 / 注册", "退出登录", "本地模式"]) assert.equal(accountSettings.includes(label), true, label);
// Sibling panels must reset on identity changes without sharing a React key.
assert.match(accountSettings, /<AccountRelayWallet key=\{`wallet:\$\{accountIdentityScopeKey\(account\)\}`\}/);
assert.match(accountSettings, /<CloudProjectPanel key=\{`cloud:\$\{accountIdentityScopeKey\(account\)\}`\}/);
for (const label of ["注册", "密码登录", "验证码登录", "获取验证码", "登录并继续", "注册并继续", "忘记密码", "重置密码", "密码已重置", "验证码已发送"]) {
  assert.equal(accountGate.includes(label), true, label);
}
for (const label of ["极鑫托管服务", "模型余额", "查看 Key", "重新生成", "查看60秒", "确认重新生成", "绑定原极鑫账号", "验证旧账号", "MFA 验证码", "验证 MFA", "当前账号邮箱", "确认绑定", "原极鑫账号已绑定", "需要人工审核"]) {
  assert.equal(accountWallet.includes(label), true, label);
}
for (const label of ["Jixin managed service", "極鑫託管服務"]) assert.equal(i18n.includes(label), true, label);
for (const label of ["历史记录", "原价信息未知", "导入的旧消费记录，不会再次扣款"]) assert.equal(accountWallet.includes(label), true, label);
for (const label of ["充值暂未开放", "正在查询充值状态", "重新查询充值状态"]) {
  assert.equal(accountWallet.includes(label), true, label);
  assert.equal(i18n.includes(`"${label}"`), true, `${label} translations`);
}
assert.match(accountWallet, /redeemUiEnabled && storeStatus === `available`/);
assert.match(accountWallet, /redeemUiEnabled && <div className="wanjuan-account-redeem-row"/);
assert.equal(accountWallet.includes('tab === `usage` && item.source === `legacy`'), true, "Only legacy usage rows get the historical label");
assert.equal(accountWallet.includes('item.priceKnown === false'), true, "Unknown historical prices must be labeled explicitly");
assert.equal(/innerText[^\n;]{0,240}输入验证码/.test(runner + rotation), false, "placeholder must not be tested through innerText");
assert.equal(rotation.includes('querySelector(\'.wanjuan-account-inline-form input[placeholder="输入验证码"]\')'), true);
assert.equal(rotation.includes("getClientRects"), true);
assert.equal(runner.includes("KEY_REVEAL_FORM_WAIT_EXPRESSION"), true);
assert.equal(rotation.includes("KEY_ROTATION_FORM_WAIT_EXPRESSION"), true);
console.log(JSON.stringify({ ok: true, placeholderInnerTextMisuse: 0, authSurfacesChecked: 5 }));
