// Synthetic files/streams only. The real content-addressed writer is reused;
// no OS credential, formal profile, external network or generation is used.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),ts=require('typescript'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationMediaOutput,publicAddress,outputUrl}=require('../electron/main/application-media-output.cjs');
const {createApplicationMediaBroker}=require('../electron/main/application-media-broker.cjs');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {createApplicationTaskExportPlans}=require('../src/renderer/lib/application-task-export.ts');
const {persistProjectAsset}=require('../electron/main/assets/project-assets.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iXcAAAAASUVORK5CYII=','base64'),source='data:image/png;base64,'+png.toString('base64');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),payload=(extra={})=>({source,projectId:'QA_PROJECT',nodeId:'QA_NODE',taskId:'QA_TASK',type:'image',requestId:crypto.randomUUID(),...extra});
const until=async fn=>{const end=Date.now()+3000;while(Date.now()<end){const r=fn();if(r)return r;await new Promise(r=>setTimeout(r,2));}assert.fail('Export did not settle');};
async function files(t,options={}){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-media-export-')),userData=path.join(root,'profile'),directory=path.join(root,'downloads');await fsp.mkdir(userData,{mode:0o700});let publishes=0;
 const output=createApplicationMediaOutput({directory:()=>directory,userData:()=>userData,persist:async args=>{publishes++;return persistProjectAsset(args);},...options});
 t.after(()=>fsp.rm(root,{recursive:true,force:true}));return {root,userData,directory,output,get publishes(){return publishes;},async cleanStage(){assert.deepEqual(await fsp.readdir(path.join(userData,'application-operation-media')),[]);}};
}
async function lifecycle(t,options={}){
 const f=await files(t),records=[{id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'custom',customOutputType:'image',status:'completed',createdAt:1735689600000,resultUrl:source,prompt:'PRIVATE_PROMPT',apiKey:'PRIVATE_KEY'}];let service,project='QA_PROJECT',selected=true,version=1,holdResolve,outputCalls=0;
 const plans=createApplicationTaskExportPlans(()=>records),dispatcher=createApplicationOperationDispatcher({getProjectId:()=>project,getProjects:()=>[],getCanvas:()=>assert.fail('No canvas'),getAutomation:()=>assert.fail('No generation or raw fallback'),getTaskExporter:()=>plans,getInternalScope:owner=>({owner,selected,selectionVersion:version,projectId:'QA_PROJECT'}),consume:async(id,nonce)=>service.consume(id,nonce)});
 const broker=createApplicationMediaBroker({call:async(method,args)=>dispatcher[method](args),output:{async run(...args){outputCalls++;if(options.hold)await new Promise(r=>holdResolve=r);return f.output.run(...args);}}});
 service=createApplicationOperationService({prepare:broker.prepare,commit:broker.commit,release:broker.release,...options.service});t.after(()=>{holdResolve?.();broker.invalidate();service.close();dispatcher.close();});
 const input=(id='qa-export-operation-0001')=>({operation:'media.export',projectId:'QA_PROJECT',arguments:{id:'QA_TASK'},idempotencyKey:id});
 const submit=(actor='external',key)=>service.submit(actor,input(key),actor==='external'?{}:{selectionVersion:version}),read=h=>service.read('external',h.request.id,h.receipt),waiting=h=>until(()=>read(h).status==='awaiting_confirmation'&&read(h)),terminal=h=>until(()=>['completed','failed','outcome_unknown'].includes(read(h).status)&&read(h));
 return {...f,records,service,broker,dispatcher,plans,submit,read,waiting,terminal,input,release:()=>holdResolve?.(),get held(){return !!holdResolve;},get outputCalls(){return outputCalls;},setProject:p=>project=p,selectAway:()=>{selected=false;version++;}};
}
test('export schema is id-only, project-bound and always requires separate approval',async()=>{
 const c=await import('../electron/shared/application-operation-contract.mjs'),p=await import('../electron/shared/application-operation-policy.mjs'),base={operation:'media.export',projectId:'QA_PROJECT',arguments:{id:'QA_TASK'},idempotencyKey:'qa-export-schema-0001'};
 assert(c.applicationOperationNeedsApproval(c.parseApplicationOperationRequest(base)));assert(c.applicationOperationRequiresSelection(base.operation));assert.throws(()=>p.assertApplicationOperationPermission('media.export',['read']),{code:'OPERATION_PERMISSION_REQUIRED'});
 for(const extra of [{path:'/PRIVATE'}, {url:'https://PRIVATE.invalid'}, {directory:'/PRIVATE'}, {materialize:true},{confirmed:true}])assert.throws(()=>c.parseApplicationOperationRequest({...base,arguments:{...base.arguments,...extra}}),{code:'OPERATION_INVALID_REQUEST'});
 assert.throws(()=>c.parseApplicationOperationRequest({...base,projectId:''}),{code:'OPERATION_INVALID_REQUEST'});
});
test('actual dispatcher/broker/service exposes no source before App approval, then publishes the exact result once',async t=>{
 const f=await lifecycle(t),h=await f.submit(),w=await f.waiting(h);assert.equal(f.outputCalls,0);assert(!fs.existsSync(f.directory));assert(!JSON.stringify(f.service.list()).includes('data:image'));assert(!JSON.stringify(f.service.list()).includes('PRIVATE_'));
 f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.result.sha256,hash(png));assert.equal(done.result.type,'image');assert.deepEqual(await fsp.readFile(done.result.localPath),png);assert(done.result.localPath.includes('万卷画布媒体库'));assert(!JSON.stringify(done).includes('PRIVATE_'));assert.equal(f.outputCalls,1);
 const again=await f.submit();assert.equal(again.replayed,true);assert.equal(again.request.id,h.request.id);assert.equal(f.outputCalls,1);await f.cleanStage();
});
test('rejected and cancelled exports never read bytes, create a destination or invoke the output owner',async t=>{
 for(const cancel of [false,true]){const f=await lifecycle(t),h=await f.submit(),w=await f.waiting(h);if(cancel)f.service.cancel('external',h.request.id,h.receipt);else f.service.reject(h.request.id,w.revision);assert.equal(f.outputCalls,0);assert(!fs.existsSync(f.directory));}
});
test('changed source, project or original selected session invalidates export before any file IO',async t=>{
 for(const mode of ['source','project','session']){const f=await lifecycle(t),actor=mode==='session'?'internal:A':'external',h=await f.submit(actor),read=()=>f.service.read(actor,h.request.id,h.receipt);const w=await until(()=>read().status==='awaiting_confirmation'&&read());if(mode==='source')f.records[0].resultUrl='https://PRIVATE.invalid/CHANGED';if(mode==='project')f.setProject('OTHER');if(mode==='session')f.selectAway();f.service.approve(h.request.id,w.revision);const done=await until(()=>read().status==='failed'&&read());assert.equal(done.code,mode==='source'?'OPERATION_TASK_CHANGED':mode==='project'?'PLAN_STALE':'PLAN_SESSION_CHANGED');assert.equal(f.outputCalls,0);assert(!fs.existsSync(f.directory));}
});
test('unready, contradictory, other-project and missing tasks cannot prepare export',()=>{
 for(const task of [{status:'running'},{status:'completed',stoppedByUser:true},{status:'completed',projectId:'OTHER'},{status:'completed',resultUrl:''}]){
  const plans=createApplicationTaskExportPlans(()=>[{id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'image',resultUrl:source,...task}]);assert.throws(()=>plans.prepare('QA_PROJECT','QA_TASK'),{code:'OPERATION_MEDIA_NOT_READY'});
 }
});
test('slow export stays on the original job; query observes its late result without a second export',async t=>{
 const f=await lifecycle(t,{hold:true,service:{observationMs:10}}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);assert.equal((await f.terminal(h)).status,'outcome_unknown');assert.equal(f.outputCalls,1);f.release();const done=await until(()=>f.read(h).status==='completed'&&f.read(h));assert.equal(done.result.sha256,hash(png));assert.equal((await f.submit()).request.id,h.request.id);assert.equal(f.outputCalls,1);
});
test('internal assistant actor uses the same broker and cannot recover another owner export',async t=>{
 const f=await lifecycle(t),h=await f.submit('internal:A'),read=()=>f.service.read('internal:A',h.request.id),w=await until(()=>read().status==='awaiting_confirmation'&&read());assert.throws(()=>f.service.read('internal:B',h.request.id),{code:'OPERATION_NOT_FOUND'});f.service.approve(h.request.id,w.revision);const done=await until(()=>read().status==='completed'&&read());assert.equal(done.result.sha256,hash(png));assert.equal(f.outputCalls,1);
});
test('embedded output reuses the actual streaming content store, deduplicates bytes and cleans private staging',async t=>{
 const f=await files(t),a=await f.output.run(payload()),b=await f.output.run(payload());assert.equal(a.localPath,b.localPath);assert.equal(a.sha256,hash(png));await f.cleanStage();
});
test('local output is restricted to this project or known managed blobs; symlinks/hardlinks and foreign files are refused',async t=>{
 const f=await files(t),project=path.join(f.directory,'万卷画布媒体库','QA_PROJECT');await fsp.mkdir(project,{recursive:true});const file=path.join(project,'result.png');await fsp.writeFile(file,png);
 const good=await f.output.run(payload({source:require('node:url').pathToFileURL(file).href}));assert.equal(good.sha256,hash(png));
 const outside=path.join(f.root,'PRIVATE.png');await fsp.writeFile(outside,png);const symlink=path.join(project,'symlink.png');await fsp.symlink(outside,symlink);const hardlink=path.join(project,'hardlink.png');await fsp.link(outside,hardlink);
 for(const p of [outside,symlink,hardlink])await assert.rejects(f.output.run(payload({source:require('node:url').pathToFileURL(p).href})),{code:'OPERATION_MEDIA_READ_FAILED'});
 await f.cleanStage();
});
test('byte signature, data shape, size and publish failures stay bounded and never return source details',async t=>{
 const f=await files(t,{maxBytes:100});for(const [value,code]of [['data:image/png;base64,%%%','OPERATION_MEDIA_INVALID'],['data:image/png;base64,'+Buffer.alloc(101).toString('base64'),'OPERATION_MEDIA_TOO_LARGE'],['data:image/png;base64,'+Buffer.from('<html>PRIVATE</html>').toString('base64'),'OPERATION_MEDIA_UNSUPPORTED']])await assert.rejects(f.output.run(payload({source:value})),e=>e.code===code&&!e.message.includes('PRIVATE'));assert.equal(f.publishes,0);await f.cleanStage();
 const failed=await files(t,{persist:async()=>{throw Error('PRIVATE_DISK_FAILURE');}});await assert.rejects(failed.output.run(payload()),{code:'OPERATION_OUTCOME_UNKNOWN'});await failed.cleanStage();
});
test('public-address policy rejects local, mapped, private, reserved and mixed DNS before connection',async t=>{
 for(const address of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','172.20.0.1','192.168.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fd00::1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
 assert(publicAddress('8.8.8.8'));assert(publicAddress('2606:4700:4700::1111'));for(const url of ['http://127.0.0.1/x','http://[::ffff:127.0.0.1]/x','https://user:PRIVATE@public.example/x','file:///PRIVATE'])assert.throws(()=>outputUrl(url));
 const f=await files(t,{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:()=>assert.fail('No connection to mixed DNS')});await assert.rejects(f.output.run(payload({source:'https://public.example/output.png'})),{code:'OPERATION_MEDIA_INVALID'});await f.cleanStage();
});
function transport(responses,calls){return(url,options,callback)=>{
 const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{calls.push({url:url.href,options});options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.equal(addresses[0].address,'8.8.8.8');});const config=responses.shift(),res=Readable.from(config.chunks||[]);res.statusCode=config.status||200;res.headers=config.headers||{};callback(res);});return req;
};}
test('remote output pins public DNS, sends no auth/cookies, streams bytes and validates every redirect',async t=>{
 const calls=[],f=await files(t,{lookup:async()=>[{address:'8.8.8.8',family:4}],request:transport([{status:302,headers:{location:'https://cdn.example/image.png'}},{headers:{'content-length':String(png.length)},chunks:[png.subarray(0,10),png.subarray(10)]}],calls)});
 const result=await f.output.run(payload({source:'https://public.example/output?PRIVATE_SIGNED_QUERY=1'}));assert.equal(result.sha256,hash(png));assert.equal(calls.length,2);for(const call of calls){assert.equal(call.options.agent,false);assert.deepEqual(call.options.headers,{'accept-encoding':'identity'});}assert(!JSON.stringify(result).includes('PRIVATE_SIGNED'));await f.cleanStage();
 const blocked=await files(t,{lookup:async()=>[{address:'8.8.8.8',family:4}],request:transport([{status:302,headers:{location:'http://127.0.0.1/PRIVATE'}}],[])});await assert.rejects(blocked.output.run(payload({source:'https://public.example/output'})),{code:'OPERATION_MEDIA_INVALID'});assert.equal(blocked.publishes,0);await blocked.cleanStage();
});
test('content-length mismatch and oversized remote bodies do not publish partial files',async t=>{
 for(const config of [{headers:{'content-length':'99999999'},chunks:[png]},{headers:{'content-length':'1'},chunks:[png]},{chunks:[Buffer.alloc(101)]}]){const f=await files(t,{maxBytes:100,lookup:async()=>[{address:'8.8.8.8',family:4}],request:transport([config],[])});await assert.rejects(f.output.run(payload({source:'https://public.example/output'})));assert.equal(f.publishes,0);await f.cleanStage();}
});
test('revoked main lifecycle prevents publication and private payload identity mismatch never reaches output',async t=>{
 const f=await lifecycle(t,{hold:true}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);f.broker.invalidate();f.release();const done=await f.terminal(h);assert.equal(done.status,'failed');assert.equal(done.code,'OPERATION_EXPIRED');assert(!fs.existsSync(f.directory));
 let calls=0;const broker=createApplicationMediaBroker({call:async method=>method==='prepare'?{kind:'media.export',task:{id:'A',nodeId:'N',projectId:'P',type:'image'}}:{taskId:'OTHER',nodeId:'N',projectId:'P',type:'image',source},output:{run:()=>{calls++;}}});await broker.prepare({requestId:'QA',request:{operation:'media.export',projectId:'P'},expiresAt:Date.now()+1000});await assert.rejects(broker.commit({requestId:'QA'}),{code:'OPERATION_MEDIA_INVALID'});assert.equal(calls,0);
});
test('poisoned existing content blob is not overwritten or disclosed as the requested result',async t=>{
 const f=await files(t),target=path.join(f.directory,'万卷画布媒体库','_blobs','blobs',hash(png)+'.png'),poison=Buffer.from('PRIVATE_DIFFERENT_RESULT');await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.writeFile(target,poison);
 await assert.rejects(f.output.run(payload()),{code:'OPERATION_OUTCOME_UNKNOWN'});assert.deepEqual(await fsp.readFile(target),poison);await f.cleanStage();
});
test('symlinked publication path never exposes the foreign file and staging is still cleaned',async t=>{
 const f=await files(t),target=path.join(f.directory,'万卷画布媒体库','_blobs','blobs',hash(png)+'.png'),outside=path.join(f.root,'PRIVATE.png');await fsp.writeFile(outside,png);await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.symlink(outside,target);
 await assert.rejects(f.output.run(payload()),{code:'OPERATION_OUTCOME_UNKNOWN'});assert((await fsp.lstat(target)).isSymbolicLink());assert.deepEqual(await fsp.readFile(outside),png);await f.cleanStage();
});
test('a known alternate managed media library can supply a result without accepting a caller root',async t=>{
 const f=await files(t),alternate=path.join(f.root,'registered-drive'),file=path.join(alternate,'万卷画布媒体库','QA_PROJECT','result.png');await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,png);
 const output=createApplicationMediaOutput({directory:()=>f.directory,userData:()=>f.userData,sourceDirectories:()=>[alternate],persist:persistProjectAsset});const result=await output.run(payload({source:require('node:url').pathToFileURL(file).href}));assert.equal(result.sha256,hash(png));assert(result.localPath.includes('downloads'));await f.cleanStage();
});
test('common image, video and audio signatures retain their true output type',async t=>{
 const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(1040)]),audio=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(1040)]),f=await files(t);
 for(const [type,mime,bytes]of [['video','video/mp4',video],['audio','audio/wav',audio]]){const result=await f.output.run(payload({type,source:'data:'+mime+';base64,'+bytes.toString('base64')}));assert.equal(result.type,type);assert.equal(result.mime,mime);assert.equal(result.sha256,hash(bytes));}await f.cleanStage();
});
test('blob resolution is approval-only, and a changed task after persistence is uncertain rather than repeated',async()=>{
 const task={id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'image',status:'completed',resultUrl:'blob:http://127.0.0.1/QA_BLOB'},records=[task];let reads=0;
 const plans=createApplicationTaskExportPlans(()=>records,{resolveBlob:async()=>{reads++;return 'file:///managed/result.png';}}),plan=plans.prepare('QA_PROJECT','QA_TASK');assert.equal(reads,0);assert.equal(plan.review.sourceKind,'embedded');assert(!JSON.stringify(plan.review).includes('QA_BLOB'));assert.equal((await plan.commit(()=>{})).source,'file:///managed/result.png');assert.equal(reads,1);
 const changed=createApplicationTaskExportPlans(()=>records,{resolveBlob:async()=>{records[0]={...task,resultUrl:'blob:http://127.0.0.1/OTHER'};return 'file:///managed/result.png';}}).prepare('QA_PROJECT','QA_TASK');await assert.rejects(changed.commit(()=>{}),{code:'OPERATION_OUTCOME_UNKNOWN'});
});
test('a revoked export route cannot fall through and disclose its private renderer payload',async()=>{
 let commits=0,outputs=0;const broker=createApplicationMediaBroker({call:async method=>{if(method==='prepare')return {kind:'media.export',task:{id:'T',nodeId:'N',projectId:'P',type:'image'}};commits++;return {source:'PRIVATE_SOURCE'};},output:{run:()=>{outputs++;}}});
 await broker.prepare({requestId:'QA',request:{operation:'media.export',projectId:'P'},expiresAt:Date.now()+1000});broker.invalidate();await assert.rejects(broker.commit({requestId:'QA'}),{code:'OPERATION_EXPIRED'});assert.equal(commits,0);assert.equal(outputs,0);
});
