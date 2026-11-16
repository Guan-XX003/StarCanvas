const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "./runtime.cjs") return { ipcRenderer: {} };
  if (request === "./storage.cjs") return { getPerformanceFetchLimit: () => 1 };
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const { buildDesktopProxyFetchBridgePayload,classifyStableFetch,installFetchStabilityShim } = require("../electron/preload/fetch-proxy.cjs");
  for(const url of ['https://mock-upstream.invalid/v1/chat/completions','https://mock-upstream.invalid/v1beta/models/synthetic:generateContent']){
    assert.equal(classifyStableFetch(url,{method:'POST',starcanvasNoRetry:true}).retries,0);
    assert.ok(classifyStableFetch(url,{method:'POST'}).retries>0,'legacy retry policy remains unchanged');
  }
  const oldWindow=global.window;let attempts=0;
  global.window={fetch:async()=>{attempts++;throw new TypeError('Failed to fetch');}};
  installFetchStabilityShim();
  const noRetry=global.window.fetch('https://mock-upstream.invalid/v1/chat/completions',{method:'POST',starcanvasNoRetry:true});
  assert.rejects(noRetry,{message:'Failed to fetch'}).then(()=>{assert.equal(attempts,1);console.log('preload proxy: assistant turns do not replay failed model requests');})
    .catch(error=>{console.error(error);process.exitCode=1;})
    .finally(()=>{if(oldWindow===undefined)delete global.window;else global.window=oldWindow;});
  const poll = buildDesktopProxyFetchBridgePayload({
    requestId: "fixture-poll",
    url: "https://mock-upstream.invalid/history",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { task_id: "synthetic" },
    enterpriseRequestKind: "POLL",
  });
  assert.equal(poll.enterpriseRequestKind, "poll");
  assert.deepEqual(JSON.parse(Buffer.from(poll.bodyBase64, "base64").toString("utf8")), { task_id: "synthetic" });

  const submit = buildDesktopProxyFetchBridgePayload({
    url: "https://mock-upstream.invalid/submit",
    method: "POST",
    enterpriseRequestKind: "submit",
  });
  assert.equal(submit.enterpriseRequestKind, "submit");

  const legacy = buildDesktopProxyFetchBridgePayload({
    url: "https://mock-upstream.invalid/legacy",
    method: "POST",
    enterpriseRequestKind: "invalid",
  });
  assert.equal(legacy.enterpriseRequestKind, undefined);
  console.log("preload proxy: enterprise request kind survives IPC payload normalization");
} finally {
  Module._load = originalLoad;
}
