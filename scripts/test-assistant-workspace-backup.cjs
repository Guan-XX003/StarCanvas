const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createAssistantWorkspaceVault,DIRECTORY}=require('../electron/main/assistant-workspace-vault.cjs');
const {createAssistantWorkspace,DEFAULT_ROLE}=require('../electron/main/assistant-workspace.cjs');
const {MAX_BACKUP,captureWorkspaceBackup}=require('../electron/main/assistant-workspace-backup.cjs');
const png=()=>Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-workspace-backup-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const key=crypto.randomBytes(32),options={userDataPath:home,encrypt:async value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64');},decrypt:async value=>{const bytes=Buffer.from(value,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(-16));return Buffer.concat([d.update(bytes.subarray(12,-16)),d.final()]).toString();}};
 const vault=createAssistantWorkspaceVault(options),repository=createAssistantWorkspace({vault});await repository.list();return {home,options,vault,repository};
}
async function source(t){
 const f=await fixture(t),role=await f.repository.createRole({id:'legacy-role',name:'PRIVATE_ROLE',model:'manual-model',apiConfigId:'manual-api',memoryEnabled:true,memoryScope:'role',memoryApiKey:'PRIVATE_MEM0_KEY',knowledgeFiles:[{name:'PRIVATE_KNOWLEDGE',content:'PRIVATE_CONTENT',chunks:['PRIVATE_CONTENT']}],outputMode:'node',temperature:0});
 let record=await f.repository.createSession({roleId:role.id,name:'PRIVATE_SESSION',projectId:'original-project'});
 record=await f.repository.addAttachment(record.value.id,{name:'PRIVATE_REFERENCE.png',bytes:png()});
 const descriptor=record.value.attachments[0],turn=await f.repository.beginCustomTurn(record.value.id,'PRIVATE_QUESTION');await f.repository.finishCustomTurn(record.value.id,turn.value.task.id,{text:'PRIVATE_REPLY'});
 record=await f.repository.readSession(record.value.id);record=await f.repository.patchSession(record.value.id,{draft:'PRIVATE_DRAFT',attachments:[descriptor],presentation:[{role:'user',text:'PRIVATE_QUESTION',attachments:[descriptor]},{role:'assistant',text:'PRIVATE_REPLY',modelReply:true}],presentationTurnId:turn.value.task.id},record.revision);
 return {...f,role:role.id,id:record.value.id,descriptor};
}
test('portable workspace snapshot restores with a different OS wrapper, preserving roles/history/media as new encrypted copies',async t=>{
 const original=await source(t),target=await fixture(t),prior=await target.repository.createSession({name:'Existing',projectId:'existing-project'});
 await target.repository.patchSession(prior.value.id,{draft:'EXISTING_DRAFT'},prior.revision);
 const oldBytes=await fs.readFile(path.join(target.home,DIRECTORY,prior.value.id+'.json'));
 const snapshot=await original.repository.exportBackup({scope:'all'});assert.equal(snapshot.media.length,1);assert.equal(snapshot.media[0].base64,png().toString('base64'));assert.doesNotMatch(JSON.stringify(snapshot),/wrapped|ciphertext|key\.json/);
 const receipt=await target.repository.importBackup(snapshot);assert.equal(receipt.alreadyImported,false);
 assert.deepEqual(await fs.readFile(path.join(target.home,DIRECTORY,prior.value.id+'.json')),oldBytes);
 const imported=await target.repository.readSession(receipt.sessionIds[0]);assert.notEqual(imported.value.id,original.id);assert.notEqual(imported.value.roleId,original.role);assert.equal(imported.value.projectId,'');assert.equal(imported.value.importedProjectId,'original-project');assert.equal(imported.value.draft,'PRIVATE_DRAFT');assert.equal(imported.value.messages.at(-1).content,'PRIVATE_REPLY');
 const role=await target.repository.readRole(imported.value.roleId);assert.equal(role.configuration.id,imported.value.roleId);assert.equal(role.configuration.model,'manual-model');assert.equal(role.configuration.apiConfigId,'manual-api');assert.equal(role.configuration.memoryApiKey,'PRIVATE_MEM0_KEY');assert.equal(role.configuration.temperature,0);assert.notEqual(imported.value.attachments[0].assetRef,original.descriptor.assetRef);
 const fresh=createAssistantWorkspace({vault:createAssistantWorkspaceVault(target.options)}),turn=await fresh.beginCustomTurn(imported.value.id,'Inspect restored media'),media=await fresh.readTurnAttachments(imported.value.id,turn.value.task.id);assert.deepEqual(Buffer.from(media[0].bytes),png());
 for(const name of await fs.readdir(path.join(target.home,DIRECTORY))){const bytes=await fs.readFile(path.join(target.home,DIRECTORY,name));for(const text of ['PRIVATE_ROLE','PRIVATE_MEM0_KEY','PRIVATE_DRAFT','PRIVATE_REFERENCE.png'])assert.equal(bytes.includes(Buffer.from(text)),false);}
});
test('repeat import is idempotent and never overwrites edited copies',async t=>{
 const original=await source(t),target=await fixture(t),snapshot=await original.repository.exportBackup({scope:'session',id:original.id});
 const receipt=await target.repository.importBackup(snapshot),roleId=receipt.roleIds[0],role=await target.repository.readRole(roleId);await target.repository.patchRole(roleId,{...role.configuration,name:'Edited copy'},role.revision);
 const before=(await target.repository.list()).revision,files=await fs.readdir(path.join(target.home,DIRECTORY));
 const second=await target.repository.importBackup(snapshot);assert.equal(second.alreadyImported,true);assert.deepEqual(second.sessionIds,receipt.sessionIds);assert.equal((await target.repository.readRole(roleId)).configuration.name,'Edited copy');assert.equal((await target.repository.list()).revision,before);assert.deepEqual(await fs.readdir(path.join(target.home,DIRECTORY)),files);
});
test('invalid references, altered bytes and executable presentation fields fail before any destination writes',async t=>{
 const original=await source(t),target=await fixture(t),snapshot=await original.repository.exportBackup(),directory=path.join(target.home,DIRECTORY),before=await fs.readdir(directory);
 for(const mutate of [s=>s.sessions[0].value.attachments[0].assetRef='file:///private/secret',s=>s.media[0].ownerId='session-11111111-1111-4111-8111-111111111111',s=>s.media[0].base64=Buffer.alloc(png().length).toString('base64'),s=>s.sessions[0].value.presentation[1].action='create_image_node',s=>s.media.push(structuredClone(s.media[0])),s=>s.roles[1].configuration.name=123]){
  const bad=structuredClone(snapshot);mutate(bad);await assert.rejects(target.repository.importBackup(bad));assert.deepEqual(await fs.readdir(directory),before);
 }
});
test('catalog publication failure preserves old data, then recovers the same encrypted orphan IDs without duplicates',async t=>{
 const original=await source(t),target=await fixture(t),snapshot=await original.repository.exportBackup();let armed=true;
 const broken=createAssistantWorkspace({vault:{...target.vault,write:async(id,...args)=>{if(armed&&id==='catalog'){armed=false;throw Object.assign(Error(),{code:'SYNTHETIC_DISK_FAILURE'});}return target.vault.write(id,...args);}}});
 const before=await target.repository.list();await assert.rejects(broken.importBackup(snapshot),{code:'SYNTHETIC_DISK_FAILURE'});assert.deepEqual(await target.repository.list(),before);
 const staged=await fs.readdir(path.join(target.home,DIRECTORY));const restored=await target.repository.importBackup(snapshot);assert.equal(restored.alreadyImported,false);assert.deepEqual(await fs.readdir(path.join(target.home,DIRECTORY)),staged);assert.equal((await target.repository.list()).value.sessions.length,1);
});
test('active snapshots are refused, single-session selection excludes other roles, and restored pending tasks never replay',async t=>{
 const f=await source(t),main=await f.repository.createSession({name:'Main'});await f.repository.beginTurn(main.value.id,'pending');
 await assert.rejects(f.repository.exportBackup({scope:'all'}),{code:'ASSISTANT_BUSY'});
 const snapshot=await f.repository.exportBackup({scope:'session',id:f.id});assert.equal(snapshot.sessions.length,1);assert.equal(snapshot.roles.length,1);assert.equal(snapshot.roles[0].id,f.role);
 snapshot.sessions[0].value.task={id:'pending-import',status:'running',startedAt:123,engine:'custom'};
 const target=await fixture(t),receipt=await target.repository.importBackup(snapshot),record=await target.repository.readSession(receipt.sessionIds[0]);assert.equal(record.value.task.status,'interrupted');assert.equal(record.value.task.finishedAt,123);
 await assert.rejects(target.repository.readTurnAttachments(record.value.id,'pending-import'),{code:'ASSISTANT_MEDIA_SCOPE'});
});
test('oversized input fails explicitly rather than exporting a partial snapshot',()=>{
 assert.throws(()=>captureWorkspaceBackup({format:'starcanvas-assistant-workspace',version:1,roles:[],sessions:[],media:[],extra:'x'.repeat(MAX_BACKUP)},DEFAULT_ROLE),{code:'ASSISTANT_BACKUP_LIMIT'});
});
test('imported historical local receipts become unverified quotes, not current-device execution evidence',async t=>{
 const original=await source(t),snapshot=await original.repository.exportBackup();
 snapshot.sessions[0].value.presentation.push({role:'assistant',text:'Historical setting changed',executionStatus:'confirmed'});
 const target=await fixture(t),receipt=await target.repository.importBackup(snapshot),record=await target.repository.readSession(receipt.sessionIds[0]);
 assert.equal(record.value.presentation.at(-1).text,'Historical setting changed');assert.equal(record.value.presentation.at(-1).modelReply,true);assert.equal(record.value.presentation.at(-1).executionStatus,undefined);
});
