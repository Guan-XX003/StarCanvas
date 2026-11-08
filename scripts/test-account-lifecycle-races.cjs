const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-account-lifecycle-"));
let holdEncryption = null;
let holdDecryption = null;
let failDecryption = false;
const fakeElectron = {
  app: { getPath: () => tempRoot, getVersion: () => "1.4.7-test" },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (value) => {
      const gate = holdEncryption;
      if (gate) { gate.started = true; await gate.promise; }
      return Buffer.from(`encrypted:${value}`, "utf8");
    },
    decryptStringAsync: async (buffer) => {
      const gate = holdDecryption;
      if (gate) { gate.started = true; await gate.promise; }
      if (failDecryption) throw new Error("native storage denied");
      return { result: buffer.toString("utf8").replace(/^encrypted:/, ""), shouldReEncrypt: false };
    },
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (buffer) => buffer.toString("utf8").replace(/^encrypted:/, ""),
  },
};

const flags = {
  passwordAuth: true,
  passwordRegistration: true,
  passwordReset: true,
  relayLegacyLink: true,
  relayAutoProvision: true,
  relayManagedConfig: true,
  relayWalletUi: true,
  relayRedeem: true,
};
const identities = {
  a: {
    user: { id: "user-a", email: "a@example.test" },
    subscription: { plan: "pro-a" },
    entitlements: ["a-only"],
    wallet: { enabled: true, availableAmount: 11, cashAmount: 10 },
    relay: { status: "active", managed: true, keyMasked: "key-a", keyVersion: "a1" },
    featureFlags: flags,
    managedKey: "synthetic-key-a",
  },
  b: {
    user: { id: "user-b", email: "b@example.test" },
    subscription: null,
    entitlements: [],
    wallet: null,
    relay: null,
    featureFlags: {
      passwordAuth: false,
      passwordRegistration: false,
      passwordReset: false,
      relayLegacyLink: false,
      relayAutoProvision: false,
      relayManagedConfig: false,
      relayWalletUi: false,
      relayRedeem: false,
    },
    managedKey: "",
  },
};
let activeIdentity = identities.a;
let holdRefresh = null;
let holdMe = null;
let holdWallet = null;
let holdRelay = null;
let holdWorkspaceSnapshot = null;
let enterpriseCache = null;

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve, started: false };
};
const waitStarted = async (gate, label) => {
  const deadline = Date.now() + 3000;
  while (!gate.started && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.started, true, `${label} did not start`);
};
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : "" },
  json: async () => body,
});
const accountPayload = (identity = activeIdentity) => ({
  user: identity.user,
  subscription: identity.subscription,
  entitlements: identity.entitlements,
  ...(identity.wallet ? { wallet: identity.wallet } : {}),
  ...(identity.relay ? { relay: identity.relay } : {}),
  featureFlags: identity.featureFlags,
  device: { id: `device-${identity.user.id}`, platform: process.platform },
  ...(identity.managedKey ? { managedKey: identity.managedKey } : {}),
});

const originalLoad = Module._load;
const originalFetch = global.fetch;
const originalAccountUrl = process.env.WANJUAN_ACCOUNT_API_URL;

const gatewayStub = {
  clearEnterpriseGatewayLocalState: async () => {},
  completeEnterpriseGatewayActivation: async () => ({}),
  getEnterpriseGatewayManagementSnapshot: () => ({}),
  getEnterpriseGatewayStatus: () => ({ initialized: false, running: false }),
  initializeEnterpriseGateway: async () => ({}),
  invokeEnterpriseTeamTemplatesAsHost: async () => ({ ok: true, items: [] }),
  publishEnterpriseGatewaySnapshot: async () => ({}),
  startEnterpriseGateway: async () => ({}),
  stopEnterpriseGateway: async () => ({}),
  syncGatewayControlPlane: async () => ({}),
};
const gatewayClientStub = {
  clearEnterpriseSnapshotCache: () => { enterpriseCache = null; },
  readEnterpriseSnapshotCache: () => enterpriseCache,
  writeEnterpriseSnapshotCache: (value) => { enterpriseCache = value; return value; },
  requestPinnedUpload: async () => ({ value: { ok: true } }),
  requestPinnedJson: async (_baseUrl, pathname, options = {}) => {
    if (pathname === "/workspace/session") {
      return { value: { workspaceToken: "workspace-token", expiresIn: 3600 } };
    }
    if (pathname === "/workspace/config-snapshot") {
      const snapshot = {
        schemaVersion: 1,
        version: holdWorkspaceSnapshot ? 2 : 1,
        hash: holdWorkspaceSnapshot ? "sha256:late" : "sha256:initial",
        modules: { settings: { chromeStorage: { textModel: "synthetic-model" } } },
      };
      if (holdWorkspaceSnapshot) {
        const gate = holdWorkspaceSnapshot;
        gate.started = true;
        await gate.promise;
      }
      return { value: snapshot };
    }
    if (pathname === "/workspace/logout" && options.method === "POST") return { value: { ok: true } };
    return { value: { ok: true } };
  },
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron" || request === "electron/main") return fakeElectron;
  if (request === "./enterprise-gateway.cjs" && String(parent?.filename || "").endsWith("account-service.cjs")) return gatewayStub;
  if (request === "./enterprise-gateway-client.cjs" && String(parent?.filename || "").endsWith("account-service.cjs")) return gatewayClientStub;
  return originalLoad.call(this, request, parent, isMain);
};

process.env.WANJUAN_ACCOUNT_API_URL = "http://127.0.0.1:39991";
global.fetch = async (url, options = {}) => {
  const pathname = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  if (["/auth/login", "/auth/password/login"].includes(pathname)) {
    return response(200, {
      accessToken: `access-${activeIdentity.user.id}`,
      refreshToken: `refresh-${activeIdentity.user.id}`,
      ...accountPayload(),
    });
  }
  if (pathname === "/auth/refresh") {
    const captured = accountPayload();
    const gate = holdRefresh;
    if (gate) { gate.started = true; await gate.promise; }
    if (gate?.rejectAsRevoked) return response(401, { error: "revoked", code: "SESSION_REVOKED" });
    return response(200, { accessToken: "late-access", refreshToken: body.refreshToken, ...captured });
  }
  if (pathname === "/auth/logout") return response(200, { ok: true });
  if (pathname === "/me") {
    const captured = accountPayload();
    const gate = holdMe;
    if (gate) { gate.started = true; await gate.promise; }
    if (gate?.rejectAsRevoked) return response(401, { error: "revoked", code: "SESSION_REVOKED" });
    return response(200, captured);
  }
  if (pathname === "/me/organizations") return response(200, { items: [] });
  if (pathname === "/wallet") {
    const captured = { wallet: activeIdentity.wallet };
    const gate = holdWallet;
    if (gate) { gate.started = true; await gate.promise; }
    return response(200, captured);
  }
  if (pathname === "/relay/account") {
    const captured = { relay: activeIdentity.relay, managedKey: activeIdentity.managedKey };
    const gate = holdRelay;
    if (gate) { gate.started = true; await gate.promise; }
    return response(200, captured);
  }
  if (pathname === "/organizations/join") {
    return response(200, {
      organization: { id: "org-test", name: "Synthetic Org", role: "member" },
      gateway: { id: "gateway-test", certificateFingerprint: "sha256/test" },
      signedGatewayGrant: "synthetic-grant",
    });
  }
  return response(404, { error: "not found", code: "NOT_FOUND" });
};

async function run() {
  const service = require("../electron/main/account-service.cjs");

  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  holdRefresh = deferred();
  const lateRefresh = service.refreshAccountSession();
  await waitStarted(holdRefresh, "refresh");
  await service.logoutAccount();
  holdRefresh.resolve();
  await lateRefresh;
  assert.equal(service.sanitizeAccountState().authenticated, false, "late refresh must not revive logout");
  assert.equal(service.readAccountState().user, null);
  holdRefresh = null;

  activeIdentity = identities.a;
  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  holdMe = deferred();
  const lateMe = service.getCurrentAccount();
  await waitStarted(holdMe, "me");
  await service.logoutAccount();
  holdMe.resolve();
  await assert.rejects(lateMe, { code: "ACCOUNT_SESSION_CHANGED" });
  assert.equal(service.sanitizeAccountState().authenticated, false, "late /me must not revive logout");
  holdMe = null;

  activeIdentity = identities.a;
  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  holdWallet = deferred();
  holdRelay = deferred();
  const oldWallet = service.getWallet();
  const oldRelay = service.getRelayAccount();
  await Promise.all([waitStarted(holdWallet, "wallet"), waitStarted(holdRelay, "relay")]);
  activeIdentity = identities.b;
  await service.loginAccount({ identifier: "b@example.test", code: "123456" });
  const switched = service.readAccountState();
  assert.equal(switched.user.id, "user-b");
  assert.equal(switched.wallet, null, "identity switch clears prior wallet when the new response omits it");
  assert.equal(switched.relay, null, "identity switch clears prior relay when the new response omits it");
  assert.equal(switched.relayManagedKeyEncrypted, "", "identity switch clears prior managed key");
  assert.equal(switched.enterprise, null, "identity switch clears prior enterprise session");
  holdWallet.resolve();
  holdRelay.resolve();
  await assert.rejects(oldWallet, { code: "ACCOUNT_SESSION_CHANGED" });
  await assert.rejects(oldRelay, { code: "ACCOUNT_SESSION_CHANGED" });
  assert.equal(service.readAccountState().user.id, "user-b");
  assert.equal(service.readAccountState().wallet, null);
  holdWallet = null;
  holdRelay = null;

  activeIdentity = identities.a;
  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  holdMe = Object.assign(deferred(), { rejectAsRevoked: true });
  const staleFailure = service.getCurrentAccount();
  await waitStarted(holdMe, "revoked me");
  activeIdentity = identities.b;
  await service.loginAccount({ identifier: "b@example.test", code: "123456" });
  holdMe.resolve();
  await assert.rejects(staleFailure, { code: "ACCOUNT_SESSION_CHANGED" });
  assert.equal(service.readAccountState().user.id, "user-b", "old failure must not clear the newer login");
  holdMe = null;

  activeIdentity = { ...identities.a, user: { id: "user-b", email: "b@example.test" } };
  await service.loginAccount({ identifier: "b@example.test", code: "123456" });
  const connected = await service.connectEnterpriseWorkspace({ gatewayUrl: "https://gateway.example.test", inviteCode: "invite" });
  assert.equal(connected.enterprise?.connected, true);
  holdWorkspaceSnapshot = deferred();
  const lateSnapshot = service.refreshEnterpriseWorkspaceConfig();
  await waitStarted(holdWorkspaceSnapshot, "workspace snapshot");
  await service.disconnectEnterpriseWorkspace();
  holdWorkspaceSnapshot.resolve();
  await lateSnapshot;
  assert.equal(service.readAccountState().enterprise, null, "late workspace refresh must not revive disconnect");
  assert.equal(enterpriseCache, null, "late workspace refresh must not rewrite the cleared snapshot cache");

  await service.logoutAccount();
  activeIdentity = identities.a;
  holdEncryption = deferred();
  const lateEncryptedLogin = service.loginAccount({ identifier: "a@example.test", code: "123456" });
  await waitStarted(holdEncryption, "native encryption");
  const encryption = holdEncryption;
  holdEncryption = null;
  await service.logoutAccount();
  encryption.resolve();
  await assert.rejects(lateEncryptedLogin, { code: "ACCOUNT_SESSION_CHANGED" });
  assert.equal(service.readAccountState().session, null, "late native encryption must not revive logout");
  assert.equal(service.readAccountState().user, null);

  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  holdDecryption = deferred();
  const staleCredential = service.prepareManagedRelayRequest("https://jixing.guancn.uk/v1/models", {
    Authorization: "Bearer __WANJUAN_MANAGED_RELAY__",
  });
  await waitStarted(holdDecryption, "native decryption");
  const decryption = holdDecryption;
  holdDecryption = null;
  await service.logoutAccount();
  decryption.resolve();
  await assert.rejects(staleCredential, { code: "ACCOUNT_SESSION_CHANGED" });

  await service.loginAccount({ identifier: "a@example.test", code: "123456" });
  const ciphertextBeforeDenial = service.readAccountState().session.refreshTokenEncrypted;
  failDecryption = true;
  const deniedStorageBootstrap = await service.bootstrapAccount();
  assert.equal(deniedStorageBootstrap.authenticated, true, "OS authorization failure must not clear saved login");
  assert.equal(deniedStorageBootstrap.offline, true);
  assert.equal(service.readAccountState().session.refreshTokenEncrypted, ciphertextBeforeDenial);
  failDecryption = false;
  await service.logoutAccount();

  console.log("account lifecycle races: network/native-encryption/native-decryption logout fences and storage-denial preservation passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
  global.fetch = originalFetch;
  if (originalAccountUrl === undefined) delete process.env.WANJUAN_ACCOUNT_API_URL;
  else process.env.WANJUAN_ACCOUNT_API_URL = originalAccountUrl;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
