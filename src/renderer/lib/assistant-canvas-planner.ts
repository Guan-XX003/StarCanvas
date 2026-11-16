import type {AssistantWorkspaceClient} from './assistant-workspace-client';
import {buildCanvasPlanningPrompt,canvasPlanningRequestFromCapture} from '../../../electron/shared/canvas-planning-protocol.mjs';
import {containsLikelyAssistantSecret,clearAssistantProposals} from './assistant-onboarding';
import {parseCanvasPlan,type CanvasPlanProposal,type createCanvasPlanController} from './canvas-operation-plan';
import {createAssistantOperationClient} from './assistant-operation-client';
import {captureAssistantGenerationTask} from '../../../electron/shared/assistant-generation-task.mjs';

type CanvasApi=ReturnType<typeof createCanvasPlanController>;
const problem=(code:string)=>Object.assign(new Error(code),{code});
const codeOf=(error:any)=>/^(?:PLAN|ASSISTANT|OPERATION)_[A-Z_]+$/.test(error?.code||'')?error.code:'PLAN_REQUEST_FAILED';
export function parseCanvasPlanningReply(reply:unknown):CanvasPlanProposal {
 if(typeof reply!=='string'||reply.length>256*1024)throw problem('PLAN_INVALID_RESPONSE');
 let raw=reply.trim();
 if(/^```(?:json)?\s*\n/i.test(raw)&&/\n```$/.test(raw))raw=raw.replace(/^```(?:json)?\s*\n/i,'').replace(/\n```$/,'').trim();
 let input;try{input=JSON.parse(raw);}catch{throw problem('PLAN_INVALID_RESPONSE');}return parseCanvasPlan(input);
}
/** All operations use the main service shared with CLI/MCP. Controller references
 * serve only identity checks and immediate disposal, never an execution fallback.
 */
export function createAssistantCanvasPlanner(client:AssistantWorkspaceClient,getCanvas:(projectId:string)=>CanvasApi|null,getBridge:()=>any=()=>(globalThis as any).wanjuanDesktop) {
 const gateway=createAssistantOperationClient(getBridge),set=(id:string,value:any)=>client.set(id,'canvasPlan',value);
 const active=(id:string)=>{if(client.getSnapshot().switching||client.getSnapshot().selectedId!==id)throw problem('PLAN_SESSION_CHANGED');return client.viewFor(id);};
 const selected=(id:string)=>client.operationScope(id)?.selected===true;
 function release(state:any){
  if(state.generation?.handle&&['preparing','review'].includes(state.generation.phase))void gateway.cancel(state.generation.handle).catch(()=>{});
  state.api?.discard(state.ticketId);
  if(state.ticketId&&state.owner)void gateway.run(state.owner,'canvas.read.release',state.projectId,{ticketId:state.ticketId}).catch(()=>{});
 }
 function idle(view:any){if(view.busy||view.sending||view.importingMedia||view.refs.modelSendInFlight.current||view.canvasPlan.working||view.canvasPlan.pendingOperation||['preparing','review','submitting','uncertain'].includes(view.canvasPlan.generation?.phase))throw problem('ASSISTANT_BUSY');}
 function begin(id:string,projectId:string,projectName='') {
  const view=active(id);idle(view);
  if(view.record?.value.projectId&&view.record.value.projectId!==projectId)throw problem('PLAN_PROJECT_BINDING');
  release(view.canvasPlan);set(id,{phase:'scope',owner:id,projectId,projectName,scope:'selected',includeContent:false});
 }
 function configure(id:string,patch:{scope?:'selected'|'structure';includeContent?:boolean}) {
  const view=active(id),state=view.canvasPlan;if(state.phase!=='scope')throw problem('PLAN_ALREADY_CONSUMED');idle(view);set(id,{...state,...patch});
 }
 function dismiss(id:string) {const view=active(id);if(view.busy||view.sending||view.canvasPlan.working||view.canvasPlan.generation?.phase==='uncertain')throw problem('ASSISTANT_BUSY');release(view.canvasPlan);set(id,{phase:'idle'});}
 const jobUpdate=(id:string,requestId:string)=>(job:any)=>{const state=client.viewFor(id).canvasPlan;if(state.requestId===requestId&&state.phase!=='expired')set(id,{...state,operationJob:{id:job.id,status:job.status,operation:job.operation}});};
 async function request(id:string,projectId:string,text:string,options:{custom:boolean;environment?:any;ready:boolean;notice:string}) {
  const view=active(id),scope=view.canvasPlan;if(['reading','requesting'].includes(scope.phase))return null;
  if(scope.phase!=='scope'||scope.projectId!==projectId)throw problem('PLAN_STALE');if(!options.ready)throw problem('PLAN_ASSISTANT_UNAVAILABLE');idle(view);
  if(view.refs.resetInFlight.current||view.refs.cancelInFlight.current)throw problem('ASSISTANT_BUSY');
  if(view.record?.value.projectId&&view.record.value.projectId!==projectId)throw problem('PLAN_PROJECT_BINDING');
  if(view.record?.value.attachments?.length)throw problem('ASSISTANT_ATTACHMENT_UNSUPPORTED');
  const api=getCanvas(projectId);if(!api)throw problem('PLAN_CANVAS_NOT_READY');
  const requestId=crypto.randomUUID(),inputRevision=view.refs.inputRevision.current;
  view.refs.modelSendInFlight.current=true;view.refs.modelCancellationRequested.current=false;
  client.set(id,'busy',true);client.set(id,'sending',true);
  set(id,{...scope,api,requestId,phase:'reading'});let captured:any,modelStarted=false;
  try{
   captured=await gateway.run(id,'canvas.read',projectId,{scope:scope.scope,includeContent:scope.includeContent},{confirm:scope.includeContent,isCurrent:()=>selected(id),onJob:jobUpdate(id,requestId)});
   if(view.refs.modelCancellationRequested.current||view.canvasPlan.requestId!==requestId||view.canvasPlan.phase==='expired')throw problem('ASSISTANT_CANCELLED');
   if(new TextEncoder().encode(JSON.stringify(captured)).byteLength>64000)throw problem('PLAN_SCOPE_TOO_LARGE');
   const wire=canvasPlanningRequestFromCapture(captured);buildCanvasPlanningPrompt(text,wire,containsLikelyAssistantSecret);
   for(const item of view.messages)if(item.action||item.preference)view.refs.consumedActions.current.add(item);
   client.set(id,'messages',[...clearAssistantProposals(view.messages),{role:'user',text}]);client.set(id,'draft','');client.set(id,'chatError','');client.set(id,'chatNotice','');
   const current={phase:'requesting',owner:id,projectId,projectName:scope.projectName,api,ticketId:captured.ticketId,requestId,wire};set(id,current);modelStarted=true;
   const result=options.custom?await client.sendCustom(id,text,options.environment,wire):await client.send(id,text,{canvasPlan:wire});
   if(view.refs.modelCancellationRequested.current||view.canvasPlan.requestId!==requestId||view.canvasPlan.phase==='expired')throw problem('ASSISTANT_CANCELLED');
   if(!result.ok)throw problem(result.code||'PLAN_REQUEST_FAILED');
   const proposal=parseCanvasPlanningReply(result.value),preview=await gateway.run(id,'canvas.plan.preview',projectId,{ticketId:captured.ticketId,proposal},{onJob:jobUpdate(id,requestId)});
   if(view.refs.modelCancellationRequested.current||view.canvasPlan.requestId!==requestId||view.canvasPlan.phase==='expired')throw problem('ASSISTANT_CANCELLED');
   set(id,{...current,phase:'preview',preview,draftProposal:structuredClone(proposal),draftRevision:0,dirty:false});
   client.set(id,'messages',[...view.messages,{role:'assistant',text:options.notice}]);return preview;
  }catch(error){
   if(captured)release({owner:id,projectId,api,ticketId:captured.ticketId});
   if(!options.custom&&codeOf(error)==='ASSISTANT_RUNTIME_STOP_UNCONFIRMED'){view.refs.proposalFence.current=true;client.set(id,'requiresReset',true);}
   if(view.canvasPlan.requestId===requestId&&view.canvasPlan.phase!=='expired')set(id,modelStarted?{phase:'failed',projectId,code:codeOf(error)}:{...scope,code:codeOf(error)});
   if(modelStarted&&view.refs.inputRevision.current===inputRevision&&!view.draft)client.set(id,'draft',text);
   if(!modelStarted)throw error;return null;
  }finally{view.refs.modelSendInFlight.current=false;client.set(id,'busy',false);client.set(id,'sending',false);client.set(id,'cancelledTurnWaiting',false);}
 }
 function edit(id:string,index:number,key:string,value:string) {
  const view=active(id),state=view.canvasPlan;idle(view);if(!['preview','invalid'].includes(state.phase)||!state.draftProposal)throw problem('PLAN_ALREADY_CONSUMED');
  const proposal=structuredClone(state.draftProposal),op=proposal.operations[index];if(!['create','update'].includes(op?.op)||!Object.hasOwn(op.fields,key))throw problem('PLAN_INVALID');
  op.fields[key]=value;set(id,{...state,draftProposal:proposal,draftRevision:(state.draftRevision||0)+1,dirty:true,code:''});
 }
 function accept(id:string,state:any,kind:string,result:any,receipt:string){
  const view=client.viewFor(id),latest=view.canvasPlan;if(latest.requestId!==state.requestId)return;
  if(kind==='validate')set(id,{...latest,phase:latest.phase==='expired'?'expired':'preview',preview:result,dirty:false,code:'',pendingOperation:null});
  else if(kind==='preflight')set(id,{...latest,preview:{...latest.preview,generationPreflight:result},code:'',pendingOperation:null});
  else{
   set(id,{...latest,phase:latest.phase==='expired'?'expired':kind==='apply'?'applied':'undone',lastResult:result,code:'',pendingOperation:null});
   if(!result.replayed)client.set(id,'messages',[...view.messages,{role:'assistant',text:receipt,executionStatus:'confirmed'}]);
  }
 }
 function operate(id:string,state:any,kind:string,receipt:string,execute:(onJob:any)=>Promise<any>){
  const view=client.viewFor(id);if(view.canvasPlan.inFlight)return view.canvasPlan.inFlight;
  const task=Promise.resolve().then(()=>execute(jobUpdate(id,state.requestId))).then(result=>{accept(id,state,kind,result,receipt);return result;}).catch(error=>{
   const latest=view.canvasPlan;if(latest.requestId===state.requestId){
    const uncertain=codeOf(error)==='OPERATION_OUTCOME_UNKNOWN';
    set(id,{...latest,phase:uncertain?'uncertain':latest.phase==='expired'?'expired':kind==='validate'?'invalid':kind==='apply'?'expired':latest.phase,code:codeOf(error),...(uncertain?{pendingOperation:{handle:error.operationHandle,kind,receipt}}:{})});
   }throw error;
  }).finally(()=>{const latest=view.canvasPlan;if(latest.requestId===state.requestId)set(id,{...latest,working:false,inFlight:null});});
  set(id,{...state,working:true,inFlight:task,code:''});return task;
 }
 function validate(id:string,projectId:string) {
  const view=active(id),state=view.canvasPlan;if(state.inFlight)return state.inFlight;idle(view);
  if(!state.dirty||!['preview','invalid'].includes(state.phase)||state.projectId!==projectId)throw problem('PLAN_STALE');
  return operate(id,state,'validate','',async onJob=>{
   if(state.preview?.planId)try{await gateway.run(id,'canvas.plan.release',projectId,{planId:state.preview.planId});}catch(error){if(codeOf(error)!=='OPERATION_NOT_FOUND')throw error;}
   return gateway.run(id,'canvas.plan.preview',projectId,{ticketId:state.ticketId,proposal:state.draftProposal},{onJob});
  }).catch(()=>null);
 }
 function apply(id:string,projectId:string,receipt:string) {
  const view=active(id),state=view.canvasPlan;if(state.inFlight)return state.inFlight;
  if(state.phase==='applied'&&state.projectId===projectId&&getCanvas(projectId)===state.api)return Promise.resolve({...state.lastResult,replayed:true});
  if(state.phase!=='preview'||state.dirty)throw problem('PLAN_REVIEW_REQUIRED');
  if(state.projectId!==projectId||getCanvas(projectId)!==state.api)throw problem('PLAN_STALE');idle(view);
  const selectionVersion=client.operationScope(id)!.selectionVersion;
  return operate(id,state,'apply',receipt,onJob=>gateway.run(id,'canvas.plan.apply',projectId,{planId:state.preview.planId},{confirm:true,selectionVersion,isCurrent:()=>selected(id)&&client.operationScope(id)?.selectionVersion===selectionVersion,onJob}));
 }
 function undo(id:string,projectId:string,receipt:string) {
  const view=active(id),state=view.canvasPlan;if(state.inFlight)return state.inFlight;
  if(state.phase==='undone'&&state.projectId===projectId&&getCanvas(projectId)===state.api)return Promise.resolve({...state.lastResult,replayed:true});
  if(state.phase!=='applied'||state.projectId!==projectId||getCanvas(projectId)!==state.api)throw problem('PLAN_STALE');idle(view);
  const selectionVersion=client.operationScope(id)!.selectionVersion;
  return operate(id,state,'undo',receipt,onJob=>gateway.run(id,'canvas.plan.undo',projectId,{planId:state.preview.planId},{confirm:true,selectionVersion,isCurrent:()=>selected(id)&&client.operationScope(id)?.selectionVersion===selectionVersion,onJob}));
 }
 /** The legacy one-node button is an explicit user confirmation. It uses the
  * same read/preview/apply authority, factory, undo and unknown-result path as
  * a full plan; no model request or direct canvas writer is involved. */
 function createSingle(id:string,projectId:string,kind:'text'|'image'|'video',content:string,position:{x:number;y:number},options:{receipt:string;projectName?:string;intent:string}){
  const view=active(id),key=JSON.stringify([projectId,kind,content,position,options.intent]),old=view.canvasPlan;
  if(old.inFlight){if(old.singleKey===key)return old.inFlight;throw problem('ASSISTANT_BUSY');}
  if(old.singleKey===key&&old.phase==='applied')return Promise.resolve({...old.lastResult,replayed:true});
  idle(view);if(old.pendingOperation||['scope','preview','invalid','reading','requesting'].includes(old.phase))throw problem('ASSISTANT_BUSY');
  if(view.record?.value.projectId&&view.record.value.projectId!==projectId)throw problem('PLAN_PROJECT_BINDING');
  if(typeof content!=='string'||content.length>4000||containsLikelyAssistantSecret(content))throw problem('PLAN_INVALID');
  const proposal=parseCanvasPlan({version:1,operations:[{op:'create',key:'suggested',kind,position,fields:kind==='text'?{text:content}:{prompt:content}}]});
  const api=getCanvas(projectId);if(!api)throw problem('PLAN_CANVAS_NOT_READY');
  const selectionVersion=client.operationScope(id)!.selectionVersion,requestId=crypto.randomUUID();release(old);
  const state={phase:'reading',owner:id,projectId,projectName:options.projectName||'',requestId,api,singleKey:key};let ticketId='',applying=false,confirmedResult:any=null,applyHandle:any=null;
  const current=()=>view.canvasPlan.requestId===requestId&&view.canvasPlan.phase!=='expired'&&selected(id)&&client.operationScope(id)?.selectionVersion===selectionVersion&&getCanvas(projectId)===api;
  const task=Promise.resolve().then(async()=>{
   const capture=await gateway.run(id,'canvas.read',projectId,{scope:'selected',includeContent:false},{onJob:jobUpdate(id,requestId)});ticketId=capture.ticketId;
   if(!current())throw problem('PLAN_SESSION_CHANGED');
   const preview=await gateway.run(id,'canvas.plan.preview',projectId,{ticketId,proposal},{onJob:jobUpdate(id,requestId)});
   if(!current())throw problem('PLAN_SESSION_CHANGED');
   set(id,{...view.canvasPlan,ticketId,phase:'preview',preview,draftProposal:proposal,dirty:false});applying=true;
   const result=await gateway.run(id,'canvas.plan.apply',projectId,{planId:preview.planId},{confirm:true,selectionVersion,isCurrent:current,onJob:(job,handle)=>{applyHandle=handle;jobUpdate(id,requestId)(job);}});confirmedResult=result;
   accept(id,state,'apply',result,options.receipt);return result;
  }).catch(error=>{
   const uncertain=applying&&(!!confirmedResult||codeOf(error)==='OPERATION_OUTCOME_UNKNOWN');
   const code=!applying&&codeOf(error)==='OPERATION_OUTCOME_UNKNOWN'?'PLAN_PREPARE_FAILED':codeOf(error);
   if(view.canvasPlan.requestId===requestId)set(id,{...view.canvasPlan,phase:uncertain?'uncertain':'expired',code:uncertain?'OPERATION_OUTCOME_UNKNOWN':code,...(uncertain?{pendingOperation:{handle:error.operationHandle||applyHandle,kind:'apply',receipt:options.receipt}}:{})});
   if(!uncertain&&ticketId)release({owner:id,projectId,api,ticketId});
   if(confirmedResult)throw Object.assign(problem('OPERATION_OUTCOME_UNKNOWN'),{operationHandle:applyHandle});
   if(code!==codeOf(error))throw problem(code);throw error;
  }).finally(()=>{if(view.canvasPlan.requestId===requestId)set(id,{...view.canvasPlan,working:false,inFlight:null});});
  set(id,{...state,working:true,inFlight:task});return task;
 }
 function preflight(id:string,projectId:string) {
  const view=active(id),state=view.canvasPlan;if(state.inFlight)return state.inFlight;idle(view);
  if(state.dirty||!['preview','applied'].includes(state.phase))throw problem('PLAN_REVIEW_REQUIRED');
  if(state.projectId!==projectId||getCanvas(projectId)!==state.api)throw problem('PLAN_STALE');
  return operate(id,state,'preflight','',onJob=>gateway.run(id,'canvas.generation.preflight',projectId,{planId:state.preview.planId},{onJob}));
 }
 function recover(id:string){
  const view=active(id),state=view.canvasPlan;if(state.inFlight)return state.inFlight;
  const pending=state.pendingOperation;if(!pending?.handle)throw problem('OPERATION_NOT_FOUND');
  if(pending.kind==='validate'&&pending.handle.operation==='canvas.plan.release')return gateway.recover(pending.handle).then(()=>set(id,{...view.canvasPlan,phase:'invalid',pendingOperation:null,code:'PLAN_REVIEW_REQUIRED'}));
  return operate(id,state,pending.kind,pending.receipt,onJob=>gateway.recover(pending.handle,onJob));
 }
 function generationState(id:string,requestId:string,value:any){
  const state=client.viewFor(id).canvasPlan;if(state.requestId===requestId)set(id,{...state,generation:value});
 }
 function acceptedGeneration(id:string,state:any,result:any,receipt=''){
  const view=client.viewFor(id),reference=result.taskReference?captureAssistantGenerationTask(result.taskReference):null;
  const text=receipt||view.canvasPlan.generation?.receipt||'';
  if((text||reference)&&(!reference||!view.messages.some(item=>item.generationTask?.submissionId===reference.submissionId))){
   try{client.set(id,'messages',[...view.messages,{role:'assistant',text,executionStatus:'confirmed',...(reference?{generationTask:reference}:{})}]);}
   catch{throw Object.assign(problem('OPERATION_OUTCOME_UNKNOWN'),{operationHandle:view.canvasPlan.generation?.handle});}
  }
  generationState(id,state.requestId,{...client.viewFor(id).canvasPlan.generation,phase:'accepted',result,review:undefined,code:''});
 }
 function prepareGeneration(id:string,projectId:string,nodeId:string){
  const view=active(id),state=view.canvasPlan;if(state.working&&state.generation?.nodeId===nodeId)return state.generation.inFlight;
  idle(view);if(state.phase!=='applied'||state.projectId!==projectId||getCanvas(projectId)!==state.api)throw problem('PLAN_STALE');
  const selectionVersion=client.operationScope(id)!.selectionVersion;
  const task=gateway.prepare(id,'canvas.plan.generate',projectId,{planId:state.preview.planId,nodeId},{selectionVersion}).then(({handle,job})=>{
   generationState(id,state.requestId,{phase:job.status==='completed'?'accepted':'review',nodeId,handle,revision:job.revision,review:job.review,result:job.result,selectionVersion});return job;
  }).catch(error=>{
   generationState(id,state.requestId,{phase:codeOf(error)==='OPERATION_OUTCOME_UNKNOWN'?'uncertain':'failed',nodeId,handle:error.operationHandle,code:codeOf(error),selectionVersion});throw error;
  }).finally(()=>{if(view.canvasPlan.requestId===state.requestId)set(id,{...view.canvasPlan,working:false});});
  set(id,{...state,working:true,generation:{phase:'preparing',nodeId,selectionVersion,inFlight:task}});return task;
 }
 function approveGeneration(id:string,projectId:string,consent:{content:boolean;cost:boolean},receipt:string){
  const view=active(id),state=view.canvasPlan,g=state.generation;if(g?.phase==='submitting')return g.inFlight;
  if(state.phase!=='applied'||state.projectId!==projectId||g?.phase!=='review'||!g.handle||getCanvas(projectId)!==state.api)throw problem('PLAN_STALE');
  if(consent?.content!==true||consent?.cost!==true)throw problem('OPERATION_PERMISSION_REQUIRED');
  const task=gateway.approve(g.handle,g.revision,{isCurrent:()=>selected(id)&&client.operationScope(id)?.selectionVersion===g.selectionVersion&&view.canvasPlan.requestId===state.requestId&&view.canvasPlan.phase==='applied'}).then(result=>{
   acceptedGeneration(id,state,result,receipt);return result;
  }).catch(error=>{
   generationState(id,state.requestId,{...g,receipt,phase:codeOf(error)==='OPERATION_OUTCOME_UNKNOWN'?'uncertain':'failed',code:codeOf(error)});throw error;
  }).finally(()=>{if(view.canvasPlan.requestId===state.requestId)set(id,{...view.canvasPlan,working:false});});
  set(id,{...state,working:true,generation:{...g,receipt,phase:'submitting',inFlight:task}});return task;
 }
 async function dismissGeneration(id:string){
  const view=active(id),state=view.canvasPlan,g=state.generation;if(!g||state.working||!['review','failed'].includes(g.phase))throw problem('ASSISTANT_BUSY');
  if(g.phase==='review')await gateway.cancel(g.handle);
  if(view.canvasPlan.generation===g)generationState(id,state.requestId,null);
 }
 async function observeGeneration(id:string){
  const view=active(id),state=view.canvasPlan,g=state.generation;if(state.working||!g?.handle||g.phase!=='uncertain')throw problem('ASSISTANT_BUSY');
  set(id,{...state,working:true});
  try{
   const job=await gateway.inspect(g.handle);
   if(job.status==='completed')acceptedGeneration(id,state,job.result);
   else if(job.status==='awaiting_confirmation'&&job.review)generationState(id,state.requestId,{...g,phase:'review',revision:job.revision,review:job.review,code:''});
   else if(['failed','expired','rejected','cancelled'].includes(job.status))generationState(id,state.requestId,{...g,phase:'failed',code:job.code||'OPERATION_EXPIRED'});
  }finally{if(view.canvasPlan.requestId===state.requestId)set(id,{...view.canvasPlan,working:false});}
 }
 return {begin,configure,request,dismiss,edit,validate,apply,undo,createSingle,preflight,recover,prepareGeneration,approveGeneration,dismissGeneration,observeGeneration};
}
