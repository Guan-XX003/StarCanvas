const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createAssistantWorkspaceVault,DIRECTORY,MAX_MEDIA}=require('../electron/main/assistant-workspace-vault.cjs');
const {createAssistantWorkspace}=require('../electron/main/assistant-workspace.cjs');
const {captureMedia}=require('../electron/main/assistant-workspace-media.cjs');
const png=()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13]),Buffer.from('IHDR'),Buffer.alloc(12),Buffer.from('PRIVATE_SYNTHETIC_MEDIA')]);
async function fixture(t){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-workspace-media-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const options={userDataPath:home,encrypt:async value=>'TEST_WRAPPED_'+Buffer.from(value).toString('hex'),decrypt:async value=>Buffer.from(value.slice(13),'hex').toString()};
  const vault=createAssistantWorkspaceVault(options),repository=createAssistantWorkspace({vault});
  const role=await repository.createRole({name:'Media role',model:'synthetic-vision',apiConfigId:'synthetic'});
  const a=await repository.createSession({roleId:role.id}),b=await repository.createSession({roleId:role.id});
  return {home,options,vault,repository,a:a.value.id,b:b.value.id,role:role.id};
}
test('binary media is encrypted, immutable and authenticated to the owning session',async t=>{
  const f=await fixture(t),id='asset-'+crypto.randomUUID(),bytes=png();
  await f.vault.writeMedia(f.a,id,bytes);
  const file=path.join(f.home,DIRECTORY,id+'.bin'),cipher=await fs.readFile(file);
  assert.equal(cipher.includes(Buffer.from('PRIVATE_SYNTHETIC_MEDIA')),false);
  const reopened=createAssistantWorkspaceVault(f.options);assert.deepEqual(await reopened.readMedia(f.a,id),bytes);
  await assert.rejects(reopened.readMedia(f.b,id),{code:'ASSISTANT_MEDIA_CORRUPT'});
  await assert.rejects(reopened.writeMedia(f.a,id,bytes),{code:'EEXIST'});assert.deepEqual(await fs.readFile(file),cipher);
  const changed=Buffer.from(cipher);changed[changed.length-1]^=1;await fs.writeFile(file,changed);
  await assert.rejects(reopened.readMedia(f.a,id),{code:'ASSISTANT_MEDIA_CORRUPT'});
});
test('attachment bytes and metadata survive repository restart; turn leases cannot cross scopes',async t=>{
  const f=await fixture(t),saved=await f.repository.addAttachment(f.a,{name:'private-reference.png',bytes:png()});
  const descriptor=saved.value.attachments[0];assert.equal(descriptor.mime,'image/png');assert.equal(descriptor.assetRef,descriptor.id);
  const restarted=createAssistantWorkspace({vault:createAssistantWorkspaceVault(f.options)});
  const record=await restarted.readSession(f.a);assert.deepEqual(record.value.attachments,[descriptor]);
  const other=await restarted.readSession(f.b);
  await assert.rejects(restarted.patchSession(f.b,{attachments:[descriptor]},other.revision),{code:'ASSISTANT_MEDIA_SCOPE'});
  const turn=await restarted.beginCustomTurn(f.a,'Inspect media');
  assert.deepEqual(turn.value.messages.at(-1).attachments,[descriptor]);
  const media=await restarted.readTurnAttachments(f.a,turn.value.task.id);assert.deepEqual(Buffer.from(media[0].bytes),png());
  await assert.rejects(restarted.readTurnAttachments(f.b,turn.value.task.id),{code:'ASSISTANT_MEDIA_SCOPE'});
  await assert.rejects(restarted.readTurnAttachments(f.a,'wrong-turn'),{code:'ASSISTANT_MEDIA_SCOPE'});
  await restarted.finishCustomTurn(f.a,turn.value.task.id,{text:'Synthetic reply'});
  await assert.rejects(restarted.readTurnAttachments(f.a,turn.value.task.id),{code:'ASSISTANT_MEDIA_SCOPE'});
  const done=await restarted.readSession(f.a);assert.deepEqual(done.value.attachments,[]);assert.deepEqual(done.value.messages[0].attachments,[descriptor]);
  await restarted.patchSession(f.a,{attachments:[descriptor]},done.revision);
  assert.equal((await restarted.readSession(f.a)).value.attachments.length,1);
  for(const name of await fs.readdir(path.join(f.home,DIRECTORY))){const bytes=await fs.readFile(path.join(f.home,DIRECTORY,name));assert.equal(bytes.includes(Buffer.from('private-reference.png')),false);assert.equal(bytes.includes(Buffer.from('PRIVATE_SYNTHETIC_MEDIA')),false);}
});
test('failed and interrupted turns retain draft attachments but never acquire a new live lease',async t=>{
  const f=await fixture(t);await f.repository.addAttachment(f.a,{name:'reference.png',bytes:png()});
  let turn=await f.repository.beginCustomTurn(f.a,'first');await f.repository.finishCustomTurn(f.a,turn.value.task.id,{code:'ASSISTANT_PROVIDER_REQUEST'});
  assert.equal((await f.repository.readSession(f.a)).value.attachments.length,1);
  turn=await f.repository.beginCustomTurn(f.a,'second');await f.repository.recoverInterrupted();
  assert.equal((await f.repository.readSession(f.a)).value.task.status,'interrupted');
  assert.equal((await f.repository.readSession(f.a)).value.attachments.length,1);
  await assert.rejects(f.repository.readTurnAttachments(f.a,turn.value.task.id),{code:'ASSISTANT_MEDIA_SCOPE'});
});
test('unsupported formats, traversal, over-limit media and busy/default sessions fail closed',async t=>{
  const f=await fixture(t);
  for(const name of ['../escape.png','C:\\secret.png','bad\0name.png'])await assert.rejects(f.repository.addAttachment(f.a,{name,bytes:png()}),{code:'ASSISTANT_MEDIA_INVALID'});
  await assert.rejects(f.repository.addAttachment(f.a,{name:'fake.png',bytes:Buffer.from('not an image')}),{code:'ASSISTANT_MEDIA_UNSUPPORTED'});
  await assert.rejects(f.repository.addAttachment(f.a,{name:'x.png',bytes:new Uint8Array(MAX_MEDIA+1)}),{code:'ASSISTANT_MEDIA_LIMIT'});
  await assert.rejects(f.repository.addAttachment(f.a,{name:'x.png',bytes:'file:///secret'}),{code:'ASSISTANT_MEDIA_INVALID'});
  const main=await f.repository.createSession();await assert.rejects(f.repository.addAttachment(main.value.id,{name:'x.png',bytes:png()}),{code:'ASSISTANT_ATTACHMENT_UNSUPPORTED'});
  await f.repository.beginCustomTurn(f.a,'busy');await assert.rejects(f.repository.addAttachment(f.a,{name:'x.png',bytes:png()}),{code:'ASSISTANT_BUSY'});
  for(let index=0;index<6;index++)await f.repository.addAttachment(f.b,{name:`x${index}.png`,bytes:png()});
  await assert.rejects(f.repository.addAttachment(f.b,{name:'seventh.png',bytes:png()}),{code:'ASSISTANT_MEDIA_LIMIT'});
  assert.equal((await f.repository.readSession(f.b)).value.attachments.length,6);
});
test('media type is derived from bytes rather than renderer MIME or misleading extension',()=>{
  assert.equal(captureMedia({name:'wrong.mp4',mime:'video/mp4',bytes:png()}).mime,'image/png');
  const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(12)]);
  assert.equal(captureMedia({name:'reference.mp4',bytes:mp4}).mime,'video/mp4');
  const avif=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypavif'),Buffer.alloc(12)]);
  assert.throws(()=>captureMedia({name:'unsupported.avif',bytes:avif}),{code:'ASSISTANT_MEDIA_UNSUPPORTED'});
});
test('failed document publication retains only encrypted orphan media; no guessed reference grants access',async t=>{
  const f=await fixture(t);let armed=true;
  const broken=createAssistantWorkspace({vault:{...f.vault,write:async(id,...args)=>{if(armed&&id===f.a){armed=false;throw Object.assign(Error(),{code:'SYNTHETIC_DISK_FAILURE'});}return f.vault.write(id,...args);}}});
  await assert.rejects(broken.addAttachment(f.a,{name:'reference.png',bytes:png()}),{code:'SYNTHETIC_DISK_FAILURE'});
  assert.deepEqual((await f.repository.readSession(f.a)).value.attachments,[]);
  const files=(await fs.readdir(path.join(f.home,DIRECTORY))).filter(name=>name.endsWith('.bin'));assert.equal(files.length,1);
  const turn=await f.repository.beginCustomTurn(f.a,'empty');assert.deepEqual(await f.repository.readTurnAttachments(f.a,turn.value.task.id),[]);
});
test('missing key or symbolic binary paths do not reset, leak, or read outside the vault',async t=>{
  const f=await fixture(t),id='asset-'+crypto.randomUUID();
  await fs.symlink(path.join(f.home,'outside'),path.join(f.home,DIRECTORY,id+'.bin'));
  await assert.rejects(f.vault.readMedia(f.a,id),{code:'ASSISTANT_WORKSPACE_UNSAFE_PATH'});
  const saved=await f.repository.addAttachment(f.a,{name:'x.png',bytes:png()}),ref=saved.value.attachments[0].id;
  await fs.unlink(path.join(f.home,DIRECTORY,'key.json'));
  await assert.rejects(createAssistantWorkspaceVault(f.options).readMedia(f.a,ref),{code:'ASSISTANT_WORKSPACE_KEY_MISSING'});
});
test('preview reads only bound current/history bytes, not orphan assets or another conversation; creates no send lease',async t=>{
 const f=await fixture(t),saved=await f.repository.addAttachment(f.a,{name:'preview.png',bytes:png()}),item=saved.value.attachments[0];
 const before=await f.repository.readSession(f.a),catalogBefore=await f.repository.list();
 assert.deepEqual(Buffer.from((await f.repository.previewAttachment(f.a,item.id)).bytes),png());
 await assert.rejects(f.repository.previewAttachment(f.b,item.id),{code:'ASSISTANT_MEDIA_SCOPE'});
 await assert.rejects(f.repository.previewAttachment(f.a,'file:///secret'),{code:'ASSISTANT_MEDIA_SCOPE'});
 const orphan='asset-'+crypto.randomUUID();await f.vault.writeMedia(f.a,orphan,png());await assert.rejects(f.repository.previewAttachment(f.a,orphan),{code:'ASSISTANT_MEDIA_SCOPE'});
 assert.deepEqual(await f.repository.readSession(f.a),before);assert.deepEqual(await f.repository.list(),catalogBefore);
 await f.repository.patchSession(f.a,{attachments:[]},before.revision);await assert.rejects(f.repository.previewAttachment(f.a,item.id),{code:'ASSISTANT_MEDIA_SCOPE'});
 const again=await f.repository.readSession(f.a);await f.repository.addAttachment(f.a,{name:'history.png',bytes:png()});
 const turn=await f.repository.beginCustomTurn(f.a,'Inspect'),historical=turn.value.messages.at(-1).attachments[0];await f.repository.finishCustomTurn(f.a,turn.value.task.id,{text:'Done'});
 await f.repository.changeSession(f.a,{archived:true},(await f.repository.list()).revision);
 const archived=await f.repository.readSession(f.a);assert.deepEqual(Buffer.from((await f.repository.previewAttachment(f.a,historical.id)).bytes),png());assert.deepEqual(await f.repository.readSession(f.a),archived);
 await assert.rejects(f.repository.readTurnAttachments(f.a,turn.value.task.id),{code:'ASSISTANT_MEDIA_SCOPE'});
});
test('preview rechecks content type/hash and bounds concurrent reads without changing source records',async t=>{
 const f=await fixture(t),saved=await f.repository.addAttachment(f.a,{name:'reference.png',bytes:png()}),item=saved.value.attachments[0];let release,entered;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const repository=createAssistantWorkspace({vault:{...f.vault,readMedia:async(...args)=>{entered();await gate;return f.vault.readMedia(...args);}}});
 const pending=repository.previewAttachment(f.a,item.id);await started;await assert.rejects(repository.previewAttachment(f.a,item.id),{code:'ASSISTANT_BUSY'});release();assert.equal((await pending).id,item.id);
 const record=await f.vault.read(f.a);record.value.attachments[0].mime='image/gif';await f.vault.write(f.a,record.value,record.revision);
 await assert.rejects(f.repository.previewAttachment(f.a,item.id),{code:'ASSISTANT_MEDIA_CORRUPT'});
 const changed=await f.vault.read(f.a);changed.value.attachments[0].mime='image/png';await f.vault.write(f.a,changed.value,changed.revision);
 const file=path.join(f.home,DIRECTORY,item.id+'.bin'),bytes=await fs.readFile(file);bytes[bytes.length-1]^=1;await fs.writeFile(file,bytes);
 await assert.rejects(f.repository.previewAttachment(f.a,item.id),{code:'ASSISTANT_MEDIA_CORRUPT'});
});
