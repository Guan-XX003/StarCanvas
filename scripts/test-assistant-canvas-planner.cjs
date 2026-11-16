const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createAssistantWorkspaceClient}=require('../src/renderer/lib/assistant-workspace-client.ts');
const {createAssistantCanvasPlanner,parseCanvasPlanningReply}=require('../src/renderer/lib/assistant-canvas-planner.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {createAssistantWorkspaceVault}=require('../electron/main/assistant-workspace-vault.cjs');
const {createAssistantWorkspace}=require('../electron/main/assistant-workspace.cjs');
const {buildCanvasPlanningPrompt,validateCanvasPlanningRequest}=require('../electron/shared/canvas-planning-protocol.mjs');
const {containsLikelyAssistantSecret}=require('../electron/main/assistant-context.cjs');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const plan={version:1,operations:[{op:'create',key:'draft',kind:'image',position:{x:1000,y:0},fields:{prompt:'SYNTHETIC_IMAGE_PROMPT',selectedModel:'image-one',imageSize:'2K'}}]};
async function fixture(t,options={}){
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-planner-'));
 const repository=createAssistantWorkspace({vault:createAssistantWorkspaceVault({userDataPath:directory,encrypt:async value=>'QA_'+Buffer.from(value).toString('hex'),decrypt:async value=>Buffer.from(value.slice(3),'hex').toString()})});
 let state={projectId:'QA_PROJECT',instanceId:'QA_MOUNT',ready:true,nodes:[{id:'reference',type:'imageNode',selected:true,position:{x:0,y:0},data:{imageUrl:'file:///PRIVATE_MEDIA',label:'PRIVATE_NODE_LABEL'}},{id:'text',type:'textNode',selected:true,position:{x:0,y:500},data:{text:'PRIVATE_NODE_TEXT'}}],edges:[]};
 const caps={textNode:{models:['text-one'],parameters:{}},promptNode:{models:['image-one'],parameters:{imageSize:['1K','2K']}},videoNode:{models:['video-one'],parameters:{selectedSeconds:['5']}}};
 let serial=0,commits=0,reply=JSON.stringify(plan),hold=null;const requests=[];
 const canvas=createCanvasPlanController({read:()=>state,capabilities:()=>caps,id:()=>`QA-${++serial}`,prepareNode:(type,position,data)=>({id:data.__nodeId,type,position,data:{...data}}),commit:(_before,after)=>{state=after;commits++;}});
 const methods={assistantWorkspaceList:()=>repository.list(),assistantWorkspaceCreateSession:x=>repository.createSession(x),assistantWorkspaceReadSession:id=>repository.readSession(id),assistantWorkspacePatchSession:(...a)=>repository.patchSession(...a),assistantWorkspaceSelectSession:id=>repository.selectSession(id),assistantWorkspaceReadRole:id=>repository.readRole(id),
  assistantWorkspaceSend:async(id,text,context)=>{const prompt=buildCanvasPlanningPrompt(text,context.canvasPlan,containsLikelyAssistantSecret);requests.push({id,text,prompt,context});const r=await repository.beginTurn(id,text);if(hold)await hold.promise;return repository.finishTurn(id,r.value.task.id,{text:reply});},
  assistantWorkspaceCancel:async id=>{const r=await repository.readSession(id);if(['queued','running'].includes(r.value.task.status))await repository.finishTurn(id,r.value.task.id,{code:'ASSISTANT_CANCELLED'});return repository.readSession(id);},
 };
 const bridge=Object.fromEntries(Object.entries(methods).map(([k,fn])=>[k,async(...a)=>{try{return {ok:true,value:await fn(...a)};}catch(e){return {ok:false,code:e.code};}}]));
 const client=createAssistantWorkspaceClient(()=>bridge);await client.initialize('QA_PROJECT');
 let service,consumeHold,prepareHold,held=0,preparingHeld=0;
 const operations=[];
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>state.projectId,getProjects:()=>[{id:'QA_PROJECT'}],getCanvas:()=>canvas,getAutomation:()=>options.automation||null,getInternalScope:owner=>client.operationScope(owner),consume:async(id,nonce)=>{const grant=service.consume(id,nonce);if(consumeHold&&grant.operation==='canvas.plan.apply'){held++;await consumeHold.promise;}return grant;}});
 service=createApplicationOperationService({prepare:async value=>{if(prepareHold&&value.request.operation==='canvas.plan.apply'){preparingHeld++;await prepareHold.promise;}return dispatcher.prepare(value);},commit:dispatcher.commit,release:dispatcher.release,...options.service});
 const internal={applicationOperationSubmitInternal:(owner,r,selectionVersion)=>{operations.push(r.operation);return service.submit('internal:'+owner,r,{selectionVersion});},applicationOperationReadInternal:(owner,id)=>service.readInternal('internal:'+owner,id),applicationOperationApproveInternal:(owner,id,revision)=>{service.read('internal:'+owner,id);return service.approve(id,revision);},applicationOperationCancelInternal:(owner,id)=>service.cancel('internal:'+owner,id)};
 for(const [name,fn]of Object.entries(internal))bridge[name]=async(...args)=>{try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,code:e.code};}};
 const planner=createAssistantCanvasPlanner(client,projectId=>projectId==='QA_PROJECT'?canvas:null,()=>bridge),id=client.getSnapshot().selectedId;
 t.after(async()=>{hold?.release();consumeHold?.release();prepareHold?.release();service.close();dispatcher.close();await client.flushAll().catch(()=>{});await fsp.rm(directory,{recursive:true,force:true});});
 return {client,planner,id,canvas,repository,bridge,requests,operations,service,get held(){return held;},get preparingHeld(){return preparingHeld;},get state(){return state;},get commits(){return commits;},setReply(value){reply=value;},holdPrepare(){let release;const promise=new Promise(r=>release=r);return prepareHold={promise,release};},holdConsume(){let release;const promise=new Promise(r=>release=r);return consumeHold={promise,release};},hold(){let release;const promise=new Promise(r=>release=r);return hold={promise,release};},request(){planner.begin(id,'QA_PROJECT');return planner.request(id,'QA_PROJECT','Build a synthetic draft',{custom:false,ready:true,notice:'PREVIEW_READY'});}};
}
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('owned request did not reach test boundary');};
test('applied plan stages one owner-scoped review and requires separate content and fee consent',async t=>{
 let posts=0;const automation={prepareCanvasGeneration:async nodeId=>({review:{kind:'generation',canvasNodeId:nodeId,prompt:'QA_ONLY',parameters:{size:'1K'},contentSendRequired:true},commit:async guard=>{guard('create');guard('submit');posts++;return {ok:true,accepted:true,nodeId};}})};
 const f=await fixture(t,{automation});await f.request();const applied=await f.planner.apply(f.id,'QA_PROJECT','APPLIED'),nodeId=applied.createdNodeIds[0];
 const pending=f.planner.prepareGeneration(f.id,'QA_PROJECT',nodeId),duplicate=createAssistantCanvasPlanner(f.client,()=>f.canvas,()=>f.bridge).prepareGeneration(f.id,'QA_PROJECT',nodeId);assert.equal(pending,duplicate);await pending;
 const view=f.client.viewFor(f.id);assert.equal(view.canvasPlan.generation.phase,'review');assert.equal(posts,0);
 for(const consent of [{content:false,cost:true},{content:true,cost:false}])assert.throws(()=>f.planner.approveGeneration(f.id,'QA_PROJECT',consent,'NO'),{code:'OPERATION_PERMISSION_REQUIRED'});
 assert.equal(posts,0);const result=await f.planner.approveGeneration(f.id,'QA_PROJECT',{content:true,cost:true},'SUBMITTED_NOT_FINISHED');assert.equal(result.nodeId,nodeId);assert.equal(posts,1);assert.equal(view.canvasPlan.generation.phase,'accepted');
 assert.equal(f.operations.filter(op=>op==='canvas.plan.generate').length,1);assert.equal(view.messages.filter(m=>m.text==='SUBMITTED_NOT_FINISHED').length,1);
});
test('switching away and back cannot revive a generation review; cancellation and a new review never reuse consent',async t=>{
 let posts=0;const automation={prepareCanvasGeneration:async nodeId=>({review:{kind:'generation',canvasNodeId:nodeId},commit:async guard=>{guard('create');posts++;return {ok:true,accepted:true,nodeId};}})};
 const f=await fixture(t,{automation});await f.request();const {createdNodeIds:[nodeId]}=await f.planner.apply(f.id,'QA_PROJECT','APPLIED');await f.planner.prepareGeneration(f.id,'QA_PROJECT',nodeId);
 const old=f.client.viewFor(f.id).canvasPlan.generation.handle;await f.client.create('QA_PROJECT');await f.client.select(f.id);
 await assert.rejects(()=>f.planner.approveGeneration(f.id,'QA_PROJECT',{content:true,cost:true},'NO'),{code:'PLAN_SESSION_CHANGED'});assert.equal(posts,0);assert.equal(f.service.read('internal:'+f.id,old.id).status,'cancelled');
 await f.planner.dismissGeneration(f.id);await f.planner.prepareGeneration(f.id,'QA_PROJECT',nodeId);const fresh=f.client.viewFor(f.id).canvasPlan.generation;assert.notEqual(fresh.handle.id,old.id);assert.equal(fresh.phase,'review');assert.equal(posts,0);
 await f.planner.dismissGeneration(f.id);assert.equal(f.service.read('internal:'+f.id,fresh.handle.id).status,'cancelled');
});
test('unconfirmed paid submission keeps its original handle and observes the late result without a second execution',async t=>{
 let posts=0,release;const hold=new Promise(r=>release=r),automation={prepareCanvasGeneration:async nodeId=>({review:{kind:'generation',canvasNodeId:nodeId},commit:async guard=>{guard('create');posts++;await hold;return {ok:true,accepted:true,nodeId};}})};
 t.after(()=>release());const f=await fixture(t,{automation,service:{observationMs:10}});await f.request();const {createdNodeIds:[nodeId]}=await f.planner.apply(f.id,'QA_PROJECT','APPLIED');await f.planner.prepareGeneration(f.id,'QA_PROJECT',nodeId);
 await assert.rejects(()=>f.planner.approveGeneration(f.id,'QA_PROJECT',{content:true,cost:true},'NO_EARLY_SUCCESS'),{code:'OPERATION_OUTCOME_UNKNOWN'});assert.equal(posts,1);const g=f.client.viewFor(f.id).canvasPlan.generation;assert.equal(g.phase,'uncertain');assert.throws(()=>f.planner.dismiss(f.id),{code:'ASSISTANT_BUSY'});
 release();await until(()=>f.service.read('internal:'+f.id,g.handle.id).status==='completed');await f.planner.observeGeneration(f.id);assert.equal(f.client.viewFor(f.id).canvasPlan.generation.phase,'accepted');assert.equal(posts,1);assert.equal(f.operations.filter(op=>op==='canvas.plan.generate').length,1);
});
test('legacy single-node confirmation uses common read/preview/apply and undo for text/image/video without any model call',async t=>{
 for(const kind of ['text','image','video']){
  const f=await fixture(t),options={receipt:'SINGLE_APPLIED',projectName:'QA',intent:'qa-single-'+kind};
  const result=await f.planner.createSingle(f.id,'QA_PROJECT',kind,'QA_SINGLE',{x:1000,y:300},options);
  assert.equal(f.requests.length,0);assert.equal(f.commits,1);assert.equal(result.generationStarted,false);assert.equal(f.state.nodes.length,3);
  const node=f.state.nodes.find(n=>result.createdNodeIds.includes(n.id));assert.equal(node.data[kind==='text'?'text':'prompt'],'QA_SINGLE');
  assert.deepEqual(f.operations,['canvas.read','canvas.plan.preview','canvas.plan.apply']);
  assert.equal((await f.planner.createSingle(f.id,'QA_PROJECT',kind,'QA_SINGLE',{x:1000,y:300},options)).replayed,true);assert.equal(f.commits,1);
  await f.planner.undo(f.id,'QA_PROJECT','SINGLE_UNDONE');assert.equal(f.state.nodes.length,2);assert.equal(f.commits,2);
 }
});
test('single-node cross-render duplicate clicks share the same request, and a different intent never joins it',async t=>{
 const f=await fixture(t),hold=f.holdConsume(),options={receipt:'SINGLE_APPLIED',intent:'qa-single-duplicate'};
 const one=f.planner.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE',{x:1000,y:0},options);await until(()=>f.held===1);
 const other=createAssistantCanvasPlanner(f.client,()=>f.canvas,()=>f.bridge),two=other.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE',{x:1000,y:0},options);assert.equal(one,two);
 assert.throws(()=>other.createSingle(f.id,'QA_PROJECT','text','OTHER',{x:1000,y:0},{...options,intent:'different'}),{code:'ASSISTANT_BUSY'});
 hold.release();await one;assert.equal(f.commits,1);assert.equal(f.operations.filter(x=>x==='canvas.plan.apply').length,1);
});
test('successive single-node create/undo cycles retire only dismissed undone plans through the common gateway',async t=>{
 const f=await fixture(t);
 for(let i=0;i<20;i++){
  await f.planner.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE_'+i,{x:1000,y:0},{receipt:'APPLIED',intent:'qa-repeat-'+i});
  assert.equal(f.state.nodes.length,3);
  await f.planner.undo(f.id,'QA_PROJECT','UNDONE');assert.equal(f.state.nodes.length,2);
 }
 assert.equal(f.commits,40);assert.equal(f.requests.length,0);
 assert.equal(f.operations.filter(op=>op==='canvas.plan.apply').length,20);
});
test('single-node confirmation keeps the original click selection across delayed prepare and nonce work',async t=>{
 for(const phase of ['prepare','consume']){
  const f=await fixture(t),hold=phase==='prepare'?f.holdPrepare():f.holdConsume(),pending=f.planner.createSingle(f.id,'QA_PROJECT','image','QA_SINGLE',{x:1000,y:0},{receipt:'NO',intent:'qa-single-fenced'});
  await until(()=>phase==='prepare'?f.preparingHeld===1:f.held===1);await f.client.create('QA_PROJECT');const b=f.client.getSnapshot().selectedId;f.client.set(b,'draft','B_UNCHANGED');await f.client.select(f.id);
  hold.release();await assert.rejects(pending,{code:'PLAN_SESSION_CHANGED'});assert.equal(f.commits,0);assert.equal(f.client.viewFor(b).draft,'B_UNCHANGED');
 }
});
test('single-node unknown apply observes the original result without a second apply or duplicate receipt',async t=>{
 const f=await fixture(t,{service:{observationMs:10}}),hold=f.holdConsume(),pending=f.planner.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE',{x:1000,y:0},{receipt:'SINGLE_APPLIED',intent:'qa-single-unknown'});
 await until(()=>f.held===1);await assert.rejects(pending,{code:'OPERATION_OUTCOME_UNKNOWN'});assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'uncertain');assert.equal(f.commits,0);
 hold.release();await until(()=>f.commits===1);await f.planner.recover(f.id);assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'applied');assert.equal(f.operations.filter(x=>x==='canvas.plan.apply').length,1);assert.equal(f.client.viewFor(f.id).messages.filter(m=>m.text==='SINGLE_APPLIED').length,1);
});
test('uncertain read preparation is not mistaken for an uncertain mutation or replayed automatically',async t=>{
 const f=await fixture(t),read=f.bridge.applicationOperationReadInternal;f.bridge.applicationOperationReadInternal=async()=>{throw Error('QA_TRANSPORT_FAILURE');};
 await assert.rejects(f.planner.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE',{x:1000,y:0},{receipt:'NO',intent:'qa-single-read-failure'}),{code:'PLAN_PREPARE_FAILED'});
 assert.equal(f.commits,0);assert(!f.client.viewFor(f.id).canvasPlan.pendingOperation);assert(!f.operations.includes('canvas.plan.apply'));f.bridge.applicationOperationReadInternal=read;
});
test('single-node display/receipt failure after real commit stays uncertain and recovers without another mutation',async t=>{
 const f=await fixture(t),set=f.client.set.bind(f.client);let thrown=false;
 f.client.set=(id,key,value)=>{if(key==='messages'&&f.commits===1&&!thrown){thrown=true;throw Error('QA_DISPLAY_FAILURE');}return set(id,key,value);};
 await assert.rejects(f.planner.createSingle(f.id,'QA_PROJECT','text','QA_SINGLE',{x:1000,y:0},{receipt:'RECOVERED',intent:'qa-single-display'}),{code:'OPERATION_OUTCOME_UNKNOWN'});
 assert.equal(f.commits,1);assert.equal(f.state.nodes.length,3);assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'uncertain');
 await f.planner.recover(f.id);assert.equal(f.commits,1);assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'applied');assert.equal(f.client.viewFor(f.id).messages.filter(m=>m.text==='RECOVERED').length,1);
});
test('planning uses scoped wire context, original encrypted user transcript and explicit apply/undo; duplicates do not repeat changes or receipts',async t=>{
 const f=await fixture(t);await f.request();assert.equal(f.requests.length,1);assert.equal(f.commits,0);const v=f.client.viewFor(f.id);assert.equal(v.canvasPlan.phase,'preview');
 for(const privateValue of ['PRIVATE_MEDIA','PRIVATE_NODE_TEXT','PRIVATE_NODE_LABEL'])assert.equal(f.requests[0].prompt.includes(privateValue),false);
 assert.equal((await f.repository.readSession(f.id)).value.messages[0].content,'Build a synthetic draft');
 const result=await f.planner.apply(f.id,'QA_PROJECT','APPLIED_LOCAL');assert.equal(result.generationStarted,false);assert.equal(f.commits,1);assert.equal(f.state.nodes.length,3);
 const count=v.messages.length;assert.equal((await f.planner.apply(f.id,'QA_PROJECT','NO_DUPLICATE_RECEIPT')).replayed,true);assert.equal(v.messages.length,count);assert.equal(f.commits,1);
 await f.planner.undo(f.id,'QA_PROJECT','UNDONE_LOCAL');assert.equal(f.state.nodes.length,2);const after=v.messages.length;assert.equal((await f.planner.undo(f.id,'QA_PROJECT','NO_DUPLICATE_UNDO')).replayed,true);assert.equal(v.messages.length,after);assert.equal(f.commits,2);
});
test('reply and draft remain owned by A after switching to B; an old selected-session button cannot apply',async t=>{
 const f=await fixture(t),hold=f.hold(),pending=f.request();await until(()=>f.requests.length===1);
 await f.client.create('QA_PROJECT');const b=f.client.getSnapshot().selectedId;f.client.set(b,'draft','PRIVATE_B_DRAFT');hold.release();await pending;
 assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'preview');assert.equal(f.client.viewFor(b).canvasPlan.phase,'idle');assert.equal(f.client.viewFor(b).draft,'PRIVATE_B_DRAFT');
 assert.throws(()=>f.planner.apply(f.id,'QA_PROJECT','NO'),{code:'PLAN_SESSION_CHANGED'});assert.equal(f.commits,0);
 await f.client.select(f.id);await f.planner.apply(f.id,'QA_PROJECT','YES');assert.equal(f.commits,1);
});
test('duplicate submit is a no-op while one owned model call is pending',async t=>{
 const f=await fixture(t),hold=f.hold(),pending=f.request();await until(()=>f.requests.length===1);
 assert.equal(await f.planner.request(f.id,'QA_PROJECT','duplicate',{custom:false,ready:true,notice:'NO'}),null);assert.equal(f.requests.length,1);hold.release();await pending;
});
test('internal planner uses the real shared dispatcher/service for every read, preview, apply, preflight and undo',async t=>{
 const f=await fixture(t);await f.request();await f.planner.preflight(f.id,'QA_PROJECT');
 await f.planner.apply(f.id,'QA_PROJECT','APPLIED');await f.planner.undo(f.id,'QA_PROJECT','UNDONE');
 assert.deepEqual(f.operations,['canvas.read','canvas.plan.preview','canvas.generation.preflight','canvas.plan.apply','canvas.plan.undo']);
 assert.deepEqual(f.service.list(),[]); // internal jobs do not appear in external approval HUD
});
test('duplicate clicks across new coordinator instances share the same in-flight operation and one receipt',async t=>{
 const f=await fixture(t);await f.request();const hold=f.holdConsume(),one=f.planner.apply(f.id,'QA_PROJECT','APPLIED');await until(()=>f.held===1);
 const second=createAssistantCanvasPlanner(f.client,()=>f.canvas,()=>f.bridge),two=second.apply(f.id,'QA_PROJECT','MUST_NOT_DUPLICATE');assert.equal(one,two);assert.equal(f.commits,0);
 hold.release();await one;assert.equal(f.commits,1);assert.equal(f.operations.filter(x=>x==='canvas.plan.apply').length,1);assert.equal(f.client.viewFor(f.id).messages.filter(m=>m.text==='APPLIED').length,1);
});
test('selection away then back during nonce IPC invalidates the queued confirmation without affecting the other draft',async t=>{
 const f=await fixture(t);await f.request();const hold=f.holdConsume(),pending=f.planner.apply(f.id,'QA_PROJECT','MUST_NOT_EXECUTE');await until(()=>f.held===1);
 await f.client.create('QA_PROJECT');const b=f.client.getSnapshot().selectedId;f.client.set(b,'draft','QA_B_UNCHANGED');await f.client.select(f.id);
 hold.release();await assert.rejects(pending,{code:'PLAN_SESSION_CHANGED'});assert.equal(f.commits,0);assert.equal(f.client.viewFor(b).draft,'QA_B_UNCHANGED');
});
test('selection version is bound at the original click, not after a delayed main prepare starts',async t=>{
 const f=await fixture(t);await f.request();const hold=f.holdPrepare(),pending=f.planner.apply(f.id,'QA_PROJECT','MUST_NOT_EXECUTE');await until(()=>f.preparingHeld===1);
 await f.client.create('QA_PROJECT');await f.client.select(f.id);hold.release();await assert.rejects(pending,{code:'PLAN_SESSION_CHANGED'});assert.equal(f.commits,0);
});
test('uncertain internal operation retains its handle; later Check result observes one actual commit without resubmitting',async t=>{
 const f=await fixture(t,{service:{observationMs:10}});await f.request();const hold=f.holdConsume();
 await assert.rejects(f.planner.apply(f.id,'QA_PROJECT','APPLIED_LATE'),{code:'OPERATION_OUTCOME_UNKNOWN'});
 const view=f.client.viewFor(f.id),pending=view.canvasPlan.pendingOperation;assert(pending.handle.id);assert.equal(view.canvasPlan.phase,'uncertain');assert.equal(f.commits,0);
 assert.throws(()=>f.planner.begin(f.id,'QA_PROJECT'),{code:'ASSISTANT_BUSY'});hold.release();await until(()=>f.commits===1);
 await until(()=>f.service.read('internal:'+f.id,pending.handle.id).status==='completed');const count=f.operations.length;
 await f.planner.recover(f.id);assert.equal(view.canvasPlan.phase,'applied');assert.equal(view.canvasPlan.pendingOperation,null);assert.equal(f.operations.length,count);assert.equal(f.commits,1);assert.equal(view.messages.filter(m=>m.text==='APPLIED_LATE').length,1);
});
test('missing shared bridge never silently executes through the direct canvas controller',async t=>{
 const f=await fixture(t),planner=createAssistantCanvasPlanner(f.client,()=>f.canvas,()=>undefined);planner.begin(f.id,'QA_PROJECT');
 await assert.rejects(planner.request(f.id,'QA_PROJECT','NO_DIRECT_FALLBACK',{custom:false,ready:true,notice:'NO'}),{code:'OPERATION_PERMISSION_REQUIRED'});assert.equal(f.commits,0);assert.equal(f.requests.length,0);
});
test('observed project switches permanently expire all loaded session controls, including a delayed response',async t=>{
 const f=await fixture(t);await f.request();const first=f.client.viewFor(f.id),p=first.canvasPlan.preview.planId;
 await f.client.create('QA_PROJECT');const other=f.client.getSnapshot().selectedId;f.client.set(other,'canvasPlan',{phase:'scope',projectId:'QA_PROJECT'});
 f.client.observeCanvasProject('OTHER');assert.equal(first.canvasPlan.phase,'expired');assert.equal(f.client.viewFor(other).canvasPlan.phase,'expired');
 f.client.observeCanvasProject('QA_PROJECT');await f.client.select(f.id);assert.equal(first.canvasPlan.phase,'expired');assert.throws(()=>f.canvas.execute(p),{code:'PLAN_EXPIRED'});assert.equal(f.commits,0);
 const hold=f.hold(),pending=f.request();await until(()=>f.requests.length===2);f.client.observeCanvasProject('OTHER');hold.release();await pending;
 assert.equal(first.canvasPlan.phase,'expired');assert.equal(first.canvasPlan.code,'PLAN_STALE');assert.equal(f.commits,0);
});
test('edited fields require revalidation; invalid parameters never apply; fixes need no second model request',async t=>{
 const f=await fixture(t);await f.request();f.planner.edit(f.id,0,'imageSize','INVENTED');
 assert.throws(()=>f.planner.apply(f.id,'QA_PROJECT','NO'),{code:'PLAN_REVIEW_REQUIRED'});
 await f.planner.validate(f.id,'QA_PROJECT');assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'invalid');assert.equal(f.commits,0);
 f.planner.edit(f.id,0,'imageSize','1K');f.planner.edit(f.id,0,'prompt','SYNTHETIC_REVIEWED_TEXT');await f.planner.validate(f.id,'QA_PROJECT');
 await f.planner.apply(f.id,'QA_PROJECT','YES');assert.equal(f.state.nodes.at(-1).data.prompt,'SYNTHETIC_REVIEWED_TEXT');assert.equal(f.requests.length,1);
});
test('preflight stays local and session-owned, rejects dirty or wrong-project state and refreshes applied state without reviving undo',async t=>{
 const f=await fixture(t);await f.request();const preview=await f.planner.preflight(f.id,'QA_PROJECT');assert.equal(preview.basis,'proposal');assert.equal(preview.canGenerate,false);assert.equal(f.commits,0);
 assert.throws(()=>f.planner.preflight(f.id,'WRONG'),{code:'PLAN_STALE'});
 f.planner.edit(f.id,0,'prompt','QA_EDIT');assert.throws(()=>f.planner.preflight(f.id,'QA_PROJECT'),{code:'PLAN_REVIEW_REQUIRED'});
 await f.planner.validate(f.id,'QA_PROJECT');await f.planner.apply(f.id,'QA_PROJECT','APPLIED');f.state.nodes.at(-1).data.loading=true;f.canvas.observe();
 const current=await f.planner.preflight(f.id,'QA_PROJECT');assert.equal(current.basis,'current');assert.equal(current.nodes[0].taskIdle,false);assert.equal(f.requests.length,1);assert.equal(f.commits,1);
 await assert.rejects(f.planner.undo(f.id,'QA_PROJECT','NO'),{code:'PLAN_UNDO_CONFLICT'});
 await f.client.create('QA_PROJECT');assert.throws(()=>f.planner.preflight(f.id,'QA_PROJECT'),{code:'PLAN_SESSION_CHANGED'});
});
test('manual edits and wrong current project invalidate confirmation; undo never overwrites later user edits',async t=>{
 const f=await fixture(t);await f.request();assert.throws(()=>f.planner.apply(f.id,'WRONG_PROJECT','NO'),{code:'PLAN_STALE'});assert.equal(f.commits,0);
 f.state.nodes[1].data.text='MANUAL_BEFORE_APPLY';await assert.rejects(f.planner.apply(f.id,'QA_PROJECT','NO'),{code:'PLAN_STALE'});assert.equal(f.commits,0);
 await f.request();await f.planner.apply(f.id,'QA_PROJECT','YES');f.state.nodes[1].data.text='MANUAL_AFTER_APPLY';f.canvas.observe();await assert.rejects(f.planner.undo(f.id,'QA_PROJECT','NO'),{code:'PLAN_UNDO_CONFLICT'});assert.equal(f.state.nodes[1].data.text,'MANUAL_AFTER_APPLY');
});
test('content sharing is explicit, secret content is stopped before provider; default sharing stays structural',async t=>{
 const f=await fixture(t);f.state.nodes[1].data.text='password: DO_NOT_SEND_THIS_VALUE';
 f.planner.begin(f.id,'QA_PROJECT');f.planner.configure(f.id,{includeContent:true});await assert.rejects(f.planner.request(f.id,'QA_PROJECT','Plan',{custom:false,ready:true,notice:'NO'}),{code:'ASSISTANT_SENSITIVE_INPUT'});assert.equal(f.requests.length,0);
 f.planner.configure(f.id,{includeContent:false});await f.planner.request(f.id,'QA_PROJECT','Plan',{custom:false,ready:true,notice:'OK'});assert.equal(f.requests.length,1);assert.equal(f.requests[0].prompt.includes('DO_NOT_SEND'),false);
});
test('cancelled/invalid replies create no mutation or automatic retries',async t=>{
 const f=await fixture(t),hold=f.hold(),pending=f.request();await until(()=>f.requests.length===1);f.client.viewFor(f.id).refs.modelCancellationRequested.current=true;await f.client.cancel(f.id);hold.release();await pending;
 assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'failed');assert.equal(f.commits,0);
 f.setReply('{"version":1,"operations":[{"op":"generate"}]}');await f.request();assert.equal(f.client.viewFor(f.id).canvasPlan.phase,'failed');assert.equal(f.requests.length,2);assert.equal(f.commits,0);
});
test('normal client restart restores history, never a plan controller or execution authority',async t=>{
 const f=await fixture(t);await f.request();await f.client.flushAll();const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize('QA_PROJECT');assert.equal(fresh.viewFor(f.id).canvasPlan.phase,'idle');assert.equal(fresh.viewFor(f.id).messages.at(-1).text,'PREVIEW_READY');await fresh.flushAll();
 assert.equal(JSON.stringify((await f.repository.readSession(f.id)).value).includes('ticketId'),false);
});
test('shared wire schema rejects content without opt-in, private extras and out-of-scope edges; reply parser accepts only JSON',async t=>{
 const f=await fixture(t),captured=f.canvas.capture();const wire={version:1,scope:captured.scope,includeContent:false,nodes:captured.nodes,edges:captured.edges,capabilities:captured.capabilities};
 for(const change of [v=>v.apiKey='NO',v=>v.nodes[0].imageUrl='file:///NO',v=>v.nodes[0].content={text:'NO'},v=>v.edges=[{source:'unexposed',target:'text'}]]){const candidate=structuredClone(wire);change(candidate);assert.throws(()=>validateCanvasPlanningRequest(candidate),{code:'ASSISTANT_INVALID_MESSAGE'});}
 assert.deepEqual(parseCanvasPlanningReply('```json\n'+JSON.stringify(plan)+'\n```'),plan);
 for(const reply of ['I executed it!','prefix '+JSON.stringify(plan),JSON.stringify(plan)+' suffix'])assert.throws(()=>parseCanvasPlanningReply(reply),{code:'PLAN_INVALID_RESPONSE'});
});
test('captured project names stay local rather than following a later project label or entering model context',async t=>{
 const f=await fixture(t);f.planner.begin(f.id,'QA_PROJECT','PRIVATE_PROJECT_NAME');await f.planner.request(f.id,'QA_PROJECT','Build',{custom:false,ready:true,notice:'READY'});
 assert.equal(f.client.viewFor(f.id).canvasPlan.projectName,'PRIVATE_PROJECT_NAME');assert.equal(f.requests[0].prompt.includes('PRIVATE_PROJECT_NAME'),false);
});
test('an unconfirmed native runtime close retains the existing reset/proposal fence',async t=>{
 const f=await fixture(t);f.bridge.assistantWorkspaceSend=async()=>({ok:false,code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});await f.request();
 assert.equal(f.client.viewFor(f.id).requiresReset,true);assert.equal(f.client.viewFor(f.id).refs.proposalFence.current,true);assert.equal(f.commits,0);
});
test('the actual UI error handler never claims no canvas change after a committed operation has only a display failure',()=>{
 const file=path.resolve(__dirname,'../src/renderer/components/assistant-onboarding.tsx'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='canvasFailure')handler=node.getText(tree);ts.forEachChild(node,visit);};visit(tree);assert(handler);
 const code=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,copy=require('../src/renderer/lib/assistant-canvas-copy.ts');
 for(const language of ['zh-CN','zh-TW','en-US'])for(const phase of ['preview','applied','undone']){
  let notice='';const context={...copy,language,workspace:{id:'owner',controller:{viewFor:()=>({canvasPlan:{phase}})}},setChatNotice:value=>notice=value};
  const fn=require('node:vm').runInNewContext(code+'\ncanvasFailure',context);fn(Error('PRIVATE_DISPLAY_ERROR'));
  assert.equal(notice,['applied','undone'].includes(phase)?copy.assistantCanvasPostCommitNotice(language):copy.assistantCanvasError('PLAN_REQUEST_FAILED',language));assert.equal(notice.includes('PRIVATE_DISPLAY_ERROR'),false);
  fn({code:'PLAN_UNDO_CONFLICT'});assert.equal(notice,copy.assistantCanvasError('PLAN_UNDO_CONFLICT',language));
 }
});
