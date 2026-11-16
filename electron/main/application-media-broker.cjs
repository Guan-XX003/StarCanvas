// Private finalizer around the SAME operation service for every actor. Source
// locations flow renderer -> main only after approval/nonce consumption; they
// never become an operation result, review, receipt or external HTTP payload.
const fail=code=>{throw Object.assign(new Error(code),{code});};
const crypto=require('node:crypto');
function createApplicationMediaBroker({call,output,input,now=Date.now}){
 const scopes=new Map(),exports=new Set();let epoch=0;
 async function prepare(value){
  const preparingEpoch=epoch,ids=value.request.operation.startsWith('generation.')?value.request.arguments.references||[]:[],authority={actor:value.actor,projectId:value.request.projectId};
  if(ids.length&&!input)fail('OPERATION_MEDIA_UNSUPPORTED');
  const referenceMedia=ids.map(id=>input.metadata(id,authority)),mediaExecutionKey=ids.length?crypto.randomBytes(32).toString('hex'):'';
  const review=await call('prepare',ids.length?{...value,referenceMedia,mediaExecutionKey}:value);
  if(ids.length){if(preparingEpoch!==epoch)fail('OPERATION_EXPIRED');exports.add(value.requestId);scopes.set(value.requestId,{epoch,expiresAt:value.expiresAt,actor:value.actor,request:structuredClone(value.request),generation:true,referenceMedia,mediaExecutionKey});return review;}
  if(['media.import','media.reference.release'].includes(value.request.operation)){
   if(!input)fail('OPERATION_MEDIA_UNSUPPORTED');if(preparingEpoch!==epoch)fail('OPERATION_EXPIRED');
   if(value.request.operation==='media.reference.release')input.metadata(value.request.arguments.referenceId,{actor:value.actor,projectId:value.request.projectId});
   exports.add(value.requestId);scopes.set(value.requestId,{epoch,expiresAt:value.expiresAt,actor:value.actor,request:structuredClone(value.request)});return review;
  }
  if(value.request.operation!=='media.export')return review;if(preparingEpoch!==epoch)fail('OPERATION_EXPIRED');
  const t=review?.task;if(review?.kind!=='media.export'||t?.projectId!==value.request.projectId||!t?.id||!t?.nodeId||!['image','video','audio'].includes(t.type))fail('OPERATION_MEDIA_INVALID');
  exports.add(value.requestId);scopes.set(value.requestId,{epoch,expiresAt:value.expiresAt,taskId:t.id,nodeId:t.nodeId,projectId:t.projectId,type:t.type});return review;
 }
 async function commit(value){
  const scope=scopes.get(value.requestId);if(!scope){if(exports.has(value.requestId))fail('OPERATION_EXPIRED');return call('commit',value);}
  const guard=()=>{if(scope.epoch!==epoch||scopes.get(value.requestId)!==scope||now()>=scope.expiresAt)fail('OPERATION_EXPIRED');};
  try{
   guard();const source=await call('commit',value);guard();
   if(scope.request){
    if(scope.generation){
     if(!source||Object.keys(source).join(',')!=='referencesReady'||source.referencesReady!==true)fail('OPERATION_MEDIA_INVALID');
     const authority={actor:scope.actor,projectId:scope.request.projectId},references=[];
     for(const id of scope.request.arguments.references){guard();references.push(await input.resolve(id,authority,guard));}
     guard();for(const r of references)if(JSON.stringify(input.metadata(r.referenceId,authority))!==JSON.stringify(scope.referenceMedia.find(m=>m.referenceId===r.referenceId)))fail('OPERATION_MEDIA_INVALID');
     const result=await call('completeGeneration',{requestId:value.requestId,mediaExecutionKey:scope.mediaExecutionKey,referenceMedia:references});
     try{guard();}catch{fail('OPERATION_OUTCOME_UNKNOWN');}return result;
    }
    if(!source||Object.keys(source).join(',')!=='ready'||source.ready!==true)fail('OPERATION_MEDIA_INVALID');
    const authority={actor:scope.actor,projectId:scope.request.projectId};
    if(scope.request.operation==='media.reference.release')return input.release(scope.request.arguments.referenceId,authority);
    return await input.run({...authority,arguments:scope.request.arguments,requestId:value.requestId,expiresAt:scope.expiresAt},guard);
   }
   if(!source||Object.keys(source).sort().join(',')!=='nodeId,projectId,source,taskId,type'||['taskId','projectId','nodeId','type'].some(k=>source[k]!==scope[k]))fail('OPERATION_MEDIA_INVALID');
   const result=await output.run({...source,requestId:value.requestId},guard);
   try{guard();}catch{fail('OPERATION_OUTCOME_UNKNOWN');}return result;
  }finally{scopes.delete(value.requestId);exports.delete(value.requestId);if(scope.generation)try{await call('release',{requestId:value.requestId,actor:scope.actor});}catch{}}
 }
 return {prepare,commit,async release(value){scopes.delete(value.requestId);exports.delete(value.requestId);return call('release',value);},invalidate(){epoch++;scopes.clear();input?.invalidate();}};
}
module.exports={createApplicationMediaBroker};
