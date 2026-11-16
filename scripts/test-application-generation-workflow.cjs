const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {createApplicationOperationWorkflowService}=require('../electron/main/application-operation-workflow.cjs');
const raw=(extra={},operation='generation.image',key='qa-workflow-request-0001')=>({operation,projectId:'QA_PROJECT',arguments:{prompt:'QA_PROMPT',referenceImage:'/PRIVATE_QA.png',...extra},idempotencyKey:key});
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){const end=Date.now()+3000;while(Date.now()<end){const result=fn();if(result)return result;await new Promise(setImmediate);}assert.fail('Workflow did not settle');}
function fixture(t,options={}){
 let clock=1000,service,project='QA_PROJECT',selection=1,imported=0,generated=0;
 const prepared=new Map(),commits=[],preparations=[];
 const base=createApplicationOperationService({now:()=>clock,observationMs:options.observationMs??10000,
  async prepare(info){preparations.push(info);prepared.set(info.requestId,info);await options.prepare?.(info);return {kind:info.request.operation};},
  async commit({requestId,nonce}){
   const grant=service.consume(requestId,nonce),info=prepared.get(requestId);commits.push(info);
   if(info.request.projectId&&info.request.projectId!==project)throw Object.assign(Error('PRIVATE'),{code:'PLAN_PROJECT_BINDING'});
   if(grant.actor!=='external'&&info.selectionVersion!==selection)throw Object.assign(Error('PRIVATE'),{code:'PLAN_SESSION_CHANGED'});
   await options.commit?.(info);
   if(info.request.operation==='media.import'){imported++;return {imported:true,referenceId:'reference-'+crypto.randomUUID()};}
   if(info.request.operation.startsWith('generation.')){generated++;return {accepted:true,nodeId:'QA_NODE',generationStarted:true,generationCompleted:false};}
   return {ready:true};
  },
 });
 const submitGate=options.submitGate;
 const delegated=submitGate?{...base,async submit(...args){const h=await base.submit(...args);await submitGate.promise;return h;}}:base;
 service=createApplicationOperationWorkflowService(delegated,{now:()=>clock});
 t.after(()=>service.close());
 const submit=(request=raw(),actor='external',context={selectionVersion:1})=>service.submit(actor,request,context);
 const read=(h,actor='external')=>service.read(actor,h.request.id,h.receipt);
 const waiting=(h,index=1,actor='external')=>until(()=>{const r=read(h,actor);return r.status==='awaiting_confirmation'&&r.workflow.stepIndex===index&&r;});
 const settled=(h,actor='external')=>until(()=>{const r=read(h,actor);return ['completed','failed','cancelled','rejected','expired'].includes(r.status)&&r;});
 return {base,service,submit,read,waiting,settled,preparations,commits,get imported(){return imported;},get generated(){return generated;},advance:n=>clock+=n,setProject:p=>project=p,setSelection:n=>selection=n};
}
test('legacy adapter is pure and keeps typed order, scalar validation and canonical raw-input refusal',async()=>{
 const {parseApplicationGenerationWorkflow:parse}=await import('../electron/shared/application-generation-workflow.mjs'),{parseApplicationOperationRequest:canonical}=await import('../electron/shared/application-operation-contract.mjs');
 const parsed=parse(raw());assert.deepEqual(parsed.sources,[{source:'/PRIVATE_QA.png',type:'image'}]);assert.equal(parsed.generation.arguments.referenceImage,'');assert.throws(()=>canonical(raw()),{code:'OPERATION_MEDIA_SCOPE_REQUIRED'});
 const typed=parse(raw({referenceImage:'',images:['https://example.com/a.png'],videos:['C:\\QA\\v.mp4'],audios:['/QA/a.wav']},'generation.tianji'));
 assert.deepEqual(typed.sources.map(s=>s.type),['image','video','audio']);assert.equal(typed.generation.arguments.mode,'reference-media');
 for(const request of [raw({referenceImage:42,images:['/QA/a.png']},'generation.tianji'),raw({duration:-1},'generation.video'),raw({source:'/PRIVATE'}),{...raw(),confirmed:true},raw({references:['reference-'+crypto.randomUUID()]}),raw({images:['/QA/a.png'],portraitAssetIds:['asset://not-an-id']},'generation.tianji'),raw({referenceImage:'',images:['/QA/a.png'],mode:'text-to-video'},'generation.tianji'),raw({referenceImage:'',images:['/QA/a.png'],mode:'first-last'},'generation.tianji'),raw({referenceImage:'https://user:secret@example.com/a.png'}),raw({referenceImage:'',images:['/QA/a.png','/QA/a.png']},'generation.tianji')])assert.throws(()=>parse(request));
 assert.deepEqual(parse(raw({portraitAssetIds:['asset-id']},'generation.tianji')).generation.arguments.portraitAssetIds,['asset-id']);
 assert.equal(parse({operation:'app.status',arguments:{}}),null);
});
test('stable parent stages ordinary imports and paid generation with distinct App approvals, once',async t=>{
 const f=fixture(t),h=await f.submit(),first=await f.waiting(h);
 assert.equal(f.imported,0);assert.equal(f.generated,0);assert(!JSON.stringify(first).includes('PRIVATE'));
 const leaf=f.service.list()[0];assert.equal(leaf.operation,'media.import');assert.equal(leaf.workflow.id,h.request.id);assert.equal(leaf.workflow.totalSteps,2);
 assert.throws(()=>f.service.consume(h.request.id,'a'.repeat(64)),{code:'OPERATION_INVALID_AUTHORITY'});
 f.service.approve(leaf.id,leaf.revision);const second=await f.waiting(h,2);
 assert.equal(f.imported,1);assert.equal(f.generated,0);assert.equal(second.workflow.stage,'generation');
 assert.throws(()=>f.service.approve(h.request.id,first.revision),{code:'OPERATION_EXPIRED'});
 f.service.approve(h.request.id,second.revision);f.service.approve(h.request.id,second.revision);
 const done=await f.settled(h);assert.equal(done.status,'completed');assert.equal(done.result.nodeId,'QA_NODE');assert.equal(done.result.generationCompleted,false);assert.equal(f.generated,1);
 assert.equal((await f.submit()).request.id,h.request.id);assert.equal((await f.submit()).replayed,true);assert.equal(f.commits.length,2);
 assert(!JSON.stringify(done).includes('reference-'));assert(!JSON.stringify(done).includes('PRIVATE'));
});
test('every typed source needs its own import approval, and order/mode survive into the final canonical request',async t=>{
 const f=fixture(t),h=await f.submit(raw({referenceImage:'',images:['/QA/a.png','/QA/b.png'],videos:['/QA/a.mp4'],audios:['/QA/a.wav']},'generation.tianji'));
 for(let step=1;step<=4;step++){const w=await f.waiting(h,step);assert.equal(f.imported,step-1);assert.equal(f.generated,0);f.service.approve(h.request.id,w.revision);}
 const w=await f.waiting(h,5);assert.equal(w.workflow.importsCompleted,4);assert.equal(f.generated,0);f.service.approve(h.request.id,w.revision);assert.equal((await f.settled(h)).status,'completed');
 assert.deepEqual(f.preparations.slice(0,4).map(p=>p.request.arguments.type),['image','image','video','audio']);const final=f.preparations[4].request.arguments;assert.equal(final.mode,'reference-media');assert.equal(final.references.length,4);assert.deepEqual(final.images,[]);assert.equal(final.referenceImage,'');
});
test('canonical and workflow payloads share idempotency even under concurrent submissions',async t=>{
 for(const reversed of [false,true]){const f=fixture(t),a=raw(),b=raw({referenceImage:''}),inputs=reversed?[b,a]:[a,b];
  const results=await Promise.allSettled(inputs.map(i=>f.submit(i)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'OPERATION_IDEMPOTENCY_CONFLICT');assert.equal(f.commits.length,0);
 }
 const f=fixture(t),results=await Promise.all([f.submit(),f.submit(),f.submit()]);assert.equal(new Set(results.map(h=>h.request.id)).size,1);await f.waiting(results[0]);assert.equal(f.preparations.length,1);
});
test('direct canonical requests still replay current state, not their initial pending snapshot',async t=>{
 const f=fixture(t),request={operation:'app.status',arguments:{},idempotencyKey:'qa-direct-current-0001'},h=await f.submit(request);await until(()=>f.read(h).status==='completed');const again=await f.submit(request);assert.equal(again.request.status,'completed');assert.equal(again.replayed,true);assert.equal(f.commits.length,1);
});
test('a guessed child key cannot borrow the workflow child reference or existing authorization',async t=>{
 const f=fixture(t),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await f.waiting(h,2);
 const child=f.preparations[0].request,guessed=await f.submit(child);assert.notEqual(guessed.request.id,f.preparations[0].requestId);assert.equal(guessed.replayed,false);assert.equal(guessed.request.result,undefined);assert.equal(f.imported,1);
});
test('parent receipts and actors are scoped; internal stages retain the original selection version',async t=>{
 const f=fixture(t),h=await f.submit();await f.waiting(h);
 for(const [actor,receipt]of [['external','a'.repeat(64)],['internal:A',h.receipt]])assert.throws(()=>f.service.read(actor,h.request.id,receipt),{code:'OPERATION_NOT_FOUND'});
 await assert.rejects(f.submit(raw({},'generation.image','qa-missing-selection-0001'),'internal:A',{}),{code:'OPERATION_INVALID_AUTHORITY'});
 const internal=await f.submit(raw({},'generation.image','qa-internal-selection-0001'),'internal:A'),first=await f.waiting(internal,1,'internal:A');f.service.approve(internal.request.id,first.revision);await f.waiting(internal,2,'internal:A');f.setSelection(2);const second=f.read(internal,'internal:A');f.service.approve(internal.request.id,second.revision);assert.equal((await f.settled(internal,'internal:A')).code,'PLAN_SESSION_CHANGED');assert.equal(f.generated,0);assert(f.preparations.filter(p=>p.actor==='internal:A').every(p=>p.selectionVersion===1));
});
test('reject or cancel at either approval blocks all remaining steps',async t=>{
 for(const stage of [1,2])for(const cancel of [false,true]){const f=fixture(t),h=await f.submit();if(stage===2){const first=await f.waiting(h);f.service.approve(h.request.id,first.revision);}const w=await f.waiting(h,stage);
  if(cancel)f.service.cancel('external',h.request.id,h.receipt);else{const leaf=f.service.list().find(r=>r.workflow?.id===h.request.id&&r.status==='awaiting_confirmation');f.service.reject(leaf.id,leaf.revision);}
  assert.equal((await f.settled(h)).status,cancel?'cancelled':'rejected');assert.equal(f.imported,stage-1);assert.equal(f.generated,0);
 }
});
test('unknown import is observed, never repeated; cancellation fences a late completion from generation',async t=>{
 const hold=gate(),f=fixture(t,{observationMs:5,commit:info=>info.request.operation==='media.import'?hold.promise:undefined}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);
 await until(()=>f.read(h).status==='outcome_unknown');for(let i=0;i<10;i++)f.read(h);assert.equal((await f.submit()).replayed,true);assert.equal(f.commits.length,1);
 const cancelled=f.service.cancel('external',h.request.id,h.receipt);assert.equal(cancelled.status,'outcome_unknown');assert.equal(cancelled.workflow.nextStepsCancelled,true);hold.resolve();const done=await f.settled(h);assert.equal(done.status,'cancelled');assert.equal(done.result.approvedMediaMayRemain,true);assert.equal(f.preparations.length,1);assert.equal(f.generated,0);
});
test('without cancellation late import completion creates only the next approval, and a running generation cannot be cancelled as if undone',async t=>{
 const importHold=gate(),generationHold=gate(),f=fixture(t,{observationMs:5,commit:info=>info.request.operation==='media.import'?importHold.promise:generationHold.promise}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.read(h).status==='outcome_unknown');importHold.resolve();const paid=await f.waiting(h,2);assert.equal(f.generated,0);f.service.approve(h.request.id,paid.revision);await until(()=>f.read(h).status==='outcome_unknown');assert.throws(()=>f.service.cancel('external',h.request.id,h.receipt),{code:'OPERATION_TOO_LATE'});generationHold.resolve();assert.equal((await f.settled(h)).status,'completed');assert.equal(f.generated,1);
});
test('cancel before an async child handle arrives accounts for that exact child and leaves no armed approval',async t=>{
 const submitGate=gate(),f=fixture(t,{submitGate}),h=await f.submit();await until(()=>f.base.list().some(r=>r.status==='awaiting_confirmation'));
 assert.equal(f.service.cancel('external',h.request.id,h.receipt).status,'outcome_unknown');submitGate.resolve();assert.equal((await f.settled(h)).status,'cancelled');assert(f.base.list().every(r=>r.status==='cancelled'));assert.equal(f.commits.length,0);
});
test('invalidation during slow import cannot arm paid generation after a late successful import',async t=>{
 const hold=gate(),f=fixture(t,{commit:()=>hold.promise}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.commits.length===1);f.service.invalidate();hold.resolve();await new Promise(setImmediate);await new Promise(setImmediate);assert.equal(f.read(h).status,'outcome_unknown');assert.equal(f.preparations.length,1);assert.equal(f.generated,0);
});
test('invalidation from inside the child commit observes running IO even before the parent observer updates',async t=>{
 let f;f=fixture(t,{commit:()=>f.service.invalidate()});const h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.commits.length===1);assert.equal(f.read(h).status,'outcome_unknown');assert.equal(f.preparations.length,1);assert.equal(f.generated,0);
});
test('all stages share original expiry; malformed deadline or expired approval cannot extend it',async t=>{
 const f=fixture(t);for(const deadline of ['2000',Infinity,999])await assert.rejects(f.submit(raw(), 'external',{deadline}),{code:'OPERATION_EXPIRED'});
 const h=await f.submit(raw(), 'external',{deadline:1100}),w=await f.waiting(h);f.advance(90);f.service.approve(h.request.id,w.revision);const paid=await f.waiting(h,2);assert.equal(paid.expiresAt,1100);assert(f.preparations.every(p=>p.expiresAt===1100));f.advance(11);assert.throws(()=>f.service.approve(h.request.id,paid.revision));const replay=await f.submit();assert.equal(replay.replayed,true);assert.equal(replay.request.resultExpired,true);assert.equal(f.generated,0);
});
test('child errors are bounded and stop the workflow before any paid stage',async t=>{
 const f=fixture(t,{prepare:()=>{throw Error('PRIVATE_PATH_AND_TOKEN');}}),h=await f.submit();const done=await f.settled(h);assert.equal(done.code,'OPERATION_FAILED');assert.equal(f.generated,0);assert(!JSON.stringify(done).includes('PRIVATE'));
});
