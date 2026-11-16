const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const {webcrypto}=require('node:crypto');
global.crypto=webcrypto;
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
require.extensions['.tsx']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {use_$t}=require('../src/renderer/hooks/use_$t.ts');
const {decryptPortableBackup}=require('../src/renderer/lib/portable-backup-crypto.ts');
const {isEncryptedBackupOutput}=require('../electron/main/encrypted-backup-output.cjs');
const {WanJuanBackupDialog}=require('../src/renderer/components/backup-dialog.tsx');
const password='synthetic-password-long';
const source={modules:{projects:{localforage:{
 canvasStates:{fixture:{nodes:[{id:'synthetic',data:{config:{apiKey:'SYNTHETIC_PRIVATE_KEY'}}}],edges:[]}},
 assets:{}
}}}};
function environment(answers, saved={ok:true}, assets=[]) {
 const calls=[],notices=[],prompts=[];let index=0;
 global.wanjuanI18nRuntime={getLanguage:()=> 'en-US'};
 global.window={wanjuanDesktop:{showInputDialog:async options=>{prompts.push(options);return answers[index++]},saveDownload:async options=>{calls.push(options);return saved}}};
 const action=use_$t({BACKUP_MODULE_LABELS:{projects:'Projects'},buildBackupPayload:async()=>source,collectExternalUploadProjectAssetFiles:()=>assets,collectSelectedLocalforageBackup:async()=>({}),compactBackupPortableAssets:x=>x,getBackupChromeStorageKeys:()=>[],readChromeStorageSnapshot:async()=>({}),showToast2:notice=>notices.push(notice),projects:[]}).$t;
 return {action,calls,notices,prompts};
}
(async()=>{
 try {
  for(const [language,expected] of [['zh-CN','外部素材和文件名不加密'],['zh-TW','外部素材與檔名不加密'],['en-US','external media and filenames are not encrypted']]) {
   global.wanjuanI18nRuntime={getLanguage:()=>language};let deferred;
   const dialog=WanJuanBackupDialog({backupDialogState:{mode:'export',modules:[],encrypted:false},backupDialogTheme:{},agentTheme:{},backupDialogTab:'projects',BACKUP_MODULE_LABELS:{},BACKUP_SETTINGS_SECTION_LABELS:{},setBackupDialogState:fn=>{deferred=fn},setBackupDialogTab:()=>{},confirmBackupDialog:()=>{}});
   const nodes=[];const walk=x=>{if(!x)return;if(Array.isArray(x)){x.forEach(walk);return}if(typeof x==='object'){nodes.push(x);walk(x.props?.children)}};walk(dialog);
   assert.ok(nodes.some(n=>typeof n.props?.children==='string'&&n.props.children.includes(expected)),'the limitation is visible in every language');
   const checkbox=nodes.find(n=>n.type==='input'&&n.props.type==='checkbox');assert.ok(checkbox);const event={target:{checked:true}};checkbox.props.onChange(event);event.target.checked=false;assert.equal(deferred({encrypted:false}).encrypted,true,'checkbox state is captured before asynchronous React updates');
  }
  let e=environment([password,password]);assert.deepEqual(await e.action(['projects'],{encrypted:true}),{ok:true});
  assert.equal(e.prompts.length,2);assert.ok(e.prompts.every(p=>p.password===true&&!JSON.stringify(p).includes(password)));
  assert.equal(e.calls.length,1);const output=e.calls[0];assert.equal(output.encryptedBackup,true);assert.ok(isEncryptedBackupOutput(output.text));
  assert.doesNotMatch(JSON.stringify(output),/SYNTHETIC_PRIVATE_KEY|synthetic-password-long/);
  assert.deepEqual(await decryptPortableBackup(JSON.parse(output.text),password),source);
  e=environment([password,password],{ok:true},[{projectId:'fixture',nodeId:'synthetic',field:'imageUrl',assetId:'asset',filename:'synthetic.png'}]);assert.equal((await e.action(['projects'],{encrypted:true})).ok,true);
  const withAssets=e.calls[0],unlocked=await decryptPortableBackup(JSON.parse(withAssets.text),password);
  assert.equal(unlocked.modules.projects.externalAssetBundle.folderName,withAssets.filename.replace(/\.json$/,'-external-assets'),'import chooser can discover media before decrypting');
  assert.equal(withAssets.externalAssetFolderName,unlocked.modules.projects.externalAssetBundle.folderName);
  for(const bad of [JSON.stringify(source),output.text.replace('PBKDF2-SHA256','OTHER'),output.text.replace('600000','1'),output.text.slice(0,-2)]) assert.equal(isEncryptedBackupOutput(bad),false);
  for(const answers of [[password,'different-password'],['short','short'],[null],[password,null]]) {
   e=environment(answers);const old=console.error;console.error=()=>{};try{assert.equal((await e.action(['projects'],{encrypted:true})).ok,false)}finally{console.error=old}
   assert.equal(e.calls.length,0,'password failure or cancellation never writes plaintext or ciphertext');
  }
  e=environment([]);assert.deepEqual(await e.action(['projects']),{ok:true});assert.equal(e.prompts.length,0);assert.match(e.calls[0].text,/SYNTHETIC_PRIVATE_KEY/,'legacy plain export behavior is retained and must not be called encrypted');
  e=environment([password,password],{ok:false,code:'BACKUP_FOLDER_EXISTS'});const old=console.error;console.error=()=>{};try{assert.equal((await e.action(['projects'],{encrypted:true})).ok,false)}finally{console.error=old};assert.match(e.notices.at(-1),/already exists/);
  console.log('PASS_ENCRYPTED_BACKUP_EXPORT_HOOK');
 }finally{delete global.window;delete global.wanjuanI18nRuntime;}
})().catch(error=>{console.error(error);process.exitCode=1});
