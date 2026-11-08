#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const runnerSource = fs.readFileSync(path.join(__dirname, "test-account-fusion-real-candidate.cjs"), "utf8");
const runnerAndRotationSource = runnerSource + fs.readFileSync(path.join(__dirname, "account-fusion-key-rotation.cjs"), "utf8");
const {
  HELPER_PATH_ENV,
  HELPER_SECRET_FILE_ENV,
  HELPER_SECRET_CHILD_ENV,
  createAccountFusionOtpResolver,
  exactFixtureOtpAllowlist,
  sanitizeOtpHelperEnv,
  validateSecretFile,
} = require("./account-fusion-otp-helper.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-otp-helper-"));
const helperPath = path.join(root, "mailbox-helper.cjs");
const secretPath = path.join(root, "mailbox-secret");
const now = 1_800_000_000_000;

const fixture = {
  otp: { delivery: "isolated-mock-mailbox" },
  accounts: {
    registration: { email: "registration@example.test", initialPassword: "synthetic-registration-password" },
    authAndRedeem: { email: "auth@example.test", initialPassword: "synthetic-auth-password", resetPassword: "synthetic-reset-password" },
    legacyActive: { account: { email: "active@example.test", initialPassword: "synthetic-active-password" } },
    legacyReview: { account: { email: "review@example.test", initialPassword: "synthetic-review-password" } },
  },
};

async function run() {
try {
  fs.writeFileSync(secretPath, "synthetic-local-helper-secret\n", { mode: 0o600 });
  fs.writeFileSync(helperPath, `#!/usr/bin/env node
const fs=require('node:fs');
let input='';
process.stdin.on('data',chunk=>{ input+=String(chunk); });
process.stdin.on('end',()=>{
  if(process.env.WANJUAN_ACCOUNT_QA_OTP_HELPER || process.env.WANJUAN_ACCOUNT_QA_OTP_HELPER_SECRET_FILE || process.env.STARCANVAS_QA_OTP_HELPER_MASTER) process.exit(40);
  const secretFile=process.env.STARCANVAS_QA_OTP_HELPER_SECRET_FILE;
  if(!secretFile || fs.readFileSync(secretFile,'utf8').trim()!=='synthetic-local-helper-secret') process.exit(41);
  const request=JSON.parse(input);
  const issuedAt=request.purpose==='reset_password' ? request.issuedAfter-1 : request.purpose==='relay_key_rotate' ? ${now}+1 : request.issuedAfter+1;
  const expiresAt=request.purpose==='login' ? ${now}-1 : request.purpose==='relay_account_link' ? issuedAt : ${now}+60_000;
  const response=JSON.stringify({ok:true,code:'482731',email:request.email,purpose:request.purpose,issuedAt,expiresAt,deliveryId:'delivery-'+request.purpose+'-'+request.issuedAfter});
  process.stdout.write(request.purpose==='relay_key_reveal' ? response+'\\n'+response : response);
});
`, { mode: 0o700 });

  const env = {
    PATH: process.env.PATH,
    [HELPER_PATH_ENV]: helperPath,
    [HELPER_SECRET_FILE_ENV]: secretPath,
    STARCANVAS_QA_OTP_HELPER_MASTER: "must-not-leak",
  };
  const resolver = createAccountFusionOtpResolver({ fixture, env, now: () => now });
  assert.equal(resolver.mode, "isolated-mock-mailbox");
  assert.equal(
    await resolver.resolve({ email: fixture.accounts.registration.email, purpose: "register", issuedAfter: now - 1_000 }),
    "482731",
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.registration.email, purpose: "register", issuedAfter: now - 900 }),
    /reused code/,
  );
  await assert.rejects(
    resolver.resolve({ email: "unknown@example.test", purpose: "register", issuedAfter: now - 1_000 }),
    /exact fixture allowlist/,
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.authAndRedeem.email, purpose: "login", issuedAfter: now - 1_000 }),
    /expired delivery/,
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.authAndRedeem.email, purpose: "reset_password", issuedAfter: now - 1_000 }),
    /older delivery/,
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.authAndRedeem.email, purpose: "relay_key_rotate", issuedAfter: now - 1_000 }),
    /future delivery/,
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.legacyActive.account.email, purpose: "relay_account_link", issuedAfter: now - 1_000 }),
    /invalid delivery lifetime/,
  );
  await assert.rejects(
    resolver.resolve({ email: fixture.accounts.authAndRedeem.email, purpose: "relay_key_reveal", issuedAfter: now - 1_000 }),
    /invalid JSON/,
  );

  const secretLink = path.join(root, "mailbox-secret-link");
  fs.symlinkSync(secretPath, secretLink);
  assert.throws(() => validateSecretFile(secretLink), /symbolic link/);
  assert.throws(() => validateSecretFile(secretPath, { getuid: () => fs.lstatSync(secretPath).uid + 1 }), /owned by the runner user/);
  fs.chmodSync(secretPath, 0o200);
  assert.throws(() => validateSecretFile(secretPath), /owner-readable/);
  fs.chmodSync(secretPath, 0o604);
  assert.throws(() => validateSecretFile(secretPath), /owner-only/);
  fs.chmodSync(secretPath, 0o600);
  assert.deepEqual(validateSecretFile(secretPath), {
    ownerVerified: true,
    permissionsVerified: true,
    reason: "posix-owner-readable-owner-only",
  });
  assert.deepEqual(validateSecretFile(secretPath, { platform: "win32" }), {
    ownerVerified: false,
    permissionsVerified: false,
    reason: "windows-acl-not-verified",
  });

  const fixed = createAccountFusionOtpResolver({ fixture: { otp: { delivery: "isolated-fixed-code", code: "193746" } } });
  assert.equal(await fixed.resolve({}), "193746");

  const allowlist = exactFixtureOtpAllowlist(fixture);
  assert.equal(allowlist.has("registration@example.test\nregister"), true);
  assert.equal(allowlist.has("auth@example.test\nregister"), false);
  assert.equal(allowlist.has("active@example.test\nlogin"), true);
  assert.equal(allowlist.has("review@example.test\nlogin"), true);
  assert.equal(allowlist.has("active@example.test\nregister"), false);
  assert.equal(allowlist.has("review@example.test\nregister"), false);
  const rendererEnv = sanitizeOtpHelperEnv(env);
  assert.equal(HELPER_PATH_ENV in rendererEnv, false);
  assert.equal(HELPER_SECRET_FILE_ENV in rendererEnv, false);
  assert.equal(HELPER_SECRET_CHILD_ENV in rendererEnv, false);
  assert.equal("STARCANVAS_QA_OTP_HELPER_MASTER" in rendererEnv, false);
  for (const requiredRunnerMarker of [
    'purpose: "relay_key_reveal"',
    'purpose: "relay_key_rotate"',
    'results.keyReveal = true',
    'results.keyRotate = true',
    'results.languages = true',
    'IDENTIFIER_CODE_COOLDOWN_MS = 60_500',
    'await sleep(IDENTIFIER_CODE_COOLDOWN_MS)',
    'requiredResultKeys.has(key)',
    "验证码已发送到当前账号邮箱",
    'registrationSubjectUnused === true',
    'await passwordLogin(ui, email, password)',
    '仅允许全新 schema2 nonRedeem fixture',
    'schema2 GUI 验收只接受随机 isolated-mock-mailbox',
    'schema2 nonRedeem GUI 验收必须且只能按 auth,active,review,reset 执行，reset 严格最后',
    'WANJUAN_ACCOUNT_QA_OUTPUT_DIR 必须为空',
    '真实候选 GUI runner 拒绝 WANJUAN_ACCOUNT_FUSION_PREVIEW',
    'probePublicCapabilities()',
    'AbortSignal.timeout(10_000)',
    'capabilityProbeReady(capabilityProbe)',
    'not_started_preflight_blocked',
    'capabilityRequest: capabilityProbe',
    'flags: capabilityFlags(mainResult?.featureFlags)',
    'passwordAuth: rendererState.passwordLoginToggle || rendererState.passwordInputVisible',
    'errorClass: "capability_entry_blocked"',
    'report-capability-entry-blocked.md',
    '".wanjuan-account-managed-relay-row strong"',
    'WANJUAN_ACCOUNT_QA_DRY_RUN',
    'ensureOwnerOnlyQaDirectory(qaRoot)',
    'WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT',
    '候选源码 hash verifier 未通过，拒绝启动 Electron',
    'AbortController()',
    'CDP 调用超时',
    'checkpoint-interrupted-terminal',
    'checkpoint-runner-failed.json',
    'report-runner-failed.md',
    'errorClass: "runner_failed"',
    'childStarted: childStarted === true',
    'safeCheckpoint(lastCheckpointName)',
    'requestCompletedAt: authIdentifierRequestCompletedAt || Date.now()',
    'prefix: "reset"',
    'atomicWriteJson(path.join(qaRoot, `checkpoint-${name}.json`)',
    'process.once("SIGTERM", onSigterm)',
  ]) {
    assert.equal(runnerAndRotationSource.includes(requiredRunnerMarker), true, `GUI runner missing ${requiredRunnerMarker}`);
  }
  assert.equal(/navigator\.clipboard|clipboard\.writeText|localStorage/.test(runnerSource), false, "GUI runner must not read/write clipboard or persist sensitive state");
  assert.equal(runnerSource.includes('clickText("复制 Key"'), false, "GUI runner must not copy a revealed Key");

  console.log("account fusion OTP helper boundary: passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
