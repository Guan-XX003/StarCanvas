import {applicationTaskStatus,applicationTaskType} from '../../../electron/shared/application-task-data.mjs';
import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {applicationTaskRecordSnapshot,findApplicationTask} from './application-task-records';
import {wanjuanExtractAutomationMedia} from './automation-result';
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
/** Private source capture only. Public task reads never use this capability.
 * No file/blob/network IO occurs until the main one-shot grant is consumed.
 */
export function createApplicationTaskExportPlans(getRecords:()=>unknown,{resolveBlob}:{resolveBlob?:(source:string,metadata:any)=>Promise<string>}={}){
 function target(projectId:string,id:string){
  const task=findApplicationTask(applicationTaskRecordSnapshot(getRecords()),id);
  if(!task||task.projectId!==projectId||!task.nodeId||applicationTaskStatus(task)!=='completed')fail('OPERATION_MEDIA_NOT_READY');
  const type=applicationTaskType(task);if(!['image','video','audio'].includes(type))fail('OPERATION_MEDIA_UNSUPPORTED');
  const source=task.resultUrl||task.videoUrl||task.imageUrl||task.audioUrl||wanjuanExtractAutomationMedia(task.customResultData,type);
  if(typeof source!=='string'||!source||! /^(?:https?:|file:|data:|blob:)/i.test(source))fail('OPERATION_MEDIA_NOT_READY');
  return {task,source,identity:JSON.stringify([task.id,task.nodeId,task.projectId,type,task.createdAt,task.updatedAt,source])};
 }
 function prepare(projectId:string,id:string){
  const captured=target(projectId,id),safe=applicationOperationMetadata('tasks.get',{task:captured.task}).task;
  const metadata={taskId:captured.task.id,nodeId:captured.task.nodeId,projectId,type:safe.type};
  return {review:{kind:'media.export',task:safe,sourceKind:captured.source.startsWith('file:')?'local':/^(?:blob:|data:)/.test(captured.source)?'embedded':'remote',destination:'managed-media-library'},
   async commit(guard:()=>void){
    const check=()=>{guard();if(target(projectId,id).identity!==captured.identity)fail('OPERATION_TASK_CHANGED');};check();let source=captured.source;
    if(source.startsWith('blob:')){
     if(!resolveBlob)fail('OPERATION_MEDIA_UNSUPPORTED');
     try{source=await resolveBlob(source,metadata);check();if(!/^file:/.test(source))fail('OPERATION_OUTCOME_UNKNOWN');}
     catch(error:any){if(['OPERATION_MEDIA_READ_FAILED','OPERATION_MEDIA_TOO_LARGE'].includes(error?.code))throw error;fail('OPERATION_OUTCOME_UNKNOWN');}
    }
    return {...metadata,source};
   },
  };
 }
 return {prepare};
}
