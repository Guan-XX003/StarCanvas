// Actual renderer controller + actual encrypted repository with synthetic OS
// wrapping. No browser persistence, GUI, live model or system credentials.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const file=path.resolve(__dirname,'../src/renderer/lib/assistant-workspace-client.ts');
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createAssistantWorkspaceClient}=compiled.exports;
const {createAssistantWorkspace}=require('../electron/main/assistant-workspace.cjs');
const {createAssistantWorkspaceVault}=require('../electron/main/assistant-workspace-vault.cjs');
test('file import stays with its owner, restart resolves encrypted bytes and send does not silently lose media',async t=>{
  const f=await fixture(t),c=f.client;
  await c.initialize();await c.createRole({name:'Media',model:'vision',apiConfigId:'synthetic'});
  const a=c.getSnapshot().selectedId;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]),Buffer.from('IHDR'),Buffer.alloc(12),Buffer.from('SYNTHETIC_MEDIA_BYTES')]);
  let release;const file={name:'reference.png',size:bytes.length,arrayBuffer:()=>new Promise(resolve=>{release=()=>resolve(Uint8Array.from(bytes).buffer);})};
  const importing=c.addFiles(a,[file]);assert.equal(c.pending(),true);
  while(!release)await new Promise(r=>setImmediate(r));
  await c.create();const b=c.getSnapshot().selectedId;release();await importing;
  assert.equal(c.viewFor(b).mediaStatus.phase,'idle');assert.equal(c.viewFor(a).mediaStatus.phase,'done');
  assert.equal(c.viewFor(b).record.value.attachments.length,0);assert.equal(c.viewFor(a).record.value.attachments.length,1);
  const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();await fresh.select(a);
  const descriptor=fresh.viewFor(a).record.value.attachments[0];assert.equal(descriptor.name,'reference.png');
  const oldFetch=global.fetch,oldReader=global.FileReader;let request;
  t.after(()=>{global.fetch=oldFetch;global.FileReader=oldReader;});
  global.FileReader=class{readAsDataURL(file){file.arrayBuffer().then(bytes=>{this.result=`data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});}};
  global.fetch=async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'Synthetic vision reply'}}]})};};
  const environment={agentModelOptions:['vision'],apiConfigs:[{id:'synthetic',url:'https://synthetic.invalid',key:'SYNTHETIC_KEY'}],modelProtocolRegistry:{test:{requestType:'openai-chat'}},textModelProtocolBindings:{vision:'test'}};
  fresh.set(a,'messages',[{role:'user',text:'Inspect',attachments:[descriptor]}]);
  fresh.set(a,'mediaStatus',{phase:'done'});
  const result=await fresh.sendCustom(a,'Inspect',environment);assert.equal(result.ok,true);assert.equal(result.value,'Synthetic vision reply');assert.equal(fresh.viewFor(a).mediaStatus.phase,'idle','saved-not-sent copy must disappear once a send begins');
  assert.ok(JSON.stringify(request).includes(bytes.toString('base64')));assert.equal(fresh.viewFor(a).record.value.attachments.length,0);
  fresh.set(a,'messages',previous=>[...previous,{role:'assistant',text:result.value,modelReply:true}]);await fresh.flushAll();
  const reopened=createAssistantWorkspaceClient(()=>f.bridge);await reopened.initialize();await reopened.select(a);
  assert.equal(reopened.viewFor(a).messages[0].attachments[0].assetRef,descriptor.assetRef);
  await reopened.setAttachments(a,[descriptor]);assert.equal(reopened.viewFor(a).record.value.attachments.length,1);
  assert.equal((await reopened.sendCustom(a,'Unsupported video test',{...environment,apiConfigs:[]})).ok,false);
  assert.equal(reopened.viewFor(a).record.value.attachments.length,1);
  await fresh.flushAll();await reopened.flushAll();
});
test('partial attachment selection keeps earlier files, names the failure, and never persists volatile status or bytes',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();await c.createRole({name:'Media status',model:'vision',apiConfigId:'synthetic'});const a=c.getSnapshot().selectedId;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]),Buffer.from('IHDR'),Buffer.alloc(12)]);
 const file=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
 await assert.rejects(c.addFiles(a,[file('GOOD.png',png),file('BAD.txt',Buffer.from('not-media'))]),{code:'ASSISTANT_MEDIA_UNSUPPORTED'});
 assert.equal(c.viewFor(a).record.value.attachments.length,1);assert.equal(c.viewFor(a).mediaStatus.name,'BAD.txt');assert.equal(c.viewFor(a).mediaStatus.phase,'failed');
 await c.flushAll();assert(!JSON.stringify(await f.repository.readSession(a)).includes('mediaStatus'));const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();assert.equal(fresh.viewFor(a).mediaStatus.phase,'idle');
 await c.setAttachments(a,[]);assert.equal(c.viewFor(a).mediaStatus.phase,'idle');assert.equal(f.calls.length,0);await fresh.flushAll();
});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('native preview is per request, deduplicates sends, final-reads on failure and persists only an incomplete quote',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId;
 const {createAssistantTurnProgress}=require('../electron/main/assistant-turn-progress.cjs'),progress=createAssistantTurnProgress(),turns=new Map();
 f.bridge.assistantWorkspaceProgress=async(...args)=>({ok:true,value:progress.read(...args)});
 f.bridge.assistantWorkspaceSend=async(id,text,context,requestId)=>{
  const prepared=await f.repository.beginTurn(id,text),ticket=progress.begin(id,requestId,prepared.value.task.id),gate=deferred();turns.set(id,{ticket,gate,requestId});
  const code=await gate.promise;ticket.close();
  if(code){await f.repository.finishTurn(id,prepared.value.task.id,{code});return {ok:false,code};}
  return {ok:true,value:await f.repository.finishTurn(id,prepared.value.task.id,{text:'COMPLETE_B'})};
 };
 const wait=async p=>{const end=Date.now()+3000;while(!p()){assert(Date.now()<end);await new Promise(r=>setTimeout(r,10));}};
 const first=c.send(a,'QA_NATIVE_A',{});await wait(()=>turns.has(a));const original=turns.get(a);original.ticket.text('EARLY_A');await wait(()=>c.viewFor(a).stream.text==='EARLY_A');
 assert.equal(c.viewFor(a).version,0);assert.equal((await f.repository.readSession(a)).value.messages.length,1);assert.equal((await c.send(a,'DUPLICATE',{})).code,'ASSISTANT_BUSY');assert.equal(c.viewFor(a).stream.text,'EARLY_A');
 await c.create();const b=c.getSnapshot().selectedId;c.set(b,'draft','B_DRAFT');const second=c.send(b,'QA_NATIVE_B',{});await wait(()=>turns.has(b));turns.get(b).ticket.text('COMPLETE_B');
 original.ticket.text('FINAL_PARTIAL_A [[STARCANVAS_ACTION:open_settings]]');original.gate.resolve('ASSISTANT_PROVIDER_NETWORK');assert.equal((await first).ok,false);
 assert.equal(c.viewFor(a).messages.at(-1).text,'FINAL_PARTIAL_A [[STARCANVAS_ACTION:open_settings]]','last partial captured even before next timer');assert.equal(c.viewFor(a).messages.at(-1).incomplete,true);assert.equal(c.viewFor(a).messages.at(-1).action,undefined);assert.equal(c.viewFor(b).draft,'B_DRAFT');
 turns.get(b).gate.resolve();const reply=await second;assert.equal(reply.value,'COMPLETE_B');assert.equal(c.viewFor(b).stream.active,false);assert.equal(c.viewFor(b).messages.length,0,'only caller commits final presentation once');
 c.set(b,'messages',[{role:'assistant',text:reply.value,modelReply:true}]);await c.flushAll();
 const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();await fresh.select(a);assert.equal(fresh.viewFor(a).messages.at(-1).incomplete,true);assert.equal(fresh.viewFor(a).stream.text,'');assert.equal((await f.repository.readSession(a)).value.messages.some(x=>x.role==='assistant'),false);await fresh.flushAll();
});
test('real custom streams remain owner-scoped; truncated text persists as incomplete quote, never executable or future model context',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();await c.createRole({name:'Stream',model:'vision',apiConfigId:'synthetic'});const a=c.getSnapshot().selectedId;
 const oldFetch=global.fetch;t.after(()=>{global.fetch=oldFetch;});let upstreamA,upstreamB,calls=0;
 global.fetch=async(_url,options)=>{calls++;assert.equal(options.starcanvasStream,true);assert.equal(options.starcanvasNoRetry,true);assert.equal(JSON.parse(options.body).stream,true);
  return new Response(new ReadableStream({start:source=>{if(options.body.includes('STREAM_A'))upstreamA=source;else upstreamB=source;}}),{headers:{'content-type':'text/event-stream'}});
 };
 const write=(upstream,value)=>upstream.enqueue(new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n'));
 const wait=async fn=>{const until=Date.now()+3000;while(!fn()){assert(Date.now()<until,'original stream did not progress');await new Promise(setImmediate);}};
 const environment={agentModelOptions:['vision'],apiConfigs:[{id:'synthetic',url:'https://synthetic.invalid',key:'SYNTHETIC_KEY'}],modelProtocolRegistry:{test:{requestType:'openai-chat'}},textModelProtocolBindings:{vision:'test'}};
 c.set(a,'messages',[{role:'user',text:'STREAM_A'}]);const first=c.sendCustom(a,'STREAM_A',environment);await wait(()=>upstreamA);write(upstreamA,{choices:[{index:0,delta:{content:'PARTIAL_A [[STARCANVAS_ACTION:open_api_settings]]'}}]});await wait(()=>c.viewFor(a).stream.text);
 assert.equal(c.viewFor(a).messages.length,1,'no token-by-token durable message writes');await c.create();const b=c.getSnapshot().selectedId;c.set(b,'draft','B_DRAFT');c.set(b,'messages',[{role:'user',text:'STREAM_B'}]);const second=c.sendCustom(b,'STREAM_B',environment);await wait(()=>upstreamB);
 write(upstreamA,{choices:[{index:0,delta:{content:'_LATE_A'}}]});await wait(()=>c.viewFor(a).stream.text.endsWith('_LATE_A'));assert.equal(c.viewFor(b).stream.text,'');assert.equal(c.viewFor(b).draft,'B_DRAFT');upstreamA.close();
 assert.equal((await first).code,'ASSISTANT_STREAM_INCOMPLETE');const partial=c.viewFor(a).messages.at(-1);assert.equal(partial.incomplete,true);assert.equal(partial.modelReply,true);assert.equal(partial.action,undefined);assert.equal(partial.executionStatus,undefined);
 write(upstreamB,{choices:[{index:0,delta:{content:'COMPLETE_B'}}]});write(upstreamB,{choices:[{index:0,delta:{},finish_reason:'stop'}]});upstreamB.close();const success=await second;assert.equal(success.ok,true);assert.equal(success.value,'COMPLETE_B');c.set(b,'messages',items=>[...items,{role:'assistant',text:success.value,modelReply:true}]);assert.equal(calls,2);
 await c.select(a);await c.flushAll();const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();await fresh.select(a);assert.equal(fresh.viewFor(a).messages.at(-1).incomplete,true);assert.equal(fresh.viewFor(a).stream.text,'');assert.equal((await f.repository.readSession(a)).value.messages.some(m=>m.role==='assistant'),false);assert.equal(calls,2,'restart does not retry a stream');
 const backup=await c.exportBackup('all');assert.equal(backup.sessions.find(s=>s.value.id===a).value.presentation.at(-1).incomplete,true);await fresh.flushAll();
});
test('normal-close preparation saves drafts without waiting for or replaying a held model request',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId,held=f.hold();
 const sending=c.send(a,'ONE_SYNTHETIC_REQUEST',{});while(!f.calls.length)await new Promise(r=>setImmediate(r));
 c.set(a,'draft','DRAFT_DURING_TURN');const ready=await c.prepareClose();assert.equal(ready.ok,true);assert.equal(f.calls.length,1);assert.equal((await f.repository.readSession(a)).value.draft,'DRAFT_DURING_TURN');
 held.resolve();await sending;await c.flushAll();
});
test('normal-close preparation reports a local write failure without discarding the unsaved draft',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId;
 c.set(a,'draft','UNSAVED_CLOSE_DRAFT');f.setFailure('ASSISTANT_WORKSPACE_ENCRYPT_FAILED');const result=await c.prepareClose();assert.equal(result.ok,false);assert.equal(c.viewFor(a).draft,'UNSAVED_CLOSE_DRAFT');assert(c.pending());assert.equal(f.calls.length,0);
 f.setFailure('');assert.equal((await c.prepareClose()).ok,true);assert.equal((await f.repository.readSession(a)).value.draft,'UNSAVED_CLOSE_DRAFT');
});
test('task read handles and in-flight promises never enter encrypted session persistence or restart state',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId;
 c.set(a,'taskRead',{working:true,requestId:'PRIVATE_READ_HANDLE',inFlight:Promise.resolve('PRIVATE_READ_RESULT')});
 c.set(a,'draft','QA_SAVED_DRAFT');await c.flushAll();assert(!JSON.stringify(await f.repository.readSession(a)).includes('PRIVATE_READ'));
 const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();assert.deepEqual(fresh.viewFor(a).taskRead,{working:false});assert.equal(fresh.viewFor(a).draft,'QA_SAVED_DRAFT');
});
test('native task monitoring follows only the owner, reports read failure, and stops without replaying a model request',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId,held=f.hold();
 let reads=0,failRead=false;const actualRead=f.bridge.assistantWorkspaceReadSession;
 f.bridge.assistantWorkspaceReadSession=async(...args)=>{reads++;return failRead?{ok:false,code:'ASSISTANT_WORKSPACE_UNAVAILABLE'}:actualRead(...args);};
 const pending=c.send(a,'QUEUED_A',{});
 const wait=async predicate=>{const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('owned task observation timed out');await new Promise(r=>setTimeout(r,10));}};
 try{
  await wait(()=>c.viewFor(a).record?.value.task.status==='queued');await c.create();const b=c.getSnapshot().selectedId;c.set(b,'draft','B_UNCHANGED_DRAFT');
  failRead=true;await wait(()=>c.viewFor(a).taskStatusUnavailable);assert.equal(c.viewFor(b).taskStatusUnavailable,false);assert.equal(c.viewFor(b).draft,'B_UNCHANGED_DRAFT');
  failRead=false;const record=await f.repository.readSession(a);await f.repository.markRunning(a,record.value.task.id);await wait(()=>!c.viewFor(a).taskStatusUnavailable&&c.viewFor(a).record.value.task.status==='running');
  held.resolve();assert.equal((await pending).ok,true);const finishedReads=reads;await new Promise(r=>setTimeout(r,1300));assert.equal(reads,finishedReads);assert.equal(f.calls.length,1);assert.equal(c.viewFor(b).draft,'B_UNCHANGED_DRAFT');
 }finally{held.resolve();await pending;}
});
async function fixture(t){
  const home=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-workspace-client-'));
  // Test-only wrapping; real document encryption stays the production AES-GCM.
  const options={userDataPath:home,encrypt:async value=>'TEST_WRAPPED_'+Buffer.from(value).toString('hex'),decrypt:async value=>Buffer.from(value.slice(13),'hex').toString()};
  const repository=createAssistantWorkspace({vault:createAssistantWorkspaceVault(options)}),calls=[];
  let failure='',held=null;
  const methods={
    assistantWorkspaceList:()=>repository.list(),assistantWorkspaceCreateSession:input=>repository.createSession(input),
    assistantWorkspaceReadSession:id=>repository.readSession(id),assistantWorkspacePatchSession:(...args)=>repository.patchSession(...args),
    assistantWorkspaceChangeSession:(...args)=>repository.changeSession(...args),assistantWorkspaceSelectSession:id=>repository.selectSession(id),
    assistantWorkspaceCreateRole:configuration=>repository.createRole(configuration),assistantWorkspaceReadRole:id=>repository.readRole(id),
    assistantWorkspaceAddAttachment:(...args)=>repository.addAttachment(...args),
    assistantWorkspaceReadTurnAttachments:(...args)=>repository.readTurnAttachments(...args),
    assistantWorkspaceBeginCustomTurn:(...args)=>repository.beginCustomTurn(...args),
    assistantWorkspaceCustomRunning:(...args)=>repository.markCustomRunning(...args),
    assistantWorkspaceCompleteCustomTurn:(...args)=>repository.finishCustomTurn(...args),
    assistantWorkspaceExportBackup:(...args)=>repository.exportBackup(...args),
    assistantWorkspaceImportBackup:(...args)=>repository.importBackup(...args),
    assistantWorkspaceImportLegacyRole:(configuration,conversation)=>repository.importLegacyRole({configuration,conversation}),
    assistantWorkspaceSend:async(id,text)=>{calls.push({id,text});const turn=await repository.beginTurn(id,text);if(held)await held.promise;return repository.finishTurn(id,turn.value.task.id,{text:'REPLY_'+text});},
    assistantWorkspaceCancel:async id=>{const record=await repository.readSession(id);if(['queued','running'].includes(record.value.task.status))await repository.finishTurn(id,record.value.task.id,{code:'ASSISTANT_CANCELLED'});return repository.readSession(id);},
  };
  const bridge=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,async(...args)=>{try{if(failure&&name==='assistantWorkspacePatchSession')throw Object.assign(Error(),{code:failure});return {ok:true,value:await method(...args)};}catch(error){return {ok:false,code:error.code};}}]));
  const client=createAssistantWorkspaceClient(()=>bridge);
  t.after(async()=>{failure='';held?.resolve();await client.flushAll().catch(()=>{});await fsp.rm(home,{recursive:true,force:true});});
  return {client,repository,bridge,calls,setFailure:code=>{failure=code;},hold:()=>held=deferred()};
}
test('confirmed generation task pointers survive encrypted history restart, but no plan, approval or execution is restored',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize('QA_PROJECT');const a=c.getSnapshot().selectedId;
 const reference={version:1,projectId:'QA_PROJECT',nodeId:'QA_NODE',submissionId:'10000000-1111-4111-8111-111111111111'};
 c.set(a,'messages',[{role:'assistant',text:'GENERATION_REQUESTED',executionStatus:'confirmed',generationTask:reference}]);await c.flushAll();
 const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize('QA_PROJECT');assert.deepEqual(fresh.viewFor(a).messages[0].generationTask,reference);assert.equal(fresh.viewFor(a).canvasPlan.phase,'idle');assert.equal(f.calls.length,0);
 const snapshot=await f.repository.exportBackup({scope:'session',id:a}),receipt=await f.repository.importBackup(snapshot),imported=await f.repository.readSession(receipt.sessionIds[0]);
 assert.equal(imported.value.presentation[0].generationTask,undefined);assert.equal(imported.value.presentation[0].executionStatus,undefined);assert.equal(imported.value.presentation[0].modelReply,true);
 const before=await f.repository.readSession(a);
 for(const patch of [{...reference,nonce:'PRIVATE'}, {...reference,source:'file:///PRIVATE'}])await assert.rejects(()=>f.repository.patchSession(a,{presentation:[{role:'assistant',text:'BAD',executionStatus:'confirmed',generationTask:patch}]},before.revision),{code:'ASSISTANT_WORKSPACE_INVALID'});
 await assert.rejects(()=>f.repository.patchSession(a,{presentation:[{role:'assistant',text:'MODEL_QUOTE',modelReply:true,executionStatus:'confirmed',generationTask:reference}]},before.revision),{code:'ASSISTANT_WORKSPACE_INVALID'});
 assert.equal((await f.repository.readSession(a)).revision,before.revision);
});
test('select/create/rename/archive persist, drafts survive new renderer controller',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize('project-A');assert.equal(c.getSnapshot().phase,'ready');
  const a=c.getSnapshot().selectedId;c.set(a,'draft','PRIVATE_A_DRAFT');await c.create('project-B');const b=c.getSnapshot().selectedId;
  assert.notEqual(a,b);c.set(b,'draft','PRIVATE_B_DRAFT');await c.flushAll();await c.select(a);
  assert.equal(c.viewFor(a).draft,'PRIVATE_A_DRAFT');await c.change(a,{name:'Renamed A'});
  const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();assert.equal(fresh.getSnapshot().selectedId,a);assert.equal(fresh.viewFor(a).draft,'PRIVATE_A_DRAFT');
  await fresh.select(b);assert.equal(fresh.viewFor(b).draft,'PRIVATE_B_DRAFT');await fresh.change(b,{archived:true});assert.equal(fresh.getSnapshot().selectedId,a);
  const index=await f.repository.list();assert.equal(index.value.sessions.find(item=>item.id===b).archived,true);assert.equal(index.value.sessions.find(item=>item.id===a).name,'Renamed A');
});
test('project binding remains session-owned and survives a fresh controller',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize('project-A');const a=c.getSnapshot().selectedId;await c.create('project-B');const b=c.getSnapshot().selectedId;
 await c.bindProject(a,'project-C');assert.equal(c.viewFor(b).record.value.projectId,'project-B');
 const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();await fresh.select(a);assert.equal(fresh.viewFor(a).record.value.projectId,'project-C');await fresh.bindProject(a,'');assert.equal((await f.repository.readSession(a)).value.projectId,'');assert.equal((await f.repository.readSession(b)).value.projectId,'project-B');await fresh.flushAll();
});
test('one invalid legacy role does not prevent later valid roles from importing; retries remain idempotent',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();
 const agents=[{id:'valid-first',name:'First'},{id:'invalid',name:42},{id:'valid-last',name:'Last'}],before=structuredClone(agents);
 await assert.rejects(c.importLegacy(agents,{}),{code:'ASSISTANT_LEGACY_IMPORT_PARTIAL'});
 assert.deepEqual(c.getSnapshot().catalog.roles.map(role=>role.name),['StarCanvas','First','Last']);assert.deepEqual(agents,before);
 await assert.rejects(c.importLegacy(agents,{}),{code:'ASSISTANT_LEGACY_IMPORT_PARTIAL'});assert.equal(c.getSnapshot().catalog.roles.length,3);
});
test('committed backup import is not reported as an unchanged failure when only the UI refresh fails',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize('original-project');const original=c.getSnapshot().selectedId;c.set(original,'draft','ORIGINAL_DRAFT');
 const snapshot=await c.exportBackup('all'),actualImport=f.bridge.assistantWorkspaceImportBackup,actualList=f.bridge.assistantWorkspaceList;let failList=false;
 f.bridge.assistantWorkspaceImportBackup=async(...args)=>{const result=await actualImport(...args);if(result.ok)failList=true;return result;};
 f.bridge.assistantWorkspaceList=async()=>failList?{ok:false,code:'ASSISTANT_WORKSPACE_UNAVAILABLE'}:actualList();
 const receipt=await c.importBackup(snapshot);assert.equal(receipt.refreshFailed,true);assert.equal((await f.repository.list()).value.sessions.length,2);assert.equal((await f.repository.readSession(original)).value.draft,'ORIGINAL_DRAFT');
 failList=false;f.bridge.assistantWorkspaceImportBackup=actualImport;const second=await c.importBackup(snapshot);assert.equal(second.alreadyImported,true);assert.equal((await f.repository.list()).value.sessions.length,2);
});
test('late reply setters remain owned by A while B is selected; completed context persists',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId;
  c.set(a,'messages',[{role:'user',text:'A'}]);const held=f.hold();const pending=c.send(a,'A',{});
  while(!f.calls.length)await new Promise(r=>setImmediate(r));
  await c.create();const b=c.getSnapshot().selectedId;c.set(b,'draft','B draft');held.resolve();assert.equal((await pending).value,'REPLY_A');
  c.set(a,'messages',old=>[...old,{role:'assistant',text:'REPLY_A',modelReply:true}]);await c.flushAll();
  assert.equal(c.viewFor(b).messages.length,0);assert.equal(c.viewFor(b).draft,'B draft');
  const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();await fresh.select(a);
  assert.equal(fresh.viewFor(a).messages.at(-1).text,'REPLY_A');assert.equal(fresh.viewFor(b).messages.length,0);
});
test('proposal persistence never revives confirmation buttons or project-bound actions',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize();const id=c.getSnapshot().selectedId;
  c.set(id,'messages',[{role:'assistant',text:'Proposal',action:'create_image_node',draft:'PRIVATE_DRAFT',actionProjectId:'project-A',preference:{kind:'theme',value:'dark'}}]);await c.flush(id);
  const stored=(await f.repository.readSession(id)).value.presentation[0];assert.equal(stored.proposalExpired,true);assert.equal(stored.action,undefined);assert.equal(stored.preference,undefined);assert.equal(stored.draft,undefined);
  const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();assert.equal(fresh.viewFor(id).messages[0].action,undefined);
});
test('basic-action handles, promises and confirmation authority never enter secure conversation records or restart state',async t=>{
 const f=await fixture(t),c=f.client;await c.initialize();const id=c.getSnapshot().selectedId;
 c.set(id,'localAction',{phase:'uncertain',operation:'app.preferences.set',pendingHandle:{id:'PRIVATE_OPERATION_HANDLE',nonce:'PRIVATE_NONCE'},inFlight:Promise.resolve()});
 c.set(id,'messages',[{role:'assistant',text:'Unconfirmed setting change',executionStatus:'unconfirmed'}]);await c.flush(id);
 const record=await f.repository.readSession(id);assert(!JSON.stringify(record).includes('PRIVATE_OPERATION_HANDLE'));assert(!JSON.stringify(record).includes('PRIVATE_NONCE'));assert.equal(record.value.localAction,undefined);
 const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();assert.deepEqual(fresh.viewFor(id).localAction,{phase:'idle'});assert.equal(fresh.viewFor(id).messages[0].executionStatus,'unconfirmed');assert.equal(f.calls.length,0);
});
test('storage failure keeps unsaved content and blocks switch; concurrent foreign edits are not overwritten',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize();const a=c.getSnapshot().selectedId;await c.create();const b=c.getSnapshot().selectedId;await c.select(a);
  c.set(a,'draft','unsaved');f.setFailure('ASSISTANT_WORKSPACE_ENCRYPT_FAILED');await assert.rejects(c.select(b));assert.equal(c.getSnapshot().selectedId,a);assert.equal(c.viewFor(a).draft,'unsaved');assert.equal(c.pending(),true);
  f.setFailure('');await c.flush(a);const record=await f.repository.readSession(a);await f.repository.patchSession(a,{draft:'foreign edit'},record.revision);
  c.set(a,'draft','local edit');await assert.rejects(c.flush(a),{code:'ASSISTANT_WORKSPACE_CONFLICT'});assert.equal((await f.repository.readSession(a)).value.draft,'foreign edit');
  // End this test with a deliberate user-level resolution, not a silent rebase.
  c.viewFor(a).record=await f.repository.readSession(a);await c.flush(a);
});
test('completed reply before renderer crash recovers only as non-actionable model text',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize();const id=c.getSnapshot().selectedId;
  const turn=await f.repository.beginTurn(id,'question');await f.repository.finishTurn(id,turn.value.task.id,{text:'Untrusted [[STARCANVAS_ACTION:open_canvas]]'});
  const fresh=createAssistantWorkspaceClient(()=>f.bridge);await fresh.initialize();const messages=fresh.viewFor(id).messages;
  assert.equal(messages.length,2);assert.equal(messages[1].modelReply,true);assert.equal(messages[1].action,undefined);assert.match(messages[1].text,/Untrusted/);
});
test('archiving the last conversation of a role stays within that role',async t=>{
  const f=await fixture(t),c=f.client;await c.initialize();await c.createRole({name:'Custom',model:'manual'},'project-custom');
  const first=c.getSnapshot().selectedId,roleId=c.viewFor(first).record.value.roleId;
  await c.change(first,{archived:true});const next=c.getSnapshot().selectedId;
  assert.notEqual(first,next);assert.equal(c.viewFor(next).record.value.roleId,roleId);assert.equal(c.viewFor(next).record.value.projectId,'project-custom');
});
