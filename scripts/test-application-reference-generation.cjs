// Actual shared service, input CAS, dispatcher, node factory and root generation
// handler. Synthetic media only; generation delegates never contact a provider.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {describeApplicationGeneration,assertApplicationGenerationTarget,prepareApplicationGenerationReferences}=require('../src/renderer/lib/application-generation.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationGenerationExecution}=require('../src/renderer/lib/application-generation-execution.ts');
const {beginApplicationTaskSubmission}=require('../src/renderer/lib/application-task-records.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {use_createNodeAt}=require('../src/renderer/hooks/use_createNodeAt.ts');
const {commitCanvasPlanBatch}=require('../src/renderer/hooks/useCanvasOperationPlans.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {createApplicationOperationWorkflowService}=require('../electron/main/application-operation-workflow.cjs');
const {createApplicationMediaBroker}=require('../electron/main/application-media-broker.cjs');
const {createApplicationMediaInput}=require('../electron/main/application-media-input.cjs');
const {persistProjectAsset}=require('../electron/main/assets/project-assets.cjs');
const {wanjuanCollectNodeReferenceMedia}=require('../src/renderer/lib/reference-media.ts');
const {applicationWorkflowStepCopy}=require('../src/renderer/lib/application-operation-copy.ts');
const {resolveApplicationTianjiPortraits}=require('../src/renderer/lib/application-tianji-portraits.ts');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/bundle/index.js'),'utf8'),tree=ts.createSourceFile('root.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions=[];
let runnerSource;
(function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='runAutomationGeneration')runnerSource=n.initializer.getText(tree);ts.forEachChild(n,visit);})(tree);assert(runnerSource);
(function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='executeApprovedGeneration')functions.push(n.initializer.getText(tree));ts.forEachChild(n,visit);})(tree);assert.equal(functions.length,1);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iXcAAAAASUVORK5CYII=','base64');
test('workflow step labels cover all three locales and cannot advertise malformed stages',()=>{
 for(const language of ['zh-CN','zh-TW','en-US'])for(const stage of ['import','generation'])assert(applicationWorkflowStepCopy(language,{stage,stepIndex:stage==='import'?1:2,totalSteps:2}));
 assert.match(applicationWorkflowStepCopy('zh-CN',{stage:'import',stepIndex:1,totalSteps:2}),/仅导入/);assert.match(applicationWorkflowStepCopy('zh-TW',{stage:'generation',stepIndex:2,totalSteps:2}),/單獨確認/);assert.match(applicationWorkflowStepCopy('en-US',{stage:'generation',stepIndex:2,totalSteps:2}),/separately/);
 for(const w of [null,{stage:'import',stepIndex:2,totalSteps:2},{stage:'generation',stepIndex:1,totalSteps:2},{stage:'unknown',stepIndex:1,totalSteps:2},{stage:'import',stepIndex:1,totalSteps:17}])assert.equal(applicationWorkflowStepCopy('en-US',w),'');
});
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,2));}assert.fail('Reference operation did not settle');}
async function fixture(t,options={}){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-reference-generation-')),profile=path.join(root,'profile'),downloads=path.join(root,'downloads');await fsp.mkdir(profile,{mode:0o700});
 let project='QA_PROJECT',selected=true,version=1,state={nodes:[],edges:[]},configurationIdentity={upload:'ONE'},resolved=0,generated=0,held,release,service;
 const deps={nodesRef:{current:[]},projectIdRef:{current:project},projectId:project,setNodes(value){state.nodes=typeof value==='function'?value(state.nodes):value;deps.nodesRef.current=state.nodes;},setEdges(value){state.edges=typeof value==='function'?value(state.edges):value;},setMenuPosition:()=>assert.fail(),drawingModel:'qa-model',videoModel:'qa-model',tianjiSeedanceModel:'qa-model',imageCompatResolutions:'1024x1024',videoDurations:'5 10',videoResolutions:'1280x720',videoAspectRatios:'16:9',apiConfigs:[],modelProtocolRegistry:{},videoModelRequestProfiles:{'qa-model':{requestType:'multipart-video',fieldMapping:{referenceAudio:'input_audio'}}}};
 const factory=use_createNodeAt(deps),canvas=createCanvasPlanController({read:()=>({...state,projectId:project,instanceId:'QA_MOUNT',ready:true,configurationIdentity}),capabilities:()=>({}),prepareNode:()=>assert.fail(),commit:()=>assert.fail()});
 const generate=async(...args)=>{
  const nodeId=args[0],execution=args[args.length-1],target=state.nodes.find(n=>n.id===nodeId);
  target.data.loading=true;
  await options.beforeSender?.({state,execution});
  if(options.noSubmit)return;
  return execution.submit(()=>{
   generated++;
   const incoming=state.edges.filter(e=>e.target===nodeId),sources=incoming.map(e=>state.nodes.find(n=>n.id===e.source));
   assert.equal(sources.length,options.expectedCount??1);
   for(const n of sources){if(n.data?.isTianjiPortrait){assert.equal(n.data.tianjiPortraitBindingStatus,'ready');assert.equal(n.data.imageUrl,'');}else if(n.type!=='audioNode'){const media=wanjuanCollectNodeReferenceMedia(n);assert.equal(media.images.length+media.videos.length,1);}}
   return options.afterSubmit?.()||{ok:true};
  },options.actualProviderBinding?.());
 };
 const runAutomationGeneration=new Function('beginApplicationTaskSubmission','automationJobsRef','projectIdRef','getNodes','return ('+runnerSource+');')(beginApplicationTaskSubmission,{current:new Map()},deps.projectIdRef,()=>state.nodes);
 const rootGenerate=new Function('nodeFactory','setNodes','setEdges','getNodes','getEdges','waitForCanvasState','runAutomationGeneration','automationGenerateImageRef','automationGenerateVideoRef','assertApplicationGenerationTarget','prepareApplicationGenerationReferences','commitCanvasPlanBatch','createApplicationGenerationExecution','return ('+functions[0]+');')(factory,deps.setNodes,deps.setEdges,()=>state.nodes,()=>state.edges,async({nodeId,sourceNodeIds})=>{assert(state.nodes.some(n=>n.id===nodeId));assert.equal(sourceNodeIds.length,options.expectedCount??1);canvas.observe();options.onCanvasCommitted?.();if(options.tamperNode){const ref=state.nodes.find(n=>n.id===sourceNodeIds[0]);ref.data.imageUrl='file:///PRIVATE_CHANGED.png';}},runAutomationGeneration,{current:generate},{current:generate},assertApplicationGenerationTarget,prepareApplicationGenerationReferences,commitCanvasPlanBatch,createApplicationGenerationExecution);
 const configuration=kind=>({models:['qa-model'],apiConfigs:[],url:'https://NO_PROVIDER.invalid/v1',key:'PRIVATE_SYNTHETIC_KEY',resolutions:'720p 1080p',durations:'5 10',ratios:'16:9 9:16',portraitGroups:{AIGC:'qa-group'},probe:factory.prepareNodeAt(kind==='image'?'promptNode':'videoNode',{x:0,y:0},{__nodeId:'probe'})});
 let portraitQueries=0;
 const automation={describeGeneration:(kind,args,referenceMedia)=>({...describeApplicationGeneration(kind,args,{...configuration(kind),referenceMedia}),...(kind==='tianji'?{privateBinding:'QA_TIANJI'+(options.portraitBinding?.()||''),privateProviderBinding:options.providerBinding||'QA_PROVIDER'}:{})}),generateImage:(a,g)=>rootGenerate('image',a,g),generateVideo:(a,g)=>rootGenerate('video',a,g),generateTianjiVideo:(a,g)=>rootGenerate('tianji',a,g),
  resolveTianjiPortraits:(ids,guard)=>resolveApplicationTianjiPortraits(ids,{config:{},groups:{AIGC:'qa-group'},guard:()=>guard('create'),request:async()=>{portraitQueries++;options.onPortraitQuery?.();return {list:ids.map(asset_id=>({asset_id,status:options.portraitStatus||'Active',image_url:'https://PRIVATE_PREVIEW.invalid/a.png'}))};}})};
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>project,getProjects:()=>[],getCanvas:()=>canvas,getAutomation:()=>automation,getInternalScope:owner=>({owner,selected,selectionVersion:version,projectId:project}),consume:(id,nonce)=>service.consume(id,nonce)});
 const input=createApplicationMediaInput({directory:()=>downloads,userData:()=>profile,persist:persistProjectAsset}),wrapped={...input,async resolve(...a){resolved++;assert(service.list().some(j=>j.status==='running'||j.status==='outcome_unknown')||options.internal);if(options.hold)await new Promise(r=>{held=true;release=r;});return input.resolve(...a);}};
 const broker=createApplicationMediaBroker({call:(method,args)=>dispatcher[method](args),output:{run:()=>assert.fail()},input:wrapped});
 service=createApplicationOperationService({prepare:broker.prepare,commit:broker.commit,release:broker.release,...options.service});if(options.workflow)service=createApplicationOperationWorkflowService(service);t.after(async()=>{service.close();broker.invalidate();dispatcher.close();await fsp.rm(root,{recursive:true,force:true});});
 const submit=(operation,args,actor='external',key='qa-reference-'+crypto.randomUUID())=>service.submit(actor,{operation,projectId:'QA_PROJECT',arguments:args,idempotencyKey:key},{selectionVersion:version});
 const read=(h,actor='external')=>service.read(actor,h.request.id,h.receipt),waiting=(h,actor)=>until(()=>['awaiting_confirmation','failed'].includes(read(h,actor).status)&&read(h,actor)),terminal=(h,actor)=>until(()=>['completed','failed','outcome_unknown'].includes(read(h,actor).status)&&read(h,actor));
 const approve=async(h,actor)=>{const w=await waiting(h,actor);if(w.status==='failed')return w;service.approve(h.request.id,w.revision);return terminal(h,actor);};
 async function importMedia(type='image',actor='external'){
  const bytes=type==='image'?png:type==='video'?Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(128)]):Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(128)]),source=path.join(root,crypto.randomUUID()+({image:'.png',video:'.mp4',audio:'.wav'}[type]));await fsp.writeFile(source,bytes);const handle=await submit('media.import',{type,source},actor);let done=await approve(handle,actor);if(done.status==='outcome_unknown')done=await until(()=>['completed','failed'].includes(read(handle,actor).status)&&read(handle,actor));assert.equal(done.status,'completed',JSON.stringify(done));return done.result;
 }
 const args=(ids,kind='image')=>({prompt:'QA_PROMPT',model:'qa-model',...(kind==='image'?{size:'1024x1024'}:kind==='tianji'?{resolution:'720p',duration:5,aspectRatio:'16:9',mode:'reference-media'}:{resolution:'1280x720',duration:5,aspectRatio:'16:9'}),references:ids});
 return {root,input,dispatcher,canvas,service,broker,configuration,submit,read,waiting,terminal,approve,importMedia,args,get state(){return state;},get resolved(){return resolved;},get generated(){return generated;},get portraitQueries(){return portraitQueries;},get held(){return held;},release:()=>release(),setProject:p=>project=p,selectAway:()=>{selected=false;version++;},changeUpload:()=>{configurationIdentity={upload:'TWO'};canvas.observe();}};
}
test('only opaque IDs enter strict generation requests; raw references and injected private sources never grant authority',async()=>{
 const {parseApplicationGeneration:p}=await import('../electron/shared/application-generation-contract.mjs'),id='reference-'+crypto.randomUUID();assert.deepEqual(p('generation.image',{prompt:'QA',references:[id]}).references,[id]);
 for(const extra of [{references:['/PRIVATE.png']},{references:[id,id]},{referenceMedia:[{source:'file:///PRIVATE'}]},{mediaExecutionKey:'a'.repeat(64)},{referenceImage:'/PRIVATE.png',references:[id]}])assert.throws(()=>p('generation.image',{prompt:'QA',...extra}));
 assert.equal(p('generation.tianji',{prompt:'QA',references:[id]}).mode,'reference-media');
});
test('import is not paid consent: actual root creates and connects media only after the second approval, once',async t=>{
 const f=await fixture(t),r=await f.importMedia(),key='qa-reference-generation-once',h=await f.submit('generation.image',f.args([r.referenceId]),'external',key),w=await f.waiting(h);assert.equal(w.status,'awaiting_confirmation');assert.equal(f.resolved,0);assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);const review=f.service.list().find(j=>j.id===h.request.id).review;assert.equal(review.mediaCount,1);assert.equal(review.references[0].sha256,r.sha256);assert(!JSON.stringify(review).includes('file:'));assert(!JSON.stringify(review).includes('PRIVATE_'));f.service.approve(h.request.id,w.revision);f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.resolved,1);assert.equal(f.generated,1);assert.equal(f.state.nodes.length,2);assert.equal(f.state.edges.length,1);assert.equal(done.result.generationCompleted,false);assert(!JSON.stringify(done).includes('file:'));assert.equal((await f.submit('generation.image',f.args([r.referenceId]),'external',key)).replayed,true);assert.equal(f.generated,1);
});
test('reference rejection/cancellation does not resolve bytes, upload or create nodes',async t=>{
 for(const cancel of [false,true]){const f=await fixture(t),r=await f.importMedia(),h=await f.submit('generation.video',f.args([r.referenceId],'video')),w=await f.waiting(h);if(cancel)f.service.cancel('external',h.request.id,h.receipt);else f.service.reject(h.request.id,w.revision);assert.equal(f.resolved,0);assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);}
});
test('internal session uses the same input/paid authority and cannot borrow another actor capability',async t=>{
 const f=await fixture(t,{internal:true}),r=await f.importMedia('image','internal:A'),wrong=await f.submit('generation.image',f.args([r.referenceId]),'internal:B');assert.equal((await f.waiting(wrong,'internal:B')).code,'OPERATION_NOT_FOUND');assert.equal(f.resolved,0);const done=await f.approve(await f.submit('generation.image',f.args([r.referenceId]),'internal:A'),'internal:A');assert.equal(done.status,'completed');assert.equal(f.generated,1);
});
test('revoked or tampered references fail after approval but before any generation/node creation',async t=>{
 for(const mode of ['release','tamper']){const f=await fixture(t),r=await f.importMedia(),h=await f.submit('generation.image',f.args([r.referenceId]));await f.waiting(h);if(mode==='release')f.input.release(r.referenceId,{actor:'external',projectId:'QA_PROJECT'});else{const privateRef=await f.input.resolve(r.referenceId,{actor:'external',projectId:'QA_PROJECT'},()=>{});await fsp.writeFile(require('node:url').fileURLToPath(privateRef.source),Buffer.from('PRIVATE_POISON'));}const done=await f.approve(h);assert.equal(done.status,'failed');assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);}
});
test('project, upload configuration and original session changes while resolving cannot reach the real generator',async t=>{
 for(const mode of ['project','upload','session']){const f=await fixture(t,{hold:true,internal:mode==='session'}),actor=mode==='session'?'internal:A':'external',r=await f.importMedia('image',actor),h=await f.submit('generation.image',f.args([r.referenceId]),actor),w=await f.waiting(h,actor);f.service.approve(h.request.id,w.revision);await until(()=>f.held);if(mode==='project')f.setProject('OTHER');else if(mode==='upload')f.changeUpload();else f.selectAway();f.release();const done=await f.terminal(h,actor);assert.equal(done.status,'failed',JSON.stringify(done));assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);}
});
test('changed reference node/extra connection before actual dispatch is refused, without undoing user edits',async t=>{
 const f=await fixture(t,{tamperNode:true}),r=await f.importMedia(),done=await f.approve(await f.submit('generation.image',f.args([r.referenceId])));assert.equal(done.status,'failed');assert.equal(done.code,'PLAN_STALE');assert.equal(f.generated,0);assert.equal(f.state.nodes.length,2);assert.equal(f.state.nodes[0].data.imageUrl,'file:///PRIVATE_CHANGED.png');
});
test('late reference resolution settles on the same unknown operation without repeating creation or generation',async t=>{
 const f=await fixture(t,{hold:true,service:{observationMs:5}}),r=await f.importMedia(),h=await f.submit('generation.video',f.args([r.referenceId],'video')),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);assert.equal((await f.terminal(h)).status,'outcome_unknown');assert.equal(f.state.nodes.length,0);f.release();const done=await until(()=>f.read(h).status==='completed'&&f.read(h));assert.equal(done.result.accepted,true);assert.equal(f.generated,1);assert.equal(f.state.nodes.length,2);
});
test('Tianji reference-media preserves typed image/video/audio order through real source nodes and shared root',async t=>{
 const f=await fixture(t,{expectedCount:3}),refs=[];for(const kind of ['image','video','audio'])refs.push((await f.importMedia(kind)).referenceId);const h=await f.submit('generation.tianji',f.args(refs,'tianji')),done=await f.approve(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.deepEqual(f.state.nodes.slice(0,3).map(n=>n.type),['imageNode','videoNode','audioNode']);assert.equal(f.state.nodes[3].data.tianjiSeedanceGenerationMode,'reference-media');assert.equal(f.generated,1);assert.equal(f.state.edges.length,3);
});
test('local profile checks never silently drop unsupported media or additional JSON reference images',async t=>{
 const f=await fixture(t),image=await f.importMedia(),video=await f.importMedia('video'),audio=await f.importMedia('audio'),a=f.args([image.referenceId],'video'),metas=ids=>ids.map(id=>f.input.metadata(id,{actor:'external',projectId:'QA_PROJECT'})),c=f.configuration('video');
 const described=(kind,args,profile)=>describeApplicationGeneration(kind,args,{...c,referenceMedia:metas(args.references),probe:{...c.probe,data:{...c.probe.data,videoModelRequestProfiles:{'qa-model':profile}}}});
 assert.equal(described('video',a,{requestType:'multipart-video',requiresReferenceImage:true}).mediaCount,1);
 assert.throws(()=>described('video',{...a,references:[video.referenceId]},{requestType:'json-video'}),{code:'OPERATION_MEDIA_UNSUPPORTED'});
 assert.throws(()=>described('video',{...a,references:[audio.referenceId]},{requestType:'multipart-video'}),{code:'OPERATION_MEDIA_UNSUPPORTED'});
 assert.throws(()=>described('image',{prompt:'QA',size:'1024x1024',references:[video.referenceId]},{}),{code:'OPERATION_MEDIA_UNSUPPORTED'});
 assert.throws(()=>described('tianji',{...f.args([image.referenceId],'tianji'),mode:'first-last'},{}),{code:'OPERATION_PARAMETER_UNAVAILABLE'});
});
test('private completion cannot be invoked without a pending consumed grant, or replayed after actual dispatch',async t=>{
 const f=await fixture(t),r=await f.importMedia();await assert.rejects(f.dispatcher.completeGeneration({requestId:'FORGED',mediaExecutionKey:'a'.repeat(64),referenceMedia:[]}),{code:'OPERATION_EXPIRED'});assert.equal(f.generated,0);const h=await f.submit('generation.image',f.args([r.referenceId])),done=await f.approve(h);assert.equal(done.status,'completed');await assert.rejects(f.dispatcher.completeGeneration({requestId:h.request.id,mediaExecutionKey:'a'.repeat(64),referenceMedia:[]}),{code:'OPERATION_EXPIRED'});assert.equal(f.generated,1);
});
test('an in-flight consumed grant still cannot be completed with a forged private completion key',async t=>{
 const f=await fixture(t,{hold:true}),r=await f.importMedia(),h=await f.submit('generation.image',f.args([r.referenceId])),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);await assert.rejects(f.dispatcher.completeGeneration({requestId:h.request.id,mediaExecutionKey:'a'.repeat(64),referenceMedia:[]}),{code:'OPERATION_INVALID_AUTHORITY'});assert.equal(f.generated,0);f.release();assert.equal((await f.terminal(h)).status,'completed');assert.equal(f.generated,1);
});
test('legacy raw image/video paths stage actual CAS imports and the real canvas handler without manually copying reference IDs',async t=>{
 for(const kind of ['image','video']){
  const f=await fixture(t,{workflow:true}),source=path.join(f.root,'raw-reference.png');await fsp.writeFile(source,png);
  const a=f.args([],kind);delete a.references;a.referenceImage=source;
  const h=await f.submit('generation.'+kind,a),first=await f.waiting(h);assert.equal(first.workflow.stepIndex,1);assert.equal(f.state.nodes.length,0);
  f.service.approve(h.request.id,first.revision);const paid=await until(()=>{const r=f.read(h);return r.status==='awaiting_confirmation'&&r.workflow.stepIndex===2&&r;});
  assert.equal(f.resolved,0);assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);assert(!JSON.stringify(paid).includes(source));
  f.service.approve(h.request.id,paid.revision);const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.generated,1);assert.equal(f.state.nodes.length,2);assert.equal(f.state.edges.length,1);
 }
});
test('legacy Tianji first-last paths preserve actual source-node order and require three approvals',async t=>{
 const f=await fixture(t,{workflow:true,expectedCount:2}),sources=[path.join(f.root,'first.png'),path.join(f.root,'last.png')];for(const source of sources)await fsp.writeFile(source,png);
 const a=f.args([],'tianji');delete a.references;Object.assign(a,{mode:'first-last',images:sources});const h=await f.submit('generation.tianji',a);
 for(let step=1;step<=2;step++){const w=await until(()=>{const r=f.read(h);return r.status==='awaiting_confirmation'&&r.workflow.stepIndex===step&&r;});f.service.approve(h.request.id,w.revision);}
 const paid=await until(()=>{const r=f.read(h);return r.status==='awaiting_confirmation'&&r.workflow.stepIndex===3&&r;});assert.equal(f.generated,0);f.service.approve(h.request.id,paid.revision);
 const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.generated,1);assert.deepEqual(f.state.nodes.map(n=>n.type),['imageNode','imageNode','seedanceNode']);assert.equal(f.state.nodes[2].data.tianjiSeedanceGenerationMode,'first-last');assert.equal(f.state.edges.length,2);
});
test('portrait ID generation queries only after paid approval, then creates guarded portrait nodes without preview or file reads',async t=>{
 const f=await fixture(t),args={...f.args([],'tianji'),portraitAssetIds:['asset-QA']},key='qa-portrait-once-0001',h=await f.submit('generation.tianji',args,'external',key),w=await f.waiting(h);
 assert.equal(f.portraitQueries,0);assert.equal(f.state.nodes.length,0);assert.equal(f.resolved,0);const review=f.service.list().find(r=>r.id===h.request.id).review;assert.deepEqual(review.portraitAssetIds,['asset-QA']);assert.equal(review.portraitStatusChecked,false);assert(!JSON.stringify(review).includes('PRIVATE'));
 f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.portraitQueries,1);assert.equal(f.generated,1);assert.equal(f.resolved,0);assert.equal(f.state.nodes[0].data.tianjiPortraitAssetId,'asset-QA');assert.equal(f.state.nodes[0].data.imageUrl,'');assert.equal(f.state.nodes[1].type,'seedanceNode');assert.equal(f.state.edges.length,1);assert.equal((await f.submit('generation.tianji',args,'external',key)).replayed,true);assert.equal(f.portraitQueries,1);
});
test('raw-source workflow can combine an approved file and a verified portrait ID without an extra uploader or implicit generation',async t=>{
 const f=await fixture(t,{workflow:true,expectedCount:2}),source=path.join(f.root,'ordinary.png');await fsp.writeFile(source,png);const args={...f.args([],'tianji'),referenceImage:source,portraitAssetIds:['asset-QA']};delete args.references;
 const h=await f.submit('generation.tianji',args),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);const paid=await until(()=>{const r=f.read(h);return r.status==='awaiting_confirmation'&&r.workflow.stepIndex===2&&r;});assert.equal(f.portraitQueries,0);assert.equal(f.generated,0);f.service.approve(h.request.id,paid.revision);const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.portraitQueries,1);assert.equal(f.resolved,1);assert.equal(f.generated,1);assert.equal(f.state.nodes.length,3);
});
test('internal selected session uses the same portrait verification, paid nonce and actual root, without external approval visibility',async t=>{
 const f=await fixture(t,{internal:true}),h=await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']},'internal:A'),w=await f.waiting(h,'internal:A');assert.equal(f.service.list().length,0);assert.equal(f.portraitQueries,0);assert.throws(()=>f.service.read('internal:B',h.request.id),{code:'OPERATION_NOT_FOUND'});f.service.approve(h.request.id,w.revision);const done=await f.terminal(h,'internal:A');assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(f.generated,1);assert.equal(f.portraitQueries,1);assert.equal(f.state.nodes.length,2);
});
test('portrait rejection and non-Active provider results cannot create draft nodes or reach generation',async t=>{
 for(const status of ['reject','Pending','Rejected']){const f=await fixture(t,{portraitStatus:status}),h=await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']}),w=await f.waiting(h);
  if(status==='reject'){f.service.reject(h.request.id,w.revision);assert.equal(f.portraitQueries,0);}else{f.service.approve(h.request.id,w.revision);assert.equal((await f.terminal(h)).code,'OPERATION_MEDIA_NOT_READY');assert.equal(f.portraitQueries,1);}assert.equal(f.state.nodes.length,0);assert.equal(f.generated,0);
 }
});
test('portrait-query project/session/config changes are rechecked before any source or target node is created',async t=>{
 for(const mode of ['project','session','config']){let f,binding='ONE';f=await fixture(t,{internal:mode==='session',portraitBinding:()=>binding,onPortraitQuery:()=>{if(mode==='project')f.setProject('OTHER');else if(mode==='session')f.selectAway();else binding='TWO';}});const actor=mode==='session'?'internal:A':'external',h=await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']},actor),w=await f.waiting(h,actor);f.service.approve(h.request.id,w.revision);assert.equal((await f.terminal(h,actor)).status,'failed');assert.equal(f.generated,0);assert.equal(f.state.nodes.length,0);}
});
test('manual portrait identity or preview replacement after node creation cannot dispatch a different reference',async t=>{
 const f=await fixture(t,{tamperNode:true}),done=await f.approve(await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']}));assert.equal(done.code,'PLAN_STALE');assert.equal(f.generated,0);assert.equal(f.state.nodes.length,2);assert.equal(f.state.nodes[0].data.imageUrl,'file:///PRIVATE_CHANGED.png');
});
test('provider binding changed after committed nodes but before the normal sender cannot use the old paid approval',async t=>{
 let binding='ONE';const f=await fixture(t,{portraitBinding:()=>binding,onCanvasCommitted:()=>{binding='TWO';}}),h=await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']});
 const done=await f.approve(h);assert.equal(f.generated,0,'changed provider must not reach the actual root delegate');assert.equal(done.status,'failed');assert.equal(done.code,'PLAN_STALE');
});
test('actual root keeps original environment and session fences alive through an asynchronous approved upload',async t=>{
 for(const mode of ['project','upload','session','reference','stop','closed']){
  let held=false,resume;
  const f=await fixture(t,{internal:mode==='session',beforeSender:async({execution})=>execution.upload(()=>new Promise(r=>{held=true;resume=r;}))}),actor=mode==='session'?'internal:A':'external',r=await f.importMedia('image',actor),h=await f.submit('generation.image',f.args([r.referenceId]),actor),w=await f.waiting(h,actor);
  f.service.approve(h.request.id,w.revision);await until(()=>held);
  if(mode==='project')f.setProject('OTHER');else if(mode==='upload')f.changeUpload();else if(mode==='session')f.selectAway();else if(mode==='reference')f.state.nodes[0].data.imageUrl='file:///CHANGED.png';else if(mode==='stop')f.state.nodes.at(-1).data.manuallyStopped=true;else f.dispatcher.close();
  resume();const done=await f.terminal(h,actor);assert.equal(done.status,'failed',mode);assert.equal(f.generated,0,mode);assert.equal(f.state.nodes.length,2,'disclosed draft remains; do not roll back later user edits');
 }
});
test('Tianji sender rechecks current groups/config and the actual captured provider config, without exposing either',async t=>{
 for(const wrongActual of [false,true]){
  let binding='ONE';const f=await fixture(t,{portraitBinding:()=>binding,beforeSender:()=>{if(!wrongActual)binding='TWO';},actualProviderBinding:()=>wrongActual?'OTHER_PROVIDER':'QA_PROVIDER'}),h=await f.submit('generation.tianji',{...f.args([],'tianji'),portraitAssetIds:['asset-QA']});
  const w=await f.waiting(h),review=f.service.list().find(j=>j.id===h.request.id).review;
  assert(!JSON.stringify(review).includes('QA_PROVIDER'));assert(!Object.hasOwn(review,'privateProviderBinding'));assert(!Object.hasOwn(review,'privateBinding'));
  f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'failed');assert.equal(done.code,'PLAN_STALE');assert.equal(f.generated,0);
 }
});
test('actual root refuses accepted status if a normal hook finishes without attempting submission',async t=>{
 const f=await fixture(t,{expectedCount:0,noSubmit:true}),done=await f.approve(await f.submit('generation.image',f.args([])));
 assert.equal(done.status,'failed');assert.equal(done.code,'OPERATION_NOT_SUBMITTED');assert.equal(f.generated,0);
});
test('a long pre-submit upload settles the same unknown operation once, not on polling or idempotent replay',async t=>{
 let held=false,resume;const f=await fixture(t,{service:{observationMs:5},expectedCount:0,beforeSender:async({execution})=>execution.upload(()=>new Promise(r=>{held=true;resume=r;}))}),args=f.args([]),key='qa-sender-upload-once',h=await f.submit('generation.image',args,'external',key),w=await f.waiting(h);
 f.service.approve(h.request.id,w.revision);await until(()=>held);assert.equal((await f.terminal(h)).status,'outcome_unknown');assert.equal(f.generated,0);assert.equal((await f.submit('generation.image',args,'external',key)).request.id,h.request.id);
 resume();await until(()=>f.read(h).status==='completed');assert.equal(f.generated,1);assert.equal(f.read(h).result.accepted,true);
});
test('submission receipt need not wait for polling/result completion and does not invalidate that original lifecycle',async t=>{
 let resume;const f=await fixture(t,{expectedCount:0,afterSubmit:()=>new Promise(r=>{resume=r;})}),h=await f.submit('generation.image',f.args([])),done=await f.approve(h);
 assert.equal(done.status,'completed');assert.equal(done.result.generationCompleted,false);assert.equal(f.generated,1);resume();
});
