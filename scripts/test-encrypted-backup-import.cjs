// Real import hook and WebCrypto with synthetic data; no disk or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const oldTs=require.extensions['.ts'],oldLoad=Module._load,oldWindow=global.window,oldRuntime=global.wanjuanI18nRuntime;
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
Module._load=function(name,parent,...rest){if(parent?.filename.endsWith('use_handleBackupImportFile.ts')){if(name==='../lib/agent')return {getAgentOptionList:x=>x||[]};if(name==='../lib/app-root-helpers')return {getProjectOptionList:x=>x||[]};}return oldLoad.apply(this,[name,parent,...rest])};
const {use_handleBackupImportFile}=require('../src/renderer/hooks/use_handleBackupImportFile.ts');Module._load=oldLoad;
const {encryptPortableBackup}=require('../src/renderer/lib/portable-backup-crypto.ts');
(async()=>{try{
 const password='synthetic passphrase',backup={modules:{projects:{chromeStorage:{projects:[{id:'proj-fixture',name:'Synthetic'}]},localforage:{canvasStates:{'proj-fixture':{nodes:[],edges:[]}},assets:{}}}}};
 const encrypted=await encryptPortableBackup(backup,password);let dialog=[],state=[],tabs=[],toasts=[],bindings=0,promptValue=password,content=JSON.stringify(encrypted),language='zh-CN';
 global.wanjuanI18nRuntime={getLanguage:()=>language};global.window={wanjuanDesktop:{chooseBackupFile:async()=>({ok:true,name:'synthetic.json',content}),showInputDialog:async options=>{dialog.push(options);return promptValue}}};
 const hook=use_handleBackupImportFile({applyExternalAssetBundleToBackupPayload:value=>{bindings++;return value},getAvailableBackupModules:value=>value?.modules?.projects?['projects']:[],getBackupSettingsSectionMap:()=>({availableSections:[]}),normalizeBackupModules:value=>value.modules,setBackupDialogState:value=>state.push(value),setBackupDialogTab:value=>tabs.push(value),showToast2:value=>toasts.push(value),projects:[]});
 const event={target:{value:'synthetic-path'}};await hook.handleBackupImportFile(event);
 assert.equal(event.target.value,'');assert.equal(dialog.length,1);assert.equal(dialog[0].password,true);assert.doesNotMatch(JSON.stringify(dialog),/synthetic passphrase/);assert.equal(bindings,1);assert.equal(state.length,1);assert.deepEqual(state[0].payload,backup);assert.deepEqual(state[0].projectIds,['proj-fixture']);
 state=[];dialog=[];content=JSON.stringify(backup);await hook.handleBackupImportFile({target:{value:'x'}});assert.equal(dialog.length,0,'legacy unencrypted backups remain readable');assert.equal(state.length,1);
 state=[];dialog=[];content=JSON.stringify(encrypted);promptValue=null;await hook.handleBackupImportFile({target:{value:'x'}});assert.equal(state.length,0,'cancel never opens import confirmation');assert.equal(dialog.length,1);
 const originalError=console.error,logs=[];console.error=(...args)=>logs.push(args);
 try {
  for(const [lang,expected] of [['zh-CN','无法解密备份'],['zh-TW','無法解密備份'],['en-US','Could not decrypt']]) {language=lang;state=[];promptValue='wrong';await hook.handleBackupImportFile({target:{value:'x'}});assert.equal(state.length,0);assert.ok(toasts.at(-1).includes(expected));assert.doesNotMatch(toasts.at(-1),/synthetic passphrase|proj-fixture/);}
  state=[];promptValue=password;content=JSON.stringify({...encrypted,iterations:1});await hook.handleBackupImportFile({target:{value:'x'}});assert.equal(state.length,0);assert.match(toasts.at(-1),/invalid or unsupported/);
  content=JSON.stringify(encrypted);window.wanjuanDesktop.showInputDialog=async()=>{throw Error('SYNTHETIC_PRIVATE_UI_ERROR')};await hook.handleBackupImportFile({target:{value:'x'}});assert.equal(state.length,0);assert.match(toasts.at(-1),/Could not open the backup password dialog/);assert.doesNotMatch(toasts.at(-1),/SYNTHETIC_PRIVATE/);
  assert.ok(logs.every(args=>args.length===1&&args[0]==='Backup file read failed'));
 } finally {console.error=originalError;}
 console.log('PASS_ENCRYPTED_BACKUP_IMPORT_PREFLIGHT');
}finally{global.window=oldWindow;global.wanjuanI18nRuntime=oldRuntime;Module._load=oldLoad;if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts']}})().catch(error=>{console.error(error.code||error.message);process.exitCode=1});
