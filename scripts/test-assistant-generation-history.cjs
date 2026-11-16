const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {captureAssistantGenerationTask,selectAssistantGenerationTask}=require('../electron/shared/assistant-generation-task.mjs');
const {createAssistantGenerationObserver}=require('../src/renderer/lib/assistant-generation-observer.ts');
const {applicationOperationMetadata}=require('../electron/shared/application-operation-policy.mjs');
const {buildAssistantFailureSummary,buildAssistantLocalDiagnosis,isAssistantDiagnosticDraft}=require('../src/renderer/lib/assistant-onboarding.ts');
const ref={version:1,projectId:'QA_PROJECT',nodeId:'QA_NODE',submissionId:'10000000-1111-4111-8111-111111111111'};
const task=(extra={})=>({id:'QA_TASK',nodeId:ref.nodeId,projectId:ref.projectId,clientSubmissionId:ref.submissionId,status:'completed',type:'video',createdAt:1700000000000,...extra});
test('history stores only immutable task observation identity, never an approval, path, URL or provider key',()=>{
 assert.deepEqual(captureAssistantGenerationTask(ref),ref);
 for(const extra of [{receipt:'PRIVATE'},{nonce:'PRIVATE'},{url:'file:///PRIVATE'},{localPath:'/PRIVATE'},{apiKey:'PRIVATE'},{permissions:['generation.paid']}])assert.throws(()=>captureAssistantGenerationTask({...ref,...extra}));
 assert.throws(()=>captureAssistantGenerationTask({...ref,submissionId:'not-a-task-id'}));
 const safe=applicationOperationMetadata('tasks.get',{task:task({prompt:'PRIVATE_PROMPT',resultUrl:'https://PRIVATE',apiKey:'PRIVATE_KEY'})}).task;
 assert.equal(safe.clientSubmissionId,ref.submissionId);assert(!JSON.stringify(safe).includes('PRIVATE'));
});
test('same-node later manual tasks cannot replace an earlier conversation result; fallback-to-canonical preserves exact identity',()=>{
 const old=task(),later=task({id:'LATER_TASK',clientSubmissionId:'20000000-2222-4222-8222-222222222222',createdAt:1700000001000});
 assert.equal(selectAssistantGenerationTask(ref,[later,old]),old);
 assert.equal(selectAssistantGenerationTask(ref,[later]),null);
 assert.equal(selectAssistantGenerationTask(ref,[task({id:ref.nodeId,status:'submitting'}),old]),old);
 assert.throws(()=>selectAssistantGenerationTask(ref,[old,task({id:'CONTRADICTORY_TASK'})]),{code:'OPERATION_TASK_AMBIGUOUS'});
 assert.equal(selectAssistantGenerationTask(ref,[task({projectId:'OTHER'})]),null);
});
test('visible history cards share one bounded metadata read, cache briefly, and invalidate on reader replacement',async()=>{
 let calls=0,clock=1000,release;const held=new Promise(r=>release=r),record=task();
 let reader={tasks:async args=>{calls++;assert.deepEqual(args,{materialize:false,includeDiagnostics:false});await held;return {tasks:[record]};}};
 const observer=createAssistantGenerationObserver(()=>reader,{now:()=>clock});
 const requests=Array.from({length:50},()=>observer.read(ref));await new Promise(setImmediate);assert.equal(calls,1);release();await Promise.all(requests);await observer.read(ref);assert.equal(calls,1);
 clock+=401;await observer.read(ref);assert.equal(calls,2);
 reader={tasks:async()=>{calls++;return {tasks:[task({status:'failed'})]};}};assert.equal((await observer.read(ref)).status,'failed');assert.equal(calls,3);
});
test('metadata failure is unknown/unavailable, not an empty task list or automatic generation retry',async()=>{
 let calls=0;const observer=createAssistantGenerationObserver(()=>({tasks:async()=>{calls++;throw Error('UNAVAILABLE');}}));
 await assert.rejects(()=>observer.read(ref));assert.equal(calls,1);
});
test('selected-task diagnosis uses only coarse allowlisted metadata and never claims a known parameter fix',()=>{
 for(const [status,kind]of [['400','parameters'],['422','parameters'],['404','configuration'],['405','configuration'],['503','upstream'],['504','upstream']]){
  const result=applicationOperationMetadata('tasks.get',{task:task({status:'failed',errorMsg:'HTTP '+status+' PRIVATE_BODY https://PRIVATE.invalid/file sk-PRIVATE_SYNTHETIC',prompt:'PRIVATE_PROMPT'})},{includeDiagnostics:true}).task;
  assert.deepEqual(result.diagnostic,{status,kind});
  for(const language of ['zh-CN','zh-TW','en-US']){
   const summary=buildAssistantFailureSummary([result],language,'selected');assert(!summary.includes('PRIVATE'));assert(isAssistantDiagnosticDraft(summary));assert(summary.includes(status));assert(summary.includes(kind));
   if(language==='en-US'){assert.match(summary,/task I selected/);assert(!/[\u3400-\u9fff]/.test(buildAssistantLocalDiagnosis([result],language,'selected')));}
  }
 }
 assert.equal(buildAssistantFailureSummary([task({status:'unknown'})],'en-US','selected'),'');
});
