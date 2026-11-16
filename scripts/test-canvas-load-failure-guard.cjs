const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const originalTs=require.extensions['.ts'],originalLoad=Module._load;
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
Module._load=function(name,parent,...rest){
  if(parent?.filename?.endsWith('useCanvasLoadEffect.ts')) {
    if(name==='react')return {useEffect:fn=>fn()};
    if(name.includes('canvas-node-registry'))return {WANJUAN_STARTER_EDGES:[],wanjuanIsDefaultStarterCanvas:()=>false};
    if(name.includes('audio-nodes'))return {WanJuanTtsMusicTaskAudioUrl:()=>''};
    if(name.includes('resource'))return {wanjuanClearProjectAssetBindingsFromData:value=>value};
    if(name.includes('tianji-portrait'))return {wanjuanResetTianjiPortraitBindingForImage:value=>value};
    if(name.includes('video-task'))return {wanjuanNewestNodeTask:()=>null,wanjuanTaskUsesSeedanceSlot:()=>false,wanjuanVideoTaskCanAttachToNode:()=>true,wanjuanVideoTaskMatchesNodeByPrompt:()=>false};
  }
  if(parent?.filename?.endsWith('useSaveCanvasState.ts')&&name==='react')return {useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:()=>{}};
  return originalLoad.apply(this,[name,parent,...rest]);
};
const {useCanvasLoadEffect}=require('../src/renderer/hooks/useCanvasLoadEffect.ts');
const {useSaveCanvasState}=require('../src/renderer/hooks/useSaveCanvasState.ts');Module._load=originalLoad;
const savedGlobals={window:global.window,localStorage:global.localStorage,setTimeout:global.setTimeout,chrome:global.chrome,token:global.__wanjuanCanvasLoadToken,error:console.error};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{try{
  const timers=[],messages=[],nodes=[],ready=[],writes=[],errors=[];global.setTimeout=fn=>{timers.push(fn);return 1};global.window={wanjuanDesktop:{}};global.localStorage={getItem:()=>null};delete global.chrome;console.error=(...args)=>errors.push(args);
  const fit={current:false},loaded={current:false};
  const base={GlobalTasks:[],LoadOnceRef:loaded,abortControllersRef:{current:new Map()},canvasStateKeyPrefix:'canvas-',desktopCanvasMirrorPrefix:'mirror-',hydrateProjectAssetContainer:async n=>n,initialEmptyProject:false,onInitialEmptyProjectReady:()=>{},onAssistantCanvasLoadState:(_id,value)=>ready.push(value),projectId:'fixture',projectIdRef:{current:'fixture'},resolveWanjuanPlayableTaskUrl:()=>'',setEdges:()=>{},setNodes:value=>nodes.push(value),setShouldFitView:()=>{},shouldFitViewRef:fit,showToast:text=>messages.push(text)};
  useCanvasLoadEffect({...base,localforageModule:{default:{getItem:async()=>{throw Error('SYNTHETIC_PRIVATE')},setItem:async()=>writes.push('write')}}});
  await settle();for(const fn of timers.splice(0))fn();assert.equal(fit.current,false,'failed load must leave auto-save disabled');assert.equal(loaded.current,false);assert.match(messages[0],/自动保存已暂停/);assert.deepEqual(ready,[false]);
  const save=useSaveCanvasState({WanJuanStripRuntimeNodeData:x=>x,canvasStateKeyPrefix:'canvas-',desktopCanvasMirrorPrefix:'mirror-',edgesRef:{current:[]},externalizeProjectCanvasState:async x=>x,historyIndexRef:{current:0},isRestoringRef:{current:true},localforageModule:{default:{setItem:async()=>writes.push('write')}},nodesRef:{current:[]},projectIdRef:base.projectIdRef,setHistory:()=>{},setHistoryIndex:()=>{},shouldFitViewRef:fit,showToast:()=>{}}).saveCanvasState;
  await save();assert.deepEqual(writes,[],'failed load cannot overwrite saved project');
  let rejectOld;const old=new Promise((_,reject)=>{rejectOld=reject});
  useCanvasLoadEffect({...base,projectId:'older',localforageModule:{default:{getItem:()=>old}}});
  useCanvasLoadEffect({...base,projectId:'newer',localforageModule:{default:{getItem:async()=>null}}});await settle();
  for(const fn of timers.splice(0))fn();assert.equal(fit.current,true,'newer successful load enables saves');const lastNodes=nodes.length,lastMessages=messages.length;
  rejectOld(Error('SYNTHETIC_PRIVATE'));await settle();for(const fn of timers.splice(0))fn();
  assert.equal(fit.current,true,'stale load must not disable newer project');assert.equal(nodes.length,lastNodes);assert.equal(messages.length,lastMessages);
  assert.deepEqual(errors.filter(args=>args[0]==='Failed to load canvas state'),[['Failed to load canvas state'],['Failed to load canvas state']],'load exceptions are not logged');
  assert.doesNotMatch(JSON.stringify(errors),/SYNTHETIC_PRIVATE/);
  console.log('PASS_CANVAS_LOAD_FAILURE_SAVE_GUARD');
}finally{
  global.window=savedGlobals.window;global.localStorage=savedGlobals.localStorage;global.setTimeout=savedGlobals.setTimeout;global.chrome=savedGlobals.chrome;global.__wanjuanCanvasLoadToken=savedGlobals.token;console.error=savedGlobals.error;
  if(originalTs)require.extensions['.ts']=originalTs;else delete require.extensions['.ts'];
}})().catch(error=>{console.error(error);process.exitCode=1});
