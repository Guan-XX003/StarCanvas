import type {AssistantWorkspaceClient} from './assistant-workspace-client';
import {createAssistantOperationClient} from './assistant-operation-client';
import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {applicationOperationErrorCode} from '../../../electron/shared/application-operation-contract.mjs';
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
/** Owner-scoped, non-persistent task reads. No raw task prop, renderer callback,
 * provider polling or generation fallback exists when the common port fails.
 */
export function createAssistantTaskReader(client:AssistantWorkspaceClient,getBridge:()=>any=()=>(globalThis as any).wanjuanDesktop){
 const gateway=createAssistantOperationClient(getBridge);
 function read(owner:string,{includeDiagnostics=false,id}:{includeDiagnostics?:boolean;id?:string}={}){
  if(!client.operationScope(owner))fail('PLAN_SESSION_CHANGED');const view=client.viewFor(owner),old=view.taskRead,key=JSON.stringify([id||'',includeDiagnostics]);
  if(old.inFlight){if(old.key===key)return old.inFlight;fail('ASSISTANT_BUSY');}
  const operation=id?'tasks.get':'tasks.list',requestId=crypto.randomUUID();
  const task=Promise.resolve().then(()=>gateway.run(owner,operation,'',{...(id?{id}:{}),includeDiagnostics})).then(result=>{
   const safe=applicationOperationMetadata(operation,result,{includeDiagnostics});if(safe.ok!==true)fail('OPERATION_TASKS_UNAVAILABLE');
   return operation==='tasks.get'?(safe.task?[safe.task]:[]):safe.tasks;
  }).catch(error=>{if(view.taskRead.requestId===requestId)client.set(owner,'taskRead',{...view.taskRead,code:applicationOperationErrorCode(error)});throw error;}).finally(()=>{if(view.taskRead.requestId===requestId)client.set(owner,'taskRead',{...view.taskRead,working:false,inFlight:null});});
  client.set(owner,'taskRead',{requestId,key,working:true,inFlight:task,code:''});return task;
 }
 return {read};
}
export function assistantTaskReadFailure(code:unknown,language:string){
 if(code==='OPERATION_TASK_AMBIGUOUS')return language==='en-US'?'That identifier matches multiple local task records, so I cannot safely choose one. Check the task list.':language==='zh-TW'?'該編號對應多筆本機任務紀錄，無法安全選定其中一筆，請查看任務清單。':'该编号对应多条本地任务记录，无法安全选定其中一条，请查看任务清单。';
 return language==='en-US'?'The local task records could not be read reliably. Their generation status is unconfirmed; nothing was retried.':language==='zh-TW'?'無法可靠讀取本機任務紀錄，不能據此判定產生成功或失敗；沒有重新執行任務。':'无法可靠读取本地任务记录，不能据此判定生成成功或失败；没有重新执行任务。';
}
