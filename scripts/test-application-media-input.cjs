// Isolated synthetic bytes only; no real network, credentials or generation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),ts=require('typescript'),{Readable}=require('node:stream'),{EventEmitter}=require('node:events');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {createApplicationMediaBroker}=require('../electron/main/application-media-broker.cjs');
const {createApplicationMediaInput}=require('../electron/main/application-media-input.cjs');
const {persistProjectAsset}=require('../electron/main/assets/project-assets.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/iXcAAAAASUVORK5CYII=','base64');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function until(fn){const end=Date.now()+4000;while(Date.now()<end){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,2));}assert.fail('Input operation did not settle');}
async function fixture(t,options={}){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-media-input-')),profile=path.join(root,'profile'),downloads=path.join(root,'downloads'),source=path.join(root,'reference.png');await fsp.mkdir(profile,{mode:0o700});await fsp.writeFile(source,png);
 let currentTime=1000,project='QA_PROJECT',selected=true,version=1,calls=0,publishes=0,service,held,release;
 const input=createApplicationMediaInput({directory:()=>downloads,userData:()=>profile,now:()=>currentTime,persist:async a=>{publishes++;return persistProjectAsset(a);},...options.input});
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>project,getProjects:()=>[],getCanvas:()=>assert.fail('Import does not edit the canvas'),getAutomation:()=>assert.fail('No generation'),now:()=>currentTime,getInternalScope:owner=>({owner,selected,selectionVersion:version,projectId:project}),consume:(id,nonce)=>service.consume(id,nonce)});
 const broker=createApplicationMediaBroker({call:(method,value)=>dispatcher[method](value),output:{run:()=>assert.fail('Not an export')},input:{...input,async run(...args){calls++;if(options.hold)await new Promise(r=>{held=true;release=r;});return input.run(...args);}},now:()=>currentTime});
 service=createApplicationOperationService({prepare:broker.prepare,commit:broker.commit,release:broker.release,now:()=>currentTime,...options.service});
 t.after(async()=>{service.close();broker.invalidate();dispatcher.close();await fsp.rm(root,{recursive:true,force:true});});
 const request=(extra={})=>({operation:'media.import',projectId:'QA_PROJECT',arguments:{source,type:'image'},idempotencyKey:'qa-import-00000001',...extra});
 const submit=(actor='external',extra={})=>service.submit(actor,request(extra),{selectionVersion:version});
 const read=(h,actor='external')=>service.read(actor,h.request.id,h.receipt);
 const waiting=(h,actor)=>until(()=>read(h,actor).status==='awaiting_confirmation'&&read(h,actor));
 const terminal=(h,actor)=>until(()=>['completed','failed','outcome_unknown'].includes(read(h,actor).status)&&read(h,actor));
 async function approve(h,actor){const w=await waiting(h,actor);service.approve(h.request.id,w.revision);return terminal(h,actor);}
 return {root,profile,downloads,source,input,broker,dispatcher,service,request,submit,read,waiting,terminal,approve,get calls(){return calls;},get publishes(){return publishes;},get held(){return held;},release:()=>release(),setProject:p=>project=p,selectAway:()=>{selected=false;version++;},advance:()=>currentTime+=600001};
}
test('input shape is pure, project-scoped, separately approved, and cannot grant directory/header/paid authority',async()=>{
 const {parseApplicationOperationRequest:p,applicationOperationNeedsApproval:a}=await import('../electron/shared/application-operation-contract.mjs'),policy=await import('../electron/shared/application-operation-policy.mjs');
 const base={operation:'media.import',projectId:'P',arguments:{source:'/nonexistent/ref.png',type:'image'},idempotencyKey:'qa-input-parser-001'};
 assert.deepEqual(p(base),base);assert(a(p(base)));assert.equal(policy.applicationOperation('media.import').permission,'media.input');
 for(const source of ['C:\\QA\\ref.png','file:///C:/QA/ref.png','file:///isolated/ref.png'])assert.equal(p({...base,arguments:{source,type:'image'}}).arguments.source,source);
 for(const source of ['C:\\QA\\NUL.png','/isolated/COM1.png'])assert.throws(()=>p({...base,arguments:{source,type:'image'}}));
 assert.throws(()=>policy.assertApplicationOperationPermission('media.import',['read','generation.paid']),{code:'OPERATION_PERMISSION_REQUIRED',permission:'media.input'});
 for(const source of ['relative.png','/keys/id_rsa','/data/ref.svg','/data/../ref.png','//server/ref.png','\\\\server\\ref.png','C:\\ref.png:secret','file://server/data/ref.png','https://user:PRIVATE@cdn.example/img','https://cdn.example/img#PRIVATE','/bad\n.png'])assert.throws(()=>p({...base,arguments:{source,type:'image'}}),undefined,source);
 for(const extra of [{directory:'/secret'},{headers:{authorization:'PRIVATE'}},{confirmed:true},{permissions:['media.input']},{type:'__proto__'}])assert.throws(()=>p({...base,arguments:{...base.arguments,...extra}}));
 assert.throws(()=>p({...base,projectId:''}));
});
test('preparation does no file reads or writes; repeated approval and request key import once and return no path or bytes',async t=>{
 const f=await fixture(t),h=await f.submit(),w=await f.waiting(h);assert.equal(f.calls,0);assert.equal(f.publishes,0);assert(!fs.existsSync(f.downloads));assert.equal(w.permissions[0],'media.input');assert(!JSON.stringify(w).includes(f.source));
 const review=f.service.list()[0].review;assert.equal(review.sourceLabel,f.source);assert.equal(review.type,'image');f.service.approve(h.request.id,w.revision);f.service.approve(h.request.id,w.revision);
 const done=await f.terminal(h);assert.equal(done.status,'completed',JSON.stringify(done));assert.equal(done.result.sha256,hash(png));assert.equal(done.result.size,png.length);assert.match(done.result.referenceId,/^reference-/);assert.equal(f.calls,1);assert.equal(f.publishes,1);
 for(const forbidden of [f.source,f.downloads,'file:','localPath','resultUrl','data:'])assert(!JSON.stringify(done).includes(forbidden));assert.equal((await f.submit()).request.id,h.request.id);assert.equal(f.calls,1);
 const r=await f.input.resolve(done.result.referenceId,{actor:'external',projectId:'QA_PROJECT'},()=>{});assert.match(r.source,/^file:/);assert.equal(r.sha256,hash(png));assert.deepEqual(await fsp.readdir(path.join(f.profile,'application-operation-media')),[]);
});
test('rejection and cancellation never invoke the file/network owner',async t=>{
 for(const cancel of [false,true]){const f=await fixture(t),h=await f.submit(),w=await f.waiting(h);if(cancel)f.service.cancel('external',h.request.id,h.receipt);else f.service.reject(h.request.id,w.revision);assert.equal(f.calls,0);assert(!fs.existsSync(f.downloads));}
});
test('project and original internal selection changes invalidate an unconsumed import',async t=>{
 for(const internal of [false,true]){const f=await fixture(t),actor=internal?'internal:A':'external',h=await f.submit(actor),w=await f.waiting(h,actor);if(internal)f.selectAway();else f.setProject('OTHER');f.service.approve(h.request.id,w.revision);const done=await f.terminal(h,actor);assert.equal(done.code,internal?'PLAN_SESSION_CHANGED':'PLAN_STALE');assert.equal(f.calls,0);}
});
test('reference IDs are bound to actor/project, expire, and revocation does not delete durable media',async t=>{
 const f=await fixture(t),h=await f.submit('internal:A'),done=await f.approve(h,'internal:A'),id=done.result.referenceId,authority={actor:'internal:A',projectId:'QA_PROJECT'};
 assert.throws(()=>f.input.metadata(id,{...authority,actor:'internal:B'}),{code:'OPERATION_NOT_FOUND'});assert.throws(()=>f.input.metadata(id,{...authority,projectId:'OTHER'}),{code:'OPERATION_NOT_FOUND'});assert.throws(()=>f.input.metadata(id,{...authority,actor:'external'}),{code:'OPERATION_NOT_FOUND'});
 const local=await f.input.resolve(id,authority,()=>{}),release=await f.submit('internal:A',{operation:'media.reference.release',arguments:{referenceId:id},idempotencyKey:'qa-input-release-0001'}),released=await f.terminal(release,'internal:A');assert.equal(released.status,'completed');assert.equal(released.result.released,true);assert.throws(()=>f.input.metadata(id,authority),{code:'OPERATION_NOT_FOUND'});assert(fs.existsSync(require('node:url').fileURLToPath(local.source)));
 const next=await f.submit('internal:A',{idempotencyKey:'qa-input-next-000001'}),nextDone=await f.approve(next,'internal:A');f.advance();assert.throws(()=>f.input.metadata(nextDone.result.referenceId,authority),{code:'OPERATION_NOT_FOUND'});
});
test('source mutation after import cannot alter the captured reference; tampering with the stored bytes is refused',async t=>{
 const f=await fixture(t),done=await f.approve(await f.submit()),id=done.result.referenceId,authority={actor:'external',projectId:'QA_PROJECT'};await fsp.writeFile(f.source,Buffer.from('PRIVATE_CHANGED'));
 const r=await f.input.resolve(id,authority,()=>{});assert.equal(r.sha256,hash(png));await fsp.writeFile(require('node:url').fileURLToPath(r.source),Buffer.from('PRIVATE_POISON'));await assert.rejects(f.input.resolve(id,authority,()=>{}),{code:'OPERATION_MEDIA_INVALID'});
});
test('the same owner can revoke a reference after leaving its project, without new approval or file IO',async t=>{
 const f=await fixture(t),done=await f.approve(await f.submit()),before=f.calls;f.setProject('OTHER');const h=await f.submit('external',{operation:'media.reference.release',arguments:{referenceId:done.result.referenceId},idempotencyKey:'qa-input-release-away-001'});assert.equal((await f.terminal(h)).status,'completed');assert.equal(f.calls,before);assert.throws(()=>f.input.metadata(done.result.referenceId,{actor:'external',projectId:'QA_PROJECT'}),{code:'OPERATION_NOT_FOUND'});
});
test('a pending slow import remains the same unknown job, settles once, and lifecycle revocation cannot publish a handle',async t=>{
 const f=await fixture(t,{hold:true,service:{observationMs:5}}),h=await f.submit(),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);assert.equal((await f.terminal(h)).status,'outcome_unknown');f.release();const done=await until(()=>f.read(h).status==='completed'&&f.read(h));assert.equal(done.result.imported,true);assert.equal((await f.submit()).replayed,true);assert.equal(f.calls,1);
 const revoked=await fixture(t,{hold:true}),rh=await revoked.submit(),rw=await revoked.waiting(rh);revoked.service.approve(rh.request.id,rw.revision);await until(()=>revoked.held);revoked.broker.invalidate();revoked.release();assert.equal((await revoked.terminal(rh)).code,'OPERATION_EXPIRED');assert.equal(revoked.publishes,0);
});
test('exact local file scope refuses symlinks, hardlinks, linked parents and missing files',async t=>{
 for(const mode of ['symlink','hardlink','parent','missing']){const f=await fixture(t);let source=path.join(f.root,mode+'.png');if(mode==='symlink')await fsp.symlink(f.source,source);if(mode==='hardlink')await fsp.link(f.source,source);if(mode==='parent'){const linked=path.join(f.root,'linked');await fsp.symlink(f.root,linked);source=path.join(linked,'reference.png');}const done=await f.approve(await f.submit('external',{arguments:{source,type:'image'}}));assert.equal(done.status,'failed');assert.equal(f.publishes,0);assert(!JSON.stringify(done).includes(source));}
});
test('remote import hides signed query in review, pins DNS, sends no credentials and verifies actual signature',async t=>{
 let requests=0;const request=(url,options,callback)=>{requests++;assert.equal(url.search,'?PRIVATE_SIGNED=1');assert.deepEqual(options.headers,{'accept-encoding':'identity'});assert.equal(options.agent,false);const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>queueMicrotask(()=>{options.lookup(url.hostname,{all:true},(e,a)=>{assert.ifError(e);assert.equal(a[0].address,'8.8.8.8');});const res=Readable.from([png]);res.statusCode=200;res.headers={};callback(res);});return req;};
 const f=await fixture(t,{input:{lookup:async()=>[{address:'8.8.8.8',family:4}],request}}),h=await f.submit('external',{arguments:{source:'https://public.example/img?PRIVATE_SIGNED=1',type:'image'}}),w=await f.waiting(h);assert.equal(requests,0);assert.equal(f.service.list()[0].review.sourceLabel,'https://public.example/img');assert(!JSON.stringify(f.service.list()).includes('PRIVATE_SIGNED'));f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'completed');assert.equal(requests,1);assert.equal(done.result.mime,'image/png');assert(!JSON.stringify(done).includes('PRIVATE_SIGNED'));
});
test('private/mixed DNS, size and false media types fail without publishing a reference',async t=>{
 const privateInput=await fixture(t,{input:{lookup:async()=>[{address:'127.0.0.1',family:4}],request:()=>assert.fail('No private network')}});assert.equal((await privateInput.approve(await privateInput.submit('external',{arguments:{source:'https://local.example/img',type:'image'}}))).code,'OPERATION_MEDIA_INVALID');assert.equal(privateInput.publishes,0);
 for(const mode of ['size','signature']){const f=await fixture(t,{input:mode==='size'?{maxBytes:32}:{}});if(mode==='signature')await fsp.writeFile(f.source,Buffer.from('<html>PRIVATE_NOT_IMAGE</html>'));const done=await f.approve(await f.submit());assert.equal(done.status,'failed');assert.equal(f.publishes,0);}
});
test('video and audio references preserve category; invalidate discards authority without deleting files',async t=>{
 const f=await fixture(t),video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(128)]),audio=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(128)]);
 for(const [type,extension,bytes]of [['video','mp4',video],['audio','wav',audio]]){const source=path.join(f.root,'reference.'+extension);await fsp.writeFile(source,bytes);const done=await f.approve(await f.submit('external',{arguments:{source,type},idempotencyKey:'qa-input-'+type+'-000001'}));assert.equal(done.status,'completed');assert.equal(done.result.type,type);assert.equal(done.result.sha256,hash(bytes));const a={actor:'external',projectId:'QA_PROJECT'},r=await f.input.resolve(done.result.referenceId,a,()=>{});f.input.invalidate();assert.throws(()=>f.input.metadata(done.result.referenceId,a),{code:'OPERATION_NOT_FOUND'});assert(fs.existsSync(require('node:url').fileURLToPath(r.source)));}
});
test('malformed renderer completion and a revoked import never fall through to a private renderer result',async()=>{
 let calls=0;const b=createApplicationMediaBroker({call:async method=>method==='prepare'?{kind:'media.import'}:{ready:true,source:'PRIVATE'},input:{run:()=>{calls++;},invalidate(){}},output:{}}),v={requestId:'ID',actor:'external',expiresAt:Date.now()+60000,request:{operation:'media.import',projectId:'P',arguments:{source:'/ref.png',type:'image'}}};await b.prepare(v);await assert.rejects(b.commit({requestId:'ID'}),{code:'OPERATION_MEDIA_INVALID'});assert.equal(calls,0);
 await b.prepare(v);b.invalidate();await assert.rejects(b.commit({requestId:'ID'}),{code:'OPERATION_EXPIRED'});assert.equal(calls,0);
});
