// Exercise the actual hook with synthetic documentation and model responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}, fileName:filename,
}).outputText, filename);
const originalLoad = Module._load;
let documentReads = 0, assistantReads = 0, parsedDocument = '';
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('useRunConfigButler.ts') && request === '../lib/app-root-helpers') return {
    fetchDocAsPlainText: async () => { documentReads++; return 'POST /v1/videos\nAuthorization: Bearer synthetic-secret-value'; },
  };
  if (parent?.filename.endsWith('useRunConfigButler.ts') && request === '../lib/assistant-doc-reader') return {
    fetchAssistantDocumentation: async () => { assistantReads++; return 'POST /v1/videos\nAuthorization: Bearer synthetic-secret-value\nhttps://name:SYNTHETIC_USERINFO@api.example.com/v1\nGET /?key=SYNTHETIC_QUERY&limit=20\napi_key: SYNTHETIC_YAML'; },
  };
  if (parent?.filename.endsWith('useRunConfigButler.ts') && request === '../lib/config-butler') return {
    buildConfigButlerToolContext: doc => { parsedDocument = doc; return {marker:'synthetic-context'}; },
    formatConfigButlerToolContext: () => 'synthetic-context',
    validateAndRepairConfigButlerResult: value => value?.protocol?.config?.pollPath?.includes('evil.example') ? {...value,protocol:{...value.protocol,config:{...value.protocol.config,pollPath:'/safe/{taskId}'}}} : value,
  };
  if (parent?.filename.endsWith('useRunConfigButler.ts') && request === '../lib/app-utils') return {
    extractJsonBlock: text => JSON.parse(text),
  };
  return originalLoad.apply(this, arguments);
};
const {useRunConfigButler} = require('../src/renderer/hooks/useRunConfigButler.ts');
const {buildAssistantAnalysisPrompt} = require('../electron/main/assistant-context.cjs');
Module._load = originalLoad;
let captured = '', manualCalls = 0, result = '', toast = '', loading = [], stale = [], assistantFailure = '', assistantRawResponse = '';
let modelReply = {modelName:'test-model',category:'video',protocol:{config:{submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}'}}};
global.window = {wanjuanDesktop:{assistantAnalyzeConfig: async prompt => {
  captured = prompt;
  if (assistantFailure) return {ok:false,code:assistantFailure,error:'synthetic-provider-secret'};
  if (assistantRawResponse) return {ok:true,value:assistantRawResponse};
  return {ok:true,value:JSON.stringify(modelReply)};
}}};
function deps(useAssistant, url = 'https://docs.example.com/api', targetUrl = 'https://api.example.com/v1') {
  return {
    configButlerUseAssistant:useAssistant, configButlerDocUrl:url, configButlerTargetCategory:'video', configButlerTargetModel:'test-model',
    getSelectedButlerTargetApiConfig:() => ({id:'selected-channel',url:targetUrl,key:'sk-synthetic-target-key-12345'}),
    callConfigButlerModel:async () => { manualCalls++; return JSON.stringify({modelName:'manual',category:'video'}); },
    setConfigButlerLoading:value => loading.push(value), setConfigButlerResultText:value => {result=value;}, setConfigButlerResultStale:value => stale.push(value), showToast2:value => {toast=value;},
  };
}
async function main() {
  await useRunConfigButler(deps(true)).runConfigButler();
  assert.ok(captured.includes('test-model'));
  assert.equal(parsedDocument.includes('synthetic-secret-value'), false, 'redaction precedes parsing and displayed context');
  assert.doesNotMatch(parsedDocument,/SYNTHETIC_USERINFO|SYNTHETIC_QUERY|SYNTHETIC_YAML/,'additional credentials are removed before context parsing');
  assert.doesNotMatch(captured,/SYNTHETIC_USERINFO|SYNTHETIC_QUERY|SYNTHETIC_YAML/,'additional credentials never reach the assistant');
  assert.equal(captured.includes('synthetic-secret-value'), false);
  assert.equal(captured.includes('sk-synthetic-target-key-12345'), false);
  assert.equal(buildAssistantAnalysisPrompt(captured),captured,'real redacted analysis prompt passes the main-process boundary');
  assert.equal(manualCalls, 0);
  assert.equal(assistantReads, 1, 'assistant uses the restricted reader');
  assert.equal(documentReads, 0, 'assistant never falls back to browser or direct fetch');
  assert.equal(JSON.parse(result).modelName, 'test-model');
  assert.equal(JSON.parse(result).__wanjuanTargetApiConfigId,'selected-channel');
  assert.notEqual(JSON.parse(result).validation?.ok, false, 'valid same-origin proposal remains available');
  assert.deepEqual(loading.slice(-2), [true,false]);
  assert.deepEqual(stale.slice(-2),[true,false]);
  const previousResult = result;
  for (const [language, expected] of [['zh-CN','可能包含凭据'],['zh-TW','可能包含憑證'],['en-US','may contain a credential']]) {
    for (const payload of [
      {modelName:'test-model',category:'video',protocol:{config:{submitPath:'/v1/videos',extraHeaders:{'x-client-token':'SYNTHETIC_PRIVATE'}}}},
      {modelName:'test-model',category:'video',notes:'sk-synthetic-private-12345',protocol:{config:{submitPath:'/v1/videos'}}},
      {modelName:'test-model',category:'video',apiConfig:{name:'Demo',key:'SYNTHETIC_PRIVATE'},protocol:{config:{submitPath:'/v1/videos'}}},
      {modelName:'test-model',category:'video',protocol:{clientSecret:'SYNTHETIC_PRIVATE',config:{submitPath:'/v1/videos'}}},
    ]) {
      modelReply=payload;
      const guarded=deps(true);guarded.appLanguage=language;
      const logs=[],oldError=console.error;console.error=(...parts)=>logs.push(parts);
      try {await useRunConfigButler(guarded).runConfigButler()} finally {console.error=oldError}
      assert.equal(result,previousResult,'suspicious model output does not replace the previous editable result');
      assert.equal(stale.at(-1),true,'the old result remains stale and cannot be applied');
      assert.ok(toast.includes(expected));assert.doesNotMatch(toast,/SYNTHETIC_PRIVATE|sk-synthetic/);
      assert.doesNotMatch(JSON.stringify(logs),/SYNTHETIC_PRIVATE|sk-synthetic/,'suspicious response is not logged');
    }
  }
  modelReply={modelName:'test-model',category:'video',apiConfig:{name:'Demo',key:'SYNTHETIC_PRIVATE'},protocol:{config:{submitPath:'/v1/videos'}}};
  await useRunConfigButler(deps(true,'https://docs.example.com/api','https://api.example.com/v1?view=public')).runConfigButler();
  assert.equal(result,previousResult,'a benign target query cannot bypass metadata privacy inspection');assert.equal(stale.at(-1),true);assert.doesNotMatch(toast,/SYNTHETIC_PRIVATE/);
  modelReply={modelName:'test-model',category:'video',protocol:{config:{submitPath:'/v1/videos',extraHeaders:{'x-client-token':'SYNTHETIC_PRIVATE'}}}};
  await useRunConfigButler(deps(true,'https://docs.example.com/api','https://api.example.com/v1?view=public')).runConfigButler();
  assert.equal(result,previousResult,'a benign target query cannot bypass protocol privacy inspection');assert.equal(stale.at(-1),true);
  modelReply = {modelName:'test-model',category:'video',protocol:{config:{submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}'}}};
  assistantFailure = 'ASSISTANT_BUSY';
  await useRunConfigButler(deps(true)).runConfigButler();
  assert.equal(result,previousResult,'failed analysis retains editable previous text');
  assert.equal(stale.at(-1),true,'failed analysis requires explicit review before applying');
  assert.ok(toast.includes('正在处理其他请求'));
  assert.equal(toast.includes('synthetic-provider-secret'),false);
  assistantFailure = 'synthetic-provider-secret';
  await useRunConfigButler(deps(true)).runConfigButler();
  assert.equal(toast.includes('synthetic-provider-secret'),false,'unknown failures never expose provider output');
  assistantFailure = '';
  assistantRawResponse = 'synthetic-private-response-not-json';
  const originalConsoleError = console.error, logs = [];
  console.error = (...parts) => logs.push(parts.join(' '));
  try { await useRunConfigButler(deps(true)).runConfigButler(); } finally { console.error = originalConsoleError; }
  assert.equal(result,previousResult);
  assert.equal(stale.at(-1),true);
  assert.equal(toast.includes('synthetic-private-response'),false);
  assert.equal(logs.join(' ').includes('synthetic-private-response'),false,'invalid provider response is not logged');
  assistantRawResponse = '';
  modelReply = {modelName:'test-model',category:'video',protocol:{config:{submitPath:'/v1/videos',pollPath:'https://evil.example/{taskId}'}}};
  await useRunConfigButler(deps(true)).runConfigButler();
  assert.equal(JSON.parse(result).validation.ok, false, 'cross-origin proposal is visibly marked invalid');
  assert.equal(JSON.parse(result).__wanjuanRawSafetyFailed, true, 'normalization cannot erase an unsafe original proposal');
  await useRunConfigButler(deps(false)).runConfigButler();
  assert.equal(manualCalls, 1, 'manual mode is preserved');
  assert.equal(documentReads, 1, 'manual mode preserves its existing reader');
  assert.ok(parsedDocument.includes('synthetic-secret-value'), 'existing manual parsing path is unchanged');
  for (const [language, expected] of [['zh-CN','请检查文档'],['zh-TW','請檢查文件'],['en-US','Check the documentation']]) {
    const failure=deps(false);failure.appLanguage=language;failure.callConfigButlerModel=async()=>{throw Error('HTTP 401 SYNTHETIC_PRIVATE_KEY https://private.invalid/?token=secret')};
    const previous=result, oldError=console.error, logs=[];console.error=(...parts)=>logs.push(parts);
    try {await useRunConfigButler(failure).runConfigButler()} finally {console.error=oldError}
    assert.equal(result,previous,'manual failure retains the editable previous result');assert.equal(stale.at(-1),true);
    assert.ok(toast.includes(expected));assert.doesNotMatch(toast,/SYNTHETIC_PRIVATE_KEY|private\.invalid|token=secret/);
    assert.deepEqual(logs,[['Config butler failed']],'manual provider errors are not logged');
  }
  {
    const failure=deps(false);failure.callConfigButlerModel=async()=>{throw null};
    const oldError=console.error;console.error=()=>{};try{await useRunConfigButler(failure).runConfigButler()}finally{console.error=oldError}
    assert.match(toast,/请检查文档/,'non-Error failures are handled safely');
  }
  const before = assistantReads;
  await useRunConfigButler(deps(true, 'http://127.0.0.1/private')).runConfigButler();
  assert.equal(assistantReads, before, 'obvious private docs are rejected before fetch');
  await useRunConfigButler(deps(true, 'https://docs.example.com/', 'https://user:password@api.example.com/')).runConfigButler();
  await useRunConfigButler(deps(true, 'https://docs.example.com/', 'https://api.example.com/?key=SYNTHETIC_TARGET')).runConfigButler();
  assert.equal(assistantReads, before, 'target URL credentials are rejected before fetch');
  assert.ok(toast.includes('目标 API 地址'));
  console.log('PASS_ASSISTANT_CONFIG_BUTLER_ROUTING');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
