import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {applicationTaskIdentifier,applicationTaskTimestamp,selectLatestApplicationTask} from '../../../electron/shared/application-task-data.mjs';
const transientTasks=new Map<string,any>();
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
/** Renderer-lifetime submission metadata, not another persisted task store.
 * Survives canvas view/remount, never App restart. Generation still owns writes.
 */
export const sharedApplicationTaskJobs=()=>transientTasks;
/** A submission's late callbacks may update only its original live fallback.
 * Once persisted history has replaced/pruned it (or another run/stop owns the
 * slot), never resurrect a newer, identity-less pending record over that task.
 */
export function beginApplicationTaskSubmission(jobs:Map<string,any>,nodeId:string,identity:{type:string;projectId:string;clientSubmissionId?:string},now=Date.now){
 const createdAt=now();let current={id:nodeId,nodeId,type:identity.type,projectId:identity.projectId,...(identity.clientSubmissionId?{clientSubmissionId:identity.clientSubmissionId}:{}),createdAt,updatedAt:createdAt,progress:0,status:'submitting',errorMsg:''};
 jobs.set(nodeId,current);
 return {update(patch:any){
  if(jobs.get(nodeId)!==current)return false;
  current={...current,...patch,nodeId,type:identity.type,projectId:identity.projectId,createdAt,updatedAt:now()};jobs.set(nodeId,current);return true;
 }};
}
export function applicationTaskRecordSnapshot(records:unknown,jobs:Map<string,any>=transientTasks,now=Date.now()){
 if(!Array.isArray(records))return fail('OPERATION_TASKS_UNAVAILABLE');
 if(records.length>2000||jobs.size>2000)fail('OPERATION_RESULT_LIMIT');
 if(records.some(t=>!t||typeof t!=='object'||Array.isArray(t)||typeof t.id!=='string'||!t.id.trim()))fail('OPERATION_TASKS_UNAVAILABLE');
 for(const [nodeId,job]of jobs){
  const created=applicationTaskTimestamp(job?.createdAt),updated=applicationTaskTimestamp(job?.updatedAt);
  const replaced=records.some(t=>{
   if(!t||typeof t!=='object'||!t.projectId||t.projectId!==job?.projectId||t.nodeId!==job?.nodeId)return false;
   const time=applicationTaskTimestamp(t.createdAt);
   // Merely sharing a node with an older completed record does NOT prove that
   // this new submission has been persisted. Unknown time order retains both.
   return created&&time&&created.scale===time.scale&&time.time>=created.time&&(t.id===job.id||time.time>created.time);
  });
  if(replaced||updated?.scale==='milliseconds'&&now-updated.time>86400000)jobs.delete(nodeId);
 }
 const result=[...records,...jobs.values()];if(result.length>2000)fail('OPERATION_RESULT_LIMIT');return result;
}
export function findApplicationTask(records:any[],id:string){
 applicationTaskIdentifier(id);
 const exact=records.filter(t=>t&&typeof t==='object'&&t.id===id);
 if(exact.length>1)fail('OPERATION_TASK_AMBIGUOUS');if(exact.length===1)return exact[0];
 const nodes=records.filter(t=>t&&typeof t==='object'&&t.nodeId===id);if(!nodes.length)return null;
 const task=selectLatestApplicationTask(nodes);if(!task)fail('OPERATION_TASK_AMBIGUOUS');return task;
}
export function createApplicationTaskReader(getRecords:()=>unknown,jobs:Map<string,any>=transientTasks){
 const snapshot=()=>applicationTaskRecordSnapshot(getRecords(),jobs);
 function argumentsOnly(input:any,keys:string[]){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('OPERATION_INVALID_REQUEST');if(input.materialize===true)fail('OPERATION_PERMISSION_REQUIRED');if(input.materialize!==undefined&&input.materialize!==false||input.includeDiagnostics!==undefined&&typeof input.includeDiagnostics!=='boolean')fail('OPERATION_INVALID_REQUEST');}
 return {tasks:async(input:any={})=>{argumentsOnly(input,['materialize','includeDiagnostics']);return applicationOperationMetadata('tasks.list',{tasks:snapshot()},{includeDiagnostics:input.includeDiagnostics===true});},
  task:async(input:any)=>{argumentsOnly(input,['id','materialize','includeDiagnostics']);applicationTaskIdentifier(input.id);return applicationOperationMetadata('tasks.get',{task:findApplicationTask(snapshot(),input.id)},{includeDiagnostics:input.includeDiagnostics===true});},
 };
}
