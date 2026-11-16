const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createAutoDownloadSyncGuard} = require('../electron/preload/auto-download-sync.cjs');
function testCanvasGenerationMarkers() {
  const ts=require('typescript');
  const previous=require.extensions['.ts'];
  require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
  try {
    const {useCanvasNodes}=require('../src/renderer/hooks/useCanvasNodes.ts');
    const node=(id,type,loading)=>({id,type,data:{loading,label:'A running fox'},domAttributes:{'data-user':'keep'}});
    const original=[node('image','promptNode',true),node('video','videoNode',true),node('audio','audioNode',true),node('idle','promptNode',false),{...node('spoof','promptNode',false),domAttributes:{'data-wanjuan-generating':'true','data-user':'keep'}}];
    const before=JSON.stringify(original);
    const output=useCanvasNodes({nodes:original,useMemo:fn=>fn(),WanJuanComputeNodeRenderMode:()=> 'full',wanjuanSelectedReferenceSourcesByTarget:new Map(),wanjuanViewport:{zoom:1},wanjuanViewportSize:{width:800,height:600}}).wanjuanCanvasNodes;
    for(const item of output.slice(0,3)) assert.equal(item.domAttributes['data-wanjuan-generating'],'true',`${item.type} uses its actual loading state`);
    assert.notEqual(output[3].domAttributes['data-wanjuan-generating'],'true','ordinary prompt text is not a loading signal');
    assert.notEqual(output[4].domAttributes['data-wanjuan-generating'],'true','a stale saved attribute cannot spoof the runtime state');assert.equal(output[4].domAttributes['data-user'],'keep');
    assert.equal(output[0].domAttributes['data-user'],'keep');assert.equal(JSON.stringify(original),before,'renderer markers never change project nodes');
  } finally {if(previous)require.extensions['.ts']=previous;else delete require.extensions['.ts'];}
}
function testManualFileReplacementDisarmsFinishedNode() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const start=source.indexOf('  const disarmFinishedNodeForManualFile = (event) => {');
  const end=source.indexOf('\n  const manualMediaFingerprint',start);
  assert.ok(start>=0&&end>start);
  class Input { constructor(node,files,type='file'){this.node=node;this.files=files;this.type=type} closest(){return this.node} }
  const ctx={autoDownloadEnabled:true,HTMLInputElement:Input};
  const disarmStart=source.indexOf('  const disarmFinishedNodeForManualMedia = (node) => {');
  const disarmEnd=source.indexOf('\n  const disarmFinishedNodeForManualFile',disarmStart);
  assert.ok(disarmStart>=0&&disarmEnd>disarmStart);
  ctx.disarmFinishedNodeForManualMedia=vm.runInNewContext(`(${source.slice(disarmStart,disarmEnd).replace('  const disarmFinishedNodeForManualMedia = ','').replace(/;\s*$/,'')})`,ctx);
  const run=vm.runInNewContext(`(${source.slice(start,end).replace('  const disarmFinishedNodeForManualFile = ','').replace(/;\s*$/,'')})`,ctx);
  for(const type of ['change','drop','paste']) {
    const node={dataset:{wanjuanWasGenerating:'true'}},target=new Input(node,[{}]);
    run(type==='change'?{type,target}:{type,target,[type==='drop'?'dataTransfer':'clipboardData']:{files:[{}]}});
    assert.equal(node.dataset.wanjuanWasGenerating,undefined,`${type}: completed node no longer authorizes a manual replacement`);
    assert.equal(node.dataset.wanjuanManualBaselinePending,'true',`${type}: later media is tracked as a manual baseline`);
  }
  for(const event of [
    {type:'change',target:new Input(null,[])},
    {type:'change',target:new Input(null,[{}],'text')},
    {type:'drop',target:{closest:()=>null},dataTransfer:{files:[{}]}},
  ]) assert.doesNotThrow(()=>run(event));
  const active={dataset:{wanjuanWasGenerating:'true',wanjuanGenerating:'true'}};
  run({type:'change',target:new Input(active,[{}])});
  assert.equal(active.dataset.wanjuanWasGenerating,'true','an active run is not silently discarded');
  const disabled={dataset:{wanjuanWasGenerating:'true'}};ctx.autoDownloadEnabled=false;
  run({type:'change',target:new Input(disabled,[{}])});
  assert.equal(disabled.dataset.wanjuanWasGenerating,'true','disabled auto-download does not mutate node markers');
}
function testConnectedMediaReplacement() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const start=source.indexOf('  window.addEventListener("wanjuan:manual-media-replacement", (event) => {');
  const end=source.indexOf('\n\n  // Capture short-lived',start);assert.ok(start>=0&&end>start);
  const disarmStart=source.indexOf('  const disarmFinishedNodeForManualMedia = (node) => {');
  const disarmEnd=source.indexOf('\n  const disarmFinishedNodeForManualFile',disarmStart);
  const node=id=>({dataset:{wanjuanWasGenerating:'true'},getAttribute:key=>key==='data-id'?id:null});
  const a=node('qa-node'),b=node('other');let handler;
  const ctx={autoDownloadEnabled:true,autoDownloadManualFingerprints:new WeakMap(),document:{querySelectorAll:()=>[a,b]},window:{addEventListener:(name,fn)=>{assert.equal(name,'wanjuan:manual-media-replacement');handler=fn}}};
  ctx.disarmFinishedNodeForManualMedia=vm.runInNewContext(`(${source.slice(disarmStart,disarmEnd).replace('  const disarmFinishedNodeForManualMedia = ','').replace(/;\s*$/,'')})`,ctx);
  vm.runInNewContext(source.slice(start,end),ctx);handler({detail:{nodeId:'qa-node'}});
  assert.equal(a.dataset.wanjuanWasGenerating,undefined);assert.equal(a.dataset.wanjuanManualBaselinePending,'true');assert.equal(b.dataset.wanjuanWasGenerating,'true');
  const one=node('duplicate'),two=node('duplicate');ctx.document.querySelectorAll=()=>[one,two];handler({detail:{nodeId:'duplicate'}});
  assert.equal(one.dataset.wanjuanWasGenerating,'true');assert.equal(two.dataset.wanjuanWasGenerating,'true','duplicate IDs must not modify either node');
  const active=node('active');active.dataset.wanjuanGenerating='true';ctx.document.querySelectorAll=()=>[active];handler({detail:{nodeId:'active'}});
  assert.equal(active.dataset.wanjuanWasGenerating,'true','active runs are not silently discarded');
  const ts=require('typescript'),module={exports:{}},events=[];
  const emitter=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/renderer/lib/manual-media-replacement.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const emitterCtx={module,exports:module.exports,window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}};
  vm.runInNewContext(emitter,emitterCtx);module.exports.noteManualMediaReplacement('qa-node');module.exports.noteManualMediaReplacement('');
  assert.equal(events.length,1);assert.equal(events[0].type,'wanjuan:manual-media-replacement');assert.deepEqual(Object.keys(events[0].detail),['nodeId']);assert.equal(events[0].detail.nodeId,'qa-node');
  const fpStart=source.indexOf('  const manualMediaFingerprint = (value) => {'),fpEnd=source.indexOf('\n  for (const type of ["change", "drop", "paste"])',fpStart);
  const preloadFingerprint=vm.runInNewContext(`(${source.slice(fpStart,fpEnd).replace('  const manualMediaFingerprint = ','').replace(/;\s*$/,'')})`);
  for(const value of ['https://synthetic.invalid/private?token=SECRET','blob:https://synthetic.invalid/id','data:image/png;base64,'+'a'.repeat(10000),'短地址']) assert.equal(module.exports.manualMediaFingerprint(value),preloadFingerprint(value),'renderer and preload use the same sampled identity');
  const privateUrl='https://synthetic.invalid/private-media.mp4?token=PRIVATE_TOKEN';
  module.exports.noteManualMediaReplacement('active',privateUrl);assert.deepEqual(Object.keys(events[1].detail),['nodeId','fingerprint']);assert.doesNotMatch(JSON.stringify(events[1].detail),/PRIVATE_TOKEN|synthetic\.invalid/);handler(events[1]);assert.ok(ctx.autoDownloadManualFingerprints.get(active).has(preloadFingerprint(privateUrl)));
  const scanStart=source.indexOf('  const scanGeneratedResultsForAutoDownload = () => {'),scanEnd=source.indexOf('\n\n  const queueAutoDownloadScan',scanStart);
  const scanSource=source.slice(scanStart,scanEnd).replace('  const scanGeneratedResultsForAutoDownload = ','').replace(/;\s*$/,'');
  const media={url:privateUrl,closest:()=>active},downloads=[],seen=new Set();
  Object.assign(ctx,{autoDownloadBaselineReady:true,autoDownloadSeenResults:seen,manualMediaFingerprint:preloadFingerprint,markGeneratingNodes(){},getAutoDownloadMediaElements:()=>[media],autoDownloadMediaElementFor:e=>e,autoDownloadUrlFor:e=>e.url,autoDownloadResultKey:(_e,_n,url)=>url,shouldAutoDownloadMedia:()=>true,autoDownloadGeneratedResult:async(_e,url)=>downloads.push(url),console});
  const scan=vm.runInNewContext(`(${scanSource})`,ctx);scan();assert.deepEqual(downloads,[],'a known manual replacement is not saved while generating');assert.ok(seen.has(privateUrl));
  media.url='https://synthetic.invalid/genuine-generated-output.mp4';scan();scan();assert.deepEqual(downloads,[media.url],'a distinct generated result is still saved exactly once');
  const otherNode=node('other-active');otherNode.dataset.wanjuanGenerating='true';ctx.document.querySelectorAll=()=>[active,otherNode];handler({detail:{nodeId:'active',fingerprint:preloadFingerprint('https://synthetic.invalid/shared.png')}});
  const otherMedia={url:'https://synthetic.invalid/shared.png',closest:()=>otherNode};ctx.getAutoDownloadMediaElements=()=>[otherMedia];scan();assert.deepEqual(downloads,[media.url,otherMedia.url],'manual input on one node does not suppress another node');
  for(const [file,marker] of [['audio-nodes.tsx','(data.audioUrl = connectedUrl)'],['video-extract-node.tsx','videoUrl: videoUrl,']]) {
    const body=fs.readFileSync(path.join(__dirname,'../src/renderer/components',file),'utf8'),at=body.indexOf(marker);
    assert.ok(at>0&&body.lastIndexOf('noteManualMediaReplacement(nodeId,',at)>at-180,`${file}: notify before replacing the connected input`);
  }
  for(const [file,needle,sourceName] of [['audio-nodes.tsx','let connectedNodes','sourceNodes'],['video-extract-node.tsx','let sourceNodes = Array.isArray(sourceData)','sourceData']]) {
    const filename=path.join(__dirname,'../src/renderer/components',file),body=fs.readFileSync(filename,'utf8');
    const tree=ts.createSourceFile(filename,body,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let effect;
    const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.arguments[0]?.getText(tree).includes(needle))effect=n.arguments[0];ts.forEachChild(n,visit)};visit(tree);
    assert.ok(effect,`${file}: real connection effect found`);
    const target=node('qa-node'),order=[],privateUrl='https://synthetic.invalid/private-media.mp4?token=PRIVATE_TOKEN';
    ctx.document.querySelectorAll=()=>[target];
    emitterCtx.window.dispatchEvent=event=>{order.push('notify');assert.deepEqual(Object.keys(event.detail),['nodeId','fingerprint']);assert.doesNotMatch(JSON.stringify(event.detail),/PRIVATE_TOKEN|synthetic\.invalid/);handler(event)};
    const effectCtx={URL,nodeId:'qa-node',audioFile:null,uploadedFile:null,lastUrlRef:{current:''},lastVideoUrlRef:{current:''},data:{},setPrompt(){},noteManualMediaReplacement:module.exports.noteManualMediaReplacement,
      updateNodeData:(_id,patch)=>{order.push('update');assert.ok(patch.audioUrl===privateUrl||patch.videoUrl===privateUrl)}};
    effectCtx[sourceName]=[{data:{videoUrl:privateUrl}}];
    const compiled=ts.transpileModule(`const effect = ${effect.getText(tree)}; effect();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(compiled,effectCtx);
    assert.deepEqual(order,['notify','update'],`${file}: the actual connected-input effect disarms before updating`);
    assert.equal(target.dataset.wanjuanWasGenerating,undefined);assert.equal(target.dataset.wanjuanManualBaselinePending,'true');
    const activeTarget=node('qa-node');activeTarget.dataset.wanjuanGenerating='true';ctx.document.querySelectorAll=()=>[activeTarget];order.length=0;effectCtx.lastUrlRef.current='';effectCtx.lastVideoUrlRef.current='';
    vm.runInNewContext(compiled,{...effectCtx});assert.deepEqual(order,['notify','update']);assert.ok(ctx.autoDownloadManualFingerprints.get(activeTarget).has(preloadFingerprint(privateUrl)),`${file}: actual connection effect tags active manual input`);assert.equal(activeTarget.dataset.wanjuanWasGenerating,'true');
  }
}
function testAssistantToPreloadWiring() {
  // Exercise the real assistant callback and actual preload event handler
  // together. All storage, observer effects and media are synthetic.
  const preload=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const start=preload.indexOf('  window.addEventListener("wanjuan:auto-download-setting-changed", (event) => {');
  const end=preload.indexOf('\n\n  const updateAutoDownloadControls',start);
  assert.ok(start>=0&&end>start,'actual preload listener exists');
  const publishStart=preload.indexOf('  const publishAutoDownloadListenerState = () => {');
  const publishEnd=preload.indexOf('\n\n  const isAutoDownloadEnabledValue',publishStart);
  assert.ok(publishStart>=0&&publishEnd>publishStart);
  const publish=preload.slice(publishStart,publishEnd).replace('  const publishAutoDownloadListenerState = ','').replace(/;\s*$/,'');
  const root={dataset:{wanjuanAutoDownloadListener:'off'}},seen=new Set(['old-result']);let listener,seeded=0,scans=0,installations=0,disconnects=0;
  const preloadContext={autoDownloadEnabled:false,autoDownloadBaselineReady:false,autoDownloadObserverInstalled:false,autoDownloadObserverRoot:null,autoDownloadSeenResults:seen,autoDownloadManualFingerprints:new WeakMap(),
    autoDownloadSyncGuard:createAutoDownloadSyncGuard(),document:{documentElement:root},
    window:{addEventListener:(name,handler)=>{assert.equal(name,'wanjuan:auto-download-setting-changed');listener=handler}},
    isAutoDownloadEnabledValue:value=>value===true||value==='true'||value===1,updateAutoDownloadControls(){},
    seedAutoDownloadBaseline(){seeded++;seen.add('old-result');preloadContext.autoDownloadBaselineReady=true},
    installAutoDownloadObserver(){installations++;preloadContext.autoDownloadObserverInstalled=true;preloadContext.autoDownloadObserverRoot={isConnected:true}},
    disconnectAutoDownloadObserver(){disconnects++;preloadContext.autoDownloadObserverInstalled=false;preloadContext.autoDownloadObserverRoot=null},
    queueAutoDownloadScan(){scans++},ipcRenderer:{invoke(){throw Error('UNEXPECTED_IPC_OR_GENERATION')}}};
  preloadContext.publishAutoDownloadListenerState=vm.runInNewContext(`(${publish})`,preloadContext);
  vm.runInNewContext(preload.slice(start,end),preloadContext);assert.equal(typeof listener,'function');
  const bundle=fs.readFileSync(path.join(__dirname,'../src/renderer/bundle/index.js'),'utf8');
  const callback=require('./source-function.cjs')(bundle,'applyAssistantPreference');
  const stored={autoDownloadGeneratedResults:false,manualApi:'SYNTHETIC_MANUAL_CONFIG'},events=[];
  const context={isReady:true,settingsHydratedRef:{current:true},nonModelSettingsSaveTimerRef:{current:null},autoDownloadGeneratedResults:false,document:{documentElement:root},
    chrome:{storage:{local:{set(items,cb){Object.assign(stored,items);cb?.()},get(_keys,cb){cb({...stored})}}}},
    setAutoDownloadGeneratedResults(value){context.autoDownloadGeneratedResults=value},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},
    window:{dispatchEvent(event){events.push(event.type);listener(event);return true}}};
  const setPreference=vm.runInNewContext(`(${callback})`,context);
  assert.equal(setPreference('autoDownload',true),true);assert.equal(stored.autoDownloadGeneratedResults,true);assert.equal(root.dataset.wanjuanAutoDownloadListener,'on');assert.equal(root.dataset.wanjuanAutoDownloadPersisted,'on');
  assert.equal(setPreference('autoDownload',false),true);assert.equal(stored.autoDownloadGeneratedResults,false);assert.equal(root.dataset.wanjuanAutoDownloadListener,'off');assert.equal(root.dataset.wanjuanAutoDownloadPersisted,'off');
  assert.deepEqual(events,['wanjuan:auto-download-setting-changed','wanjuan:auto-download-setting-changed']);assert.equal(seeded,1);assert.equal(installations,1);assert.equal(disconnects,1);assert.equal(scans,1);assert.ok(seen.has('old-result'));assert.equal(stored.manualApi,'SYNTHETIC_MANUAL_CONFIG');
}
const guard = createAutoDownloadSyncGuard();
const stale = guard.beginHydrationRead();
guard.localChange(true);
assert.equal(guard.acceptHydrationRead(stale,false),false,'an in-flight old read cannot revert the latest user setting');
assert.equal(guard.acceptHydrationRead(guard.beginHydrationRead(),false),false,'a read before persistence catches up cannot revert the setting');
assert.equal(guard.acceptHydrationRead(guard.beginHydrationRead(),true),true,'the persisted setting clears the pending guard');
assert.equal(guard.acceptHydrationRead(guard.beginHydrationRead(),false),true,'later independent storage changes can be observed');
const nextStale = guard.beginHydrationRead();
guard.localChange(true); guard.localChange(false);
assert.equal(guard.acceptHydrationRead(nextStale,true),false,'rapid toggles invalidate older reads');
assert.equal(guard.acceptHydrationRead(guard.beginHydrationRead(),true),false,'the most recent choice wins while persistence catches up');
assert.equal(guard.acceptHydrationRead(guard.beginHydrationRead(),false),true);
const oldHydration = guard.beginHydrationRead(), newHydration = guard.beginHydrationRead();
assert.equal(guard.acceptHydrationRead(newHydration,false),true);
assert.equal(guard.acceptHydrationRead(oldHydration,true),false,'older read completing after a newer accepted read is rejected');
const downloadRevision = guard.beginRead();
assert.equal(guard.isCurrentEnabled(downloadRevision, true), true, 'a live enabled listener can proceed before storage catches up');
assert.equal(guard.isCurrentEnabled(downloadRevision, false), false, 'a disabled listener cannot start a download');
guard.localChange(false);
guard.localChange(true);
assert.equal(guard.isCurrentEnabled(downloadRevision, true), false, 'off/on invalidates work queued under the earlier setting');
assert.equal(guard.isCurrentEnabled(guard.beginRead(), true), true, 'new work can start under the latest setting');
function testObserverInstallationFailure() {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload/desktop-patches.cjs'), 'utf8');
  const start = source.indexOf('  const installAutoDownloadObserver = () => {');
  const end = source.indexOf('\n\n  const disconnectAutoDownloadObserver', start);
  assert.ok(start >= 0 && end > start, 'actual observer installation function exists');
  const definition = source.slice(start,end).replace('  const installAutoDownloadObserver = ', '').replace(/;\s*$/, '');
  const publishStart=source.indexOf('  const publishAutoDownloadListenerState = () => {');
  const publishEnd=source.indexOf('\n\n  const isAutoDownloadEnabledValue',publishStart);
  assert.ok(publishStart >= 0 && publishEnd > publishStart, 'actual listener acknowledgement exists');
  const publishDefinition=source.slice(publishStart,publishEnd).replace('  const publishAutoDownloadListenerState = ', '').replace(/;\s*$/, '');
  const disconnectStart=source.indexOf('  const disconnectAutoDownloadObserver = () => {');
  const disconnectEnd=source.indexOf('\n\n  // A React canvas may be replaced',disconnectStart);
  const repairStart=source.indexOf('  const repairDetachedAutoDownloadObserver = () => {');
  const repairEnd=source.indexOf('\n\n  const setAutoDownloadEnabled',repairStart);
  assert.ok(disconnectStart >= 0 && disconnectEnd > disconnectStart && repairStart >= 0 && repairEnd > repairStart);
  const disconnectDefinition=source.slice(disconnectStart,disconnectEnd).replace('  const disconnectAutoDownloadObserver = ', '').replace(/;\s*$/, '');
  const repairDefinition=source.slice(repairStart,repairEnd).replace('  const repairDetachedAutoDownloadObserver = ', '').replace(/;\s*$/, '');
  let phase='constructor', disconnected=0, queued=0,marked=0,markThrows=false,mutationMarks=0,callback,observeOptions;const warnings=[],seen=new Set(['synthetic-existing-result']);let currentRoot={isConnected:true};
  class SyntheticObserver {
    constructor(fn) {if(phase==='constructor')throw Error('synthetic constructor error');callback=fn;}
    observe(root,options) {if(phase==='observe')throw Error('synthetic observe error');observeOptions=options;}
    disconnect() {disconnected++;}
  }
  const context={autoDownloadEnabled:true,autoDownloadBaselineReady:true,autoDownloadSeenResults:seen,seedAutoDownloadBaseline:()=>{throw Error('rebind must not reset the dedup baseline')},markGeneratingNodes:()=>{if(markThrows)throw Error('SYNTHETIC_PRIVATE_MARK_ERROR');marked++},markGeneratingNodesInMutations:()=>{mutationMarks++},autoDownloadObserverInstalled:false,autoDownloadObserver:null,autoDownloadObserverRoot:null,autoDownloadScanTimer:0,MutationObserver:SyntheticObserver,queueAutoDownloadScan:()=>{queued++},window:{clearTimeout:()=>{}},console:{warn:(...args)=>warnings.push(args)},document:{querySelector:()=>currentRoot,body:{isConnected:true},documentElement:{dataset:{wanjuanAutoDownloadListener:'on'}}}};
  context.publishAutoDownloadListenerState=vm.runInNewContext(`(${publishDefinition})`,context);
  const install=vm.runInNewContext(`(${definition})`,context);
  context.installAutoDownloadObserver=install;context.disconnectAutoDownloadObserver=vm.runInNewContext(`(${disconnectDefinition})`,context);
  const repair=vm.runInNewContext(`(${repairDefinition})`,context);
  assert.throws(install,/synthetic constructor/);assert.equal(context.autoDownloadObserverInstalled,false);assert.equal(context.autoDownloadObserver,null);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown');
  phase='observe';assert.throws(install,/synthetic observe/);assert.equal(context.autoDownloadObserverInstalled,false);assert.equal(context.autoDownloadObserver,null);assert.equal(disconnected,1);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown');
  phase='success';install();assert.equal(context.autoDownloadObserverInstalled,true);assert.ok(context.autoDownloadObserver);assert.equal(observeOptions.characterData,true);assert.deepEqual(Array.from(observeOptions.attributeFilter),['src','data-wanjuan-generating']);assert.equal(observeOptions.attributeOldValue,true);callback([]);assert.equal(mutationMarks,1);assert.equal(queued,1);queued=0;context.publishAutoDownloadListenerState();assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'on');assert.equal(disconnected,1);
  currentRoot.isConnected=false;context.publishAutoDownloadListenerState();assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown','detached root is not reported active');
  currentRoot={isConnected:true};repair();assert.equal(context.autoDownloadObserverRoot,currentRoot);assert.equal(context.autoDownloadObserverInstalled,true);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'on');assert.equal(disconnected,2);assert.equal(marked,1,'rebind must mark currently generating nodes before the delayed scan');assert.equal(queued,1);assert.equal(context.autoDownloadSeenResults,seen);assert.ok(seen.has('synthetic-existing-result'));
  currentRoot.isConnected=false;phase='observe';currentRoot={isConnected:true};repair();assert.equal(context.autoDownloadObserverInstalled,false);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown');assert.equal(queued,1);assert.deepEqual(warnings.map(args=>args.length),[1]);
  phase='success';install();context.publishAutoDownloadListenerState();assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'on','an explicit retry can recover');
  currentRoot.isConnected=false;currentRoot={isConnected:true};markThrows=true;repair();assert.equal(context.autoDownloadObserverInstalled,false);assert.equal(context.autoDownloadObserverRoot,null);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown');assert.equal(queued,1);assert.equal(JSON.stringify(warnings).includes('SYNTHETIC_PRIVATE_MARK_ERROR'),false,'mark failure is not logged verbatim');
  markThrows=false;install();context.publishAutoDownloadListenerState();context.markGeneratingNodesInMutations=()=>{throw Error('SYNTHETIC_PRIVATE_MUTATION_ERROR')};callback([]);
  assert.equal(context.autoDownloadObserverInstalled,false);assert.equal(context.document.documentElement.dataset.wanjuanAutoDownloadListener,'unknown');assert.equal(JSON.stringify(warnings).includes('SYNTHETIC_PRIVATE_MUTATION_ERROR'),false,'mutation failure is not logged verbatim');
}
function testFastMutationMarking() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const start=source.indexOf('  const markGeneratingNodesInMutations = (mutations) => {');
  const end=source.indexOf('\n\n  const autoDownloadMediaElementFor',start);
  assert.ok(start>=0&&end>start);
  const definition=source.slice(start,end).replace('  const markGeneratingNodesInMutations = ', '').replace(/;\s*$/, '');
  let unrelatedScans=0;
  const active={nodeType:1,textContent:'A running fox',dataset:{},getAttribute:name=>name==='data-wanjuan-generating'?'true':null,closest(){return this},querySelectorAll(){return []}};
  const text={nodeType:3,parentElement:{closest:()=>active,querySelectorAll:()=>[]}};
  const flow={nodeType:1,closest:()=>null,querySelectorAll:()=>{unrelatedScans++;return []}};
  const wrapper={nodeType:1,closest:()=>null,querySelectorAll:()=>[active]};
  const run=vm.runInNewContext(`(${definition})`,{});
  run([{target:text,addedNodes:[]}]);assert.equal(active.dataset.wanjuanWasGenerating,'true','active marker identifies the owner before the delayed scan');
  delete active.dataset.wanjuanWasGenerating;run([{target:flow,addedNodes:[wrapper]}]);assert.equal(active.dataset.wanjuanWasGenerating,'true','newly inserted subtree is inspected');
  const idle={...active,dataset:{},getAttribute:()=>null,closest(){return this}};
  run([{target:idle,addedNodes:[]}]);assert.equal(idle.dataset.wanjuanWasGenerating,undefined,'ordinary text cannot make an idle node look active');
  run([{type:'attributes',attributeName:'data-wanjuan-generating',oldValue:'true',target:idle,addedNodes:[]}]);assert.equal(idle.dataset.wanjuanWasGenerating,'true','an observed short-lived active state remains detectable after it ends');
  assert.equal(unrelatedScans,0,'a changed canvas root does not trigger a whole-canvas scan');
}
function testManualReplacementBaselineAcrossRuns() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const extract=(startMarker,endMarker)=>{const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);assert.ok(start>=0&&end>start);return source.slice(start,end).replace(/^  const \w+ = /,'').replace(/;\s*$/,'')};
  const ctx={autoDownloadSeenResults:new Set(),autoDownloadMediaElementFor:e=>e,autoDownloadUrlFor:e=>e.url,autoDownloadResultKey:e=>e.url};
  ctx.baselineManualReplacement=vm.runInNewContext(`(${extract('  const baselineManualReplacement = (node, changedMedia) => {','\n\n  const seedAutoDownloadBaseline')})`,ctx);
  const mark=vm.runInNewContext(`(${extract('  const markGeneratingNodesInMutations = (mutations) => {','\n\n  const autoDownloadMediaElementFor')})`,ctx);
  const node={nodeType:1,dataset:{wanjuanManualBaselinePending:'true'},active:false,items:[],closest(){return this},getAttribute(){return this.active?'true':null},querySelectorAll(selector){return selector==='.react-flow__node'?[]:this.items}};
  const media={nodeType:1,tagName:'IMG',url:'manual-image',closest:()=>node,matches:()=>true,querySelectorAll:()=>[]};node.items=[media];
  mark([{target:node,addedNodes:[media]}]);
  assert.ok(ctx.autoDownloadSeenResults.has('manual-image'),'manual media is baselined as soon as it appears');
  node.active=true;mark([{type:'attributes',attributeName:'data-wanjuan-generating',oldValue:null,target:node,addedNodes:[]}]);
  assert.equal(node.dataset.wanjuanWasGenerating,'true');assert.equal(node.dataset.wanjuanManualBaselinePending,undefined);
  media.url='generated-image';mark([{type:'attributes',attributeName:'src',oldValue:'manual-image',target:media,addedNodes:[]}]);
  assert.equal(ctx.autoDownloadSeenResults.has('generated-image'),false,'a later generated result remains eligible');
  node.dataset.wanjuanManualBaselinePending='true';delete node.dataset.wanjuanWasGenerating;media.url='fast-generated-image';
  mark([{type:'attributes',attributeName:'data-wanjuan-generating',oldValue:null,target:node,addedNodes:[]},{type:'attributes',attributeName:'src',oldValue:'manual-image',target:media,addedNodes:[]}]);
  assert.equal(ctx.autoDownloadSeenResults.has('fast-generated-image'),false,'media changed in the same start batch is not baselined');
  node.active=false;node.dataset.wanjuanManualBaselinePending='true';delete node.dataset.wanjuanWasGenerating;media.url='short-generated-image';
  mark([{type:'attributes',attributeName:'data-wanjuan-generating',oldValue:'true',target:node,addedNodes:[media]}]);
  assert.equal(node.dataset.wanjuanWasGenerating,'true');assert.equal(ctx.autoDownloadSeenResults.has('short-generated-image'),false,'a start and finish in one mutation batch remains eligible');
}
async function testAutoDownloadPrivacyLogs() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const scanStart=source.indexOf('  const scanGeneratedResultsForAutoDownload = () => {');
  const scanEnd=source.indexOf('\n\n  const queueAutoDownloadScan',scanStart);
  const hydrateStart=source.indexOf('  const installAutoDownloadSettingRow = () => {');
  const hydrateEnd=source.indexOf('\n\n  document.addEventListener("dblclick"',hydrateStart);
  assert.ok(scanStart >= 0 && scanEnd > scanStart && hydrateStart >= 0 && hydrateEnd > hydrateStart);
  const scanDefinition=source.slice(scanStart,scanEnd).replace('  const scanGeneratedResultsForAutoDownload = ', '').replace(/;\s*$/, '');
  const hydrateDefinition=source.slice(hydrateStart,hydrateEnd).replace('  const installAutoDownloadSettingRow = ', '').replace(/;\s*$/, '');
  const privateError='SYNTHETIC_PRIVATE_URL_TOKEN_AND_PATH';const warnings=[];const seen=new Set();
  const element={closest:()=>({})};
  const context={autoDownloadEnabled:true,autoDownloadBaselineReady:true,autoDownloadSeenResults:seen,autoDownloadManualFingerprints:new WeakMap(),
    markGeneratingNodes:()=>{},getAutoDownloadMediaElements:()=>[element],autoDownloadMediaElementFor:()=>element,
    autoDownloadUrlFor:()=>`https://synthetic.invalid/${privateError}`,autoDownloadResultKey:()=> 'synthetic-result',
    shouldAutoDownloadMedia:()=>true,autoDownloadGeneratedResult:async()=>{throw Error(privateError)},
    hydrateAutoDownloadState:async()=>{throw Error(privateError)},console:{warn:(...args)=>warnings.push(args)}};
  vm.runInNewContext(`(${scanDefinition})`,context)();vm.runInNewContext(`(${hydrateDefinition})`,context)();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(seen.has('synthetic-result'),false,'failed saves remain retryable');
  assert.deepEqual(warnings.map(args=>args.length),[1,1],'only fixed warning labels are logged');
  assert.equal(JSON.stringify(warnings).includes(privateError),false,'logs omit synthetic URL, key and path');
}
async function testActualDownloadPipeline() {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload/desktop-patches.cjs'), 'utf8');
  const start = source.indexOf('  const autoDownloadGeneratedResult = async (element, url) => {');
  const end = source.indexOf('\n\n  const scanGeneratedResultsForAutoDownload', start);
  assert.ok(start >= 0 && end > start, 'actual preload download function exists');
  const definition = source.slice(start, end).replace('  const autoDownloadGeneratedResult = ', '').replace(/;\s*$/, '');
  const current = createAutoDownloadSyncGuard();
  const calls = [];
  let releaseStorage;
  let storage = async keys => {
    assert.deepEqual(Array.from(keys), ['downloadDirectory']);
    return {downloadDirectory: '/synthetic'};
  };
  let releaseBlob;
  let signalBlobStarted;
  const blobStarted = new Promise(resolve => { signalBlobStarted = resolve; });
  const context = {
    autoDownloadSyncGuard: current,
    autoDownloadEnabled: true,
    getDesktopStorageItems: keys => storage(keys),
    inferGeneratedResultMime: () => 'image/png',
    generatedResultFilename: () => 'synthetic.png',
    localPathFromFileUrl: () => '',
    dataUrlFromBlobUrl: () => new Promise(resolve => { releaseBlob = resolve; signalBlobStarted(); }),
    ipcRenderer: {invoke: async (...args) => { calls.push(args); return {ok:true}; }},
  };
  const run = vm.runInNewContext(`(${definition})`, context);
  current.localChange(true);
  await run({}, 'data:image/png;base64,AA==');
  assert.equal(calls.length, 1, 'current enabled state, not a stale persisted flag, controls saving');
  assert.equal(calls[0][0], 'wanjuan:save-download');
  storage = () => new Promise(resolve => { releaseStorage = resolve; });
  const waitingOnStorage = run({}, 'data:image/png;base64,AA==');
  context.autoDownloadEnabled = false; current.localChange(false);
  releaseStorage({downloadDirectory:'/synthetic'});
  await waitingOnStorage;
  assert.equal(calls.length, 1, 'turning off while reading settings cancels the pending save');
  context.autoDownloadEnabled = true; current.localChange(true);
  storage = async () => ({downloadDirectory:'/synthetic'});
  const waitingOnBlob = run({}, 'blob:synthetic');
  await blobStarted;
  context.autoDownloadEnabled = false; current.localChange(false);
  context.autoDownloadEnabled = true; current.localChange(true);
  releaseBlob({dataUrl:'data:image/png;base64,AA==',mime:'image/png'});
  await waitingOnBlob;
  assert.equal(calls.length, 1, 'off/on cancels a save awaiting blob conversion');
}
async function testActualHydration() {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload/desktop-patches.cjs'), 'utf8');
  const start = source.indexOf('  const hydrateAutoDownloadState = async () => {');
  const end = source.indexOf('\n\n  const installAutoDownloadSettingRow', start);
  assert.ok(start >= 0 && end > start, 'actual preload hydration function exists');
  const definition = source.slice(start, end).replace('  const hydrateAutoDownloadState = ', '').replace(/;\s*$/, '');
  const downloadStart = source.indexOf('  const autoDownloadGeneratedResult = async (element, url) => {');
  const downloadEnd = source.indexOf('\n\n  const scanGeneratedResultsForAutoDownload', downloadStart);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart, 'actual preload download function exists');
  const downloadDefinition = source.slice(downloadStart, downloadEnd).replace('  const autoDownloadGeneratedResult = ', '').replace(/;\s*$/, '');
  let stored = false, disconnected = 0, installed = 0, seeded = 0, queued = 0, published = 0, deferHydration = false;
  const pendingHydration = [];
  let releaseBlob, signalBlobStarted, saves = 0;
  const blobStarted = new Promise(resolve => { signalBlobStarted = resolve; });
  const current = createAutoDownloadSyncGuard();
  const context = {
    autoDownloadSyncGuard:current, AUTO_DOWNLOAD_KEY:'autoDownloadGeneratedResults',
    autoDownloadEnabled:true, autoDownloadObserverInstalled:true,
    getDesktopStorageItems:async keys => keys[0] === 'downloadDirectory' ? {downloadDirectory:'/synthetic'} : deferHydration ? new Promise(resolve => pendingHydration.push(resolve)) : {autoDownloadGeneratedResults:stored},
    isAutoDownloadEnabledValue:value => value === true,
    seedAutoDownloadBaseline:() => { seeded++; },
    installAutoDownloadObserver:() => { installed++; context.autoDownloadObserverInstalled = true; },
    disconnectAutoDownloadObserver:() => { disconnected++; context.autoDownloadObserverInstalled = false; },
    queueAutoDownloadScan:() => { queued++; }, updateAutoDownloadControls:() => {},
    publishAutoDownloadListenerState:() => { published++; },
    inferGeneratedResultMime:() => 'image/png', generatedResultFilename:() => 'synthetic.png',
    dataUrlFromBlobUrl:() => new Promise(resolve => {releaseBlob=resolve;signalBlobStarted();}),
    localPathFromFileUrl:() => '', ipcRenderer:{invoke:async () => {saves++;return {ok:true};}},
  };
  const run = vm.runInNewContext(`(${definition})`, context);
  const download = vm.runInNewContext(`(${downloadDefinition})`, context);
  current.localChange(true);
  await run();
  assert.equal(context.autoDownloadEnabled,true,'stale false must not undo a newer enable');
  assert.equal(disconnected,0,'stale false must not disconnect the listener');
  stored = true; await run();
  const oldDownload = current.beginRead();
  const pendingDownload = download({},'blob:synthetic');
  await blobStarted;
  stored = false; await run();
  assert.equal(context.autoDownloadEnabled,false);
  assert.equal(disconnected,1,'an accepted off state disconnects the listener');
  assert.equal(context.autoDownloadObserverInstalled,false);
  stored = true; await run();
  assert.equal(context.autoDownloadEnabled,true);
  assert.equal(current.isCurrentEnabled(oldDownload,context.autoDownloadEnabled),false,'accepted off/on invalidates work queued under the older state');
  releaseBlob({dataUrl:'data:image/png;base64,AA==',mime:'image/png'});
  await pendingDownload;
  assert.equal(saves,0,'a save awaiting blob conversion is cancelled by a stored off/on transition');
  assert.equal(installed,1);
  assert.equal(seeded,1);
  assert.equal(queued,1);
  assert.equal(published,3,'only accepted state changes are acknowledged');
  deferHydration=true;
  const older=run(), newer=run();
  assert.equal(pendingHydration.length,2);
  pendingHydration[1]({autoDownloadGeneratedResults:true});
  await newer;
  pendingHydration[0]({autoDownloadGeneratedResults:false});
  await older;
  assert.equal(context.autoDownloadEnabled,true,'an older read cannot revert a newer accepted state');
  assert.equal(context.autoDownloadObserverInstalled,true,'an older read cannot disconnect the current listener');
  assert.equal(disconnected,1);
  assert.equal(published,4);
}
async function testLargeCanvasDeduplication() {
  const source=fs.readFileSync(path.join(__dirname,'../electron/preload/desktop-patches.cjs'),'utf8');
  const extract=(startMarker,endMarker) => {
    const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);assert.ok(start>=0&&end>start);
    return source.slice(start,end).replace(/^  const \w+ = /,'').replace(/;\s*$/,'');
  };
  const baseline=extract('  const seedAutoDownloadBaseline = () => {','\n\n  const shouldAutoDownloadMedia');
  const scan=extract('  const scanGeneratedResultsForAutoDownload = () => {','\n\n  const queueAutoDownloadScan');
  const media=Array.from({length:2001},(_,i)=>({key:`old-${i}`,closest:()=>({dataset:{wanjuanWasGenerating:'true'}})}));
  const downloads=[], seen=new Set();
  const ctx={autoDownloadEnabled:true,autoDownloadBaselineReady:false,autoDownloadSeenResults:seen,autoDownloadManualFingerprints:new WeakMap(),
    markGeneratingNodes(){},getAutoDownloadMediaElements:()=>media,autoDownloadMediaElementFor:e=>e,
    autoDownloadUrlFor:e=>e.key,autoDownloadResultKey:e=>e.key,shouldAutoDownloadMedia:()=>true,
    autoDownloadGeneratedResult:async e=>{downloads.push(e.key)},console};
  vm.runInNewContext(`(${baseline})`,ctx)();const run=vm.runInNewContext(`(${scan})`,ctx);
  run();assert.deepEqual(downloads,[],'enabling does not download existing results');
  media.push({key:'new-result',closest:()=>({dataset:{wanjuanWasGenerating:'true'}})});run();run();
  assert.deepEqual(downloads,['new-result'],'over 2000 visible results cannot erase the dedup baseline');
  media.splice(0,2001);for(let i=0;i<2001;i++)seen.add(`stale-${i}`);run();
  assert.ok(seen.has('new-result'),'pruning preserves the current visible result');
  assert.ok(seen.size<=2001,'detached history is pruned instead of growing without bound');
  assert.deepEqual(downloads,['new-result'],'pruning does not re-download the visible result');
}
Promise.resolve().then(testCanvasGenerationMarkers).then(testManualFileReplacementDisarmsFinishedNode).then(testConnectedMediaReplacement).then(testAssistantToPreloadWiring).then(testObserverInstallationFailure).then(testFastMutationMarking).then(testManualReplacementBaselineAcrossRuns).then(testAutoDownloadPrivacyLogs).then(testActualDownloadPipeline).then(testActualHydration).then(testLargeCanvasDeduplication).then(() => console.log('PASS_ASSISTANT_AUTO_DOWNLOAD_LISTENER_SYNC')).catch(error => { console.error(error); process.exitCode = 1; });
