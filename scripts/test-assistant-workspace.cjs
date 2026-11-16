// Isolated storage/runtime tests: synthetic key wrapping, no Electron/Keychain,
// user data, provider traffic or paid requests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createAssistantWorkspaceVault,DIRECTORY} = require('../electron/main/assistant-workspace-vault.cjs');
const {createAssistantWorkspace,buildSessionPrompt,DEFAULT_ROLE} = require('../electron/main/assistant-workspace.cjs');
const {createAssistantSessionPool} = require('../electron/main/assistant-session-pool.cjs');
const deferred = () => {let resolve,reject;const promise = new Promise((a,b) => {resolve=a;reject=b;});return {promise,resolve,reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async check => {for(let i=0;i<300;i++){if(check())return;await tick();}throw Error('SYNTHETIC_WAIT_EXPIRED');};
const id = () => 'session-' + crypto.randomUUID();
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-workspace-test-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const wrapper = crypto.randomBytes(32);
  const encrypt = async text => {
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',wrapper,iv);
    const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
  };
  const decrypt = async encoded => {
    const bytes=Buffer.from(encoded,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',wrapper,bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
  };
  const options={userDataPath:directory,encrypt,decrypt};
  return {directory,options,vault:createAssistantWorkspaceVault(options)};
}

test('encrypted documents survive a fresh instance, large unicode payload, no plaintext',async t => {
  const f=await fixture(t),key=id(),value={private:'PRIVATE_PROMPT_私密'.repeat(20000)};
  assert.deepEqual(await f.vault.write(key,value,0),{revision:1});
  const reopened=createAssistantWorkspaceVault(f.options);
  assert.deepEqual(await reopened.read(key),{revision:1,value});
  for(const name of await fs.readdir(path.join(f.directory,DIRECTORY))){
    const bytes=await fs.readFile(path.join(f.directory,DIRECTORY,name));assert.equal(bytes.includes(Buffer.from('PRIVATE_PROMPT')),false);
  }
});
test('optimistic revision, serialized write snapshots, and failed writes preserve prior data',async t => {
  const f=await fixture(t),key=id(),value={draft:'first'};
  const saved=f.vault.write(key,value,0);value.draft='mutated';await saved;
  assert.equal((await f.vault.read(key)).value.draft,'first');
  const one=f.vault.write(key,{draft:'second'},1),two=f.vault.write(key,{draft:'stale'},1);two.catch(()=>{});
  await one;await assert.rejects(two,{code:'ASSISTANT_WORKSPACE_CONFLICT'});
  assert.equal((await f.vault.read(key)).value.draft,'second');
  await assert.rejects(f.vault.write('../escape',{},0),{code:'ASSISTANT_WORKSPACE_INVALID'});
  await assert.rejects(f.vault.write(key,{draft:'x'.repeat(9*1024*1024)},2),{code:'ASSISTANT_WORKSPACE_INVALID'});
});
test('ciphertext is bound to document ID and revision; no damaged-file reset',async t => {
  const f=await fixture(t),one=id(),two=id();await f.vault.write(one,{content:'one'},0);await f.vault.write(two,{content:'two'},0);
  const file=name=>path.join(f.directory,DIRECTORY,name+'.json');
  await fs.copyFile(file(one),file(two));
  await assert.rejects(f.vault.read(two),{code:'ASSISTANT_WORKSPACE_CORRUPT'});
  const before=await fs.readFile(file(two));
  await assert.rejects(f.vault.write(two,{},1),{code:'ASSISTANT_WORKSPACE_CORRUPT'});
  assert.deepEqual(await fs.readFile(file(two)),before);
  const record=JSON.parse(await fs.readFile(file(one)));record.revision++;
  await fs.writeFile(file(one),JSON.stringify(record));
  await assert.rejects(f.vault.read(one),{code:'ASSISTANT_WORKSPACE_CORRUPT'});
});
test('lost key, corrupt OS protection, and symlinks fail closed',async t => {
  const f=await fixture(t),key=id();await f.vault.write(key,{content:'private'},0);
  const keyfile=path.join(f.directory,DIRECTORY,'key.json');
  const wrapped=await fs.readFile(keyfile);await fs.unlink(keyfile);
  await assert.rejects(createAssistantWorkspaceVault(f.options).read(key),{code:'ASSISTANT_WORKSPACE_KEY_MISSING'});
  await assert.rejects(createAssistantWorkspaceVault(f.options).write(id(),{},0),{code:'ASSISTANT_WORKSPACE_KEY_MISSING'});
  await fs.writeFile(keyfile,wrapped,{mode:0o600});
  const locked=createAssistantWorkspaceVault({...f.options,decrypt:async()=>{throw Error('PRIVATE_SYSTEM_ERROR');}});
  await assert.rejects(locked.read(key),{code:'ASSISTANT_WORKSPACE_DECRYPT_FAILED',message:'ASSISTANT_WORKSPACE_DECRYPT_FAILED'});
  const other=id();await fs.symlink(path.join(f.directory,'outside'),path.join(f.directory,DIRECTORY,other+'.json'));
  await assert.rejects(f.vault.write(other,{},0),{code:'ASSISTANT_WORKSPACE_UNSAFE_PATH'});
});
test('unavailable system encryption creates no plaintext or replacement key',async t => {
  const f=await fixture(t);
  const locked=createAssistantWorkspaceVault({...f.options,encrypt:async()=>{throw Error('PRIVATE_SYSTEM_ERROR');}});
  await assert.rejects(locked.write(id(),{private:'SYNTHETIC_SECRET'},0),{code:'ASSISTANT_WORKSPACE_ENCRYPT_FAILED'});
  assert.deepEqual(await fs.readdir(path.join(f.directory,DIRECTORY)),[]);
});
test('roles and conversations are separate, encrypted lossless role snapshot, independent drafts',async t => {
  const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault});
  const config={name:'Synthetic role',model:'custom-vision',apiConfigId:'manual-provider',systemPrompt:'PRIVATE_ROLE',knowledgeFiles:[{chunks:['PRIVATE_KNOWLEDGE']}],memoryEnabled:true,memoryApiKey:'SYNTHETIC_MEMORY_KEY',outputMode:'json'};
  const role=await w.createRole(config);assert.notEqual(role.id,DEFAULT_ROLE);
  const a=await w.createSession({roleId:role.id,name:'A'}),b=await w.createSession({roleId:role.id,name:'B'});
  assert.notEqual(a.value.id,b.value.id);assert.equal(a.value.roleId,b.value.roleId);
  const patched=await w.patchSession(a.value.id,{draft:'PRIVATE_DRAFT_A',projectId:'project-A'},a.revision);
  await w.patchSession(b.value.id,{draft:'PRIVATE_DRAFT_B'},b.revision);
  await assert.rejects(w.patchSession(a.value.id,{draft:'stale'},a.revision),{code:'ASSISTANT_WORKSPACE_CONFLICT'});
  const reopened=createAssistantWorkspace({vault:createAssistantWorkspaceVault(f.options)});
  assert.deepEqual((await reopened.readRole(role.id)).configuration,config);
  assert.equal((await reopened.readSession(a.value.id)).value.draft,'PRIVATE_DRAFT_A');
  assert.equal((await reopened.readSession(b.value.id)).value.draft,'PRIVATE_DRAFT_B');
  assert.equal(patched.value.projectId,'project-A');
  const index=await reopened.list();assert.equal(index.value.sessions.length,2);
  const renamed=await reopened.changeSession(a.value.id,{name:'Renamed',archived:true},index.revision);
  await assert.rejects(reopened.changeSession(b.value.id,{name:'wrong revision'},index.revision),{code:'ASSISTANT_WORKSPACE_CONFLICT'});
  assert.equal(renamed.value.sessions[0].name,'Renamed');
  await assert.rejects(reopened.beginTurn(a.value.id,'must not send'),{code:'ASSISTANT_SESSION_ARCHIVED'});
});
test('turns preserve concurrent drafts, exclude failed turns, recover interruption without retry',async t => {
  const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault});
  const a=await w.createSession(),b=await w.createSession();
  const first=await w.beginTurn(a.value.id,'A question');
  const bturn=await w.beginTurn(b.value.id,'B private question');
  await assert.rejects(w.beginTurn(a.value.id,'duplicate'),{code:'ASSISTANT_BUSY'});
  const draft=await w.patchSession(a.value.id,{draft:'next question'},first.revision);
  const completed=await w.finishTurn(a.value.id,first.value.task.id,{text:'A answer'});
  assert.equal(completed.value.draft,draft.value.draft);
  const failed=await w.beginTurn(a.value.id,'cancelled private question');
  await w.finishTurn(a.value.id,failed.value.task.id,{code:'ASSISTANT_CANCELLED'});
  await assert.rejects(w.finishTurn(a.value.id,failed.value.task.id,{text:'late answer'}),{code:'ASSISTANT_CANCELLED'});
  const next=await w.beginTurn(a.value.id,'A next question');
  const built=buildSessionPrompt(next.value,'A next question');
  assert.match(built.prompt,/A question/);assert.match(built.prompt,/A answer/);
  assert.doesNotMatch(built.prompt,/B private|cancelled private|late answer/);
  const reopened=createAssistantWorkspace({vault:createAssistantWorkspaceVault(f.options)});
  await reopened.recoverInterrupted();
  assert.equal((await reopened.readSession(a.value.id)).value.task.status,'interrupted');
  assert.equal((await reopened.readSession(b.value.id)).value.task.status,'interrupted');
  assert.equal((await reopened.readSession(b.value.id)).value.messages.length,1);
  assert.equal((await reopened.readSession(b.value.id)).value.task.id,bturn.value.task.id);
});
test('history context is bounded and truncation explicit; attachments cannot grant arbitrary paths',async t => {
  const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault}),s=await w.createSession();
  for(const assetRef of ['file:///private/x','https://private.test/media','/private/x','C:\\private\\x','data:payload'])
    await assert.rejects(w.patchSession(s.value.id,{attachments:[{id:'test',assetRef}]},s.revision),{code:'ASSISTANT_WORKSPACE_INVALID'});
  const messages=[];for(let i=0;i<6;i++)messages.push({role:'user',content:`question-${i}`,turnId:i},{role:'assistant',content:'R'.repeat(90000),turnId:i});
  messages.push({role:'user',turnId:'now',content:'current'});
  const built=buildSessionPrompt({messages,task:{id:'now'}},'current');
  assert.equal(built.contextTruncated,true);assert.ok(built.prompt.length<210000);assert.match(built.prompt,/question-5/);assert.doesNotMatch(built.prompt,/question-0/);
});
test('a running request cannot be rebound to a different project',async t=>{
 const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault}),record=await w.createSession({projectId:'A'}),turn=await w.beginTurn(record.value.id,'pending');
 await assert.rejects(w.patchSession(record.value.id,{projectId:'B'},turn.revision),{code:'ASSISTANT_BUSY'});assert.equal((await w.readSession(record.value.id)).value.projectId,'A');
});
test('legacy import is idempotent, lossless, does not overwrite edited migrated roles',async t=>{
  const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault});
  const configuration={id:'legacy-role',name:'Original',model:'manual-model',apiConfigId:'manual-api',memoryApiKey:'PRIVATE_MEMORY_KEY',knowledgeFiles:[{content:'PRIVATE_KNOWLEDGE'}],outputMode:'node'};
  const conversation=[{id:'welcome',role:'assistant',content:'Welcome'},{role:'user',content:'Old question',attachments:[{name:'reference.png',type:'image'}]},{role:'assistant',content:'Old answer'},{role:'user',content:'Failed question'},{role:'assistant',content:'请求失败：synthetic error'}];
  const original=structuredClone({configuration,conversation});
  const first=await w.importLegacyRole(original),second=await w.importLegacyRole(original);
  assert.equal(second.alreadyImported,true);assert.equal(first.role.id,second.role.id);assert.equal(first.session.id,second.session.id);
  assert.equal((await w.list()).value.roles.length,2);assert.equal((await w.list()).value.sessions.length,1);
  const record=await w.readRole(first.role.id);assert.deepEqual(record.configuration,configuration);
  const session=await w.readSession(first.session.id);assert.deepEqual(session.value.legacySnapshot,conversation);assert.equal(session.value.messages.at(-1).failed,true);
  await w.patchRole(first.role.id,{...configuration,name:'Edited',model:'other-model'},record.revision);
  await w.importLegacyRole(original);assert.equal((await w.readRole(first.role.id)).configuration.name,'Edited');assert.deepEqual(original,{configuration,conversation});
});
test('legacy import recovers published orphan documents after catalog write failure',async t=>{
  const f=await fixture(t);let armed=false;
  const vault={read:f.vault.read,write:async(...args)=>{if(armed&&args[0]==='catalog'){armed=false;throw Object.assign(Error(),{code:'SYNTHETIC_WRITE_FAILURE'});}return f.vault.write(...args);}};
  const w=createAssistantWorkspace({vault});await w.list();armed=true;
  const input={configuration:{id:'legacy-role',name:'Original',model:'manual'},conversation:[{role:'user',content:'question'},{role:'assistant',content:'reply'}]};
  await assert.rejects(w.importLegacyRole(input),{code:'SYNTHETIC_WRITE_FAILURE'});
  const names=(await fs.readdir(path.join(f.directory,DIRECTORY))).filter(name=>/^(role|session)-/.test(name));assert.equal(names.length,2);
  const before=await Promise.all(names.map(name=>fs.readFile(path.join(f.directory,DIRECTORY,name))));
  const recovered=await createAssistantWorkspace({vault:f.vault}).importLegacyRole(input);assert.equal(recovered.alreadyImported,false);
  for(const [index,name]of names.entries())assert.deepEqual(await fs.readFile(path.join(f.directory,DIRECTORY,name)),before[index]);
});
test('custom leases retain role snapshot/version, cannot complete Harness tasks or cancelled turns',async t=>{
  const f=await fixture(t),w=createAssistantWorkspace({vault:f.vault});
  const role=await w.createRole({name:'Role',model:'first'}),a=await w.createSession({roleId:role.id}),b=await w.createSession({roleId:role.id});
  const first=await w.beginCustomTurn(a.value.id,'A question');assert.equal(first.configuration.model,'first');assert.equal(first.value.task.engine,'custom');
  const definition=await w.readRole(role.id);await w.patchRole(role.id,{name:'Role',model:'second'},definition.revision);
  const second=await w.beginCustomTurn(b.value.id,'B question');assert.equal(second.configuration.model,'second');assert.equal(first.configuration.model,'first');
  await w.markCustomRunning(a.value.id,first.value.task.id);await w.finishTurn(a.value.id,first.value.task.id,{code:'ASSISTANT_CANCELLED'});
  await assert.rejects(w.finishCustomTurn(a.value.id,first.value.task.id,{text:'late'}),{code:'ASSISTANT_CANCELLED'});
  await w.finishCustomTurn(b.value.id,second.value.task.id,{text:'B reply'});assert.equal((await w.readSession(b.value.id)).value.task.status,'completed');
  const primary=await w.createSession(),native=await w.beginTurn(primary.value.id,'Native question');
  await assert.rejects(w.beginCustomTurn(primary.value.id,'Wrong engine'),{code:'ASSISTANT_ENGINE_INVALID'});
  await assert.rejects(w.finishCustomTurn(primary.value.id,native.value.task.id,{text:'forged'}),{code:'ASSISTANT_ENGINE_INVALID'});
  assert.equal((await w.readSession(primary.value.id)).value.task.status,'queued');
});
test('pool bounds live resources, queues FIFO, cancellation A never stops B',async () => {
  let opens=0,closes=0,live=0,peak=0;const gates=new Map();
  const pool=createAssistantSessionPool({open:async(slot,id)=>{slot.id=id;slot.stop=deferred();slot.stop.promise.catch(()=>{});opens++;live++;peak=Math.max(peak,live);},close:async slot=>{if(slot&&!slot.closed){slot.closed=true;live--;closes++;slot.stop.reject(Object.assign(Error(),{code:'ASSISTANT_CANCELLED'}));}}});
  const work=id=>async slot=>{const gate=deferred();gates.set(id,gate);return Promise.race([gate.promise,slot.stop.promise]);};
  const a=pool.run('A',work('A')),b=pool.run('B',work('B')),c=pool.run('C',work('C'));a.catch(()=>{});
  await until(()=>gates.has('A')&&gates.has('B'));
  assert.equal(opens,2);assert.equal(pool.status().find(item=>item.sessionId==='C').phase,'queued');
  await assert.rejects(pool.run('A',work('duplicate')),{code:'ASSISTANT_BUSY'});
  await pool.cancel('A');await assert.rejects(a,{code:'ASSISTANT_CANCELLED'});
  await until(()=>gates.has('C'));assert.equal(live,2);assert.equal(peak,2);
  gates.get('B').resolve('B preserved');assert.equal(await b,'B preserved');
  gates.get('C').resolve('C reply');assert.equal(await c,'C reply');
  // Warm reuse is bounded too; an inactive conversation doesn't own a third.
  const before=opens;assert.equal(await pool.run('B',async()=> 'warm'),'warm');assert.equal(opens,before);
  await pool.closeAll();assert.equal(live,0);assert.equal(closes,3);
});
test('provider failure and explicit reset of A preserve the independently running B worker',async t=>{
  const resources=new Map(),opened=[],closed=[],bGate=deferred();let bSignal;
  const pool=createAssistantSessionPool({
    open:async(resource,sessionId)=>{resource.id=sessionId;resource.stop=deferred();resource.stop.promise.catch(()=>{});resources.set(sessionId,resource);opened.push(sessionId);},
    close:async resource=>{if(resource&&!resource.closed){resource.closed=true;closed.push(resource.id);resource.stop.reject(Object.assign(Error(),{code:'ASSISTANT_CANCELLED'}));}},
  });
  t.after(()=>pool.closeAll());
  const b=pool.run('B',(resource,{signal})=>{bSignal=signal;return Promise.race([bGate.promise,resource.stop.promise]);});b.catch(()=>{});
  await until(()=>pool.status().some(item=>item.sessionId==='B'&&item.phase==='running'));
  const bResource=resources.get('B');
  await assert.rejects(pool.run('A',async()=>{throw Object.assign(Error(),{code:'ASSISTANT_PROVIDER_RATE_LIMIT'});}),{code:'ASSISTANT_PROVIDER_RATE_LIMIT'});
  assert.equal(bSignal.aborted,false);assert.equal(resources.get('B'),bResource);assert(!closed.includes('B'));
  const a=pool.run('A',resource=>resource.stop.promise);a.catch(()=>{});
  await until(()=>pool.status().some(item=>item.sessionId==='A'&&item.phase==='running'));
  await pool.reset('A');await assert.rejects(a,{code:'ASSISTANT_CANCELLED'});
  assert.equal(bSignal.aborted,false);assert.equal(bResource.closed,undefined);assert(!closed.includes('B'));
  assert.equal(await pool.run('A',async()=> 'new A context'),'new A context');
  assert.equal(opened.filter(id=>id==='B').length,1);
  bGate.resolve('original B context');assert.equal(await b,'original B context');
  assert.equal(resources.get('B'),bResource);
});
test('queue overflow, queued Stop, startup Stop and explicit quarantine recovery',async () => {
  const gate=deferred(),opening=deferred();let closes=0,closeFailure=false;
  const pool=createAssistantSessionPool({size:1,maxQueue:1,open:async(slot,id,signal)=>{if(id==='startup')await opening.promise;if(signal.aborted)throw Object.assign(Error(),{code:'ASSISTANT_CANCELLED'});slot.stop=deferred();slot.stop.promise.catch(()=>{});},close:async slot=>{if(closeFailure)throw Error('PRIVATE_DIAGNOSTIC');closes++;slot?.stop?.reject(Object.assign(Error(),{code:'ASSISTANT_CANCELLED'}));}});
  const active=pool.run('A',slot=>Promise.race([gate.promise,slot.stop.promise]));active.catch(()=>{});await until(()=>pool.status()[0]?.phase==='running');
  const queued=pool.run('B',()=>{throw Error('must never run');});queued.catch(()=>{});
  await assert.rejects(pool.run('C',async()=>{}),{code:'ASSISTANT_QUEUE_FULL'});
  await pool.cancel('B');await assert.rejects(queued,{code:'ASSISTANT_CANCELLED'});
  const fenced=pool.run('C',async()=>{throw Error('quarantine must not replay this job');});fenced.catch(()=>{});
  closeFailure=true;const before=closes;
  await assert.rejects(pool.cancel('A'),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
  gate.resolve('late');await assert.rejects(active,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
  await assert.rejects(fenced,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
  await assert.rejects(pool.run('C',async()=>{}),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
  assert.equal(closes,before,'unconfirmed close is not automatically retried');
  closeFailure=false;await pool.reset('A');
  const startup=pool.run('startup',async()=>{throw Error('must never start model');});startup.catch(()=>{});
  await tick();const cancelled=pool.cancel('startup');opening.resolve();await cancelled;
  await assert.rejects(startup,{code:'ASSISTANT_CANCELLED'});
  assert.equal(await pool.run('after',async()=> 'recovered'),'recovered');
  await pool.closeAll({permanent:true});await assert.rejects(pool.run('closed',async()=>{}),{code:'ASSISTANT_RUNTIME_CLOSED'});
});
