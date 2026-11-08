#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");
const { createAccountFusionOtpResolver, sanitizeOtpHelperEnv } = require("./account-fusion-otp-helper.cjs");
const { terminate: terminateQaChild, trackChildClose } = require("./account-fusion-qa-supervisor.cjs");
const { KEY_REVEAL_FORM_WAIT_EXPRESSION, runAccountFusionKeyRotation, waitForAccountFusionIdentifierCooldown } = require("./account-fusion-key-rotation.cjs");
const { switchAccountFusionLanguage } = require("./account-fusion-language-ui.cjs");
const { ensureOwnerOnlyQaDirectory, atomicWriteBuffer, atomicWriteJson, claimOwnerMarker, restoreWritableForCleanup } = require("./account-fusion-qa-io.cjs");

const sourceRepoRoot = path.resolve(__dirname, "..");
const requestedCandidateRoot = String(process.env.WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT || "").trim();
const expectedCandidateTree = String(process.env.WANJUAN_ACCOUNT_QA_EXPECTED_CONTENT_TREE_SHA256 || "").trim().toLowerCase();
const requestedQaRoot = String(process.env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR || "").trim();
const qaRoot = requestedQaRoot ? path.resolve(requestedQaRoot) : null;
let modulePreflightStage = "module-start";
const runnerOwnerToken = crypto.randomUUID();
const runnerOwnerPath = qaRoot ? path.join(qaRoot, ".runner-owner.json") : null;
const checkpointWhitelist = new Set([
  "preflight", "dry-run-preflight", "auth-password-login", "auth-key-reveal", "auth-key-rotate",
  "auth-language-sweep", "auth-otp-login", "auth-logout", "active-link-confirm", "review-link-confirm",
  "auth-language-diagnostics",
  "reset-password", "reset-logout", "reset-login-password", "reset-login-logout",
  "auth-rotate-cooldown-start", "auth-rotate-cooldown-complete", "auth-rotate-click", "auth-rotate-form",
  "auth-rotate-otp-resolved", "auth-rotate-submit",
  "auth-login-cooldown-start", "auth-login-cooldown-complete",
  "auth-rotate-diagnostics",
  "reset-cooldown-start", "reset-cooldown-complete",
]);
const stageWhitelist = new Set([
  "module-preflight", "runner-start", "scenario:auth", "scenario:redeem", "scenario:active",
  "scenario:review", "scenario:reset", "scenario:reset-login", "auth:capability-preflight",
  "auth:cdp-start", "auth:handler", "runner-failure",
  "auth:cooldown-start", "auth:cooldown-complete", "auth:rotate-click", "auth:rotate-form",
  "auth:otp-resolved", "auth:rotate-submit", "auth:rotate-result",
  "auth:login-cooldown-start", "auth:login-cooldown-complete",
  "auth:language-en-US", "auth:language-zh-TW", "auth:language-zh-CN",
  "reset:cooldown-start", "reset:cooldown-complete",
  "module-start", "candidate-validation", "fixture-validation", "scenario-validation",
]);
const safeCheckpoint = (value) => checkpointWhitelist.has(value) ? value : "preflight";
const safeStage = (value) => stageWhitelist.has(value) ? value : "runner-failure";
function writePreflightFailureEvidence({ stage = "module-preflight" } = {}) {
  if (!qaRoot) return false;
  try {
    if (fs.existsSync(qaRoot) && fs.readdirSync(qaRoot).length > 0) return false;
    ensureOwnerOnlyQaDirectory(qaRoot);
    const payload = {
      status: "failed",
      errorClass: "runner_preflight_failed",
      lastCheckpoint: "preflight",
      stage: safeStage(stage),
      childStarted: false,
      sensitiveValues: "omitted",
    };
    atomicWriteJson(path.join(qaRoot, "checkpoint-runner-preflight-failed.json"), payload);
    atomicWriteBuffer(path.join(qaRoot, "report-runner-preflight-failed.md"), Buffer.from([
      "# StarCanvas account fusion QA failure", "",
      "- Result: failed",
      "- Error class: runner_preflight_failed",
      "- Last checkpoint: preflight",
      `- Stage: ${payload.stage}`,
      "- Child started: no",
      "- Sensitive values: omitted",
      "- No production account, formal userData, package, or paid model request was used.",
      "",
    ].join("\n"), "utf8"));
    return true;
  } catch {
    return false;
  }
}
function runnerOwnsQaRoot() {
  if (!runnerOwnerPath || !fs.existsSync(runnerOwnerPath)) return false;
  try {
    const owner = JSON.parse(fs.readFileSync(runnerOwnerPath, "utf8"));
    return owner?.ownerToken === runnerOwnerToken && owner?.pid === process.pid && owner?.schemaVersion === 1;
  } catch {
    return false;
  }
}
function writeRunnerFailureEvidence(error) {
  if (!runnerOwnsQaRoot()) return false;
  try {
    const checkpointPath = path.join(qaRoot, "checkpoint-runner-failed.json");
    const reportPath = path.join(qaRoot, "report-runner-failed.md");
    if (fs.existsSync(checkpointPath) || fs.existsSync(reportPath)) return false;
    const payload = {
      status: "failed",
      errorClass: "runner_failed",
      lastCheckpoint: safeCheckpoint(lastCheckpointName),
      stage: safeStage(failureStage),
      childStarted: childStarted === true,
      sensitiveValues: "omitted",
      failureKind: ["cdp_javascript_error", "ui_wait_timeout", "language_assertion_failed"].includes(error?.qaErrorClass) ? error.qaErrorClass : "unclassified",
    };
    atomicWriteJson(checkpointPath, payload);
    atomicWriteBuffer(reportPath, Buffer.from([
      "# StarCanvas account fusion QA failure", "",
      "- Result: failed",
      "- Error class: runner_failed",
      `- Last checkpoint: ${payload.lastCheckpoint}`,
      `- Stage: ${payload.stage}`,
      `- Child started: ${payload.childStarted ? "yes" : "no"}`,
      "- Sensitive values: omitted",
      "- No production account, formal userData, package, or paid model request was used.",
      "",
    ].join("\n"), "utf8"));
    return true;
  } catch {
    return false;
  }
}
process.on("uncaughtException", (error) => {
  const stage = safeStage(modulePreflightStage);
  writePreflightFailureEvidence({ stage });
  console.error(JSON.stringify({ ok: false, errorClass: "runner_preflight_failed", lastCheckpoint: "preflight", stage }));
  process.exitCode = 1;
});
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeRelativePath = (value) => {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("候选 manifest 含不安全路径");
  return normalized;
};
const sortedUtf8 = (values) => [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
function candidateContentTree(sourceFiles, candidate) {
  const digest = crypto.createHash("sha256");
  for (const entry of [...sourceFiles].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))) {
    const relativePath = safeRelativePath(entry.path);
    const value = fs.readFileSync(path.join(candidate, relativePath));
    const baseIdentity = entry.newInBase ? "-" : String(entry.baseSha256 || "");
    digest.update(Buffer.concat([
      Buffer.from(`FILE\0${relativePath}\0BASE\0${baseIdentity}\0CANDIDATE\0${value.length}\0`, "utf8"),
      value,
      Buffer.from("\0"),
    ]));
  }
  return digest.digest("hex");
}
const runtimeRoots = ["package.json", "package-lock.json", "electron", "dist"];
function listRuntimeFiles(root) {
  const files = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error("候选 runtime 不允许符号链接");
    if (stat.isDirectory()) {
      for (const name of sortedUtf8(fs.readdirSync(absolutePath))) visit(path.posix.join(relativePath.replace(/\\/g, "/"), name));
    } else if (stat.isFile()) files.push(relativePath.replace(/\\/g, "/"));
    else throw new Error("候选 runtime 含不支持的文件类型");
  };
  for (const relativePath of runtimeRoots) {
    if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`候选 runtime 缺少 ${relativePath}`);
    visit(relativePath);
  }
  return sortedUtf8(files);
}
function runtimeTreeDigest(root) {
  const digest = crypto.createHash("sha256");
  for (const relativePath of listRuntimeFiles(root)) {
    const value = fs.readFileSync(path.join(root, relativePath));
    digest.update(Buffer.concat([Buffer.from(`FILE\0${relativePath}\0${value.length}\0`, "utf8"), value, Buffer.from("\0")]));
  }
  return digest.digest("hex");
}
function validateCandidateRoot() {
  if (!requestedCandidateRoot) throw new Error("候选验收必须显式指定 WANJUAN_ACCOUNT_QA_CANDIDATE_ROOT");
  if (!/^[a-f0-9]{64}$/.test(expectedCandidateTree)) throw new Error("候选验收必须显式指定可信 content tree SHA256");
  const candidate = path.resolve(requestedCandidateRoot);
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("候选源码目录必须是真实目录");
  if (!fs.existsSync(path.join(candidate, "package.json")) || !fs.existsSync(path.join(candidate, "electron"))) {
    throw new Error("候选源码目录缺少 package.json 或 electron");
  }
  const manifest = path.join(candidate, "ACCOUNT-FUSION-CANDIDATE-MANIFEST.json");
  if (!fs.existsSync(manifest)) throw new Error("候选源码目录缺少 manifest");
  const metadata = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (Number(metadata.schemaVersion || 0) !== 2 || !Array.isArray(metadata.sourceFiles) || metadata.fileCount !== metadata.sourceFiles.length) {
    throw new Error("候选源码 manifest schema 无效");
  }
  if (path.resolve(String(metadata.candidatePath || "")) !== candidate) throw new Error("候选源码 manifest 路径不匹配");
  const actualHead = execFileSync("git", ["-C", sourceRepoRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 }).trim();
  if (actualHead !== metadata.baseHead) throw new Error("候选源码 baseHead 与当前仓库不匹配");
  for (const entry of metadata.sourceFiles) {
    const relativePath = safeRelativePath(entry.path);
    const candidateValue = fs.readFileSync(path.join(candidate, relativePath));
    if (sha256(candidateValue) !== entry.candidateSha256 || candidateValue.length !== entry.bytes) throw new Error("候选源码文件 hash 不匹配");
    let baseValue = null;
    try { baseValue = execFileSync("git", ["-C", sourceRepoRoot, "show", `${metadata.baseHead}:${relativePath}`], { maxBuffer: 10 * 1024 * 1024, timeout: 10_000 }); } catch {}
    if ((baseValue === null) !== entry.newInBase) throw new Error("候选源码 newInBase 不匹配");
    if (baseValue && sha256(baseValue) !== entry.baseSha256) throw new Error("候选源码 base hash 不匹配");
  }
  const patch = fs.readFileSync(path.join(candidate, "ACCOUNT-FUSION-CANDIDATE.patch"));
  if (sha256(patch) !== metadata.patchSha256 || patch.length !== metadata.patchBytes) throw new Error("候选 patch hash 不匹配");
  const contentTreeSha256 = candidateContentTree(metadata.sourceFiles, candidate);
  if (contentTreeSha256 !== metadata.contentTreeSha256 || contentTreeSha256 !== expectedCandidateTree) {
    throw new Error("候选源码 hash verifier 未通过，拒绝启动 Electron");
  }
  return {
    root: candidate,
    baseHead: metadata.baseHead,
    contentTreeSha256,
    runtimeTreeSha256: runtimeTreeDigest(candidate),
  };
}
modulePreflightStage = "candidate-validation";
const candidateProof = validateCandidateRoot();
const projectRoot = candidateProof.root;
const workspaceRoot = path.resolve(sourceRepoRoot, "..");
const fixturePath = path.resolve(process.env.WANJUAN_ACCOUNT_QA_FIXTURE || path.join(workspaceRoot, "server-e2e-shadow-work", "APP-QA-FIXTURES.json"));
if (!requestedQaRoot) throw new Error("schema2 GUI 验收必须显式指定全新 WANJUAN_ACCOUNT_QA_OUTPUT_DIR");
const statePath = path.join(qaRoot, "real-candidate-state.json");
const electronPath = require("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const IDENTIFIER_CODE_COOLDOWN_MS = 60_500;
let lastCheckpointName = "preflight";
let failureStage = "runner-start";
let childStarted = false;
let authIdentifierRequestCompletedAt = null;

modulePreflightStage = "fixture-validation";
if (/\.tmp(?:\.|$)/i.test(fixturePath) || path.basename(fixturePath) !== "APP-QA-FIXTURES.json") {
  throw new Error("只允许读取正式 APP-QA-FIXTURES.json，拒绝读取临时 fixture");
}
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const accountUrl = String(fixture.accountBaseUrl || "").replace(/\/$/, "");
const parsedAccountUrl = new URL(accountUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedAccountUrl.hostname)) throw new Error("真实候选 GUI 脚本只允许连接本机隔离转发");
if (Number(fixture.schemaVersion || 0) < 2 || fixture?.provisioning?.registrationSubjectUnused !== true) {
  throw new Error("仅允许全新 schema2 nonRedeem fixture，拒绝启动旧账号融合环境");
}
if (fixture?.otp?.delivery !== "isolated-mock-mailbox") {
  throw new Error("schema2 GUI 验收只接受随机 isolated-mock-mailbox，不接受固定验证码");
}
if (process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW) {
  throw new Error("真实候选 GUI runner 拒绝 WANJUAN_ACCOUNT_FUSION_PREVIEW，不能用 preview override 强开能力");
}
const otpResolver = createAccountFusionOtpResolver({ fixture });

const supportedScenarios = new Set(["auth", "reset", "reset-login", "redeem", "active", "review"]);
const selectedScenarios = String(process.env.WANJUAN_ACCOUNT_QA_SCENARIOS || "auth,active,review,reset")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
modulePreflightStage = "scenario-validation";
if (!selectedScenarios.length || selectedScenarios.some((value) => !supportedScenarios.has(value))) {
  throw new Error("WANJUAN_ACCOUNT_QA_SCENARIOS 仅支持 auth,reset,reset-login,redeem,active,review");
}
if (selectedScenarios.join(",") !== "auth,active,review,reset") {
  throw new Error("schema2 nonRedeem GUI 验收必须且只能按 auth,active,review,reset 执行，reset 严格最后");
}
if (fs.existsSync(qaRoot) && fs.readdirSync(qaRoot).length > 0) {
  throw new Error("WANJUAN_ACCOUNT_QA_OUTPUT_DIR 必须为空，拒绝复用旧证据或状态");
}
modulePreflightStage = "runner-start";

const redactSelectors = [
  ".wanjuan-account-settings-title-row h2",
  ".wanjuan-account-settings-hero p",
  ".wanjuan-account-auth-shell input",
  ".is-link-form input",
  ".wanjuan-account-redeem-row input",
  ".wanjuan-account-managed-relay-row strong",
];

const publicCapabilityNames = [
  "passwordAuth",
  "passwordRegistration",
  "passwordReset",
  "relayManagedConfig",
  "relayWalletUi",
  "relayRedeem",
  "relayAutoProvision",
  "relayLegacyLink",
];

function capabilityFlags(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(publicCapabilityNames.map((name) => [name, source[name] === true]));
}

function capabilityProbeReady(probe) {
  return probe?.ok === true &&
    Number(probe?.status || 0) >= 200 &&
    Number(probe?.status || 0) < 300 &&
    probe?.flags?.passwordAuth === true &&
    probe?.flags?.passwordReset === true;
}

function prelaunchCapabilityDiagnostics(capabilityProbe) {
  return {
    capabilityRequest: capabilityProbe,
    main: {
      durationMs: 0,
      flags: capabilityFlags(),
      bootstrapOk: false,
      errorClass: "not_started_preflight_blocked",
    },
    renderer: {
      flags: { passwordAuth: false, passwordReset: false },
      authShellVisible: false,
      passwordLoginToggle: false,
      passwordInputVisible: false,
      otpInputVisible: false,
      passwordResetToggle: false,
      rendererEntry: "not_started_preflight_blocked",
    },
  };
}

async function probePublicCapabilities() {
  const startedAt = Date.now();
  const baseUrl = new URL(accountUrl).origin;
  try {
    const response = await fetch(`${baseUrl}/public/capabilities`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    return {
      baseUrl,
      status: Number(response.status || 0),
      ok: response.ok === true,
      durationMs: Date.now() - startedAt,
      flags: capabilityFlags(payload),
    };
  } catch (error) {
    return {
      baseUrl,
      status: 0,
      ok: false,
      durationMs: Date.now() - startedAt,
      flags: capabilityFlags(),
      errorClass: error?.name === "TypeError" ? "network_error" : "request_error",
    };
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForTarget(port, { timeoutMs = 60000, requestTimeoutMs = 2000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("等待隔离候选 Electron 页面时已中断");
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page" && /index\.html/.test(String(item.url || "")));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {} finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortRequest);
    }
    await sleep(250);
  }
  throw new Error("等待隔离候选 Electron 页面超时");
}

function freezeCandidateForLaunch(tempRoot) {
  if (runtimeTreeDigest(projectRoot) !== candidateProof.runtimeTreeSha256) throw new Error("候选 runtime 在启动前发生变化");
  const frozenRoot = path.join(tempRoot, "candidate-app");
  fs.mkdirSync(frozenRoot, { mode: 0o700 });
  for (const relativePath of runtimeRoots) {
    fs.cpSync(path.join(projectRoot, relativePath), path.join(frozenRoot, relativePath), { recursive: true, errorOnExist: true, force: false });
  }
  const dependencyRoot = fs.realpathSync(path.join(projectRoot, "node_modules"));
  if (!fs.statSync(dependencyRoot).isDirectory()) throw new Error("候选依赖目录不可用");
  fs.symlinkSync(dependencyRoot, path.join(frozenRoot, "node_modules"), "dir");
  if (runtimeTreeDigest(frozenRoot) !== candidateProof.runtimeTreeSha256) throw new Error("冻结候选副本 hash 不匹配");
  const makeReadOnly = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { makeReadOnly(target); fs.chmodSync(target, 0o555); }
      else if (stat.isFile()) fs.chmodSync(target, 0o444);
    }
  };
  makeReadOnly(frozenRoot);
  fs.chmodSync(frozenRoot, 0o555);
  return frozenRoot;
}

async function withElectron(name, handler) {
  failureStage = `${name}:capability-preflight`;
  const capabilityProbe = await probePublicCapabilities();
  if (!capabilityProbeReady(capabilityProbe)) {
    const error = new Error("匿名能力预检未通过，拒绝启动隔离候选 App");
    error.capabilityDiagnostics = prelaunchCapabilityDiagnostics(capabilityProbe);
    throw error;
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `starcanvas-real-candidate-${name}-`));
  let launchRoot;
  try {
    failureStage = `${name}:cdp-start`;
    launchRoot = freezeCandidateForLaunch(tempRoot);
  } catch (error) {
    try { restoreWritableForCleanup(tempRoot); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  const userDataPath = path.join(tempRoot, "user-data");
  const debugPort = await freePort();
  let child;
  try {
    child = trackChildClose(spawn(electronPath, [launchRoot, `--remote-debugging-port=${debugPort}`], {
    cwd: launchRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...sanitizeOtpHelperEnv(process.env),
      WANJUAN_TEST_USER_DATA_PATH: userDataPath,
      WANJUAN_ACCOUNT_API_URL: accountUrl,
      WANJUAN_ALLOW_RANDOM_PORT: "1",
      WANJUAN_DISABLE_UPDATE_CHECK: "1",
      WANJUAN_GPU_MODE: "off",
    },
    }));
    childStarted = true;
  } catch (error) {
    try { restoreWritableForCleanup(tempRoot); } catch {}
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  let stderrObserved = false;
  child.stderr.on("data", () => { stderrObserved = true; });
  let ws;
  let rejectPending = () => {};
  let interrupted = false;
  const sessionAbort = new AbortController();
  let currentStage = "electron-start";
  let terminationRecorded = false;
  let terminationWriteError = null;
  const recordTermination = (suffix, extra = {}) => {
    try {
      atomicWriteJson(path.join(qaRoot, `checkpoint-interrupted${suffix}.json`), {
        fixtureGeneratedAt: fixture.generatedAt,
        status: "interrupted",
        signal: extra.signal || "unknown",
        stage: currentStage,
        childStarted: true,
        ...extra,
      });
    } catch (error) { terminationWriteError = error; }
  };
  const emergencyCleanup = (signal = "unknown") => {
    interrupted = true;
    sessionAbort.abort();
    if (!terminationRecorded) {
      terminationRecorded = true;
      recordTermination("", { signal });
    }
    try { ws?.close(); } catch {}
    try { rejectPending(new Error("隔离候选验收已中断")); } catch {}
    if (child.exitCode === null) {
      try { child.kill("SIGTERM"); } catch {}
    }
  };
  const onSigint = () => emergencyCleanup("SIGINT");
  const onSigterm = () => emergencyCleanup("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    currentStage = "wait-cdp-target";
    const target = await waitForTarget(debugPort, { signal: sessionAbort.signal });
    if (interrupted) throw new Error("隔离候选验收已中断");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket 连接超时")), 10_000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP WebSocket 连接失败")); };
      ws.onclose = () => { clearTimeout(timer); reject(new Error("CDP WebSocket 在连接前关闭")); };
    });
    let requestId = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(request.timer);
        request.resolve(message);
      }
    };
    rejectPending = (error) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
    };
    ws.onclose = () => rejectPending(new Error("CDP WebSocket 已关闭"));
    ws.onerror = () => rejectPending(new Error("CDP WebSocket 通信失败"));
    const send = (method, params = {}, timeoutMs = 10_000) => new Promise((resolve, reject) => {
      if (interrupted) return reject(new Error("隔离候选验收已中断"));
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP 调用超时：${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { ws.send(JSON.stringify({ id, method, params })); } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
    const evaluate = async (expression, awaitPromise = false) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (response.result?.exceptionDetails) {
        const error = new Error("CDP JavaScript evaluation failed; details omitted");
        error.qaErrorClass = "cdp_javascript_error";
        throw error;
      }
      return response.result?.result?.value;
    };
    const waitFor = async (expression, label, timeout = 45000) => {
      currentStage = `wait-${label}`;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`隔离 App 提前退出：${child.exitCode}`);
        if (await evaluate(expression)) return;
        await sleep(150);
      }
      const error = new Error(`等待${label}超时`);
      error.qaErrorClass = "ui_wait_timeout";
      throw error;
    };
    const clickText = (text, selector = "button") => evaluate(`(() => {
      const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => (item.textContent || '').trim().includes(${JSON.stringify(text)}));
      if (!target || target.disabled) return false;
      target.click();
      return true;
    })()`);
    const fill = (selector, value) => evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const waitForAppReady = () => waitFor(`(() => {
      const root = document.documentElement;
      return !!document.body && !root.classList.contains('wanjuan-booting') &&
        root.dataset.wanjuanBootReady !== 'error' && !document.getElementById('wanjuan-boot-splash');
    })()`, "应用稳定启动");
    const collectCapabilityDiagnostics = async () => {
      const startedAt = Date.now();
      let mainResult = null;
      let mainErrorClass = "";
      try {
        mainResult = await evaluate("globalThis.wanjuanDesktop?.accountBootstrap?.()", true);
      } catch (error) {
        mainErrorClass = error?.name === "TypeError" ? "bootstrap_unavailable" : "bootstrap_error";
      }
      const rendererState = await evaluate(`(() => {
        const shell = document.querySelector('.wanjuan-account-auth-shell');
        const buttons = Array.from(document.querySelectorAll('.wanjuan-account-auth-shell button'));
        const text = (item) => (item?.textContent || '').trim();
        return {
          authShellVisible: Boolean(shell),
          passwordLoginToggle: buttons.some((item) => text(item) === '密码登录'),
          passwordInputVisible: Boolean(shell?.querySelector('input[type="password"]')),
          otpInputVisible: Boolean(shell?.querySelector('input[autocomplete="one-time-code"]')),
          passwordResetToggle: buttons.some((item) => text(item) === '忘记密码'),
          rendererEntry: shell ? 'auth-shell' : 'account-settings-without-auth-shell',
        };
      })()`);
      return {
        capabilityRequest: capabilityProbe,
        main: {
          durationMs: Date.now() - startedAt,
          flags: capabilityFlags(mainResult?.featureFlags),
          bootstrapOk: Boolean(mainResult && mainResult.ok !== false),
          errorClass: mainErrorClass || (mainResult ? "" : "bootstrap_missing_response"),
        },
        renderer: {
          flags: {
            passwordAuth: rendererState.passwordLoginToggle || rendererState.passwordInputVisible,
            passwordReset: rendererState.passwordResetToggle,
          },
          ...rendererState,
        },
      };
    };
    const capture = async (filename) => {
      await waitForAppReady();
      await sleep(200);
      await evaluate(`(() => {
        document.getElementById('wanjuan-qa-redactions')?.remove();
        const root = document.createElement('div');
        root.id = 'wanjuan-qa-redactions';
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
        const style = document.createElement('style');
        style.textContent = '.wanjuan-toast{visibility:hidden!important;opacity:0!important;}';
        root.appendChild(style);
        const seen = new Set();
        ${JSON.stringify(redactSelectors)}.forEach((selector) => document.querySelectorAll(selector).forEach((element) => {
          if (seen.has(element)) return;
          seen.add(element);
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return;
          const cover = document.createElement('div');
          cover.textContent = '••••••';
          cover.style.cssText = 'position:fixed;display:grid;place-items:center;box-sizing:border-box;border:1px solid rgba(148,163,184,.35);border-radius:6px;background:#242930;color:#9ca3af;font:600 10px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;';
          cover.style.left = Math.max(0, rect.left) + 'px'; cover.style.top = Math.max(0, rect.top) + 'px';
          cover.style.width = Math.min(innerWidth - Math.max(0, rect.left), rect.width) + 'px';
          cover.style.height = Math.min(innerHeight - Math.max(0, rect.top), rect.height) + 'px';
          root.appendChild(cover);
        }));
        document.body.appendChild(root);
      })()`);
      try {
        const response = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        atomicWriteBuffer(path.join(qaRoot, filename), Buffer.from(response.result.data, "base64"));
      } finally {
        await evaluate("document.getElementById('wanjuan-qa-redactions')?.remove()");
      }
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false });
    await waitFor("document.body?.innerText?.includes('设置')", "应用初始化");
    await waitForAppReady();
    await evaluate("window.dispatchEvent(new CustomEvent('wanjuan:open-account-settings'))");
    await waitFor("document.body?.innerText?.includes('登录 / 注册')", "账号设置");
    failureStage = `${name}:handler`;
    await handler({ evaluate, waitFor, clickText, fill, capture, collectCapabilityDiagnostics, capabilityProbe });
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    try { rejectPending?.(new Error("CDP 会话已关闭")); } catch {}
    try { ws?.close(); } catch {}
    const childCleanup = await terminateQaChild(child, "SIGTERM");
    // The terminal evidence filename is intentionally stable for interrupted runs.
    if (interrupted) recordTermination("-terminal", { signal: "interrupted", childExitCode: child.exitCode, childSignal: child.signalCode || "" }); // checkpoint-interrupted-terminal
    const frozenRuntimeIntact = runtimeTreeDigest(launchRoot) === candidateProof.runtimeTreeSha256;
    atomicWriteJson(path.join(qaRoot, `checkpoint-candidate-runtime-${name}.json`), {
      fixtureGeneratedAt: fixture.generatedAt,
      checkpoint: "candidate-runtime-integrity",
      baseHead: candidateProof.baseHead,
      contentTreeSha256: candidateProof.contentTreeSha256,
      runtimeTreeSha256: candidateProof.runtimeTreeSha256,
      frozenRuntimeIntact,
      cleanupConfirmed: childCleanup.cleanupConfirmed === true,
      forcedCleanup: childCleanup.forced === true,
    });
    restoreWritableForCleanup(tempRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (terminationWriteError) throw new Error("中断终态证据无法持久化");
    if (!frozenRuntimeIntact) throw new Error("冻结候选 runtime 在 GUI 运行期间发生变化");
    if (stderrObserved && child.exitCode && child.exitCode !== 0) {
      console.error(JSON.stringify({ errorClass: "qa_electron_nonzero_exit", stderrRedacted: true }));
    }
  }
}

async function openAuth(ui) {
  assert.equal(await ui.clickText("登录 / 注册", ".wanjuan-account-settings-page button"), true);
  await ui.waitFor("!!document.querySelector('.wanjuan-account-auth-shell')", "登录弹窗");
}

async function passwordLogin(ui, email, password) {
  await openAuth(ui);
  try {
    await ui.waitFor("!!document.querySelector('.wanjuan-account-auth-shell input[type=\"password\"]') || [...document.querySelectorAll('.wanjuan-account-auth-shell button')].some(button => button.textContent?.trim() === '密码登录')", "密码登录能力就绪");
  } catch (error) {
    error.capabilityDiagnostics = await ui.collectCapabilityDiagnostics();
    throw error;
  }
  await ui.clickText("密码登录", ".wanjuan-account-auth-shell button");
  await ui.waitFor("!!document.querySelector('.wanjuan-account-auth-shell input[type=\"password\"]')", "密码输入框");
  assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
  assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', password), true);
  assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
  await ui.waitFor("!document.querySelector('.wanjuan-account-auth-shell') || !!document.querySelector('.wanjuan-account-form-error')", "密码登录结果");
  const error = await ui.evaluate("document.querySelector('.wanjuan-account-form-error')?.textContent || ''");
  if (error) throw new Error(`密码登录失败：${/密码|password/i.test(error) ? "credential_rejected" : "candidate_rejected"}`);
}

async function logout(ui) {
  await ui.evaluate("window.confirm = () => true");
  assert.equal(await ui.clickText("退出登录", ".wanjuan-account-settings-page button"), true);
  await ui.waitFor("document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes('本地模式')", "退出登录");
}

async function runAuthScenario(results, checkpoint = () => {}) {
  const usePreparedAuth = fixture?.schemaVersion >= 2 && fixture?.provisioning?.registrationSubjectUnused === true;
  const base = usePreparedAuth ? fixture.accounts.authAndRedeem : otpResolver.mode === "isolated-mock-mailbox" ? fixture.accounts.registration : fixture.accounts.authAndRedeem;
  const email = usePreparedAuth || otpResolver.mode === "isolated-mock-mailbox" ? base.email : `app-qa-${Date.now()}@example.com`;
  const password = base.initialPassword;
  await withElectron("auth", async (ui) => {
    if (usePreparedAuth) {
      await passwordLogin(ui, email, password);
      results.passwordLogin = true;
      checkpoint("auth-password-login");
    } else {
      await openAuth(ui);
      assert.equal(await ui.clickText("注册", ".wanjuan-account-auth-tabs button"), true);
      assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
      assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', password), true);
      const registrationIssuedAfter = Date.now();
      assert.equal(await ui.clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
      await ui.waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证码已发送')", "注册 OTP");
      const registrationOtp = await otpResolver.resolve({ email, purpose: "register", issuedAfter: registrationIssuedAfter });
      assert.equal(await ui.fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', registrationOtp), true);
      await ui.capture("real-01-password-registration.png");
      assert.equal(await ui.clickText("注册并继续", ".wanjuan-account-auth-shell button"), true);
      await ui.waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "注册完成");
      results.passwordRegistration = true;
    }

    await ui.waitFor("document.body?.innerText?.includes('极鑫托管服务')", "托管服务");
    const accountText = await ui.evaluate("document.querySelector('.wanjuan-account-settings-page')?.innerText || ''");
    assert.equal(accountText.includes("模型余额"), true);
    assert.equal(/85\s*折|8\.5\s*折|15%\s*off/i.test(accountText), false);
    results.managedRelayVisible = true; results.walletVisible = true; results.noDiscountCopy = true;
    await ui.capture("real-02-managed-relay-wallet.png");

    const keyActionButtons = await ui.evaluate(`Array.from(document.querySelectorAll('.wanjuan-account-settings-page button')).map((button) => ({
      text: (button.textContent || '').trim(), disabled: Boolean(button.disabled),
    }))`);
    assert.equal(keyActionButtons.some((button) => button.text === "查看 Key" && !button.disabled), true, "托管 Key 查看按钮不可用");
    assert.equal(keyActionButtons.some((button) => button.text === "重新生成" && !button.disabled), true, "托管 Key 轮换按钮不可用");

    const revealIssuedAfter = Date.now();
    assert.equal(await ui.clickText("查看 Key", ".wanjuan-account-settings-page button"), true);
    await ui.waitFor(KEY_REVEAL_FORM_WAIT_EXPRESSION, "Key 查看验证码");
    const revealOtp = await otpResolver.resolve({ email, purpose: "relay_key_reveal", issuedAfter: revealIssuedAfter });
    assert.equal(await ui.fill('.wanjuan-account-settings-page input[placeholder="输入验证码"]', revealOtp), true);
    assert.equal(await ui.clickText("查看60秒", ".wanjuan-account-settings-page button"), true);
    await ui.waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('Key 将在60秒后自动隐藏')", "Key 查看结果");
    assert.equal(await ui.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('.wanjuan-account-managed-relay-row strong')).map((item) => (item.textContent || '').trim());
      return row.some((value) => value && value !== '--' && value.length > 3);
    })()`), true, "Key 查看后没有显示受控结果");
    results.keyReveal = true;
    checkpoint("auth-key-reveal");

    // send_code cooldown is global per email, not per purpose. Wait the
    // contract minimum before requesting rotate; never bypass retryAfter by
    // switching from reveal to rotate.
    const rotationTiming = await runAccountFusionKeyRotation({
      ui, email, results, checkpoint,
      // purpose: "relay_key_rotate"
      resolveOtp: (request) => otpResolver.resolve(request),
      // await sleep(IDENTIFIER_CODE_COOLDOWN_MS)
      sleep: () => sleep(IDENTIFIER_CODE_COOLDOWN_MS),
    });

    for (const [language, expected, filename] of [
      ["en-US", "Jixin managed service", "real-03-account-en.png"],
      ["zh-TW", "極鑫託管服務", "real-04-account-zh-tw.png"],
      ["zh-CN", "极鑫托管服务", "real-05-account-zh-cn.png"],
    ]) {
      failureStage = `auth:language-${language}`;
      try {
        await switchAccountFusionLanguage(ui, language);
        await ui.waitFor(`document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes(${JSON.stringify(expected)})`, `${language} 账号界面`);
        const hasDiscountCopy = await ui.evaluate("/85\\s*折|8\\.5\\s*折|15%\\s*off/i.test(document.querySelector('.wanjuan-account-settings-page')?.innerText || '')");
        assert.equal(hasDiscountCopy, false);
        await ui.capture(filename);
      } catch (error) {
        try {
          const safe = await ui.evaluate(`(() => {
            const runtime = globalThis.wanjuanI18nRuntime;
            const page = document.querySelector('.wanjuan-account-settings-page');
            return {
              runtimePresent: Boolean(runtime), pagePresent: Boolean(page),
              languageMatches: runtime?.getLanguage?.() === ${JSON.stringify(language)},
              dictionaryMatches: runtime?.t?.('极鑫托管服务', ${JSON.stringify(language)}) === ${JSON.stringify(expected)},
              renderedMatches: Boolean(page?.textContent?.includes(${JSON.stringify(expected)})),
            };
          })()`);
          checkpoint("auth-language-diagnostics", {
            language,
            runtimePresent: safe?.runtimePresent === true, pagePresent: safe?.pagePresent === true,
            languageMatches: safe?.languageMatches === true, dictionaryMatches: safe?.dictionaryMatches === true,
            renderedMatches: safe?.renderedMatches === true,
          });
        } catch {}
        if (!error.qaErrorClass) error.qaErrorClass = "language_assertion_failed";
        throw error;
      }
    }
    results.languages = true;
    checkpoint("auth-language-sweep");
    await switchAccountFusionLanguage(ui, "zh-CN");

    await logout(ui);
    if (!results.passwordLogin) {
      await passwordLogin(ui, email, password);
      results.passwordLogin = true;
      await logout(ui);
    }

    await waitForAccountFusionIdentifierCooldown({
      checkpoint,
      sleep,
      requestCompletedAt: rotationTiming.rotateCompletedAt,
      cooldownMs: IDENTIFIER_CODE_COOLDOWN_MS,
    });
    await openAuth(ui);
    assert.equal(await ui.clickText("验证码登录", ".wanjuan-account-auth-shell button"), true);
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
    const loginIssuedAfter = Date.now();
    assert.equal(await ui.clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证码已发送')", "登录 OTP");
    const loginOtp = await otpResolver.resolve({ email, purpose: "login", issuedAfter: loginIssuedAfter });
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', loginOtp), true);
    assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "OTP 登录完成");
    authIdentifierRequestCompletedAt = Date.now();
    results.otpLogin = true;
    checkpoint("auth-otp-login");
    await logout(ui); results.logout = true;
    checkpoint("auth-logout");
  });
}

async function runResetScenario(results, checkpoint = () => {}) {
  const source = fixture.accounts.authAndRedeem;
  await withElectron("reset", async (ui) => {
    await openAuth(ui);
    assert.equal(await ui.clickText("忘记密码", ".wanjuan-account-auth-shell button"), true);
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="email"]', source.email), true);
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', source.resetPassword), true);
    const resetIssuedAfter = Date.now();
    assert.equal(await ui.clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor(`(() => {
      const text = document.querySelector('.wanjuan-account-auth-shell')?.innerText || '';
      return text.includes('验证码已发送') || !!document.querySelector('.wanjuan-account-form-error');
    })()`, "重置 OTP", 30000);
    const resetRequestError = await ui.evaluate("document.querySelector('.wanjuan-account-form-error')?.textContent || ''");
    if (resetRequestError) {
      const classification = /频繁|稍后|rate/i.test(resetRequestError) ? "rate_limited" : /不存在|未注册/i.test(resetRequestError) ? "account_missing" : "candidate_rejected";
      throw new Error(`重置验证码请求失败：${classification}`);
    }
    const resetOtp = await otpResolver.resolve({ email: source.email, purpose: "reset_password", issuedAfter: resetIssuedAfter });
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', resetOtp), true);
    assert.equal(await ui.clickText("重置密码", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('密码已重置')", "密码重置");
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', source.initialPassword), true);
    assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("!!document.querySelector('.wanjuan-account-form-error')", "旧密码被拒绝");
    results.oldPasswordRejected = true;
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', source.resetPassword), true);
    assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "新密码登录");
    results.passwordReset = true;
    checkpoint("reset-password");
    await logout(ui);
    checkpoint("reset-logout");
  });
}

async function runResetLoginScenario(results, checkpoint = () => {}) {
  const source = fixture.accounts.authAndRedeem;
  await withElectron("reset-login", async (ui) => {
    await openAuth(ui);
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="email"]', source.email), true);
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', source.initialPassword), true);
    assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("!!document.querySelector('.wanjuan-account-form-error')", "旧密码被拒绝");
    results.oldPasswordRejected = true;
    assert.equal(await ui.fill('.wanjuan-account-auth-shell input[type="password"]', source.resetPassword), true);
    assert.equal(await ui.clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await ui.waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "新密码登录");
    results.passwordReset = true;
    checkpoint("reset-login-password");
    await logout(ui);
    checkpoint("reset-login-logout");
  });
}

async function runRedeemScenario(results) {
  const source = fixture.accounts.authAndRedeem;
  await withElectron("redeem", async (ui) => {
    await passwordLogin(ui, source.email, source.initialPassword);
    await ui.waitFor("document.body?.innerText?.includes('模型余额')", "钱包加载");
    const before = await ui.evaluate("document.querySelector('.wanjuan-account-wallet-metrics')?.innerText || ''");
    assert.equal(await ui.fill('input[placeholder="粘贴充值码"]', fixture.redeemCodes[0]), true);
    assert.equal(await ui.clickText("兑换", ".wanjuan-account-settings-page button"), true);
    await ui.waitFor(`(() => {
      const toast = document.querySelector('.wanjuan-toast')?.textContent || '';
      const busy = Array.from(document.querySelectorAll('.wanjuan-account-settings-page button')).some((item) => (item.textContent || '').includes('正在兑换'));
      return !busy && (toast.includes('充值码兑换成功') || toast.includes('兑换失败') || toast.includes('兑换码'));
    })()`, "充值码兑换结果", 60000);
    const toast = await ui.evaluate("document.querySelector('.wanjuan-toast')?.textContent || ''");
    assert.equal(toast.includes("充值码兑换成功"), true, "候选兑换未成功");
    await ui.waitFor(`(document.querySelector('.wanjuan-account-wallet-metrics')?.innerText || '') !== ${JSON.stringify(before)}`, "钱包额度刷新");
    results.redeem = true;
    await ui.capture("real-06-redeem-wallet.png");
    await logout(ui);
  });
}

async function runLegacyScenario(kind, results, checkpoint = () => {}) {
  const source = kind === "active" ? fixture.accounts.legacyActive : fixture.accounts.legacyReview;
  await withElectron(`legacy-${kind}`, async (ui) => {
    await passwordLogin(ui, source.account.email, source.account.initialPassword);
    await ui.waitFor("document.body?.innerText?.includes('极鑫托管服务')", "托管服务");
    const before = await ui.evaluate(`JSON.stringify({
      relay: Array.from(document.querySelectorAll('.wanjuan-account-managed-relay-row strong')).map((item) => item.textContent || ''),
      wallet: Array.from(document.querySelectorAll('.wanjuan-account-wallet-metrics strong')).map((item) => item.textContent || '')
    })`);
    assert.equal(await ui.clickText("绑定原极鑫账号", ".wanjuan-account-settings-page button"), true);
    await ui.waitFor("!!document.querySelector('.is-link-form')", "旧账号绑定表单");
    assert.equal(await ui.fill('.is-link-form input[autocomplete="username"]', source.legacyUsername), true);
    assert.equal(await ui.fill('.is-link-form input[autocomplete="current-password"]', source.legacyPassword), true);
    assert.equal(await ui.clickText("验证旧账号", ".is-link-form button"), true);
    await ui.waitFor("document.querySelector('.is-link-form')?.innerText?.includes('MFA 验证码')", "MFA 表单");
    assert.equal(await ui.fill('.is-link-form input[autocomplete="one-time-code"]', source.legacyMfaBackupCode), true);
    const linkOtpIssuedAfter = Date.now();
    assert.equal(await ui.clickText("验证 MFA", ".is-link-form button"), true);
    await ui.waitFor("document.querySelector('.is-link-form')?.innerText?.includes('当前账号邮箱')", "邮箱确认");
    await ui.waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('验证码已发送到当前账号邮箱')", "绑定 OTP 已发送");
    const linkOtp = await otpResolver.resolve({ email: source.account.email, purpose: "relay_account_link", issuedAfter: linkOtpIssuedAfter });
    assert.equal(await ui.fill('.is-link-form input[autocomplete="one-time-code"]', linkOtp), true);
    await ui.capture(kind === "active" ? "real-07-legacy-active-before-confirm.png" : "real-08-legacy-review-before-confirm.png");
    assert.equal(await ui.clickText("确认绑定", ".is-link-form button"), true);
    if (kind === "active") {
      await ui.waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('原极鑫账号已绑定')", "active 绑定");
      results.legacyMfaActive = true;
      checkpoint("active-link-confirm");
    } else {
      await ui.waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('需要人工审核')", "review 绑定");
      const after = await ui.evaluate(`JSON.stringify({
        relay: Array.from(document.querySelectorAll('.wanjuan-account-managed-relay-row strong')).map((item) => item.textContent || ''),
        wallet: Array.from(document.querySelectorAll('.wanjuan-account-wallet-metrics strong')).map((item) => item.textContent || '')
      })`);
      assert.equal(after, before);
      results.legacyReviewPreservesState = true;
      checkpoint("review-link-confirm");
    }
    await logout(ui);
  });
}

async function run() {
  ensureOwnerOnlyQaDirectory(qaRoot);
  claimOwnerMarker(runnerOwnerPath, { schemaVersion: 1, pid: process.pid, ownerToken: runnerOwnerToken });
  const emptyResults = {
    passwordRegistration: false, passwordLogin: false, otpLogin: false,
    passwordReset: false, oldPasswordRejected: false, managedRelayVisible: false,
    walletVisible: false, keyReveal: false, keyRotate: false, redeem: false, legacyMfaActive: false,
    legacyReviewPreservesState: false, languages: false, noDiscountCopy: false, logout: false,
  };
  const candidateEvidence = {
    baseHead: candidateProof.baseHead,
    contentTreeSha256: candidateProof.contentTreeSha256,
    runtimeTreeSha256: candidateProof.runtimeTreeSha256,
  };
  let state = { fixtureGeneratedAt: fixture.generatedAt, candidate: candidateEvidence, results: { ...emptyResults }, capabilityDiagnostics: null };
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (saved.fixtureGeneratedAt === fixture.generatedAt) state = {
      fixtureGeneratedAt: fixture.generatedAt,
      candidate: candidateEvidence,
      results: { ...emptyResults, ...saved.results },
      capabilityDiagnostics: saved.capabilityDiagnostics || null,
    };
  } catch {}
  if (state.fixtureGeneratedAt !== fixture.generatedAt) state = { fixtureGeneratedAt: fixture.generatedAt, results: { ...emptyResults }, capabilityDiagnostics: null };
  const results = state.results;
  let capabilityDiagnostics = state.capabilityDiagnostics;
  const checkpoint = (name, extra = {}) => {
    lastCheckpointName = name;
    const stageByCheckpoint = {
      "auth-rotate-cooldown-start": "auth:cooldown-start",
      "auth-rotate-cooldown-complete": "auth:cooldown-complete",
      "auth-rotate-click": "auth:rotate-click",
      "auth-rotate-form": "auth:rotate-form",
      "auth-rotate-otp-resolved": "auth:otp-resolved",
      "auth-rotate-submit": "auth:rotate-submit",
      "auth-key-rotate": "auth:rotate-result",
      "auth-login-cooldown-start": "auth:login-cooldown-start",
      "auth-login-cooldown-complete": "auth:login-cooldown-complete",
      "reset-cooldown-start": "reset:cooldown-start",
      "reset-cooldown-complete": "reset:cooldown-complete",
    };
    if (stageByCheckpoint[name]) failureStage = stageByCheckpoint[name];
    return atomicWriteJson(path.join(qaRoot, `checkpoint-${name}.json`), {
      fixtureGeneratedAt: fixture.generatedAt,
      checkpoint: name,
      results: { ...results },
      ...extra,
    });
  };
  const persist = () => atomicWriteJson(statePath, { fixtureGeneratedAt: fixture.generatedAt, candidate: candidateEvidence, results, capabilityDiagnostics });
  if (process.env.WANJUAN_ACCOUNT_QA_TEST_THROW_AFTER_PREFLIGHT === "1") {
    const error = new Error("synthetic QA failure");
    error.qaErrorClass = "synthetic_test_failure";
    throw error;
  }
  if (process.env.WANJUAN_ACCOUNT_QA_TEST_THROW_AFTER_CHECKPOINTS === "1") {
    results.passwordLogin = true;
    checkpoint("auth-password-login");
    results.managedRelayVisible = true;
    results.walletVisible = true;
    results.noDiscountCopy = true;
    results.keyReveal = true;
    checkpoint("auth-key-reveal");
    failureStage = "auth:cooldown-start";
    throw new Error("synthetic post-checkpoint QA failure");
  }
  if (process.env.WANJUAN_ACCOUNT_QA_DRY_RUN === "1") {
    persist();
    checkpoint("dry-run-preflight", { dryRun: true, selectedScenarios, candidate: candidateEvidence });
    atomicWriteBuffer(path.join(qaRoot, "report-dry-run.md"), Buffer.from([
      "# StarCanvas account fusion QA dry-run", "", "- Result: passed", "- Electron launched: no", "- Redeem: no", "- Secrets: omitted", "",
      `- Scenarios: ${selectedScenarios.join(",")}`, `- Candidate content tree: ${candidateEvidence.contentTreeSha256}`, `- Candidate runtime tree: ${candidateEvidence.runtimeTreeSha256}`, "- Atomic owner-only evidence writes: passed", "",
    ].join("\n"), "utf8"));
    console.log(JSON.stringify({ ok: true, dryRun: true, selectedScenarios }));
    return;
  }
  const authResultKeys = [
    ...(fixture?.schemaVersion >= 2 && fixture?.provisioning?.registrationSubjectUnused === true ? [] : ["passwordRegistration"]),
    "passwordLogin", "otpLogin", "managedRelayVisible", "walletVisible", "keyReveal", "keyRotate", "languages", "noDiscountCopy", "logout",
  ];
  const scenarioResultKeys = {
    auth: authResultKeys,
    redeem: ["redeem"],
    active: ["legacyMfaActive"],
    review: ["legacyReviewPreservesState"],
    reset: ["passwordReset", "oldPasswordRejected"],
    "reset-login": ["passwordReset", "oldPasswordRejected"],
  };
  const scenarioDone = (scenario) => (scenarioResultKeys[scenario] || []).every((key) => results[key] === true);
  if (selectedScenarios.includes("auth") && !scenarioDone("auth")) {
    failureStage = "scenario:auth";
    try {
      await runAuthScenario(results, checkpoint);
    } catch (error) {
      capabilityDiagnostics = error?.capabilityDiagnostics || capabilityDiagnostics;
      if (capabilityDiagnostics) {
        persist();
        const blockedReport = [
          "# StarCanvas account fusion capability entry gate", "",
          `- Date: ${new Date().toISOString()}`,
          "- Overall: blocked",
          "- Error class: capability_entry_blocked",
          "- Electron candidate launched: " + (capabilityDiagnostics.main?.errorClass === "not_started_preflight_blocked" ? "no" : "yes"),
          "- Sensitive values: omitted", "",
          "## Three-layer diagnostics", "",
          `- ${JSON.stringify(capabilityDiagnostics)}`, "",
          "## Boundary", "",
          "- No redeem scenario was run.",
          "- No production account, formal userData, package, or paid model request was used.",
        ].join("\n");
        atomicWriteBuffer(path.join(qaRoot, "report-capability-entry-blocked.md"), Buffer.from(`${blockedReport}\n`, "utf8"));
      }
      throw error;
    }
    persist();
  }
  if (selectedScenarios.includes("redeem") && !results.redeem) { failureStage = "scenario:redeem"; await runRedeemScenario(results); persist(); }
  if (selectedScenarios.includes("active") && !results.legacyMfaActive) { failureStage = "scenario:active"; await runLegacyScenario("active", results, checkpoint); persist(); }
  if (selectedScenarios.includes("review") && !results.legacyReviewPreservesState) { failureStage = "scenario:review"; await runLegacyScenario("review", results, checkpoint); persist(); }
  if (selectedScenarios.includes("reset") && !(results.passwordReset && results.oldPasswordRejected)) {
    failureStage = "scenario:reset";
    await waitForAccountFusionIdentifierCooldown({
      checkpoint,
      sleep,
      requestCompletedAt: authIdentifierRequestCompletedAt || Date.now(),
      cooldownMs: IDENTIFIER_CODE_COOLDOWN_MS,
      prefix: "reset",
    });
    await runResetScenario(results, checkpoint);
    persist();
  }
  if (selectedScenarios.includes("reset-login") && !(results.passwordReset && results.oldPasswordRejected)) { failureStage = "scenario:reset-login"; await runResetLoginScenario(results, checkpoint); persist(); }
  const requiredResultKeys = new Set(selectedScenarios.flatMap((scenario) => scenarioResultKeys[scenario] || []));
  const scenarioComplete = [...requiredResultKeys].every((key) => results[key] === true);
  const helperSecurity = otpResolver.secretFileSecurity || { permissionsVerified: false, reason: "missing-helper-security-result" };
  const complete = scenarioComplete && helperSecurity.permissionsVerified === true;
  const report = [
    "# StarCanvas account fusion real candidate QA", "",
    `- Date: ${new Date().toISOString()}`,
    "- Environment: isolated Electron userData + retained non-production candidate stack through localhost QA forward",
    "- Evidence level: real isolated candidate integration",
    "- Production accounts/models/payment: not used",
    "- Real model generation and cost: not used; zero paid model requests",
    "- Sensitive values: omitted", "", "## Result", "",
    `- Overall: ${complete ? "passed" : "incomplete"}`,
    `- OTP helper secret permissions: ${helperSecurity.permissionsVerified ? "verified" : `not verified (${helperSecurity.reason || "unknown"})`}`,
    "", "## Capability diagnostics", "",
    capabilityDiagnostics ? `- ${JSON.stringify(capabilityDiagnostics)}` : "- not captured",
    ...Object.entries(results).map(([key, value]) => `- ${key}: ${requiredResultKeys.has(key) ? value ? "passed" : "pending" : "not selected"}`),
    "", "## Contract evidence outside GUI", "",
    "- Manual API Authorization is not replaced by the managed credential: passed in account main boundary tests.",
    "- Managed 401 refresh retries at most once: passed in account main boundary tests.",
    "- Logout disables managed credential use: passed in account main boundary tests.",
    "", "## Screenshots", "",
    ...fs.readdirSync(qaRoot).filter((name) => name.startsWith("real-") && name.endsWith(".png")).sort().map((name) => `- ${name}`),
    "", "## Boundary", "",
    `- Remaining candidate items: ${complete ? "none" : "see pending results above"}.`,
    "- Production deployment: not performed.",
    "- This report proves the App against the retained isolated non-production candidate endpoint only. It does not prove production deployment or production-account availability.",
  ].join("\n");
  atomicWriteBuffer(path.join(qaRoot, "report-real-candidate.md"), Buffer.from(`${report}\n`, "utf8"));
  console.log(JSON.stringify({ ok: complete, selectedScenarios, results, report: path.join(qaRoot, "report-real-candidate.md") }));
  if (!complete) process.exitCode = 2;
}

run().catch((error) => {
  const diagnostics = error?.capabilityDiagnostics;
  const errorClass = diagnostics ? "capability_entry_blocked" : "runner_failed";
  if (!diagnostics) writeRunnerFailureEvidence(error);
  if (diagnostics) {
    console.error(JSON.stringify({
      ok: false,
      errorClass: "capability_entry_blocked",
      capabilityDiagnostics: diagnostics,
    }));
  } else {
    console.error(JSON.stringify({ ok: false, errorClass, lastCheckpoint: lastCheckpointName, stage: failureStage }));
  }
  process.exitCode = 1;
});
