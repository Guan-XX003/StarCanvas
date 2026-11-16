import {applicationTaskStatus,applicationTaskType,applicationTaskDiagnostic,applicationTaskTimestamp} from './application-task-data.mjs';
import {APPLICATION_PERMISSIONS} from '../../bin/application-operation-protocol.mjs';
import {validGenerationSubmissionId} from './assistant-generation-task.mjs';
export {APPLICATION_PERMISSIONS} from '../../bin/application-operation-protocol.mjs';
/** Application-owned operation classes. Connection authentication is NOT
 * permission to edit, spend, delete, export media or expose configuration.
 * Authority is supplied by the host, never copied from model/HTTP arguments.
 */
const definitions={
 'app.status':'read','models.list':'read','tasks.list':'read','tasks.get':'read','projects.list':'read','canvas.read':'read','canvas.read.release':'read','canvas.plan.release':'read','canvas.plan.preview':'read','canvas.generation.preflight':'read',
 'tasks.cancel':'canvas.edit','canvas.plan.apply':'canvas.edit','canvas.plan.undo':'canvas.edit',
 'app.preferences.read':'read','app.preferences.set':'preferences.edit','app.navigate':'app.navigate',
 'generation.image':'generation.paid','generation.video':'generation.paid','generation.tianji':'generation.paid','canvas.plan.generate':'generation.paid',
 'data.delete':'data.delete','configuration.read':'configuration.sensitive','configuration.write':'configuration.sensitive','media.export':'media.export','media.import':'media.input','media.reference.release':'read',
};
const legacy=Object.freeze({status:'app.status',models:'models.list',tasks:'tasks.list',task:'tasks.get',cancel:'tasks.cancel',generateImage:'generation.image',generateVideo:'generation.video',generateTianjiVideo:'generation.tianji',materializeTestResult:'media.export'});
export const APPLICATION_OPERATIONS=Object.freeze(Object.fromEntries(Object.entries(definitions).map(([id,permission])=>[id,Object.freeze({id,permission,permissions:Object.freeze(id==='canvas.plan.generate'?['generation.paid','canvas.edit','media.input']:permission==='generation.paid'?['generation.paid','canvas.edit']:[permission])})])));
export class ApplicationOperationError extends Error {
 constructor(code,permission=''){super(code);this.code=code;this.permission=permission;this.statusCode=code==='OPERATION_PERMISSION_REQUIRED'?403:400;}
}
export function applicationOperation(name){
 const id=Object.hasOwn(legacy,name)?legacy[name]:name;
 if(!Object.hasOwn(APPLICATION_OPERATIONS,id))throw new ApplicationOperationError('OPERATION_UNSUPPORTED');
 return APPLICATION_OPERATIONS[id];
}
export function assertApplicationOperationPermission(name,permissions,options={}){
 const operation=applicationOperation(name);
 if(!Array.isArray(permissions)||permissions.some(p=>!APPLICATION_PERMISSIONS.includes(p)))throw new ApplicationOperationError('OPERATION_INVALID_AUTHORITY');
 const required=[...operation.permissions];
 if(['tasks.list','tasks.get'].includes(operation.id)&&options.materialize===true)required.push('media.export');
 for(const permission of required)if(!permissions.includes(permission))throw new ApplicationOperationError('OPERATION_PERMISSION_REQUIRED',permission);
 return operation;
}
const text=(value,max=512)=>typeof value==='string'&&value.length<=max?value:'';
const number=value=>Number.isFinite(value)?value:0;
// Only metadata is returned by default. Prompt, errors, media locations and
// arbitrary upstream fields can contain content or credentials and are absent.
export const applicationOperationTaskStatus=applicationTaskStatus;
function taskMetadata(task,includeDiagnostics=false){
 if(!task||typeof task!=='object')return null;
 const status=applicationTaskStatus(task),diagnostic=includeDiagnostics?applicationTaskDiagnostic(task):null,timestamp=value=>applicationTaskTimestamp(value)?value:0;
 return {id:publicModel(task.id),nodeId:publicModel(task.nodeId),projectId:publicModel(task.projectId),...(validGenerationSubmissionId(task.clientSubmissionId)?{clientSubmissionId:task.clientSubmissionId}:{}),type:applicationTaskType(task),status,
  progress:typeof task.progress==='number'&&Number.isFinite(task.progress)&&task.progress>=0&&task.progress<=100?task.progress:null,modelName:publicModel(task.modelName),createdAt:timestamp(task.createdAt),updatedAt:timestamp(task.updatedAt),...(diagnostic?{diagnostic}:{})};
}
function publicModel(value){
 const name=text(value);
 return /(?:\b(?:sk|sk-proj)-[a-z0-9_-]{12,}|\bBearer\s|https?:\/\/|file:\/\/|(?:api[_ -]?key|password|secret)\s*[:=])/i.test(name)?'':name;
}
export function applicationOperationMetadata(name,result,{includeDiagnostics=false}={}){
 const {id}=applicationOperation(name);
 if(result?.ok===false)return {ok:false,code:'OPERATION_FAILED',error:'Application operation failed'};
 if(id==='app.status')return {ok:true,app:'StarCanvas',version:text(result?.version,64),ready:result?.ready===true,activeTasks:Math.max(0,number(result?.activeTasks))};
 if(id==='models.list'){
  const list=values=>{if(!Array.isArray(values)||values.length>2000)throw new ApplicationOperationError('OPERATION_RESULT_LIMIT');return values.map(publicModel).filter(Boolean);};
  return {ok:true,image:list(result?.image),video:list(result?.video),text:list(result?.text)};
 }
 if(id==='tasks.list'){
  if(!Array.isArray(result?.tasks)||result.tasks.length>2000)throw new ApplicationOperationError('OPERATION_RESULT_LIMIT');
  return {ok:true,tasks:result.tasks.map(task=>taskMetadata(task,includeDiagnostics)||taskMetadata({status:'unknown'}))};
 }
 if(id==='tasks.get')return {ok:true,task:taskMetadata(result?.task,includeDiagnostics)};
 throw new ApplicationOperationError('OPERATION_UNSUPPORTED');
}
