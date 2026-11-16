// Validates user-selected bytes, never accepts a renderer filesystem path or
// remote URL. This is container identification, not a model-capability claim.
const {MAX_MEDIA,MEDIA_ID}=require('./assistant-workspace-vault.cjs');
const {createHash}=require('node:crypto');
const fail=code=>Object.assign(new Error(code),{code});
function identifyMedia(bytes){
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')return {type:'image',mime:'image/png'};
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {type:'image',mime:'image/jpeg'};
  if(bytes.length>=13&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return {type:'image',mime:'image/gif'};
  if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {type:'image',mime:'image/webp'};
  if(bytes.length>=24&&bytes.toString('ascii',4,8)==='ftyp'){
    const brands=bytes.toString('ascii',8,Math.min(bytes.length,64));
    if(/avif|avis|heic|heix|mif1/.test(brands))throw fail('ASSISTANT_MEDIA_UNSUPPORTED');
    if(/qt  /.test(brands))return {type:'video',mime:'video/quicktime'};
    if(/isom|iso[2-9]|mp4[12]|avc1|M4V |dash/.test(brands))return {type:'video',mime:'video/mp4'};
  }
  if(bytes.length>=16&&bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))&&bytes.subarray(4,Math.min(bytes.length,4096)).includes(Buffer.from('webm')))return {type:'video',mime:'video/webm'};
  throw fail('ASSISTANT_MEDIA_UNSUPPORTED');
}
function captureMedia(input){
  const name=input?.name;
  if(typeof name!=='string'||!name||name.length>240||/[\x00-\x1f/\\]/.test(name))throw fail('ASSISTANT_MEDIA_INVALID');
  const raw=input?.bytes;
  if(!(raw instanceof ArrayBuffer)&&!(raw instanceof Uint8Array))throw fail('ASSISTANT_MEDIA_INVALID');
  if(!raw.byteLength||raw.byteLength>MAX_MEDIA)throw fail('ASSISTANT_MEDIA_LIMIT');
  const bytes=Buffer.from(raw instanceof ArrayBuffer?new Uint8Array(raw):raw);
  return {bytes,name,...identifyMedia(bytes),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function validDescriptor(item){
  return !!item&&Object.keys(item).every(key=>['id','name','type','mime','size','assetRef','sha256'].includes(key))&&MEDIA_ID.test(item.id||'')&&item.assetRef===item.id&&typeof item.name==='string'&&!!item.name&&item.name.length<=240&&!/[\x00-\x1f/\\]/.test(item.name)&&['image','video'].includes(item.type)&&typeof item.mime==='string'&&item.mime.startsWith(item.type+'/')&&Number.isSafeInteger(item.size)&&item.size>0&&item.size<=MAX_MEDIA&&/^[a-f0-9]{64}$/.test(item.sha256||'');
}
module.exports={captureMedia,validDescriptor,identifyMedia};
