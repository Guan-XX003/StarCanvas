// Actual Tianji request/orchestrator and parsers with a synthetic, offline fetch.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {wanjuanRunTianjiSeedanceVideo,wanjuanTianjiIsExplicitCancellation}=require('../src/renderer/lib/tianji-api.ts');
const {classifyAssistantTaskStatus}=require('../src/renderer/lib/assistant-local-operations.ts');
const original={fetch:global.fetch,window:global.window,chrome:global.chrome,localStorage:global.localStorage};
const fixtureConfig={baseUrl:'https://fixture.invalid',token:'SYNTHETIC_TOKEN',syncSource:'manual',models:'fixture-model',durations:'5',resolutions:'720p',ratios:'16:9'};
const storage={getItem:()=>null,setItem:()=>{}};global.window={localStorage:storage};global.localStorage=storage;
global.chrome={storage:{local:{get:(_keys,cb)=>cb({tianjiSeedanceConfig:fixtureConfig}),set:(_values,cb)=>cb()}}};
async function run(responses,{staleStop=false,staleNode=false,abortDuringPoll=false}={}){
 let tasks=[],nodes=[{id:'fixture-node',data:{loading:true,selectedModel:'fixture-model',seedanceMode:'tianji'}}],edges=[],storedNodes=nodes, calls=0;
 const notices=[],resources=[],writes=[],snapshots=[],abortControllers={current:new Map()};
 global.fetch=async(url,init)=>{
  assert.ok(String(url).startsWith('https://fixture.invalid/'),'only the synthetic endpoint is allowed');calls++;
  if(calls===1)return Response.json({code:200,data:{execute_id:'fixture-remote'}});
  if(staleStop){tasks=tasks.map(t=>({...t,status:'failed',stoppedByUser:true,errorMsg:'已取消'}));nodes=nodes.map(n=>({...n,data:{...n.data,loading:false,manuallyStopped:true,errorMessage:'已取消'}}));storedNodes=nodes;}
  if(staleNode){nodes=nodes.map(n=>({...n,data:{...n.data,seedanceTaskId:'new-task',tianjiExecuteId:'new-task'}}));storedNodes=nodes;}
  if(abortDuringPoll){tasks=tasks.map(t=>({...t,status:'failed',stoppedByUser:true,errorMsg:'已取消'}));nodes=nodes.map(n=>({...n,data:{...n.data,loading:false,manuallyStopped:true,errorMessage:'已取消'}}));storedNodes=nodes;abortControllers.current.get('fixture-node').abort();}
  return Response.json({code:200,...responses[Math.min(calls-2,responses.length-1)]});
 };
 const opts={nodeId:'fixture-node',projectIdAtStart:'fixture-project',sourceNode:nodes[0],prompt:'synthetic prompt',dailyKey:'synthetic',dailyCount:0,pollingInterval:1,maxPollingDuration:5,abortControllers,showToast:s=>notices.push(s),setDailyCount(){},updateNodes:f=>{nodes=f(nodes)},updateEdges:f=>{edges=f(edges)},updateGlobalTasks:f=>{tasks=f(tasks);snapshots.push(JSON.stringify(tasks))},addTransitResource:(...args)=>resources.push(args),persistVideoNodeState:async(_style,data,options={})=>{writes.push({data,options});storedNodes=storedNodes.map(n=>{if(options.onlyIfActiveTaskId&&(n.data?.loading!==true||n.data?.manuallyStopped||![n.data?.taskId,n.data?.seedanceTaskId,n.data?.tianjiExecuteId].includes(options.onlyIfActiveTaskId)))return n;return {...n,data:{...n.data,...data}}})}};
 let thrown;try{await wanjuanRunTianjiSeedanceVideo(opts)}catch(error){if(!abortDuringPoll)throw error;thrown=error}return {tasks,nodes,storedNodes,notices,resources,writes,snapshots,calls,thrown};
}
(async()=>{try{
 for(const status of ['cancelled','canceled','cancel','已取消','failed']){
  const result=await run([{status,video_url:'https://fixture.invalid/stale.mp4',message:'HTTP 429 rate limit PRIVATE_TOKEN https://private.invalid/prompt'}]);
  assert.equal(result.calls,2,'no retry after terminal response');assert.equal(result.tasks.length,1,'no duplicate local task');assert.equal(result.tasks[0].status,status==='failed'?'failed':'cancelled');assert.equal(result.nodes[0].data.loading,false);assert.equal(result.resources.length,0);assert.equal(result.tasks[0].resultUrl,undefined);assert.equal(result.writes.at(-1).options.onlyIfActiveTaskId,'fixture-remote');
  assert.doesNotMatch(JSON.stringify({tasks:result.tasks,nodes:result.nodes,writes:result.writes,notices:result.notices}),/PRIVATE_TOKEN|private\.invalid/);
  assert.equal(classifyAssistantTaskStatus(result.tasks[0]),status==='failed'?'failed':'stopped');
 }
 const success=await run([{status:'running',video_url:'https://fixture.invalid/preview.mp4'},{status:'succeeded',video_url:'https://fixture.invalid/output.mp4'}]);assert.equal(success.calls,3);assert.equal(success.tasks[0].status,'completed');assert.equal(success.tasks[0].resultUrl,'https://fixture.invalid/output.mp4');assert.equal(success.resources.length,1);
 const stop=await run([{status:'failed',message:'network error PRIVATE_TOKEN'}],{staleStop:true});assert.equal(stop.tasks[0].stoppedByUser,true);assert.equal(stop.tasks[0].errorMsg,'已取消');assert.equal(stop.nodes[0].data.errorMessage,'已取消');assert.equal(stop.storedNodes[0].data.errorMessage,'已取消');
 const replaced=await run([{status:'failed'}],{staleNode:true});assert.equal(replaced.nodes[0].data.seedanceTaskId,'new-task');assert.equal(replaced.nodes[0].data.loading,true);assert.equal(replaced.storedNodes[0].data.loading,true);
 const aborted=await run([{status:'succeeded',video_url:'https://fixture.invalid/stale.mp4'}],{abortDuringPoll:true});assert.match(aborted.thrown.message,/生成已取消/);assert.equal(aborted.tasks[0].stoppedByUser,true);assert.equal(aborted.resources.length,0);assert.equal(aborted.nodes[0].data.errorMessage,'已取消');
 for(const status of ['cancelled','canceled','cancel','已取消'])assert.equal(wanjuanTianjiIsExplicitCancellation({data:{status}}),true);
 assert.equal(wanjuanTianjiIsExplicitCancellation({status:'failed',message:'用户取消了参考项'}),false);
 console.log('PASS_TIANJI_TERMINAL_STATUS_AND_STALE_GUARD');
}finally{Object.assign(global,original)}})().catch(error=>{console.error(error);process.exitCode=1});
