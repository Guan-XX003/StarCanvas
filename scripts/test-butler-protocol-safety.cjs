const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}, fileName:filename,
}).outputText, filename);
const {validateButlerProtocolSafety: check} = require('../src/renderer/lib/butler-protocol-safety.ts');
const base = 'https://api.example.com/v1';
for (const config of [
  {submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',extraHeaders:{'x-api-version':'2026-01'}},
  {submitPath:'https://api.example.com/v1/videos',headers:{Authorization:'Bearer {apiKey}'}},
  {submitPath:'chat/completions',headers:{'x-api-key':'{apiKey}'}},
  {submitPath:'/v1/videos',extraHeaders:{'x-client-token':'{apiKey}'},extraBody:{duration:5,parameters:{max_tokens:256}}},
]) assert.equal(check(config, base).ok, true, 'legitimate same-origin protocols remain supported');
for (const config of [
  {submitPath:'https://evil.example/v1/videos'}, {pollPath:'https://evil.example/{taskId}'},
  {editPath:'http://api.example.com/v1/images'}, {contentPath:'https://api.example.com@evil.example/video'},
  {submitPath:'//evil.example/path'}, {submitPath:'/v1/videos?api_key={apiKey}'},
  {submitPath:'/v1/%257BapiKey%257D'}, {submitPath:'/v1/videos?token=secret'},
  {submitPath:'/v1/videos\r\nInjected: yes'}, {headers:{Authorization:'Bearer sk-synthetic-secret-key'}},
  {headers:{'x-api-key':'[REDACTED]'}}, {headers:{Cookie:'session=secret'}},
  {headers:{'x-client-token':'SYNTHETIC_PRIVATE'}}, {extraHeaders:{'x-client-secret':'SYNTHETIC_PRIVATE'}},
  {headers:{'x-clientsecret':'SYNTHETIC_PRIVATE'}},
  {extraBody:{credentials:{api_key:'SYNTHETIC_PRIVATE'}}}, {extraBody:{nested:[{accessToken:'SYNTHETIC_PRIVATE'}]}},
  {extraBody:{opaque:'sk-synthetic-private-12345'}}, {extraBody:'{"api_key":"SYNTHETIC_PRIVATE"}'},
  {apiKey:'SYNTHETIC_PRIVATE'},
  {headers:{Authorization:'Bearer {apiKey}'},extraHeaders:{authorization:'Bearer {apiKey}'}},
]) {
  const result = check(config, base);
  assert.equal(result.ok, false, 'unsafe model-generated protocol is rejected');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false, 'validation errors do not echo secret values');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'), false, 'validation errors do not echo embedded credentials');
}
const cyclic = {};cyclic.self=cyclic;assert.equal(check({extraBody:cyclic},base).ok,false,'uninspectable request bodies fail closed');
for (const invalidBase of ['javascript:alert(1)','https://user:pass@example.com','https://api.example.com/?token=secret']) assert.equal(check({submitPath:'/v1/videos'}, invalidBase).ok, false);
assert.equal(check({headers:{'x-client-token':'SYNTHETIC_PRIVATE'}},base).containsCredential,true);
assert.equal(check({extraBody:{nested:{api_key:'SYNTHETIC_PRIVATE'}}},base).containsCredential,true);
assert.equal(check({pollPath:'https://evil.example/task'},base).containsCredential,false,'a noncredential protocol failure remains reviewable');

// Exercise the actual apply hook with in-memory React setters; unsafe or stale
// proposals must fail before any settings or caller-owned objects are changed.
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('useApplyConfigButlerResult.ts')) {
    if (request === '../lib/backup') return {cloneBackupValue:value => structuredClone(value)};
    if (request === '../lib/model-list-utils') return {ensureModelInList:(list, name) => `${list || ''}\n${name}`};
    if (request === '../lib/unified-api-config') return {guessApiConfigName:() => 'Test',normalizeUnifiedApiConfigs:value => value};
    if (request === '../lib/config-butler') return {
      finalizeButlerProtocolConfig:value => value.pollPath?.includes('evil.example') ? {...value,pollPath:'/safe/{taskId}'} : value, normalizeButlerBaseUrl:value => String(value || '').replace(/\/$/,''),
      normalizeModelCategory:value => value, normalizeProtocolConfig:value => value, normalizeProtocolName:() => 'Protocol',
      validateButlerProtocolConfig:() => ({ok:true,errors:[]}),
    };
  }
  return originalLoad.apply(this, arguments);
};
const {useApplyConfigButlerResult} = require('../src/renderer/hooks/useApplyConfigButlerResult.ts');
Module._load = originalLoad;
let writes = 0;
const apiConfig = {id:'one',name:'My Channel',url:base,key:'synthetic-target'};
const deps = {
  apiConfigs:[apiConfig], configButlerTargetApiConfigId:'one', configButlerDocUrl:'https://docs.example.com/a', configButlerTargetCategory:'video',configButlerTargetModel:'demo-video',
  getSelectedButlerTargetApiConfig:() => apiConfig, modelProtocolRegistry:{},storedGlobalConfigs:[],videoModels:'',
  videoModelApiBindings:{},videoModelProtocolBindings:{}, textModelApiBindings:{},textModelProtocolBindings:{},
  imageModelApiBindings:{},imageModelProtocolBindings:{},audioModelApiBindings:{},audioModelProtocolBindings:{},
};
for (const name of ['setApiConfigs','setModelProtocolRegistry','setVideoModels','setVideoModelApiBindings','setVideoModelProtocolBindings','setConfigButlerExpanded','setProtocolNamesText','setActiveProtocolName','setActiveProtocolConfigText','setProtocolFormatsExpanded','showToast2']) deps[name] = () => { writes++; };
let savedConfigs;
deps.setApiConfigs = value => { writes++; savedConfigs=value; };
const apply = useApplyConfigButlerResult(deps).applyConfigButlerResult;
const result = {modelName:'demo-video',category:'video',__wanjuanTargetApiConfigId:'one',protocol:{name:'Video',config:{category:'video',requestType:'openai-video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}'}},toolContext:{sourceUrl:'https://docs.example.com/a',target:{modelName:'demo-video',category:'video',apiUrl:base}}};
assert.throws(() => apply({...result,protocol:{...result.protocol,config:{...result.protocol.config,pollPath:'https://evil.example/{taskId}'}}}), /安全检查/);
assert.throws(() => apply({...result,protocol:{...result.protocol,config:{...result.protocol.config,extraBody:{credentials:{api_key:'SYNTHETIC_PRIVATE'}}}}}), /安全检查/);
assert.throws(() => apply({...result,modelName:'other-model'}), /模型 ID/);
assert.throws(() => apply({...result,toolContext:{target:{...result.toolContext.target,apiUrl:'https://other.example/v1'}}}), /已变化/);
assert.throws(() => apply({...result,__wanjuanRawSafetyFailed:true}), /原始分析结果包含不安全/);
assert.throws(() => apply({...result,__wanjuanTargetApiConfigId:'another'}), /目标 API 配置已变化/);
assert.throws(() => apply({...result,toolContext:{...result.toolContext,sourceUrl:'https://docs.example.com/other'}}), /文档链接已变化/);
assert.throws(() => useApplyConfigButlerResult({...deps,configButlerTargetApiConfigId:'removed'}).applyConfigButlerResult(result), /所选 API 配置已变化或不存在/);
assert.equal(writes, 0, 'rejected results never trigger setters');
assert.deepEqual(apiConfig, {id:'one',name:'My Channel',url:base,key:'synthetic-target'}, 'rejected results do not mutate selected configuration');
apply(result);
assert.ok(writes > 0, 'valid configuration can still be applied');
assert.equal(savedConfigs[0].name,'My Channel','model suggestion must not rename an existing channel');
assert.equal(savedConfigs[0].key,'synthetic-target');
assert.deepEqual(apiConfig, {id:'one',name:'My Channel',url:base,key:'synthetic-target'}, 'successful application must not mutate original state');
const blankKey = {id:'blank',name:'Blank key',url:base,key:''};
useApplyConfigButlerResult({...deps,apiConfigs:[blankKey],configButlerTargetApiConfigId:'blank',configButlerTargetApiKey:'stale-previous-key',getSelectedButlerTargetApiConfig:()=>blankKey}).applyConfigButlerResult({...result,__wanjuanTargetApiConfigId:'blank'});
assert.equal(savedConfigs[0].key,'','a previous channel key is never copied into the selected empty channel');
const blankUrl = {id:'blank-url',name:'Blank URL',url:'',key:'selected-key'};
assert.throws(() => useApplyConfigButlerResult({...deps,apiConfigs:[blankUrl],configButlerTargetApiConfigId:'blank-url',configButlerTargetApiUrl:base,getSelectedButlerTargetApiConfig:()=>blankUrl}).applyConfigButlerResult({...result,__wanjuanTargetApiConfigId:'blank-url'}), /缺少模型名、分类或请求地址/);
const other = {id:'other',name:'Test',url:'https://other.example/v1',key:'other-key'};
const noSelection = {...deps,apiConfigs:[other],configButlerTargetApiConfigId:'',configButlerTargetApiUrl:base,configButlerTargetApiKey:'new-key',getSelectedButlerTargetApiConfig:()=>null};
useApplyConfigButlerResult(noSelection).applyConfigButlerResult({...result,__wanjuanTargetApiConfigId:''});
assert.deepEqual(other,{id:'other',name:'Test',url:'https://other.example/v1',key:'other-key'},'same name on another origin must not be modified');
assert.equal(savedConfigs.length,2,'new origin creates a separate channel rather than matching by name');
const duplicates = [{id:'a',url:base,key:'a'},{id:'b',url:base,key:'b'}];
assert.throws(() => useApplyConfigButlerResult({...noSelection,apiConfigs:duplicates}).applyConfigButlerResult({...result,__wanjuanTargetApiConfigId:''}), /多个相同地址/);
console.log('PASS_BUTLER_PROTOCOL_SAFETY_AND_APPLY');
