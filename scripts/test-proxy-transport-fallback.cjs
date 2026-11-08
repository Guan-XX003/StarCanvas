#!/usr/bin/env node
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");

const modulePath = path.join(__dirname, "../electron/main/net/proxy-fetch.cjs");

function loadProxy({ electronRequest, nodeRequest }) {
  delete require.cache[require.resolve(modulePath)];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "../electron-refs.cjs" && parent?.filename === modulePath) {
      return { net: electronRequest ? { request: electronRequest } : null };
    }
    if (["http", "https"].includes(request) && parent?.filename === modulePath) {
      return { request: nodeRequest };
    }
    if (request === "../logging.cjs" && parent?.filename === modulePath) {
      return { appendDesktopLog() {}, formatErrorMessage: (error) => String(error?.message || error) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function ambiguousElectronRequest(_options) {
  const request = new EventEmitter();
  request.setHeader = () => {};
  request.write = () => {};
  request.abort = () => {};
  request.end = () => queueMicrotask(() => request.emit("error", Object.assign(new Error("connection reset"), { code: "ECONNRESET" })));
  return request;
}

function successfulNodeRequest(nodeCalls) {
  return (_target, _options, onResponse) => {
    nodeCalls.push(true);
    const request = new EventEmitter();
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.statusMessage = "OK";
      response.headers = {};
      onResponse(response);
      response.emit("end");
    });
    return request;
  };
}

async function run() {
  {
    const nodeCalls = [];
    const proxy = loadProxy({
      electronRequest: ambiguousElectronRequest,
      nodeRequest: successfulNodeRequest(nodeCalls),
    });
    await assert.rejects(
      proxy.proxyHttpRequest("https://example.test/generate", { method: "POST", body: Buffer.from("{}") }),
      /connection reset/,
    );
    assert.equal(nodeCalls.length, 0, "an ambiguously delivered POST must not be replayed through Node");
  }

  {
    const nodeCalls = [];
    const proxy = loadProxy({
      electronRequest: ambiguousElectronRequest,
      nodeRequest: successfulNodeRequest(nodeCalls),
    });
    const result = await proxy.proxyHttpRequest("https://example.test/status", { method: "GET" });
    assert.equal(result.status, 200);
    assert.equal(nodeCalls.length, 1, "a safe GET may fall back after a transport failure");
  }

  {
    const nodeCalls = [];
    const proxy = loadProxy({
      electronRequest: null,
      nodeRequest: successfulNodeRequest(nodeCalls),
    });
    const result = await proxy.proxyHttpRequest("https://example.test/generate", { method: "POST", body: Buffer.from("{}") });
    assert.equal(result.status, 200);
    assert.equal(nodeCalls.length, 1, "a POST may fall back only when Electron transport was unavailable before send");
  }

  console.log("proxy transport fallback: non-idempotent replay guard passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
