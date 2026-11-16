// Approval-only input owner. Exact-file consent is not a directory grant, and
// importing is not permission to submit those bytes to a generation provider.
const path=require('node:path'),fsp=require('node:fs/promises'),crypto=require('node:crypto'),{pathToFileURL,fileURLToPath}=require('node:url');
const {createApplicationMediaOutput,verifyFile,MAX_BYTES}=require('./application-media-output.cjs');
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function approvedLocalSource(file){
 if(!path.isAbsolute(file))fail('OPERATION_MEDIA_INVALID');
 const parent=path.dirname(file),canonical=await fsp.realpath(parent);
 // Only the fixed OS /var and /tmp aliases are normalized. Arbitrary symlink
 // parents/children are not silently followed, even with exact-file approval.
 const normalized=process.platform==='darwin'?parent.replace(/^\/(var|tmp)(?=\/|$)/,'/private/$1'):parent;
 if(canonical!==path.resolve(normalized))fail('OPERATION_MEDIA_INVALID');
 return {sourcePath:path.join(canonical,path.basename(file)),allowedRoots:[canonical]};
}
function createApplicationMediaInput({output,now=Date.now,...options}={}){
 const owner=output||createApplicationMediaOutput({...options,prepareLocalSource:approvedLocalSource});
 const references=new Map();let epoch=0;
 function prune(){for(const [id,r]of references)if(now()>=r.expiresAt)references.delete(id);}
 function reference(id,{actor,projectId}){prune();const r=references.get(id);if(!r||r.actor!==actor||r.projectId!==projectId)fail('OPERATION_NOT_FOUND');return r;}
 async function run(value,guard){
  const {parseApplicationMediaImport}=await import('../shared/application-media-contract.mjs'),args=parseApplicationMediaImport(value.arguments);
  prune();if(references.size>=128)fail('OPERATION_LIMIT');const capturedEpoch=epoch;
  const check=()=>{guard();if(capturedEpoch!==epoch||now()>=value.expiresAt)fail('OPERATION_EXPIRED');};check();
  let source=args.source;if(!/^https?:/i.test(source)){const file=/^file:/i.test(source)?fileURLToPath(source):source;if(!path.isAbsolute(file))fail('OPERATION_MEDIA_INVALID');source=pathToFileURL(file).href;}
  const result=await owner.run({source,type:args.type,projectId:value.projectId,nodeId:'reference-'+value.requestId,taskId:value.requestId,requestId:value.requestId},check);
  try{check();}catch{fail('OPERATION_OUTCOME_UNKNOWN');}
  const id='reference-'+crypto.randomUUID(),r={actor:value.actor,projectId:value.projectId,expiresAt:value.expiresAt,type:result.type,mime:result.mime,size:result.size,sha256:result.sha256,source:result.resultUrl,localPath:result.localPath};references.set(id,r);
  return {imported:true,referenceId:id,projectId:r.projectId,type:r.type,mime:r.mime,size:r.size,sha256:r.sha256,expiresAt:r.expiresAt};
 }
 return {run,
  metadata(id,authority){const {type,mime,size,sha256,expiresAt}=reference(id,authority);return {referenceId:id,type,mime,size,sha256,expiresAt};},
  async resolve(id,authority,guard){const r=reference(id,authority),capturedEpoch=epoch;guard();let checked;try{checked=await verifyFile(r.localPath,MAX_BYTES);}catch{fail('OPERATION_MEDIA_INVALID');}guard();if(epoch!==capturedEpoch||reference(id,authority)!==r)fail('OPERATION_EXPIRED');if(checked.size!==r.size||checked.sha256!==r.sha256)fail('OPERATION_MEDIA_INVALID');return {...this.metadata(id,authority),source:r.source};},
  release(id,authority){reference(id,authority);references.delete(id);return {released:true};},
  invalidate(){epoch++;references.clear();},
 };
}
module.exports={createApplicationMediaInput,approvedLocalSource};
