// Portable logical snapshots, never device key files. Only the renderer's
// password-encrypted export path may write these to disk. Import publishes new
// encrypted IDs and never overwrites an existing role/conversation.
const {createHash}=require('node:crypto');
const {MAX_DOCUMENT}=require('./assistant-workspace-vault.cjs');
const {captureMedia,validDescriptor}=require('./assistant-workspace-media.cjs');
const {captureAssistantGenerationTask}=require('../shared/assistant-generation-task.mjs');
const FORMAT='starcanvas-assistant-workspace',MAX_BACKUP=64*1024*1024;
const SESSION=/^session-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROLE=/^role-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=code=>Object.assign(new Error(code),{code});
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!value.includes('\0');
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const fingerprint=item=>JSON.stringify([item.id,item.assetRef,item.name,item.type,item.mime,item.size,item.sha256]);
function references(value){return [...value.attachments,...value.messages.flatMap(item=>item.attachments||[]),...(value.presentation||[]).flatMap(item=>item.attachments||[])];}
function captureWorkspaceBackup(input,defaultRole){
  let serialized,captured;
  try{serialized=JSON.stringify(input);if(!serialized||Buffer.byteLength(serialized)>MAX_BACKUP)throw fail('ASSISTANT_BACKUP_LIMIT');captured=JSON.parse(serialized);}
  catch(error){throw error?.code==='ASSISTANT_BACKUP_LIMIT'?error:fail('ASSISTANT_BACKUP_INVALID');}
  if(!keys(captured,['format','version','roles','sessions','media'])||captured.format!==FORMAT||captured.version!==1||!Array.isArray(captured.roles)||!Array.isArray(captured.sessions)||!Array.isArray(captured.media)||captured.roles.length>200||captured.sessions.length>1000||captured.media.length>12000)throw fail('ASSISTANT_BACKUP_INVALID');
  const roles=new Map(),sessions=new Map(),media=new Map();
  for(const role of captured.roles){
    if(!keys(role,['id','configuration','archived'])||!ROLE.test(role.id)||roles.has(role.id)||typeof role.archived!=='boolean')throw fail('ASSISTANT_BACKUP_INVALID');
    if(role.id===defaultRole){if(role.configuration!==null)throw fail('ASSISTANT_BACKUP_INVALID');}
    else if(!object(role.configuration)||!text(role.configuration.name,120)||Buffer.byteLength(JSON.stringify(role.configuration))>MAX_DOCUMENT-8192)throw fail('ASSISTANT_BACKUP_INVALID');
    roles.set(role.id,role);
  }
  for(const session of captured.sessions){
    const value=session?.value,descriptor=session?.descriptor;
    if(!keys(session,['descriptor','value'])||!keys(descriptor,['name','archived'])||!text(descriptor.name,120)||typeof descriptor.archived!=='boolean'||!object(value)||value.version!==1||!SESSION.test(value.id)||sessions.has(value.id)||!roles.has(value.roleId)||!text(value.projectId,200)||!text(value.draft,16000)||!Array.isArray(value.attachments)||!Array.isArray(value.messages)||value.messages.length>2000||!Array.isArray(value.presentation||[])||(value.presentation||[]).length>2000||!object(value.task)||!['idle','queued','running','completed','failed','cancelled','interrupted'].includes(value.task.status)||Buffer.byteLength(JSON.stringify(value))>MAX_DOCUMENT-8192)throw fail('ASSISTANT_BACKUP_INVALID');
    if(!keys(value,['version','id','roleId','projectId','draft','attachments','messages','presentation','presentationTurnId','task','legacyId','legacySourceHash','legacySnapshot','importSourceHash','importSourceId','importedProjectId']))throw fail('ASSISTANT_BACKUP_INVALID');
    if(value.attachments.length>6||value.attachments.reduce((sum,item)=>sum+(item?.size||0),0)>96*1024*1024)throw fail('ASSISTANT_BACKUP_INVALID');
    if(!keys(value.task,['id','status','engine','roleRevision','startedAt','finishedAt','code','contextTruncated'])||(value.task.status!=='idle'&&!text(value.task.id,100))||(value.presentationTurnId!==undefined&&!text(value.presentationTurnId,100)))throw fail('ASSISTANT_BACKUP_INVALID');
    for(const message of value.messages){
      if(!keys(message,['id','turnId','role','content','createdAt','failed','attachments'])||!text(message.id,100)||!text(message.turnId,100)||!['user','assistant'].includes(message.role)||!text(message.content,200000)||!Number.isFinite(message.createdAt)||(message.failed!==undefined&&typeof message.failed!=='boolean')||(message.attachments!==undefined&&(!Array.isArray(message.attachments)||message.attachments.length>6)))throw fail('ASSISTANT_BACKUP_INVALID');
    }
    for(const message of value.presentation||[]){
      if(!keys(message,['role','text','modelReply','incomplete','proposalExpired','executionStatus','attachments','generationTask'])||!['user','assistant','notice'].includes(message.role)||!text(message.text,200000)||(message.attachments!==undefined&&(!Array.isArray(message.attachments)||message.attachments.length>6)))throw fail('ASSISTANT_BACKUP_INVALID');
      if(['modelReply','proposalExpired'].some(key=>message[key]!==undefined&&typeof message[key]!=='boolean')||(message.executionStatus!==undefined&&!['confirmed','unconfirmed','rejected'].includes(message.executionStatus)))throw fail('ASSISTANT_BACKUP_INVALID');
      if(message.incomplete!==undefined&&(message.incomplete!==true||message.role!=='assistant'||message.modelReply!==true||message.executionStatus))throw fail('ASSISTANT_BACKUP_INVALID');
      if(message.generationTask!==undefined){try{captureAssistantGenerationTask(message.generationTask);if(message.role!=='assistant'||message.modelReply||message.proposalExpired||message.executionStatus!=='confirmed')throw Error();}catch{throw fail('ASSISTANT_BACKUP_INVALID');}}
    }
    if(references(value).some(item=>!validDescriptor(item)))throw fail('ASSISTANT_BACKUP_INVALID');
    sessions.set(value.id,session);
  }
  for(const item of captured.media){
    if(!keys(item,['ownerId','descriptor','base64'])||!sessions.has(item.ownerId)||!validDescriptor(item.descriptor)||typeof item.base64!=='string'||item.base64.length!==4*Math.ceil(item.descriptor.size/3)||!/^[A-Za-z0-9+/]+={0,2}$/.test(item.base64))throw fail('ASSISTANT_BACKUP_INVALID');
    const key=item.ownerId+':'+item.descriptor.id;if(media.has(key))throw fail('ASSISTANT_BACKUP_INVALID');
    const bytes=Buffer.from(item.base64,'base64');if(bytes.toString('base64')!==item.base64)throw fail('ASSISTANT_BACKUP_INVALID');
    const actual=captureMedia({name:item.descriptor.name,bytes});
    if(actual.size!==item.descriptor.size||actual.sha256!==item.descriptor.sha256||actual.type!==item.descriptor.type||actual.mime!==item.descriptor.mime)throw fail('ASSISTANT_BACKUP_INVALID');
    media.set(key,item);
  }
  const used=new Set();
  for(const [ownerId,session]of sessions)for(const ref of references(session.value)){
    const key=ownerId+':'+ref.id,entry=media.get(key);
    if(!entry||fingerprint(entry.descriptor)!==fingerprint(ref))throw fail('ASSISTANT_BACKUP_INVALID');used.add(key);
  }
  if(used.size!==media.size)throw fail('ASSISTANT_BACKUP_INVALID');
  return {value:captured,hash:createHash('sha256').update(serialized).digest('hex')};
}
module.exports={FORMAT,MAX_BACKUP,references,captureWorkspaceBackup};
