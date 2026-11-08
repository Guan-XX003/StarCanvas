// Account and private-workspace boundary. Secrets stay in the main process and are
// encrypted with Electron safeStorage; renderer callers receive sanitized state only.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { app } = require("./electron-refs.cjs");
const { decryptSecret, encryptSecret, secretStorageMode } = require("./account-secret-storage.cjs");
const { readOrCreateAccountDevice } = require("./account-device.cjs");
const {
  clearEnterpriseGatewayLocalState,
  completeEnterpriseGatewayActivation,
  getEnterpriseGatewayManagementSnapshot,
  getEnterpriseGatewayStatus,
  initializeEnterpriseGateway,
  invokeEnterpriseTeamTemplatesAsHost,
  publishEnterpriseGatewaySnapshot,
  startEnterpriseGateway,
  stopEnterpriseGateway,
  syncGatewayControlPlane,
} = require("./enterprise-gateway.cjs");
const {
  clearEnterpriseSnapshotCache,
  readEnterpriseSnapshotCache,
  requestPinnedJson,
  requestPinnedUpload,
  writeEnterpriseSnapshotCache,
} = require("./enterprise-gateway-client.cjs");
const { createEnterpriseUploadSource } = require("./enterprise-upload-source.cjs");
const { withPreparedCloudAsset } = require("./assets/cloud-project-media.cjs");
const {
  normalizeEnterpriseTeamConflictDetails,
  normalizeEnterpriseTeamTemplateResponse,
  sanitizeEnterpriseTeamTemplateInput,
} = require("../shared/enterprise-team-template-contract.cjs");

const ACCOUNT_STATE_VERSION = 3;
const ACCOUNT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
const WANJUAN_ACCOUNT_DEFAULT_API_URL = "https://account.guancn.uk";
const WANJUAN_MANAGED_RELAY_PLACEHOLDER = "__WANJUAN_MANAGED_RELAY__";
const WANJUAN_MANAGED_RELAY_HOST = "jixing.guancn.uk";
const SESSION_INVALID_CODES = new Set([
  "ACCOUNT_DISABLED",
  "DEVICE_REVOKED",
  "SESSION_REVOKED",
  "INVALID_ACCESS_TOKEN",
  "INVALID_REFRESH_TOKEN",
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_REPLAY",
]);

let accessToken = "";
let accountStateCache = null;
let refreshPromise = null;
let refreshPromiseEpoch = -1;
let accountLifecycleEpoch = 0;
let enterpriseLifecycleEpoch = 0;
let accountOrganizationsCache = [];
let managedRelayBootstrapTimer = null;
let managedRelayBootstrapAttempt = 0;
const PUBLIC_CAPABILITIES_MAX_ATTEMPTS = 2;
const publicCapabilitiesCacheByBaseUrl = new Map();
const publicCapabilitiesPromiseByBaseUrl = new Map();
const activeCloudUploads = new Set();

function advanceAccountLifecycle() {
  accountLifecycleEpoch += 1;
  for (const controller of activeCloudUploads) controller.abort();
  activeCloudUploads.clear();
  if (managedRelayBootstrapTimer) clearTimeout(managedRelayBootstrapTimer);
  managedRelayBootstrapTimer = null;
  managedRelayBootstrapAttempt = 0;
  return accountLifecycleEpoch;
}

function advanceEnterpriseLifecycle() {
  enterpriseLifecycleEpoch += 1;
  return enterpriseLifecycleEpoch;
}

function enterpriseScopeKey(enterprise) {
  if (!enterprise || typeof enterprise !== "object") return "";
  return [
    enterprise.mode || "",
    enterprise.organization?.id || "",
    enterprise.gatewayId || "",
    enterprise.gatewayUrl || "",
    enterprise.certificateFingerprint || "",
  ].map((value) => String(value)).join("\n");
}

function assertCurrentEnterpriseSecret(enterprise, expectedEpoch) {
  if (expectedEpoch !== enterpriseLifecycleEpoch
      || enterpriseScopeKey(enterprise) !== enterpriseScopeKey(readAccountState().enterprise)) {
    throw new AccountRequestError("企业连接已变更，已忽略过期操作", {
      status: 409, code: "ENTERPRISE_SESSION_CHANGED",
    });
  }
}

function assertCurrentAccountLifecycle(expectedEpoch) {
  if (expectedEpoch !== accountLifecycleEpoch) {
    throw new AccountRequestError("账号已切换，已忽略过期响应", {
      status: 409,
      code: "ACCOUNT_SESSION_CHANGED",
    });
  }
}

// Captures the exact login lifecycle, including logout and re-login to the same account.
function createAccountOperationGuard() {
  const epoch = accountLifecycleEpoch;
  return () => assertCurrentAccountLifecycle(epoch);
}

class AccountRequestError extends Error {
  constructor(message, options = {}) {
    super(String(message || "账号服务请求失败"));
    this.name = "AccountRequestError";
    this.status = Number(options.status || 0);
    this.code = String(options.code || "ACCOUNT_REQUEST_FAILED");
    this.network = options.network === true;
    this.details = options.details && typeof options.details === "object" ? options.details : null;
  }
}

function accountStatePath() {
  return path.join(app.getPath("userData"), "account-session.json");
}

function defaultAccountState() {
  return {
    version: ACCOUNT_STATE_VERSION,
    // 新安装默认进入本地模式；账号登录必须由用户主动触发。
    onboardingComplete: true,
    localMode: true,
    user: null,
    subscription: null,
    entitlements: [],
    wallet: null,
    relay: null,
    featureFlags: null,
    relayManagedKeyEncrypted: "",
    device: null,
    session: null,
    enterprise: null,
    updatedAt: 0,
    lastVerifiedAt: 0,
  };
}

function readAccountState() {
  if (accountStateCache) return accountStateCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(accountStatePath(), "utf8"));
    accountStateCache = { ...defaultAccountState(), ...(parsed || {}) };
  } catch {
    accountStateCache = defaultAccountState();
  }
  // 旧版未登录状态曾要求 onboarding；升级后统一回到可操作本地模式，
  // 不自动打开账号界面，也不影响已有登录会话。
  if (!accountStateCache.user && !accountStateCache.session?.refreshTokenEncrypted) {
    accountStateCache.onboardingComplete = true;
    accountStateCache.localMode = true;
  }
  return accountStateCache;
}

function writeAccountState(patch = {}) {
  const next = {
    ...readAccountState(),
    ...patch,
    version: ACCOUNT_STATE_VERSION,
    updatedAt: Date.now(),
  };
  const target = accountStatePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, target);
  accountStateCache = next;
  return next;
}

function canEncryptSecrets() {
  return ["system", "local"].includes(secretStorageMode());
}

function isPrivateLanHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (["127.0.0.1", "localhost", "::1"].includes(host) || host.endsWith(".local")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function normalizeBaseUrl(value, options = {}) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const parsed = new URL(raw);
  const allowLocalhostHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  const allowPrivateHttp = options.allowPrivateHttp === true && parsed.protocol === "http:" && isPrivateLanHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !allowLocalhostHttp && !allowPrivateHttp) {
    throw new Error(options.allowPrivateHttp ? "企业网关必须使用 HTTPS 或局域网私有地址" : "账号服务必须使用 HTTPS；开发环境仅允许 localhost HTTP");
  }
  return parsed.href.replace(/\/$/, "");
}

function accountApiUrl() {
  try {
    return normalizeBaseUrl(process.env.WANJUAN_ACCOUNT_API_URL || WANJUAN_ACCOUNT_DEFAULT_API_URL);
  } catch {
    return "";
  }
}

function sanitizeAccountState(state = readAccountState(), extra = {}) {
  const now = Date.now();
  const authenticated = extra.requiresLogin !== true && !!state.user && (!!accessToken || !!state.session?.refreshTokenEncrypted);
  const offlineGraceUntil = Number(state.lastVerifiedAt || 0) + DEFAULT_OFFLINE_GRACE_MS;
  const gatewayHost = getEnterpriseGatewayStatus();
  const ownedEnterprises = accountOrganizationsCache.filter((item) =>
    item.role === "owner" && item.organizationType === "self_hosted" && item.membershipStatus === "active"
  );
  const ownedEnterprise = ownedEnterprises.find((item) => item.id === gatewayHost.organizationId) || ownedEnterprises[0] || null;
  return {
    ok: true,
    serviceConfigured: !!accountApiUrl(),
    secureStorageAvailable: canEncryptSecrets(),
    secureStorageMode: secretStorageMode(),
    onboardingComplete: state.onboardingComplete === true,
    localMode: state.localMode === true,
    authenticated,
    offline: !!extra.offline,
    offlineGraceUntil,
    offlineGraceActive: authenticated && now <= offlineGraceUntil,
    user: state.user || null,
    subscription: state.subscription || null,
    entitlements: Array.isArray(state.entitlements) ? state.entitlements : [],
    wallet: normalizeWallet(state.wallet),
    relay: normalizeRelayMetadata(state.relay),
    featureFlags: normalizeAccountFeatureFlags(state.featureFlags, state.relay, state.wallet),
    device: state.device || null,
    enterprise: state.enterprise ? {
      mode: state.enterprise.mode || "member",
      organization: state.enterprise.organization || null,
      gatewayId: state.enterprise.gatewayId || "",
      gatewayUrl: state.enterprise.gatewayUrl || "",
      certificateFingerprint: state.enterprise.certificateFingerprint || "",
      connectedAt: state.enterprise.connectedAt || 0,
      lastVerifiedAt: state.enterprise.lastVerifiedAt || 0,
      expiresAt: Number(state.enterprise.expiresAt || 0),
      connected: state.enterprise.mode === "host" ? gatewayHost.initialized :
        !!state.enterprise.workspaceTokenEncrypted && Number(state.enterprise.expiresAt || 0) > now,
    } : null,
    enterpriseSnapshot: state.enterprise?.mode === "member" ? readEnterpriseSnapshotCache()?.snapshot || null : null,
    gatewayHost,
    ownedEnterprise,
    requiresLogin: extra.requiresLogin === true,
    error: extra.error || "",
    errorCode: extra.errorCode || "",
    errorStatus: Number(extra.errorStatus || 0),
  };
}

function reconcileLocalGatewayHostState(state = readAccountState()) {
  const gatewayHost = getEnterpriseGatewayStatus();
  if (!gatewayHost.initialized || !gatewayHost.organizationId || !gatewayHost.gatewayId) return state;

  const ownedEnterprise = accountOrganizationsCache.find((item) =>
    item.id === gatewayHost.organizationId &&
    item.role === "owner" &&
    item.organizationType === "self_hosted" &&
    item.membershipStatus === "active"
  );
  if (!ownedEnterprise) return state;

  // Never revive a stale local identity after another computer has taken over.
  if (ownedEnterprise.gatewayId && ownedEnterprise.gatewayId !== gatewayHost.gatewayId) return state;
  if (
    ownedEnterprise.certificateFingerprint &&
    gatewayHost.certificateFingerprint &&
    ownedEnterprise.certificateFingerprint !== gatewayHost.certificateFingerprint
  ) return state;

  const current = state.enterprise;
  const alreadyCurrent =
    current?.mode === "host" &&
    String(current.organization?.id || "") === gatewayHost.organizationId &&
    String(current.gatewayId || "") === gatewayHost.gatewayId;
  if (alreadyCurrent) return state;

  // An explicitly connected membership for another organization remains authoritative.
  const activeMemberConnection =
    current?.mode === "member" &&
    String(current.organization?.id || "") !== gatewayHost.organizationId &&
    !!current.workspaceTokenEncrypted &&
    Number(current.expiresAt || 0) > Date.now();
  if (activeMemberConnection) return state;

  return writeAccountState({
    enterprise: {
      mode: "host",
      organization: { ...ownedEnterprise, role: "owner" },
      gatewayId: gatewayHost.gatewayId,
      gatewayUrl: gatewayHost.preferredUrl,
      connectedAt: Number(current?.connectedAt || gatewayHost.createdAt || Date.now()),
      lastVerifiedAt: Date.now(),
      expiresAt: 0,
    },
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const url = `${normalizeBaseUrl(baseUrl, { allowPrivateHttp: options.allowPrivateHttp === true })}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || ACCOUNT_REQUEST_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "");
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      throw new AccountRequestError(payload?.error || payload?.message || `请求失败 (${response.status})`, {
        status: response.status,
        code: payload?.code || `HTTP_${response.status}`,
        details: payload?.details && typeof payload.details === "object" ? payload.details : payload,
      });
    }
    return payload || {};
  } catch (error) {
    if (error instanceof AccountRequestError) throw error;
    if (error?.name === "AbortError") {
      throw new AccountRequestError("连接服务超时", { code: "ACCOUNT_REQUEST_TIMEOUT", network: true });
    }
    throw new AccountRequestError(error?.message || "无法连接账号服务", {
      code: "ACCOUNT_NETWORK_ERROR",
      network: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isSessionInvalidError(error) {
  return SESSION_INVALID_CODES.has(String(error?.code || ""));
}

function isOfflineEligibleError(error) {
  return error?.network === true || Number(error?.status || 0) >= 500
    || String(error?.code || "").startsWith("SECURE_STORAGE_");
}

function clearInvalidAccountSession(error) {
  advanceAccountLifecycle();
  advanceEnterpriseLifecycle();
  accessToken = "";
  accountOrganizationsCache = [];
  stopEnterpriseGateway({ disableAutoStart: true }).catch(() => {});
  clearEnterpriseSnapshotCache();
  const next = writeAccountState({
    localMode: true,
    user: null,
    subscription: null,
    entitlements: [],
    wallet: null,
    relay: null,
    featureFlags: null,
    relayManagedKeyEncrypted: "",
    device: null,
    session: null,
    enterprise: null,
    lastVerifiedAt: 0,
  });
  return sanitizeAccountState(next, {
    requiresLogin: true,
    error: error?.message || "登录状态已失效，请重新登录",
    errorCode: error?.code || "SESSION_REVOKED",
    errorStatus: error?.status || 401,
  });
}

async function applyAccountPayload(payload = {}, tokens = {}, expectedEpoch = accountLifecycleEpoch) {
  const refreshToken = String(tokens.refreshToken || payload.refreshToken || "");
  const managedKey = extractManagedRelayKey(payload);
  // Encrypt before changing the session. Recheck identity after the async native
  // boundary so logout/account-switch cannot be undone by a late completion.
  const encryptedRefresh = refreshToken ? await encryptSecret(refreshToken) : "";
  const encryptedManaged = managedKey ? await encryptSecret(managedKey) : "";
  assertCurrentAccountLifecycle(expectedEpoch);
  const state = readAccountState();
  const previousUserId = String(state.user?.id || "");
  const incomingUserId = String(payload.user?.id || "");
  const identityChanged = Boolean(previousUserId && incomingUserId && previousUserId !== incomingUserId);
  accessToken = String(tokens.accessToken || payload.accessToken || accessToken || "");
  const session = refreshToken ? {
    refreshTokenEncrypted: encryptedRefresh,
    issuedAt: Date.now(),
  } : state.session;
  const next = writeAccountState({
    onboardingComplete: true,
    localMode: false,
    user: payload.user || state.user || null,
    subscription: payload.subscription || (identityChanged ? null : state.subscription) || null,
    entitlements: Array.isArray(payload.entitlements) ? payload.entitlements : identityChanged ? [] : state.entitlements || [],
    wallet: normalizeWallet(payload.wallet) || (identityChanged ? null : state.wallet) || null,
    relay: normalizeRelayMetadata(payload.relay) || (identityChanged ? null : state.relay) || null,
    featureFlags: normalizeAccountFeatureFlags(
      payload.featureFlags || payload.feature_flags || payload.features || (identityChanged ? null : state.featureFlags),
      payload.relay || (identityChanged ? null : state.relay),
      payload.wallet || (identityChanged ? null : state.wallet),
    ),
    device: payload.device || (identityChanged ? null : state.device) || null,
    session,
    enterprise: identityChanged ? null : state.enterprise,
    relayManagedKeyEncrypted: identityChanged ? "" : state.relayManagedKeyEncrypted,
    lastVerifiedAt: Date.now(),
  });
  if (identityChanged) {
    clearEnterpriseSnapshotCache();
    accountOrganizationsCache = [];
  }
  if (managedKey) return writeAccountState({ relayManagedKeyEncrypted: encryptedManaged });
  return next;
}

async function performRefreshAccountSession(expectedEpoch = accountLifecycleEpoch) {
  const baseUrl = accountApiUrl();
  const state = readAccountState();
  const encryptedRefreshToken = String(state.session?.refreshTokenEncrypted || "");
  const refreshToken = await decryptSecret(state.session?.refreshTokenEncrypted);
  assertCurrentAccountLifecycle(expectedEpoch);
  if (!baseUrl || !refreshToken) return sanitizeAccountState(state);
  let payload;
  try {
    payload = await requestJson(baseUrl, "/auth/refresh", {
      method: "POST",
      body: { refreshToken },
    });
  } catch (error) {
    assertCurrentAccountLifecycle(expectedEpoch);
    throw error;
  }
  if (
    expectedEpoch !== accountLifecycleEpoch ||
    String(readAccountState().session?.refreshTokenEncrypted || "") !== encryptedRefreshToken
  ) {
    return sanitizeAccountState(readAccountState());
  }
  const next = await applyAccountPayload(payload, {}, expectedEpoch);
  return sanitizeAccountState(next);
}

async function refreshAccountSession() {
  const expectedEpoch = accountLifecycleEpoch;
  if (!refreshPromise || refreshPromiseEpoch !== expectedEpoch) {
    const pending = performRefreshAccountSession(expectedEpoch).finally(() => {
      if (refreshPromise === pending) {
        refreshPromise = null;
        refreshPromiseEpoch = -1;
      }
    });
    refreshPromise = pending;
    refreshPromiseEpoch = expectedEpoch;
  }
  return refreshPromise;
}

async function requestWithAccountAuth(baseUrl, pathname, options = {}) {
  const expectedEpoch = accountLifecycleEpoch;
  if (!accessToken && readAccountState().session?.refreshTokenEncrypted) {
    await refreshAccountSession();
    assertCurrentAccountLifecycle(expectedEpoch);
  }
  if (!accessToken) throw new AccountRequestError("请先登录StarCanvas账号", { status: 401, code: "AUTH_REQUIRED" });
  try {
    const result = await requestJson(baseUrl, pathname, { ...options, token: accessToken });
    assertCurrentAccountLifecycle(expectedEpoch);
    return result;
  } catch (error) {
    assertCurrentAccountLifecycle(expectedEpoch);
    if (options.retryAfterRefresh === false || String(error?.code || "") !== "ACCESS_TOKEN_EXPIRED") throw error;
    await refreshAccountSession();
    assertCurrentAccountLifecycle(expectedEpoch);
    const result = await requestJson(baseUrl, pathname, { ...options, retryAfterRefresh: false, token: accessToken });
    assertCurrentAccountLifecycle(expectedEpoch);
    return result;
  }
}

async function boundedCloudJson(response) {
  const stated = response.headers.get("content-length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) > 65536)) {
    throw new AccountRequestError("云素材服务响应过大", { code: "CLOUD_RESPONSE_INVALID" });
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const pieces = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new AccountRequestError("云素材服务响应过大", { code: "CLOUD_RESPONSE_INVALID" });
      pieces.push(Buffer.from(part.value));
    }
    const value = JSON.parse(Buffer.concat(pieces).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch (error) {
    if (error instanceof AccountRequestError) throw error;
    throw new AccountRequestError("云素材服务响应无效", { code: "CLOUD_RESPONSE_INVALID" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Main-process only: roots and source must be derived from a trusted project
// selection, never from a renderer-provided arbitrary root. No IPC exposure yet.
async function uploadCloudProjectAsset({ sourcePath, allowedRoots, stagingRoot, maxBytes,
  expectedSha256, expectedSize, reservationId = crypto.randomUUID(), timeoutMs = 600000 } = {}) {
  if (typeof reservationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reservationId) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) {
    throw new AccountRequestError("云素材参数无效", { code: "CLOUD_UPLOAD_ARGUMENT_INVALID" });
  }
  const expectedEpoch = accountLifecycleEpoch;
  const baseUrl = accountApiUrl();
  const account = readAccountState();
  if (!baseUrl || !account.user || (!accessToken && !account.session?.refreshTokenEncrypted)) {
    throw new AccountRequestError("请先登录StarCanvas账号", { code: "AUTH_REQUIRED", status: 401 });
  }
  const controller = new AbortController();
  activeCloudUploads.add(controller);
  let timeout = null;
  try {
    const outcome = await withPreparedCloudAsset({ sourcePath, allowedRoots, stagingRoot, maxBytes, expectedSha256, expectedSize },
      async ({ stagedPath, sha256, size }) => {
        try {
          assertCurrentAccountLifecycle(expectedEpoch);
          const reservation = await requestWithAccountAuth(baseUrl, "/cloud-projects/blobs/reserve", {
            method: "POST", body: { sha256, size, reservationId },
          });
          assertCurrentAccountLifecycle(expectedEpoch);
          if (reservation.status === "ready") return { value: { sha256, size, reservationId, alreadyPresent: true } };
          if (reservation.status !== "reserved") throw new AccountRequestError("云素材预占响应无效", { code: "CLOUD_RESPONSE_INVALID" });
          timeout = setTimeout(() => controller.abort(), timeoutMs);
          const attempt = async () => {
            assertCurrentAccountLifecycle(expectedEpoch);
            if (!accessToken) throw new AccountRequestError("请先登录StarCanvas账号", { code: "AUTH_REQUIRED", status: 401 });
            // Cloudflare Free limits each request body to 100 MB. Segment the
            // network transfer itself (not just renderer IPC) while retaining
            // one account-scoped reservation and one verified blob identity.
            const partBytes = 32 * 1024 * 1024;
            if (size > partBytes) {
              let offset = 0;
              while (offset < size) {
                assertCurrentAccountLifecycle(expectedEpoch);
                const count = Math.min(partBytes, size - offset);
                const stream = fs.createReadStream(stagedPath, { start: offset, end: offset + count - 1 });
                try {
                  const response = await fetch(`${baseUrl}/cloud-projects/blobs/${sha256}/parts`, {
                    method: "PUT", redirect: "error", signal: controller.signal, duplex: "half", body: stream,
                    headers: { accept: "application/json", authorization: `Bearer ${accessToken}`,
                      "content-type": "application/octet-stream", "content-length": String(count),
                      "x-upload-reservation": reservationId, "x-upload-total": String(size),
                      "x-upload-offset": String(offset) },
                  });
                  const payload = await boundedCloudJson(response);
                  if (!response.ok) {
                    const code = typeof payload.code === "string" && /^[A-Z0-9_]{1,80}$/.test(payload.code)
                      ? payload.code : `HTTP_${response.status}`;
                    throw new AccountRequestError("云素材上传失败", { status: response.status, code });
                  }
                  if (!Number.isSafeInteger(payload.offset) || payload.offset <= offset || payload.offset > size ||
                      !((payload.status === "partial" && payload.offset < size) ||
                        (payload.status === "ready" && payload.offset === size))) {
                    throw new AccountRequestError("云素材响应无效", { code: "CLOUD_RESPONSE_INVALID" });
                  }
                  assertCurrentAccountLifecycle(expectedEpoch);
                  offset = payload.offset;
                  if (payload.status === "ready") return { sha256, size, reservationId, alreadyPresent: payload.replayed === true };
                } finally { stream.destroy(); }
              }
              throw new AccountRequestError("云素材响应无效", { code: "CLOUD_RESPONSE_INVALID" });
            }
            const stream = fs.createReadStream(stagedPath);
            try {
              const response = await fetch(`${baseUrl}/cloud-projects/blobs/${sha256}`, {
                method: "PUT", redirect: "error", signal: controller.signal, duplex: "half", body: stream,
                headers: { accept: "application/json", authorization: `Bearer ${accessToken}`,
                  "content-type": "application/octet-stream", "content-length": String(size),
                  "x-upload-reservation": reservationId },
              });
              const payload = await boundedCloudJson(response);
              if (!response.ok) {
                const code = typeof payload.code === "string" && /^[A-Z0-9_]{1,80}$/.test(payload.code)
                  ? payload.code : `HTTP_${response.status}`;
                throw new AccountRequestError("云素材上传失败", { status: response.status, code });
              }
              if (payload.status !== "ready") throw new AccountRequestError("云素材响应无效", { code: "CLOUD_RESPONSE_INVALID" });
              assertCurrentAccountLifecycle(expectedEpoch);
              return { sha256, size, reservationId, alreadyPresent: payload.replayed === true };
            } finally { stream.destroy(); }
          };
          try { return { value: await attempt() }; }
          catch (error) {
            assertCurrentAccountLifecycle(expectedEpoch);
            if (error?.code !== "ACCESS_TOKEN_EXPIRED") throw error;
            await refreshAccountSession();
            assertCurrentAccountLifecycle(expectedEpoch);
            return { value: await attempt() };
          }
        } catch (error) { return { error }; }
      });
    if (outcome.error) {
      assertCurrentAccountLifecycle(expectedEpoch);
      const code = /^[A-Z0-9_]{1,80}$/.test(String(outcome.error?.code || "")) ? outcome.error.code
        : controller.signal.aborted ? "CLOUD_UPLOAD_TIMEOUT" : "CLOUD_UPLOAD_FAILED";
      throw new AccountRequestError("云素材同步失败，请稍后重试", {
        code, status: Number(outcome.error?.status || 0),
        network: outcome.error?.network === true || code === "CLOUD_UPLOAD_TIMEOUT",
      });
    }
    assertCurrentAccountLifecycle(expectedEpoch);
    return outcome.value;
  } finally {
    if (timeout) clearTimeout(timeout);
    activeCloudUploads.delete(controller);
  }
}

// Main-process only. The callback may inspect the verified temporary file but
// must recheck the supplied session guard before publishing any local project.
// The file is removed on completion, failure, timeout or account change.
async function withDownloadedCloudProjectAsset({ sha256, size, stagingRoot, maxBytes, timeoutMs = 600000 } = {}, consume) {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || size > maxBytes ||
      typeof stagingRoot !== "string" || !path.isAbsolute(stagingRoot) || typeof consume !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) {
    throw new AccountRequestError("云素材参数无效", { code: "CLOUD_DOWNLOAD_ARGUMENT_INVALID" });
  }
  const expectedEpoch = accountLifecycleEpoch;
  const baseUrl = accountApiUrl();
  const account = readAccountState();
  if (!baseUrl || !account.user || (!accessToken && !account.session?.refreshTokenEncrypted)) {
    throw new AccountRequestError("请先登录StarCanvas账号", { code: "AUTH_REQUIRED", status: 401 });
  }
  const controller = new AbortController();
  activeCloudUploads.add(controller);
  let timeout, directory, filePath, file, identity, responseAccepted = false;
  try {
    const root = await fs.promises.realpath(stagingRoot);
    const rootStat = await fs.promises.lstat(stagingRoot);
    if (path.relative(root, path.resolve(stagingRoot)) !== "" || !rootStat.isDirectory() || rootStat.isSymbolicLink() ||
        (process.platform !== "win32" && (rootStat.uid !== process.getuid() || (rootStat.mode & 0o077) !== 0))) {
      throw new AccountRequestError("云素材暂存目录不可用", { code: "CLOUD_STAGING_UNSAFE" });
    }
    assertCurrentAccountLifecycle(expectedEpoch);
    if (!accessToken) {
      await refreshAccountSession();
      assertCurrentAccountLifecycle(expectedEpoch);
    }
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const attempt = async () => {
      assertCurrentAccountLifecycle(expectedEpoch);
      const response = await fetch(`${baseUrl}/cloud-projects/blobs/${sha256}`, {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/octet-stream" },
      });
      if (!response.ok) {
        const payload = await boundedCloudJson(response);
        const code = typeof payload.code === "string" && /^[A-Z0-9_]{1,80}$/.test(payload.code)
          ? payload.code : `HTTP_${response.status}`;
        throw new AccountRequestError("云素材下载失败", { status: response.status, code });
      }
      responseAccepted = true;
      const length = response.headers.get("content-length");
      if (!length || !/^\d+$/.test(length) || Number(length) !== size || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new AccountRequestError("云素材大小不匹配", { code: "CLOUD_INTEGRITY_FAILED" });
      }
      directory = await fs.promises.mkdtemp(path.join(root, "cloud-download-"));
      filePath = path.join(directory, "asset");
      file = await fs.promises.open(filePath, "wx", 0o600);
      identity = await file.stat({ bigint: true });
      const hash = crypto.createHash("sha256");
      const reader = response.body.getReader();
      let total = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          const bytes = Buffer.from(part.value);
          total += bytes.length;
          if (total > size) throw new AccountRequestError("云素材大小不匹配", { code: "CLOUD_INTEGRITY_FAILED" });
          hash.update(bytes);
          let offset = 0;
          while (offset < bytes.length) {
            const result = await file.write(bytes, offset, bytes.length - offset, null);
            if (!result.bytesWritten) throw new AccountRequestError("云素材暂存失败", { code: "CLOUD_STAGING_FAILED" });
            offset += result.bytesWritten;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (total !== size || hash.digest("hex") !== sha256) {
        throw new AccountRequestError("云素材校验失败", { code: "CLOUD_INTEGRITY_FAILED" });
      }
      await file.sync(); await file.close(); file = null;
      clearTimeout(timeout); timeout = null;
      assertCurrentAccountLifecycle(expectedEpoch);
      const value = await consume({ stagedPath: filePath, sha256, size, assertSessionActive: () => assertCurrentAccountLifecycle(expectedEpoch) });
      assertCurrentAccountLifecycle(expectedEpoch);
      return value;
    };
    try { return await attempt(); }
    catch (error) {
      assertCurrentAccountLifecycle(expectedEpoch);
      if (responseAccepted || error?.code !== "ACCESS_TOKEN_EXPIRED") throw error;
      await refreshAccountSession();
      assertCurrentAccountLifecycle(expectedEpoch);
      return await attempt();
    }
  } catch (error) {
    assertCurrentAccountLifecycle(expectedEpoch);
    if (error instanceof AccountRequestError) throw error;
    if (typeof error?.code === "string" && /^CLOUD_[A-Z0-9_]{1,74}$/.test(error.code)) {
      throw new AccountRequestError("云素材下载未完成", { code: error.code });
    }
    throw new AccountRequestError("云素材下载失败，请稍后重试", {
      code: controller.signal.aborted ? "CLOUD_DOWNLOAD_TIMEOUT" : "CLOUD_DOWNLOAD_FAILED",
      network: controller.signal.aborted,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    activeCloudUploads.delete(controller);
    if (file) await file.close().catch(() => { throw new AccountRequestError("云素材暂存清理失败", { code: "CLOUD_CLEANUP_UNSAFE" }); });
    if (filePath && identity) {
      try {
        const current = await fs.promises.lstat(filePath, { bigint: true });
        if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) {
          throw new AccountRequestError("云素材暂存清理失败", { code: "CLOUD_CLEANUP_UNSAFE" });
        }
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw new AccountRequestError("云素材暂存清理失败", { code: "CLOUD_CLEANUP_UNSAFE" });
      }
    }
    if (directory) await fs.promises.rmdir(directory).catch(() => { throw new AccountRequestError("云素材暂存清理失败", { code: "CLOUD_CLEANUP_UNSAFE" }); });
  }
}

function normalizeAccountOrganization(item = {}) {
  return {
    id: String(item.id || ""),
    name: String(item.name || ""),
    status: String(item.status || ""),
    organizationType: String(item.organizationType || item.organization_type || ""),
    timezone: String(item.timezone || "Asia/Shanghai"),
    policyVersion: Number(item.policyVersion || item.policy_version || 0),
    role: String(item.role || "member"),
    membershipStatus: String(item.membershipStatus || item.membership_status || "active"),
    gatewayId: String(item.gatewayId || item.gateway_id || ""),
    gatewayName: String(item.gatewayName || item.gateway_name || ""),
    gatewayStatus: String(item.gatewayStatus || item.gateway_status || ""),
    gatewayLastSeenAt: item.gatewayLastSeenAt || item.last_seen_at || null,
    configVersion: Number(item.configVersion || item.config_version || 0),
    configHash: String(item.configHash || item.config_hash || ""),
    certificateFingerprint: String(item.certificateFingerprint || item.certificate_fingerprint || ""),
  };
}

async function refreshAccountOrganizations(options = {}) {
  const expectedEpoch = accountLifecycleEpoch;
  if (!accessToken && !readAccountState().session?.refreshTokenEncrypted) {
    accountOrganizationsCache = [];
    return accountOrganizationsCache;
  }
  try {
    const response = await requestWithAccountAuth(accountApiUrl(), "/me/organizations");
    assertCurrentAccountLifecycle(expectedEpoch);
    accountOrganizationsCache = (Array.isArray(response.items) ? response.items : [])
      .map(normalizeAccountOrganization)
      .filter((item) => item.id);
  } catch (error) {
    if (options.required === true) throw error;
  }
  return accountOrganizationsCache;
}

async function getCurrentAccount() {
  const baseUrl = accountApiUrl();
  if (!baseUrl || (!accessToken && !readAccountState().session?.refreshTokenEncrypted)) return sanitizeAccountState();
  const expectedEpoch = accountLifecycleEpoch;
  try {
    const payload = await requestWithAccountAuth(baseUrl, "/me");
    assertCurrentAccountLifecycle(expectedEpoch);
    await applyAccountPayload(payload, {}, expectedEpoch);
    const current = readAccountState();
    const flags = normalizeAccountFeatureFlags(current.featureFlags, current.relay, current.wallet);
    if (managedRelayBootstrapEligible(current.relay) && flags.relayManagedConfig === true) {
      try { await getRelayAccount(); } catch (error) {
        if (isSessionInvalidError(error)) throw error;
        scheduleManagedRelayBootstrap();
      }
    }
    await refreshAccountOrganizations();
    return sanitizeAccountState(reconcileLocalGatewayHostState());
  } catch (error) {
    if (isSessionInvalidError(error)) return clearInvalidAccountSession(error);
    throw error;
  }
}

function normalizeRelayMetadata(value) {
  const source = value?.relay && typeof value.relay === "object" ? value.relay :
    value?.account && typeof value.account === "object" ? value.account : value;
  if (!source || typeof source !== "object") return null;
  return {
    status: String(source.status || "inactive"),
    managed: source.managed === true,
    keyMasked: String(source.keyMasked || source.key_masked || ""),
    keyVersion: String(source.keyVersion || source.key_version || ""),
  };
}

// Key reveal/rotation responses may intentionally contain only key metadata.
// Do not turn omitted account fields into inactive/ unmanaged state: doing so
// disables the next key action immediately after a successful reveal.
function mergeRelayMetadata(current, value) {
  const source = value?.relay && typeof value.relay === "object" ? value.relay :
    value?.account && typeof value.account === "object" ? value.account : value;
  if (!source || typeof source !== "object") return current || null;
  const has = (name, snake) => Object.prototype.hasOwnProperty.call(source, name) || Object.prototype.hasOwnProperty.call(source, snake);
  const next = { ...(current || {}) };
  if (has("status", "status")) next.status = String(source.status || "inactive");
  if (has("managed", "managed")) next.managed = source.managed === true;
  if (has("keyMasked", "key_masked")) next.keyMasked = String(source.keyMasked ?? source.key_masked ?? "");
  if (has("keyVersion", "key_version")) next.keyVersion = String(source.keyVersion ?? source.key_version ?? "");
  return next;
}

function normalizeWallet(value) {
  const source = value?.wallet && typeof value.wallet === "object" ? value.wallet : value;
  if (!source || typeof source !== "object") return null;
  return {
    enabled: source.enabled !== false,
    redeemEnabled: source.redeemEnabled ?? source.redeem_enabled,
    currency: String(source.currency || "CNY"),
    cashAmount: Number(source.cashAmount ?? source.cash_amount ?? 0),
    promoAmount: Number(source.promoAmount ?? source.promo_amount ?? 0),
    reservedAmount: Number(source.reservedAmount ?? source.reserved_amount ?? 0),
    availableAmount: Number(source.availableAmount ?? source.available_amount ?? 0),
    promoExpiresAt: source.promoExpiresAt || source.promo_expires_at || source.trialExpiresAt || source.trial_expires_at || null,
  };
}

function normalizeAccountFeatureFlags(value = {}, relayValue = {}, walletValue = {}) {
  const source = value && typeof value === "object" ? value : {};
  const relay = normalizeRelayMetadata(relayValue);
  const wallet = normalizeWallet(walletValue);
  const booleanValue = (camel, snake, fallback) =>
    typeof source[camel] === "boolean" ? source[camel] :
      typeof source[snake] === "boolean" ? source[snake] : fallback;
  const relayEnabledFallback = relay?.managed === true && relay?.status !== "disabled";
  const walletEnabledFallback = wallet ? wallet.enabled !== false : false;
  const publicCapabilitiesCache = publicCapabilitiesCacheByBaseUrl.get(accountApiUrl()) || null;
  const publicCapability = (name, fallback = false) =>
    typeof publicCapabilitiesCache?.[name] === "boolean" ? publicCapabilitiesCache[name] : fallback;
  return {
    passwordAuth: booleanValue("passwordAuth", "password_auth", publicCapability("passwordAuth", false)),
    passwordRegistration: booleanValue("passwordRegistration", "password_registration", publicCapability("passwordRegistration", false)),
    passwordReset: booleanValue("passwordReset", "password_reset", publicCapability("passwordReset", false)),
    relayLegacyLink: booleanValue("relayLegacyLink", "relay_legacy_link", publicCapability("relayLegacyLink", false)),
    relayAutoProvision: booleanValue("relayAutoProvision", "relay_auto_provision", relayEnabledFallback),
    relayManagedConfig: booleanValue("relayManagedConfig", "relay_managed_config", publicCapability("relayManagedConfig", relayEnabledFallback)),
    relayWalletUi: booleanValue("relayWalletUi", "relay_wallet_ui", publicCapability("relayWalletUi", walletEnabledFallback)),
    relayRedeem: booleanValue(
      "relayRedeem",
      "relay_redeem",
      publicCapability("relayRedeem", typeof wallet?.redeemEnabled === "boolean" ? wallet.redeemEnabled : walletEnabledFallback),
    ),
  };
}

function normalizePublicCapabilities(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const names = [
    "passwordAuth",
    "passwordRegistration",
    "passwordReset",
    "relayManagedConfig",
    "relayWalletUi",
    "relayRedeem",
    "relayAutoProvision",
    "relayLegacyLink",
  ];
  return Object.fromEntries(names.map((name) => [name, source[name] === true]));
}

async function refreshPublicCapabilities() {
  const baseUrl = accountApiUrl();
  if (!baseUrl) return normalizePublicCapabilities();
  if (publicCapabilitiesCacheByBaseUrl.has(baseUrl)) return publicCapabilitiesCacheByBaseUrl.get(baseUrl);
  if (publicCapabilitiesPromiseByBaseUrl.has(baseUrl)) return publicCapabilitiesPromiseByBaseUrl.get(baseUrl);
  const request = (async () => {
    for (let attempt = 1; attempt <= PUBLIC_CAPABILITIES_MAX_ATTEMPTS; attempt += 1) {
      try {
        const capabilities = normalizePublicCapabilities(
          await requestJson(baseUrl, "/public/capabilities", { timeoutMs: 2000 }),
        );
        publicCapabilitiesCacheByBaseUrl.set(baseUrl, capabilities);
        return capabilities;
      } catch (error) {
        if (attempt >= PUBLIC_CAPABILITIES_MAX_ATTEMPTS) break;
      }
    }
    // Fail closed without caching the failure. A later account open/bootstrap
    // may recover, while explicit false values from a successful response stay cached.
    return normalizePublicCapabilities();
  })().finally(() => {
    publicCapabilitiesPromiseByBaseUrl.delete(baseUrl);
  });
  publicCapabilitiesPromiseByBaseUrl.set(baseUrl, request);
  return request;
}

function requireAccountFeature(name, code) {
  const state = readAccountState();
  const flags = normalizeAccountFeatureFlags(state.featureFlags, state.relay, state.wallet);
  if (flags[name] !== true) {
    throw new AccountRequestError("该账号功能当前未开放", { status: 503, code });
  }
}

function managedRelayBootstrapEligible(relay = {}) {
  return relay?.managed === true && ["active", "pending", "retrying"].includes(String(relay?.status || ""));
}

function extractManagedRelayKey(payload = {}) {
  const source = payload?.relay && typeof payload.relay === "object" ? payload.relay : payload;
  return String(
    payload?.managedKey || payload?.managed_key || payload?.accessKey || payload?.access_key ||
    source?.managedKey || source?.managed_key || source?.accessKey || source?.access_key ||
    source?.key || source?.apiKey || source?.api_key || source?.relayKey || ""
  ).trim();
}

async function persistRelayResponse(payload = {}, { storeKey = false } = {}, expectedEpoch = accountLifecycleEpoch) {
  const fullKey = extractManagedRelayKey(payload);
  const encrypted = storeKey && fullKey ? await encryptSecret(fullKey) : "";
  assertCurrentAccountLifecycle(expectedEpoch);
  const state = readAccountState();
  const relay = mergeRelayMetadata(state.relay, payload) || normalizeRelayMetadata(payload) || null;
  const patch = { relay };
  if (storeKey && fullKey) patch.relayManagedKeyEncrypted = encrypted;
  if (!relay || relay.managed !== true || relay.status !== "active") patch.relayManagedKeyEncrypted = "";
  const next = writeAccountState(patch);
  return { next, fullKey };
}

function requireShortCode(value) {
  const code = String(value || "").trim();
  if (!/^[A-Za-z0-9-]{4,12}$/.test(code)) {
    throw new AccountRequestError("请输入有效验证码", { status: 400, code: "INVALID_VERIFICATION_CODE" });
  }
  return code;
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 120) {
    throw new AccountRequestError("请重新发起该操作", { status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
  return key;
}

function requireRelayLinkIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._~-]{16,160}$/.test(key)) {
    throw new AccountRequestError("请重新发起账号绑定", { status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
  return key;
}

function requireLegacyCredential(value, label) {
  const text = String(value || "");
  if (!text || text.length > 320 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AccountRequestError(`旧极鑫${label}无效`, { status: 400, code: "INVALID_REQUEST" });
  }
  return text;
}

function buildAccountListPath(pathname, filters = {}, allowedFilters = []) {
  const query = new URLSearchParams();
  const cursor = String(filters.cursor || "").trim();
  if (cursor) query.set("cursor", cursor.slice(0, 1000));
  query.set("limit", String(Math.max(1, Math.min(100, Math.floor(Number(filters.limit || 30))))));
  allowedFilters.forEach((key) => {
    const value = String(filters[key] || "").trim();
    if (value) query.set(key, value.slice(0, 160));
  });
  return `${pathname}?${query.toString()}`;
}

async function getRelayAccount() {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const payload = await requestWithAccountAuth(accountApiUrl(), "/relay/account", {
    headers: managedRelayCredentialHeaders(),
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  const { next: relayState } = await persistRelayResponse(payload, { storeKey: true }, expectedEpoch);
  const next = writeAccountState({
    featureFlags: normalizeAccountFeatureFlags(
      payload.featureFlags || payload.feature_flags || payload.features || relayState.featureFlags,
      relayState.relay,
      relayState.wallet,
    ),
  });
  if (managedRelayBootstrapTimer) clearTimeout(managedRelayBootstrapTimer);
  managedRelayBootstrapTimer = null;
  // A successful HTTP response can still mean the asynchronous account is
  // pending. Continue at a bounded rate until activation, not merely HTTP 200.
  if (["pending", "retrying"].includes(String(next.relay?.status || "")) && next.featureFlags?.relayManagedConfig === true) {
    scheduleManagedRelayBootstrap();
  } else {
    managedRelayBootstrapAttempt = 0;
  }
  return { ok: true, relay: sanitizeAccountState(next).relay };
}

function scheduleManagedRelayBootstrap() {
  if (managedRelayBootstrapTimer) return;
  const delay = Math.min(30_000, 1_000 * (2 ** managedRelayBootstrapAttempt));
  const expectedEpoch = accountLifecycleEpoch;
  managedRelayBootstrapAttempt = Math.min(managedRelayBootstrapAttempt + 1, 5);
  managedRelayBootstrapTimer = setTimeout(async () => {
    managedRelayBootstrapTimer = null;
    if (expectedEpoch !== accountLifecycleEpoch) return;
    const state = readAccountState();
    const flags = normalizeAccountFeatureFlags(state.featureFlags, state.relay, state.wallet);
    if (!state.user || !state.session?.refreshTokenEncrypted || !managedRelayBootstrapEligible(state.relay) || flags.relayManagedConfig !== true) {
      managedRelayBootstrapAttempt = 0;
      return;
    }
    try {
      await getRelayAccount();
    } catch (error) {
      if (expectedEpoch === accountLifecycleEpoch && !isSessionInvalidError(error)) scheduleManagedRelayBootstrap();
    }
  }, delay);
  managedRelayBootstrapTimer.unref?.();
}

function managedRelayCredentialHeaders() {
  const deviceId = String(readAccountState().device?.id || "").trim();
  if (!deviceId) {
    throw new AccountRequestError("当前设备会话无效，请重新登录", {
      status: 401,
      code: "ACCOUNT_DEVICE_REQUIRED",
    });
  }
  return {
    "x-starcanvas-credential-purpose": "managed-config",
    "x-starcanvas-device-id": deviceId,
  };
}

async function getWallet() {
  requireAccountFeature("relayWalletUi", "RELAY_WALLET_UI_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const payload = await requestWithAccountAuth(accountApiUrl(), "/wallet");
  assertCurrentAccountLifecycle(expectedEpoch);
  const wallet = normalizeWallet(payload);
  const next = writeAccountState({
    wallet,
    featureFlags: normalizeAccountFeatureFlags(payload.featureFlags || payload.feature_flags || readAccountState().featureFlags, readAccountState().relay, wallet),
  });
  return { ok: true, wallet: sanitizeAccountState(next).wallet };
}

async function getWalletTransactions(filters = {}) {
  requireAccountFeature("relayWalletUi", "RELAY_WALLET_UI_DISABLED");
  return {
    ok: true,
    ...(await requestWithAccountAuth(accountApiUrl(), buildAccountListPath("/wallet/transactions", filters, ["from", "to"]))),
  };
}

async function getRelayUsageRecords(filters = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  return {
    ok: true,
    ...(await requestWithAccountAuth(accountApiUrl(), buildAccountListPath("/relay/usage-records", filters, ["model", "status", "from", "to"]))),
  };
}

async function getRechargeStore() {
  requireAccountFeature("relayRedeem", "RELAY_REDEEM_DISABLED");
  const payload = await requestWithAccountAuth(accountApiUrl(), "/commerce/recharge-store");
  const rawUrl = String(payload.url || payload.storeUrl || payload.store_url || "").trim();
  let url = "";
  if (!rawUrl) return { ok: true, available: false, url: "" };
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new AccountRequestError("充值商店地址不可用", { code: "RECHARGE_STORE_URL_INVALID" }); }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) throw new AccountRequestError("充值商店地址不可用", { code: "RECHARGE_STORE_URL_INVALID" });
  url = parsed.toString();
  return { ok: true, available: true, url };
}

async function redeemWalletCode(payload = {}) {
  requireAccountFeature("relayRedeem", "RELAY_REDEEM_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const code = String(payload.code || "").trim();
  if (!code || code.length > 160) throw new AccountRequestError("请输入有效兑换码", { status: 400, code: "INVALID_REDEEM_CODE" });
  const idempotencyKey = requireIdempotencyKey(payload.idempotencyKey);
  const result = await requestWithAccountAuth(accountApiUrl(), "/wallet/redeem", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: { code },
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  if (result.wallet) writeAccountState({ wallet: normalizeWallet(result.wallet) });
  return { ok: true, ...result };
}

async function sendRelayKeyCode(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const requestedPurpose = String(payload.purpose || "relay_key_reveal");
  const purpose = ({ reveal: "relay_key_reveal", regenerate: "relay_key_rotate" })[requestedPurpose] || requestedPurpose;
  if (!["relay_key_reveal", "relay_key_rotate"].includes(purpose)) {
    throw new AccountRequestError("不支持的验证用途", { status: 400, code: "INVALID_RELAY_KEY_PURPOSE" });
  }
  return { ok: true, ...(await requestWithAccountAuth(accountApiUrl(), "/relay/key/send-code", {
    method: "POST",
    body: { purpose },
  })) };
}

async function revealRelayKey(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const result = await requestWithAccountAuth(accountApiUrl(), "/relay/key/reveal", {
    method: "POST",
    body: { code: requireShortCode(payload.code) },
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  const { next, fullKey } = await persistRelayResponse(result, { storeKey: true }, expectedEpoch);
  if (!fullKey) throw new AccountRequestError("服务未返回可用密钥", { code: "RELAY_KEY_MISSING" });
  return { ok: true, key: fullKey, relay: sanitizeAccountState(next).relay };
}

async function regenerateRelayKey(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const idempotencyKey = requireIdempotencyKey(payload.idempotencyKey);
  const result = await requestWithAccountAuth(accountApiUrl(), "/relay/key/regenerate", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: {
      code: requireShortCode(payload.code),
    },
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  const { next, fullKey } = await persistRelayResponse(result, { storeKey: true }, expectedEpoch);
  if (!fullKey) throw new AccountRequestError("服务未返回新密钥", { code: "RELAY_KEY_MISSING" });
  return { ok: true, key: fullKey, relay: sanitizeAccountState(next).relay };
}

async function sendRelayLinkCode(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const identifier = normalizeAccountEmail(readAccountState().user?.email);
  return { ok: true, ...(await requestWithAccountAuth(accountApiUrl(), "/relay/link-existing/send-code", {
    method: "POST",
    body: { identifier },
  })) };
}

async function verifyLegacyRelayAccount(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const result = await requestWithAccountAuth(accountApiUrl(), "/relay/link-existing/verify-legacy", {
    method: "POST",
    body: { username: requireLegacyCredential(payload.username, "账号"), password: requireLegacyCredential(payload.password, "密码") },
  });
  const status = String(result.status || "");
  const challenge = String(result.challenge || "");
  if (!["verified", "mfa_required"].includes(status) || !challenge || challenge.length > 1024) {
    throw new AccountRequestError("旧账号验证暂不可用", { status: 503, code: "LEGACY_AUTH_UNAVAILABLE" });
  }
  return { ok: true, status, challenge, expiresIn: Number(result.expiresIn || 0) };
}

async function verifyLegacyRelayMfa(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const result = await requestWithAccountAuth(accountApiUrl(), "/relay/link-existing/verify-mfa", {
    method: "POST",
    body: { challenge: requireLegacyCredential(payload.challenge, "验证会话"), code: requireShortCode(payload.code) },
  });
  const status = String(result.status || "");
  const challenge = String(result.challenge || "");
  if (status !== "verified" || !challenge || challenge.length > 1024) {
    throw new AccountRequestError("旧账号验证暂不可用", { status: 503, code: "LEGACY_AUTH_UNAVAILABLE" });
  }
  return { ok: true, status, challenge, expiresIn: Number(result.expiresIn || 0) };
}

async function confirmRelayLink(payload = {}) {
  requireAccountFeature("relayManagedConfig", "RELAY_MANAGED_CONFIG_DISABLED");
  const expectedEpoch = accountLifecycleEpoch;
  const identifier = normalizeAccountEmail(readAccountState().user?.email);
  const idempotencyKey = requireRelayLinkIdempotencyKey(payload.idempotencyKey);
  const result = await requestWithAccountAuth(accountApiUrl(), "/relay/link-existing/confirm", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: { identifier, code: requireShortCode(payload.code), challenge: requireLegacyCredential(payload.challenge, "验证会话") },
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  const linkedRelay = normalizeRelayMetadata(result);
  if (result.status === "review" || result.code === "LINK_REVIEW_REQUIRED" || linkedRelay?.status === "review") {
    // Review is not a completed migration. Preserve the existing key and wallet.
    return { ok: true, status: "review", code: "LINK_REVIEW_REQUIRED" };
  }
  if (String(linkedRelay?.status || "") === "active") {
    return getRelayAccount();
  }
  const state = readAccountState();
  const next = writeAccountState({
    relay: {
      ...(state.relay || {}),
      status: String(linkedRelay?.status || state.relay?.status || "review"),
    },
  });
  return { ok: true, relay: sanitizeAccountState(next).relay };
}

function isManagedRelayTarget(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    // The managed credential is scoped to the exact relay origin. URL.origin
    // intentionally omits userinfo, so reject credentials explicitly too.
    return parsed.protocol === "https:"
      && parsed.hostname.toLowerCase() === WANJUAN_MANAGED_RELAY_HOST
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && parsed.origin === `https://${WANJUAN_MANAGED_RELAY_HOST}`;
  } catch {
    return false;
  }
}

async function managedRelayKey() {
  const expectedEpoch = accountLifecycleEpoch;
  const state = readAccountState();
  if (state.relay?.status !== "active" || state.relay?.managed !== true) return "";
  const key = await decryptSecret(state.relayManagedKeyEncrypted);
  assertCurrentAccountLifecycle(expectedEpoch);
  if (readAccountState().relayManagedKeyEncrypted !== state.relayManagedKeyEncrypted) {
    throw new AccountRequestError("受管极鑫密钥已变更，请重试", { status: 409, code: "MANAGED_RELAY_KEY_CHANGED" });
  }
  return key;
}

async function prepareManagedRelayRequest(rawUrl, headers = {}) {
  if (!isManagedRelayTarget(rawUrl)) return { headers, managed: false };
  const nextHeaders = { ...(headers && typeof headers === "object" ? headers : {}) };
  const credentialKeys = Object.keys(nextHeaders).filter((key) => ["authorization", "x-api-key", "api-key"].includes(key.toLowerCase()));
  const usesPlaceholder = credentialKeys.some((key) => String(nextHeaders[key] || "").includes(WANJUAN_MANAGED_RELAY_PLACEHOLDER));
  const hasExplicitCredential = credentialKeys.some((key) => {
    const value = String(nextHeaders[key] || "").trim();
    return value && !value.includes(WANJUAN_MANAGED_RELAY_PLACEHOLDER);
  });
  if (hasExplicitCredential) return { headers: nextHeaders, managed: false };
  const key = await managedRelayKey();
  if (!key) {
    if (usesPlaceholder) throw new AccountRequestError("受管极鑫密钥暂不可用，请前往“我的账号”重新验证", { status: 401, code: "MANAGED_RELAY_KEY_UNAVAILABLE" });
    return { headers: nextHeaders, managed: false };
  }
  credentialKeys.forEach((credentialKey) => delete nextHeaders[credentialKey]);
  nextHeaders.Authorization = `Bearer ${key}`;
  return { headers: nextHeaders, managed: true };
}

async function refreshManagedRelayCredential() {
  const expectedEpoch = accountLifecycleEpoch;
  const previousVersion = String(readAccountState().relay?.keyVersion || "");
  const payload = await requestWithAccountAuth(accountApiUrl(), "/relay/account", {
    headers: managedRelayCredentialHeaders(),
  });
  assertCurrentAccountLifecycle(expectedEpoch);
  const { next } = await persistRelayResponse(payload, { storeKey: true }, expectedEpoch);
  const nextVersion = String(next.relay?.keyVersion || "");
  if (previousVersion && nextVersion && previousVersion !== nextVersion && !extractManagedRelayKey(payload)) {
    writeAccountState({ relayManagedKeyEncrypted: "" });
    throw new AccountRequestError("受管极鑫密钥已变更，请重新验证后继续", { status: 401, code: "MANAGED_RELAY_KEY_CHANGED" });
  }
  return managedRelayKey();
}

async function requestWithManagedRelayRetry(rawUrl, rawHeaders, performRequest) {
  let request = await prepareManagedRelayRequest(rawUrl, rawHeaders);
  let response = await performRequest(request.headers);
  if (!request.managed || Number(response?.status || 0) !== 401) return response;
  await refreshManagedRelayCredential();
  request = await prepareManagedRelayRequest(rawUrl, rawHeaders);
  return performRequest(request.headers);
}

async function bootstrapAccount() {
  await refreshPublicCapabilities();
  const state = readAccountState();
  if (!state.session?.refreshTokenEncrypted || !accountApiUrl()) return sanitizeAccountState(state);
  try {
    await refreshAccountSession();
    await getCurrentAccount();
    const enterprise = readAccountState().enterprise;
    if (enterprise?.mode === "member" && (!enterprise.workspaceTokenEncrypted || Number(enterprise.expiresAt || 0) <= Date.now())) {
      try {
        return await reconnectEnterpriseWorkspace();
      } catch (error) {
        return sanitizeAccountState(readAccountState(), {
          offline: true,
          error: error?.message || "企业网关暂时不可用",
          errorCode: error?.code || "GATEWAY_OFFLINE",
          errorStatus: error?.status || 0,
        });
      }
    }
    return sanitizeAccountState();
  } catch (error) {
    if (isSessionInvalidError(error)) return clearInvalidAccountSession(error);
    if (error?.code === "SECURE_STORAGE_RELOGIN_REQUIRED") {
      // Leave the previous encrypted session and local projects untouched.
      return sanitizeAccountState(readAccountState(), {
        requiresLogin: true,
        error: error.message,
        errorCode: error.code,
      });
    }
    if (isOfflineEligibleError(error)) {
      return sanitizeAccountState(readAccountState(), {
        offline: true,
        error: error?.message || String(error),
        errorCode: error?.code || "ACCOUNT_NETWORK_ERROR",
        errorStatus: error?.status || 0,
      });
    }
    return clearInvalidAccountSession(error);
  }
}

function normalizeAccountEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new AccountRequestError("请输入有效的邮箱地址", { status: 400, code: "INVALID_EMAIL" });
  }
  return email;
}

async function sendAccountCode(payload = {}) {
  const identifier = normalizeAccountEmail(payload.identifier);
  const purpose = String(payload.purpose || "login").trim();
  if (!["login", "register", "reset_password"].includes(purpose)) {
    throw new AccountRequestError("不支持的验证码用途", { status: 400, code: "INVALID_VERIFICATION_PURPOSE" });
  }
  return requestJson(accountApiUrl(), "/auth/send-code", {
    method: "POST",
    body: { identifier, purpose },
  });
}

async function loginAccount(payload = {}) {
  const identifier = normalizeAccountEmail(payload.identifier);
  const device = readOrCreateAccountDevice();
  const usesPassword = payload.register === true || Object.hasOwn(payload, "password");
  const password = usesPassword ? validateAccountPassword(payload.password) : "";
  const endpoint = payload.register ? "/auth/password/register" : usesPassword ? "/auth/password/login" : "/auth/login";
  const loginEpoch = advanceAccountLifecycle();
  advanceEnterpriseLifecycle();
  const result = await requestJson(accountApiUrl(), endpoint, {
    method: "POST",
    body: {
      identifier,
      ...(payload.register || !usesPassword ? { code: String(payload.code || "").trim() } : {}),
      ...(usesPassword ? { password } : {}),
      deviceName: device.deviceName,
      deviceFingerprint: device.installationId,
      platform: device.platform,
    },
  });
  if (loginEpoch !== accountLifecycleEpoch) return sanitizeAccountState(readAccountState());
  await applyAccountPayload(result, {}, loginEpoch);
  const current = readAccountState();
  const flags = normalizeAccountFeatureFlags(current.featureFlags, current.relay, current.wallet);
  if (managedRelayBootstrapEligible(current.relay) && flags.relayManagedConfig === true) {
    try { await getRelayAccount(); } catch (error) {
      if (isSessionInvalidError(error)) throw error;
      scheduleManagedRelayBootstrap();
    }
  }
  await refreshAccountOrganizations();
  return sanitizeAccountState(reconcileLocalGatewayHostState());
}

function validateAccountPassword(value) {
  if (
    typeof value !== "string" ||
    [...value].length < 12 ||
    [...value].length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new AccountRequestError("密码长度须为 12–200 个字符", { status: 422, code: "INVALID_REQUEST" });
  }
  return value;
}

async function resetAccountPassword(payload = {}) {
  const result = await requestJson(accountApiUrl(), "/auth/password/reset/confirm", {
    method: "POST",
    body: { identifier: normalizeAccountEmail(payload.identifier), code: requireShortCode(payload.code), newPassword: validateAccountPassword(payload.newPassword) },
  });
  if (result.ok === true && normalizeAccountEmail(payload.identifier) === String(readAccountState().user?.email || "").toLowerCase()) {
    clearInvalidAccountSession(new AccountRequestError("密码已重置，请重新登录", { code: "SESSION_REVOKED", status: 401 }));
  }
  return { ok: result.ok === true };
}

function continueWithLocalMode() {
  return sanitizeAccountState(writeAccountState({ onboardingComplete: true, localMode: true }));
}

async function logoutAccount() {
  const baseUrl = accountApiUrl();
  const state = readAccountState();
  const encryptedRefresh = state.session?.refreshTokenEncrypted;
  const logoutAccessToken = accessToken;
  advanceAccountLifecycle();
  advanceEnterpriseLifecycle();
  accessToken = "";
  accountOrganizationsCache = [];
  clearEnterpriseSnapshotCache();
  if (managedRelayBootstrapTimer) clearTimeout(managedRelayBootstrapTimer);
  managedRelayBootstrapTimer = null;
  managedRelayBootstrapAttempt = 0;
  const next = writeAccountState({
    localMode: true,
    user: null,
    subscription: null,
    entitlements: [],
    wallet: null,
    relay: null,
    featureFlags: null,
    relayManagedKeyEncrypted: "",
    device: null,
    session: null,
    enterprise: null,
    lastVerifiedAt: 0,
  });
  // Local logout is immediate even if the OS store needs user authorization.
  let refreshToken = "";
  try { refreshToken = await decryptSecret(encryptedRefresh); } catch {}
  if (baseUrl && (logoutAccessToken || refreshToken)) {
    try {
      await requestJson(baseUrl, "/auth/logout", {
        method: "POST",
        token: logoutAccessToken,
        body: refreshToken ? { refreshToken } : {},
      });
    } catch {}
  }
  try {
    await stopEnterpriseGateway({ disableAutoStart: true });
  } catch {}
  return sanitizeAccountState(readAccountState().user ? readAccountState() : next);
}

async function activateEnterpriseGatewayLocally({ organization, registrationToken, payload = {}, replaced = false }) {
  const device = readOrCreateAccountDevice();
  if (!organization?.id || !registrationToken) {
    throw new AccountRequestError("账号服务器返回的网关登记数据不完整", {
      code: "GATEWAY_REGISTRATION_RESPONSE_INVALID",
    });
  }
  const localGateway = await initializeEnterpriseGateway({
    organization,
    gatewayName: payload.gatewayName,
    accountBaseUrl: accountApiUrl(),
    snapshot: payload.snapshot,
    secrets: payload.secrets,
    autoStart: payload.autoStart !== false,
  });
  const activation = await requestWithAccountAuth(
    accountApiUrl(),
    `/organizations/${encodeURIComponent(organization.id)}/gateways/activate`,
    {
      method: "POST",
      body: {
        registrationToken,
        gatewayName: String(payload.gatewayName || "企业网关"),
        deviceId: String(readAccountState().device?.id || device.installationId),
        publicKey: localGateway.activation.publicKey,
        certificateFingerprint: localGateway.activation.certificateFingerprint,
        appVersion: localGateway.activation.appVersion,
        platform: localGateway.activation.platform,
      },
    },
  );
  const gatewayId = String(activation.gatewayId || "");
  if (!gatewayId) throw new AccountRequestError("网关激活结果缺少 Gateway ID", { code: "GATEWAY_ACTIVATION_INVALID" });
  completeEnterpriseGatewayActivation({ gatewayId, status: activation.status || "active" });

  let inviteCode = "";
  try {
    const invite = await requestWithAccountAuth(
      accountApiUrl(),
      `/organizations/${encodeURIComponent(organization.id)}/invites`,
      {
        method: "POST",
        body: {
          role: "member",
          maxUses: Math.max(1, Number(payload.inviteMaxUses || 20)),
          expiresAt: payload.inviteExpiresAt || null,
        },
      },
    );
    inviteCode = String(invite.inviteCode || invite.code || "");
  } catch {}

  const gatewayStatus = getEnterpriseGatewayStatus();
  const next = writeAccountState({
    enterprise: {
      mode: "host",
      organization: { ...organization, role: organization.role || "owner" },
      gatewayId,
      gatewayUrl: gatewayStatus.preferredUrl,
      connectedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      expiresAt: 0,
    },
  });
  try { await refreshAccountOrganizations(); } catch {}
  return {
    ...sanitizeAccountState(next),
    creationResult: {
      organization,
      gateway: gatewayStatus,
      inviteCode,
      replaced,
    },
  };
}

async function createEnterpriseGateway(payload = {}) {
  const device = readOrCreateAccountDevice();
  const operationId = String(payload.operationId || crypto.randomUUID());
  const defaultQuotas = (Array.isArray(payload.defaultQuotas) ? payload.defaultQuotas : []).map((item) => {
    const capabilityKey = String(item?.capabilityKey || item?.capability || item?.capability_key || "").trim();
    const rawUnit = String(item?.unit || "");
    const unit = ["successful_requests", "successful_outputs", "successful_tasks"].includes(rawUnit)
      ? rawUnit
      : capabilityKey === "text_generation"
        ? "successful_requests"
        : capabilityKey === "image_generation"
          ? "successful_outputs"
          : "successful_tasks";
    const rawLimit = item?.limitValue ?? item?.limit ?? item?.limit_value;
    return {
      capabilityKey,
      enabled: item?.enabled !== false,
      limitValue: rawLimit === null || rawLimit === undefined || rawLimit === "" ? null : Math.max(0, Number(rawLimit)),
      unit,
    };
  }).filter((item) => item.capabilityKey);
  const organizationResponse = await requestWithAccountAuth(accountApiUrl(), "/organizations/self-hosted", {
    method: "POST",
    headers: { "idempotency-key": operationId },
    body: {
      name: String(payload.organizationName || "").trim(),
      gatewayName: String(payload.gatewayName || "").trim(),
      timezone: String(payload.timezone || "Asia/Shanghai"),
      deviceId: String(readAccountState().device?.id || device.installationId),
      operationId,
      defaultQuotas,
    },
  });
  const organization = organizationResponse.organization;
  const registrationToken = String(organizationResponse.gatewayRegistration?.token || "");
  if (!organization?.id || !registrationToken) {
    throw new AccountRequestError("账号服务器返回的企业创建数据不完整", {
      code: "ENTERPRISE_CREATE_RESPONSE_INVALID",
    });
  }
  const localGatewayStatus = getEnterpriseGatewayStatus();
  if (localGatewayStatus.initialized && localGatewayStatus.organizationId !== String(organization.id)) {
    await clearEnterpriseGatewayLocalState();
  }
  return activateEnterpriseGatewayLocally({ organization, registrationToken, payload, replaced: false });
}

async function takeOverEnterpriseGateway(payload = {}) {
  const device = readOrCreateAccountDevice();
  const organizationId = String(payload.organizationId || sanitizeAccountState().ownedEnterprise?.id || "");
  if (!organizationId) {
    throw new AccountRequestError("当前账号没有可接管的自托管企业", { code: "OWNED_ENTERPRISE_NOT_FOUND" });
  }
  const operationId = String(payload.operationId || crypto.randomUUID());
  const response = await requestWithAccountAuth(
    accountApiUrl(),
    `/organizations/${encodeURIComponent(organizationId)}/gateways/takeover`,
    {
      method: "POST",
      headers: { "idempotency-key": operationId },
      body: {
        deviceId: String(readAccountState().device?.id || device.installationId),
        gatewayName: String(payload.gatewayName || "企业网关"),
        operationId,
      },
    },
  );
  const organization = response.organization || accountOrganizationsCache.find((item) => item.id === organizationId);
  const registrationToken = String(response.gatewayRegistration?.token || "");
  if (!organization?.id || !registrationToken) {
    throw new AccountRequestError("账号服务器返回的网关接管数据不完整", { code: "GATEWAY_TAKEOVER_RESPONSE_INVALID" });
  }
  await clearEnterpriseGatewayLocalState();
  return activateEnterpriseGatewayLocally({ organization, registrationToken, payload, replaced: true });
}

async function releaseCreatedEnterpriseGateway(payload = {}) {
  const state = readAccountState();
  const enterprise = state.enterprise;
  const organizationId = String(payload.organizationId || enterprise?.organization?.id || "");
  const gatewayId = String(payload.gatewayId || enterprise?.gatewayId || "");
  if (enterprise?.mode !== "host" || !organizationId || !gatewayId) {
    throw new AccountRequestError("当前电脑不是可移除的企业主网关", { code: "ENTERPRISE_HOST_REQUIRED" });
  }
  await requestWithAccountAuth(
    accountApiUrl(),
    `/organizations/${encodeURIComponent(organizationId)}/gateways/${encodeURIComponent(gatewayId)}/revoke`,
    {
      method: "POST",
      body: {
        deviceId: String(state.device?.id || readOrCreateAccountDevice().installationId),
        reason: "owner_release",
      },
    },
  );
  await clearEnterpriseGatewayLocalState();
  clearEnterpriseSnapshotCache();
  const next = writeAccountState({ enterprise: null });
  try { await refreshAccountOrganizations(); } catch {}
  return sanitizeAccountState(next);
}

async function publishEnterpriseGatewayConfig(payload = {}) {
  await publishEnterpriseGatewaySnapshot(payload);
  return sanitizeAccountState();
}

function currentEnterpriseOrganization() {
  const enterprise = readAccountState().enterprise;
  const organizationId = String(enterprise?.organization?.id || "");
  if (!organizationId) throw new AccountRequestError("当前没有可管理的企业", { code: "ENTERPRISE_NOT_CONNECTED" });
  return { enterprise, organizationId };
}

async function refreshHostControlSnapshot(enterprise) {
  if (enterprise?.mode !== "host") return;
  try { await syncGatewayControlPlane(); } catch {}
}

async function getEnterpriseManagement() {
  const { enterprise, organizationId } = currentEnterpriseOrganization();
  const members = await requestWithAccountAuth(accountApiUrl(), `/organizations/${encodeURIComponent(organizationId)}/members`);
  await refreshHostControlSnapshot(enterprise);
  const local = enterprise.mode === "host" ? getEnterpriseGatewayManagementSnapshot() : {};
  return {
    ok: true,
    organization: enterprise.organization,
    requesterRole: String(members.requesterRole || enterprise.organization?.role || "member"),
    policyVersion: Number(members.policyVersion || local.policyVersion || 0),
    members: Array.isArray(members.items) ? members.items : [],
    quotaDefaults: Array.isArray(local.quotaDefaults) ? local.quotaDefaults : [],
    memberQuotaOverrides: Array.isArray(local.memberQuotaOverrides) ? local.memberQuotaOverrides : [],
    usage: local.usage || null,
    activeTasks: Number(local.activeTasks || 0),
    timezone: String(local.timezone || "Asia/Shanghai"),
    quotaReadableFromHost: enterprise.mode === "host",
  };
}

async function updateEnterpriseMember(payload = {}) {
  const { enterprise, organizationId } = currentEnterpriseOrganization();
  const userId = String(payload.userId || "");
  if (!userId) throw new AccountRequestError("缺少企业成员 ID", { code: "ENTERPRISE_MEMBER_REQUIRED" });
  await requestWithAccountAuth(accountApiUrl(), `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: {
      ...(payload.role ? { role: String(payload.role) } : {}),
      ...(payload.status ? { status: String(payload.status) } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "expiresAt") ? { expiresAt: payload.expiresAt || null } : {}),
    },
  });
  await refreshHostControlSnapshot(enterprise);
  return getEnterpriseManagement();
}

async function removeEnterpriseMember(payload = {}) {
  const { enterprise, organizationId } = currentEnterpriseOrganization();
  const userId = String(payload.userId || "");
  if (!userId) throw new AccountRequestError("缺少企业成员 ID", { code: "ENTERPRISE_MEMBER_REQUIRED" });
  await requestWithAccountAuth(accountApiUrl(), `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  await refreshHostControlSnapshot(enterprise);
  return getEnterpriseManagement();
}

async function updateEnterpriseQuotaDefault(payload = {}) {
  const { enterprise, organizationId } = currentEnterpriseOrganization();
  await requestWithAccountAuth(accountApiUrl(), `/organizations/${encodeURIComponent(organizationId)}/quota-defaults`, {
    method: "PUT",
    body: {
      capabilityKey: String(payload.capabilityKey || ""),
      enabled: payload.enabled !== false,
      limitValue: payload.limitValue === null || payload.limitValue === undefined ? null : Math.max(0, Number(payload.limitValue)),
      unit: String(payload.unit || "successful_tasks"),
    },
  });
  await refreshHostControlSnapshot(enterprise);
  return getEnterpriseManagement();
}

async function updateEnterpriseMemberQuota(payload = {}) {
  const { enterprise, organizationId } = currentEnterpriseOrganization();
  await requestWithAccountAuth(accountApiUrl(), `/organizations/${encodeURIComponent(organizationId)}/quota-overrides`, {
    method: "PUT",
    body: {
      userId: String(payload.userId || ""),
      capabilityKey: String(payload.capabilityKey || ""),
      mode: String(payload.mode || "inherit"),
      limitValue: payload.limitValue === null || payload.limitValue === undefined ? null : Math.max(0, Number(payload.limitValue)),
      startsAt: payload.startsAt || null,
      expiresAt: payload.expiresAt || null,
    },
  });
  await refreshHostControlSnapshot(enterprise);
  return getEnterpriseManagement();
}

async function startCreatedEnterpriseGateway() {
  await startEnterpriseGateway();
  return sanitizeAccountState();
}

async function stopCreatedEnterpriseGateway() {
  await stopEnterpriseGateway();
  return sanitizeAccountState();
}

async function establishEnterpriseWorkspace(payload = {}, expectedEpoch = enterpriseLifecycleEpoch) {
  const gatewayUrl = String(payload.gatewayUrl || "").trim();
  const gateway = payload.gateway || {};
  const organization = payload.organization || {};
  const certificateFingerprint = String(gateway.certificateFingerprint || payload.certificateFingerprint || "");
  const deviceId = String(payload.deviceId || "");
  const sessionResponse = await requestPinnedJson(gatewayUrl, "/workspace/session", {
    method: "POST",
    token: accessToken,
    certificateFingerprint,
    body: {
      signedGatewayGrant: String(payload.signedGatewayGrant || ""),
      deviceId,
      appVersion: app.getVersion(),
    },
  });
  if (expectedEpoch !== enterpriseLifecycleEpoch) {
    throw new AccountRequestError("企业连接已变更，已忽略过期响应", {
      status: 409,
      code: "ENTERPRISE_SESSION_CHANGED",
    });
  }
  const session = sessionResponse.value || {};
  const workspaceToken = String(session.workspaceToken || "");
  if (!workspaceToken || !organization.id || !gateway.id) {
    throw new AccountRequestError("企业网关返回的数据不完整", { code: "WORKSPACE_SESSION_INVALID" });
  }
  const snapshotResponse = await requestPinnedJson(gatewayUrl, "/workspace/config-snapshot", {
    token: workspaceToken,
    certificateFingerprint,
  });
  if (expectedEpoch !== enterpriseLifecycleEpoch) {
    throw new AccountRequestError("企业连接已变更，已忽略过期响应", {
      status: 409,
      code: "ENTERPRISE_SESSION_CHANGED",
    });
  }
  const snapshot = snapshotResponse.value;
  if (!snapshot?.schemaVersion || !snapshot?.modules?.settings?.chromeStorage) {
    throw new AccountRequestError("企业配置快照格式不正确", { code: "ENTERPRISE_CONFIG_INVALID" });
  }
  const encryptedWorkspaceToken = await encryptSecret(workspaceToken);
  if (expectedEpoch !== enterpriseLifecycleEpoch) {
    throw new AccountRequestError("企业连接已变更，已忽略过期响应", {
      status: 409, code: "ENTERPRISE_SESSION_CHANGED",
    });
  }
  writeEnterpriseSnapshotCache({
    organizationId: String(organization.id),
    gatewayId: String(gateway.id),
    gatewayUrl,
    certificateFingerprint,
    snapshot,
    cachedAt: Date.now(),
  });
  const next = writeAccountState({
    enterprise: {
      mode: "member",
      organization,
      gatewayId: String(gateway.id),
      gatewayUrl,
      certificateFingerprint,
      workspaceTokenEncrypted: encryptedWorkspaceToken,
      connectedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      expiresAt: Date.now() + Math.max(60, Number(session.expiresIn || 28800)) * 1000,
      configVersion: Number(snapshot.version || session.snapshotVersion || 0),
      configHash: String(snapshot.hash || session.configHash || ""),
    },
  });
  return sanitizeAccountState(next);
}

async function connectEnterpriseWorkspace(payload = {}) {
  const deviceId = String(payload.deviceId || readAccountState().device?.id || "");
  const expectedEpoch = advanceEnterpriseLifecycle();
  try {
    const joined = await requestWithAccountAuth(accountApiUrl(), "/organizations/join", {
      method: "POST",
      body: {
        inviteCode: String(payload.inviteCode || "").trim(),
        deviceId,
      },
    });
    return await establishEnterpriseWorkspace({
      ...joined,
      gatewayUrl: payload.gatewayUrl,
      deviceId,
    }, expectedEpoch);
  } catch (error) {
    if (isSessionInvalidError(error)) return clearInvalidAccountSession(error);
    throw error;
  }
}

async function reconnectEnterpriseWorkspace() {
  const state = readAccountState();
  const enterprise = state.enterprise;
  if (enterprise?.mode !== "member" || !enterprise.organization?.id || !enterprise.gatewayUrl) {
    return sanitizeAccountState(state);
  }
  const expectedEpoch = enterpriseLifecycleEpoch;
  const expectedScope = enterpriseScopeKey(enterprise);
  const deviceId = String(state.device?.id || "");
  const grant = await requestWithAccountAuth(
    accountApiUrl(),
    `/organizations/${encodeURIComponent(enterprise.organization.id)}/gateway-grant`,
    { method: "POST", body: { deviceId } },
  );
  if (
    expectedEpoch !== enterpriseLifecycleEpoch ||
    enterpriseScopeKey(readAccountState().enterprise) !== expectedScope
  ) {
    return sanitizeAccountState(readAccountState());
  }
  return establishEnterpriseWorkspace({
    organization: enterprise.organization,
    gateway: grant.gateway,
    signedGatewayGrant: grant.signedGatewayGrant,
    gatewayUrl: enterprise.gatewayUrl,
    deviceId,
  }, expectedEpoch);
}

async function refreshEnterpriseWorkspaceConfig() {
  const state = readAccountState();
  const enterprise = state.enterprise;
  if (enterprise?.mode !== "member" || !enterprise.gatewayUrl || !enterprise.certificateFingerprint) {
    return sanitizeAccountState(state);
  }
  const expectedEpoch = enterpriseLifecycleEpoch;
  const expectedScope = enterpriseScopeKey(enterprise);
  const workspaceToken = await decryptSecret(enterprise.workspaceTokenEncrypted);
  assertCurrentEnterpriseSecret(enterprise, expectedEpoch);
  if (!workspaceToken || Number(enterprise.expiresAt || 0) <= Date.now()) return reconnectEnterpriseWorkspace();
  try {
    const response = await requestPinnedJson(enterprise.gatewayUrl, "/workspace/config-snapshot", {
      token: workspaceToken,
      certificateFingerprint: enterprise.certificateFingerprint,
      headers: enterprise.configHash ? { "if-none-match": `"${String(enterprise.configHash).replace(/^sha256:/, "")}"` } : {},
    });
    const snapshot = response.value;
    if (
      expectedEpoch !== enterpriseLifecycleEpoch ||
      enterpriseScopeKey(readAccountState().enterprise) !== expectedScope
    ) {
      return sanitizeAccountState(readAccountState());
    }
    if (snapshot?.modules?.settings?.chromeStorage) {
      writeEnterpriseSnapshotCache({
        organizationId: String(enterprise.organization?.id || ""),
        gatewayId: String(enterprise.gatewayId || ""),
        gatewayUrl: enterprise.gatewayUrl,
        certificateFingerprint: enterprise.certificateFingerprint,
        snapshot,
        cachedAt: Date.now(),
      });
      writeAccountState({
        enterprise: {
          ...enterprise,
          lastVerifiedAt: Date.now(),
          configVersion: Number(snapshot.version || 0),
          configHash: String(snapshot.hash || ""),
        },
      });
    }
    return sanitizeAccountState();
  } catch (error) {
    if (
      expectedEpoch !== enterpriseLifecycleEpoch ||
      enterpriseScopeKey(readAccountState().enterprise) !== expectedScope
    ) {
      return sanitizeAccountState(readAccountState());
    }
    if (error?.status === 304) return sanitizeAccountState();
    if (error?.code === "WORKSPACE_SESSION_EXPIRED") return reconnectEnterpriseWorkspace();
    throw error;
  }
}

async function disconnectEnterpriseWorkspace() {
  const enterprise = readAccountState().enterprise;
  advanceEnterpriseLifecycle();
  clearEnterpriseSnapshotCache();
  writeAccountState({ enterprise: null });
  if (enterprise?.mode === "host") {
    try {
      await stopEnterpriseGateway({ disableAutoStart: true });
    } catch {}
  } else if (enterprise?.gatewayUrl && enterprise?.workspaceTokenEncrypted) {
    try {
      await requestPinnedJson(enterprise.gatewayUrl, "/workspace/logout", {
        method: "POST",
        token: await decryptSecret(enterprise.workspaceTokenEncrypted),
        certificateFingerprint: enterprise.certificateFingerprint,
      });
    } catch {}
  }
  return sanitizeAccountState(readAccountState());
}

function resetAccountOnboarding() {
  const state = readAccountState();
  return sanitizeAccountState(writeAccountState({
    onboardingComplete: false,
    localMode: false,
    user: state.user,
  }));
}

function getEnterpriseStorageOverlay() {
  const state = readAccountState();
  const cache = readEnterpriseSnapshotCache();
  if (state.enterprise?.mode !== "member" || !cache?.snapshot?.modules?.settings?.chromeStorage) {
    return { active: false, settings: {}, version: 0, hash: "" };
  }
  return {
    active: true,
    settings: cache.snapshot.modules.settings.chromeStorage,
    version: Number(cache.snapshot.version || 0),
    hash: String(cache.snapshot.hash || ""),
  };
}

function enterpriseTeamOperationPayload(operation, payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (operation === "list") {
    return {
      cursor: String(source.cursor || ""),
      limit: Math.max(1, Math.min(100, Number(source.limit || 50))),
      updatedAfter: String(source.updatedAfter || ""),
      includeArchived: source.includeArchived === true,
    };
  }
  if (operation === "changes") {
    return {
      cursor: String(source.cursor || ""),
      limit: Math.max(1, Math.min(200, Number(source.limit || 100))),
    };
  }
  const id = String(source.id || "").trim();
  if (["get", "update", "delete"].includes(operation) && !id) {
    throw new AccountRequestError("团队模板 ID 不能为空", { code: "TEAM_TEMPLATE_ID_REQUIRED" });
  }
  if (operation === "get") return { id };
  if (operation === "create") {
    const idempotencyKey = String(source.idempotencyKey || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new AccountRequestError("团队模板幂等键长度必须为 8..120", { code: "IDEMPOTENCY_KEY_INVALID" });
    }
    return {
      input: sanitizeEnterpriseTeamTemplateInput(source.input || {}),
      idempotencyKey,
    };
  }
  if (operation === "update") {
    const revision = Number(source.revision);
    if (!Number.isFinite(revision) || revision < 1) {
      throw new AccountRequestError("更新团队模板需要有效 revision", { code: "TEAM_TEMPLATE_REVISION_REQUIRED" });
    }
    const input = sanitizeEnterpriseTeamTemplateInput(source.input || {}, { requireContent: false, partial: true });
    if (!Object.keys(input).length) {
      throw new AccountRequestError("没有可更新的团队模板字段", { code: "TEAM_TEMPLATE_UPDATE_EMPTY" });
    }
    return { id, input, revision };
  }
  if (operation === "delete") {
    const revision = Number(source.revision);
    if (!Number.isFinite(revision) || revision < 1) {
      throw new AccountRequestError("删除团队模板需要有效 revision", { code: "TEAM_TEMPLATE_REVISION_REQUIRED" });
    }
    return { id, revision };
  }
  throw new AccountRequestError("不支持的企业团队模板操作", { code: "TEAM_TEMPLATE_OPERATION_INVALID" });
}

function verifiedEnterpriseHostSession() {
  const state = readAccountState();
  const enterprise = state.enterprise;
  const gatewayHost = getEnterpriseGatewayStatus();
  const organizationId = String(enterprise?.organization?.id || "");
  const gatewayId = String(enterprise?.gatewayId || "");
  const ownedEnterprise = accountOrganizationsCache.find((item) =>
    String(item.id || "") === organizationId &&
    item.membershipStatus === "active" &&
    ["owner", "admin"].includes(String(item.role || "").toLowerCase())
  );
  const role = String(ownedEnterprise?.role || "").toLowerCase();
  if (enterprise?.mode !== "host" || !state.user?.id || !ownedEnterprise ||
      !gatewayHost.initialized || organizationId !== String(gatewayHost.organizationId || "") ||
      gatewayId !== String(gatewayHost.gatewayId || gatewayHost.localGatewayId || "")) {
    throw new AccountRequestError("当前账号不是该企业网关的受信管理员", { code: "ENTERPRISE_TEAM_HOST_FORBIDDEN", status: 403 });
  }
  return {
    userId: String(state.user.id),
    organizationId,
    gatewayId,
    role,
    trustedHost: true,
  };
}

async function enterpriseMemberTeamContext() {
  const expectedEpoch = enterpriseLifecycleEpoch;
  const state = readAccountState();
  const enterprise = state.enterprise;
  if (enterprise?.mode !== "member" || !state.user?.id || !enterprise.organization?.id || !enterprise.gatewayId) {
    throw new AccountRequestError("当前未连接企业网关", { code: "ENTERPRISE_TEAM_NOT_CONNECTED", status: 401 });
  }
  const workspaceToken = await decryptSecret(enterprise.workspaceTokenEncrypted);
  assertCurrentEnterpriseSecret(enterprise, expectedEpoch);
  if (!workspaceToken || !enterprise.gatewayUrl || !enterprise.certificateFingerprint) {
    throw new AccountRequestError("企业网关会话不可用", { code: "ENTERPRISE_GATEWAY_UNAVAILABLE", status: 401 });
  }
  return {
    enterprise,
    workspaceToken,
    organizationId: String(enterprise.organization.id),
    gatewayId: String(enterprise.gatewayId),
    role: String(enterprise.organization.role || "member"),
  };
}

function enterpriseTeamHttpRequestOptions(operation, payload, context) {
  const base = {
    token: context.workspaceToken,
    certificateFingerprint: context.enterprise.certificateFingerprint,
  };
  if (operation === "list" || operation === "changes") {
    const params = new URLSearchParams();
    if (payload.cursor) params.set("cursor", payload.cursor);
    params.set("limit", String(payload.limit));
    if (operation === "list") {
      if (payload.updatedAfter) params.set("updatedAfter", payload.updatedAfter);
      params.set("includeArchived", payload.includeArchived ? "true" : "false");
    }
    return {
      path: `/workspace/team-templates${operation === "changes" ? "/changes" : ""}?${params.toString()}`,
      options: base,
    };
  }
  const itemPath = payload.id ? `/workspace/team-templates/${encodeURIComponent(payload.id)}` : "/workspace/team-templates";
  if (operation === "get") return { path: itemPath, options: base };
  if (operation === "create") return {
    path: itemPath,
    options: { ...base, method: "POST", headers: { "idempotency-key": payload.idempotencyKey }, body: payload.input },
  };
  if (operation === "update") return {
    path: itemPath,
    options: { ...base, method: "PATCH", headers: { "if-match": `"${payload.revision}"` }, body: { ...payload.input, revision: payload.revision } },
  };
  return {
    path: itemPath,
    options: { ...base, method: "DELETE", headers: { "if-match": `"${payload.revision}"` } },
  };
}

async function invokeEnterpriseTeamTemplates(payload = {}, retryCount = 0) {
  const operation = String(payload.operation || "list").trim();
  const operationPayload = enterpriseTeamOperationPayload(operation, payload);
  const state = readAccountState();
  try {
    if (state.enterprise?.mode === "host") {
      const session = verifiedEnterpriseHostSession();
      const response = await invokeEnterpriseTeamTemplatesAsHost({ operation, payload: operationPayload, session });
      return {
        ...normalizeEnterpriseTeamTemplateResponse(response, session),
        context: { organizationId: session.organizationId, gatewayId: session.gatewayId, role: session.role },
      };
    }
    const context = await enterpriseMemberTeamContext();
    const request = enterpriseTeamHttpRequestOptions(operation, operationPayload, context);
    const response = await requestPinnedJson(context.enterprise.gatewayUrl, request.path, request.options);
    return {
      ...normalizeEnterpriseTeamTemplateResponse(response.value, context),
      context: { organizationId: context.organizationId, gatewayId: context.gatewayId, role: context.role },
    };
  } catch (error) {
    if (error?.code === "WORKSPACE_SESSION_EXPIRED" && state.enterprise?.mode === "member" && retryCount < 1) {
      await reconnectEnterpriseWorkspace();
      return invokeEnterpriseTeamTemplates(payload, retryCount + 1);
    }
    if (error?.code === "TEAM_TEMPLATE_CONFLICT") {
      error.details = normalizeEnterpriseTeamConflictDetails(error.details);
    }
    throw error;
  }
}

function listEnterpriseManagedApiConfigs(snapshot) {
  const settings = snapshot?.modules?.settings?.chromeStorage || {};
  const configured = (Array.isArray(settings.apiConfigs) ? settings.apiConfigs : [])
    .filter((item) => item && (item.url || item.apiUrl))
    .map((item) => ({ ...item, id: String(item.id || ""), url: String(item.url || item.apiUrl || "") }));
  const legacy = [
    ["legacy:default", settings.apiUrl],
    ["legacy:text", settings.textApiUrl],
    ["legacy:image", settings.imageApiUrl],
    ["legacy:video", settings.videoApiUrl],
    ["legacy:audio", settings.audioApiUrl],
  ].filter(([, url]) => String(url || "").trim()).map(([id, url]) => ({ id, url: String(url) }));
  const seen = new Set();
  return [...configured, ...legacy].filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function managedApiMatchLength(apiConfig, requestUrl) {
  try {
    const base = new URL(String(apiConfig?.url || ""));
    const target = new URL(String(requestUrl || ""));
    const basePath = base.pathname.replace(/\/$/, "");
    if (base.origin !== target.origin) return -1;
    if (basePath && basePath !== "/" && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return -1;
    return base.origin.length + basePath.length;
  } catch {
    return -1;
  }
}

function findEnterpriseManagedApiConfig(snapshot, requestUrl) {
  return listEnterpriseManagedApiConfigs(snapshot)
    .map((item) => ({ item, score: managedApiMatchLength(item, requestUrl) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.item || null;
}

function stripEnterpriseMemberAuthHeaders(headers) {
  const blocked = new Set(["authorization", "x-api-key", "api-key", "x-goog-api-key", "cookie"]);
  return Object.fromEntries(Object.entries(headers || {}).filter(([key]) => !blocked.has(String(key).toLowerCase())));
}

function enterpriseAuthMetadata(headers) {
  const entries = Object.entries(headers || {});
  const authHeaderNames = entries
    .map(([key]) => String(key).toLowerCase())
    .filter((key) => ["authorization", "x-api-key", "api-key", "x-goog-api-key"].includes(key));
  const authorizationValue = entries.find(([key]) => String(key).toLowerCase() === "authorization")?.[1];
  const schemeMatch = String(authorizationValue || "").match(/^([A-Za-z][A-Za-z0-9_-]*)\s+/);
  return {
    authHeaderNames,
    authorizationScheme: schemeMatch ? schemeMatch[1] : "Bearer",
  };
}

function enterpriseRequestKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (!kind) return "";
  if (["submit", "poll", "request"].includes(kind)) return kind;
  throw new AccountRequestError("企业代理请求意图无效", { code: "INVALID_ENTERPRISE_REQUEST_KIND" });
}

async function proxyEnterpriseRequest(payload = {}, options = {}, retryCount = 0) {
  const expectedEpoch = enterpriseLifecycleEpoch;
  const state = readAccountState();
  const enterprise = state.enterprise;
  if (enterprise?.mode !== "member") return { handled: false };

  const cache = readEnterpriseSnapshotCache();
  if (!cache?.snapshot?.modules?.settings?.chromeStorage) {
    throw new AccountRequestError("企业配置快照不可用，已阻止回退到个人配置", { code: "ENTERPRISE_CONFIG_UNAVAILABLE" });
  }
  const apiConfig = findEnterpriseManagedApiConfig(cache.snapshot, payload.url);
  if (!apiConfig) return { handled: false };

  const workspaceToken = await decryptSecret(enterprise.workspaceTokenEncrypted);
  assertCurrentEnterpriseSecret(enterprise, expectedEpoch);
  if (!workspaceToken || !enterprise.gatewayUrl || !enterprise.certificateFingerprint) {
    throw new AccountRequestError("企业网关会话不可用，已阻止回退到个人配置", { code: "ENTERPRISE_GATEWAY_UNAVAILABLE" });
  }

  try {
    const authMetadata = enterpriseAuthMetadata(payload.headers);
    const method = String(payload.method || "GET").toUpperCase();
    const requestKind = enterpriseRequestKind(payload.enterpriseRequestKind);
    const gatewayPath = requestKind
      ? requestKind === "submit" ? "/workspace/tasks" : "/workspace/proxy-fetch"
      : ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? "/workspace/tasks" : "/workspace/proxy-fetch";
    const response = await requestPinnedJson(enterprise.gatewayUrl, gatewayPath, {
      method: "POST",
      token: workspaceToken,
      certificateFingerprint: enterprise.certificateFingerprint,
      timeoutMs: Math.max(1000, Math.min(600000, Number(payload.requestTimeout || 180000) + 5000)),
      signal: options.signal,
      body: {
        managedApiConfigId: apiConfig.id,
        clientRequestId: String(payload.requestId || ""),
        url: String(payload.url || ""),
        method,
        headers: stripEnterpriseMemberAuthHeaders(payload.headers),
        authHeaderNames: authMetadata.authHeaderNames,
        authorizationScheme: authMetadata.authorizationScheme,
        bodyBase64: String(payload.bodyBase64 || ""),
        requestTimeout: Number(payload.requestTimeout || 180000),
        enterpriseRequestKind: requestKind || undefined,
      },
    });
    return { handled: true, response: response.value.proxy || response.value };
  } catch (error) {
    if (error?.code === "WORKSPACE_SESSION_EXPIRED" && retryCount < 1) {
      await reconnectEnterpriseWorkspace();
      return proxyEnterpriseRequest(payload, options, retryCount + 1);
    }
    throw error;
  }
}

async function proxyEnterpriseUpload(channel, payload = {}, options = {}, retryCount = 0) {
  const expectedEpoch = enterpriseLifecycleEpoch;
  const state = readAccountState();
  const enterprise = state.enterprise;
  if (enterprise?.mode !== "member") return { handled: false };
  const cache = readEnterpriseSnapshotCache();
  if (!cache?.snapshot?.modules?.settings?.chromeStorage) {
    throw new AccountRequestError("企业配置快照不可用，已阻止回退到个人上传配置", { code: "ENTERPRISE_CONFIG_UNAVAILABLE" });
  }
  const workspaceToken = await decryptSecret(enterprise.workspaceTokenEncrypted);
  assertCurrentEnterpriseSecret(enterprise, expectedEpoch);
  if (!workspaceToken || !enterprise.gatewayUrl || !enterprise.certificateFingerprint) {
    throw new AccountRequestError("企业网关会话不可用，已阻止回退到个人上传配置", { code: "ENTERPRISE_GATEWAY_UNAVAILABLE" });
  }

  let source;
  try {
    source = await createEnterpriseUploadSource(payload);
    const response = await requestPinnedUpload(enterprise.gatewayUrl, "/workspace/uploads", {
      token: workspaceToken,
      certificateFingerprint: enterprise.certificateFingerprint,
      stream: source.stream,
      size: source.size,
      mime: source.mime,
      timeoutMs: Math.max(60000, Math.min(30 * 60 * 1000, Number(options.timeoutMs || 15 * 60 * 1000))),
      signal: options.signal,
      metadata: {
        channel: String(channel || "public"),
        kind: String(payload.kind || "media"),
        filename: source.filename,
        mime: source.mime,
      },
    });
    return { handled: true, response: response.value };
  } catch (error) {
    if (error?.code === "WORKSPACE_SESSION_EXPIRED" && retryCount < 1) {
      await reconnectEnterpriseWorkspace();
      return proxyEnterpriseUpload(channel, payload, options, retryCount + 1);
    }
    error.enterpriseManaged = true;
    throw error;
  } finally {
    source?.stream?.destroy?.();
  }
}

module.exports = {
  resetAccountPassword,
  AccountRequestError,
  WANJUAN_ACCOUNT_DEFAULT_API_URL,
  accountApiUrl,
  bootstrapAccount,
  connectEnterpriseWorkspace,
  continueWithLocalMode,
  createEnterpriseGateway,
  disconnectEnterpriseWorkspace,
  confirmRelayLink,
  getCurrentAccount,
  getEnterpriseManagement,
  getEnterpriseStorageOverlay,
  getRechargeStore,
  getRelayAccount,
  getRelayUsageRecords,
  getWallet,
  getWalletTransactions,
  invokeEnterpriseTeamTemplates,
  loginAccount,
  logoutAccount,
  normalizeBaseUrl,
  normalizeAccountEmail,
  normalizeAccountFeatureFlags,
  prepareManagedRelayRequest,
  publishEnterpriseGatewayConfig,
  proxyEnterpriseRequest,
  proxyEnterpriseUpload,
  releaseCreatedEnterpriseGateway,
  refreshEnterpriseWorkspaceConfig,
  readAccountState,
  refreshAccountSession,
  refreshPublicCapabilities,
  refreshManagedRelayCredential,
  requestWithManagedRelayRetry,
  redeemWalletCode,
  regenerateRelayKey,
  revealRelayKey,
  requestWithAccountAuth,
  createAccountOperationGuard,
  uploadCloudProjectAsset,
  withDownloadedCloudProjectAsset,
  resetAccountOnboarding,
  removeEnterpriseMember,
  sanitizeAccountState,
  sendAccountCode,
  sendRelayKeyCode,
  sendRelayLinkCode,
  startCreatedEnterpriseGateway,
  stopCreatedEnterpriseGateway,
  takeOverEnterpriseGateway,
  updateEnterpriseMember,
  updateEnterpriseMemberQuota,
  updateEnterpriseQuotaDefault,
  verifyLegacyRelayAccount,
  verifyLegacyRelayMfa,
};
