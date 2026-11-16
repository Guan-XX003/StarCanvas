const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const input=(operation,args={},key='synthetic-request-0001')=>({operation,arguments:args,idempotencyKey:key,...(operation.startsWith('canvas.')?{projectId:'qa-project'}:{})});
const settle=async(fn,expected)=>{const end=Date.now()+2000;let value;do{value=fn();if(expected(value))return value;await new Promise(setImmediate);}while(Date.now()<end);assert.fail('Request did not reach expected state: '+JSON.stringify(value));};
function fixture(t,options={}){
 let state={projectId:'qa-project',instanceId:'qa-mount',ready:true,nodes:[{id:'existing',type:'textNode',position:{x:0,y:0},selected:true,data:{text:'PRIVATE_QA_CONTENT',apiKey:'PRIVATE_QA_KEY'}}],edges:[]},commits=0,clock=1000,count=0;
 const controller=createCanvasPlanController({read:()=>state,capabilities:()=>({textNode:{models:[],parameters:{}}}),now:()=>clock,id:()=>`qa-${++count}`,prepareNode:(type,position,data)=>({id:data.__nodeId,type,position,data:{text:'',...data}}),commit:(_b,after)=>{commits++;state=after;}});
 let service,active=controller;
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>state.projectId,getProjects:()=>[{id:'qa-project',name:'PRIVATE_PROJECT_NAME'}],getCanvas:()=>active,getAutomation:()=>({status:async()=>({ready:true,version:'QA',token:'PRIVATE_TOKEN'}),generateImage:()=>assert.fail('No paid generation')}),consume:async(id,nonce)=>{options.beforeConsume?.();return service.consume(id,nonce);},now:()=>clock});
 service=createApplicationOperationService({prepare:dispatcher.prepare,commit:dispatcher.commit,release:dispatcher.release,now:()=>clock,...options.service});
 t.after(()=>{service.close();dispatcher.close();});
 const submit=(op,args,key)=>service.submit('external',input(op,args,key));
 const read=handle=>service.read('external',handle.request.id,handle.receipt);
 const completed=handle=>settle(()=>read(handle),r=>['completed','failed','outcome_unknown'].includes(r.status));
 const waiting=handle=>settle(()=>read(handle),r=>r.status==='awaiting_confirmation');
 async function plan(){const r=await submit('canvas.read',{},'synthetic-read-0001'),ticket=(await completed(r)).result.ticketId;
  const p=await submit('canvas.plan.preview',{ticketId:ticket,proposal:{version:1,operations:[{op:'create',key:'draft',kind:'text',position:{x:400,y:0},fields:{text:'QA_NEW_DRAFT'}}]}},'synthetic-preview-0001');return (await completed(p)).result;}
 return {service,dispatcher,submit,read,completed,waiting,plan,controller,get commits(){return commits;},get state(){return state;},advance(){clock+=600001;},remount(){active={...controller};}};
}
test('strict operation request rejects permission flags, arbitrary commands, media and malformed fields',async()=>{
 const {parseApplicationOperationRequest}=await import('../electron/shared/application-operation-contract.mjs');
 for(const value of [{...input('canvas.read'),confirmed:true},input('generation.image'),input('canvas.read',{path:'/NO_READ'}),input('canvas.plan.apply',{planId:'x',permissions:['canvas.edit']}),{...input('app.status'),idempotencyKey:'short'}])assert.throws(()=>parseApplicationOperationRequest(value));
});
test('preparation failure publishes terminal status and sanitized reason atomically',async t=>{
 const service=createApplicationOperationService({prepare:async()=>{throw Object.assign(Error('PRIVATE_PREPARATION_ERROR'),{code:'OPERATION_NAVIGATION_REFUSED'});},commit:()=>assert.fail('No mutation')});t.after(()=>service.close());
 const h=await service.submit('external',input('app.status'));let failed=false;
 for(let i=0;i<20;i++){const r=service.read('external',h.request.id,h.receipt);if(r.status==='failed'){assert.equal(r.code,'OPERATION_NAVIGATION_REFUSED');assert(!JSON.stringify(r).includes('PRIVATE'));failed=true;break;}await Promise.resolve();}
 assert(failed,'preparation settles during observed microtasks');
});
test('actor and idempotency key are an unambiguous tuple, never a cross-owner delimiter collision',async t=>{
 let service;service=createApplicationOperationService({prepare:async()=>({}),commit:async({requestId,nonce})=>({owner:service.consume(requestId,nonce).actor})});t.after(()=>service.close());
 const a=await service.submit('internal:QA_A',input('app.status',{},'QA_B:shared-idempotency-0001'));
 const b=await service.submit('internal:QA_A:QA_B',input('app.status',{},'shared-idempotency-0001'));assert.notEqual(a.request.id,b.request.id);assert.equal(b.replayed,false);
 await settle(()=>service.read('internal:QA_A',a.request.id),r=>r.status==='completed');
 assert.throws(()=>service.read('internal:QA_A:QA_B',a.request.id),{code:'OPERATION_NOT_FOUND'});
 assert.equal(service.read('internal:QA_A',a.request.id).result.owner,'internal:QA_A');
});
test('metadata/default structural reads complete without content; exact receipt required',async t=>{
 const f=fixture(t),h=await f.submit('canvas.read');const r=await f.completed(h);assert.equal(r.status,'completed');assert(!JSON.stringify(r).includes('PRIVATE'));
 for(const receipt of ['wrong','é'.repeat(64)])assert.throws(()=>f.service.read('external',h.request.id,receipt),{code:'OPERATION_NOT_FOUND'});
 const projects=await f.completed(await f.submit('projects.list',{},'synthetic-projects-0001'));assert.deepEqual(projects.result,{projects:[{id:'qa-project',active:true}]});
 assert.equal(f.commits,0);assert.equal(f.service.list().length,0);
});
test('node-content read needs trusted App approval; external response and review omit content until confirmation',async t=>{
 const f=fixture(t),h=await f.submit('canvas.read',{includeContent:true}),w=await f.waiting(h);
 assert(!JSON.stringify(w).includes('PRIVATE'));assert(!JSON.stringify(f.service.list()).includes('PRIVATE'));
 assert.throws(()=>f.service.consume(h.request.id,'0'.repeat(64)),{code:'OPERATION_INVALID_AUTHORITY'});
 assert.throws(()=>f.service.approve(h.request.id,w.revision-1),{code:'OPERATION_EXPIRED'});
 f.service.approve(h.request.id,w.revision);const result=await f.completed(h);assert.equal(result.status,'completed');assert.equal(result.result.nodes[0].content.text,'PRIVATE_QA_CONTENT');assert(!JSON.stringify(result).includes('PRIVATE_QA_KEY'));
});
test('real controller creates once only after approval; same idempotency key replays and undo shares same path',async t=>{
 const f=fixture(t),p=await f.plan(),a={planId:p.planId},h=await f.submit('canvas.plan.apply',a,'synthetic-apply-0001'),w=await f.waiting(h);
 assert.equal(f.commits,0);assert.equal(f.service.list()[0].review.preview.counts.created,1);
 const replay=await f.submit('canvas.plan.apply',a,'synthetic-apply-0001');assert.equal(replay.request.id,h.request.id);assert.equal(replay.replayed,true);
 f.service.approve(h.request.id,w.revision);f.service.approve(h.request.id,w.revision);
 const result=await f.completed(h);assert.equal(result.status,'completed');assert.equal(result.result.generationStarted,false);assert.equal(f.commits,1);assert.equal(f.state.nodes.length,2);
 assert.equal((await f.submit('canvas.plan.apply',a,'synthetic-apply-0001')).request.status,'completed');assert.equal(f.commits,1);
 const undo=await f.submit('canvas.plan.undo',a,'synthetic-undo-0001'),uw=await f.waiting(undo);f.service.approve(undo.request.id,uw.revision);assert.equal((await f.completed(undo)).result.status,'undone');assert.equal(f.state.nodes.length,1);
});
test('manual edit after review or during grant IPC prevents all stale mutations',async t=>{
 for(const during of [false,true]){
  let mutate;const f=fixture(t,{beforeConsume:()=>mutate?.()}),p=await f.plan(),h=await f.submit('canvas.plan.apply',{planId:p.planId},'synthetic-stale-0001'),w=await f.waiting(h);
  const edit=()=>{f.state.nodes[0].data.text='QA_MANUAL';};if(during)mutate=edit;else edit();
  f.service.approve(h.request.id,w.revision);const r=await f.completed(h);assert.equal(r.status,'failed');assert.equal(r.code,'PLAN_STALE');assert.equal(f.commits,0);
 }
});
test('project away/back, remount, owner mismatch and expired reads cannot revive authority',async t=>{
 const f=fixture(t),h=await f.submit('canvas.read',{includeContent:true}),w=await f.waiting(h);f.state.projectId='other';f.controller.observe();f.state.projectId='qa-project';
 f.service.approve(h.request.id,w.revision);assert.equal((await f.completed(h)).code,'PLAN_EXPIRED');
 const p=await f.plan(),a=await f.submit('canvas.plan.apply',{planId:p.planId},'synthetic-remount-0001'),aw=await f.waiting(a);f.remount();f.service.approve(a.request.id,aw.revision);assert.equal((await f.completed(a)).code,'PLAN_STALE');assert.equal(f.commits,0);
 await assert.rejects(()=>f.dispatcher.prepare({requestId:'rogue',actor:'internal:OTHER_SESSION',expiresAt:900000,request:input('canvas.plan.apply',{planId:p.planId})}),{code:'PLAN_SESSION_CHANGED'});
 f.advance();assert.throws(()=>f.service.approve(a.request.id,aw.revision),{code:'OPERATION_NOT_FOUND'});assert.equal((await f.submit('canvas.plan.apply',{planId:p.planId},'synthetic-remount-0001')).request.resultExpired,true);
});
test('reject/cancel invalidate pending content tickets; idempotency cannot replace payload',async t=>{
 const f=fixture(t),h=await f.submit('canvas.read',{includeContent:true}),w=await f.waiting(h);f.service.reject(h.request.id,w.revision);assert.equal(f.read(h).status,'rejected');assert.equal(f.commits,0);
 await assert.rejects(()=>f.submit('canvas.read',{scope:'structure'},'synthetic-request-0001'),{code:'OPERATION_IDEMPOTENCY_CONFLICT'});
 const other=await f.submit('canvas.read',{includeContent:true},'synthetic-cancel-0001');await f.waiting(other);f.service.cancel('external',other.request.id,other.receipt);assert.equal(f.read(other).status,'cancelled');
 assert.throws(()=>f.service.approve(other.request.id,1),{code:'OPERATION_EXPIRED'});
});
test('observation timeout retains unknown outcome and same handle settles later without re-execution',async t=>{
 let service,resolve,commits=0;
 service=createApplicationOperationService({prepare:async()=>({}),observationMs:10,commit:async({requestId,nonce})=>{service.consume(requestId,nonce);commits++;await new Promise(r=>resolve=r);return {actual:true};}});t.after(()=>service.close());
 const h=await service.submit('external',input('app.status')),read=()=>service.read('external',h.request.id,h.receipt);
 await new Promise(r=>setTimeout(r,25));assert.equal(read().status,'outcome_unknown');assert.throws(()=>service.cancel('external',h.request.id,h.receipt),{code:'OPERATION_TOO_LATE'});
 assert.equal((await service.submit('external',input('app.status'))).replayed,true);assert.equal(commits,1);resolve();await settle(read,r=>r.status==='completed');assert.equal(commits,1);
});
test('one-shot nonce cannot replay; post-consumption serialization or uncertain commit never reports clean failure',async t=>{
 for(const uncertain of [false,true]){
  let service;service=createApplicationOperationService({prepare:async()=>({}),commit:async({requestId,nonce})=>{service.consume(requestId,nonce);assert.throws(()=>service.consume(requestId,nonce),{code:'OPERATION_INVALID_AUTHORITY'});if(uncertain)throw Object.assign(Error('PRIVATE_ERROR'),{code:'PLAN_COMMIT_UNCERTAIN'});return {callback(){}};}});t.after(()=>service.close());
  const h=await service.submit('external',input('app.status'));const r=await settle(()=>service.read('external',h.request.id,h.receipt),r=>r.status==='outcome_unknown');assert(!JSON.stringify(r).includes('PRIVATE_ERROR'));
 }
});
