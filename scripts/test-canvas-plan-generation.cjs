const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {prepareCanvasPlanGeneration}=require('../src/renderer/lib/canvas-plan-generation.ts');
const {describeApplicationGeneration}=require('../src/renderer/lib/application-generation.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {canvasNodePlanCapability}=require('../src/renderer/lib/canvas-plan-capabilities.ts');
const {createAssistantOperationClient}=require('../src/renderer/lib/assistant-operation-client.ts');
const config={models:['qa-image'],apiConfigs:[],apiBindings:{},protocolBindings:{},registry:{},url:'https://PRIVATE_PROVIDER.invalid/v1',key:'PRIVATE_QA_KEY'};
function fixture(kind='image'){
 let calls=0,writes=0,uploads=0,selected=true,selectionVersion=3;
 const prepareNode=(type,position,data)=>({id:data.__nodeId,type,position,data:{drawingModel:'qa-image',videoModel:'qa-image',videoDurations:'5 10',videoResolutions:'1280x720 720x1280',videoModelRequestProfiles:{'qa-image':{requestType:'multipart-video'}},...data}});
 const source=prepareNode('imageNode',{x:0,y:0},{__nodeId:'source',imageUrl:'file:///PRIVATE_CANVAS_IMAGE.png',label:'PRIVATE_LABEL'});
 source.selected=true;
 let state={projectId:'QA_PROJECT',instanceId:'QA_MOUNT',ready:true,configurationIdentity:{key:'PRIVATE_QA_KEY'},nodes:[source],edges:[]};
 const owner={getNodes:()=>state.nodes,getEdges:()=>state.edges,prepareNode,
  commit:(_before,after)=>{writes++;state={...state,...after};},waitForCanvasState:async()=>{},
  describe:async(kind,args,node,types)=>describeApplicationGeneration(kind,args,{...config,probe:node,canvasReferenceTypes:types}),
  async run(id,kind,args,guard,execution){guard();state.nodes=state.nodes.map(n=>n.id===id?{...n,data:{...n.data,loading:true,taskId:'QA_TASK'}}:n);
   await execution.upload(async()=>{uploads++;await owner.duringUpload?.();});
   await execution.submit(async()=>{calls++;});
  },
 };
 const canvas=createCanvasPlanController({read:()=>state,prepareNode,capabilities:()=>({promptNode:canvasNodePlanCapability(prepareNode('promptNode',{x:0,y:0},{})),videoNode:canvasNodePlanCapability(prepareNode('videoNode',{x:0,y:0},{}))}),commit:owner.commit});
 const captured=canvas.capture(),preview=canvas.preview(captured.ticketId,{version:1,operations:[{op:'create',key:'target',kind,position:{x:400,y:0},fields:kind==='image'?{prompt:'QA_PROMPT',imageSize:'1K',aspectRatio:'16:9'}:{prompt:'QA_VIDEO',videoParameterMode:'exact-resolution',size:'1280x720',selectedSeconds:'5',selectedAspectRatio:'16:9'}},{op:'connect',source:'source',target:'target'}]});
 const applied=canvas.execute(preview.planId),nodeId=applied.createdNodeIds[0];
 return {owner,canvas,preview,nodeId,get state(){return state;},get calls(){return calls;},get writes(){return writes;},get uploads(){return uploads;},setScope(s,v){selected=s;selectionVersion=v;},scope:()=>({owner:'SESSION_A',selected,selectionVersion,projectId:state.projectId})};
}
const wait=async fn=>{for(let i=0;i<100;i++){const r=fn();if(!['preparing','queued','running'].includes(r.status))return r;await new Promise(setImmediate);}assert.fail('No operation boundary');};
function integrated(t,kind='image'){
 const f=fixture(kind);let service;
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>f.state.projectId,getProjects:()=>[],getCanvas:()=>f.canvas,getAutomation:()=>({prepareCanvasGeneration:id=>prepareCanvasPlanGeneration(id,f.owner)}),getInternalScope:()=>f.scope(),consume:(id,nonce)=>service.consume(id,nonce)});
 service=createApplicationOperationService({prepare:dispatcher.prepare,commit:dispatcher.commit,release:dispatcher.release});
 // Register the already-applied plan through the normal dispatcher too; the
 // direct fixture plan is not accepted as a public plan capability.
 const scope={actor:'internal:SESSION_A',selectionVersion:3};let seq=0;
 const request=(operation,args)=>({operation,projectId:f.state.projectId,arguments:args,idempotencyKey:'qa-plan-request-'+String(++seq).padStart(5,'0')});
 const submit=(operation,args)=>service.submit(scope.actor,request(operation,args),scope);
 const read=h=>service.readInternal(scope.actor,h.request.id);
 const done=h=>wait(()=>read(h));
 const bridge=Object.fromEntries(Object.entries({applicationOperationSubmitInternal:(owner,r,selectionVersion)=>service.submit('internal:'+owner,r,{selectionVersion}),applicationOperationReadInternal:(owner,id)=>service.readInternal('internal:'+owner,id),applicationOperationApproveInternal:(owner,id,revision)=>{service.read('internal:'+owner,id);return service.approve(id,revision);},applicationOperationCancelInternal:(owner,id)=>service.cancel('internal:'+owner,id)}).map(([name,fn])=>[name,async(...a)=>{try{return {ok:true,value:await fn(...a)};}catch(e){return {ok:false,code:e.code};}}]));
 async function plan(){
  const captured=(await done(await submit('canvas.read',{}))).result;
  const proposal={version:1,operations:[{op:'update',node:f.nodeId,fields:{prompt:'QA_CONFIRMED'}}]};
  // The target is selected explicitly for this test's scoped update.
  f.state.nodes.find(n=>n.id===f.nodeId).selected=true;
  // Selection is part of capture metadata: obtain the final ticket after it.
  const selected=(await done(await submit('canvas.read',{}))).result;
  const p=(await done(await submit('canvas.plan.preview',{ticketId:selected.ticketId,proposal}))).result;
  const h=await submit('canvas.plan.apply',{planId:p.planId}),w=await done(h);service.approve(h.request.id,w.revision);assert.equal((await done(h)).status,'completed');return p;
 }
 t.after(()=>{service.close();dispatcher.close();});
 return {...f,f,service,dispatcher,submit,read,done,plan,gateway:createAssistantOperationClient(()=>bridge)};
}
test('review is read-only and contains exact canvas input IDs, explicit ratio, combined text and no private paths/config',async()=>{
 const f=fixture();f.state.nodes.push({id:'text',type:'textNode',position:{x:0,y:300},data:{text:'QA_TEXT'}});f.state.edges.push({id:'text-edge',source:'text',target:f.nodeId});
 const before=f.writes,p=await prepareCanvasPlanGeneration(f.nodeId,f.owner);
 assert.equal(f.writes,before);assert.equal(f.calls,0);assert.equal(f.uploads,0);assert.equal(p.review.prompt,'QA_TEXT\nQA_PROMPT');assert.equal(p.review.parameters.aspectRatio,'16:9');assert.equal(p.review.mediaCount,1);assert.equal(p.review.contentSendRequired,true);
 assert.deepEqual(p.review.canvasReferences,[{nodeId:'source',type:'image'}]);assert.equal(p.review.sourceTextCount,1);
 for(const value of ['PRIVATE_CANVAS_IMAGE','PRIVATE_PROVIDER','PRIVATE_QA_KEY','PRIVATE_LABEL'])assert(!JSON.stringify(p.review).includes(value));
});
test('first confirmed execution reuses the actual plan node, one upload/submit and one-shot closure',async()=>{
 const f=fixture(),p=await prepareCanvasPlanGeneration(f.nodeId,f.owner),count=f.state.nodes.length;
 const r=await p.commit(()=>{});assert.equal(r.nodeId,f.nodeId);assert.equal(r.resultBranch,false);assert.equal(f.state.nodes.length,count);assert.equal(f.calls,1);assert.equal(f.uploads,1);
 await assert.rejects(()=>p.commit(()=>{}),{code:'OPERATION_ALREADY_CONSUMED'});assert.equal(f.calls,1);
});
test('a result creates a fresh real-factory branch and preserves every original output and incoming connection',async()=>{
 const f=fixture('video'),original=f.state.nodes.find(n=>n.id===f.nodeId);original.data.videoUrl='file:///PRIVATE_OLD_RESULT.webm';original.data.thumbnailUrl='file:///PRIVATE_OLD_THUMB.png';
 const snapshot=JSON.stringify(original),edges=JSON.stringify(f.state.edges),p=await prepareCanvasPlanGeneration(f.nodeId,f.owner);assert.equal(p.review.resultBranch,true);
 const r=await p.commit(()=>{});assert.notEqual(r.nodeId,f.nodeId);assert.equal(JSON.stringify(f.state.nodes.find(n=>n.id===f.nodeId)),snapshot);assert.equal(JSON.stringify(f.state.edges.slice(0,1)),edges);
 const fresh=f.state.nodes.find(n=>n.id===r.nodeId);assert(!fresh.data.videoUrl);assert(!fresh.data.thumbnailUrl);assert(f.state.edges.some(e=>e.source==='source'&&e.target===r.nodeId));assert.equal(f.calls,1);
});
test('changed prompt, model, references, source bytes binding and newly busy nodes refuse stale approval before IO',async()=>{
 for(const edit of [f=>f.state.nodes.find(n=>n.id===f.nodeId).data.prompt='MANUAL',f=>f.state.nodes.find(n=>n.id===f.nodeId).data.selectedModel='OTHER',f=>f.state.nodes[0].data.imageUrl='file:///CHANGED',f=>f.state.nodes[0].data.projectAssetBindings={imageUrl:{localPath:'/CHANGED'}},f=>f.state.edges.push({id:'EXTRA',source:'source',target:f.nodeId}),f=>f.state.nodes.find(n=>n.id===f.nodeId).data.loading=true]){
  const f=fixture(),p=await prepareCanvasPlanGeneration(f.nodeId,f.owner),before=f.writes;edit(f);await assert.rejects(()=>p.commit(()=>{}),{code:'PLAN_STALE'});assert.equal(f.calls,0);assert.equal(f.uploads,0);assert.equal(f.writes,before);
 }
});
test('a change during an approved upload prevents the first model submit; there is no retry',async()=>{
 const f=fixture(),p=await prepareCanvasPlanGeneration(f.nodeId,f.owner);f.owner.duringUpload=()=>{f.state.nodes[0].data.imageUrl='file:///CHANGED_DURING_UPLOAD';};
 await assert.rejects(()=>p.commit(()=>{}),{code:'PLAN_STALE'});assert.equal(f.uploads,1);assert.equal(f.calls,0);
});
test('unknown or incompatible media fail before canvas edits; pending source nodes are never silently omitted',async()=>{
 for(const edit of [f=>f.state.nodes[0].data.loading=true,f=>{delete f.state.nodes[0].data.imageUrl;},f=>f.state.nodes[0].data.tianjiPortraitAssetId='asset-private',f=>f.state.nodes[0].type='customNode',f=>f.state.nodes.find(n=>n.id===f.nodeId).data.selectedContextResources=[{url:'file:///PRIVATE'}]]){
  const f=fixture();edit(f);const before=f.writes;await assert.rejects(()=>prepareCanvasPlanGeneration(f.nodeId,f.owner));assert.equal(f.writes,before);assert.equal(f.uploads,0);assert.equal(f.calls,0);
 }
});
test('applied-plan membership cannot be substituted by a node ID, preview, undone plan or another actor',async t=>{
 const {f,canvas}=integrated(t);assert.throws(()=>canvas.validateGenerationTarget(f.preview.planId,'source'),{code:'PLAN_NODE_UNSUPPORTED'});
 assert.throws(()=>canvas.validateGenerationTarget(f.preview.planId,'outside'),{code:'PLAN_NODE_OUT_OF_SCOPE'});
 canvas.undo(f.preview.planId);assert.throws(()=>canvas.validateGenerationTarget(f.preview.planId,f.nodeId),{code:'PLAN_NOT_APPLIED'});
});
test('internal staged prepare returns owner-scoped review but no generation; explicit approve consumes the same request exactly once',async t=>{
 const f=integrated(t),p=await f.plan();
 const staged=await f.gateway.prepare('SESSION_A','canvas.plan.generate','QA_PROJECT',{planId:p.planId,nodeId:f.f.nodeId},{selectionVersion:3});
 assert.equal(staged.job.status,'awaiting_confirmation');assert.equal(f.f.calls,0);assert.equal(staged.job.review.canvasNodeId,f.f.nodeId);
 assert(!f.service.read('internal:SESSION_A',staged.handle.id).review);
 assert.throws(()=>f.service.readInternal('internal:SESSION_B',staged.handle.id),{code:'OPERATION_NOT_FOUND'});
 assert.throws(()=>f.service.readInternal('external',staged.handle.id),{code:'OPERATION_INVALID_AUTHORITY'});
 const r=await f.gateway.approve(staged.handle,staged.job.revision,{isCurrent:()=>true});assert.equal(r.nodeId,f.f.nodeId);assert.equal(r.generationCompleted,false);assert.equal(f.f.calls,1);
 assert.equal((await f.gateway.recover(staged.handle)).nodeId,r.nodeId);assert.equal(f.f.calls,1);
});
test('main authority checks selection and environment again at dispatch, not just in review UI',async t=>{
 for(const change of [f=>f.setScope(true,5),f=>{f.state.configurationIdentity.key='CHANGED';}]){
  const f=integrated(t),p=await f.plan(),staged=await f.gateway.prepare('SESSION_A','canvas.plan.generate','QA_PROJECT',{planId:p.planId,nodeId:f.f.nodeId},{selectionVersion:3});
  change(f.f);await assert.rejects(()=>f.gateway.approve(staged.handle,staged.job.revision,{isCurrent:()=>true}));assert.equal(f.f.calls,0);assert.equal(f.f.uploads,0);
 }
});
test('strict shared contract exposes only plan and node IDs, never arbitrary prompt, model, URL or authority flags',async()=>{
 const {parseApplicationOperationRequest,applicationOperationRequiresSelection}=await import('../electron/shared/application-operation-contract.mjs');
 const base={operation:'canvas.plan.generate',projectId:'QA',idempotencyKey:'qa-plan-strict-request',arguments:{planId:'plan',nodeId:'node'}};
 assert.deepEqual(parseApplicationOperationRequest(base).arguments,base.arguments);assert(applicationOperationRequiresSelection(base.operation));
 for(const extra of [{prompt:'PRIVATE'},{model:'INVENTED'},{url:'file:///PRIVATE'},{confirmed:true}])assert.throws(()=>parseApplicationOperationRequest({...base,arguments:{...base.arguments,...extra}}),{code:'OPERATION_INVALID_REQUEST'});
});
