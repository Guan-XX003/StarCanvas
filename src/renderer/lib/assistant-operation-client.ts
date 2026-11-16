import {parseApplicationOperationRequest,applicationOperationErrorCode} from '../../../electron/shared/application-operation-contract.mjs';

export type AssistantOperationHandle={owner:string;id:string;operation:string;projectId:string;idempotencyKey:string};
class OperationClientError extends Error {constructor(public code:string,public operationHandle?:AssistantOperationHandle){super(code);}}
const fail=(code:string,handle?:AssistantOperationHandle):never=>{throw new OperationClientError(code,handle);};
/** The same main service as CLI/MCP, with trusted UI confirmation kept outside
 * model arguments. No direct canvas fallback and no automatic write retries.
 */
export function createAssistantOperationClient(getBridge:()=>any,{waitMs=12000,intervalMs=25,now=Date.now}:{waitMs?:number;intervalMs?:number;now?:()=>number}={}){
 async function call(method:string,args:any[],handle?:AssistantOperationHandle){
  try{const bridge=getBridge();if(typeof bridge?.[method]!=='function')fail(handle?'OPERATION_OUTCOME_UNKNOWN':'OPERATION_PERMISSION_REQUIRED',handle);
   const result=await bridge[method](...args);if(!result?.ok)fail(handle?'OPERATION_OUTCOME_UNKNOWN':applicationOperationErrorCode(result),handle);return result.value;
  }catch(error){if(error instanceof OperationClientError)throw error;fail(handle?'OPERATION_OUTCOME_UNKNOWN':'OPERATION_FAILED',handle);}
 }
 async function observe(handle:AssistantOperationHandle,onJob?:(job:any,handle:AssistantOperationHandle)=>void){
  const job=await call('applicationOperationReadInternal',[handle.owner,handle.id],handle);onJob?.(job,handle);return job;
 }
 function result(job:any,handle:AssistantOperationHandle){
  if(job.status==='completed'&&!job.resultExpired)return job.result;
  if(job.status==='outcome_unknown')fail('OPERATION_OUTCOME_UNKNOWN',handle);
  if(job.status==='failed')fail(applicationOperationErrorCode(job),handle);
  if(['expired','cancelled','rejected'].includes(job.status)||job.resultExpired)fail(job.code||'OPERATION_EXPIRED',handle);
  return undefined;
 }
 async function run(owner:string,operation:string,projectId:string,args:any={},options:{confirm?:boolean;isCurrent?:()=>boolean;selectionVersion?:number;onJob?:(job:any,handle:AssistantOperationHandle)=>void;idempotencyKey?:string}={}){
  const request=parseApplicationOperationRequest({operation,projectId,arguments:args,idempotencyKey:options.idempotencyKey||'assistant-'+crypto.randomUUID()});
  const submitted=await call('applicationOperationSubmitInternal',[owner,request,options.selectionVersion]);
  const handle={owner,id:submitted.request.id,operation,projectId,idempotencyKey:request.idempotencyKey};
  let job=submitted.request;const deadline=now()+waitMs;
  for(;;){
   options.onJob?.(job,handle);
   if(job.status==='completed')return result(job,handle);
   result(job,handle);
   if(job.status==='awaiting_confirmation'){
    if(!options.confirm)fail('OPERATION_PERMISSION_REQUIRED',handle);
    if(options.isCurrent&&!options.isCurrent()){
     await call('applicationOperationCancelInternal',[owner,handle.id],handle);fail('PLAN_SESSION_CHANGED',handle);
    }
    job=await call('applicationOperationApproveInternal',[owner,handle.id,job.revision],handle);
   }else{
    if(now()>=deadline)fail('OPERATION_OUTCOME_UNKNOWN',handle);
    await new Promise(resolve=>setTimeout(resolve,intervalMs));job=await observe(handle);
   }
  }
 }
 async function recover(handle:AssistantOperationHandle,onJob?:(job:any,handle:AssistantOperationHandle)=>void){
  const job=await observe(handle,onJob);if(job.status!=='completed'&&!['failed','expired','cancelled','rejected'].includes(job.status))fail('OPERATION_OUTCOME_UNKNOWN',handle);return result(job,handle);
 }
 /** Stop at review. This does not approve, even when called by the planner.
  * Only a later explicit trusted UI action may consume this exact revision. */
 async function prepare(owner:string,operation:string,projectId:string,args:any,options:{selectionVersion:number;onJob?:(job:any,handle:AssistantOperationHandle)=>void}){
  const request=parseApplicationOperationRequest({operation,projectId,arguments:args,idempotencyKey:'assistant-'+crypto.randomUUID()});
  const submitted=await call('applicationOperationSubmitInternal',[owner,request,options.selectionVersion]);
  const handle={owner,id:submitted.request.id,operation,projectId,idempotencyKey:request.idempotencyKey},deadline=now()+waitMs;
  let job=submitted.request;
  for(;;){
   options.onJob?.(job,handle);result(job,handle);
   if(job.status==='completed')return {handle,job};
   if(job.status==='awaiting_confirmation'){
    // submit's public projection never carries the private review.
    if(!job.review)job=await observe(handle,options.onJob);
    if(job.status==='awaiting_confirmation'&&job.review)return {handle,job};
   }
   if(now()>=deadline)fail('OPERATION_OUTCOME_UNKNOWN',handle);
   await new Promise(resolve=>setTimeout(resolve,intervalMs));job=await observe(handle);
  }
 }
 async function approve(handle:AssistantOperationHandle,revision:number,options:{isCurrent:()=>boolean;onJob?:(job:any,handle:AssistantOperationHandle)=>void}){
  if(!options.isCurrent()){
   await call('applicationOperationCancelInternal',[handle.owner,handle.id],handle);fail('PLAN_SESSION_CHANGED',handle);
  }
  let job=await call('applicationOperationApproveInternal',[handle.owner,handle.id,revision],handle);const deadline=now()+waitMs;
  for(;;){
   options.onJob?.(job,handle);const value=result(job,handle);if(job.status==='completed')return value;
   if(now()>=deadline)fail('OPERATION_OUTCOME_UNKNOWN',handle);
   await new Promise(resolve=>setTimeout(resolve,intervalMs));job=await observe(handle);
  }
 }
 return {run,recover,prepare,approve,inspect:observe,cancel:(handle:AssistantOperationHandle)=>call('applicationOperationCancelInternal',[handle.owner,handle.id],handle)};
}
