import {parseApplicationOperationRequest,applicationOperationErrorCode,isApplicationOperationActor,applicationOperationRequiresSelection} from '../../../electron/shared/application-operation-contract.mjs';
import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {applicationMediaImportReview,applicationReferenceMetadata} from '../../../electron/shared/application-media-contract.mjs';
import {applicationTianjiPortraitMetadata} from './application-tianji-portraits';
import {validGenerationSubmissionId} from '../../../electron/shared/assistant-generation-task.mjs';
import type {createCanvasPlanController} from './canvas-operation-plan';

type Canvas=ReturnType<typeof createCanvasPlanController>;
type Resource={actor:string;projectId:string;api:Canvas;expiresAt:number;value:any};
type Reservation={actor:string;request:any;expiresAt:number;api?:Canvas;result?:any;ticketId?:string;planId?:string;selectionVersion?:number;generationInput?:any;canvasGeneration?:any;privateBinding?:string;privateProviderBinding?:string;taskIdentity?:string;localActions?:any;localPlan?:any;taskExporter?:any;exportPlan?:any;referenceMedia?:any[];mediaExecutionKey?:string};
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};

/** Renderer adapter, not an authority issuer. It only calls the established
 * canvas owner and consumes a main-owned one-shot grant immediately beforehand.
 * Resources and nonces are volatile and never saved in project/chat documents.
 */
export function createApplicationOperationDispatcher({getProjectId,getProjects,getCanvas,getAutomation,consume,getInternalScope=()=>null,getLocalActions=()=>null,getTaskReader=()=>null,getTaskExporter=()=>null,now=Date.now}:{
 getProjectId:()=>string;getProjects:()=>{id:string}[];getCanvas:()=>Canvas|null;
 getAutomation:()=>any;consume:(requestId:string,nonce:string)=>Promise<any>;now?:()=>number;
 getInternalScope?:(owner:string)=>{owner:string;selected:boolean;selectionVersion:number;projectId:string}|null;
 getLocalActions?:()=>any;
 getTaskReader?:()=>any;
 getTaskExporter?:()=>any;
}) {
 const tickets=new Map<string,Resource>(),plans=new Map<string,Resource>(),reservations=new Map<string,Reservation>(),referenceCommits=new Map<string,Reservation>();
 let closed=false;
 function prune(){
  for(const [id,r]of tickets)if(now()>=r.expiresAt){r.api.discard(id);tickets.delete(id);}
  for(const [id,r]of plans)if(now()>=r.expiresAt){r.api.discardPreview(id);plans.delete(id);}
  for(const [id,r]of reservations)if(now()>=r.expiresAt)reservations.delete(id);
  for(const [id,r]of referenceCommits)if(now()>=r.expiresAt){r.api?.discard(r.ticketId!);referenceCommits.delete(id);}
 }
 function canvas(projectId:string,expected?:Canvas){
  const api=getCanvas();if(closed||!api||getProjectId()!==projectId||expected&&api!==expected)fail('PLAN_STALE');return api;
 }
 function resource(map:Map<string,Resource>,id:string,actor:string,projectId:string,checkCanvas=true){
  const r=map.get(id);if(!r||r.actor!==actor||r.projectId!==projectId)fail('OPERATION_NOT_FOUND');
  if(checkCanvas)canvas(projectId,r.api);return r;
 }
 function ownerScope(actor:string,request:any,selectionVersion?:number){
  if(actor==='external')return;
  const scope=getInternalScope(actor.slice('internal:'.length));if(!scope||scope.owner!==actor.slice(9))fail('PLAN_SESSION_CHANGED');
  if(!request.operation.endsWith('.release')&&scope.projectId&&request.projectId&&scope.projectId!==request.projectId)fail('PLAN_PROJECT_BINDING');
  if(applicationOperationRequiresSelection(request.operation)&&(!scope.selected||selectionVersion!==undefined&&scope.selectionVersion!==selectionVersion))fail('PLAN_SESSION_CHANGED');
  return scope.selectionVersion;
 }
 async function prepare({requestId,actor,request:input,expiresAt,selectionVersion,referenceMedia,mediaExecutionKey}:{requestId:string;actor:string;request:any;expiresAt:number;selectionVersion?:number;referenceMedia?:any[];mediaExecutionKey?:string}){
  prune();if(closed||!isApplicationOperationActor(actor)||reservations.has(requestId)||referenceCommits.has(requestId))fail('OPERATION_INVALID_AUTHORITY');
  if(!Number.isFinite(expiresAt)||expiresAt<=now())fail('OPERATION_EXPIRED');
  if(reservations.size+referenceCommits.size>=64||tickets.size>=64||plans.size>=32)fail('OPERATION_LIMIT');
  const request=parseApplicationOperationRequest(input),{operation,projectId,arguments:a}=request;
  const r:Reservation={actor,request,expiresAt,selectionVersion:ownerScope(actor,request,selectionVersion)};let review:any={kind:'metadata'};
  if(operation.startsWith('app.preferences.')||operation==='app.navigate'){
   r.localActions=getLocalActions();if(!r.localActions)fail('OPERATION_CONFIGURATION_REQUIRED');
   if(projectId&&getProjectId()!==projectId)fail('PLAN_STALE');
   r.localPlan=r.localActions.prepare(operation,a);review=r.localPlan.review;
  }else if(operation==='canvas.plan.generate'){
   const p=resource(plans,a.planId,actor,projectId);r.api=canvas(projectId,p.api);r.api.validateGenerationTarget(a.planId,a.nodeId);
   const api=getAutomation();if(typeof api?.prepareCanvasGeneration!=='function')fail('PLAN_CANVAS_NOT_READY');
   const captured=r.api.capture();r.ticketId=captured.ticketId;r.api.validateEnvironment(r.ticketId);
   try{r.canvasGeneration=await api.prepareCanvasGeneration(a.nodeId);review=r.canvasGeneration.review;}
   catch(error){r.api.discard(r.ticketId);throw error;}
  }else if(operation.startsWith('canvas.')){
   if(operation.endsWith('.release')){
    const map=operation==='canvas.read.release'?tickets:plans,key=a.ticketId||a.planId;
    const entry=resource(map,key,actor,projectId,false);r.api=entry.api;
   }else r.api=canvas(projectId);
   if(operation.endsWith('.release')){/* no canvas mutation or snapshot */}
   else if(operation==='canvas.read'){
    const value=r.api.capture(a);r.ticketId=value.ticketId;r.result=value;
    tickets.set(value.ticketId,{actor,projectId,api:r.api,expiresAt:Math.min(expiresAt,now()+600000),value});
    review={kind:'canvas.read',scope:value.scope,includeContent:value.includeContent,nodeCount:value.nodes.length,edgeCount:value.edges.length};
   }else if(operation==='canvas.plan.preview'){
    resource(tickets,a.ticketId,actor,projectId);
    const value=r.api.preview(a.ticketId,a.proposal);r.planId=value.planId;r.result=value;
    plans.set(value.planId,{actor,projectId,api:r.api,expiresAt:value.expiresAt,value:{preview:value,ticketId:a.ticketId}});
   }else{
    const p=resource(plans,a.planId,actor,projectId);r.planId=a.planId;
    const check=r.api.preflight(a.planId);
    review={kind:operation,preview:{...p.value.preview,generationPreflight:check}};
   }
  }else if(operation.startsWith('generation.')){
   if(a.references?.length){
    if(typeof mediaExecutionKey!=='string'||!/^[a-f0-9]{64}$/.test(mediaExecutionKey))fail('OPERATION_MEDIA_SCOPE_REQUIRED');
    r.referenceMedia=applicationReferenceMetadata(a.references,referenceMedia);r.mediaExecutionKey=mediaExecutionKey;
    if(r.referenceMedia.some(m=>m.expiresAt<=now()))fail('OPERATION_EXPIRED');
   }
   r.api=canvas(projectId);const api=getAutomation();if(typeof api?.describeGeneration!=='function')fail('PLAN_CANVAS_NOT_READY');
   const captured=r.api.capture();r.ticketId=captured.ticketId;r.api.validateEnvironment(r.ticketId);
   try{const described=await api.describeGeneration(operation.slice(11),a,r.referenceMedia||[]);r.generationInput={...described.effectiveArguments,nodeFields:described.nodeFields};r.privateBinding=described.privateBinding;r.privateProviderBinding=described.privateProviderBinding;const {nodeFields,effectiveArguments,privateBinding,privateProviderBinding,...publicReview}=described;review=publicReview;}catch(error){r.api.discard(r.ticketId);throw error;}
  }else if(operation==='media.import'||operation==='media.reference.release'){
   if(operation==='media.import'&&getProjectId()!==projectId)fail('PLAN_STALE');review=operation==='media.import'?applicationMediaImportReview(a):{kind:'media.reference.release'};
  }else if(operation==='media.export'){
   if(getProjectId()!==projectId)fail('PLAN_STALE');r.taskExporter=getTaskExporter();if(!r.taskExporter)fail('OPERATION_MEDIA_UNSUPPORTED');r.exportPlan=r.taskExporter.prepare(projectId,a.id);review=r.exportPlan.review;
  }else if(operation==='tasks.cancel'){
   r.api=canvas(projectId);const task=(await getAutomation()?.task?.({id:a.id,materialize:false}))?.task;
   if(!task||!task.nodeId||task.projectId!==projectId||!['pending','submitting','queued','running','processing'].includes(task.status))fail('OPERATION_TASK_CHANGED');
   r.taskIdentity=taskIdentity(task);review={kind:'tasks.cancel',task:applicationOperationMetadata('tasks.get',{task}).task};
  }else if(operation==='projects.list'){
   const projects=getProjects();if(!Array.isArray(projects)||projects.length>2000)fail('OPERATION_RESULT_LIMIT');
   r.result={projects:projects.map(p=>({id:String(p.id),active:p.id===getProjectId()}))};
  }else if(!['app.status','models.list','tasks.list','tasks.get'].includes(operation))fail('OPERATION_UNSUPPORTED');
  reservations.set(requestId,r);return review;
 }
 async function executeGeneration(r:Reservation,referenceMedia:any[]=[]){
  const {operation,projectId}=r.request,api=canvas(projectId,r.api),names={'generation.image':'generateImage','generation.video':'generateVideo','generation.tianji':'generateTianjiVideo'},name=names[operation];
  const checkScope=(stage:string)=>{if(now()>=r.expiresAt)fail('OPERATION_EXPIRED');canvas(projectId,r.api);ownerScope(r.actor,r.request,r.selectionVersion);if(stage==='create')api.validateRead(r.ticketId!);else api.validateEnvironment(r.ticketId!);};
  const guard=(stage:string,providerBinding?:string)=>{
   checkScope(stage);
   if(['sender','upload','submit'].includes(stage)&&operation==='generation.tianji')return (async()=>{
    const current=await getAutomation()?.describeGeneration('tianji',r.request.arguments,r.referenceMedia||[]);
    if(current?.privateBinding!==r.privateBinding||providerBinding!==undefined&&providerBinding!==r.privateProviderBinding)fail('PLAN_STALE');
    checkScope('dispatch');
   })();
  };
  try{guard('create');if(operation==='generation.tianji'){const check=await getAutomation()?.describeGeneration('tianji',r.request.arguments,r.referenceMedia||[]);if(check?.privateBinding!==r.privateBinding)fail('PLAN_STALE');guard('create');}
   let portraitMedia:any[]=[];
   if(operation==='generation.tianji'&&r.request.arguments.portraitAssetIds?.length){
    const api=getAutomation();if(typeof api?.resolveTianjiPortraits!=='function')fail('OPERATION_MEDIA_UNSUPPORTED');
    const values=await api.resolveTianjiPortraits(r.request.arguments.portraitAssetIds,guard);guard('create');
    portraitMedia=applicationTianjiPortraitMetadata(r.request.arguments.portraitAssetIds,values);
    const current=await getAutomation()?.describeGeneration('tianji',r.request.arguments,r.referenceMedia||[]);
    if(current?.privateBinding!==r.privateBinding)fail('PLAN_STALE');guard('create');
   }
   const result=await getAutomation()?.[name]?.({...r.generationInput,...(referenceMedia.length?{referenceMedia}:{}),...(portraitMedia.length?{portraitMedia}:{})},guard);
   if(!result?.ok||!result.accepted||typeof result.nodeId!=='string')fail('OPERATION_OUTCOME_UNKNOWN');
   return {accepted:true,nodeId:result.nodeId,projectId,generationStarted:true,generationCompleted:false};
  }finally{api.discard(r.ticketId!);}
 }
 async function completeGeneration({requestId,mediaExecutionKey,referenceMedia}:{requestId:string;mediaExecutionKey:string;referenceMedia:any[]}){
  const r=referenceCommits.get(requestId);if(!r||closed||now()>=r.expiresAt)fail('OPERATION_EXPIRED');
  if(mediaExecutionKey!==r.mediaExecutionKey)fail('OPERATION_INVALID_AUTHORITY');
  // Main, not the model/transport, supplies the private verified local sources.
  const refs=applicationReferenceMetadata(r.request.arguments.references,referenceMedia,true);
  for(let i=0;i<refs.length;i++){const {source,...metadata}=refs[i];if(JSON.stringify(metadata)!==JSON.stringify(r.referenceMedia![i])||metadata.expiresAt<=now())fail('OPERATION_MEDIA_INVALID');}
  referenceCommits.delete(requestId);return executeGeneration(r,refs);
 }
 async function commit({requestId,nonce}:{requestId:string;nonce:string}){
  const r=reservations.get(requestId);if(!r||closed||now()>=r.expiresAt)fail('OPERATION_EXPIRED');
  // Await authority first, then revalidate project and graph synchronously. The
  // HTTP request/model cannot supply or grant this nonce or a permission flag.
  const grant=await consume(requestId,nonce);
  if(!grant||grant.actor!==r.actor||grant.operation!==r.request.operation||grant.projectId!==r.request.projectId||grant.expiresAt!==r.expiresAt)fail('OPERATION_INVALID_AUTHORITY');
  if(reservations.get(requestId)!==r||closed||now()>=r.expiresAt)fail('OPERATION_EXPIRED');
  reservations.delete(requestId);
  const {operation,projectId,arguments:a}=r.request;
  ownerScope(r.actor,r.request,r.selectionVersion);
  if(operation==='canvas.plan.generate'){
   const api=canvas(projectId,r.api);
   const guard=(stage:string)=>{
    if(closed||now()>=r.expiresAt)fail('OPERATION_EXPIRED');canvas(projectId,r.api);ownerScope(r.actor,r.request,r.selectionVersion);
    resource(plans,a.planId,r.actor,projectId);api.validateGenerationTarget(a.planId,a.nodeId);
    if(stage==='create')api.validateRead(r.ticketId!);else api.validateEnvironment(r.ticketId!);
   };
   try{const result=await r.canvasGeneration.commit(guard);
    if(!result?.ok||!result.accepted||typeof result.nodeId!=='string')fail('OPERATION_OUTCOME_UNKNOWN');
    return {accepted:true,nodeId:result.nodeId,sourceNodeId:a.nodeId,resultBranch:result.resultBranch===true,projectId,generationStarted:true,generationCompleted:false,
     ...(validGenerationSubmissionId(result.submissionId)?{taskReference:{version:1,projectId,nodeId:result.nodeId,submissionId:result.submissionId}}:{})};
   }finally{api.discard(r.ticketId!);}
  }
  if(operation==='media.import'||operation==='media.reference.release'){if(operation==='media.import'&&getProjectId()!==projectId)fail('PLAN_STALE');return {ready:true};}
  if(r.exportPlan){const guard=()=>{if(closed||getTaskExporter()!==r.taskExporter||getProjectId()!==projectId)fail('PLAN_STALE');ownerScope(r.actor,r.request,r.selectionVersion);};return r.exportPlan.commit(guard);}
  if(r.localPlan){
   const guard=()=>{if(closed||getLocalActions()!==r.localActions||projectId&&getProjectId()!==projectId)fail('PLAN_STALE');ownerScope(r.actor,r.request,r.selectionVersion);};
   return r.localPlan.commit(guard);
  }
  if(operation.startsWith('generation.')){
   if(r.referenceMedia?.length){try{canvas(projectId,r.api).validateRead(r.ticketId!);referenceCommits.set(requestId,r);return {referencesReady:true};}catch(error){r.api?.discard(r.ticketId!);throw error;}}
   return executeGeneration(r);
  }
  if(operation==='tasks.cancel'){
   canvas(projectId,r.api);const api=getAutomation(),task=(await api?.task?.({id:a.id,materialize:false}))?.task;
   const guard=()=>{ownerScope(r.actor,r.request,r.selectionVersion);canvas(projectId,r.api);};guard();if(!task||!['pending','submitting','queued','running','processing'].includes(task.status)||taskIdentity(task)!==r.taskIdentity)fail('OPERATION_TASK_CHANGED');
   const result=await api.cancel({id:task.id,projectId,nodeId:task.nodeId,createdAt:task.createdAt},guard);if(!result?.ok)fail('OPERATION_TASK_CHANGED');return {taskId:task.id,nodeId:task.nodeId,cancellationRequested:true,remoteStoppedConfirmed:false};
  }
  if(operation.startsWith('canvas.')){
   if(operation.endsWith('.release')){
    const map=operation==='canvas.read.release'?tickets:plans,key=a.ticketId||a.planId,entry=resource(map,key,r.actor,projectId,false);
    if(operation==='canvas.read.release'){entry.api.discard(key);tickets.delete(key);for(const [id,p]of plans)if(p.actor===r.actor&&p.value.ticketId===key&&(!p.value.applied||p.value.undone)){p.api.discardPreview(id);plans.delete(id);}}
    else {entry.api.discardPreview(key);if(!entry.value.applied)plans.delete(key);}
    return {released:true};
   }
   const api=canvas(projectId,r.api);
   if(operation==='canvas.read'){api.validateRead(r.ticketId!);return structuredClone(r.result);}
   if(operation==='canvas.plan.preview'){
    resource(plans,r.planId!,r.actor,projectId);api.preflight(r.planId!);return structuredClone(r.result);
   }
   resource(plans,a.planId,r.actor,projectId);
   if(operation==='canvas.plan.apply'){const result=api.execute(a.planId);plans.get(a.planId)!.value.applied=true;return result;}
   if(operation==='canvas.plan.undo'){const result=api.undo(a.planId);plans.get(a.planId)!.value.undone=true;return result;}
   if(operation==='canvas.generation.preflight')return api.preflight(a.planId);
   fail('OPERATION_UNSUPPORTED');
  }
  if(operation==='projects.list')return structuredClone(r.result);
  const names={'app.status':'status','models.list':'models','tasks.list':'tasks','tasks.get':'task'};
  const name=names[operation],taskRead=['tasks.list','tasks.get'].includes(operation),api=taskRead?getTaskReader():getAutomation();if(!name||typeof api?.[name]!=='function')fail(taskRead?'OPERATION_TASKS_UNAVAILABLE':'PLAN_CANVAS_NOT_READY');
  return applicationOperationMetadata(operation,await api[name](a),{includeDiagnostics:a.includeDiagnostics===true});
 }
 function release({requestId}:{requestId:string}){const r=reservations.get(requestId)||referenceCommits.get(requestId);reservations.delete(requestId);referenceCommits.delete(requestId);
  // Unreturned content reads must not become a usable read ticket on rejection.
  if(r?.ticketId){r.api?.discard(r.ticketId);tickets.delete(r.ticketId);}
  if(r?.planId&&r.request.operation==='canvas.plan.preview'){r.api?.discardPreview(r.planId);plans.delete(r.planId);}
 }
 async function envelope(action:()=>unknown){try{return {ok:true,value:await action()};}catch(error){return {ok:false,code:applicationOperationErrorCode(error)};}}
 return {prepare,commit,completeGeneration,release,
  bridge:{prepare:(value:any)=>envelope(()=>prepare(value)),commit:(value:any)=>envelope(()=>commit(value)),completeGeneration:(value:any)=>envelope(()=>completeGeneration(value)),release:(value:any)=>envelope(()=>release(value)),activeProject:()=>envelope(()=>getProjectId())},
  close(){closed=true;for(const id of [...reservations.keys(),...referenceCommits.keys()])release({requestId:id});for(const [id,r]of tickets)r.api.discard(id);for(const [id,r]of plans)r.api.discardPreview(id);tickets.clear();plans.clear();},
 };
}
function taskIdentity(task:any){return JSON.stringify([task.id,task.nodeId,task.projectId,task.createdAt,task.modelName,task.type]);}
