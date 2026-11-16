const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),crypto=require('node:crypto');
const oldLoad=Module._load,oldTs=require.extensions['.ts'];
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
Module._load=function(name,parent,...args){
  if(name==='react')return {useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:fn=>fn()};
  if(parent?.filename.endsWith('useCanvasLoadEffect.ts')){
    if(name.includes('canvas-node-registry'))return {WANJUAN_STARTER_EDGES:[],wanjuanIsDefaultStarterCanvas:()=>false};
    if(name.includes('audio-nodes'))return {WanJuanTtsMusicTaskAudioUrl:()=>''};
    if(name.includes('resource'))return {wanjuanClearProjectAssetBindingsFromData:x=>x};
    if(name.includes('tianji-portrait'))return {wanjuanResetTianjiPortraitBindingForImage:x=>x};
    if(name.includes('video-task'))return {wanjuanNewestNodeTask:()=>null,wanjuanTaskUsesSeedanceSlot:()=>false,wanjuanVideoTaskCanAttachToNode:()=>true,wanjuanVideoTaskMatchesNodeByPrompt:()=>false};
  }
  return oldLoad.apply(this,[name,parent,...args]);
};
const {useSaveCanvasState}=require('../src/renderer/hooks/useSaveCanvasState.ts');
const {useCanvasLoadEffect}=require('../src/renderer/hooks/useCanvasLoadEffect.ts');
const {createCanvasUnloadHandler}=require('../src/renderer/hooks/useCanvasUnloadMirror.ts');
const {captureCanvasPersistenceSnapshot:capture}=require('../src/renderer/lib/canvas-persistence-snapshot.ts');
Module._load=oldLoad;
const SECRET='SYNTHETIC_CONFIG_PRIVATE';const marker='$starcanvasEncryptedConfig';
const clone=x=>JSON.parse(JSON.stringify(x));const tick=()=>new Promise(r=>setImmediate(r));
const task=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release}};
const state=()=>({nodes:[{id:'node',type:'customNode',data:{config:{headers:{Authorization:SECRET},body:{file:'file:///synthetic/reference'}},name:'manual'}}],edges:[]});
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
function setup(protect){
  const initial=state(),vault=new Map(),writes=[],mirrors=[],notices=[],media=[],references=[];
  const bridge={customConfigProtect:protect||(async value=>{const reference='custom-config-v1:'+crypto.randomUUID();vault.set(reference,clone(value));return {ok:true,reference}}),customConfigRestore:async reference=>vault.has(reference)?{ok:true,config:clone(vault.get(reference))}:{ok:false},syncProjectReferences:async value=>references.push(value.references)};
  global.window={wanjuanDesktop:bridge};global.chrome={storage:{local:{set:value=>mirrors.push(clone(value))}}};
  global.prepareProjectMediaStateForPersistence=async value=>{media.push(clone(value));return value};
  global.collectProjectFileReferences=value=>new Set(JSON.stringify(value).includes('file:///synthetic/reference')?['/synthetic/reference']:[]);
  const deps={WanJuanStripRuntimeNodeData:x=>x,canvasStateKeyPrefix:'canvas-',desktopCanvasMirrorPrefix:'mirror-',edgesRef:{current:initial.edges},externalizeProjectCanvasState:async value=>{media.push(clone(value));return value},historyIndexRef:{current:0},isRestoringRef:{current:true},localforageModule:{default:{getItem:async()=>null,setItem:async(key,value)=>writes.push({key,value:clone(value)})}},nodesRef:{current:initial.nodes},projectIdRef:{current:'fixture-'+crypto.randomUUID()},setHistory(){},setHistoryIndex(){},shouldFitViewRef:{current:true},showToast:value=>notices.push(value)};
  const hook=useSaveCanvasState(deps);return {deps,hook,bridge,vault,writes,mirrors,notices,media,references};
}
function safeWrites(values){assert.doesNotMatch(JSON.stringify(values),new RegExp(SECRET));assert(values.every(v=>v.nodes[0].data.config[marker]));}

test('real save hook encrypts before media, primary, and mirror writes without changing manual config',async()=>{
  const e=setup(),before=clone(e.deps.nodesRef.current);await e.hook.saveCanvasState();
  assert.equal(e.writes.length,1);safeWrites([...e.media,e.writes[0].value,...e.mirrors.flatMap(x=>Object.values(x))]);
  assert.deepEqual(e.deps.nodesRef.current,before);assert.deepEqual(e.references,[['/synthetic/reference']]);
  const snapshot=e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]});safeWrites([snapshot]);
});
test('encryption failure preserves all persisted stores and reports a fixed error',async()=>{
  const e=setup(async()=>{throw Error(SECRET)}),errors=[],old=console.error;console.error=(...x)=>errors.push(x);
  try{await e.hook.saveCanvasState()}finally{console.error=old}
  assert.equal(e.writes.length,0);assert.equal(e.media.length,0);assert.equal(e.mirrors.length,0);
  assert.deepEqual(errors,[['Canvas save failed']]);assert.equal(e.notices.length,1);assert.doesNotMatch(JSON.stringify(e.notices),new RegExp(SECRET));
});
test('even a quota error before encryption cannot mirror plaintext',async()=>{
  const e=setup();e.bridge.isProjectMigrationLocked=async()=>{throw Object.assign(Error('quota '+SECRET),{name:'QuotaExceededError'})};
  const old=console.error;console.error=()=>{};try{await e.hook.saveCanvasState()}finally{console.error=old}
  assert.equal(e.writes.length,0);assert.equal(e.mirrors.length,0);assert.equal(e.notices.length,1);
});
test('a pending close is fenced, then a successful normal save permits an encrypted close snapshot',async()=>{
  const gate=task();let calls=0;const reference='custom-config-v1:'+crypto.randomUUID();
  const e=setup(async()=>{calls++;await gate.promise;return {ok:true,reference}}),unloadWrites=[];let aborts=0;
  global.localStorage={setItem:(k,v)=>unloadWrites.push({k,v})};
  const controllers={current:new Map([['test',{abort(){aborts++}}]])};
  const handler=createCanvasUnloadHandler({...e.deps,...e.hook,abortControllersRef:controllers});
  const event={type:'beforeunload',preventDefault(){this.prevented=true}};handler(event);
  assert.equal(event.prevented,true);assert.equal(event.returnValue,false);assert.equal(unloadWrites.length,0);assert.equal(aborts,0);
  await tick();assert.equal(calls,1);gate.release();await tick();await tick();
  const completed={type:'beforeunload',preventDefault(){this.prevented=true}};handler(completed);
  assert.equal(completed.prevented,undefined);assert.equal(aborts,1);assert.equal(unloadWrites.length,1);
  assert.doesNotMatch(unloadWrites[0].v,new RegExp(SECRET));assert.equal(JSON.parse(unloadWrites[0].v).nodes[0].data.config[marker],reference);
});
test('pagehide cannot cancel but never writes an unprepared config',async()=>{
  const e=setup(),writes=[];let saveCalls=0;
  global.localStorage={setItem:(...x)=>writes.push(x)};
  createCanvasUnloadHandler({...e.deps,...e.hook,saveCanvasState:async()=>saveCalls++,abortControllersRef:{current:new Map()}})({type:'pagehide'});
  await tick();assert.equal(writes.length,0);assert.equal(saveCalls,0);
});
test('encrypted preparation is not a committed project and cannot permit early close',async()=>{
  const e=setup(),gate=task();let started=false,aborts=0;const mirrors=[];
  await e.hook.prepareCanvasConfigs();
  assert.equal(e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]}),null);
  e.deps.localforageModule.default.setItem=async(key,value)=>{started=true;await gate.promise;e.writes.push({key,value:clone(value)})};
  const save=e.hook.saveCanvasState();await tick();assert(started);
  global.localStorage={setItem:(k,v)=>mirrors.push(v)};
  const handler=createCanvasUnloadHandler({...e.deps,...e.hook,abortControllersRef:{current:new Map([['qa',{abort(){aborts++}}]])}});
  const closing={type:'beforeunload',preventDefault(){this.prevented=true}};handler(closing);
  assert.equal(closing.prevented,true);assert.equal(aborts,0);assert.equal(mirrors.length,0);
  gate.release();await save;await tick();await tick();
  const ready=e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]});
  assert(ready);safeWrites([ready]);assert(e.writes.length>=1);
});
test('in-place config edits cannot reuse the commit receipt for an older encrypted reference',async()=>{
  const e=setup();await e.hook.saveCanvasState();
  e.deps.nodesRef.current[0].data.config.extra='new manual value';
  await e.hook.prepareCanvasConfigs();
  assert.equal(e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]}),null);
  await e.hook.saveCanvasState();
  const ready=e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]});
  assert(ready);assert.equal(e.vault.get(ready.nodes[0].data.config[marker]).extra,'new manual value');
});
test('a failed primary write cannot turn an encrypted config into a successful close receipt',async()=>{
  const e=setup();await e.hook.prepareCanvasConfigs();
  e.deps.localforageModule.default.setItem=async()=>{throw Error(SECRET)};
  const old=console.error;console.error=()=>{};try{await e.hook.saveCanvasState()}finally{console.error=old}
  assert.equal(e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]}),null);
  assert.equal(e.writes.length,0);assert.equal(e.notices.length,1);
});
test('layout-only ReactFlow array replacements do not trap a saved manual config',async()=>{
  const e=setup();await e.hook.saveCanvasState();
  e.deps.nodesRef.current=clone(e.deps.nodesRef.current);e.deps.nodesRef.current[0].position={x:25,y:40};
  e.deps.edgesRef.current=[];await e.hook.prepareCanvasConfigs();
  assert(e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]}));
});
test('canvases without custom configs retain the existing best-effort close mirror',async()=>{
  const e=setup();e.deps.nodesRef.current=[{id:'plain',type:'textNode',data:{text:'fixture'}}];
  const snapshot=e.hook.getProtectedCanvasSnapshot(e.deps.projectIdRef.current,{nodes:e.deps.nodesRef.current,edges:[]});
  assert.deepEqual(snapshot.nodes,e.deps.nodesRef.current);assert.equal(e.writes.length,0);
});
test('an unavailable best-effort mirror does not trap a close after encryption is ready',async()=>{
  const e=setup();await e.hook.saveCanvasState();let aborts=0;
  global.localStorage={setItem(){throw Object.assign(Error('quota'),{name:'QuotaExceededError'})}};
  const event={type:'beforeunload',preventDefault(){this.prevented=true}};
  createCanvasUnloadHandler({...e.deps,...e.hook,abortControllersRef:{current:new Map([['test',{abort(){aborts++}}]])}})(event);
  assert.equal(event.prevented,undefined);assert.equal(aborts,1);assert.equal(e.writes.length,1);
});
test('two projects keep their captured configs when native calls complete out of order',async()=>{
  const gate=task();const e=setup(async value=>{if(value.version==='old')await gate.promise;return {ok:true,reference:'custom-config-v1:'+crypto.randomUUID()}});
  e.deps.nodesRef.current=state().nodes;e.deps.nodesRef.current[0].data.config={version:'old',key:SECRET};
  const a=e.deps.projectIdRef.current,first=e.hook.saveCanvasState();await tick();
  e.deps.projectIdRef.current='second-'+crypto.randomUUID();e.deps.nodesRef.current=state().nodes;
  await e.hook.saveCanvasState();gate.release();await first;
  assert.equal(e.writes.length,2);assert.equal(e.writes[1].key,'canvas-'+a);safeWrites(e.writes.map(x=>x.value));
});
async function load(input,bridge,fallback=false){
  const timers=[],nodes=[],writes=[],notices=[],ready=[];const oldTimer=global.setTimeout;
  global.setTimeout=fn=>{timers.push(fn);return 1};global.window={wanjuanDesktop:bridge};global.localStorage={getItem:()=>fallback?JSON.stringify(input):null};global.applyProjectMediaBindingsToNode=value=>value;delete global.chrome;
  const fit={current:false};const oldError=console.error;console.error=()=>{};
  try{
    useCanvasLoadEffect({GlobalTasks:[],LoadOnceRef:{current:false},abortControllersRef:{current:new Map()},canvasStateKeyPrefix:'canvas-',desktopCanvasMirrorPrefix:'mirror-',hydrateProjectAssetContainer:async x=>x,initialEmptyProject:false,localforageModule:{default:{getItem:async()=>fallback?null:input,setItem:async(...x)=>writes.push(x)}},onInitialEmptyProjectReady(){},onAssistantCanvasLoadState:(_id,v)=>ready.push(v),projectId:'fixture',projectIdRef:{current:'fixture'},resolveWanjuanPlayableTaskUrl:()=>'',setEdges(){},setNodes:v=>nodes.push(v),setShouldFitView(){},showToast:t=>notices.push(t),shouldFitViewRef:fit});
    await tick();await tick();for(const fn of timers)fn();
    return {fit,nodes,writes,notices,ready};
  }finally{global.setTimeout=oldTimer;console.error=oldError}
}
test('actual project load restores references only in memory and fails closed on missing records',async()=>{
  const e=setup();await e.hook.saveCanvasState();const encrypted=e.writes[0].value;
  const opened=await load(encrypted,e.bridge);assert.equal(opened.fit.current,true);assert.deepEqual(opened.nodes.at(-1)[0].data.config,state().nodes[0].data.config);assert.equal(opened.writes.length,0);
  const missing=await load(encrypted,{customConfigRestore:async()=>({ok:false})});assert.equal(missing.fit.current,false);assert.equal(missing.writes.length,0);assert(missing.notices.length);assert.doesNotMatch(JSON.stringify(missing.notices),new RegExp(SECRET));
});
test('legacy fallback loads unchanged without copying plaintext into another store',async()=>{
  const opened=await load(state(),{},true);assert.equal(opened.fit.current,true);assert.equal(opened.writes.length,0);assert.equal(opened.nodes.at(-1)[0].data.config.headers.Authorization,SECRET);
});
test('snapshot capture freezes config before asynchronous work and removes existing runtime/ghost fields',async()=>{
  const input=state();input.nodes[0].data.callback=()=>{};input.nodes.push({id:'ghost-target',data:{}});input.edges.push({id:'ghost-edge'});
  const saved=capture(input.nodes,input.edges,x=>x);input.nodes[0].data.config.headers.Authorization='edited';
  assert.equal(saved.nodes[0].data.config.headers.Authorization,SECRET);assert.equal(saved.nodes.length,1);assert.equal(saved.edges.length,0);assert.equal(saved.nodes[0].data.callback,undefined);
});
test('close warning is translated in both additional interface languages and preload cleanup waits for departure',async()=>{
  const packs=require('../src/renderer/lib/i18n-deep-packs.json'),key='配置正在安全保存，请稍后再关闭窗口；若未完成，请检查本机安全存储。';
  for(const locale of ['zh-TW','en-US'])assert(packs[locale][key]);
  const preload=fs.readFileSync(require.resolve('../electron/preload/desktop-patches.cjs'),'utf8');
  assert.doesNotMatch(preload,/addEventListener\("beforeunload"/);assert.match(preload,/addEventListener\("pagehide"/);
});
(async()=>{try{for(const [name,fn] of tests){await fn();console.log('PASS '+name)}console.log(`PASS_CANVAS_CUSTOM_CONFIG_PERSISTENCE ${tests.length}`)}finally{Module._load=oldLoad;if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts'];for(const k of ['window','chrome','localStorage','prepareProjectMediaStateForPersistence','collectProjectFileReferences','applyProjectMediaBindingsToNode'])delete global[k]}})().catch(e=>{console.error(e);process.exitCode=1});
