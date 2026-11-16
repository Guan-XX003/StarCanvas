import {ApplicationOperationError} from './application-operation-policy.mjs';
const fail=()=>{throw new ApplicationOperationError('OPERATION_MEDIA_INVALID');};
const extensions={image:/\.(?:png|jpe?g|webp|gif|bmp|tiff?|avif|hei[cf])$/i,video:/\.(?:mp4|webm|mov|m4v|avi)$/i,audio:/\.(?:wav|mp3|m4a|aac|ogg|flac|webm)$/i};
export function applicationReferenceId(value){
 if(typeof value!=='string'||!/^reference-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))fail();return value;
}
/** Shape checks only: requesting an import does NOT authorize stat/read/fetch.
 * A directory, credential-bearing URL or arbitrary non-media file is not an
 * import. Main enforces public DNS and file checks after one-request approval.
 */
export function parseApplicationMediaImport(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.keys(input).some(k=>!['source','type'].includes(k)))fail();
 const {source,type}=input;
 if(typeof type!=='string'||!Object.hasOwn(extensions,type)||typeof source!=='string'||!source||source!==source.trim()||source.length>8192||/[\u0000-\u001f\u007f]/.test(source))fail();
 if(/^https?:/i.test(source)){
  let u;try{u=new URL(source);}catch{fail();}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||!u.hostname)fail();
  return {source:u.href,type};
 }
 let file=source;
 if(/^file:/i.test(source)){let u;try{u=new URL(source);file=decodeURIComponent(u.pathname);}catch{fail();}if(u.host||u.search||u.hash)fail();if(/^\/[A-Za-z]:\//.test(file))file=file.slice(1);}
 if(!/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(file)||/^(?:\\\\|\/\/)/.test(file)||file.includes(':')&&!/^[A-Za-z]:[\\/][^:]+$/.test(file)||/[<>"|?*]/.test(file)||file.split(/[\\/]/).some(p=>p==='.'||p==='..'||/[ .]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||!extensions[type].test(file))fail();
 return {source,type};
}
export function applicationMediaImportReview(input){
 const value=parseApplicationMediaImport(input),remote=/^https?:/i.test(value.source);
 const url=remote?new URL(value.source):null;
 return {kind:'media.import',type:value.type,sourceKind:remote?'remote':'local',sourceLabel:remote?url.origin+url.pathname:value.source,hasPrivateQuery:!!url?.search};
}
/** Main-to-renderer metadata, never caller-granted file authority. Sources may
 * be added only after the original generation nonce has been consumed. */
export function applicationReferenceMetadata(ids,values,withSources=false){
 if(!Array.isArray(ids)||ids.length>15||new Set(ids).size!==ids.length||!Array.isArray(values)||values.length!==ids.length)fail();
 const counts={image:0,video:0,audio:0};
 return values.map((r,index)=>{
  const keys=['referenceId','type','mime','size','sha256','expiresAt',...(withSources?['source']:[])];
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||applicationReferenceId(r.referenceId)!==ids[index]||typeof r.type!=='string'||!Object.hasOwn(counts,r.type)||typeof r.mime!=='string'||!r.mime.startsWith(r.type+'/')||!Number.isSafeInteger(r.size)||r.size<4||r.size>512*1024*1024||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt<=0)fail();
  counts[r.type]++;if(counts.image>9||counts.video>3||counts.audio>3)fail();
  if(withSources){let u;try{u=new URL(r.source);}catch{fail();}if(typeof r.source!=='string'||r.source.length>32768||u.protocol!=='file:'||u.host||u.search||u.hash)fail();}
  return Object.fromEntries(keys.map(k=>[k,r[k]]));
 });
}
