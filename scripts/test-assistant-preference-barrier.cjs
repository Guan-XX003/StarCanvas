// Exercise the actual assistant settings callback through the real storage
// barrier with in-memory data. No app profile, model, network or files change.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText, filename);
const {installStorageWriteBarrier} = require('../src/renderer/lib/storage-write-barrier.ts');
const {use_saveNonModelSettings} = require('../src/renderer/hooks/use_saveNonModelSettings.ts');
const {invalidateAssistantPreferencePersistence:invalidate} = require('../src/renderer/lib/assistant-preferences.ts');
const bundle = fs.readFileSync(path.join(__dirname, '../src/renderer/bundle/index.js'), 'utf8');
const callbackText = require('./source-function.cjs')(bundle,'applyAssistantPreference');
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  for (let i=0;i<100;i++) {if(predicate())return;await tick();}
  throw Error('synthetic storage callback did not arrive');
};

(async()=>{
  const values={autoDownloadGeneratedResults:false,manualApi:'synthetic-manual-config'}, pending=[];
  const raw={
    get(_keys,cb){queueMicrotask(()=>cb({...values}));},
    set(items,cb){pending.push(()=>{Object.assign(values,items);cb();});},
    remove(_keys,cb){queueMicrotask(cb);},
  };
  const localforage={keys:async()=>[],getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};
  const barrier=installStorageWriteBarrier({localforage,chromeStorage:raw,chromeRuntime:{lastError:null}});
  const root={dataset:{wanjuanAutoDownloadListener:'off'}}, mirror={themeMode:'graphite',uiTheme:'graphite',theme:'graphite',appearanceTheme:'graphite'};
  const renderer={isReady:true,settingsHydratedRef:{current:true},autoDownloadGeneratedResults:false,document:{documentElement:root},
    chrome:{runtime:barrier.chromeRuntime,storage:{local:barrier.chromeStorage}},
    setAutoDownloadGeneratedResults:value=>{renderer.autoDownloadGeneratedResults=value;},
    setThemeMode:value=>{renderer.themeMode=value;}, setAppLanguage:value=>{renderer.appLanguage=value;}, saveNonModelSettings:()=>{}, nonModelSettingsSaveTimerRef:{current:null},
    localStorage:{setItem:(key,value)=>{mirror[key]=value}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    window:{dispatchEvent:event=>{root.dataset.wanjuanAutoDownloadListener=event.detail.enabled?'on':'off';return true;}}};
  const setPreference=vm.runInNewContext(`(${callbackText})`,renderer);
  assert.equal(setPreference('autoDownload',true),true);
  assert.equal(root.dataset.wanjuanAutoDownloadPersisted,'pending');
  await until(()=>pending.length===1);
  // A newer setting is queued while the first write has not finished.
  assert.equal(setPreference('autoDownload',false),true);
  pending.shift()();await until(()=>pending.length===1);
  assert.equal(root.dataset.wanjuanAutoDownloadPersisted,'pending','old callback cannot confirm the new choice');
  pending.shift()();await until(()=>root.dataset.wanjuanAutoDownloadPersisted==='off');
  assert.equal(values.autoDownloadGeneratedResults,false);
  assert.equal(values.manualApi,'synthetic-manual-config');
  assert.equal(setPreference('theme','dark'),true);
  await until(()=>pending.length===1);
  assert.equal(mirror.themeMode,'graphite','boot mirror stays unchanged until storage readback succeeds');
  assert.equal(setPreference('theme','light'),true);
  pending.shift()();await until(()=>pending.length===1);
  assert.equal(root.dataset.wanjuanThemePersisted,'pending','old theme write cannot confirm a newer choice');
  pending.shift()();await until(()=>root.dataset.wanjuanThemePersisted==='light');
  assert.equal(values.themeMode,'light');assert.equal(mirror.themeMode,'light');
  assert.equal(setPreference('language','en-US'),true);
  await until(()=>pending.length===1);pending.shift()();await until(()=>root.dataset.wanjuanLanguagePersisted==='en-US');
  assert.equal(values.appLanguage,'en-US');
  await until(()=>barrier.getState().pendingWrites===0);
  assert.equal(setPreference('theme','dark'),true);await until(()=>pending.length===1);
  invalidate('theme',root);
  for (const name of ['themeMode','uiTheme','theme','appearanceTheme']) mirror[name]='light';
  barrier.chromeStorage.set({themeMode:'light',uiTheme:'light',theme:'light',appearanceTheme:'light'},()=>{});
  pending.shift()();await until(()=>pending.length===1);pending.shift()();await until(()=>barrier.getState().pendingWrites===0);
  assert.equal(mirror.themeMode,'light','late assistant readback cannot overwrite a manual selection');
  assert.equal(values.themeMode,'light');assert.equal(root.dataset.wanjuanThemePersisted,'pending','superseded receipt cannot report success');
  await barrier.exclusive(async()=>({ok:true}),()=>false,false,true);
  const originalError=console.error, expectedErrors=[];
  try {
    console.error=(...args)=>expectedErrors.push(args);
    assert.equal(setPreference('autoDownload',true),true);
    await until(()=>root.dataset.wanjuanAutoDownloadPersisted==='failed');
    assert.equal(setPreference('theme','dark'),true);
    await until(()=>root.dataset.wanjuanThemePersisted==='failed');
    assert.equal(setPreference('language','zh-TW'),true);
    await until(()=>root.dataset.wanjuanLanguagePersisted==='failed');
  } finally {console.error=originalError;}
  assert.equal(expectedErrors.length,3,'each blocked write is explicitly reported');
  assert.equal(values.autoDownloadGeneratedResults,false,'a blocked write cannot be reported as saved');
  assert.equal(values.themeMode,'light');assert.equal(mirror.themeMode,'light','failed storage write does not update the boot mirror');assert.equal(values.appLanguage,'en-US');assert.equal(values.manualApi,'synthetic-manual-config');
  // Exercise the real debounced settings writer as well as the direct
  // assistant callback. An older batch must not overwrite an acknowledged
  // preference, and replacing it must retain unrelated pending settings.
  const savedTimeout=global.setTimeout, savedClear=global.clearTimeout, savedChrome=global.chrome;
  try {
    for (const [kind,value,key,initial] of [['theme','dark','themeMode','graphite'],['language','en-US','appLanguage','zh-CN'],['autoDownload',true,'autoDownloadGeneratedResults',false],['theme','graphite','themeMode','graphite']]) {
      let sequence=0;const timers=new Map(),memory={manualApi:'synthetic-manual'};
      global.setTimeout=fn=>{const id=++sequence;timers.set(id,fn);return id};global.clearTimeout=id=>timers.delete(id);
      const storage={set:(items,cb)=>{Object.assign(memory,items);cb?.()},get:(_keys,cb)=>cb({...memory})};
      global.chrome={storage:{local:storage}};
      const deps={settingsHydratedRef:{current:true},nonModelSettingsSaveTimerRef:{current:null},themeMode:'graphite',appLanguage:'zh-CN',autoDownloadGeneratedResults:false,pollingInterval:777,presetPrompts:['synthetic-manual'],agentItems:['synthetic-agent']};
      const save=use_saveNonModelSettings(deps).saveNonModelSettings;save();
      const localRoot={dataset:{wanjuanAutoDownloadListener:'off'}};
      const context={isReady:true,settingsHydratedRef:{current:true},nonModelSettingsSaveTimerRef:deps.nonModelSettingsSaveTimerRef,autoDownloadGeneratedResults:false,document:{documentElement:localRoot},localStorage:{setItem(){}},chrome:{storage:{local:storage}},saveNonModelSettings:save,setThemeMode(){},setAppLanguage(){},setAutoDownloadGeneratedResults(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},window:{dispatchEvent:event=>{localRoot.dataset.wanjuanAutoDownloadListener=event.detail.enabled?'on':'off';return true;}}};
      const set=vm.runInNewContext(`(${callbackText})`,context);
      assert.equal(set(kind,value),true);assert.equal(memory[key],value);
      for (const fn of [...timers.values()]) fn();
      assert.equal(memory[key],value,`${kind}: stale batch must not restore ${initial}`);
      assert.equal(memory.globalPollingInterval,777);assert.deepEqual(memory.presetPrompts,['synthetic-manual']);assert.deepEqual(memory.agents,['synthetic-agent']);assert.equal(memory.manualApi,'synthetic-manual');
      assert.equal(deps.nonModelSettingsSaveTimerRef.current,null,'completed batch releases its timer');
      timers.clear();assert.equal(set(kind,value),true);
      assert.equal(timers.size,0,'a targeted assistant write does not create a new unrelated batch when none is pending');
      if (kind==='theme' && value==='dark') {
        save({themeMode:'dark'});
        const manualSave=use_saveNonModelSettings({...deps,themeMode:'light'}).saveNonModelSettings;
        manualSave();for (const fn of [...timers.values()]) fn();
        assert.equal(memory.themeMode,'light','a later manual change supersedes the assistant batch');
      }
    }
  } finally { global.setTimeout=savedTimeout;global.clearTimeout=savedClear;global.chrome=savedChrome; }
  console.log('PASS_ASSISTANT_PREFERENCE_STORAGE_BARRIER');
})().catch(error=>{console.error(error);process.exitCode=1});
