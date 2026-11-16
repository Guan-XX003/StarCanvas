import {encryptPortableBackup,decryptPortableBackup,isEncryptedPortableBackup} from './portable-backup-crypto';
import type {AssistantWorkspaceClient} from './assistant-workspace-client';
type Bridge=Record<string,(...args:any[])=>Promise<any>>;
const failure=(code:string)=>Object.assign(new Error(code),{code});
export function assistantBackupCopy(language:string){
  return language==='en-US'?{
    title:'Workbench backup',all:'Encrypt and back up all',current:'Back up this conversation',import:'Import encrypted backup',cancel:'Cancel',continue:'Continue',password:'Backup password',repeat:'Confirm backup password',enter:'Enter the backup password',hint:'Includes local roles, conversations and attachments, including private role settings. Main-assistant login credentials and remote memory data are not included; manual API configurations are backed up separately. Maximum encrypted content: 64 MiB including encoded media. Import creates copies and does not overwrite existing records or automatically bind projects.',passwordHint:'Use at least 12 characters. Losing the password makes this backup unrecoverable.',repeatHint:'Enter the same password again.',importHint:'Only password-encrypted workbench backups are accepted.',confirm:'Import as new conversations',confirmHint:'This creates encrypted local copies. Existing data stays unchanged. Restored conversations are not bound to a project, and no model requests or interrupted tasks will be restarted.',working:'Processing encrypted backup…',exported:'Encrypted backup saved.',imported:'Backup imported as local copies.',duplicate:'This backup was already imported. Edited copies were not overwritten.',failed:'Backup operation failed. Existing records are unchanged.',limit:'Backup exceeds the 64 MiB content limit. Export a smaller conversation; nothing was omitted or exported.',busy:'Wait for the affected tasks or attachment imports to finish.',invalid:'Invalid or unsupported workbench backup. Existing records are unchanged.',encryption:'Plaintext imports are not accepted. Select a password-encrypted workbench backup.',counts:(roles:number,sessions:number,media:number)=>`${roles} roles · ${sessions} conversations · ${media} attachments`,
  }:language==='zh-TW'?{
    title:'工作台備份',all:'加密備份全部',current:'備份目前對話',import:'匯入加密備份',cancel:'取消',continue:'繼續',password:'備份密碼',repeat:'確認備份密碼',enter:'輸入備份密碼',hint:'包含本機角色、對話、附件及角色私密設定；不含主助手登入憑證與遠端記憶資料，手動 API 設定需另行備份。包含媒體編碼的內容上限為 64 MiB。匯入會建立副本，不覆蓋現有紀錄，也不自動綁定專案。',passwordHint:'請使用至少 12 個字元。遺失密碼將無法還原此備份。',repeatHint:'請再次輸入相同密碼。',importHint:'僅接受密碼加密的工作台備份。',confirm:'匯入為新對話',confirmHint:'將建立本機加密副本，不更動現有資料。還原的對話不綁定專案，不會自動請求模型或重啟中斷的任務。',working:'正在處理加密備份…',exported:'已儲存加密備份。',imported:'已匯入為本機副本。',duplicate:'此備份先前已匯入，不會覆蓋已編輯的副本。',failed:'備份操作失敗，現有紀錄未更動。',limit:'備份內容超過 64 MiB，請改選較小的對話；沒有省略或匯出資料。',busy:'請等待相關任務或附件匯入完成。',invalid:'工作台備份無效或版本不支援，現有紀錄未更動。',encryption:'不接受明文匯入，請選擇密碼加密的工作台備份。',counts:(roles:number,sessions:number,media:number)=>`${roles} 個角色 · ${sessions} 個對話 · ${media} 個附件`,
  }:{
    title:'工作台备份',all:'加密备份全部',current:'备份当前会话',import:'导入加密备份',cancel:'取消',continue:'继续',password:'备份密码',repeat:'确认备份密码',enter:'输入备份密码',hint:'包含本地角色、会话、附件及角色私密设置；不含主助手登录凭据和远程记忆数据，手动 API 配置需另行备份。包含媒体编码的内容上限为 64 MiB。导入会创建副本，不覆盖现有记录，也不自动绑定项目。',passwordHint:'请使用至少 12 个字符。丢失密码将无法恢复此备份。',repeatHint:'请再次输入相同密码。',importHint:'只接受密码加密的工作台备份。',confirm:'导入为新会话',confirmHint:'将创建本地加密副本，不改动现有数据。恢复的会话不绑定项目，不会自动请求模型或重启中断的任务。',working:'正在处理加密备份…',exported:'已保存加密备份。',imported:'已导入为本地副本。',duplicate:'此备份之前已导入，不会覆盖已编辑的副本。',failed:'备份操作失败，现有记录未改动。',limit:'备份内容超过 64 MiB，请改选较小的会话；没有省略或导出数据。',busy:'请等待相关任务或附件导入完成。',invalid:'工作台备份无效或版本不支持，现有记录未改动。',encryption:'不接受明文导入，请选择密码加密的工作台备份。',counts:(roles:number,sessions:number,media:number)=>`${roles} 个角色 · ${sessions} 个会话 · ${media} 个附件`,
  };
}
async function promptPassword(bridge:Bridge,language:string,title:string,message:string){
  if(typeof bridge?.showInputDialog!=='function')throw failure('BACKUP_PASSWORD_UI_UNAVAILABLE');
  const copy=assistantBackupCopy(language);
  const result=await bridge.showInputDialog({password:true,title,message,cancelLabel:copy.cancel,confirmLabel:copy.continue});
  if(result===null)return null;if(typeof result!=='string')throw failure('BACKUP_PASSWORD_UI_UNAVAILABLE');return result;
}
export async function exportAssistantWorkspace(controller:AssistantWorkspaceClient,bridge:Bridge,scope:'all'|'session',language:string){
  const copy=assistantBackupCopy(language);
  let password=await promptPassword(bridge,language,copy.password,copy.passwordHint);
  if(password===null)return {cancelled:true};
  try{
    const confirmation=await promptPassword(bridge,language,copy.repeat,copy.repeatHint);
    if(confirmation===null)return {cancelled:true};
    if(password!==confirmation)throw failure('BACKUP_PASSWORD_MISMATCH');
    if(password.trim().length<12||new TextEncoder().encode(password).length>1024)throw failure('BACKUP_PASSWORD_INVALID');
    const snapshot=await controller.exportBackup(scope),envelope=await encryptPortableBackup(snapshot,password);
    const filename=`starcanvas-workbench-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}-${crypto.randomUUID().slice(0,8)}-encrypted.json`;
    if(typeof bridge.saveDownload!=='function')throw failure('BACKUP_SAVE_FAILED');
    const result=await bridge.saveDownload({text:JSON.stringify(envelope),mime:'application/json',filename,saveAsFolder:true,folderName:filename.replace(/\.json$/,''),encryptedBackup:true});
    if(result?.canceled)return {cancelled:true};if(!result?.ok)throw failure(result?.code==='BACKUP_FOLDER_EXISTS'?'BACKUP_FOLDER_EXISTS':'BACKUP_SAVE_FAILED');
    return {cancelled:false};
  }finally{password='';}
}
export async function readAssistantWorkspaceBackup(file:File,bridge:Bridge,language:string){
  if(!file.size||file.size>90*1024*1024)throw failure('ASSISTANT_BACKUP_LIMIT');
  let envelope;try{envelope=JSON.parse(await file.text());}catch{throw failure('ASSISTANT_BACKUP_INVALID');}
  if(!isEncryptedPortableBackup(envelope))throw failure('ASSISTANT_BACKUP_ENCRYPTION_REQUIRED');
  const copy=assistantBackupCopy(language);let password=await promptPassword(bridge,language,copy.enter,copy.importHint);
  if(password===null)return null;
  try{
    const snapshot:any=await decryptPortableBackup(envelope,password);
    if(snapshot.format!=='starcanvas-assistant-workspace'||snapshot.version!==1||!Array.isArray(snapshot.roles)||snapshot.roles.length>200||!Array.isArray(snapshot.sessions)||snapshot.sessions.length>1000||!Array.isArray(snapshot.media)||snapshot.media.length>12000)throw failure('ASSISTANT_BACKUP_INVALID');
    return snapshot;
  }finally{password='';}
}
