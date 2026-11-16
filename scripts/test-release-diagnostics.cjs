const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
function load(relative, typescript = false) {
  let code = fs.readFileSync(path.join(root, relative), "utf8");
  if (typescript) code = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === "./electron-refs.cjs") throw new Error("NATIVE_STORAGE_OR_APP_FORBIDDEN");
      if (["fs", "path"].includes(name)) return require(name);
      throw new Error("UNEXPECTED_IMPORT");
    },
  });
  return module.exports;
}
// The logging module only imports the refs; returning an inert object does not
// construct an Electron app or access a real userData directory.
function logging(overrides = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "electron/main/logging.cjs"), "utf8"), {
    module, require: name => name === "./electron-refs.cjs" ? (overrides.refs || {}) : name === "fs" ? (overrides.fs || fs) : name === "../shared/diagnostic-policy.cjs" ? require("../electron/shared/diagnostic-policy.cjs") : require(name),
  });
  return module.exports;
}

test("provider diagnostics omit short/custom/nested content but retain numeric counts", () => {
  const { safeStringifyRequestForLog } = load("src/renderer/lib/log-utils.ts", true);
  const secrets = ["synthetic-prompt", "synthetic-key", "synthetic-task", "https://media.invalid/v?signature=private"];
  const value = {
    body: { prompt: secrets[0], customProviderField: secrets[1], nested: [{ id: secrets[2], url: secrets[3] }] },
    imageCount: 2, completed: true,
  };
  const logged = safeStringifyRequestForLog(value);
  for (const secret of secrets) assert.equal(logged.includes(secret), false);
  const parsed = JSON.parse(logged);
  assert.equal(parsed.imageCount, 2);
  assert.equal(parsed.completed, true);
  const circular = {}; circular.self = circular;
  circular.body = circular;
  assert.ok(safeStringifyRequestForLog(circular).includes("circular"));
  assert.equal(safeStringifyRequestForLog(undefined), "[no diagnostic payload]");
  assert.equal(safeStringifyRequestForLog({ toJSON() { throw new Error(secrets[1]); } }).includes(secrets[1]), false);
});

test("desktop persistence rejects arbitrary URL/query/path/custom/error values and dynamic keys", () => {
  const writes = [];
  const { appendDesktopLog } = logging({
    refs: { app: { getPath: () => "/isolated-fixture" } },
    fs: { appendFile: (_path, line) => writes.push(JSON.parse(line)) },
  });
  const markers = ["synthetic-signature", "synthetic-google", "synthetic-query", "synthetic-path", "synthetic-body", "synthetic-key-name"];
  const payload = {
    url: `https://fixture.invalid/${markers[3]}?X-Amz-Signature=${markers[0]}&X-Goog-Signature=${markers[1]}&anything=${markers[2]}`,
    error: new Error(markers[4]),
    path: `C:\\Users\\${markers[3]}`,
    details: { custom: { [markers[5]]: markers[4] }, token: markers[0], count: 3 },
    [markers[5]]: 445566,
    count: 2, ok: false, method: "POST",
    media: { images: { count: 1, asset: 1, http: 0, other: 0 } },
  };
  appendDesktopLog("proxy-fetch-failed", payload);
  appendDesktopLog(markers[5], { message: markers[4] });
  const text = JSON.stringify(writes);
  for (const marker of markers) assert.equal(text.includes(marker), false);
  assert.equal(text.includes("445566"), false);
  assert.equal(writes[0].payload.urlScheme, "https");
  assert.equal(writes[0].payload.method, "POST");
  assert.equal(writes[0].payload.count, 2);
  assert.equal(writes[0].payload.details.count, 3);
  assert.equal(writes[0].payload.media.images.asset, 1);
  assert.equal(writes[0].type, "proxy-fetch-failed");
  assert.equal(writes[1].type, "application-event");
});

test("blocked assistant IPC retains only a fixed channel, never sender URL contents", () => {
  const writes = [];
  const { appendDesktopLog } = logging({refs:{app:{getPath:()=>'/isolated-fixture'}},fs:{appendFile:(_path,line)=>writes.push(JSON.parse(line))}});
  appendDesktopLog('untrusted-ipc-blocked', {channel:'wanjuan:assistant-send',senderUrl:'https://PRIVATE_HOST.invalid/PRIVATE_PATH?token=PRIVATE_KEY'});
  appendDesktopLog('untrusted-ipc-blocked', {channel:'wanjuan:assistant-PRIVATE_KEY'});
  assert.equal(writes[0].payload.channel,'wanjuan:assistant-send');
  assert.equal(writes[0].payload.urlScheme,'https');
  assert.equal(Object.hasOwn(writes[1].payload,'channel'),false);
  assert.doesNotMatch(JSON.stringify(writes),/PRIVATE_/);
});

test("console boundaries remove raw provider text, numeric secrets and getters in both processes", () => {
  for (const install of [logging().installDiagnosticConsole, load("src/renderer/lib/log-utils.ts", true).installRendererDiagnosticConsole]) {
    const writes = [];
    const target = Object.fromEntries(["debug", "log", "info", "warn", "error", "trace", "dir", "table"].map(level => [level, (...args) => writes.push(args)]));
    install(target);
    install(target);
    target.warn("synthetic-prompt https://fixture.invalid/private?unknown=synthetic-query", {
      response: { token: "synthetic-token", custom: 987654321, ["synthetic-key-name"]: "synthetic-body" },
      imageCount: 2, completed: true,
      get body() { throw new Error("getter-must-not-run"); },
    });
    target.error(Object.assign(new Error("synthetic-error /private/user/file"), { code: "ECONNRESET" }));
    assert.equal(writes.length, 2, "installing twice must not double-wrap");
    const logged = JSON.stringify(writes);
    assert.equal(/synthetic-|987654321|fixture.invalid|private\/user/.test(logged), false);
    assert.ok(logged.includes("imageCount"));
    assert.ok(logged.includes("completed"));
  }
});

test("logging policy bounds recursive/untrusted values and does not invoke toJSON", () => {
  const main = logging().sanitizeLogPayload;
  const renderer = load("src/renderer/lib/log-utils.ts", true).safeStringifyRequestForLog;
  const payload = { count: 1, toJSON() { throw new Error("synthetic-toJSON"); } };
  for (const sanitize of [main, renderer]) {
    const value = JSON.stringify(sanitize(payload));
    assert.equal(value.includes("synthetic-"), false);
    assert.ok(value.includes("count"));
    const cyclic = {}; cyclic.details = cyclic; cyclic.body = cyclic;
    assert.doesNotThrow(() => sanitize(cyclic));
  }
});

test("trace/assert/groups/timers/counters cannot bypass either console boundary", () => {
  for (const install of [logging().installDiagnosticConsole, load("src/renderer/lib/log-utils.ts", true).installRendererDiagnosticConsole]) {
    const writes = [];
    let nativeTraceCalls = 0;
    const methods = ["debug", "log", "info", "warn", "error", "trace", "dir", "dirxml", "table", "assert", "group", "groupCollapsed", "groupEnd", "time", "timeLog", "timeEnd", "count", "countReset", "profile", "profileEnd", "timeStamp"];
    const target = Object.fromEntries(methods.map(level => [level, (...args) => {
      if (level === "trace") { nativeTraceCalls++; writes.push("NATIVE_STACK /private/fixture/source.ts"); }
      writes.push(args);
    }]));
    install(target);
    const secret = "https://fixture.invalid/private/path?X-Amz-Signature=synthetic-secret";
    const payload = { response: { custom: "synthetic-body" }, path: "C:\\Users\\synthetic-user", imageCount: 1 };
    target.trace(secret, payload);
    const beforeAssert = writes.length;
    target.assert(true, secret, payload);
    assert.equal(writes.length, beforeAssert, "truthy assertions must remain silent");
    target.assert(false, secret, payload);
    target.group(secret, payload);
    target.groupCollapsed(secret, payload);
    target.groupEnd();
    target.time(secret);
    target.time(secret); // Duplicate labels cannot cause a native warning.
    target.timeLog(secret, payload);
    target.timeEnd(secret, payload);
    target.timeEnd(secret); // Missing labels cannot cause a native warning.
    target.count(secret); target.count(secret); target.countReset(secret); target.count(secret);
    target.dir(payload); target.table(payload); target.dirxml(payload);
    target.profile(secret); target.profileEnd(secret); target.timeStamp(secret);
    const output = JSON.stringify(writes);
    assert.equal(nativeTraceCalls, 0, "native trace must never append its own stack");
    assert.equal(/synthetic-|fixture\.invalid|\/private\/fixture|NATIVE_STACK/.test(output), false);
    assert.ok(output.includes("durationMs"));
    assert.ok(output.includes("count"));
    assert.ok(output.includes("imageCount"));
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    assert.doesNotThrow(() => target.error(revoked.proxy));
  }
});

test("real proxy transport failure writes only a classified diagnostic (closed network)", async () => {
  const { EventEmitter } = require("node:events");
  const writes = [];
  const logger = logging({
    refs: { app: { getPath: () => "/isolated-fixture" } },
    fs: { appendFile: (_path, line) => writes.push(JSON.parse(line)) },
  });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "electron/main/net/proxy-fetch.cjs"), "utf8"), {
    module, Buffer, URL, Error, setTimeout, clearTimeout,
    require(name) {
      if (name === "../logging.cjs") return logger;
      if (name === "./security.cjs") return { assertPublicHttpUrl() {} };
      if (name === "../electron-refs.cjs") return { net: { request() {
        const req = new EventEmitter();
        req.setHeader = () => {}; req.write = () => {}; req.abort = () => {};
        req.end = () => queueMicrotask(() => req.emit("error", Object.assign(new Error("synthetic-body /private/fixture?X-Goog-Signature=synthetic-query"), { code: "ECONNRESET" })));
        return req;
      } } };
      if (["http", "https"].includes(name)) return { request() { throw new Error("NETWORK_FORBIDDEN"); } };
      throw new Error("UNEXPECTED_IMPORT");
    },
  });
  await assert.rejects(module.exports.proxyHttpRequest("https://fixture.invalid/synthetic-path?X-Amz-Signature=synthetic-query", { method: "POST", body: Buffer.from("synthetic-prompt") }), /synthetic-body/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "proxy-http-electron-net-no-replay");
  assert.equal(writes[0].payload.errorClass, "ECONNRESET");
  assert.equal(writes[0].payload.method, "POST");
  assert.equal(/synthetic-|fixture\.invalid|\/private\/fixture/.test(JSON.stringify(writes)), false);
});

test("bootstrap and crash/tool file sinks retain structured logging boundaries", () => {
  const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
  const main = read("electron/main/index.cjs");
  assert.ok(main.indexOf("installDiagnosticConsole();") < main.indexOf('require("./ipc.cjs")'));
  assert.ok(main.includes("diagnostic: sanitizeLogPayload({ error })"));
  assert.equal(main.includes("error?.stack || error?.message"), false);
  const entry = read("src/renderer/entry.js");
  assert.ok(entry.indexOf('import "./lib/diagnostic-bootstrap"') < entry.indexOf('import "./bundle/index.js"'));
  assert.ok(read("src/renderer/lib/diagnostic-bootstrap.ts").includes("installRendererDiagnosticConsole();"));
  const preload = read("electron/preload/index.cjs");
  assert.ok(preload.indexOf("installDiagnosticConsole();") < preload.indexOf('require("./runtime.cjs")'));
  const tools = read("electron/main/tools/external-tools.cjs");
  assert.ok(tools.includes("diagnostic: sanitizeLogPayload(payload)"));
  assert.equal(tools.includes('tee -a "$LOG"'), false);
});

test("Electron 42 and legacy console events retain severity without arbitrary text or source paths", () => {
  const { rendererConsoleDiagnostic } = logging();
  const event = { level: "error", message: "synthetic-key and prompt", lineNumber: 42, sourceId: "file:///private/user/project.js" };
  const actual = rendererConsoleDiagnostic(event);
  assert.equal(actual.level, "error");
  assert.equal(actual.line, 42);
  assert.equal(actual.messageLength, event.message.length);
  assert.equal(Object.hasOwn(actual, "message"), false);
  assert.equal(Object.hasOwn(actual, "sourceId"), false);
  const legacy = rendererConsoleDiagnostic({}, 2, event.message, 12);
  assert.equal(legacy.level, "warning");
  assert.equal(legacy.line, 12);
  assert.equal(JSON.stringify(legacy).includes("synthetic-key"), false);
});

test("video submit and completion diagnostics use the same structural serializer", () => {
  const source = fs.readFileSync(path.join(root, "src/renderer/hooks/useVideoGeneration.ts"), "utf8");
  for (const label of ["Video API submit response", "Video API poll completed"]) {
    assert.ok(source.includes(label + ": ${safeStringifyRequestForLog("));
    assert.equal(source.includes(label + ": ${JSON.stringify("), false);
  }
  const window = fs.readFileSync(path.join(root, "electron/main/window.cjs"), "utf8");
  assert.ok(window.includes('appendDesktopLog("renderer-console", diagnostic)'));
});
