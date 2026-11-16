// Exercise the real manual error-query route with synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {use_runConfigButlerErrorDiagnosis}=require('../src/renderer/hooks/use_runConfigButlerErrorDiagnosis.ts');
const {use_maybeTriggerConfigButlerErrorDiagnosis}=require('../src/renderer/hooks/use_maybeTriggerConfigButlerErrorDiagnosis.ts');
const {use_runManualConfigButlerErrorQuery}=require('../src/renderer/hooks/use_runManualConfigButlerErrorQuery.ts');
const {localButlerDiagnosisView}=require('../src/renderer/lib/local-butler-diagnosis.ts');
(async()=>{
 const secret='SYNTHETIC_PRIVATE',task={id:'qa-task',nodeId:'qa-node',projectId:'qa-project',type:'video',status:'failed',createdAt:100,modelName:'fixture-model',apiBaseUrl:`https://private.invalid/?key=${secret}`,prompt:`prompt ${secret}`,requestProfile:{headers:{Authorization:secret},pollUrl:`https://private.invalid/${secret}`},errorMsg:`HTTP 429 rate limit ${secret}`};
 let state=null,calls=0;const inflight={current:new Set()},oldFetch=global.fetch;global.fetch=async()=>{calls++;throw Error('UNEXPECTED_NETWORK')};
 try{
  const run=use_runConfigButlerErrorDiagnosis({configButlerErrorAssistantInFlightRef:inflight,setConfigButlerErrorAssistant:value=>{state=typeof value==='function'?value(state):value},callConfigButlerModel:()=>{calls++;throw Error('UNEXPECTED_MODEL')},configButlerDocUrl:`https://private.invalid/${secret}`}).runConfigButlerErrorDiagnosis;
  const trigger=use_maybeTriggerConfigButlerErrorDiagnosis({configButlerErrorAssistant:null,configButlerErrorAssistantInFlightRef:inflight,runConfigButlerErrorDiagnosis:run}).maybeTriggerConfigButlerErrorDiagnosis;
  assert.equal(trigger([task],[],{manual:false}),false,'never diagnose automatically');assert.equal(state,null);
  assert.equal(trigger([task],[],{manual:true}),true);await Promise.resolve();assert.equal(calls,0,'no remote model or document request');assert.equal(inflight.current.size,0);
  assert.equal(state.status,'ready');assert.equal(state.localOnly,true);assert.equal(state.diagnosis.shouldApplyPatch,false);assert.equal(state.diagnosis.confidence,null);assert.equal(state.task.modelName,'fixture-model');assert.match(JSON.stringify(state.diagnosis),/429/);
  for(const [language,word] of [['zh-CN',/任务类型：视频/],['zh-TW',/任務類型：影片/],['en-US',/Task type: video/]]) {const view=localButlerDiagnosisView(state,language);assert.match(JSON.stringify(view),word);assert.match(JSON.stringify(view),/429/);assert.doesNotMatch(JSON.stringify(view),/SYNTHETIC_PRIVATE|private\.invalid|fixture-model/);}
  assert.doesNotMatch(JSON.stringify(state),/SYNTHETIC_PRIVATE|private\.invalid|Authorization|prompt|requestProfile/);assert.deepEqual(state.failures,[]);
  assert.equal(task.prompt,`prompt ${secret}`,'existing task is not altered');
  assert.equal(trigger([task,{id:'unknown',status:'mystery'}],[],{manual:true}),true);assert.match(state.diagnosis.summary,/状态无法确认/);assert.equal(state.diagnosis.shouldApplyPatch,false);
  assert.equal(trigger([task,{...task,id:'other',createdAt:1700000000000}],[],{manual:true}),true);assert.match(state.diagnosis.summary,/无法可靠判断创建顺序/);assert.equal(state.diagnosis.shouldApplyPatch,false);
  assert.equal(trigger(null,[],{manual:true}),true);assert.match(state.diagnosis.summary,/状态无法确认/);
  state=null;assert.equal(trigger([{id:'done',status:'completed'}],[],{manual:true}),false);assert.equal(state,null);
  const manual=(globalTasks)=>use_runManualConfigButlerErrorQuery({configButlerErrorAssistant:null,configButlerErrorAssistantMinimized:false,globalTasks,maybeTriggerConfigButlerErrorDiagnosis:trigger,setConfigButlerErrorAssistant:value=>{state=typeof value==='function'?value(state):value},setConfigButlerErrorAssistantMinimized:()=>{},showToast2:()=>{}}).runManualConfigButlerErrorQuery;
  manual(null)();assert.match(state.diagnosis.summary,/状态无法确认/,'unavailable storage is not an empty list');assert.match(localButlerDiagnosisView(state,'en-US').diagnosis.summary,/could not be confirmed/);
  manual([task])();assert.equal(state.localOnly,true);assert.match(JSON.stringify(state.diagnosis),/429/,'manual diagnosis reflects the click-time task without delayed stale state');
  manual([{id:'done',status:'completed'}])();assert.equal(state.noFailure,true);assert.equal(state.diagnosis.confidence,null,'empty list must not claim model confidence');assert.match(localButlerDiagnosisView(state,'en-US').diagnosis.summary,/No failed task/);
  assert.equal(calls,0);assert.equal(inflight.current.size,0);
 }finally{global.fetch=oldFetch}
 console.log('PASS_BUTLER_LOCAL_ERROR_QUERY_PRIVACY');
})().catch(error=>{console.error(error);process.exitCode=1});
