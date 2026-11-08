#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { atomicWriteBuffer, claimOwnerMarker, restoreWritableForCleanup } = require("./account-fusion-qa-io.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-qa-runner-boundary-"));
const fixture = path.join(root, "APP-QA-FIXTURES.json");
const helper = path.join(root, "otp-helper");
const secret = path.join(root, "otp-secret");
const evidence = path.join(root, "evidence");
const candidate = path.join(root, "candidate");
try {
  fs.mkdirSync(path.join(candidate, "electron"), { recursive: true });
  fs.mkdirSync(path.join(candidate, "dist"), { recursive: true });
  const sourceRoot = path.resolve(__dirname, "..");
  const packageValue = fs.readFileSync(path.join(sourceRoot, "package.json"));
  const lockValue = fs.readFileSync(path.join(sourceRoot, "package-lock.json"));
  fs.writeFileSync(path.join(candidate, "package.json"), packageValue);
  fs.writeFileSync(path.join(candidate, "package-lock.json"), lockValue);
  fs.writeFileSync(path.join(candidate, "electron", "synthetic.cjs"), "module.exports = {};\n");
  fs.writeFileSync(path.join(candidate, "dist", "index.html"), "<!doctype html><title>synthetic</title>\n");
  fs.writeFileSync(path.join(candidate, "ACCOUNT-FUSION-CANDIDATE.patch"), "");
  const baseHead = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const manifestSource = spawnSync("git", ["-C", sourceRoot, "show", `${baseHead}:.gitignore`]).stdout;
  fs.writeFileSync(path.join(candidate, ".gitignore"), manifestSource);
  const fileSha = crypto.createHash("sha256").update(manifestSource).digest("hex");
  const tree = crypto.createHash("sha256");
  tree.update(Buffer.from(`FILE\0.gitignore\0BASE\0${fileSha}\0CANDIDATE\0${manifestSource.length}\0`));
  tree.update(manifestSource);
  tree.update(Buffer.from("\0"));
  const contentTreeSha256 = tree.digest("hex");
  fs.writeFileSync(path.join(candidate, "ACCOUNT-FUSION-CANDIDATE-MANIFEST.json"), JSON.stringify({
    schemaVersion: 2,
    baseHead,
    candidatePath: candidate,
    sourceFiles: [{ path: ".gitignore", newInBase: false, baseSha256: fileSha, candidateSha256: fileSha, bytes: manifestSource.length, binary: false }],
    fileCount: 1,
    patchSha256: crypto.createHash("sha256").update("").digest("hex"),
    patchBytes: 0,
    contentTreeSha256,
  }));
  fs.writeFileSync(helper, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  fs.writeFileSync(secret, "synthetic-secret-not-read\n", { mode: 0o600 });
  fs.writeFileSync(fixture, JSON.stringify({
    schemaVersion: 2,
    lifecycle: { singleUse: true, status: "handoff-ready", resetMustRunLast: true },
    generatedAt: "synthetic-generated-at",
    accountBaseUrl: "http://127.0.0.1:9",
    otp: { delivery: "isolated-mock-mailbox" },
    provisioning: { registrationSubjectUnused: true, nonRedeemReady: true },
    accounts: {
      registration: { email: "synthetic-register@example.test", initialPassword: "synthetic-password" },
      authAndRedeem: { email: "synthetic-auth@example.test", initialPassword: "synthetic-password", resetPassword: "synthetic-reset" },
      legacyActive: { account: { email: "synthetic-active@example.test", initialPassword: "synthetic-password" } },
      legacyReview: { account: { email: "synthetic-review@example.test", initialPassword: "synthetic-password" } },
    },
  }));
  const result = spawnSync(process.execPath, [path.join(__dirname, "test-account-fusion-real-candidate.cjs")], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      WANJUAN_ACCOUNT_QA_FIXTURE: fixture,
      WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT: candidate,
      WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256: contentTreeSha256,
      WANJUAN_ACCOUNT_QA_OUTPUT_DIR: evidence,
      WANJUAN_ACCOUNT_QA_SCENARIOS: "auth,active,review,reset",
      WANJUAN_ACCOUNT_QA_OTP_HELPER: helper,
      WANJUAN_ACCOUNT_QA_OTP_HELPER_SECRET_FILE: secret,
      WANJUAN_ACCOUNT_QA_DRY_RUN: "1",
      WANJUAN_ACCOUNT_FUSION_PREVIEW: "",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = path.join(evidence, "real-candidate-state.json");
  const checkpoint = path.join(evidence, "checkpoint-dry-run-preflight.json");
  const report = path.join(evidence, "report-dry-run.md");
  for (const file of [state, checkpoint, report]) assert.equal(fs.existsSync(file), true, file);
  assert.equal(fs.statSync(evidence).mode & 0o077, 0);
  for (const file of [state, checkpoint, report]) assert.equal(fs.statSync(file).mode & 0o077, 0, file);
  assert.equal(fs.readFileSync(report, "utf8").includes("Electron launched: no"), true);
  assert.equal(result.stdout.includes('"dryRun":true'), true);
  const durableTarget = path.join(evidence, "durable.txt");
  const originalFsync = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error("synthetic fsync failure"); };
  assert.throws(() => atomicWriteBuffer(durableTarget, Buffer.from("x")), /durability failed/);
  fs.fsyncSync = originalFsync;
  assert.equal(fs.existsSync(durableTarget), false, "fsync failure must not leave an uncommitted temp target");
  let fsyncCount = 0;
  fs.fsyncSync = (...args) => {
    fsyncCount += 1;
    if (fsyncCount === 2) throw new Error("synthetic directory fsync failure");
    return originalFsync(...args);
  };
  assert.throws(() => atomicWriteBuffer(durableTarget, Buffer.from("x")), /directory durability failed/);
  fs.fsyncSync = originalFsync;
  assert.equal(fs.existsSync(durableTarget), true, "renamed evidence may exist but directory fsync failure must still fail closed");
  const frozenTree = path.join(root, "frozen-tree");
  fs.mkdirSync(path.join(frozenTree, "nested"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(frozenTree, "nested", "asset.txt"), "asset\n", { mode: 0o444 });
  fs.symlinkSync(path.join(root, "external-target"), path.join(frozenTree, "external-link"), "dir");
  fs.mkdirSync(path.join(root, "external-target"), { mode: 0o700 });
  fs.chmodSync(path.join(frozenTree, "nested"), 0o555);
  fs.chmodSync(frozenTree, 0o555);
  restoreWritableForCleanup(frozenTree);
  assert.equal((fs.statSync(path.join(frozenTree, "nested")).mode & 0o777), 0o700);
  assert.equal((fs.statSync(path.join(frozenTree, "nested", "asset.txt")).mode & 0o777), 0o600);
  assert.equal(fs.lstatSync(path.join(frozenTree, "external-link")).isSymbolicLink(), true);
  const ownerMarker = path.join(root, "exclusive-owner.json");
  claimOwnerMarker(ownerMarker, { schemaVersion: 1, ownerToken: "first" });
  assert.throws(() => claimOwnerMarker(ownerMarker, { schemaVersion: 1, ownerToken: "second" }), /EEXIST/);
  assert.equal(JSON.parse(fs.readFileSync(ownerMarker, "utf8")).ownerToken, "first");
  const failureEvidence = path.join(root, "failure-evidence");
  const failureResult = spawnSync(process.execPath, [path.join(__dirname, "test-account-fusion-real-candidate.cjs")], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    env: {
      ...process.env,
      WANJUAN_ACCOUNT_QA_FIXTURE: fixture,
      WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT: candidate,
      WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256: "0".repeat(64),
      WANJUAN_ACCOUNT_QA_OUTPUT_DIR: failureEvidence,
      WANJUAN_ACCOUNT_QA_SCENARIOS: "auth,active,review,reset",
      WANJUAN_ACCOUNT_QA_OTP_HELPER: helper,
      WANJUAN_ACCOUNT_QA_OTP_HELPER_SECRET_FILE: secret,
      WANJUAN_ACCOUNT_QA_DRY_RUN: "",
      WANJUAN_ACCOUNT_QA_TEST_THROW_AFTER_PREFLIGHT: "1",
      WANJUAN_ACCOUNT_FUSION_PREVIEW: "",
    },
  });
  assert.equal(failureResult.status, 1);
  assert.equal(JSON.parse(failureResult.stderr.trim()).errorClass, "runner_preflight_failed", failureResult.stderr);
  assert.equal(fs.existsSync(path.join(failureEvidence, "checkpoint-runner-preflight-failed.json")), true);
  assert.equal(fs.existsSync(path.join(failureEvidence, "report-runner-preflight-failed.md")), true);
  assert.equal(fs.readFileSync(path.join(failureEvidence, "report-runner-preflight-failed.md"), "utf8").includes("synthetic QA failure"), false);
  const checkpointFailureEvidence = path.join(root, "checkpoint-failure-evidence");
  const checkpointFailureResult = spawnSync(process.execPath, [path.join(__dirname, "test-account-fusion-real-candidate.cjs")], {
    cwd: path.resolve(__dirname, ".."), encoding: "utf8",
    env: {
      ...process.env,
      WANJUAN_ACCOUNT_QA_FIXTURE: fixture,
      WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT: candidate,
      WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256: contentTreeSha256,
      WANJUAN_ACCOUNT_QA_OUTPUT_DIR: checkpointFailureEvidence,
      WANJUAN_ACCOUNT_QA_SCENARIOS: "auth,active,review,reset",
      WANJUAN_ACCOUNT_QA_OTP_HELPER: helper,
      WANJUAN_ACCOUNT_QA_OTP_HELPER_SECRET_FILE: secret,
      WANJUAN_ACCOUNT_QA_DRY_RUN: "",
      WANJUAN_ACCOUNT_QA_TEST_THROW_AFTER_CHECKPOINTS: "1",
      WANJUAN_ACCOUNT_FUSION_PREVIEW: "",
    },
  });
  assert.equal(checkpointFailureResult.status, 1);
  assert.equal(JSON.parse(checkpointFailureResult.stderr.trim()).errorClass, "runner_failed", checkpointFailureResult.stderr);
  const failureCheckpoint = JSON.parse(fs.readFileSync(path.join(checkpointFailureEvidence, "checkpoint-runner-failed.json"), "utf8"));
  assert.equal(fs.existsSync(path.join(checkpointFailureEvidence, "checkpoint-auth-password-login.json")), true);
  assert.equal(fs.existsSync(path.join(checkpointFailureEvidence, "checkpoint-auth-key-reveal.json")), true);
  assert.deepEqual(failureCheckpoint, {
    status: "failed",
    errorClass: "runner_failed",
    lastCheckpoint: "auth-key-reveal",
    stage: "auth:cooldown-start",
    childStarted: false,
    sensitiveValues: "omitted",
    failureKind: "unclassified",
  });
  assert.equal(fs.existsSync(path.join(checkpointFailureEvidence, "report-runner-failed.md")), true);
  for (const file of [".runner-owner.json", "checkpoint-runner-failed.json", "report-runner-failed.md"]) {
    assert.equal(fs.statSync(path.join(checkpointFailureEvidence, file)).mode & 0o077, 0, file);
  }
  assert.equal(fs.readFileSync(path.join(checkpointFailureEvidence, "report-runner-failed.md"), "utf8").includes("synthetic post-checkpoint QA failure"), false);
  console.log(JSON.stringify({ ok: true, dryRun: true, electronLaunched: false, businessRequests: 0, evidenceMode: "0700", artifactMode: "0600" }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
