const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { mock } = require("node:test");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wanjuan-account-test-"));
const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wanjuan-account-device-test-"));
let decryptErrorCode = "";
const fakeElectron = {
  app: { getPath: () => tempRoot, getVersion: () => "1.3.9-test" },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptStringAsync: async (buffer) => {
      if (decryptErrorCode) throw Object.assign(new Error("synthetic"), {code:decryptErrorCode});
      return { result: buffer.toString("utf8").replace(/^encrypted:/, ""), shouldReEncrypt: false };
    },
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (buffer) => buffer.toString("utf8").replace(/^encrypted:/, ""),
  },
};

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalAccountUrl = process.env.WANJUAN_ACCOUNT_API_URL;
const originalAccountFusionPreview = process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron" || request === "electron/main") return fakeElectron;
  return originalLoad.call(this, request, parent, isMain);
};
process.env.WANJUAN_ACCOUNT_API_URL = "https://api.example.com";

const calls = [];
let refreshCount = 0;
let refreshMode = "success";
let relayAccountMode = "active";
let relayKeyResponseMode = "complete";
let relayKeyResponseOverride = null;
let managedRelayKey = "sk-managed-main-only";
let ownedOrganization = null;
let activeGatewayId = "";
let linkReview = false;
let publicCapabilitiesMode = "success";
let publicCapabilitiesCalls = 0;
let rechargeStoreUrl = "https://shop.example.com/recharge";

const accountPayload = {
  user: { id: "usr_test", name: "测试用户", email: "tester@example.com" },
  subscription: { plan: "pro", status: "active", expiresAt: null },
  entitlements: ["enterprise_workspace"],
  wallet: { enabled: true, redeemEnabled: true, currency: "CNY", cashAmount: 20, promoAmount: 1, reservedAmount: 0.4, availableAmount: 20.6, trialExpiresAt: "2026-09-17T00:00:00.000Z" },
  relay: { status: "active", managed: true, keyMasked: "sk-****test", keyVersion: "1", membershipMultiplier: 0.85 },
  featureFlags: { passwordAuth: true, passwordRegistration: true, passwordReset: true, relayLegacyLink: true, relayAutoProvision: true, relayManagedConfig: true, relayWalletUi: true, relayRedeem: true },
  device: { id: "dev_test", name: "测试设备", platform: process.platform },
};

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : "" },
    json: async () => payload,
  };
}

global.fetch = async (url, options = {}) => {
  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({
    pathname,
    search: parsedUrl.search,
    method: String(options.method || "GET"),
    body,
    authorization: options.headers?.authorization || "",
    idempotencyKey: options.headers?.["idempotency-key"] || "",
    credentialPurpose: options.headers?.["x-starcanvas-credential-purpose"] || "",
    credentialDeviceId: options.headers?.["x-starcanvas-device-id"] || "",
  });

  if (pathname === "/auth/send-code") return jsonResponse(200, { ok: true, expiresIn: 300 });
  if (pathname === "/public/capabilities") {
    publicCapabilitiesCalls += 1;
    if (publicCapabilitiesMode === "fail") throw new TypeError("capabilities unavailable");
    const enabled = publicCapabilitiesMode !== "false";
    return jsonResponse(200, {
      passwordAuth: enabled,
      passwordRegistration: enabled,
      passwordReset: enabled,
      relayManagedConfig: enabled,
      relayWalletUi: enabled,
      relayRedeem: enabled,
      relayAutoProvision: enabled,
      relayLegacyLink: enabled,
    });
  }
  if (pathname === "/auth/password/reset/confirm") return jsonResponse(200, { ok: true });
  if (pathname === "/auth/login" || pathname === "/auth/password/login") {
    return jsonResponse(200, {
      accessToken: "expired-access",
      refreshToken: "refresh-one",
      ...accountPayload,
    });
  }
  if (["/auth/register", "/auth/password/register"].includes(pathname)) {
    return jsonResponse(200, {
      accessToken: "register-access",
      refreshToken: "register-refresh",
      ...accountPayload,
      relay: { ...accountPayload.relay, status: "pending", keyMasked: "", keyVersion: "" },
    });
  }
  if (pathname === "/auth/refresh") {
    refreshCount += 1;
    if (refreshMode === "offline") throw new TypeError("fetch failed");
    if (refreshMode === "revoked") {
      return jsonResponse(401, { error: "当前设备已被撤销", code: "DEVICE_REVOKED" });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    return jsonResponse(200, {
      accessToken: "fresh-access",
      refreshToken: "refresh-two",
      ...accountPayload,
    });
  }
  if (pathname === "/me") {
    if (options.headers?.authorization === "Bearer expired-access") {
      return jsonResponse(401, { error: "登录状态已过期", code: "ACCESS_TOKEN_EXPIRED" });
    }
    return jsonResponse(200, accountPayload);
  }
  if (pathname === "/me/organizations") {
    return jsonResponse(200, {
      items: ownedOrganization ? [{
        ...ownedOrganization,
        gateway_id: activeGatewayId || null,
        gateway_name: activeGatewayId ? "测试企业网关" : null,
        gateway_status: activeGatewayId ? "active" : null,
      }] : [],
    });
  }
  if (pathname === "/relay/account" && relayAccountMode === "pending") {
    return jsonResponse(503, { error: "极鑫服务正在开通", code: "RELAY_ACCOUNT_NOT_READY" });
  }
  if (pathname === "/relay/account" && relayAccountMode === "pending-ok") {
    return jsonResponse(200, { relay: { ...accountPayload.relay, status: "pending", keyMasked: "", keyVersion: "" } });
  }
  if (pathname === "/relay/account") return jsonResponse(200, {
    relay: accountPayload.relay,
    managedKey: managedRelayKey,
  });
  if (pathname === "/relay/key/send-code") return jsonResponse(200, { ok: true, expiresIn: 300 });
  if (pathname === "/relay/key/reveal") return jsonResponse(200, relayKeyResponseOverride || (relayKeyResponseMode === "partial"
    ? { keyVersion: accountPayload.relay.keyVersion, key: "sk-managed-revealed" }
    : { ...accountPayload.relay, managedKey: "sk-managed-revealed" }));
  if (pathname === "/relay/key/regenerate") return jsonResponse(200, relayKeyResponseOverride || {
    ...accountPayload.relay,
    keyVersion: "2",
    managedKey: "sk-managed-rotated",
  });
  if (pathname === "/relay/link-existing/send-code") return jsonResponse(200, { ok: true });
  if (pathname === "/relay/link-existing/verify-legacy") return jsonResponse(200, { status: "mfa_required", challenge: "challenge-test", expiresIn: 300 });
  if (pathname === "/relay/link-existing/verify-mfa") return jsonResponse(200, { status: "verified", challenge: "challenge-test-verified", expiresIn: 300 });
  if (pathname === "/relay/link-existing/confirm") return jsonResponse(200, linkReview ? { status: "review" } : { relay: accountPayload.relay, managedKey: "sk-managed-linked" });
  if (pathname === "/wallet" && String(options.method || "GET") === "GET") return jsonResponse(200, { wallet: accountPayload.wallet });
  if (pathname === "/wallet/redeem") return jsonResponse(200, {
    wallet: { ...accountPayload.wallet, cashAmount: 30, availableAmount: 30.6 },
    transaction: { id: "ledger_test", type: "recharge" },
  });
  if (pathname === "/wallet/transactions") return jsonResponse(200, { items: [{ id: "ledger_test", amount: 10 }], nextCursor: null });
  if (pathname === "/relay/usage-records") return jsonResponse(200, { items: [{ id: "usage_test", model: "mock-model" }], nextCursor: null });
  if (pathname === "/commerce/recharge-store") return jsonResponse(200, { url: rechargeStoreUrl });
  if (pathname === "/organizations/self-hosted") {
    ownedOrganization = {
      id: "org_self",
      name: body.name,
      role: "owner",
      status: "gateway_pending",
      organization_type: "self_hosted",
      membership_status: "active",
    };
    return jsonResponse(200, {
      organization: { id: "org_self", name: body.name, role: "owner", status: "gateway_pending" },
      gatewayRegistration: { token: "registration-token", expiresIn: 900 },
    });
  }
  if (pathname === "/organizations/org_self/gateways/activate") {
    activeGatewayId = body.registrationToken === "takeover-registration-token" ? "gw_replacement" : "gw_self";
    ownedOrganization.status = "active";
    return jsonResponse(200, { gatewayId: activeGatewayId, organizationId: "org_self", status: "active" });
  }
  if (pathname === "/organizations/org_self/gateways/gw_self/revoke" && options.method === "POST") {
    activeGatewayId = "";
    ownedOrganization.status = "gateway_pending";
    return jsonResponse(200, { ok: true, organizationId: "org_self", revokedGatewayId: "gw_self", status: "gateway_pending" });
  }
  if (pathname === "/organizations/org_self/gateways/takeover" && options.method === "POST") {
    return jsonResponse(200, {
      organization: { id: "org_self", name: ownedOrganization.name, role: "owner", status: "gateway_pending" },
      gatewayRegistration: { token: "takeover-registration-token", expiresIn: 900 },
      replacedGateway: null,
    });
  }
  if (pathname === "/organizations/org_self/invites") {
    return jsonResponse(200, { inviteCode: "WANJUAN-ENTERPRISE-TEST" });
  }
  if (pathname === "/organizations/org_self/members" && String(options.method || "GET") === "GET") {
    return jsonResponse(200, { items: [{ user_id: "usr_test", role: "owner", status: "active", email: "tester@example.com" }], requesterRole: "owner", policyVersion: 2 });
  }
  if (pathname === "/organizations/org_self/members/member_test" && options.method === "PATCH") return jsonResponse(200, { ok: true, policyVersion: 3 });
  if (pathname === "/organizations/org_self/members/member_test" && options.method === "DELETE") return jsonResponse(200, { ok: true, policyVersion: 4 });
  if (pathname === "/organizations/org_self/quota-defaults" && options.method === "PUT") return jsonResponse(200, { ok: true, policyVersion: 5 });
  if (pathname === "/organizations/org_self/quota-overrides" && options.method === "PUT") return jsonResponse(200, { ok: true, policyVersion: 6 });
  if (pathname === "/auth/logout") return jsonResponse(200, { ok: true });
  return jsonResponse(404, { error: "Not found", code: "NOT_FOUND" });
};

async function run() {
  const staleGatewayRoot = path.join(tempRoot, "enterprise-gateway");
  fs.mkdirSync(staleGatewayRoot, { recursive: true });
  fs.writeFileSync(path.join(staleGatewayRoot, "gateway.json"), JSON.stringify({
    version: 1,
    localGatewayId: "local_stale",
    organizationId: "org_previous_account",
    gatewayId: "gw_previous_account",
    status: "stopped",
  }));
  fs.writeFileSync(path.join(staleGatewayRoot, "stale-secret-marker"), "must be removed");
  const service = require("../electron/main/account-service.cjs");
  const deviceModule = require("../electron/main/account-device.cjs");

  // Anonymous public capability probing is bounded, recoverable after failure,
  // de-duplicated per base URL, and must preserve explicit server false values.
  const savedCapabilityUrl = process.env.WANJUAN_ACCOUNT_API_URL;
  process.env.WANJUAN_ACCOUNT_API_URL = "https://caps-retry.example.com";
  publicCapabilitiesMode = "fail";
  publicCapabilitiesCalls = 0;
  const callsBeforeFailedCapabilities = calls.length;
  const failedCapabilities = await service.refreshPublicCapabilities();
  assert.equal(failedCapabilities.passwordAuth, false);
  assert.equal(publicCapabilitiesCalls, 2, "capability failure retries at most once");
  assert.equal(
    calls.slice(callsBeforeFailedCapabilities).every((call) => call.pathname === "/public/capabilities" && call.method === "GET"),
    true,
    "capability probing never triggers an auth or OTP mutation",
  );
  publicCapabilitiesMode = "success";
  const recoveredCapabilities = await service.refreshPublicCapabilities();
  assert.equal(recoveredCapabilities.passwordAuth, true, "a later bootstrap can recover after a failed probe");
  assert.equal(publicCapabilitiesCalls, 3, "a failed result is not cached");

  process.env.WANJUAN_ACCOUNT_API_URL = "https://caps-concurrent.example.com";
  publicCapabilitiesMode = "success";
  publicCapabilitiesCalls = 0;
  const concurrentCapabilities = await Promise.all(
    Array.from({ length: 5 }, () => service.refreshPublicCapabilities()),
  );
  assert.equal(publicCapabilitiesCalls, 1, "concurrent probes share one in-flight request");
  assert.equal(concurrentCapabilities.every((value) => value.passwordAuth === true), true);

  process.env.WANJUAN_ACCOUNT_API_URL = "https://caps-false.example.com";
  process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW = "1";
  publicCapabilitiesMode = "false";
  publicCapabilitiesCalls = 0;
  const explicitFalse = await service.refreshPublicCapabilities();
  assert.equal(explicitFalse.passwordAuth, false);
  publicCapabilitiesMode = "success";
  const cachedFalse = await service.refreshPublicCapabilities();
  assert.equal(cachedFalse.passwordAuth, false, "explicit server false is cached");
  assert.equal(publicCapabilitiesCalls, 1, "explicit false cache avoids repeat probing");

  process.env.WANJUAN_ACCOUNT_API_URL = "https://caps-other.example.com";
  const otherBaseUrl = await service.refreshPublicCapabilities();
  assert.equal(otherBaseUrl.passwordAuth, true, "capability caches are scoped by base URL");
  process.env.WANJUAN_ACCOUNT_API_URL = savedCapabilityUrl || "https://api.example.com";
  if (originalAccountFusionPreview === undefined) delete process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW;
  else process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW = originalAccountFusionPreview;
  publicCapabilitiesMode = "success";

  assert.equal(service.normalizeBaseUrl("https://api.example.com/"), "https://api.example.com");
  assert.equal(service.normalizeBaseUrl("http://127.0.0.1:39991/"), "http://127.0.0.1:39991");
  assert.throws(() => service.normalizeBaseUrl("http://api.example.com"), /HTTPS/);
  assert.equal(
    service.normalizeBaseUrl("http://192.168.1.9:39218/", { allowPrivateHttp: true }),
    "http://192.168.1.9:39218"
  );
  assert.throws(
    () => service.normalizeBaseUrl("http://203.0.113.20", { allowPrivateHttp: true }),
    /局域网私有地址/
  );
  assert.equal(service.normalizeAccountEmail(" Tester@Example.com "), "tester@example.com");
  assert.throws(() => service.normalizeAccountEmail("13800138000"), /邮箱/);

  delete process.env.WANJUAN_ACCOUNT_API_URL;
  assert.equal(service.accountApiUrl(), service.WANJUAN_ACCOUNT_DEFAULT_API_URL);
  process.env.WANJUAN_ACCOUNT_API_URL = "https://api.example.com";

  const fresh = service.sanitizeAccountState();
  assert.equal(fresh.localMode, true, "fresh installs start in local mode");
  assert.equal(fresh.onboardingComplete, true, "fresh installs do not require onboarding login");
  assert.equal(fresh.requiresLogin, false, "fresh installs do not force the auth dialog");

  const deviceWriteModes = [];
  const deviceChmodModes = [];
  const originalDeviceWrite = fs.writeFileSync;
  const originalDeviceChmod = fs.chmodSync;
  fs.writeFileSync = function (target, data, options) {
    if (String(target).startsWith(path.join(tempRoot, "account-device.json"))) deviceWriteModes.push(options?.mode);
    return originalDeviceWrite.apply(this, arguments);
  };
  fs.chmodSync = function (target, mode) {
    if (target === path.join(tempRoot, "account-device.json")) deviceChmodModes.push(mode);
    return originalDeviceChmod.apply(this, arguments);
  };
  let firstDevice;
  try {
    firstDevice = deviceModule.readOrCreateAccountDevice(tempRoot, { platform: "darwin", hostname: "Test Mac" });
  } finally {
    fs.writeFileSync = originalDeviceWrite;
    fs.chmodSync = originalDeviceChmod;
  }
  assert.deepEqual(deviceWriteModes, [0o600], "device writer requests a private file mode");
  assert.deepEqual(deviceChmodModes, [0o600], "device writer reapplies a private file mode");
  const persistedDevice = deviceModule.readOrCreateAccountDevice(tempRoot, { platform: "darwin", hostname: "Test Mac" });
  const otherDevice = deviceModule.readOrCreateAccountDevice(secondRoot, { platform: "win32", hostname: "Test PC" });
  assert.equal(firstDevice.installationId, persistedDevice.installationId);
  assert.notEqual(firstDevice.installationId, otherDevice.installationId);
  assert.equal(firstDevice.platform, "darwin");
  assert.equal(otherDevice.platform, "win32");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(tempRoot, "account-device.json")).mode & 0o777, 0o600);
  } else {
    console.log("POSIX mode assertion is not applicable on NTFS; ACL acceptance remains a separate gate");
  }

  const local = service.continueWithLocalMode();
  assert.equal(local.ok, true);
  assert.equal(local.localMode, true);
  assert.equal(local.onboardingComplete, true);
  assert.equal(Object.prototype.hasOwnProperty.call(local, "accessToken"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(local, "refreshToken"), false);

  relayAccountMode = "pending";
  const registered = await service.loginAccount({ identifier: "new@example.com", code: "123456", password: "password-test-123", register: true });
  assert.equal(registered.authenticated, true, "relay provisioning does not block registration/login");
  assert.equal(registered.relay.status, "pending");
  assert.equal((await service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", {})).managed, false);
  assert.equal(JSON.stringify(service.sanitizeAccountState()).includes("managedRelayKey"), false);
  relayAccountMode = "active";
  const activatedRelay = await service.getRelayAccount();
  assert.equal(activatedRelay.relay.status, "active", "pending provisioning can activate without another login");
  assert.equal((await service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" })).managed, true);

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    relayAccountMode = "pending-ok";
    const pendingOk = await service.loginAccount({ identifier: "new@example.com", code: "123456", password: "password-test-123", register: true });
    assert.equal(pendingOk.relay.status, "pending");
    const beforeAutoPoll = calls.filter((call) => call.pathname === "/relay/account").length;
    mock.timers.tick(1000);
    for (let turn = 0; turn < 4; turn += 1) await new Promise(setImmediate);
    assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, beforeAutoPoll + 1, "HTTP 200 pending keeps automatic provisioning alive");
    for (let attempt = 1; attempt < 24; attempt += 1) {
      mock.timers.tick(Math.min(30000, 1000 * (2 ** Math.min(attempt, 5))));
      for (let turn = 0; turn < 4; turn += 1) await new Promise(setImmediate);
    }
    assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, beforeAutoPoll + 24, "pending provisioning keeps retrying past twenty attempts at a bounded rate");
    relayAccountMode = "active";
    mock.timers.tick(30000);
    for (let turn = 0; turn < 4; turn += 1) await new Promise(setImmediate);
    assert.equal(service.sanitizeAccountState().relay.status, "active", "provisioning activates without a manual refresh");
    const afterActivation = calls.filter((call) => call.pathname === "/relay/account").length;
    mock.timers.tick(60000);
    assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, afterActivation, "active accounts do not poll forever");
    relayAccountMode = "pending-ok";
    await service.loginAccount({ identifier: "new@example.com", code: "123456", password: "password-test-123", register: true });
    await service.logoutAccount();
    const afterLogout = calls.filter((call) => call.pathname === "/relay/account").length;
    mock.timers.tick(60000);
    assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, afterLogout, "logout cancels provisioning retry");
  } finally {
    mock.timers.reset();
    relayAccountMode = "active";
  }

  await service.sendAccountCode({ identifier: "Tester@Example.com", purpose: "login" });
  const loggedIn = await service.loginAccount({ identifier: "Tester@Example.com", code: "123456" });
  assert.equal(loggedIn.authenticated, true);
  assert.equal(loggedIn.relay.status, "active");
  assert.equal(Object.hasOwn(loggedIn.relay, "membershipMultiplier"), false, "legacy pricing multiplier is excluded from future account state");
  assert.equal(loggedIn.wallet.availableAmount, 20.6);
  assert.equal(loggedIn.wallet.promoExpiresAt, "2026-09-17T00:00:00.000Z");
  assert.deepEqual(loggedIn.featureFlags, accountPayload.featureFlags);
  assert.equal(Object.prototype.hasOwnProperty.call(loggedIn.relay, "managedKey"), false);
  const loginCall = calls.find((call) => call.pathname === "/auth/login");
  assert.equal(loginCall.body.identifier, "tester@example.com");
  assert.equal(loginCall.body.deviceFingerprint, firstDevice.installationId);
  assert.equal(loginCall.body.platform, process.platform);
  assert.ok(loginCall.body.deviceName);

  const persisted = JSON.parse(fs.readFileSync(path.join(tempRoot, "account-session.json"), "utf8"));
  assert.equal(JSON.stringify(persisted).includes("accessToken"), false);
  assert.equal(JSON.stringify(persisted).includes(firstDevice.installationId), false);
  assert.equal(JSON.stringify(persisted).includes("sk-managed-main-only"), false);
  assert.ok(String(persisted.relayManagedKeyEncrypted || "").length > 0);
  const managedCredentialCall = calls.find((call) => call.pathname === "/relay/account" && call.credentialPurpose);
  assert.equal(managedCredentialCall.credentialPurpose, "managed-config");
  assert.equal(managedCredentialCall.credentialDeviceId, "dev_test");

  const managedRequest = await service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", {
    Authorization: "Bearer __WANJUAN_MANAGED_RELAY__",
    "x-api-key": "__WANJUAN_MANAGED_RELAY__",
  });
  assert.equal(managedRequest.managed, true);
  assert.equal(managedRequest.headers.Authorization, "Bearer sk-managed-main-only");
  assert.equal(Object.keys(managedRequest.headers).some((key) => key.toLowerCase() === "x-api-key"), false);
  const foreignRequest = await service.prepareManagedRelayRequest("https://api.example.com/v1/models", { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" });
  assert.equal(foreignRequest.managed, false);
  const manualRequest = await service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", { Authorization: "Bearer sk-user-manual" });
  assert.equal(manualRequest.managed, false);
  assert.equal(manualRequest.headers.Authorization, "Bearer sk-user-manual");
  for (const unsafeUrl of [
    "https://user:jixin-secret@jixing.guancn.uk/v1/models",
    "https://jixing.guancn.uk:8443/v1/models",
    "http://jixing.guancn.uk/v1/models",
  ]) {
    const unsafe = await service.prepareManagedRelayRequest(unsafeUrl, { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" });
    assert.equal(unsafe.managed, false, `managed key must not match unsafe relay URL: ${unsafeUrl}`);
    assert.equal(unsafe.headers.Authorization, "Bearer __WANJUAN_MANAGED_RELAY__");
  }
  const customPortManual = await service.prepareManagedRelayRequest("https://jixing.guancn.uk:8443/v1/models", { Authorization: "Bearer sk-user-manual" });
  assert.equal(customPortManual.managed, false);
  assert.equal(customPortManual.headers.Authorization, "Bearer sk-user-manual");

  const wallet = await service.getWallet();
  assert.equal(wallet.wallet.currency, "CNY");
  assert.equal(wallet.wallet.availableAmount, 20.6);
  const redeemed = await service.redeemWalletCode({ code: "RECHARGE-TEST", idempotencyKey: "redeem-test-0001" });
  assert.equal(redeemed.wallet.availableAmount, 30.6);
  const redeemCall = calls.find((call) => call.pathname === "/wallet/redeem");
  assert.equal(redeemCall.idempotencyKey, "redeem-test-0001");
  assert.deepEqual(Object.keys(redeemCall.body), ["code"], "wallet redeem body must keep idempotency in the header only");
  assert.equal((await service.getWalletTransactions({ cursor: "wallet-page-2", limit: 20, status: "success", from: "2026-10-01T00:00:00.000Z", to: "2026-10-19T00:00:00.000Z" })).items.length, 1);
  const walletListCall = calls.findLast((call) => call.pathname === "/wallet/transactions");
  assert.equal(walletListCall.search.includes("cursor=wallet-page-2"), true);
  assert.equal(walletListCall.search.includes("status="), false);
  assert.equal(walletListCall.search.includes("from=2026-10-01T00%3A00%3A00.000Z"), true);
  assert.equal(walletListCall.search.includes("to=2026-10-19T00%3A00%3A00.000Z"), true);
  assert.equal((await service.getRelayUsageRecords({ cursor: "usage-page-2", model: "mock-model", status: "failed", from: "2026-10-01T00:00:00.000Z", to: "2026-10-19T00:00:00.000Z" })).items.length, 1);
  const usageListCall = calls.findLast((call) => call.pathname === "/relay/usage-records");
  assert.equal(usageListCall.search.includes("cursor=usage-page-2"), true);
  assert.equal(usageListCall.search.includes("model=mock-model"), true);
  assert.equal(usageListCall.search.includes("status=failed"), true);
  assert.equal(usageListCall.search.includes("from=2026-10-01T00%3A00%3A00.000Z"), true);
  assert.equal(usageListCall.search.includes("to=2026-10-19T00%3A00%3A00.000Z"), true);
  assert.deepEqual(await service.getRechargeStore(), { ok: true, available: true, url: "https://shop.example.com/recharge" });
  rechargeStoreUrl = "";
  assert.deepEqual(await service.getRechargeStore(), { ok: true, available: false, url: "" });
  for (const invalid of ["http://shop.example.com", "https://user:pass@shop.example.com", "not a url"]) {
    rechargeStoreUrl = invalid;
    await assert.rejects(() => service.getRechargeStore(), (error) => error.code === "RECHARGE_STORE_URL_INVALID");
  }
  rechargeStoreUrl = "https://shop.example.com/recharge";
  await service.sendRelayKeyCode({ purpose: "relay_key_reveal" });
  relayKeyResponseMode = "partial";
  const revealed = await service.revealRelayKey({ code: "123456" });
  assert.equal(revealed.key, "sk-managed-revealed");
  const sanitizedAfterReveal = service.sanitizeAccountState();
  assert.equal(JSON.stringify(sanitizedAfterReveal).includes("sk-managed-revealed"), false);
  assert.equal(sanitizedAfterReveal.relay.status, "active");
  assert.equal(sanitizedAfterReveal.relay.managed, true);
  relayKeyResponseMode = "complete";
  assert.equal((await service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", {
    Authorization: "Bearer __WANJUAN_MANAGED_RELAY__",
  })).headers.Authorization, "Bearer sk-managed-revealed", "key-only reveal must not disable the managed credential");
  relayKeyResponseOverride = { key: "sk-managed-rotated", keyVersion: "2" };
  const rotated = await service.regenerateRelayKey({ code: "123456", idempotencyKey: "rotate-test-0001" });
  assert.equal(rotated.key, "sk-managed-rotated");
  assert.deepEqual(rotated.relay, { ...sanitizedAfterReveal.relay, keyVersion: "2" });
  const rotateCall = calls.find((call) => call.pathname === "/relay/key/regenerate");
  assert.equal(rotateCall.idempotencyKey, "rotate-test-0001");
  assert.deepEqual(Object.keys(rotateCall.body), ["code"], "relay key rotation body must match KeyOperationBody; idempotency is header-only");
  assert.equal(rotateCall.body.code, "123456");
  for (const metadata of [{ managed: false }, { status: "inactive" }, { status: "suspended" }, { managed: "true" }]) {
    await service.getRelayAccount();
    relayKeyResponseOverride = { key: "sk-disabled-not-persisted", keyVersion: "3", ...metadata };
    await service.revealRelayKey({ code: "123456" });
    assert.equal(service.readAccountState().relayManagedKeyEncrypted, "", "explicit disabled metadata clears the managed key");
    await assert.rejects(() => service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", {
      Authorization: "Bearer __WANJUAN_MANAGED_RELAY__",
    }), /暂不可用/);
  }
  relayKeyResponseOverride = null;
  await service.getRelayAccount();
  const relayFetchesBeforeLink = calls.filter((call) => call.pathname === "/relay/account").length;
  await service.verifyLegacyRelayAccount({ username: "legacy-user", password: "legacy-password" });
  const legacyVerifyCall = calls.find((call) => call.pathname === "/relay/link-existing/verify-legacy");
  assert.deepEqual(Object.keys(legacyVerifyCall.body).sort(), ["username", "password"].sort());
  await service.verifyLegacyRelayMfa({ challenge: "challenge-test", code: "123456" });
  const legacyMfaCall = calls.find((call) => call.pathname === "/relay/link-existing/verify-mfa");
  assert.deepEqual(Object.keys(legacyMfaCall.body).sort(), ["challenge", "code"].sort());
  assert.equal(JSON.stringify(service.readAccountState()).includes("legacy-password"), false, "legacy password is never persisted");
  assert.equal(JSON.stringify(service.readAccountState()).includes("challenge-test"), false, "legacy challenge is never persisted");
  await service.sendRelayLinkCode({ identifier: "attacker@example.com" });
  const linkCodeCall = calls.find((call) => call.pathname === "/relay/link-existing/send-code");
  assert.equal(linkCodeCall.body.identifier, "tester@example.com", "link OTP is always sent to the verified current account email");
  assert.deepEqual(Object.keys(linkCodeCall.body), ["identifier"], "link OTP body matches the strict server DTO");
  const beforeInvalidLinkKey = calls.length;
  await assert.rejects(
    service.confirmRelayLink({ code: "123456", challenge: "challenge-test-verified", idempotencyKey: "too-short" }),
    { code: "INVALID_IDEMPOTENCY_KEY" },
  );
  assert.equal(calls.length, beforeInvalidLinkKey, "invalid link idempotency keys are rejected before the network");
  const linked = await service.confirmRelayLink({ identifier: "attacker@example.com", code: "123456", challenge: "challenge-test-verified", idempotencyKey: "link-test-00000001" });
  assert.equal(linked.relay.status, "active");
  const relayFetchesAfterLink = calls.filter((call) => call.pathname === "/relay/account");
  assert.equal(relayFetchesAfterLink.length, relayFetchesBeforeLink + 1, "active legacy link refreshes its managed credential");
  assert.equal(relayFetchesAfterLink.at(-1).credentialPurpose, "managed-config");
  assert.equal(relayFetchesAfterLink.at(-1).credentialDeviceId, "dev_test");
  const linkConfirmCall = calls.find((call) => call.pathname === "/relay/link-existing/confirm");
  assert.equal(linkConfirmCall.idempotencyKey, "link-test-00000001");
  assert.equal(linkConfirmCall.body.identifier, "tester@example.com", "renderer cannot redirect legacy linking to another email");
  assert.equal(linkConfirmCall.body.challenge, "challenge-test-verified");
  assert.deepEqual(Object.keys(linkConfirmCall.body).sort(), ["identifier", "code", "challenge"].sort());
  await service.confirmRelayLink({ identifier: "tester@example.com", code: "123456", challenge: "challenge-test-verified", idempotencyKey: "link-test-00000001" });
  const repeatedLinkCalls = calls.filter((call) => call.pathname === "/relay/link-existing/confirm");
  assert.equal(repeatedLinkCalls.length, 2, "a lost link response can be retried");
  assert.equal(repeatedLinkCalls.every((call) => call.idempotencyKey === "link-test-00000001" && call.body.challenge === "challenge-test-verified"), true);
  const beforeReview = JSON.stringify(service.readAccountState());
  linkReview = true;
  const reviewResult = await service.confirmRelayLink({ identifier: "tester@example.com", code: "123456", challenge: "challenge-test-verified", idempotencyKey: "link-review-0000001" });
  assert.equal(reviewResult.status, "review");
  assert.equal(reviewResult.code, "LINK_REVIEW_REQUIRED");
  assert.equal(JSON.stringify(service.readAccountState()), beforeReview, "review must not mutate existing account, wallet or credentials");
  linkReview = false;
  const beforePassword = calls.length;
  await assert.rejects(service.loginAccount({ identifier: "tester@example.com", password: "short" }), { code: "INVALID_REQUEST" });
  assert.equal(calls.length, beforePassword);
  await assert.rejects(service.loginAccount({ identifier: "tester@example.com", password: "valid-password\nwith-control" }), { code: "INVALID_REQUEST" });
  assert.equal(calls.length, beforePassword, "invalid password controls are rejected before the network");
  const passwordFixture = "  mock-password-123  ";
  await service.loginAccount({ identifier: "tester@example.com", password: passwordFixture, role: "admin", inviteCode: "forbidden", code: "unused" });
  const passwordCall = calls.findLast((call) => call.pathname === "/auth/password/login");
  assert.deepEqual(Object.keys(passwordCall.body).sort(), ["identifier", "password", "deviceName", "deviceFingerprint", "platform"].sort());
  assert.equal(passwordCall.body.password, passwordFixture, "password whitespace preserved");
  const registrationCall = calls.find((call) => call.pathname === "/auth/password/register");
  assert.deepEqual(Object.keys(registrationCall.body).sort(), ["identifier", "password", "code", "deviceName", "deviceFingerprint", "platform"].sort());
  assert.equal(JSON.stringify(service.readAccountState()).includes(passwordFixture), false);
  await service.sendAccountCode({ identifier: "unknown@example.com", purpose: "reset_password" });
  assert.equal(calls.at(-1).body.purpose, "reset_password");
  const beforeInvalidPurpose = calls.length;
  await assert.rejects(service.sendAccountCode({ identifier: "unknown@example.com", purpose: "relay_account_link" }), { code: "INVALID_VERIFICATION_PURPOSE" });
  assert.equal(calls.length, beforeInvalidPurpose, "renderer cannot select internal OTP purposes");
  const beforeReset = JSON.stringify(service.readAccountState());
  const beforeInvalidReset = calls.length;
  await assert.rejects(service.resetAccountPassword({ identifier: "unknown@example.com", code: "bad", newPassword: passwordFixture }), { code: "INVALID_VERIFICATION_CODE" });
  assert.equal(calls.length, beforeInvalidReset, "invalid reset codes are rejected before the network");
  assert.deepEqual(await service.resetAccountPassword({ identifier: "unknown@example.com", code: "123456", newPassword: passwordFixture, role: "admin" }), { ok: true });
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(), ["identifier", "code", "newPassword"].sort());
  assert.equal(JSON.stringify(service.readAccountState()), beforeReset, "reset for another email does not clear signed-in account");

  managedRelayKey = "sk-managed-refreshed-once";
  const retryHeaders = [];
  const retryResponse = await service.requestWithManagedRelayRetry(
    "https://jixing.guancn.uk/v1/models",
    { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" },
    async (headers) => {
      retryHeaders.push(headers.Authorization);
      return { status: retryHeaders.length === 1 ? 401 : 200 };
    },
  );
  assert.equal(retryResponse.status, 200);
  assert.equal(retryHeaders.length, 2, "managed 401 retries exactly once");
  assert.notEqual(retryHeaders[0], retryHeaders[1], "401 refresh synchronizes the rotated managed key");
  let persistent401Count = 0;
  const persistent401 = await service.requestWithManagedRelayRetry(
    "https://jixing.guancn.uk/v1/models",
    { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" },
    async () => { persistent401Count += 1; return { status: 401 }; },
  );
  assert.equal(persistent401.status, 401);
  assert.equal(persistent401Count, 2, "a second 401 is returned without an infinite retry");

  refreshCount = 0;
  const refreshedStates = await Promise.all(Array.from({ length: 5 }, () => service.getCurrentAccount()));
  assert.equal(refreshCount, 1);
  assert.equal(refreshedStates.every((state) => state.authenticated && !state.offline), true);

  const enterpriseSnapshot = {
    schemaVersion: 1,
    backupSchemaVersion: 4,
    version: 1,
    createdAt: Date.now(),
    sourceAppVersion: "1.3.9-test",
    hash: "sha256:account-enterprise-test",
    modules: {
      settings: {
        chromeStorage: {
          apiConfigs: [{ id: "api_test", url: "https://api.example.com", key: { $secretRef: "secret_api_test" } }],
        },
        selectedSections: ["api", "models", "cloud"],
      },
    },
  };
  const createdEnterprise = await service.createEnterpriseGateway({
    operationId: "operation-account-test",
    organizationName: "测试企业",
    gatewayName: "测试企业网关",
    timezone: "Asia/Shanghai",
    autoStart: true,
    snapshot: enterpriseSnapshot,
    secrets: [{ id: "secret_api_test", type: "api_key", path: "apiConfigs.0.key", value: "sk-account-enterprise-secret" }],
    defaultQuotas: [{ capability: "image_generation", enabled: true, limit: 50, unit: "成功输出张数" }],
  });
  assert.equal(createdEnterprise.enterprise.mode, "host");
  assert.equal(createdEnterprise.enterprise.gatewayId, "gw_self");
  assert.equal(createdEnterprise.gatewayHost.running, true);
  assert.equal(fs.existsSync(path.join(staleGatewayRoot, "stale-secret-marker")), false);
  assert.equal(createdEnterprise.creationResult.inviteCode, "WANJUAN-ENTERPRISE-TEST");
  const createOrganizationCall = calls.find((call) => call.pathname === "/organizations/self-hosted");
  assert.equal(createOrganizationCall.idempotencyKey, "operation-account-test");
  assert.deepEqual(createOrganizationCall.body.defaultQuotas, [{
    capabilityKey: "image_generation",
    enabled: true,
    limitValue: 50,
    unit: "successful_outputs",
  }]);
  const activationCall = calls.find((call) => call.pathname === "/organizations/org_self/gateways/activate");
  assert.equal(Buffer.from(activationCall.body.publicKey, "base64").length, 32);
  assert.ok(activationCall.body.certificateFingerprint.startsWith("sha256/"));
  const firstCertificateFingerprint = activationCall.body.certificateFingerprint;
  const management = await service.getEnterpriseManagement();
  assert.equal(management.requesterRole, "owner");
  assert.equal(management.members[0].user_id, "usr_test");
  await service.updateEnterpriseMember({ userId: "member_test", status: "disabled" });
  await service.updateEnterpriseQuotaDefault({ capabilityKey: "video_generation", enabled: true, limitValue: 12, unit: "successful_tasks" });
  await service.updateEnterpriseMemberQuota({ userId: "member_test", capabilityKey: "video_generation", mode: "limit", limitValue: 4 });
  await service.removeEnterpriseMember({ userId: "member_test" });
  assert.equal(calls.some((call) => call.pathname === "/organizations/org_self/quota-defaults" && call.body.limitValue === 12), true);
  assert.equal(calls.some((call) => call.pathname === "/organizations/org_self/quota-overrides" && call.body.userId === "member_test"), true);

  // The gateway identity is stored separately from the account session. Logging out
  // must not make the same owner/device look like an unbound takeover candidate.
  await service.logoutAccount();
  await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
  const recoveredGatewayOwner = await service.getCurrentAccount();
  assert.equal(recoveredGatewayOwner.gatewayHost.initialized, true);
  assert.equal(recoveredGatewayOwner.enterprise?.mode, "host");
  assert.equal(recoveredGatewayOwner.enterprise?.organization?.id, "org_self");
  assert.equal(recoveredGatewayOwner.enterprise?.connected, true);
  assert.equal(recoveredGatewayOwner.ownedEnterprise?.id, "org_self");

  activeGatewayId = "gw_taken_over_elsewhere";
  await service.logoutAccount();
  await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
  const staleLocalGateway = await service.getCurrentAccount();
  assert.equal(staleLocalGateway.gatewayHost.initialized, true);
  assert.equal(staleLocalGateway.enterprise, null);
  assert.equal(staleLocalGateway.ownedEnterprise?.gatewayId, "gw_taken_over_elsewhere");

  activeGatewayId = "gw_self";
  const matchedGatewayAgain = await service.getCurrentAccount();
  assert.equal(matchedGatewayAgain.enterprise?.mode, "host");
  assert.equal(matchedGatewayAgain.enterprise?.gatewayId, "gw_self");

  const releasedEnterprise = await service.releaseCreatedEnterpriseGateway({
    organizationId: "org_self",
    gatewayId: "gw_self",
  });
  assert.equal(releasedEnterprise.enterprise, null);
  assert.equal(releasedEnterprise.gatewayHost.initialized, false);
  assert.equal(fs.existsSync(path.join(tempRoot, "enterprise-gateway")), false);
  assert.equal(calls.some((call) => call.pathname === "/organizations/org_self/gateways/gw_self/revoke"), true);

  const accountWithOwnedEnterprise = await service.getCurrentAccount();
  assert.equal(accountWithOwnedEnterprise.ownedEnterprise.id, "org_self");
  assert.equal(accountWithOwnedEnterprise.ownedEnterprise.gatewayId, "");

  const createCallCountBeforeTakeover = calls.filter((call) => call.pathname === "/organizations/self-hosted").length;
  const takenOverEnterprise = await service.takeOverEnterpriseGateway({
    operationId: "operation-account-takeover-test",
    organizationId: "org_self",
    gatewayName: "新电脑企业网关",
    autoStart: true,
    snapshot: { ...enterpriseSnapshot, version: 2, hash: "sha256:account-enterprise-takeover-test" },
    secrets: [{ id: "secret_api_test", type: "api_key", path: "apiConfigs.0.key", value: "sk-account-enterprise-secret" }],
  });
  assert.equal(takenOverEnterprise.enterprise.mode, "host");
  assert.equal(takenOverEnterprise.enterprise.gatewayId, "gw_replacement");
  assert.equal(takenOverEnterprise.gatewayHost.running, true);
  assert.equal(takenOverEnterprise.creationResult.replaced, true);
  assert.equal(calls.filter((call) => call.pathname === "/organizations/self-hosted").length, createCallCountBeforeTakeover);
  const takeoverCall = calls.find((call) => call.pathname === "/organizations/org_self/gateways/takeover");
  assert.equal(takeoverCall.idempotencyKey, "operation-account-takeover-test");
  assert.equal(takeoverCall.body.deviceId, "dev_test");
  const replacementActivationCall = calls.filter((call) => call.pathname === "/organizations/org_self/gateways/activate").at(-1);
  assert.equal(replacementActivationCall.body.registrationToken, "takeover-registration-token");
  assert.notEqual(replacementActivationCall.body.certificateFingerprint, firstCertificateFingerprint);

  await service.logoutAccount();
  const logoutCall = calls.filter((call) => call.pathname === "/auth/logout").at(-1);
  assert.equal(logoutCall.body.refreshToken, "refresh-two");
  assert.equal(service.sanitizeAccountState().authenticated, false);
  assert.equal(service.sanitizeAccountState().relay, null);
  assert.equal(service.sanitizeAccountState().featureFlags.relayManagedConfig, false);
  await assert.rejects(
    () => service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", { Authorization: "Bearer __WANJUAN_MANAGED_RELAY__" }),
    /暂不可用/,
    "logout disables the managed credential without touching manual configurations",
  );

  await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
  refreshMode = "revoked";
  const revoked = await service.bootstrapAccount();
  assert.equal(revoked.authenticated, false);
  assert.equal(revoked.requiresLogin, true);
  assert.equal(revoked.errorCode, "DEVICE_REVOKED");
  assert.equal(service.readAccountState().session, null);

  refreshMode = "success";
  await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
  refreshMode = "offline";
  const offline = await service.bootstrapAccount();
  assert.equal(offline.authenticated, true);
  assert.equal(offline.offline, true);
  assert.equal(offline.errorCode, "ACCOUNT_NETWORK_ERROR");
  assert.ok(service.readAccountState().session?.refreshTokenEncrypted);

  const oldCiphertext = service.readAccountState().session.refreshTokenEncrypted;
  decryptErrorCode = "SECURE_STORAGE_RELOGIN_REQUIRED";
  const relogin = await service.bootstrapAccount();
  assert.equal(relogin.authenticated, false);
  assert.equal(relogin.requiresLogin, true);
  assert.equal(relogin.errorCode, "SECURE_STORAGE_RELOGIN_REQUIRED");
  assert.equal(service.readAccountState().session.refreshTokenEncrypted, oldCiphertext);
  decryptErrorCode = "";

  for (const status of ["failed", "suspended"]) {
    accountPayload.relay.status = status;
    accountPayload.featureFlags = { relayAutoProvision: true, relayManagedConfig: true, relayWalletUi: true, relayRedeem: true };
    const before = calls.filter((call) => call.pathname === "/relay/account").length;
    const statusState = await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
    assert.equal(statusState.relay.status, status);
    assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, before, `${status} does not bootstrap a credential in the background`);
  }
  accountPayload.relay.status = "active";

  accountPayload.featureFlags = {
    passwordAuth: false,
    passwordRegistration: false,
    passwordReset: false,
    relayLegacyLink: false,
    relayAutoProvision: false,
    relayManagedConfig: false,
    relayWalletUi: false,
    relayRedeem: false,
  };
  accountPayload.wallet.enabled = false;
  accountPayload.wallet.redeemEnabled = false;
  const relayFetchCountBeforeDisabledLogin = calls.filter((call) => call.pathname === "/relay/account").length;
  const disabledFeatures = await service.loginAccount({ identifier: "tester@example.com", code: "123456" });
  assert.deepEqual(disabledFeatures.featureFlags, accountPayload.featureFlags);
  assert.equal(calls.filter((call) => call.pathname === "/relay/account").length, relayFetchCountBeforeDisabledLogin, "disabled managed config does not bootstrap");
  await assert.rejects(() => service.getRelayAccount(), (error) => error.code === "RELAY_MANAGED_CONFIG_DISABLED");
  await assert.rejects(() => service.getWallet(), (error) => error.code === "RELAY_WALLET_UI_DISABLED");
  await assert.rejects(() => service.redeemWalletCode({ code: "NOPE", idempotencyKey: "disabled-redeem" }), (error) => error.code === "RELAY_REDEEM_DISABLED");

  const bridgeSource = fs.readFileSync(path.join(__dirname, "../electron/preload/bridge-api.cjs"), "utf8");
  assert.equal(bridgeSource.includes("accountGetAccessToken"), false);
  assert.equal(bridgeSource.includes("accountGetRefreshToken"), false);
  assert.equal(bridgeSource.includes("accountTakeoverEnterpriseGateway"), true);
  assert.equal(bridgeSource.includes("accountReleaseEnterpriseGateway"), true);
  assert.equal((bridgeSource.match(/accountRelayKeyReveal:/g) || []).length, 1);
  assert.equal(bridgeSource.includes("accountWalletTransactions"), true);
  assert.equal(bridgeSource.includes("accountRelayUsage"), true);
  const ipcSource = fs.readFileSync(path.join(__dirname, "../electron/main/ipc.cjs"), "utf8");
  assert.equal(ipcSource.includes("wanjuan:account-takeover-enterprise-gateway"), true);
  assert.equal(ipcSource.includes("wanjuan:account-release-enterprise-gateway"), true);
  assert.equal(ipcSource.includes("requestWithManagedRelayRetry"), true);

  console.log("account main boundary: auth, enterprise release/takeover lifecycle and IPC guards passed");
}

run().finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  if (originalAccountUrl === undefined) delete process.env.WANJUAN_ACCOUNT_API_URL;
  else process.env.WANJUAN_ACCOUNT_API_URL = originalAccountUrl;
  if (originalAccountFusionPreview === undefined) delete process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW;
  else process.env.WANJUAN_ACCOUNT_FUSION_PREVIEW = originalAccountFusionPreview;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(secondRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
