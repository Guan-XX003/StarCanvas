// Volatile one-request approvals. No model/HTTP flag is authority; no payload,
// result, receipt credential or approval survives App restart or reaches logs.
const crypto=require('node:crypto');
const contract=import('../shared/application-operation-contract.mjs');
function createApplicationOperationService({prepare,commit,release=async()=>{},notify=()=>{},now=Date.now,id=()=>crypto.randomUUID(),ttlMs=600000,observationMs=10000}){
 const jobs=new Map(),keys=new Map(),observers=new Set();let closed=false,writeQueue=Promise.resolve();
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 const emit=()=>{try{notify();}catch{}for(const listener of observers)try{listener();}catch{}};
 const clone=value=>structuredClone(value);
 function publicView(job){return {id:job.id,operation:job.request.operation,permission:job.permission,permissions:job.permissions,projectId:job.request.projectId,status:job.status,revision:job.revision,createdAt:job.createdAt,expiresAt:job.expiresAt,
  ...(job.code?{code:job.code}:{}),...(job.result!==undefined?{result:clone(job.result)}:{}),...(job.resultExpired?{resultExpired:true}:{})};}
 function changed(job){job.revision++;const key=keys.get(job.key);if(key)key.view=publicView(job);emit();}
 function cleanup(job){void Promise.resolve().then(()=>release({requestId:job.id,actor:job.actor})).catch(()=>{});}
 function prune(){
  for(const [id,job]of jobs)if(now()>=job.expiresAt){
   if(['preparing','awaiting_confirmation','queued'].includes(job.status)){job.status='expired';job.code='OPERATION_EXPIRED';}
   if(job.status==='running'){job.status='outcome_unknown';job.code='OPERATION_OUTCOME_UNKNOWN';}
   job.result=undefined;job.review=undefined;job.resultExpired=true;changed(job);jobs.delete(id);cleanup(job);
  }
 }
 function owned(actor,requestId,receipt){
  prune();const job=jobs.get(requestId);if(!job||job.actor!==actor)fail('OPERATION_NOT_FOUND');
  if(actor==='external'){
   if(typeof receipt!=='string'||! /^[a-f0-9]{64}$/.test(receipt)||!crypto.timingSafeEqual(Buffer.from(receipt),Buffer.from(job.receipt)))fail('OPERATION_NOT_FOUND');
  }return job;
 }
 function finish(job,status,value,code=''){
  if(!['running','outcome_unknown'].includes(job.status))return;
  const result=value===undefined?undefined:clone(value);
  job.status=status;job.code=code;job.nonce='';clearTimeout(job.timer);
  if(now()<job.expiresAt)job.result=result;else job.resultExpired=true;
  changed(job);
 }
 async function perform(job){
  if(closed||job.status!=='queued')return;
  if(now()>=job.expiresAt){job.status='expired';job.code='OPERATION_EXPIRED';changed(job);cleanup(job);return;}
  if(job.needsApproval&&!job.approved){job.status='failed';job.code='OPERATION_PERMISSION_REQUIRED';changed(job);cleanup(job);return;}
  job.status='running';job.nonce=crypto.randomBytes(32).toString('hex');job.consumed=false;changed(job);
  job.timer=setTimeout(()=>{if(job.status==='running'){job.status='outcome_unknown';job.code='OPERATION_OUTCOME_UNKNOWN';changed(job);}},observationMs);job.timer.unref?.();
  try{
   const result=await commit({requestId:job.id,nonce:job.nonce});
   if(!job.consumed)fail('OPERATION_INVALID_AUTHORITY');
   if(new TextEncoder().encode(JSON.stringify(result)).byteLength>512*1024)fail('OPERATION_RESULT_LIMIT');
   finish(job,'completed',result);
  }catch(error){
   let code=(await contract).applicationOperationErrorCode(error);
   // A lost/invalid response after consuming authority is not proof that a
   // mutation failed. Retain the request identity; never execute it again.
   if(code==='PLAN_COMMIT_UNCERTAIN'||job.consumed&&['OPERATION_FAILED','OPERATION_RESULT_LIMIT'].includes(code))code='OPERATION_OUTCOME_UNKNOWN';
   finish(job,code==='OPERATION_OUTCOME_UNKNOWN'?'outcome_unknown':'failed',undefined,code);
   if(code!=='OPERATION_OUTCOME_UNKNOWN')cleanup(job);
  }
 }
 function enqueue(job){job.status='queued';changed(job);if(job.permission==='read')void perform(job);else writeQueue=writeQueue.catch(()=>{}).then(()=>perform(job));}
 async function start(job){
  try{
   const prepared=await prepare({requestId:job.id,actor:job.actor,request:clone(job.request),expiresAt:job.expiresAt,selectionVersion:job.selectionVersion});
   if(closed||job.status!=='preparing'){cleanup(job);return;}
   if(now()>=job.expiresAt){job.status='expired';job.code='OPERATION_EXPIRED';changed(job);cleanup(job);return;}
   if(new TextEncoder().encode(JSON.stringify(prepared)).byteLength>512*1024)fail('OPERATION_RESULT_LIMIT');
   job.review=clone(prepared);if(job.needsApproval){job.status='awaiting_confirmation';changed(job);}else enqueue(job);
  }catch(error){
   const code=(await contract).applicationOperationErrorCode(error);
   // Publish terminal status and its sanitized code in one synchronous step.
   // A read during the module await must not see "failed" without its reason,
   // nor may this late preparation failure overwrite a cancellation.
   if(job.status!=='preparing')return;job.code=code;job.status='failed';changed(job);cleanup(job);
  }
 }
 async function submit(actor,input,context={}){
  if(!(await contract).isApplicationOperationActor(actor)||closed)fail('OPERATION_INVALID_AUTHORITY');
  const {parseApplicationOperationRequest,applicationOperationNeedsApproval}=await contract,request=parseApplicationOperationRequest(input);
  if(actor!=='external'&&(await contract).applicationOperationRequiresSelection(request.operation)&&(!Number.isSafeInteger(context.selectionVersion)||context.selectionVersion<0))fail('OPERATION_INVALID_AUTHORITY');
  // Main-owned child namespace: guessing a child's idempotency string cannot
  // replay its private imported-reference result through a public submission.
  if(context.workflowId!==undefined&&(typeof context.workflowId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(context.workflowId)))fail('OPERATION_INVALID_AUTHORITY');
  prune();const key=JSON.stringify(context.workflowId===undefined?[actor,request.idempotencyKey]:[actor,request.idempotencyKey,context.workflowId]),digest=crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'),old=keys.get(key);
  if(old){if(old.digest!==digest)fail('OPERATION_IDEMPOTENCY_CONFLICT');const live=jobs.get(old.id);return {request:live?publicView(live):clone(old.view),receipt:old.receipt,replayed:true};}
  if(jobs.size>=128||[...jobs.values()].filter(j=>['preparing','awaiting_confirmation','queued','running','outcome_unknown'].includes(j.status)).length>=32||keys.size>=4096)fail('OPERATION_LIMIT');
  // Main-only workflow context may shorten a child lifetime, never extend it.
  // This is not an operation argument or an externally supplied authority.
  if(context.deadline!==undefined&&(!Number.isSafeInteger(context.deadline)||context.deadline<=now()))fail('OPERATION_EXPIRED');
  const descriptor=(await import('../shared/application-operation-policy.mjs')).applicationOperation(request.operation);
  const job={id:id(),key,actor,request,selectionVersion:context.selectionVersion,permission:descriptor.permission,permissions:descriptor.permissions,receipt:crypto.randomBytes(32).toString('hex'),status:'preparing',revision:1,createdAt:now(),expiresAt:Math.min(now()+ttlMs,context.deadline??Infinity),needsApproval:applicationOperationNeedsApproval(request),approved:false,consumed:false};
  jobs.set(job.id,job);keys.set(key,{id:job.id,digest,receipt:job.receipt,view:publicView(job)});emit();void start(job);
  return {request:publicView(job),receipt:job.receipt,replayed:false};
 }
 function list(){prune();return [...jobs.values()].filter(j=>j.actor==='external'&&j.needsApproval&&!j.hidden).map(j=>({...publicView(j),...(j.review?{review:clone(j.review)}:{})}));}
 function approve(requestId,revision){
  prune();const job=jobs.get(requestId);if(!job)fail('OPERATION_NOT_FOUND');
  if(['queued','running','outcome_unknown','completed'].includes(job.status))return publicView(job);
  if(job.status!=='awaiting_confirmation'||revision!==job.revision)fail('OPERATION_EXPIRED');
  job.approved=true;enqueue(job);return publicView(job);
 }
 function reject(requestId,revision,status='rejected'){
  prune();const job=jobs.get(requestId);if(!job)fail('OPERATION_NOT_FOUND');
  if(['rejected','cancelled','expired'].includes(job.status))return publicView(job);
  if(!['preparing','awaiting_confirmation','queued'].includes(job.status)||revision!==job.revision)fail('OPERATION_TOO_LATE');
  job.status=status;job.nonce='';changed(job);cleanup(job);return publicView(job);
 }
 function consume(requestId,nonce){
  const job=jobs.get(requestId);if(!job||closed||job.status!=='running'||now()>=job.expiresAt||job.consumed||typeof nonce!=='string'||! /^[a-f0-9]{64}$/.test(nonce)||! /^[a-f0-9]{64}$/.test(job.nonce)||!crypto.timingSafeEqual(Buffer.from(nonce),Buffer.from(job.nonce)))fail('OPERATION_INVALID_AUTHORITY');
  if(job.needsApproval&&!job.approved)fail('OPERATION_PERMISSION_REQUIRED');job.consumed=true;
  return {actor:job.actor,operation:job.request.operation,projectId:job.request.projectId,expiresAt:job.expiresAt};
 }
 function invalidate(){for(const job of jobs.values())if(['preparing','awaiting_confirmation','queued','running'].includes(job.status)){
  const running=job.status==='running';job.status=running?'outcome_unknown':'expired';job.code=running?'OPERATION_OUTCOME_UNKNOWN':'OPERATION_EXPIRED';job.nonce='';clearTimeout(job.timer);changed(job);cleanup(job);
 }}
 return {submit,list,approve,reject,consume,subscribe(listener){observers.add(listener);return()=>observers.delete(listener);},
  read:(actor,requestId,receipt)=>publicView(owned(actor,requestId,receipt)),
  // A trusted, owner-scoped App view only. Public HTTP/CLI reads intentionally
  // keep excluding prompts and reviews, including for an internal actor string.
  readInternal(actor,requestId){if(typeof actor!=='string'||!actor.startsWith('internal:'))fail('OPERATION_INVALID_AUTHORITY');const job=owned(actor,requestId);return {...publicView(job),...(job.status==='awaiting_confirmation'&&job.review?{review:clone(job.review)}:{})};},
  cancel(actor,requestId,receipt){const job=owned(actor,requestId,receipt);return reject(job.id,job.revision,'cancelled');},
  dismiss(requestId){const job=jobs.get(requestId);if(!job)fail('OPERATION_NOT_FOUND');if(['preparing','awaiting_confirmation','queued','running'].includes(job.status))fail('OPERATION_TOO_LATE');job.hidden=true;emit();return publicView(job);},
  invalidate,close(){closed=true;invalidate();observers.clear();},
 };
}
module.exports={createApplicationOperationService};
