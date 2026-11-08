const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HELPER_PATH_ENV = "WANJUAN_ACCOUNT_QA_OTP_HELPER";
const HELPER_SECRET_FILE_ENV = "WANJUAN_ACCOUNT_QA_OTP_HELPER_SECRET_FILE";
const HELPER_SECRET_CHILD_ENV = "STARCANVAS_QA_OTP_HELPER_SECRET_FILE";
const MAX_HELPER_OUTPUT_BYTES = 16 * 1024;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizePurpose = (value) => String(value || "").trim();

function exactFixtureOtpAllowlist(fixture) {
  const entries = [];
  const add = (email, purposes) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    for (const purpose of purposes) entries.push(`${normalizedEmail}\n${purpose}`);
  };
  add(fixture?.accounts?.registration?.email, ["register", "login"]);
  add(fixture?.accounts?.authAndRedeem?.email, ["login", "reset_password", "relay_key_reveal", "relay_key_rotate"]);
  add(fixture?.accounts?.legacyActive?.account?.email, ["login", "relay_account_link"]);
  add(fixture?.accounts?.legacyReview?.account?.email, ["login", "relay_account_link"]);
  return new Set(entries);
}

function sanitizeOtpHelperEnv(source = process.env) {
  const next = { ...source };
  for (const key of Object.keys(next)) {
    if (
      key === HELPER_PATH_ENV ||
      key === HELPER_SECRET_FILE_ENV ||
      key === HELPER_SECRET_CHILD_ENV ||
      key.startsWith("STARCANVAS_QA_OTP_HELPER_")
    ) delete next[key];
  }
  return next;
}

function validateSecretFile(secretFile, { platform = process.platform, getuid = process.getuid } = {}) {
  if (!path.isAbsolute(secretFile)) throw new Error("OTP mailbox helper secret file must use an absolute path");
  const stat = fs.lstatSync(secretFile);
  if (stat.isSymbolicLink()) throw new Error("OTP mailbox helper secret file must not be a symbolic link");
  if (!stat.isFile()) throw new Error("OTP mailbox helper secret path is not a file");
  if (platform === "win32") {
    return { ownerVerified: false, permissionsVerified: false, reason: "windows-acl-not-verified" };
  }
  if (typeof getuid === "function" && stat.uid !== getuid()) throw new Error("OTP mailbox helper secret file must be owned by the runner user");
  if ((stat.mode & 0o400) === 0) throw new Error("OTP mailbox helper secret file must be owner-readable");
  if ((stat.mode & 0o077) !== 0) throw new Error("OTP mailbox helper secret file must be owner-only (0600)");
  return { ownerVerified: true, permissionsVerified: true, reason: "posix-owner-readable-owner-only" };
}

function invokeMailboxHelper({ helperPath, secretFile, request, sourceEnv = process.env, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const helperEnv = sanitizeOtpHelperEnv(sourceEnv);
    helperEnv[HELPER_SECRET_CHILD_ENV] = secretFile;
    const child = spawnImpl(helperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: helperEnv,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(new Error("OTP mailbox helper timed out"));
    }, 10_000);
    child.once("error", () => finish(new Error("OTP mailbox helper could not start")));
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.length > MAX_HELPER_OUTPUT_BYTES) {
        try { child.kill("SIGKILL"); } catch {}
        finish(new Error("OTP mailbox helper returned too much data"));
      }
    });
    child.stderr.on("data", (chunk) => { stderrBytes += Buffer.byteLength(chunk); });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new Error("OTP mailbox helper rejected the request"));
      if (stderrBytes > 0) return finish(new Error("OTP mailbox helper wrote unexpected diagnostics"));
      try {
        const output = stdout.toString("utf8");
        const jsonLine = output.endsWith("\r\n") ? output.slice(0, -2) : output.endsWith("\n") ? output.slice(0, -1) : output;
        if (!jsonLine || /[\r\n]/.test(jsonLine) || jsonLine.trim() !== jsonLine) {
          throw new Error("OTP mailbox helper must return exactly one JSON line");
        }
        finish(null, JSON.parse(jsonLine));
      } catch {
        finish(new Error("OTP mailbox helper returned invalid JSON"));
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function createAccountFusionOtpResolver({ fixture, env = process.env, spawnImpl = spawn, now = () => Date.now() }) {
  const delivery = String(fixture?.otp?.delivery || "").trim();
  if (delivery === "isolated-fixed-code") {
    const code = String(fixture?.otp?.code || "").trim();
    if (!code) throw new Error("Fixed OTP fixture is missing its code");
    return {
      mode: delivery,
      secretFileSecurity: { ownerVerified: true, permissionsVerified: true, reason: "fixed-fixture-no-helper-secret" },
      resolve: async () => code,
    };
  }
  if (delivery !== "isolated-mock-mailbox") throw new Error("Unsupported isolated OTP delivery mode");

  const helperPath = String(env[HELPER_PATH_ENV] || "").trim();
  const secretFile = String(env[HELPER_SECRET_FILE_ENV] || "").trim();
  if (!path.isAbsolute(helperPath)) throw new Error("OTP mailbox helper must use an absolute path");
  const helperStat = fs.statSync(helperPath);
  if (!helperStat.isFile()) throw new Error("OTP mailbox helper path is not a file");
  const secretFileSecurity = validateSecretFile(secretFile);

  const allowed = exactFixtureOtpAllowlist(fixture);
  if (!fixture?.accounts?.registration?.email || !fixture?.accounts?.registration?.initialPassword) {
    throw new Error("Random mailbox mode requires an exact one-run registration fixture");
  }
  const consumedDeliveries = new Set();
  const consumedCodes = new Set();
  return {
    mode: delivery,
    secretFileSecurity,
    resolve: async ({ email, purpose, issuedAfter }) => {
      const normalizedEmail = normalizeEmail(email);
      const normalizedPurpose = normalizePurpose(purpose);
      const issuedAfterMs = Number(issuedAfter);
      if (!allowed.has(`${normalizedEmail}\n${normalizedPurpose}`)) throw new Error("OTP subject or purpose is not in the exact fixture allowlist");
      const requestedAt = now();
      if (!Number.isFinite(issuedAfterMs) || issuedAfterMs <= 0 || issuedAfterMs > requestedAt) {
        throw new Error("OTP issuedAfter is invalid");
      }
      const response = await invokeMailboxHelper({
        helperPath,
        secretFile,
        sourceEnv: env,
        spawnImpl,
        request: { email: normalizedEmail, purpose: normalizedPurpose, issuedAfter: issuedAfterMs },
      });
      if (!response || response.ok !== true) throw new Error("OTP mailbox helper did not return a code");
      const code = String(response.code || "").trim();
      const responseEmail = normalizeEmail(response.email);
      const responsePurpose = normalizePurpose(response.purpose);
      const deliveryId = String(response.deliveryId || "").trim();
      const issuedAt = Number(response.issuedAt);
      const expiresAt = Number(response.expiresAt);
      const receivedAt = now();
      if (!/^\d{6}$/.test(code)) throw new Error("OTP mailbox helper returned an invalid code");
      if (responseEmail !== normalizedEmail || responsePurpose !== normalizedPurpose) throw new Error("OTP mailbox helper returned a mismatched subject");
      if (!deliveryId || consumedDeliveries.has(deliveryId)) throw new Error("OTP mailbox helper returned a reused delivery");
      if (!Number.isFinite(issuedAt) || issuedAt < issuedAfterMs) throw new Error("OTP mailbox helper returned an older delivery");
      if (issuedAt > receivedAt) throw new Error("OTP mailbox helper returned a future delivery");
      if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("OTP mailbox helper returned an invalid delivery lifetime");
      if (expiresAt <= receivedAt) throw new Error("OTP mailbox helper returned an expired delivery");
      if (consumedCodes.has(code)) throw new Error("OTP mailbox helper returned a reused code");
      consumedDeliveries.add(deliveryId);
      consumedCodes.add(code);
      return code;
    },
  };
}

module.exports = {
  HELPER_PATH_ENV,
  HELPER_SECRET_FILE_ENV,
  HELPER_SECRET_CHILD_ENV,
  createAccountFusionOtpResolver,
  exactFixtureOtpAllowlist,
  sanitizeOtpHelperEnv,
  validateSecretFile,
};
