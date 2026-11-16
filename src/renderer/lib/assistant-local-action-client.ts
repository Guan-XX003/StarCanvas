import type {AssistantWorkspaceClient} from './assistant-workspace-client';
import {createAssistantOperationClient} from './assistant-operation-client';
import {applicationOperationErrorCode} from '../../../electron/shared/application-operation-contract.mjs';

const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
type Notice={text:string;executionStatus:'confirmed'|'unconfirmed'|'rejected'};
/** No direct setter/navigation fallback. Volatile promises/handles are owned by
 * the conversation, so React remounts and late receipts cannot target another.
 */
export function createAssistantLocalActionClient(client:AssistantWorkspaceClient,getBridge:()=>any=()=>(globalThis as any).wanjuanDesktop){
 const gateway=createAssistantOperationClient(getBridge),set=(owner:string,value:any)=>client.set(owner,'localAction',value);
 function publish(owner:string,state:any,notice:Notice){
  const view=client.viewFor(owner);if(view.localAction.id!==state.id||view.localAction.receiptWritten)return;
  client.set(owner,'messages',[...view.messages,{role:'assistant',...notice}]);set(owner,{...view.localAction,receiptWritten:true});
 }
 function complete(owner:string,state:any,result:any){
  const view=client.viewFor(owner);if(view.localAction.id!==state.id)return result;
  try{publish(owner,state,{text:state.receipt(result),executionStatus:'confirmed'});
   set(owner,{...view.localAction,phase:'completed',result,pendingHandle:null,code:''});return result;
  }catch{throw Object.assign(new Error('OPERATION_OUTCOME_UNKNOWN'),{code:'OPERATION_OUTCOME_UNKNOWN',operationHandle:view.localAction.handle});}
 }
 function failed(owner:string,state:any,error:any){
  const view=client.viewFor(owner),code=applicationOperationErrorCode(error);if(view.localAction.id!==state.id)return;
  const uncertain=code==='OPERATION_OUTCOME_UNKNOWN';
  set(owner,{...view.localAction,phase:uncertain?'uncertain':'failed',code,pendingHandle:uncertain?error.operationHandle||view.localAction.handle:null});
  // Once a write may have happened, the standard unknown-result panel is the
  // only recovery. Do not publish a false rejection or duplicate failure turn.
  if(!uncertain&&state.failure)publish(owner,state,state.failure(code));
 }
 function run(owner:string,operation:'app.preferences.set'|'app.navigate',projectId:string,args:any,options:{intent:string;receipt:(result:any)=>string;failure:(code:string)=>Notice}){
  const scope=client.operationScope(owner);if(!scope?.selected)fail('PLAN_SESSION_CHANGED');
  const view=client.viewFor(owner),old=view.localAction,key=JSON.stringify([operation,projectId,args,options.intent]);
  if(old.inFlight){if(old.key===key)return old.inFlight;fail('ASSISTANT_BUSY');}
  if(old.phase==='uncertain'||view.canvasPlan.working||view.canvasPlan.pendingOperation)fail('ASSISTANT_BUSY');
  if(old.key===key&&old.phase==='completed')return Promise.resolve(old.result);
  const state={id:crypto.randomUUID(),key,operation,projectId,phase:'running',receipt:options.receipt,failure:options.failure,receiptWritten:false},selectionVersion=scope.selectionVersion;
  const task=Promise.resolve().then(()=>gateway.run(owner,operation,projectId,args,{confirm:true,selectionVersion,
   isCurrent:()=>{const next=client.operationScope(owner);return next?.selected===true&&next.selectionVersion===selectionVersion;},
   onJob:(_job,handle)=>{if(view.localAction.id===state.id)set(owner,{...view.localAction,handle});},
  })).then(result=>complete(owner,state,result)).catch(error=>{failed(owner,state,error);throw error;}).finally(()=>{if(view.localAction.id===state.id)set(owner,{...view.localAction,inFlight:null});});
  set(owner,{...state,inFlight:task});return task;
 }
 function recover(owner:string){
  const view=client.viewFor(owner),state=view.localAction;if(state.inFlight)return state.inFlight;
  if(!client.operationScope(owner)?.selected||!state.pendingHandle)fail('OPERATION_NOT_FOUND');
  const task=gateway.recover(state.pendingHandle).then(result=>complete(owner,state,result)).catch(error=>{failed(owner,state,error);throw error;}).finally(()=>{if(view.localAction.id===state.id)set(owner,{...view.localAction,inFlight:null});});
  set(owner,{...state,inFlight:task});return task;
 }
 return {run,recover,read:async(owner:string)=>{const result=await gateway.run(owner,'app.preferences.read','');return result.preferences;}};
}
