import {applicationOperation,ApplicationOperationError} from './application-operation-policy.mjs';
import {parseApplicationGeneration} from './application-generation-contract.mjs';
import {parseApplicationLocalArguments} from './application-local-contract.mjs';
import {applicationTaskIdentifier} from './application-task-data.mjs';
import {parseApplicationMediaImport,applicationReferenceId} from './application-media-contract.mjs';
export {APPLICATION_OPERATION_RESULT_CODES,applicationOperationErrorCode} from '../../bin/application-operation-protocol.mjs';
const implemented=new Set(['app.status','app.preferences.read','app.preferences.set','app.navigate','models.list','tasks.list','tasks.get','tasks.cancel','media.export','media.import','media.reference.release','projects.list','canvas.read','canvas.read.release','canvas.plan.release','canvas.plan.preview','canvas.plan.apply','canvas.plan.undo','canvas.plan.generate','canvas.generation.preflight','generation.image','generation.video','generation.tianji']);
export const applicationOperationActor=owner=>typeof owner==='string'&&/^[-A-Za-z0-9_:.[\]]{1,160}$/.test(owner)?'internal:'+owner:(()=>{throw new ApplicationOperationError('OPERATION_INVALID_AUTHORITY');})();
export const isApplicationOperationActor=actor=>actor==='external'||typeof actor==='string'&&/^internal:[-A-Za-z0-9_:.[\]]{1,160}$/.test(actor);
const fail=code=>{throw new ApplicationOperationError(code);};
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
function exact(value,keys){if(!record(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('OPERATION_INVALID_REQUEST');}
function token(value,max=160){if(typeof value!=='string'||!value||value.length>max||!/^[-A-Za-z0-9_:.[\]]+$/.test(value))fail('OPERATION_INVALID_REQUEST');return value;}
function json(value,depth=0){
 if(depth>30)fail('OPERATION_INVALID_REQUEST');
 if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){for(const item of value)json(item,depth+1);return;}
 if(!record(value)||Object.keys(value).some(k=>['__proto__','constructor','prototype'].includes(k)))fail('OPERATION_INVALID_REQUEST');
 for(const item of Object.values(value))json(item,depth+1);
}
export function parseApplicationOperationRequest(input){
 exact(input,['operation','projectId','arguments','idempotencyKey']);
 if(!implemented.has(input.operation))fail('OPERATION_UNSUPPORTED');
 const operation=applicationOperation(input.operation).id,key=token(input.idempotencyKey),projectId=input.projectId===undefined||input.projectId===''?'':token(input.projectId,512);
 if(key.length<16)fail('OPERATION_INVALID_REQUEST');
 if((operation.startsWith('canvas.')||operation.startsWith('generation.')||operation.startsWith('media.')||['tasks.cancel','app.preferences.set','app.navigate'].includes(operation))&&!projectId)fail('OPERATION_INVALID_REQUEST');
 const a=input.arguments??{};let args={};
 if(operation.startsWith('app.preferences.')||operation==='app.navigate')args=parseApplicationLocalArguments(operation,a);
 else if(operation==='media.import')args=parseApplicationMediaImport(a);
 else if(operation==='media.reference.release'){exact(a,['referenceId']);args={referenceId:applicationReferenceId(a.referenceId)};}
 else if(operation.startsWith('generation.'))args=parseApplicationGeneration(operation,a);
 else if(operation==='canvas.read'){
  exact(a,['scope','includeContent']);if(a.scope!==undefined&&!['selected','structure'].includes(a.scope)||a.includeContent!==undefined&&typeof a.includeContent!=='boolean')fail('OPERATION_INVALID_REQUEST');
  args={scope:a.scope||'selected',includeContent:a.includeContent===true};
 }else if(operation==='canvas.plan.preview'){
  exact(a,['ticketId','proposal']);if(!record(a.proposal))fail('OPERATION_INVALID_REQUEST');json(a.proposal);args={ticketId:token(a.ticketId),proposal:structuredClone(a.proposal)};
 }else if(operation==='canvas.read.release'){
  exact(a,['ticketId']);args={ticketId:token(a.ticketId)};
 }else if(operation==='canvas.plan.generate'){
  exact(a,['planId','nodeId']);args={planId:token(a.planId),nodeId:token(a.nodeId,512)};
 }else if(['canvas.plan.apply','canvas.plan.undo','canvas.plan.release','canvas.generation.preflight'].includes(operation)){
  exact(a,['planId']);args={planId:token(a.planId)};
 }else if(['tasks.list','tasks.get'].includes(operation)){
  exact(a,operation==='tasks.get'?['id','includeDiagnostics']:['includeDiagnostics']);if(a.includeDiagnostics!==undefined&&typeof a.includeDiagnostics!=='boolean')fail('OPERATION_INVALID_REQUEST');
  args={...(operation==='tasks.get'?{id:applicationTaskIdentifier(a.id)}:{}),includeDiagnostics:a.includeDiagnostics===true};
 }else if(['tasks.cancel','media.export'].includes(operation)){
  exact(a,['id']);args={id:applicationTaskIdentifier(a.id)};
 }else exact(a,[]);
 const result={operation,projectId,arguments:args,idempotencyKey:key};
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>256*1024)fail('OPERATION_REQUEST_LIMIT');
 return result;
}
export function applicationOperationNeedsApproval(request){return applicationOperation(request.operation).permission!=='read'||request.operation==='canvas.read'&&request.arguments.includeContent===true;}
export function applicationOperationRequiresSelection(operation){return ['canvas.plan.apply','canvas.plan.undo','canvas.plan.generate','tasks.cancel','media.export','media.import','app.preferences.set','app.navigate'].includes(operation)||operation.startsWith('generation.');}
