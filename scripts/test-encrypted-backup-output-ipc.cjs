const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-encrypted-output-test-'));
const handlers=new Map();let selected='',dialogs=0,buffers=0,injects=0,conflict=false;
const original=Module._load;
Module._load=function(name,parent,...rest){
 if(parent?.filename.endsWith(`${path.sep}ipc.cjs`)) {
  if(name==='./electron-refs.cjs')return {ipcMain:{handle:(n,fn)=>handlers.set(n,fn),on:()=>{}},dialog:{showSaveDialog:async()=>{dialogs++;return {canceled:false,filePath:selected}}}};
  if(name==='./runtime-state.cjs')return {getDesktopBaseUrl:()=> 'http://127.0.0.1:42111'};
  if(name==='./logging.cjs')return {appendDesktopLog:()=>{},formatErrorMessage:()=>''};
  if(name==='./encrypted-backup-output.cjs')return original.apply(this,[name,parent,...rest]);
  if(name==='./utils/paths.cjs')return {sanitizeFilename:s=>String(s||''),resolveWritableDownloadDirectory:()=>({directory:root})};
  if(name==='./utils/mime.cjs')return {extensionFromMime:()=>'.json'};
  if(name==='./media/payload.cjs')return {bufferFromDownloadPayload:async p=>{buffers++;return {buffer:Buffer.from(p.text),mime:p.mime}}};
  if(name==='./assets/project-assets.cjs')return {validateExternalProjectAssetFiles:()=>({ok:true}),copyExternalProjectAssetFiles:(target,assets,folder)=>{
   if(!assets.length)return null;const actual=folder+(conflict?'-1':''),folderPath=path.join(path.dirname(target),actual);fs.mkdirSync(folderPath);fs.writeFileSync(path.join(folderPath,'fixture.bin'),'synthetic');return {folderName:actual,folderPath,createdByOperation:true,copied:assets.length,failed:0};
  },injectExternalAssetBundleSummary:()=>{injects++;return null}};
  if(name.startsWith('./'))return new Proxy({}, {get:()=>()=>{}});
 }
 return original.apply(this,[name,parent,...rest]);
};
const {registerDesktopIpc}=require('../electron/main/ipc.cjs');registerDesktopIpc();Module._load=original;
const invoke=handlers.get('wanjuan:save-download'),trusted={senderFrame:{url:'http://127.0.0.1:42111/index.html'}};
const b64=n=>Buffer.alloc(n,7).toString('base64');
const envelope=JSON.stringify({format:'starcanvas-encrypted-backup',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(16),iv:b64(12),ciphertext:b64(17)});
const payload={encryptedBackup:true,saveAsFolder:true,text:envelope,mime:'application/json',filename:'backup.json',folderName:'backup',externalAssetFolderName:'backup-external-assets'};
(async()=>{try{
 assert.ok(invoke);
 assert.deepEqual(await invoke(trusted,{...payload,text:'{"plain":"SYNTHETIC_PRIVATE"}'}),{ok:false,code:'BACKUP_ENCRYPTED_OUTPUT_INVALID'});
 assert.equal(buffers,0);assert.equal(dialogs,0,'plaintext is rejected before file chooser and payload processing');
 selected=path.join(root,'existing');fs.mkdirSync(selected);fs.writeFileSync(path.join(selected,'sentinel'),'unchanged');
 assert.deepEqual(await invoke(trusted,payload),{ok:false,code:'BACKUP_FOLDER_EXISTS'});assert.equal(fs.readFileSync(path.join(selected,'sentinel'),'utf8'),'unchanged');
 selected=path.join(root,'new');let result=await invoke(trusted,{...payload,buffer:'SYNTHETIC_PLAINTEXT',url:'https://unexpected.invalid/'});assert.equal(result.ok,true);assert.equal(fs.readFileSync(path.join(selected,'backup.json'),'utf8'),envelope);assert.equal(injects,0,'main process must not rewrite authenticated JSON');assert.equal(buffers,0,'encrypted writes ignore other payload fields and never fetch a URL');
 selected=path.join(root,'with-media');result=await invoke(trusted,{...payload,externalAssetFiles:[{id:'synthetic'}]});assert.equal(result.ok,true);assert.ok(fs.existsSync(path.join(selected,'backup-external-assets','fixture.bin')));assert.equal(fs.readFileSync(path.join(selected,'backup.json'),'utf8'),envelope);
 selected=path.join(root,'invalid-assets');result=await invoke(trusted,{...payload,externalAssetFiles:[{id:'synthetic'}],externalAssetFolderName:'wrong'});assert.equal(result.code,'BACKUP_ASSET_FOLDER_INVALID');assert.equal(fs.existsSync(path.join(selected,'backup.json')),false);
 selected=path.join(root,'conflict');conflict=true;result=await invoke(trusted,{...payload,externalAssetFiles:[{id:'synthetic'}]});assert.equal(result.code,'BACKUP_ASSET_FOLDER_CONFLICT');assert.equal(fs.existsSync(path.join(selected,'backup.json')),false);
 assert.equal((await invoke({senderFrame:{url:'https://untrusted.invalid/'}},payload)).ok,false);
 console.log('PASS_ENCRYPTED_BACKUP_OUTPUT_IPC');
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(error=>{console.error(error);process.exitCode=1});
