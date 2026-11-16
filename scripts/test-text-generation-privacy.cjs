// Real text-generation hook, synthetic state and closed-network fake fetch.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const load=Module._load;Module._load=function(name,parent,...rest){if(name==='react'&&parent?.filename.endsWith('useTextGeneration.ts'))return {useCallback:fn=>fn};return load.call(this,name,parent,...rest)};
const {useTextGeneration}=require('../src/renderer/hooks/useTextGeneration.ts');Module._load=load;
const {buildAssistantSelectedTaskResponse}=require('../src/renderer/lib/assistant-onboarding.ts');
const {mediaUrlToDataUrl}=require('../src/renderer/lib/reference-media.ts');
const PRIVATE='SYNTHETIC_PRIVATE';
async function run({dynamic=false,fail=false,video=false}={}){
 let nodes=[{id:'qa-text',type:'textNode',data:{selectedContextResources:video?[{type:'video',url:`https://media.invalid/${PRIVATE}.mp4?token=${PRIVATE}`}]:[]}}],edges=[],tasks=[],requests=[],notices=[],logs=[],assets=[];
 const oldConsole={log:console.log,warn:console.warn,error:console.error},oldFetch=global.fetch,oldWindow=global.window,oldStorage=global.localStorage;
 console.log=(...x)=>logs.push(x);console.warn=(...x)=>logs.push(x);console.error=(...x)=>logs.push(x);
 global.localStorage={getItem:()=>null,setItem:()=>{}};global.window={wanjuanDesktop:{}};
 global.fetch=async (url,init)=>{assert.ok(String(url).startsWith('https://fixture.invalid'));requests.push({url,init});return fail?Response.json({error:{message:`rate limit ${PRIVATE} https://private.invalid/key`}}, {status:429}):Response.json({choices:[{message:{content:'synthetic result'}}]})};
 try{
  const deps={propTextApiKey:'fixture-key',propTextApiUrl:'https://fixture.invalid',textModel:'fixture-model',apiConfigs:[],textModelApiBindings:{},textModelProtocolBindings:dynamic?{'fixture-model':'fixture-protocol'}:{},modelProtocolRegistry:dynamic?{'fixture-protocol':{requestType:'openai-chat',submitPath:'/v1/chat/completions'}}:{},planLimits:{},getNodes:()=>nodes,getEdges:()=>edges,setNodes:f=>{nodes=f(nodes)},setEdges:f=>{edges=f(edges)},showToast:value=>notices.push(value),addGeneratedAsset:(...a)=>assets.push(a),updateTaskList:f=>{tasks=f(tasks)},projectIdRef:{current:'qa-project'},abortControllersRef:{current:new Map()},customPublicUploadConfig:{},presetPrompts:[],seedanceUploadMode:'',setDailyGenerationCount(){},tosConfig:{}};
  await useTextGeneration(deps).generateText('qa-text',`private prompt ${PRIVATE}`);
  return {nodes,tasks,requests,notices,logs,assets};
 }finally{Object.assign(console,oldConsole);global.fetch=oldFetch;global.window=oldWindow;global.localStorage=oldStorage}
}
(async()=>{
 for(const dynamic of [false,true])for(const fail of [false,true]){
  const r=await run({dynamic,fail,video:!dynamic});assert.equal(r.requests.length,1,`request was not sent: ${JSON.stringify({dynamic,fail,logs:r.logs,notices:r.notices})}`);assert.doesNotMatch(JSON.stringify(r.logs),/SYNTHETIC_PRIVATE|private\.invalid|media\.invalid|fixture-key/,'logs must not include request or media');
  assert.equal(r.tasks[0].status,fail?'failed':'completed');
  if(fail){assert.match(r.tasks[0].errorMsg,/HTTP 429/);assert.doesNotMatch(r.tasks[0].errorMsg,/SYNTHETIC_PRIVATE|private\.invalid/);assert.doesNotMatch(JSON.stringify(r.notices),/SYNTHETIC_PRIVATE|private\.invalid/);assert.doesNotMatch(r.nodes[0].data.errorMessage,/SYNTHETIC_PRIVATE|private\.invalid/);assert.match(buildAssistantSelectedTaskResponse(r.tasks,r.tasks[0].id,'en-US'),/rate limit/i)}
  else{assert.equal(r.nodes[0].data.text,'synthetic result');assert.equal(r.assets.length,1)}
 }
 const conversion=await run({dynamic:true,video:true});assert.equal(conversion.requests.length,0,'unreadable video is not sent to the model');assert.equal(conversion.tasks[0].status,'failed');assert.doesNotMatch(JSON.stringify([conversion.logs,conversion.notices,conversion.tasks[0].errorMsg,conversion.nodes[0].data.errorMessage]),/SYNTHETIC_PRIVATE|private\.invalid|media\.invalid|fixture-key/);
 const oldFetch=global.fetch,oldWarn=console.warn,log=[];global.fetch=async()=>{throw Error(`network ${PRIVATE}`)};console.warn=(...args)=>log.push(args);
 try{assert.equal(await mediaUrlToDataUrl(`https://private.invalid/${PRIVATE}`),`https://private.invalid/${PRIVATE}`);assert.doesNotMatch(JSON.stringify(log),/SYNTHETIC_PRIVATE|private\.invalid/)}finally{global.fetch=oldFetch;console.warn=oldWarn}
 console.log('PASS_TEXT_GENERATION_LOG_AND_ERROR_PRIVACY');
})().catch(error=>{console.error(error);process.exitCode=1});
