// Real task projection + renderer source + main operation service, synthetic
// records only. Task reads must not reach provider, media or canvas IO.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationTaskReader,applicationTaskRecordSnapshot,findApplicationTask}=require('../src/renderer/lib/application-task-records.ts');
const {createAssistantTaskReader}=require('../src/renderer/lib/assistant-task-reader.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {applicationOperationMetadata}=require('../electron/shared/application-operation-policy.mjs');
const {parseApplicationOperationRequest}=require('../electron/shared/application-operation-contract.mjs');
const {applicationTaskStatus,selectLatestApplicationTask}=require('../electron/shared/application-task-data.mjs');
const onboarding=require('../src/renderer/lib/assistant-onboarding.ts'),local=require('../src/renderer/lib/assistant-local-operations.ts');
const record=(extra={})=>({id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'video',status:'running',createdAt:1735689600000,...extra});
const until=async fn=>{const end=Date.now()+2500;while(Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,2));}assert.fail('Task read did not settle');};
function fixture(t,{records=[record()],hold=false,missing=false}={}){
 let source=records,service,selected='A',release,reads=0,submissions=0;const jobs=new Map(),views=new Map(['A','B'].map(owner=>[owner,{draft:'QA_'+owner,messages:[],taskRead:{working:false}}]));
 const client={operationScope:owner=>views.has(owner)?{owner,selected:owner===selected,selectionVersion:1,projectId:'QA_PROJECT'}:null,viewFor:owner=>views.get(owner),set(owner,key,value){views.get(owner)[key]=value;}};
 const sourceReader=createApplicationTaskReader(()=>{reads++;return source;},jobs),dispatcher=createApplicationOperationDispatcher({
  getProjectId:()=>'',getProjects:()=>[],getCanvas:()=>assert.fail('No canvas read'),getAutomation:()=>assert.fail('No generation/media fallback'),getTaskReader:()=>missing?null:sourceReader,getInternalScope:owner=>client.operationScope(owner),
  consume:async(id,nonce)=>{const grant=service.consume(id,nonce);if(hold)await new Promise(r=>release=r);return grant;},
 });
 service=createApplicationOperationService({prepare:dispatcher.prepare,commit:dispatcher.commit,release:dispatcher.release});
 const wrap=fn=>async(...args)=>{try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,code:e.code};}},bridge={
  applicationOperationSubmitInternal:wrap((owner,r)=>{submissions++;return service.submit('internal:'+owner,r);}),applicationOperationReadInternal:wrap((owner,id)=>service.read('internal:'+owner,id)),
 };
 const assistant=createAssistantTaskReader(client,()=>bridge);t.after(()=>{release?.();service.close();dispatcher.close();});
 return {client,sourceReader,assistant,bridge,service,jobs,dispatcher,setSource:v=>source=v,select:owner=>selected=owner,get reads(){return reads;},get submissions(){return submissions;},get held(){return !!release;},release:()=>release?.(),
  async external(operation,args={}){const h=await service.submit('external',{operation,arguments:args,idempotencyKey:crypto.randomUUID()});return until(()=>{const j=service.read('external',h.request.id,h.receipt);return ['completed','failed'].includes(j.status)&&j;});},
 };
}
test('all retained statuses and custom output categories share exact summary semantics',async()=>{
 const aliases={pending:'queued',submitting:'queued',queued:'queued',running:'running',processing:'running',success:'completed',succeeded:'completed',completed:'completed',failed:'failed',cancelled:'stopped',canceled:'stopped',stopped:'stopped',interrupted:'unknown',alien:'unknown'};
 for(const [status,expected]of Object.entries(aliases)){const safe=(await createApplicationTaskReader(()=>[record({status})],new Map()).tasks()).tasks[0];assert.equal(local.classifyAssistantTaskStatus(safe),expected);assert.equal(local.classifyAssistantTaskStatus(record({status})),expected);}
 const stopped=record({status:'completed',stoppedByUser:true});assert.equal(applicationTaskStatus(stopped),'unknown');assert.equal(local.classifyAssistantTaskStatus(stopped),'unknown');
 const safe=(await createApplicationTaskReader(()=>[record({type:'custom',customOutputType:'video'})],new Map()).tasks()).tasks[0];assert.equal(safe.type,'video');
});
test('default projection never reads raw errors, prompts, credentials or media fields',async()=>{
 const raw=record();for(const name of ['errorMsg','diagnostic','prompt','apiKey','resultUrl','customResultData'])Object.defineProperty(raw,name,{get(){assert.fail('Unexpected content access: '+name);}});
 const safe=(await createApplicationTaskReader(()=>[raw],new Map()).tasks()).tasks[0];assert.equal(safe.status,'running');assert(!('diagnostic'in safe));assert.equal(safe.progress,null);
});
test('only explicit diagnostics returns fixed categories and is idempotent through service projections',async()=>{
 const raw=record({status:'failed',errorMsg:'HTTP 429 rate limit PRIVATE_BODY https://PRIVATE.invalid sk-1234567890abcdef',prompt:'PRIVATE_PROMPT',resultUrl:'file:///PRIVATE_MEDIA',diagnostic:{status:'401',kind:'authentication'}}),reader=createApplicationTaskReader(()=>[raw],new Map());
 const plain=await reader.task({id:raw.id});assert(!('diagnostic'in plain.task));
 const detailed=await reader.task({id:raw.id,includeDiagnostics:true});assert.deepEqual(detailed.task.diagnostic,{status:'429',kind:'rate_limit'});assert(!JSON.stringify(detailed).includes('PRIVATE'));
 assert.deepEqual(applicationOperationMetadata('tasks.get',detailed,{includeDiagnostics:true}),detailed);assert(!('diagnostic'in applicationOperationMetadata('tasks.get',detailed).task));
 for(const status of ['running','completed','cancelled','unknown'])assert(!('diagnostic'in (await createApplicationTaskReader(()=>[record({status,errorMsg:'HTTP 429'})],new Map()).tasks({includeDiagnostics:true})).tasks[0]));
 assert.match(onboarding.buildAssistantLocalDiagnosis([detailed.task],'en-US'),/rate limit/);
});
test('progress is never invented; ISO and numeric timestamp scales stay conservative',async()=>{
 for(const progress of [undefined,null,'42',NaN,Infinity,-1,101])assert.equal((await createApplicationTaskReader(()=>[record({progress})],new Map()).tasks()).tasks[0].progress,null);
 for(const progress of [0,42,100])assert.equal((await createApplicationTaskReader(()=>[record({progress})],new Map()).tasks()).tasks[0].progress,progress);
 const a=record({id:'OLD',createdAt:'2025-01-01T00:00:00Z'}),b=record({id:'NEW',createdAt:'2026-01-01T00:00:00Z'}),safe=(await createApplicationTaskReader(()=>[a,b],new Map()).tasks()).tasks;
 assert.equal(safe[1].createdAt,b.createdAt);assert.equal(selectLatestApplicationTask(safe).id,'NEW');
 for(const items of [[a,record({createdAt:1767225600})],[a,record({createdAt:0})],[a,{...a,id:'TIE'}]])assert.equal(selectLatestApplicationTask(items),null);
});
test('malformed or unavailable storage is not an empty list; readable empty storage is',async()=>{
 for(const value of [undefined,null,{},[null],[{status:'failed'}],[{id:' '}],['invalid']]){const reader=createApplicationTaskReader(()=>value,new Map());await assert.rejects(reader.tasks(),{code:'OPERATION_TASKS_UNAVAILABLE'});await assert.rejects(reader.task({id:'QA_TASK'}),{code:'OPERATION_TASKS_UNAVAILABLE'});}
 assert.deepEqual(await createApplicationTaskReader(()=>[],new Map()).tasks(),{ok:true,tasks:[]});
 await assert.rejects(createApplicationTaskReader(()=>Array(2001).fill(record()),new Map()).tasks(),{code:'OPERATION_RESULT_LIMIT'});
});
test('new transient submission is not masked by older result on same node; unknown chronology retains both',()=>{
 const job=record({id:'NEW',createdAt:1735689601000,updatedAt:1735689601000,status:'submitting'}),old=record({id:'OLD',createdAt:1735689600000,status:'completed'}),jobs=new Map([['QA_NODE',job]]);
 assert.equal(applicationTaskRecordSnapshot([old],jobs,1735689601001).length,2);assert.equal(jobs.size,1);
 for(const value of [0,1735689601]){const uncertain=new Map([['QA_NODE',{...job,createdAt:value}]]);assert.equal(applicationTaskRecordSnapshot([old],uncertain,1735689601001).length,2);}
 assert.equal(applicationTaskRecordSnapshot([{...job,status:'running'}],jobs,1735689601001).length,1);assert.equal(jobs.size,0);
 const other=new Map([['QA_NODE',job]]);assert.equal(applicationTaskRecordSnapshot([{...job,projectId:'OTHER_PROJECT'}],other,1735689601001).length,2);
});
test('transient expiration is local memory only; source history is never mutated',()=>{
 const source=[record({status:'completed'})],before=JSON.stringify(source),jobs=new Map([['QA_NODE',record({updatedAt:1735689600000,createdAt:1735689601000})]]);
 assert.equal(applicationTaskRecordSnapshot(source,jobs,1735689600000+86400001).length,1);assert.equal(jobs.size,0);assert.equal(JSON.stringify(source),before);
});
test('late generation callbacks cannot resurrect a pruned fallback over a completed image or lose its identity',()=>{
 const {beginApplicationTaskSubmission}=require('../src/renderer/lib/application-task-records.ts'),jobs=new Map();let clock=1735689600000;const run=beginApplicationTaskSubmission(jobs,'QA_NODE',{type:'image',projectId:'QA_PROJECT'},()=>clock);run.update({status:'running'});
 const persisted=record({id:'REAL_IMAGE_TASK',status:'completed',createdAt:clock+1});applicationTaskRecordSnapshot([persisted],jobs,clock+2);assert.equal(jobs.size,0);clock+=20;assert.equal(run.update({id:'REAL_IMAGE_TASK',status:'pending'}),false);assert.equal(jobs.size,0);assert.equal(findApplicationTask(applicationTaskRecordSnapshot([persisted],jobs,clock),'QA_NODE').status,'completed');
 const a=beginApplicationTaskSubmission(jobs,'QA_NODE',{type:'image',projectId:'QA_PROJECT'},()=>clock),b=beginApplicationTaskSubmission(jobs,'QA_NODE',{type:'video',projectId:'OTHER_PROJECT'},()=>clock+1);assert.equal(a.update({status:'failed'}),false);assert(b.update({projectId:'FORGED',type:'',createdAt:0,status:'running'}));assert.equal(jobs.get('QA_NODE').projectId,'OTHER_PROJECT');assert.equal(jobs.get('QA_NODE').type,'video');assert.equal(jobs.get('QA_NODE').createdAt,clock+1);
});
test('task id selection is exact and node aliases require an unambiguous latest timestamp',()=>{
 const a=record({id:'FIRST'}),b=record({id:'SECOND',createdAt:1735689600001});assert.equal(findApplicationTask([a,b],'FIRST'),a);assert.equal(findApplicationTask([a,b],'QA_NODE'),b);
 assert.equal(findApplicationTask([a,b],'MISSING'),null);
 for(const items of [[a,{...a}],[a,{...b,createdAt:a.createdAt}],[a,{...b,createdAt:1735689600}]])assert.throws(()=>findApplicationTask(items,items[1].id===a.id?'FIRST':'QA_NODE'),{code:'OPERATION_TASK_AMBIGUOUS'});
});
test('strict task schemas refuse materialization, URLs and forged extra authority before IO',async()=>{
 const reader=createApplicationTaskReader(()=>assert.fail('No source read'),new Map());
 for(const args of [{materialize:true},{includeDiagnostics:'yes'},{includeDiagnostics:true,confirmed:true}])await assert.rejects(reader.tasks(args));
 for(const id of ['',undefined,'file:///PRIVATE','https://PRIVATE.invalid','../../PRIVATE'])await assert.rejects(reader.task({id}),{code:'OPERATION_INVALID_REQUEST'});
 for(const args of [{includeDiagnostics:'true'},{includeDiagnostics:true,materialize:false}])assert.throws(()=>parseApplicationOperationRequest({operation:'tasks.list',arguments:args,idempotencyKey:'qa-schema-0000001'}),{code:'OPERATION_INVALID_REQUEST'});
});
test('actual main service and internal/external reads share result without a mounted canvas',async t=>{
 const f=fixture(t,{records:[record({type:'custom',customOutputType:'video',status:'failed',errorMsg:'HTTP 429 PRIVATE_BODY'})]}),internal=await f.assistant.read('A',{includeDiagnostics:true}),external=await f.external('tasks.list',{includeDiagnostics:true});
 assert.equal(external.status,'completed');assert.deepEqual(external.result.tasks,internal);assert.equal(f.reads,2);assert(!JSON.stringify(external).includes('PRIVATE'));assert.equal(f.client.viewFor('A').draft,'QA_A');
 const one=await f.external('tasks.get',{id:'QA_NODE'});assert.equal(one.result.task.id,'QA_TASK');assert(!('diagnostic'in one.result.task));
});
test('missing common reader and unavailable records fail closed without raw or provider fallback',async t=>{
 const a=fixture(t,{missing:true});await assert.rejects(a.assistant.read('A'),{code:'OPERATION_TASKS_UNAVAILABLE'});assert.equal(a.reads,0);
 const b=fixture(t,{records:null});await assert.rejects(b.assistant.read('A'),{code:'OPERATION_TASKS_UNAVAILABLE'});assert.equal(b.client.viewFor('A').taskRead.working,false);
 await assert.rejects(createAssistantTaskReader(b.client,()=>null).read('A'),{code:'OPERATION_PERMISSION_REQUIRED'});
 assert.throws(()=>b.assistant.read('MISSING_OWNER'),{code:'PLAN_SESSION_CHANGED'});
});
test('two render coordinators deduplicate owner read; selection switch and late reply never touch B draft',async t=>{
 const f=fixture(t,{hold:true}),a=f.assistant.read('A'),other=createAssistantTaskReader(f.client,()=>f.bridge),duplicate=other.read('A');assert.equal(a,duplicate);assert.throws(()=>other.read('A',{includeDiagnostics:true}),{code:'ASSISTANT_BUSY'});
 await until(()=>f.held);f.select('B');f.client.set('B','draft','B_NEW_DRAFT');f.release();assert.equal((await a)[0].id,'QA_TASK');assert.equal(f.submissions,1);assert.equal(f.client.viewFor('B').draft,'B_NEW_DRAFT');assert.equal(f.client.viewFor('B').taskRead.working,false);assert.equal(f.client.viewFor('A').taskRead.inFlight,null);
});
test('ambiguous id propagates as a bounded error rather than silently choosing a result',async t=>{
 const f=fixture(t,{records:[record(),record()]});await assert.rejects(f.assistant.read('A',{id:'QA_TASK',includeDiagnostics:true}),{code:'OPERATION_TASK_AMBIGUOUS'});assert.equal(f.client.viewFor('A').taskRead.code,'OPERATION_TASK_AMBIGUOUS');
});
test('actual summary insertion waits for shared diagnostics, never overwrites an edited or other-owner draft',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/components/assistant-onboarding.tsx'),'utf8'),handler=require('./source-function.cjs')(source,'addFailureSummary',ts.ScriptKind.TSX),compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const change of ['none','draft','owner','failure']){
  let release,selected='A',draft='QA_ORIGINAL_DRAFT',notice='',calls=0,options;
  const ctx={...onboarding,...require('../src/renderer/lib/assistant-task-reader.ts'),language:'en-US',message:draft,inputRevision:{current:0},diagnosticDraft:{current:false},workspace:{id:'A',controller:{getSnapshot:()=>({selectedId:selected})}},t:{draftFull:'FULL'},
   taskReader:{read(owner,args){calls++;assert.equal(owner,'A');options=args;return new Promise((resolve,reject)=>release=()=>change==='failure'?reject({code:'OPERATION_TASKS_UNAVAILABLE'}):resolve(applicationOperationMetadata('tasks.list',{tasks:[record({status:'failed',errorMsg:'HTTP 429 PRIVATE_ERROR'})]},{includeDiagnostics:true}).tasks));}},
   setMessage:value=>{draft=value;},setChatNotice:value=>{notice=value;},setChatError:()=>{},
  };
  const run=require('node:vm').runInNewContext(compiled+'\naddFailureSummary',ctx),pending=run();assert.equal(draft,'QA_ORIGINAL_DRAFT');assert.equal(calls,1);assert.equal(JSON.stringify(options),JSON.stringify({includeDiagnostics:true}));
  if(change==='draft'){ctx.inputRevision.current++;draft='QA_NEW_DRAFT';}if(change==='owner')selected='B';release();await pending;
  if(change==='none'){assert(draft.includes('429'));assert.equal(ctx.diagnosticDraft.current,true);assert(!draft.includes('PRIVATE_ERROR'));}
  else {assert.equal(draft,change==='draft'?'QA_NEW_DRAFT':'QA_ORIGINAL_DRAFT');assert(notice);assert.equal(ctx.diagnosticDraft.current,false);}
 }
});
