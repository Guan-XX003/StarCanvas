#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const electronPath = require("electron");
const qaRoot = process.env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR ? path.resolve(process.env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR) : path.join(projectRoot, "docs", "qa", "account-fusion-candidate-20260916");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-account-fusion-"));
const userDataPath = path.join(tempRoot, "user-data");
const accountUrl = String(process.env.WANJUAN_ACCOUNT_QA_URL || "").trim().replace(/\/$/, "");
const email = String(process.env.WANJUAN_ACCOUNT_QA_EMAIL || "").trim();
const password = String(process.env.WANJUAN_ACCOUNT_QA_PASSWORD || "");
const otp = String(process.env.WANJUAN_ACCOUNT_QA_OTP || "").trim();
const legacyUsername = String(process.env.WANJUAN_ACCOUNT_QA_LEGACY_USERNAME || "");
const legacyPassword = String(process.env.WANJUAN_ACCOUNT_QA_LEGACY_PASSWORD || "");
const legacyMfa = String(process.env.WANJUAN_ACCOUNT_QA_LEGACY_MFA || "").trim();
const reviewLegacyUsername = String(process.env.WANJUAN_ACCOUNT_QA_REVIEW_LEGACY_USERNAME || "");
const reviewLegacyPassword = String(process.env.WANJUAN_ACCOUNT_QA_REVIEW_LEGACY_PASSWORD || "");
const reviewLegacyMfa = String(process.env.WANJUAN_ACCOUNT_QA_REVIEW_LEGACY_MFA || "").trim();
const resetPassword = String(process.env.WANJUAN_ACCOUNT_QA_RESET_PASSWORD || "");
const redeemCode = String(process.env.WANJUAN_ACCOUNT_QA_REDEEM_CODE || "").trim();
const isolatedConfirmation = process.env.WANJUAN_ACCOUNT_QA_CONFIRM_ISOLATED === "1";
const rechargeSmoke = process.env.WANJUAN_ACCOUNT_QA_RECHARGE_SMOKE === "1";
const qaKeychainService = rechargeSmoke && process.platform === "darwin" ? `org.starcanvas.account-secret.qa.${crypto.randomUUID().toUpperCase()}` : "";
const packagedQaApp = String(process.env.STARCANVAS_QA_PACKAGED_APP || "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isLocalMock = (() => {
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(accountUrl).hostname);
  } catch {
    return false;
  }
})();

function validateInputs() {
  if (rechargeSmoke && (!isLocalMock || !process.env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR)) throw new Error("充值界面自检仅允许本地 Mock 及独立输出目录");
  if (packagedQaApp) {
    const allowed = "/Volumes/StarCanvas-Build-20261101/mac/mac-arm64/StarCanvas.app";
    const expected = String(process.env.STARCANVAS_QA_ASAR_SHA256 || "");
    if (!rechargeSmoke || !isLocalMock || process.platform !== "darwin" || packagedQaApp !== allowed
        || fs.realpathSync(packagedQaApp) !== allowed || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("PACKAGED_QA_SCOPE_INVALID");
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(packagedQaApp, "Contents/Resources/app.asar"))).digest("hex");
    if (actual !== expected) throw new Error("PACKAGED_QA_ASAR_CHANGED");
  }
  if (!accountUrl || !email || !password || !otp || !legacyUsername || !legacyPassword || !legacyMfa || !reviewLegacyUsername || !reviewLegacyPassword || !reviewLegacyMfa || !resetPassword || !redeemCode) {
    throw new Error("缺少隔离候选 URL 或合成账号 fixture，拒绝运行账号融合 GUI 验收");
  }
  if ([...password].length < 12 || [...password].length > 200 || [...resetPassword].length < 12 || [...resetPassword].length > 200) {
    throw new Error("StarCanvas 合成账号密码必须为 12–200 个字符");
  }
  if ([...legacyPassword].length > 20 || [...reviewLegacyPassword].length > 20) {
    throw new Error("旧极鑫合成 fixture 密码必须符合 NewAPI 旧账号上限（<=20 个字符）");
  }
  const parsed = new URL(accountUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("候选账号服务 URL 无效");
  if (/api\.guancn\.uk$/i.test(parsed.hostname) || /account.*\.guancn\.uk$/i.test(parsed.hostname)) {
    throw new Error("拒绝连接可能的生产账号服务地址");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) && !isolatedConfirmation) {
    throw new Error("远程候选服务必须显式设置 WANJUAN_ACCOUNT_QA_CONFIRM_ISOLATED=1");
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForTarget(port) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((item) => item.type === "page" && /index\.html/.test(String(item.url || "")));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await sleep(250);
  }
  throw new Error("等待隔离账号融合 Electron 页面超时");
}

async function run() {
  validateInputs();
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.mkdirSync(qaRoot, { recursive: true });
  const debugPort = await freePort();
  const executable = packagedQaApp ? path.join(packagedQaApp, "Contents/MacOS/StarCanvas") : electronPath;
  const args = packagedQaApp ? [`--remote-debugging-port=${debugPort}`] : [projectRoot, `--remote-debugging-port=${debugPort}`];
  const child = spawn(executable, args, {
    cwd: projectRoot,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      WANJUAN_TEST_USER_DATA_PATH: userDataPath,
      WANJUAN_ACCOUNT_API_URL: accountUrl,
      WANJUAN_ACCOUNT_FUSION_PREVIEW: "1",
      WANJUAN_ALLOW_RANDOM_PORT: "1",
      WANJUAN_DISABLE_UPDATE_CHECK: "1",
      WANJUAN_GPU_MODE: "off",
      ...(qaKeychainService ? { STARCANVAS_KEYCHAIN_QA_SERVICE: qaKeychainService,
        ...(packagedQaApp ? { WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA: "1" } : { STARCANVAS_DEV_KEYCHAIN_QA: "1" }) } : {}),
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let ws;
  const results = {
    passwordRegistration: false,
    passwordLogin: false,
    otpLogin: false,
    passwordReset: false,
    oldPasswordRejected: false,
    managedRelayVisible: false,
    walletVisible: false,
    redeem: false,
    legacyMfaLink: false,
    legacyReviewPreservesState: false,
    languages: false,
    noDiscountCopy: false,
    logout: false,
  };
  try {
    const target = await waitForTarget(debugPort);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let requestId = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++requestId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, awaitPromise = false) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
      if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
      return response.result?.result?.value;
    };
    const waitFor = async (expression, label, timeout = 30000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`隔离 App 提前退出：${child.exitCode}`);
        if (await evaluate(expression)) return;
        await sleep(150);
      }
      throw new Error(`等待${label}超时`);
    };
    const clickText = (text, selector = "button") => evaluate(`(() => {
      const target = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((item) => (item.textContent || '').trim().includes(${JSON.stringify(text)}));
      if (!target) return false;
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
      return !!document.body &&
        !root.classList.contains('wanjuan-booting') &&
        root.dataset.wanjuanBootReady !== 'error' &&
        !document.getElementById('wanjuan-boot-splash');
    })()`, "应用稳定启动", 45000);
    const capture = async (filename, redactSelectors = []) => {
      await waitForAppReady();
      await sleep(200);
      await evaluate(`(() => {
        document.getElementById('wanjuan-qa-redactions')?.remove();
        const root = document.createElement('div');
        root.id = 'wanjuan-qa-redactions';
        root.setAttribute('aria-hidden', 'true');
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
        const transientStyle = document.createElement('style');
        transientStyle.textContent = '.wanjuan-toast{visibility:hidden!important;opacity:0!important;}';
        root.appendChild(transientStyle);
        const selectors = ${JSON.stringify(redactSelectors)};
        const seen = new Set();
        selectors.forEach((selector) => {
          document.querySelectorAll(selector).forEach((element) => {
            if (seen.has(element)) return;
            seen.add(element);
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return;
            const cover = document.createElement('div');
            cover.textContent = '••••••';
            cover.style.cssText = [
              'position:fixed',
              'display:grid',
              'place-items:center',
              'box-sizing:border-box',
              'border:1px solid rgba(148,163,184,.35)',
              'border-radius:6px',
              'background:#242930',
              'color:#9ca3af',
              'font:600 10px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
              'letter-spacing:0'
            ].join(';');
            cover.style.left = Math.max(0, rect.left) + 'px';
            cover.style.top = Math.max(0, rect.top) + 'px';
            cover.style.width = Math.min(innerWidth - Math.max(0, rect.left), rect.width) + 'px';
            cover.style.height = Math.min(innerHeight - Math.max(0, rect.top), rect.height) + 'px';
            root.appendChild(cover);
          });
        });
        document.body.appendChild(root);
      })()`);
      try {
        const response = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        fs.writeFileSync(path.join(qaRoot, filename), Buffer.from(response.result.data, "base64"));
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
    assert.equal(await clickText("登录 / 注册"), true);
    await waitFor("!!document.querySelector('.wanjuan-account-auth-shell')", "登录弹窗");
    assert.equal(await clickText("注册", ".wanjuan-account-auth-tabs button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('注册并继续')", "注册表单");
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="password"]', password), true);
    assert.equal(await clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证码已发送')", "注册验证码");
    assert.equal(await fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', otp), true);
    await capture("01-password-registration.png", [
      '.wanjuan-account-auth-shell input[type="email"]',
      '.wanjuan-account-auth-shell input[type="password"]',
      '.wanjuan-account-auth-shell input[autocomplete="one-time-code"]',
    ]);
    assert.equal(await clickText("注册并继续", ".wanjuan-account-auth-shell button"), true);
    try {
      await waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "注册完成", 45000);
    } catch (error) {
      if (isLocalMock && process.env.WANJUAN_ACCOUNT_QA_RECHARGE_SMOKE === "1") {
        console.error("Mock registration status:", await evaluate("document.querySelector('.wanjuan-account-auth-shell')?.innerText || ''"));
      }
      throw error;
    }
    results.passwordRegistration = true;

    await waitFor("document.body?.innerText?.includes('极鑫托管服务')", "托管服务卡片", 45000);
    const accountText = await evaluate("document.querySelector('.wanjuan-account-settings-page')?.innerText || ''");
    assert.equal(accountText.includes("模型余额"), true);
    assert.equal(/85\s*折|8\.5\s*折|15%\s*off/i.test(accountText), false);
    results.managedRelayVisible = /已开通|正在开通|正在重试/.test(accountText);
    results.walletVisible = accountText.includes("可用余额") && accountText.includes("账单与使用记录");
    results.noDiscountCopy = true;
    if (process.env.WANJUAN_ACCOUNT_QA_RECHARGE_SMOKE === "1") {
      if (!isLocalMock || !process.env.WANJUAN_ACCOUNT_QA_OUTPUT_DIR) throw new Error("充值界面自检仅允许本地 Mock 及独立输出目录");
      await waitFor("document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes('充值暂未开放')", "充值暂未开放状态");
      assert.equal(await evaluate("Array.from(document.querySelectorAll('.wanjuan-account-settings-page button')).some(x => x.textContent.trim() === '去充值')"), false);
      assert.equal(await evaluate("!!document.querySelector('.wanjuan-account-redeem-row input')"), true);
    }
    await capture("02-managed-relay-wallet.png", [
      '.wanjuan-account-settings-title-row h2',
      '.wanjuan-account-settings-hero p',
      '.wanjuan-account-redeem-row input',
    ]);

    assert.equal(await fill('input[placeholder="粘贴充值码"]', redeemCode), true);
    assert.equal(await clickText("兑换", ".wanjuan-account-settings-page button"), true);
    await waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('充值码兑换成功')", "充值码兑换");
    results.redeem = true;
    if (process.env.WANJUAN_ACCOUNT_QA_RECHARGE_SMOKE === "1") {
      console.log(JSON.stringify({ ok: true, mockOnly: true, packaged: !!packagedQaApp, purchaseDisabled: true, redeem: true, walletVisible: results.walletVisible }));
      return;
    }

    assert.equal(await clickText("绑定原极鑫账号", ".wanjuan-account-settings-page button"), true);
    await waitFor("!!document.querySelector('.is-link-form')", "旧账号绑定表单");
    assert.equal(await fill('.is-link-form input[autocomplete="username"]', legacyUsername), true);
    assert.equal(await fill('.is-link-form input[autocomplete="current-password"]', legacyPassword), true);
    assert.equal(await clickText("验证旧账号", ".is-link-form button"), true);
    await waitFor("document.querySelector('.is-link-form')?.innerText?.includes('MFA 验证码')", "MFA 表单", 30000);
    assert.equal(await fill('.is-link-form input[autocomplete="one-time-code"]', legacyMfa), true);
    assert.equal(await clickText("验证 MFA", ".is-link-form button"), true);
    await waitFor("document.querySelector('.is-link-form')?.innerText?.includes('当前账号邮箱')", "当前邮箱确认", 30000);
    assert.equal(await fill('.is-link-form input[autocomplete="one-time-code"]', otp), true);
    await capture("03-legacy-mfa-link.png", [
      '.wanjuan-account-settings-title-row h2',
      '.wanjuan-account-settings-hero p',
      '.is-link-form input',
    ]);
    assert.equal(await clickText("确认绑定", ".is-link-form button"), true);
    await waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('原极鑫账号已绑定')", "旧账号绑定完成", 45000);
    results.legacyMfaLink = true;

    const relayWalletBeforeReview = await evaluate(`JSON.stringify({
      relay: Array.from(document.querySelectorAll('.wanjuan-account-managed-relay-row strong')).map((item) => item.textContent || ''),
      wallet: Array.from(document.querySelectorAll('.wanjuan-account-wallet-metrics strong')).map((item) => item.textContent || '')
    })`);
    assert.equal(await clickText("绑定原极鑫账号", ".wanjuan-account-settings-page button"), true);
    await waitFor("!!document.querySelector('.is-link-form')", "review 旧账号绑定表单");
    assert.equal(await fill('.is-link-form input[autocomplete="username"]', reviewLegacyUsername), true);
    assert.equal(await fill('.is-link-form input[autocomplete="current-password"]', reviewLegacyPassword), true);
    assert.equal(await clickText("验证旧账号", ".is-link-form button"), true);
    await waitFor("document.querySelector('.is-link-form')?.innerText?.includes('MFA 验证码')", "review MFA 表单", 30000);
    assert.equal(await fill('.is-link-form input[autocomplete="one-time-code"]', reviewLegacyMfa), true);
    assert.equal(await clickText("验证 MFA", ".is-link-form button"), true);
    await waitFor("document.querySelector('.is-link-form')?.innerText?.includes('当前账号邮箱')", "review 当前邮箱确认", 30000);
    assert.equal(await fill('.is-link-form input[autocomplete="one-time-code"]', otp), true);
    assert.equal(await clickText("确认绑定", ".is-link-form button"), true);
    await waitFor("document.querySelector('.wanjuan-toast')?.textContent?.includes('需要人工审核')", "review 绑定结果", 45000);
    const relayWalletAfterReview = await evaluate(`JSON.stringify({
      relay: Array.from(document.querySelectorAll('.wanjuan-account-managed-relay-row strong')).map((item) => item.textContent || ''),
      wallet: Array.from(document.querySelectorAll('.wanjuan-account-wallet-metrics strong')).map((item) => item.textContent || '')
    })`);
    assert.equal(relayWalletAfterReview, relayWalletBeforeReview);
    results.legacyReviewPreservesState = true;

    for (const [language, expected, filename] of [
      ["en-US", "Jixin managed service", "04-account-en.png"],
      ["zh-TW", "極鑫託管服務", "05-account-zh-tw.png"],
      ["zh-CN", "极鑫托管服务", "06-account-zh-cn.png"],
    ]) {
      await evaluate(`globalThis.wanjuanI18nRuntime.setLanguage(${JSON.stringify(language)})`);
      await waitFor(`document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes(${JSON.stringify(expected)})`, `${language} 账号界面`);
      const translatedText = await evaluate("document.querySelector('.wanjuan-account-settings-page')?.innerText || ''");
      assert.equal(/85\s*折|8\.5\s*折|15%\s*off/i.test(translatedText), false);
      await capture(filename, [
        '.wanjuan-account-settings-title-row h2',
        '.wanjuan-account-settings-hero p',
        '.wanjuan-account-redeem-row input',
      ]);
    }
    results.languages = true;

    const logoutToLocal = async () => {
      await evaluate("window.confirm = () => true");
      assert.equal(await clickText("退出登录", ".wanjuan-account-settings-page button"), true);
      await waitFor("document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes('本地模式')", "退出登录");
      assert.equal(await evaluate("document.querySelector('.wanjuan-account-settings-page')?.innerText?.includes('极鑫托管服务')"), false);
    };
    const openAuth = async () => {
      assert.equal(await clickText("登录 / 注册", ".wanjuan-account-settings-page button"), true);
      await waitFor("!!document.querySelector('.wanjuan-account-auth-shell')", "登录弹窗");
    };

    await logoutToLocal();
    await openAuth();
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="password"]', password), true);
    assert.equal(await clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "密码登录完成", 45000);
    results.passwordLogin = true;

    await logoutToLocal();
    await openAuth();
    assert.equal(await clickText("验证码登录", ".wanjuan-account-auth-shell button"), true);
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
    assert.equal(await clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证码已发送')", "OTP 登录验证码");
    assert.equal(await fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', otp), true);
    assert.equal(await clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "OTP 登录完成", 45000);
    results.otpLogin = true;

    await logoutToLocal();
    await openAuth();
    assert.equal(await clickText("忘记密码", ".wanjuan-account-auth-shell button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证邮箱后设置新密码')", "密码重置表单");
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="email"]', email), true);
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="password"]', resetPassword), true);
    assert.equal(await clickText("获取验证码", ".wanjuan-account-auth-shell button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('验证码已发送')", "密码重置验证码");
    assert.equal(await fill('.wanjuan-account-auth-shell input[autocomplete="one-time-code"]', otp), true);
    assert.equal(await clickText("重置密码", ".wanjuan-account-auth-shell button"), true);
    await waitFor("document.querySelector('.wanjuan-account-auth-shell')?.innerText?.includes('密码已重置')", "密码重置完成", 45000);
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="password"]', password), true);
    assert.equal(await clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await waitFor("!!document.querySelector('.wanjuan-account-form-error')", "旧密码被拒绝", 30000);
    assert.equal(await evaluate("!!document.querySelector('.wanjuan-account-auth-shell')"), true);
    results.oldPasswordRejected = true;
    assert.equal(await fill('.wanjuan-account-auth-shell input[type="password"]', resetPassword), true);
    assert.equal(await clickText("登录并继续", ".wanjuan-account-auth-shell button"), true);
    await waitFor("!document.querySelector('.wanjuan-account-auth-shell')", "新密码登录完成", 45000);
    results.passwordReset = true;

    await logoutToLocal();
    results.logout = true;

    const report = [
      `# StarCanvas account fusion ${isLocalMock ? "Mock self-check" : "real candidate QA"}`,
      "",
      `- Date: ${new Date().toISOString()}`,
      `- Environment: isolated Electron userData + ${isLocalMock ? "repository-local Mock account service self-check" : "explicitly supplied non-production candidate account service"}`,
      `- Evidence level: ${isLocalMock ? "mock-only; not a real candidate integration result" : "real isolated candidate integration"}`,
      "- Production accounts/models/payment: not used",
      "- Sensitive values: omitted",
      "",
      "## Result",
      "",
      ...Object.entries(results).map(([key, value]) => `- ${key}: ${value ? "passed" : "failed"}`),
      "",
      "## Screenshots",
      "",
      ...fs.readdirSync(qaRoot).filter((name) => name.endsWith(".png")).sort().map((name) => `- ${name}`),
      "",
      "## Boundary",
      "",
      isLocalMock
        ? "This report is only a repository Mock self-check. It does not prove the real isolated candidate integration, production deployment, or production-account availability."
        : "This report proves the App against the supplied isolated non-production candidate endpoint only. It does not prove production deployment or production-account availability.",
    ].join("\n");
    const reportName = isLocalMock ? "report.md" : "report-real-candidate.md";
    fs.writeFileSync(path.join(qaRoot, reportName), `${report}\n`);
    console.log(JSON.stringify({ ok: true, results, qaRoot }));
  } finally {
    try { ws?.close(); } catch {}
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    if (qaKeychainService) {
      const helper = path.join(projectRoot, "build/native-tools/macos-account-keychain");
      const contract = require("../electron/shared/macos-account-helper.cjs");
      if (crypto.createHash("sha256").update(fs.readFileSync(helper)).digest("hex") !== contract.sha256) throw new Error("QA_KEYCHAIN_HELPER_CHANGED");
      const cleanEnv = { ...process.env, STARCANVAS_KEYCHAIN_QA: "1" };
      for (const name of Object.keys(cleanEnv)) if (name.startsWith("DYLD_") || name.startsWith("NODE_")) delete cleanEnv[name];
      const cleaned = spawnSync(helper, [], { env: cleanEnv, input: JSON.stringify({ operation: "qa-delete", value: "", qaService: qaKeychainService }), encoding: "utf8", timeout: 10000 });
      let result; try { result = JSON.parse(cleaned.stdout || "{}"); } catch { result = {}; }
      if (cleaned.status !== 0 || result.ok !== true) throw new Error("QA_KEYCHAIN_CLEANUP_FAILED");
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (stderr && child.exitCode && child.exitCode !== 0) console.error(stderr.slice(-4000));
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
