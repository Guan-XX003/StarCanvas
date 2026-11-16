// Exercise the real batch hook using fake documents/models; no network or keys.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const oldLoad=Module._load,oldTs=require.extensions['.ts'],oldFetch=global.fetch;
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
let docFailure=false,probes=0;
Module._load=function(name,parent,...rest){
 if(parent?.filename.endsWith('useRunConfigButlerBatch.ts')) {
  if(name==='../lib/app-root-helpers')return {fetchDocAsPlainText:async()=>{if(docFailure)throw Error('SYNTHETIC_SECRET_DOC');return 'Synthetic API documentation';}};
  if(name==='../lib/app-utils')return {extractJsonBlock:JSON.parse};
  if(name==='../lib/config-butler')return {
   buildConfigButlerToolContext:()=>({}),formatConfigButlerToolContext:()=>'',inferButlerCategoryFromModelName:()=> 'image',normalizeModelCategory:x=>x,
   normalizeButlerBatchItems:(value,models)=>models.map(modelName=>({modelName,category:'image',enabled:true,validation:{ok:true},inferenceSource:'model',protocol:{config:{requestType:'fixture',submitPath:'/fixture'}}})),
   configButlerCategoryOptions:[{value:'image'}],specializeConfigButlerToolContext:()=>({}),scanButlerTargetModels:()=>{throw Error('UNEXPECTED_SCAN')},
   probeButlerProtocol:()=>{probes++;throw Error('UNEXPECTED_PROBE')},
  };
 }
 return oldLoad.apply(this,[name,parent,...rest]);
};
const {useRunConfigButlerBatch}=require('../src/renderer/hooks/useRunConfigButlerBatch.ts');Module._load=oldLoad;
global.fetch=()=>{throw Error('UNEXPECTED_NETWORK')};
async function run(language,enableLiveProbe,failModel=false){
 let resultText='',items=[],opened=false,applied=0,calls=0;const toasts=[],warnings=[],errors=[],loading=[];
 const originalWarn=console.warn,originalError=console.error;
 console.warn=(...args)=>warnings.push(args);console.error=(...args)=>errors.push(args);
 try {
  const hook=useRunConfigButlerBatch({appLanguage:language,configButlerDocUrl:'https://docs.fixture.invalid',getSelectedButlerTargetApiConfig:()=>({url:'https://fixture.invalid',key:'synthetic-key'}),
   callConfigButlerModel:async()=>{calls++;if(failModel)throw Error('SYNTHETIC_SECRET_MODEL');return JSON.stringify({models:[]})},applyConfigButlerBatchResults:()=>{applied++;return {}},
   setConfigButlerBatchLoading:value=>loading.push(value),setConfigButlerBatchItems:value=>{items=value},setConfigButlerBatchActiveCategory:()=>{},setConfigButlerResultText:value=>{resultText=value},setConfigButlerBatchModalOpen:value=>{opened=value},showToast2:value=>toasts.push(value)});
  const result=await hook.runConfigButlerBatch({models:['synthetic-image'],enableLiveProbe,autoApply:true,allowUnreviewedApply:true});
  assert.equal(probes,0);assert.equal(applied,0,'preview cannot silently apply fallback results');assert.deepEqual(loading,[true,false]);
  if(docFailure) {assert.equal(result,undefined);assert.equal(opened,false);assert.match(toasts.at(-1),/批量配置分析失败/);assert.doesNotMatch(toasts.join(' '),/SYNTHETIC_SECRET/);assert.deepEqual(errors,[['Config butler batch failed']]);return;}
  assert.equal(opened,true);assert.equal(items.length,1);assert.equal(calls,enableLiveProbe?1:0);
  assert.doesNotMatch(JSON.stringify({result,resultText,toasts,warnings,errors}),/SYNTHETIC_SECRET/);
  assert.ok(toasts.at(-1).includes(language==='en-US'?'No live generation probes':language==='zh-TW'?'未執行真實生成探活':'未执行真实生成探活'));
  if(failModel) {assert.equal(result.failedChunks.length,1);assert.match(result.failedChunks[0].error,/未完成/);assert.deepEqual(warnings,[['Config butler batch chunk failed',1]]);}
 } finally {console.warn=originalWarn;console.error=originalError;}
}
(async()=>{try{for(const lang of ['zh-CN','zh-TW','en-US'])await run(lang,false);await run('zh-CN',true,true);docFailure=true;await run('zh-CN',false);console.log('PASS_BUTLER_BATCH_NO_IMPLICIT_PROBE')}finally{global.fetch=oldFetch;if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts'];Module._load=oldLoad}})().catch(error=>{console.error(error);process.exitCode=1});
