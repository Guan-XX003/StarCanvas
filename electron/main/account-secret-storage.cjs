// Account credentials must never initialize synchronous OSCrypt on the UI thread.
// Electron 42's asynchronous encryptor keeps OS authorization off that thread.
// The legacy local format is read-only compatibility, not a silent new fallback.
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("./electron-refs.cjs");
const { decryptLocalSecret } = require("./local-secret-storage.cjs");

const OPERATION_TIMEOUT_MS = 8000;
const LOCAL_PREFIX = "wanjuan-local-v1.";
let mode = "unchecked";
let availability = null;
let nativeOperation = null;

function macHelper() {
  // Unpackaged helper use is restricted to an explicit isolated QA scope.
  return process.platform === "darwin" && (app?.isPackaged === true || process.env?.STARCANVAS_DEV_KEYCHAIN_QA === "1")
    ? require("./macos-account-secret.cjs") : null;
}

function storageError(code) {
  const error = new Error(code === "SECURE_STORAGE_BUSY"
    ? "系统安全存储操作仍在处理中，登录令牌未保存；请稍后重试，本地项目不受影响"
    : code === "SECURE_STORAGE_TIMEOUT"
    ? "系统安全存储操作超时，登录令牌未保存；请稍后重试，本地项目不受影响"
    : "系统安全存储暂不可用，登录令牌未保存；请更新应用或稍后重试");
  error.code = code;
  return error;
}

function withDeadline(promise) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      mode = "unavailable";
      reject(storageError("SECURE_STORAGE_TIMEOUT"));
    }, OPERATION_TIMEOUT_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function secretStorageMode() {
  // Pure status read: no Keychain probe, filesystem write, or native API call.
  return nativeOperation ? "pending" : mode;
}

function assertNoNativeOperation() {
  if (nativeOperation) throw storageError("SECURE_STORAGE_BUSY");
}

async function runNativeOperation(operation) {
  assertNoNativeOperation();
  mode = "pending";
  const pending = Promise.resolve().then(operation);
  nativeOperation = pending;
  // The caller's deadline must NOT release this slot. Only native settlement
  // can do so. Do not queue/replay operations or share ciphertext across inputs.
  pending.then(() => {
    if (nativeOperation === pending) { nativeOperation = null; mode = "system"; }
  }, () => {
    if (nativeOperation === pending) { nativeOperation = null; mode = "unavailable"; }
  });
  return withDeadline(pending);
}

async function initialize() {
  mode = "pending";
  if (!availability) {
    if (typeof safeStorage?.isAsyncEncryptionAvailable !== "function"
        || typeof safeStorage?.encryptStringAsync !== "function"
        || typeof safeStorage?.decryptStringAsync !== "function") {
      mode = "unavailable";
      throw storageError("SECURE_STORAGE_ASYNC_UNSUPPORTED");
    }
    mode = "pending";
    const pending = Promise.resolve().then(() => safeStorage.isAsyncEncryptionAvailable()).then(value => {
      // Chromium basic_text is not an OS-protected credential store.
      const basicText = process.platform === "linux"
        && safeStorage.getSelectedStorageBackend?.() === "basic_text";
      mode = value === true && !basicText ? "system" : "unavailable";
      if (mode !== "system") throw storageError("SECURE_STORAGE_UNAVAILABLE");
    }).catch(() => {
      mode = "unavailable";
      if (availability === pending) availability = null;
      throw storageError("SECURE_STORAGE_UNAVAILABLE");
    });
    availability = pending;
  }
  // Timeout does not cancel or duplicate a still-live OS authorization request.
  // A later explicit operation may reuse it or observe its eventual completion.
  await withDeadline(availability);
  mode = "system";
}

async function encryptSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  assertNoNativeOperation();
  const helper = macHelper();
  if (helper) {
    try {
      return await runNativeOperation(async () => helper.ciphertextPrefix + await helper.request("encrypt", text));
    } catch (error) {
      mode = "unavailable";
      if (error?.code?.startsWith("SECURE_STORAGE_")) throw error;
      throw storageError("SECURE_STORAGE_UNAVAILABLE");
    }
  }
  await initialize();
  try {
    const encrypted = await runNativeOperation(async () => {
      const value = await safeStorage.encryptStringAsync(text);
      if (!Buffer.isBuffer(value) || !value.length) throw storageError("SECURE_STORAGE_UNAVAILABLE");
      return value.toString("base64");
    });
    mode = "system";
    return encrypted;
  } catch (error) {
    mode = "unavailable";
    if (error?.code?.startsWith("SECURE_STORAGE_")) throw error;
    throw storageError("SECURE_STORAGE_UNAVAILABLE");
  }
}

async function decryptSecret(value) {
  const encoded = String(value || "");
  if (!encoded) return "";
  if (encoded.startsWith(LOCAL_PREFIX)) {
    // Do not create a replacement key when the old local key is absent/damaged.
    const file = path.join(app.getPath("userData"), ".wanjuan-local-secret-key");
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32) throw new Error();
      return decryptLocalSecret(encoded);
    } catch {
      throw storageError("SECURE_STORAGE_LEGACY_KEY_UNAVAILABLE");
    }
  }
  assertNoNativeOperation();
  const helper = macHelper();
  if (helper) {
    // Existing Electron-Keychain ciphertext cannot safely be migrated across
    // changed ad-hoc identities. Preserve it and require a fresh login.
    if (!encoded.startsWith(helper.ciphertextPrefix)) throw helper.helperError("SECURE_STORAGE_RELOGIN_REQUIRED");
    try {
      return await runNativeOperation(() => helper.request("decrypt", encoded.slice(helper.ciphertextPrefix.length)));
    } catch (error) {
      mode = "unavailable";
      if (error?.code?.startsWith("SECURE_STORAGE_")) throw error;
      throw storageError("SECURE_STORAGE_UNAVAILABLE");
    }
  }
  await initialize();
  try {
    const result = await runNativeOperation(async () => {
      const value = await safeStorage.decryptStringAsync(Buffer.from(encoded, "base64"));
      if (typeof value?.result !== "string") throw storageError("SECURE_STORAGE_UNAVAILABLE");
      return value.result;
    });
    mode = "system";
    return result;
  } catch (error) {
    mode = "unavailable";
    if (error?.code?.startsWith("SECURE_STORAGE_")) throw error;
    throw storageError("SECURE_STORAGE_UNAVAILABLE");
  }
}

module.exports = { decryptSecret, encryptSecret, secretStorageMode };
