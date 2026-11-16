// Exercise the real startup hook with in-memory Chrome/storage adapters only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText, filename);
const operations = require('../src/renderer/lib/assistant-local-operations.ts');
const deep = JSON.parse(fs.readFileSync(require.resolve('../src/renderer/lib/i18n-deep-packs.json'),'utf8'));
const runtimeSource = fs.readFileSync(require.resolve('../src/renderer/lib/i18n-runtime.js'),'utf8').replace('import DEEP_LANGUAGE_PACKS from "./i18n-deep-packs.json";', `const DEEP_LANGUAGE_PACKS = ${JSON.stringify(deep)};`);
const localeContext={console,localStorage:{getItem:()=>''},document:{readyState:'loading',addEventListener(){},documentElement:{dataset:{}},body:null},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn()};
localeContext.globalThis=localeContext;vm.runInNewContext(runtimeSource,localeContext);
const originalLoad = Module._load;
let cleanup;
Module._load = function(name, parent) {
  if (parent?.filename.endsWith('usePluginEnvEffect.ts')) {
    if (name === 'react') return {useRef:()=>({current:null}),useEffect:fn=>{cleanup=fn()}};
    if (name === '../lib/assistant-local-operations') return operations;
    if (name === '../lib/app-root-helpers') return {compactGlobalTasks:x=>x};
    if (name === '../lib/backup-restore-transaction') return {recoverBackupRestoreTransaction:async()=>{}};
    if (name === '../lib/collaboration') return {wanjuanGetOrCreateDeviceId:()=> 'synthetic-device',wanjuanCheckForUpdate:async()=>({hasUpdate:false}),wanjuanChildWindowRefs:[]};
    if (name === '../lib/jixin-catalog') return {
      WANJUAN_JIXIN_BUILTIN_BASE_CONFIG_VERSION:42, WANJUAN_JIXIN_BUILTIN_TIANJI_SEEDANCE_MODELS:[],
      wanjuanIsLegacyJixinDocUrl:()=>false,wanjuanMergeModelText:()=>'',
      wanjuanHasUserModelConfiguration:()=>false,wanjuanHasUserAgentConfiguration:()=>false,
      wanjuanBuildJixinBuiltinBasePatch:()=>{throw Error('UNEXPECTED_DEFAULT_SEED')},
    };
    if (name === '../lib/unified-api-config') return {normalizeUnifiedApiConfigs:x=>x};
    if (name === '../lib/app-utils') return {normalizeThemeMode:x=>x};
    if (name === '../lib/performance-profile') return {WanJuanNormalizePerformanceProfile:x=>x};
    if (name === '../lib/seedance') return {wanjuanNormalizeSeedanceVirtualPortraits:x=>x};
    if (name === '../lib/ark-trusted-assets') return {wanjuanNormalizeArkTrustedAssetConfig:x=>x};
  }
  return originalLoad.apply(this, arguments);
};
const {usePluginEnvEffect} = require('../src/renderer/hooks/usePluginEnvEffect.ts');
Module._load = originalLoad;

async function run(mode, savedLanguage, uiLanguage='zh-CN') {
  const writes=[], flags=[], taskFlags=[], applied=[], toasts=[], languages=[], translated=[], usersApplied=[], modelFlags=[], pendingSettings=[];
  const settingsRef={current:false}, projectRef={current:false};
  const noEvent={addListener(){}};
  const runtime={id:'synthetic',lastError:null,getManifest:()=>({version:'synthetic'}),onMessage:noEvent};
  const normalSettings={jixinBuiltinBaseConfigVersion:42,apiConfigs:[{id:'synthetic-manual'}],...(savedLanguage || {})};
  const local={
    get(keys,cb) {
      const deliver=fn=>mode==='users-chrome-error'?queueMicrotask(fn):fn();
      if (keys.includes('users')) return deliver(()=>{if(mode==='users-chrome-error'){runtime.lastError={message:'SYNTHETIC_PRIVATE'};try{cb(undefined)}finally{runtime.lastError=null}}else cb({users:[{id:'synthetic'}]})});
      if (keys.includes('transitResources')) return deliver(()=>cb({}));
      if (keys.includes('globalTasks')) return deliver(()=>cb({}));
      if (keys.includes('apiConfigs')) {
        if (mode==='chrome-error') {runtime.lastError={message:'synthetic'};try{cb(undefined)}finally{runtime.lastError=null}return;}
        return deliver(()=>cb(normalSettings));
      }
      cb({});
    },
    set(value,cb){writes.push(value);cb?.()},remove(){throw Error('UNEXPECTED_REMOVE')},
  };
  if (mode !== 'chrome-error' && mode !== 'users-chrome-error') local.getWithStatus=(keys,cb)=>{
    if (keys.includes('users')) return cb(mode==='users-fallback' ? {values:{},reliable:false} : mode==='users-malformed' ? {values:{users:{private:'synthetic'}},reliable:true} : mode==='users-empty' ? {values:{},reliable:true} : {values:{users:[{id:'synthetic'}]},reliable:true});
    if (keys.includes('globalTasks')) return cb({values:mode==='task-malformed' ? {globalTasks:[{status:'failed'}]} : {},reliable:true});
    if (keys.includes('apiConfigs')) {if(mode==='delayed-settings'){pendingSettings.push(cb);return;}return cb(mode==='fallback' ? {values:{},reliable:false} : mode==='missing' ? undefined : {values:normalSettings,reliable:true});}
    throw Error('UNEXPECTED_STATUS_READ');
  };
  global.chrome={runtime,storage:{local},tabs:{getCurrent:cb=>cb(null),query:(_q,cb)=>cb([]),onUpdated:noEvent,onActivated:noEvent}};
  global.localStorage={getItem:()=>null,setItem(){throw Error('UNEXPECTED_LOCAL_WRITE')}};
  const oldRuntime=global.wanjuanI18nRuntime;
  global.wanjuanI18nRuntime={resolveSupportedLanguage:localeContext.wanjuanI18nRuntime.resolveSupportedLanguage,setLanguage:value=>translated.push(value),getLanguage:()=>uiLanguage};
  const deps=new Proxy({
    settingsHydratedRef:settingsRef,projectHydratedRef:projectRef,
    localforageModule:{default:{getItem:async()=>null}},
    repairXSeeVeoReferenceVideoBindings:x=>x,
    setAssistantTasksAvailable:value=>taskFlags.push(value),
    setModelConfigurationReady:value=>{if(value)assert.equal(applied[0]?.[0]?.id,'synthetic-manual','publish readiness only after model configuration setters');modelFlags.push(value);},
    setAssistantSettingsUnavailable:value=>flags.push(value),setApiConfigs:value=>applied.push(value),setAppLanguage:value=>languages.push(value),setUsers:value=>usersApplied.push(value),showToast2:value=>toasts.push(value),
  },{get:(target,key)=>Object.hasOwn(target,key)?target[key]:()=>{}});
  const oldError=console.error, logs=[];console.error=(...args)=>logs.push(args);
  try {
    usePluginEnvEffect(deps);
    await new Promise(resolve=>setImmediate(resolve));
    if(mode==='delayed-settings'){
      assert.equal(projectRef.current,true,'project metadata can finish first');assert.equal(settingsRef.current,false);assert.deepEqual(modelFlags,[]);assert.equal(applied.length,0);
      assert.equal(pendingSettings.length,1);pendingSettings[0]({values:normalSettings,reliable:true});await new Promise(resolve=>setImmediate(resolve));
    }
    if (['healthy','delayed-settings','task-malformed','users-fallback','users-malformed','users-chrome-error','users-empty'].includes(mode)) {
      assert.deepEqual(modelFlags,[true]);
      assert.equal(settingsRef.current,true,'reliable settings enable normal hydration');
      assert.deepEqual(flags,[false]);assert.equal(applied[0][0].id,'synthetic-manual');
      assert.deepEqual(taskFlags,[mode!=='task-malformed'],'malformed task records must not be treated as an empty task list');
      if (['users-fallback','users-malformed','users-chrome-error'].includes(mode)) {
        assert.equal(toasts.length,1);assert.ok(toasts[0].includes(uiLanguage==='en-US'?'local account list':uiLanguage==='zh-TW'?'無法讀取本機帳號清單':'无法读取本地账号列表'));assert.equal(usersApplied.length,0,'unreliable users are not replaced');
        assert.deepEqual(logs,[['Local user list unavailable']]);assert.equal(writes.length,0,'no default users are written on uncertain read');
      } else {assert.equal(toasts.length,0);if(mode==='users-empty'){assert.equal(writes.length,1);assert.deepEqual(writes[0],{users:[]},'a reliably empty first run can still initialize normally');}}
      if (savedLanguage) {
        const raw=savedLanguage.appLanguage || savedLanguage.uiLanguage;
        const expected=localeContext.wanjuanI18nRuntime.resolveSupportedLanguage(raw) || raw;
        assert.deepEqual(languages,[expected],'React state uses the actual translator mapping');
        assert.deepEqual(translated,[expected],'translator and React receive the same language');
        assert.equal(writes.length,0,'the startup hook does not rewrite saved settings');
      }
    } else {
      assert.deepEqual(modelFlags,[false]);
      assert.equal(settingsRef.current,false,`${mode}: settings writes remain gated`);
      assert.deepEqual(flags,[true]);assert.equal(applied.length,0);assert.equal(toasts.length,1);
      assert.equal(writes.length,0,`${mode}: no default config or settings written`);
    }
  } finally {console.error=oldError;cleanup?.();delete global.chrome;delete global.localStorage;if(oldRuntime===undefined)delete global.wanjuanI18nRuntime;else global.wanjuanI18nRuntime=oldRuntime;}
}
(async()=>{for(const mode of ['fallback','missing','chrome-error','healthy','delayed-settings','task-malformed','users-fallback','users-malformed','users-chrome-error','users-empty'])await run(mode);for(const language of ['zh-TW','en-US'])await run('users-fallback',undefined,language);for(const saved of [{appLanguage:'en'},{appLanguage:'zh-HK'},{uiLanguage:'zh-hans'},{appLanguage:'future-locale'}])await run('healthy',saved);console.log('PASS_ASSISTANT_SETTINGS_STARTUP_PROTECTION')})().catch(e=>{console.error(e);process.exitCode=1});
