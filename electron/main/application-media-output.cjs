// Only a consumed application-operation export may call this owner. No roots,
// headers, cookies, destination path or authentication are external arguments.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),dns=require('node:dns/promises'),net=require('node:net'),http=require('node:http'),https=require('node:https');
const MAX_BYTES=512*1024*1024;
const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const inside=(root,file)=>{const r=path.relative(root,file);return !!r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
function publicAddress(raw){
 const address=String(raw).replace(/^\[|\]$/g,'').toLowerCase(),family=net.isIP(address);
 if(family===6)return /^[23][0-9a-f]{0,3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address)&&!/^2002:/i.test(address);
 if(family!==4)return false;const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2))||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
function outputUrl(value){
 let u;try{u=new URL(value);}catch{fail('OPERATION_MEDIA_INVALID');}
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||u.href.length>8192||net.isIP(host)&&!publicAddress(host)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))fail('OPERATION_MEDIA_INVALID');return u;
}
async function publicResponse(value,{lookup=dns.lookup,request=(url,options,callback)=>(url.protocol==='https:'?https:http).request(url,options,callback),signal}={}){
 let url=outputUrl(value);
 for(let redirects=0;redirects<=4;redirects++){
  const host=url.hostname.replace(/^\[|\]$/g,''),addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))fail('OPERATION_MEDIA_INVALID');
  const pinned=addresses[0],response=await new Promise((resolve,reject)=>{
   const req=request(url,{method:'GET',agent:false,signal,headers:{'accept-encoding':'identity'},lookup:(_host,options,cb)=>options?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},resolve);
   req.on('error',()=>reject(Object.assign(Error('OPERATION_MEDIA_READ_FAILED'),{code:'OPERATION_MEDIA_READ_FAILED'})));req.setTimeout(120000,()=>req.destroy());req.end();
  });
  if([301,302,303,307,308].includes(response.statusCode)){
   const location=response.headers.location;response.destroy();if(!location||redirects===4)fail('OPERATION_MEDIA_READ_FAILED');const next=outputUrl(new URL(location,url).href);if(url.protocol==='https:'&&next.protocol!=='https:')fail('OPERATION_MEDIA_INVALID');url=next;continue;
  }
  if(response.statusCode!==200||response.headers['content-encoding']&&!/^identity$/i.test(response.headers['content-encoding'])){response.destroy();fail('OPERATION_MEDIA_READ_FAILED');}
  return response;
 }fail('OPERATION_MEDIA_READ_FAILED');
}
function outputMime(head,type){
 const {sniffImageMime}=require('./utils/mime.cjs');let mime=sniffImageMime(head);
 if(!mime&&head.length>=12&&head.toString('ascii',4,8)==='ftyp'){
  const brand=head.toString('ascii',8,12);mime=/^(?:avif|avis)$/.test(brand)?'image/avif':/^(?:heic|heix|mif1)$/.test(brand)?'image/heic':type==='audio'?'audio/mp4':brand==='qt  '?'video/quicktime':'video/mp4';
 }
 if(!mime&&head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))mime=type==='audio'?'audio/webm':'video/webm';
 if(!mime&&head.toString('ascii',0,4)==='RIFF')mime=head.toString('ascii',8,12)==='WAVE'?'audio/wav':head.toString('ascii',8,12)==='AVI '?'video/x-msvideo':'';
 if(!mime&&head.toString('ascii',0,4)==='OggS')mime='audio/ogg';if(!mime&&head.toString('ascii',0,4)==='fLaC')mime='audio/flac';
 if(!mime&&head.toString('ascii',0,2)==='BM')mime='image/bmp';if(!mime&&['49492a00','4d4d002a'].includes(head.subarray(0,4).toString('hex')))mime='image/tiff';
 if(!mime&&(head.toString('ascii',0,3)==='ID3'||head[0]===0xff&&(head[1]&0xe0)===0xe0))mime='audio/mpeg';
 if(!mime||!mime.startsWith(type+'/'))fail('OPERATION_MEDIA_UNSUPPORTED');return mime;
}
async function verifyFile(file,maxBytes){
 const canonical=await fsp.realpath(file);if(canonical!==path.resolve(file))fail('OPERATION_MEDIA_INVALID');const handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink!==1n||before.size<4n||before.size>BigInt(maxBytes))fail('OPERATION_MEDIA_TOO_LARGE');
  const digest=crypto.createHash('sha256'),chunk=Buffer.alloc(1024*1024);let size=0,head=Buffer.alloc(0);
  for(;;){const {bytesRead}=await handle.read(chunk,0,chunk.length,null);if(!bytesRead)break;size+=bytesRead;if(size>maxBytes||BigInt(size)>before.size)fail('OPERATION_MEDIA_INVALID');if(head.length<16384)head=Buffer.concat([head,chunk.subarray(0,Math.min(bytesRead,16384-head.length))]);digest.update(chunk.subarray(0,bytesRead));}
  const after=await handle.stat({bigint:true}),entry=await fsp.stat(file,{bigint:true});
  if(['dev','ino','size','mtimeNs','ctimeNs'].some(k=>before[k]!==after[k]||after[k]!==entry[k])||await fsp.realpath(file)!==canonical||BigInt(size)!==before.size)fail('OPERATION_MEDIA_INVALID');
  return {size,sha256:digest.digest('hex'),head};
 }finally{await handle.close();}
}
function createApplicationMediaOutput({directory,userData,persist,sourceDirectories,prepareLocalSource,lookup,request,maxBytes=MAX_BYTES,timeoutMs=120000}={}){
 const paths=require('./utils/paths.cjs'),{withPreparedCloudAsset}=require('./assets/cloud-project-media.cjs');
 const getDirectory=directory||(()=>paths.defaultDownloadDirectory()),getUserData=userData||(()=>require('./electron-refs.cjs').app.getPath('userData'));
 const publish=persist||require('./assets/project-assets.cjs').persistProjectAsset;
 const getSources=sourceDirectories||(directory?()=>[getDirectory()]:()=>require('./assets/migration-manager.cjs').knownMigrationDirectories());
 async function staging(){
  const parent=await fsp.realpath(getUserData()),root=path.join(parent,'application-operation-media');await fsp.mkdir(root,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fsp.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink()||await fsp.realpath(root)!==root||process.platform!=='win32'&&(stat.uid!==process.getuid()||(stat.mode&0o077)))fail('OPERATION_MEDIA_INVALID');return root;
 }
 async function save(stagedPath,payload,destination,guard,onPublish){
  const captured=await verifyFile(stagedPath,maxBytes),mime=outputMime(captured.head,payload.type);
  guard();const extension=require('./utils/mime.cjs').extensionFromMime(mime)||({'image/avif':'.avif','image/heic':'.heic','audio/webm':'.webm'}[mime]);
  const mediaRoot=paths.mediaLibraryRoot(destination);for(const dir of [mediaRoot,path.join(mediaRoot,'_blobs'),path.join(mediaRoot,'_blobs','blobs')]){await fsp.mkdir(dir,{recursive:true});const stat=await fsp.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||await fsp.realpath(dir)!==dir)fail('OPERATION_MEDIA_INVALID');}
  guard();
  // Reuse the real streaming content-addressed project media writer. No new
  // export directory, arbitrary overwrite or second project save format.
  onPublish();let result;try{result=await publish({localPath:stagedPath,forceArchiveExistingFile:true,projectId:payload.projectId,nodeId:payload.nodeId,field:payload.type+'Url',kind:payload.type,mime,filename:'task-result'+extension,assetId:payload.requestId,directory:destination});}catch{fail('OPERATION_OUTCOME_UNKNOWN');}
  if(!result?.ok||typeof result.localPath!=='string'||!inside(paths.mediaLibraryRoot(destination),result.localPath)||!Number.isSafeInteger(result.size)||result.size<4||result.size>maxBytes||typeof result.sha256!=='string'||!/^[a-f0-9]{64}$/.test(result.sha256))fail('OPERATION_OUTCOME_UNKNOWN');
  // The existing store deduplicates by name. Verify its actual published file
  // as well, so a poisoned existing blob/symlink cannot be disclosed as this
  // approved result. Do not overwrite or delete a conflicting existing blob.
  const published=await verifyFile(result.localPath,maxBytes);if(published.sha256!==captured.sha256||published.size!==captured.size||result.sha256!==captured.sha256||result.size!==captured.size)fail('OPERATION_OUTCOME_UNKNOWN');
  return {exported:true,taskId:payload.taskId,projectId:payload.projectId,type:payload.type,localPath:result.localPath,resultUrl:paths.fileUrlFromLocalPath(result.localPath),mime,size:result.size,sha256:result.sha256};
 }
 async function run(payload,guard=()=>{}){
  if(!payload||Object.keys(payload).some(k=>!['source','projectId','nodeId','taskId','type','requestId'].includes(k))||!['image','video','audio'].includes(payload.type)||typeof payload.source!=='string'||!payload.source||typeof guard!=='function')fail('OPERATION_MEDIA_INVALID');
  const token=x=>typeof x==='string'&&/^[-A-Za-z0-9_:.[\]]{1,512}$/.test(x);if(!['projectId','nodeId','taskId','requestId'].every(k=>token(payload[k]))||['projectId','nodeId','requestId'].some(k=>paths.sanitizePathSegment(payload[k])!==payload[k]))fail('OPERATION_MEDIA_INVALID');
  guard();let root,temporary,handle,identity,publishing=false;const onPublish=()=>publishing=true,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
   const requested=path.resolve(getDirectory());await fsp.mkdir(requested,{recursive:true});const destination=await fsp.realpath(requested);root=await staging();const check=()=>{if(controller.signal.aborted)fail('OPERATION_MEDIA_READ_FAILED');guard();};check();
   if(/^file:/i.test(payload.source)){
    const parsed=new URL(payload.source);if(parsed.hostname&&parsed.hostname!=='localhost')fail('OPERATION_MEDIA_INVALID');let file=paths.localPathFromFileUrl(payload.source);
    // Injected only by the approval-only input owner, never from a request.
    // Ordinary result exports retain their existing managed-root restriction.
    if(prepareLocalSource){const approved=await prepareLocalSource(file);check();return await withPreparedCloudAsset({...approved,stagingRoot:root,maxBytes},({stagedPath})=>save(stagedPath,payload,destination,check,onPublish));}
    const roots=[],sources=getSources();if(!Array.isArray(sources)||sources.length>20)fail('OPERATION_MEDIA_INVALID');
    for(const dir of sources){if(typeof dir!=='string'||!path.isAbsolute(dir))fail('OPERATION_MEDIA_INVALID');let canonical;try{canonical=await fsp.realpath(dir);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(inside(dir,file))file=path.join(canonical,path.relative(dir,file));const mediaRoot=paths.mediaLibraryRoot(canonical);for(const candidate of [path.join(mediaRoot,paths.sanitizePathSegment(payload.projectId)),path.join(mediaRoot,'_blobs')]){try{const stat=await fsp.lstat(candidate);if(stat.isDirectory()&&!stat.isSymbolicLink()&&await fsp.realpath(candidate)===candidate)roots.push(candidate);}catch(error){if(error.code!=='ENOENT')throw error;}}}
    if(!roots.length)fail('OPERATION_MEDIA_INVALID');
    return await withPreparedCloudAsset({sourcePath:file,allowedRoots:roots,stagingRoot:root,maxBytes},({stagedPath})=>save(stagedPath,payload,destination,check,onPublish));
   }
   temporary=await fsp.mkdtemp(path.join(root,'export-'));const file=path.join(temporary,'asset');handle=await fsp.open(file,'wx',0o600);identity=await handle.stat();let size=0;
   async function write(bytes){check();size+=bytes.length;if(size>maxBytes)fail('OPERATION_MEDIA_TOO_LARGE');let offset=0;while(offset<bytes.length){const part=await handle.write(bytes,offset,bytes.length-offset);if(!part.bytesWritten)fail('OPERATION_MEDIA_READ_FAILED');offset+=part.bytesWritten;}}
   if(payload.source.startsWith('data:')){
    const comma=payload.source.indexOf(','),header=payload.source.slice(0,comma);if(comma<0||!/^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64$/i.test(header)||payload.source.length-comma-1>Math.ceil(maxBytes/3)*4)fail('OPERATION_MEDIA_TOO_LARGE');
    const body=payload.source.slice(comma+1);if(body.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(body))fail('OPERATION_MEDIA_INVALID');for(let i=0;i<body.length;i+=65536)await write(Buffer.from(body.slice(i,i+65536),'base64'));
   }else{
    const response=await publicResponse(payload.source,{lookup,request,signal:controller.signal});try{const length=response.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))fail('OPERATION_MEDIA_TOO_LARGE');for await(const chunk of response)await write(Buffer.from(chunk));if(length!==undefined&&Number(length)!==size)fail('OPERATION_MEDIA_READ_FAILED');}finally{response.destroy();}
   }
   await handle.sync();await handle.close();handle=null;return await save(file,payload,destination,check,onPublish);
  }catch(error){if(publishing)fail('OPERATION_OUTCOME_UNKNOWN');if(error?.code?.startsWith('OPERATION_')||error?.code?.startsWith('PLAN_'))throw error;fail('OPERATION_MEDIA_READ_FAILED');}
  finally{
   clearTimeout(timer);controller.abort();await handle?.close();if(temporary&&identity){const file=path.join(temporary,'asset'),stat=await fsp.lstat(file);if(!stat.isFile()||stat.dev!==identity.dev||stat.ino!==identity.ino)fail('OPERATION_OUTCOME_UNKNOWN');await fsp.unlink(file);await fsp.rmdir(temporary);}
  }
 }
 return {run};
}
module.exports={createApplicationMediaOutput,publicAddress,outputUrl,publicResponse,outputMime,verifyFile,MAX_BYTES};
