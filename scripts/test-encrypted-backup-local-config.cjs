const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const {webcrypto} = require('node:crypto');
global.crypto = webcrypto;
require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {makeEncryptedBackupConfigsPortable} = require('../src/renderer/lib/custom-node-config-transform.ts');
const {use_sanitizeProjectCanvasStateForExport} = require('../src/renderer/hooks/use_sanitizeProjectCanvasStateForExport.ts');
const {use_buildProjectLocalforageExportPayload} = require('../src/renderer/hooks/use_buildProjectLocalforageExportPayload.ts');
const {use_buildBackupModules} = require('../src/renderer/hooks/use_buildBackupModules.ts');
const {use_$t} = require('../src/renderer/hooks/use_$t.ts');
const {decryptPortableBackup} = require('../src/renderer/lib/portable-backup-crypto.ts');
const marker = '$starcanvasEncryptedConfig';
const ref = 'custom-config-v1:12345678-1234-4123-8123-123456789abc';
const config = {headers:{Authorization:'synthetic-secret'},model:'synthetic-model'};
const state = {nodes:[{id:'node',type:'customNode',data:{config:{[marker]:ref}}}],edges:[]};
const payload = {modules:{projects:{localforage:{canvasStates:{selected:state},assets:{}}}}};
const desktop = {customConfigRestore:async id => id === ref ? {ok:true,config} : {ok:false}};
const pass = 'synthetic-password-123';
(async () => {
  const portable = await makeEncryptedBackupConfigsPortable(payload,desktop);
  assert.deepEqual(portable.modules.projects.localforage.canvasStates.selected.nodes[0].data.config,config);
  assert.equal(state.nodes[0].data.config[marker],ref,'source unchanged');
  await assert.rejects(makeEncryptedBackupConfigsPortable(payload,{customConfigRestore:async()=>({ok:false})}));
  await assert.rejects(makeEncryptedBackupConfigsPortable({modules:{agents:{[marker]:ref}}},desktop));
  await assert.rejects(makeEncryptedBackupConfigsPortable({modules:{projects:{localforage:{canvasStates:{selected:{...state,nodes:[{...state.nodes[0],data:{config:{[marker]:ref,extra:true}}}]}}}}}},desktop));

  const sanitize = use_sanitizeProjectCanvasStateForExport({sanitizeProjectNodeDataForExport:x=>x}).sanitizeProjectCanvasStateForExport;
  assert.throws(()=>sanitize(state),{code:'CUSTOM_CONFIG_BACKUP_NOT_PORTABLE'});
  const builder = use_buildProjectLocalforageExportPayload({
    externalizeProjectCanvasState:async s=>s,extractProjectAssetRefs:()=>[],getProjectCanvasStorageKey:id=>id,
    sanitizeProjectCanvasStateForExport:sanitize,prepareProjectMediaStateForPersistence:async s=>s,
  }).buildProjectLocalforageExportPayload;
  global.prepareProjectMediaStateForPersistence=async s=>s;
  await assert.rejects(builder({selected:state},['selected']),{code:'CUSTOM_CONFIG_BACKUP_NOT_PORTABLE'});
  const built=await builder({selected:state},['selected'],{encrypted:true});
  assert.equal(built.canvasStates.selected.nodes[0].data.config[marker],ref);
  const live={nodes:[{id:'node',type:'customNode',data:{config}}],edges:[]};
  await assert.rejects(builder({},['selected'],{currentProjectId:'selected',currentProjectState:live}),{code:'CUSTOM_CONFIG_BACKUP_NOT_PORTABLE'});
  const liveBuilt=await builder({},['selected'],{currentProjectId:'selected',currentProjectState:live,encrypted:true});
  assert.deepEqual(liveBuilt.canvasStates.selected.nodes[0].data.config,config,'explicit encrypted backup preserves live config');
  let observedOptions;
  const buildModules=use_buildBackupModules({BACKUP_MODULE_LABELS:{projects:'Projects'},apiConfigs:{current:false},
    buildProjectLocalforageExportPayload:async (_data,ids,options)=>{observedOptions={ids,options};return {canvasStates:{},assets:{}}},
    edges:{current:[]},getBackupSettingsSectionMap:()=>({}),getDesktopProjectMirrorStorageKey:id=>'mirror-'+id,
    getProjectCanvasStorageKey:id=>id,setEdges:{current:'selected'},setMaxPollingDuration:{current:[]},
    splitChromeStorageModules:()=>({projects:{projects:[{id:'selected'},{id:'other'}]}}),
  }).buildBackupModules;
  await buildModules({}, {}, ['projects'], {projectIds:['selected'],encrypted:true});
  assert.deepEqual(observedOptions.ids,['selected']);assert.equal(observedOptions.options.encrypted,true);
  await buildModules({}, {}, ['projects'], {projectIds:['selected']});assert.equal(observedOptions.options.encrypted,false);
  let writes=[]; let promptIndex=0;
  global.wanjuanI18nRuntime={getLanguage:()=> 'en-US'};
  global.window={wanjuanDesktop:{...desktop,showInputDialog:async()=>{promptIndex++;return pass},saveDownload:async x=>{writes.push(x);return {ok:true}}}};
  const run=use_$t({BACKUP_MODULE_LABELS:{projects:'Projects'},buildBackupPayload:async()=>({modules:{projects:{localforage:built}}}),collectExternalUploadProjectAssetFiles:()=>[],collectSelectedLocalforageBackup:async()=>({}),compactBackupPortableAssets:x=>x,getBackupChromeStorageKeys:()=>[],readChromeStorageSnapshot:async()=>({}),showToast2:()=>{},projects:[]}).$t;
  assert.equal((await run(['projects'],{encrypted:true})).ok,true);
  assert.equal(promptIndex,2); assert.equal(writes.length,1);
  assert.doesNotMatch(JSON.stringify(writes),/synthetic-secret|synthetic-password-123|custom-config-v1/);
  const unlocked=await decryptPortableBackup(JSON.parse(writes[0].text),pass);
  assert.deepEqual(unlocked.modules.projects.localforage.canvasStates.selected.nodes[0].data.config,config);
  writes=[];global.window.wanjuanDesktop.customConfigRestore=async()=>({ok:false});
  const old=console.error;console.error=()=>{};try {assert.equal((await run(['projects'],{encrypted:true})).ok,false)} finally {console.error=old}
  assert.equal(writes.length,0,'unavailable reference never writes an unusable backup');
  console.log('PASS_ENCRYPTED_BACKUP_LOCAL_CONFIG');
})().catch(error=>{console.error(error);process.exitCode=1});
