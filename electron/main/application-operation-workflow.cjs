// Stages existing operations, never grants or executes their permissions.
// Only leaf media.import/generation requests can consume normal App nonces.
const crypto=require('node:crypto');
const contract=import('../shared/application-operation-contract.mjs');
const parser=import('../shared/application-generation-workflow.mjs');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const terminal=new Set(['completed','failed','rejected','cancelled','expired']);
function createApplicationOperationWorkflowService(base,{now=Date.now,ttlMs=600000,id=()=>crypto.randomUUID(),notify=()=>{}}={}){
 const flows=new Map(),keys=new Map(),children=new Map();let closed=false,scheduled=false,pumping=false,dirty=false;
 const unsubscribe=base.subscribe(schedule);
 function view(p){return {id:p.id,operation:p.intent.generation.operation,permission:'generation.paid',permissions:['media.input','generation.paid','canvas.edit'],projectId:p.intent.generation.projectId,status:p.status,revision:p.revision,createdAt:p.createdAt,expiresAt:p.expiresAt,
  workflow:{stage:p.index<p.intent.sources.length?'import':'generation',stepIndex:p.index+1,totalSteps:p.intent.sources.length+1,importsCompleted:p.references.length,...(p.stopAfterCurrent?{nextStepsCancelled:true}:{})},...(p.code?{code:p.code}:{}),...(p.result!==undefined?{result:structuredClone(p.result)}:{}),...(p.resultExpired?{resultExpired:true}:{})};}
 function changed(p){p.revision++;const entry=keys.get(p.key);if(entry)entry.view=view(p);try{notify();}catch{}}
 function finish(p,status,code='',result){if(p.done)return;p.status=status;p.code=code;p.result=result;p.done=true;changed(p);}
 function prune(){for(const [key,p]of flows)if(now()>=p.expiresAt){
  if(!p.done){let current;try{current=p.child&&base.read(p.actor,p.child.request.id,p.child.receipt);}catch{}
   p.status=['running','outcome_unknown'].includes(current?.status)||p.status==='outcome_unknown'?'outcome_unknown':'expired';p.code=p.status==='outcome_unknown'?'OPERATION_OUTCOME_UNKNOWN':'OPERATION_EXPIRED';p.done=true;
   if(p.child)try{base.cancel(p.actor,p.child.request.id,p.child.receipt);}catch{}
  }
  p.result=undefined;p.resultExpired=true;changed(p);flows.delete(key);
  for(const [child,c]of children)if(c.parent===p.id)children.delete(child);
 }}
 function owned(actor,requestId,receipt){prune();const p=flows.get(requestId);if(!p||p.actor!==actor)fail('OPERATION_NOT_FOUND');
  if(actor==='external'&&(typeof receipt!=='string'||!/^[a-f0-9]{64}$/.test(receipt)||!crypto.timingSafeEqual(Buffer.from(receipt),Buffer.from(p.receipt))))fail('OPERATION_NOT_FOUND');return p;
 }
 function schedule(){if(closed)return;dirty=true;if(scheduled||pumping)return;scheduled=true;queueMicrotask(()=>{scheduled=false;void pump();});}
 async function startChild(p){
  if(closed||p.done||now()>=p.expiresAt)return;
  const importing=p.index<p.intent.sources.length,request={operation:importing?'media.import':p.intent.generation.operation,projectId:p.intent.generation.projectId,
   arguments:importing?p.intent.sources[p.index]:{...p.intent.generation.arguments,references:p.references.slice()},idempotencyKey:'workflow-'+p.id+'-'+p.index};
  const child=await base.submit(p.actor,request,{...p.context,deadline:p.expiresAt,workflowId:p.id});
  // An invalidation/cancel during the async submit must not leave an orphan
  // approval armed, nor may its completion advance to another stage.
  if(closed||p.done||now()>=p.expiresAt){try{base.cancel(p.actor,child.request.id,child.receipt);}catch{}return;}
  p.child=child;p.lastChildRevision=0;children.set(child.request.id,{parent:p.id,index:p.index});changed(p);schedule();
  if(p.stopAfterCurrent)try{base.cancel(p.actor,child.request.id,child.receipt);}catch{}
 }
 async function pump(){
  if(pumping||closed)return;pumping=true;
  try{do{dirty=false;prune();for(const p of flows.values()){
   if(p.done||!p.child)continue;
   let current;try{current=base.read(p.actor,p.child.request.id,p.child.receipt);}catch(error){finish(p,'expired',error.code==='OPERATION_NOT_FOUND'?'OPERATION_EXPIRED':'OPERATION_FAILED');continue;}
   if(current.revision===p.lastChildRevision)continue;p.lastChildRevision=current.revision;
   if(p.stopAfterCurrent){
    if(current.status==='completed'){
     if(p.index===p.intent.sources.length)finish(p,'completed','',current.result);
     else finish(p,'cancelled','',{cancelled:true,generationStarted:false,approvedMediaMayRemain:true});
    }
    else if(terminal.has(current.status))finish(p,current.status,current.code||'');
    else {p.status='outcome_unknown';p.code='OPERATION_OUTCOME_UNKNOWN';changed(p);}continue;
   }
   if(current.status!=='completed'){
    if(terminal.has(current.status))finish(p,current.status,current.code||'');else{p.status=current.status;p.code=current.code||'';changed(p);}continue;
   }
   if(p.index===p.intent.sources.length){finish(p,'completed','',current.result);continue;}
   if(!current.result?.imported||typeof current.result.referenceId!=='string'){finish(p,'failed','OPERATION_MEDIA_INVALID');continue;}
   p.references.push(current.result.referenceId);p.index++;p.child=null;p.status='preparing';p.code='';changed(p);
   try{await startChild(p);}catch(error){finish(p,'failed',(await contract).applicationOperationErrorCode(error));}
  }}while(dirty&&!closed);}finally{pumping=false;}
 }
 async function submit(actor,input,context={}){
  const c=await contract;if(closed||!c.isApplicationOperationActor(actor))fail('OPERATION_INVALID_AUTHORITY');
  const intent=(await parser).parseApplicationGenerationWorkflow(input),request=intent?.generation||c.parseApplicationOperationRequest(input);
  if(actor!=='external'&&c.applicationOperationRequiresSelection(request.operation)&&(!Number.isSafeInteger(context.selectionVersion)||context.selectionVersion<0))fail('OPERATION_INVALID_AUTHORITY');
  // Reserve one namespace for BOTH ordinary requests and workflows before any
  // awaited submission. Changing a request's shape cannot reuse its identity.
  prune();const key=JSON.stringify([actor,request.idempotencyKey]),kind=intent?'flow':'direct',digest=crypto.createHash('sha256').update(JSON.stringify(intent||request)).digest('hex'),old=keys.get(key);
  if(old){
   if(old.kind!==kind||old.digest!==digest)fail('OPERATION_IDEMPOTENCY_CONFLICT');
   if(kind==='direct'){await old.pending;return base.submit(actor,request,context);}
   const p=flows.get(old.id);return {request:p?view(p):structuredClone(old.view),receipt:old.receipt,replayed:true};
  }
  if(keys.size>=4096)fail('OPERATION_LIMIT');
  if(!intent){const pending=base.submit(actor,request,context),entry={kind,digest,pending};keys.set(key,entry);try{return await pending;}catch(error){if(keys.get(key)===entry)keys.delete(key);throw error;}}
  if(flows.size>=128||[...flows.values()].filter(p=>!p.done).length>=16)fail('OPERATION_LIMIT');
  if(context.deadline!==undefined&&(!Number.isSafeInteger(context.deadline)||context.deadline<=now()))fail('OPERATION_EXPIRED');
  const p={id:id(),key,actor,intent,context:{selectionVersion:context.selectionVersion},createdAt:now(),expiresAt:Math.min(now()+ttlMs,context.deadline??Infinity),receipt:crypto.randomBytes(32).toString('hex'),revision:1,status:'preparing',code:'',index:0,references:[],child:null,done:false,stopAfterCurrent:false};
  if(!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now())fail('OPERATION_EXPIRED');
  flows.set(p.id,p);keys.set(key,{kind,id:p.id,digest,receipt:p.receipt,view:view(p)});
  void startChild(p).catch(async error=>{if(p.done)return;const {applicationOperationErrorCode}=await import('../shared/application-operation-contract.mjs');finish(p,'failed',applicationOperationErrorCode(error));});
  return {request:view(p),receipt:p.receipt,replayed:false};
 }
 function approve(requestId,revision){
  prune();const p=flows.get(requestId);if(!p)return base.approve(requestId,revision);
  if(['queued','running','outcome_unknown','completed'].includes(p.status))return view(p);
  if(p.status!=='awaiting_confirmation'||p.revision!==revision||!p.child)fail('OPERATION_EXPIRED');
  base.approve(p.child.request.id,p.lastChildRevision);schedule();return view(p);
 }
 function reject(requestId,revision){
  prune();const p=flows.get(requestId);if(!p)return base.reject(requestId,revision);
  if(p.revision!==revision||!p.child)fail('OPERATION_EXPIRED');base.reject(p.child.request.id,p.lastChildRevision);finish(p,'rejected');return view(p);
 }
 function cancel(actor,requestId,receipt){
  if(!flows.has(requestId))return base.cancel(actor,requestId,receipt);const p=owned(actor,requestId,receipt);
  if(['cancelled','rejected','expired'].includes(p.status))return view(p);if(p.done)fail('OPERATION_TOO_LATE');
  // submit may still be awaiting its child handle. Block advancement now but
  // don't claim cancelled IO until that exact child is accounted for.
  if(!p.child){p.stopAfterCurrent=true;p.status='outcome_unknown';p.code='OPERATION_OUTCOME_UNKNOWN';changed(p);schedule();return view(p);}
  const current=base.read(actor,p.child.request.id,p.child.receipt);
  if(p.index<p.intent.sources.length&&['running','outcome_unknown','completed'].includes(current.status)){
   p.stopAfterCurrent=true;p.status='outcome_unknown';p.code='OPERATION_OUTCOME_UNKNOWN';p.lastChildRevision=0;changed(p);schedule();return view(p);
  }
  base.cancel(actor,p.child.request.id,p.child.receipt);finish(p,'cancelled');return view(p);
 }
 function invalidate(){for(const p of flows.values())if(!p.done){
  // A child can enter commit before its observer microtask updates the parent.
  // Consult that authoritative leaf rather than declaring an in-flight IO
  // expired from the parent's older cached awaiting/queued presentation.
  let current;try{current=p.child&&base.read(p.actor,p.child.request.id,p.child.receipt);}catch{}
  const uncertain=['running','outcome_unknown'].includes(current?.status)||['running','outcome_unknown'].includes(p.status);
  finish(p,uncertain?'outcome_unknown':'expired',uncertain?'OPERATION_OUTCOME_UNKNOWN':'OPERATION_EXPIRED');
 }base.invalidate();}
 return {submit,approve,reject,cancel,consume:base.consume,
  read(actor,requestId,receipt){if(!flows.has(requestId))return base.read(actor,requestId,receipt);return view(owned(actor,requestId,receipt));},
  readInternal(actor,requestId){
   if(typeof actor!=='string'||!actor.startsWith('internal:'))fail('OPERATION_INVALID_AUTHORITY');
   if(!flows.has(requestId))return base.readInternal(actor,requestId);
   const p=owned(actor,requestId),child=p.child&&base.readInternal(actor,p.child.request.id);
   return {...view(p),...(p.status==='awaiting_confirmation'&&child?.review?{review:child.review}:{})};
  },
  list(){prune();return base.list().map(r=>{const c=children.get(r.id),p=c&&flows.get(c.parent);return p?{...r,workflow:{id:p.id,stage:c.index<p.intent.sources.length?'import':'generation',stepIndex:c.index+1,totalSteps:p.intent.sources.length+1}}:r;});},
  dismiss(requestId){const p=flows.get(requestId);if(!p)return base.dismiss(requestId);if(!p.done)fail('OPERATION_TOO_LATE');return view(p);},
  invalidate,close(){closed=true;unsubscribe();invalidate();base.close();},
 };
}
module.exports={createApplicationOperationWorkflowService};
