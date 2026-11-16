// Persisted observation metadata, never an operation receipt, nonce, media
// capability or permission to generate. No IO or application state here.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const validGenerationSubmissionId=value=>typeof value==='string'&&uuid.test(value);
const token=value=>typeof value==='string'&&value.length>0&&value.length<=512&&/^[-A-Za-z0-9_:.[\]]+$/.test(value);
export function captureAssistantGenerationTask(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','projectId','nodeId','submissionId'].includes(k))||value.version!==1||!token(value.projectId)||!token(value.nodeId)||!validGenerationSubmissionId(value.submissionId))throw Object.assign(Error('ASSISTANT_GENERATION_TASK_INVALID'),{code:'ASSISTANT_GENERATION_TASK_INVALID'});
 return {version:1,projectId:value.projectId,nodeId:value.nodeId,submissionId:value.submissionId};
}
/** The canonical task and its transient pre-response record can briefly both
 * exist. Prefer the one real task ID. Never infer identity from "latest node"
 * or attach a later manual generation to an earlier conversation card. */
export function selectAssistantGenerationTask(reference,records){
 const r=captureAssistantGenerationTask(reference);
 if(!Array.isArray(records)||records.length>2000)throw Object.assign(Error('OPERATION_TASKS_UNAVAILABLE'),{code:'OPERATION_TASKS_UNAVAILABLE'});
 const matches=records.filter(t=>t?.projectId===r.projectId&&t.nodeId===r.nodeId&&t.clientSubmissionId===r.submissionId),canonical=matches.filter(t=>t.id!==r.nodeId),candidates=canonical.length?canonical:matches;
 if(candidates.length>1)throw Object.assign(Error('OPERATION_TASK_AMBIGUOUS'),{code:'OPERATION_TASK_AMBIGUOUS'});
 return candidates[0]||null;
}
