const assert = require("node:assert/strict");
const { createAccountDevHandler, DEV_CODE, DEV_INVITE } = require("./account-dev-server.cjs");

async function run() {
  const request = createAccountDevHandler();
  const post = (pathname, body, token = "") => request({
    method: "POST",
    pathname,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
  const postWithHeaders = (pathname, body, headers = {}) => request({ method: "POST", pathname, headers, body });
  const code = await post("/auth/send-code", { identifier: "tester@example.com" });
    assert.equal(code.status, 200);

    const login = await post("/auth/login", { identifier: "tester@example.com", code: DEV_CODE });
    assert.equal(login.status, 200);
    assert.ok(login.body.accessToken);
    assert.ok(login.body.refreshToken);

    const passwordRegistration = await post("/auth/password/register", { identifier: "password@example.com", password: "password-test-123", code: DEV_CODE });
    assert.equal(passwordRegistration.status, 200);
    const passwordLogin = await post("/auth/password/login", { identifier: "password@example.com", password: "password-test-123" });
    assert.equal(passwordLogin.status, 200);
    const shortPassword = await post("/auth/password/login", { identifier: "password@example.com", password: "short" });
    assert.equal(shortPassword.status, 422);
    const reset = await post("/auth/password/reset/confirm", { identifier: "password@example.com", code: DEV_CODE, newPassword: "password-reset-123" });
    assert.equal(reset.status, 200);

    const me = await request({ method: "GET", pathname: "/me", headers: { authorization: `Bearer ${login.body.accessToken}` } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "tester@example.com");

    const denied = await post("/workspace/session", { inviteCode: "wrong" }, login.body.accessToken);
    assert.equal(denied.status, 403);

    const workspace = await post("/workspace/session", { inviteCode: DEV_INVITE }, login.body.accessToken);
    assert.equal(workspace.status, 200);
    assert.equal(workspace.body.organization.id, "org_wanjuan_demo");
    assert.ok(workspace.body.workspaceToken);

    const legacy = await post("/relay/link-existing/verify-legacy", { username: "legacy-user", password: "legacy-password" }, login.body.accessToken);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.status, "mfa_required");
    const mfa = await post("/relay/link-existing/verify-mfa", { challenge: legacy.body.challenge, code: DEV_CODE }, login.body.accessToken);
    assert.equal(mfa.status, 200);
    assert.equal(mfa.body.status, "verified");
    const linkCode = await post("/relay/link-existing/send-code", { identifier: "tester@example.com" }, login.body.accessToken);
    assert.equal(linkCode.status, 200);
    const linked = await postWithHeaders("/relay/link-existing/confirm", { identifier: "tester@example.com", code: DEV_CODE, challenge: mfa.body.challenge }, { authorization: `Bearer ${login.body.accessToken}`, "idempotency-key": "account-link-test-0001" });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.status, "active");

    console.log("account contract: login, refresh identity and enterprise gateway guards passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
