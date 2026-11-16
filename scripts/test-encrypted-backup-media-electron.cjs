// End-to-end main-process backup/save/chooser flow using only synthetic files.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {app,ipcMain,dialog}=require('electron');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-encrypted-media-'));
fs.mkdirSync(path.join(root,'user-data'));app.setPath('userData',path.join(root,'user-data'));
app.whenReady().then(async()=>{
 const handlers=new Map(),originalHandle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(name,handler)=>handlers.set(name,handler);
 try {
  const {setDesktopBaseUrl}=require('../electron/main/runtime-state.cjs');setDesktopBaseUrl('http://127.0.0.1:42111');
  const targetDir=path.join(root,'new-backup'),targetJson=path.join(targetDir,'sample-encrypted.json');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:targetDir});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[targetJson]});
  require('../electron/main/ipc.cjs').registerDesktopIpc();
  const sourceDir=path.join(root,'synthetic-private-source');fs.mkdirSync(sourceDir);const sourceFile=path.join(sourceDir,'image.png');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');fs.writeFileSync(sourceFile,png);
  const pass='synthetic-passphrase-2026',salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.pbkdf2Sync(pass,salt,600000,32,'sha256');
  const body={modules:{projects:{externalAssetBundle:{folderName:'sample-encrypted-external-assets'},localforage:{canvasStates:{fixture:{nodes:[],edges:[]}},assets:{}}}}};
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('starcanvas-encrypted-backup:v1:PBKDF2-SHA256:600000:AES-256-GCM'));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(body),'utf8'),cipher.final(),cipher.getAuthTag()]);
  const text=JSON.stringify({format:'starcanvas-encrypted-backup',version:1,kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:salt.toString('base64'),iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64')});
  const event={senderFrame:{url:'http://127.0.0.1:42111/index.html'}},save=handlers.get('wanjuan:save-download'),open=handlers.get('wanjuan:choose-backup-file');assert.ok(save&&open);
  const result=await save(event,{encryptedBackup:true,saveAsFolder:true,text,mime:'application/json',filename:'sample-encrypted.json',folderName:'sample-encrypted',directory:root,externalAssetFolderName:'sample-encrypted-external-assets',externalAssetFiles:[{projectId:'fixture',nodeId:'node',field:'imageUrl',assetId:'asset',kind:'image',mime:'image/png',path:sourceFile}]});
  assert.equal(result.ok,true);assert.equal(fs.readFileSync(targetJson,'utf8'),text);
  const opened=await open(event,{});assert.equal(opened.ok,true);assert.equal(opened.content,text);assert.equal(opened.externalAssetBundle.files.length,1);
  const media=opened.externalAssetBundle.files[0];assert.ok(media.filePath);assert.deepEqual(fs.readFileSync(media.filePath),png);
  const manifestText=fs.readFileSync(path.join(targetDir,'sample-encrypted-external-assets','wanjuan-external-assets-manifest.json'),'utf8');assert.equal(manifestText.includes(sourceFile),false);
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from('starcanvas-encrypted-backup:v1:PBKDF2-SHA256:600000:AES-256-GCM'));decipher.setAuthTag(ciphertext.subarray(-16));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]).toString('utf8')),body);
  console.log('PASS_ENCRYPTED_BACKUP_MEDIA_MAIN_PROCESS');
 } finally {ipcMain.handle=originalHandle;fs.rmSync(root,{recursive:true,force:true});}
}).then(()=>app.quit()).catch(error=>{console.error(error.code||error.message);app.exit(1)});
