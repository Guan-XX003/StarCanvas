const http = require("node:http");
const crypto = require("node:crypto");

const DEFAULT_PORT = 39991;
const DEV_CODE = "123456";
const DEV_INVITE = "WANJUAN-TEAM";

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearer(headers = {}) {
  const value = String(headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function createAccountDevHandler() {
  const accessTokens = new Map();
  const refreshTokens = new Map();
  const passwords = new Map();

  const normalizedIdentifier = (value) => String(value || "").trim().toLowerCase();
  const invalidateIdentifierSessions = (identifier) => {
    const normalized = normalizedIdentifier(identifier);
    for (const [token, user] of accessTokens) {
      if (normalizedIdentifier(user?.email || user?.phone || user?.id) === normalized) accessTokens.delete(token);
    }
    for (const [token, user] of refreshTokens) {
      if (normalizedIdentifier(user?.email || user?.phone || user?.id) === normalized) refreshTokens.delete(token);
    }
  };

  const issueSession = (identifier) => {
    const user = {
      id: `usr_${crypto.createHash("sha1").update(identifier).digest("hex").slice(0, 10)}`,
      name: identifier.split("@")[0] || "测试用户",
      email: identifier.includes("@") ? identifier : "",
      phone: identifier.includes("@") ? "" : identifier,
    };
    const accessToken = `dev_access_${crypto.randomUUID()}`;
    const refreshToken = `dev_refresh_${crypto.randomUUID()}`;
    accessTokens.set(accessToken, user);
    refreshTokens.set(refreshToken, user);
    return {
      accessToken,
      refreshToken,
      user,
      subscription: { plan: "pro", status: "active", expiresAt: "2026-12-31T23:59:59Z" },
      entitlements: ["cloud_backup", "multi_device_sync", "enterprise_workspace"],
      wallet: { currency: "CNY", cashAmount: 20, promoAmount: 1, reservedAmount: 0.4, availableAmount: 20.6 },
      relay: { status: "active", managed: true, keyMasked: "sk-****demo", keyVersion: "1" },
      device: { id: "dev_local_account_test", name: "源码测试设备", platform: process.platform },
    };
  };

  const validPassword = (value) => typeof value === "string" && [...value].length >= 12 && [...value].length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
  const authenticatedUser = (headers) => accessTokens.get(bearer(headers));

  return async ({ method = "GET", pathname = "/", headers = {}, body = {} } = {}) => {
    if (method === "GET" && pathname === "/health") return { status: 200, body: { ok: true } };
    if (method === "GET" && pathname === "/public/capabilities") return { status: 200, body: {
      passwordAuth: true, passwordRegistration: true, passwordReset: true, relayManagedConfig: true,
      relayWalletUi: true, relayRedeem: true, relayAutoProvision: true, relayLegacyLink: true,
    } };

    if (method === "POST" && pathname === "/auth/send-code") {
      if (!String(body.identifier || "").trim()) return { status: 400, body: { error: "请输入邮箱或手机号" } };
      return { status: 200, body: { ok: true, expiresIn: 300 } };
    }

    if (method === "POST" && ["/auth/login", "/auth/register", "/auth/password/register", "/auth/password/login", "/auth/password/reset/confirm"].includes(pathname)) {
      if (pathname === "/auth/password/reset/confirm") {
        if (String(body.code || "") !== DEV_CODE || !validPassword(body.newPassword)) return { status: 422, body: { error: "密码或验证码无效", code: "INVALID_REQUEST" } };
        const identifier = normalizedIdentifier(body.identifier);
        passwords.set(identifier, body.newPassword);
        invalidateIdentifierSessions(identifier);
        return { status: 200, body: { ok: true } };
      }
      if (["/auth/password/register", "/auth/password/login"].includes(pathname) && !validPassword(body.password)) {
        return { status: 422, body: { error: "密码长度须为 12–200 个字符", code: "INVALID_REQUEST" } };
      }
      const identifier = normalizedIdentifier(body.identifier || "test@wanjuan.local");
      if (pathname === "/auth/password/login" && passwords.has(identifier) && passwords.get(identifier) !== body.password) {
        return { status: 401, body: { error: "邮箱或密码错误", code: "PASSWORD_AUTH_INVALID" } };
      }
      if (pathname !== "/auth/password/login" && String(body.code || "") !== DEV_CODE) return { status: 401, body: { error: "验证码错误，开发验证码为 123456" } };
      if (["/auth/register"].includes(pathname) && String(body.inviteCode || "") !== DEV_INVITE) {
        return { status: 403, body: { error: "邀请码无效，开发邀请码为 WANJUAN-TEAM" } };
      }
      if (pathname === "/auth/password/register") passwords.set(identifier, body.password);
      return { status: 200, body: issueSession(identifier) };
    }

    if (method === "POST" && pathname === "/auth/refresh") {
      const user = refreshTokens.get(String(body.refreshToken || ""));
      if (!user) return { status: 401, body: { error: "刷新令牌已失效" } };
      return { status: 200, body: issueSession(user.email || user.phone || user.id) };
    }

    if (method === "POST" && pathname === "/auth/logout") return { status: 200, body: { ok: true } };

    if (method === "GET" && pathname === "/me") {
      const user = accessTokens.get(bearer(headers));
      if (!user) return { status: 401, body: { error: "未登录" } };
      return {
        status: 200,
        body: {
          user,
          subscription: { plan: "pro", status: "active", expiresAt: "2026-12-31T23:59:59Z" },
          entitlements: ["cloud_backup", "multi_device_sync", "enterprise_workspace"],
          wallet: { currency: "CNY", cashAmount: 20, promoAmount: 1, reservedAmount: 0.4, availableAmount: 20.6 },
          relay: { status: "active", managed: true, keyMasked: "sk-****demo", keyVersion: "1" },
          device: { id: "dev_local_account_test", name: "源码测试设备", platform: process.platform },
        },
      };
    }

    if (method === "GET" && pathname === "/relay/account") {
      if (!accessTokens.has(bearer(headers))) return { status: 401, body: { error: "未登录" } };
      return { status: 200, body: {
        status: "active", managed: true, keyMasked: "sk-****demo", keyVersion: "1",
        managedKey: "sk-dev-managed-relay",
      } };
    }

    if (method === "GET" && pathname === "/wallet") {
      if (!accessTokens.has(bearer(headers))) return { status: 401, body: { error: "未登录" } };
      return { status: 200, body: { wallet: { currency: "CNY", cashAmount: 20, promoAmount: 1, reservedAmount: 0.4, availableAmount: 20.6 } } };
    }

    if (method === "GET" && pathname === "/wallet/transactions") return { status: 200, body: { items: [
      { id: "ledger_demo_1", typeLabel: "新用户体验金", amount: 1, status: "已入账", createdAt: new Date().toISOString() },
      { id: "ledger_demo_2", typeLabel: "充值码兑换", amount: 20, status: "已入账", createdAt: new Date().toISOString() },
    ], nextCursor: null } };

    if (method === "GET" && pathname === "/relay/usage-records") return { status: 200, body: { items: [
      { id: "usage_demo_1", modelName: "Seedance 2.0", actualAmount: 0.34, status: "completed", createdAt: new Date().toISOString() },
    ], nextCursor: null } };

    if (method === "GET" && pathname === "/commerce/recharge-store") return { status: 200, body: { url: process.env.WANJUAN_ACCOUNT_DEV_PURCHASE_DISABLED === "1" ? "" : "https://lingjing.guancn.uk/downloads/" } };

    if (method === "POST" && pathname === "/wallet/redeem") return { status: 200, body: {
      wallet: { currency: "CNY", cashAmount: 30, promoAmount: 1, reservedAmount: 0.4, availableAmount: 30.6 },
      transaction: { id: "ledger_demo_redeem", type: "recharge" },
    } };

    if (method === "POST" && pathname === "/relay/key/send-code") return { status: 200, body: { ok: true, expiresIn: 300 } };
    if (method === "POST" && pathname === "/relay/key/reveal") return { status: 200, body: { status: "active", managed: true, keyMasked: "sk-****demo", keyVersion: "1", managedKey: "sk-dev-managed-relay" } };
    if (method === "POST" && pathname === "/relay/key/regenerate") return { status: 200, body: { status: "active", managed: true, keyMasked: "sk-****new1", keyVersion: "2", managedKey: "sk-dev-managed-relay-new" } };
    if (method === "POST" && pathname === "/relay/link-existing/send-code") {
      const user = authenticatedUser(headers);
      if (!user) return { status: 401, body: { error: "未登录" } };
      if (String(body.identifier || "").toLowerCase() !== String(user.email || "").toLowerCase()) return { status: 403, body: { error: "请验证当前账号邮箱", code: "LINK_EMAIL_MISMATCH" } };
      return { status: 200, body: { ok: true } };
    }
    if (method === "POST" && pathname === "/relay/link-existing/verify-legacy") {
      if (!authenticatedUser(headers)) return { status: 401, body: { error: "未登录" } };
      if (!String(body.username || "") || !String(body.password || "")) return { status: 401, body: { error: "旧账号或密码无效", code: "LEGACY_AUTH_INVALID" } };
      const review = String(body.username || "").trim() === "review-fixture";
      return { status: 200, body: { status: "mfa_required", challenge: review ? "dev-legacy-review-challenge" : "dev-legacy-challenge", expiresIn: 300 } };
    }
    if (method === "POST" && pathname === "/relay/link-existing/verify-mfa") {
      if (!authenticatedUser(headers)) return { status: 401, body: { error: "未登录" } };
      if (!["dev-legacy-challenge", "dev-legacy-review-challenge"].includes(body.challenge) || String(body.code || "") !== DEV_CODE) return { status: 401, body: { error: "验证会话无效", code: "LEGACY_CHALLENGE_INVALID" } };
      return { status: 200, body: { status: "verified", challenge: `${body.challenge}-verified`, expiresIn: 300 } };
    }
    if (method === "POST" && pathname === "/relay/link-existing/confirm") {
      const user = authenticatedUser(headers);
      if (!user) return { status: 401, body: { error: "未登录" } };
      if (String(body.identifier || "").toLowerCase() !== String(user.email || "").toLowerCase()) return { status: 403, body: { error: "请验证当前账号邮箱", code: "LINK_EMAIL_MISMATCH" } };
      if (String(body.code || "") !== DEV_CODE || !["dev-legacy-challenge-verified", "dev-legacy-review-challenge-verified"].includes(body.challenge)) return { status: 401, body: { error: "验证会话无效", code: "LEGACY_CHALLENGE_INVALID" } };
      if (!/^[A-Za-z0-9._~-]{16,160}$/.test(String(headers["idempotency-key"] || headers["Idempotency-Key"] || ""))) return { status: 400, body: { error: "缺少绑定幂等标识", code: "IDEMPOTENCY_KEY_REQUIRED" } };
      if (body.challenge === "dev-legacy-review-challenge-verified") return { status: 200, body: { status: "review", code: "LINK_REVIEW_REQUIRED" } };
      return { status: 200, body: { status: "active", managed: true, keyMasked: "sk-****link", keyVersion: "3", managedKey: "sk-dev-managed-relay-linked" } };
    }

    if (method === "POST" && pathname === "/workspace/session") {
      const user = accessTokens.get(bearer(headers));
      if (!user) return { status: 401, body: { error: "账号身份无效" } };
      if (String(body.inviteCode || "") !== DEV_INVITE) return { status: 403, body: { error: "企业邀请码无效" } };
      return {
        status: 200,
        body: {
          workspaceToken: `dev_workspace_${crypto.randomUUID()}`,
          organization: { id: "org_wanjuan_demo", name: "万卷测试企业", role: "管理员" },
          expiresIn: 28800,
        },
      };
    }

    return { status: 404, body: { error: "Not found" } };
  };
}

function createAccountDevServer() {
  const handle = createAccountDevHandler();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const body = req.method === "GET" ? {} : await readBody(req);
      const result = await handle({ method: req.method, pathname: url.pathname, headers: req.headers, body });
      return json(res, result.status, result.body);
    } catch (error) {
      return json(res, 500, { error: error?.message || String(error) });
    }
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.WANJUAN_ACCOUNT_DEV_PORT || DEFAULT_PORT);
  const server = createAccountDevServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`WanJuan account dev server ready at http://127.0.0.1:${port}`);
    console.log(`Login code: ${DEV_CODE}; enterprise invite: ${DEV_INVITE}`);
  });
}

module.exports = { createAccountDevHandler, createAccountDevServer, DEFAULT_PORT, DEV_CODE, DEV_INVITE };
