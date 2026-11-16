// Exercise actual refresh hook against synthetic responses, never real network.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const realAudioHelpers=require('../src/renderer/components/audio-nodes.tsx');
const realTianjiHelpers=require('../src/renderer/lib/tianji-api.ts');let tianjiFixture;
const originalLoad=Module._load;
Module._load=function(name,parent,...rest){
 if(name==='../components/audio-nodes' && parent?.filename.endsWith('use_refreshGlobalTask.ts'))return realAudioHelpers;
 if(name==='../lib/tianji-api' && parent?.filename.endsWith('use_refreshGlobalTask.ts'))return {...realTianjiHelpers,wanjuanGetSyncedTianjiSeedanceConfig:()=>({}),wanjuanBuildTianjiTaskQuery:()=>({}),wanjuanTianjiRequest:async()=>tianjiFixture};
 return originalLoad.call(this,name,parent,...rest);
};
const {use_refreshGlobalTask}=require('../src/renderer/hooks/use_refreshGlobalTask.ts');Module._load=originalLoad;
const {buildAssistantSelectedTaskResponse}=require('../src/renderer/lib/assistant-onboarding.ts');
const {isTaskCredentialUrlAllowed}=require('../src/renderer/lib/global-config.ts');
const PRIVATE='PRIVATE_TOKEN https://synthetic.invalid/private';
async function run(kind,payload,{networkFailure=false,missingConfig=false,staleStop=false,staleNode=false,httpStatus=200,taskOverrides={}}={}){
 const task={id:'fixture-id',type:kind==='image'?'image':kind==='audio'?'audio':'video',provider:kind==='tianji'?'tianji-seedance':kind==='seedance'?'seedance':kind==='audio'?'suno':'fixture',nodeId:'fixture-node',projectId:'fixture-project',status:'running',apiConfigId:'fixture',modelName:'fixture-model',...(kind==='image'?{remoteTaskId:'fixture-remote',requestProfile:{requestType:'gpt-image-2-async'}}:kind==='audio'?{remoteTaskId:'fixture-remote'}:{requestProfile:{pollPath:'/tasks/{taskId}'}}),...taskOverrides};
 let tasks=[task],nodes=[{id:'fixture-node',data:{loading:true,taskId:task.id,remoteTaskId:task.remoteTaskId}}],fetchCount=0;const notices=[],snapshots=[],resources=[];
 const originalFetch=global.fetch;
 tianjiFixture=payload;
 global.fetch=async (url,options)=>{fetchCount++;assert.ok(String(url).startsWith('https://fixture.invalid/'));if(['image','video','seedance'].includes(kind))assert.equal(options.redirect,'error','credentialed refresh must not follow redirects');if(networkFailure)throw Error(`network error ${PRIVATE}`);if(staleStop){tasks=tasks.map(item=>({...item,status:'failed',stoppedByUser:true,errorMsg:'已取消'}));nodes=nodes.map(item=>({...item,data:{...item.data,loading:false,manuallyStopped:true,errorMessage:'已取消'}}));}if(staleNode)nodes=nodes.map(item=>({...item,data:{...item.data,taskId:'new-task',remoteTaskId:'new-remote'}}));return Response.json(payload,{status:httpStatus})};
 const deps={Send:f=>nodes=f(nodes),addResource:(...args)=>resources.push(args),apiConfigs:missingConfig?[]:[{id:'fixture',url:'https://fixture.invalid',key:'synthetic-key'}],storedGlobalConfigs:[],audioApiKey:'',audioApiUrl:'',imageApiKey:'',imageApiUrl:'',imageModelApiBindings:{},videoApiKey:'',videoApiUrl:'',videoModelApiBindings:{},globalTasks:tasks,showToast2:text=>notices.push(text),updateGlobalTasks:f=>{tasks=f(tasks);snapshots.push(JSON.stringify(tasks))}};
 try{await use_refreshGlobalTask(deps).refreshGlobalTask(task);return {tasks,nodes,notices,snapshots,resources,fetchCount}}finally{global.fetch=originalFetch}
}
(async()=>{
 for(const candidate of ['https://attacker.invalid/x','//attacker.invalid/x','https://fixture.invalid.attacker.invalid/x','https://user@fixture.invalid/x','http://fixture.invalid/x','data:text/plain,hi'])assert.equal(isTaskCredentialUrlAllowed('https://fixture.invalid',candidate),false,candidate);
 for(const candidate of ['/jobs/123','https://fixture.invalid:443/jobs/123'])assert.equal(isTaskCredentialUrlAllowed('https://fixture.invalid',candidate),true,candidate);
 for(const [kind,taskOverrides] of [
  ['image',{asyncImageDetailUrl:'https://attacker.invalid/collect'}],
  ['video',{requestProfile:{pollUrl:'https://attacker.invalid/collect',pollPath:'/tasks/{taskId}'}}],
  ['video',{requestProfile:{pollPath:'https://attacker.invalid/tasks/{taskId}'}}],
 ]){
  const blocked=await run(kind,{}, {taskOverrides});assert.equal(blocked.fetchCount,0,'untrusted task endpoint must not receive credentials');assert.equal(blocked.tasks[0].status,'running','blocked query is not a generation failure');assert.match(blocked.notices.join(' '),/查询地址与原 API 配置不一致/);assert.doesNotMatch(blocked.notices.join(' '),/attacker|synthetic-key/);
 }
 const badContent=await run('video',{status:'completed'},{taskOverrides:{requestProfile:{pollPath:'/tasks/{taskId}',contentPath:'https://attacker.invalid/content/{taskId}'}}});assert.equal(badContent.fetchCount,1,'content endpoint mismatch blocks the second credentialed request');assert.match(badContent.notices.join(' '),/查询地址与原 API 配置不一致/);assert.equal(badContent.tasks[0].status,'running');
 const sameOrigin=await run('video',{status:'running'},{taskOverrides:{requestProfile:{pollUrl:'https://fixture.invalid/jobs/fixture-id'}}});assert.equal(sameOrigin.fetchCount,1,'same-origin stored endpoints remain usable');
 for(const [kind,payload] of [['image',{code:200,data:{status:3,message:`HTTP 429 rate limit ${PRIVATE}`}}],['video',{status:'failed',error:{message:`HTTP 429 rate limit ${PRIVATE}`}}],['seedance',{items:[{status:'failed',error:{message:`HTTP 429 rate limit ${PRIVATE}`}}]}],['tianji',{status:'failed',message:`HTTP 429 rate limit ${PRIVATE}`}]]){
  const result=await run(kind,payload);assert.equal(result.tasks[0].status,'failed');assert.match(result.tasks[0].errorMsg,/HTTP 429/);
  for(const value of [result.tasks[0].errorMsg,...result.notices,...result.snapshots,JSON.stringify(result.nodes)])assert.doesNotMatch(value,/PRIVATE_TOKEN|synthetic\.invalid\/private/);
  assert.match(buildAssistantSelectedTaskResponse(result.tasks,'fixture-id','en-US'),/rate limit/i);assert.equal(result.resources.length,0);
 }
 const imageQueryError=await run('image',{code:500,msg:`HTTP 429 rate limit ${PRIVATE}`});assert.equal(imageQueryError.tasks[0].status,'running');assert.match(imageQueryError.notices[0],/HTTP 429/);assert.doesNotMatch(imageQueryError.notices.join(' '),/PRIVATE_TOKEN|synthetic\.invalid/);
 const audioFailure=await run('audio',{status:'failed',message:`HTTP 429 rate limit ${PRIVATE}`});assert.equal(audioFailure.tasks[0].status,'failed');assert.match(audioFailure.tasks[0].errorMsg,/HTTP 429/);assert.equal(audioFailure.nodes[0].data.loading,false);assert.match(audioFailure.nodes[0].data.errorMessage,/HTTP 429/);assert.match(buildAssistantSelectedTaskResponse(audioFailure.tasks,'fixture-id','en-US'),/rate limit/i);assert.doesNotMatch(JSON.stringify(audioFailure),/PRIVATE_TOKEN|synthetic\.invalid/);
 const audioCancelled=await run('audio',{status:'cancelled',message:`${PRIVATE}`});assert.equal(audioCancelled.tasks[0].status,'cancelled');assert.equal(audioCancelled.nodes[0].data.loading,false);assert.doesNotMatch(JSON.stringify(audioCancelled),/PRIVATE_TOKEN|synthetic\.invalid/);
 const audioConflict=await run('audio',{status:'failed',data:{status:'completed'},message:`${PRIVATE}`});assert.equal(audioConflict.tasks[0].status,'running');assert.match(audioConflict.notices[0],/无法确认/);assert.doesNotMatch(JSON.stringify(audioConflict),/PRIVATE_TOKEN|synthetic\.invalid/);
 const audioRunning=await run('audio',{status:'running'});assert.equal(audioRunning.tasks[0].status,'running');assert.match(audioRunning.notices[0],/仍在生成/);
 const audioComplete=await run('audio',{status:'completed',audio_url:'https://fixture.invalid/output.mp3'});assert.equal(audioComplete.tasks[0].status,'completed');assert.equal(audioComplete.resources.length,1);
 const stoppedAudio=await run('audio',{}, {taskOverrides:{status:'failed',stoppedByUser:true,resultUrl:'https://fixture.invalid/old.mp3'}});assert.equal(stoppedAudio.fetchCount,0);assert.equal(stoppedAudio.tasks[0].stoppedByUser,true);assert.equal(stoppedAudio.resources.length,0);assert.match(stoppedAudio.notices[0],/已停止/);
 for(const kind of ['video','seedance']) for(const remoteStatus of ['failed','cancelled','canceled']){
  const payload=kind==='seedance'?{items:[{status:remoteStatus,video_url:'https://fixture.invalid/stale.mp4'}]}:{status:remoteStatus,video_url:'https://fixture.invalid/stale.mp4'};
  const terminal=await run(kind,payload);assert.equal(terminal.tasks[0].status,remoteStatus==='failed'?'failed':'cancelled',`${kind} ${remoteStatus}`);assert.equal(terminal.resources.length,0,'terminal failures and cancellations cannot attach a stale URL');assert.equal(terminal.tasks[0].resultUrl,undefined);assert.equal(terminal.fetchCount,1);assert.equal(terminal.nodes[0].data.loading,false);
  const stoppedDuringQuery=await run(kind,payload,{staleStop:true});assert.equal(stoppedDuringQuery.tasks[0].stoppedByUser,true);assert.equal(stoppedDuringQuery.tasks[0].errorMsg,'已取消');assert.equal(stoppedDuringQuery.nodes[0].data.errorMessage,'已取消');
  const nodeReplaced=await run(kind,payload,{staleNode:true});assert.equal(nodeReplaced.nodes[0].data.loading,true);assert.equal(nodeReplaced.nodes[0].data.errorMessage,undefined);
 }
 const stoppedVideo=await run('video',{status:'completed',video_url:'https://fixture.invalid/old.mp4'}, {taskOverrides:{status:'failed',stoppedByUser:true}});assert.equal(stoppedVideo.fetchCount,0);assert.equal(stoppedVideo.resources.length,0);assert.equal(stoppedVideo.tasks[0].stoppedByUser,true);
 for(const remoteStatus of ['failed','cancelled','canceled','cancel','已取消','running']){
  const terminal=await run('tianji',{status:remoteStatus,video_url:'https://fixture.invalid/stale.mp4'});assert.equal(terminal.tasks[0].status,remoteStatus==='failed'?'failed':remoteStatus==='running'?'running':'cancelled');assert.equal(terminal.resources.length,0,'Tianji does not attach a preview on non-success');assert.equal(terminal.tasks[0].resultUrl,undefined);
 }
 assert.equal(realTianjiHelpers.wanjuanTianjiIsExplicitCancellation({status:'failed',message:'用户取消了某个参考项'}),false,'prose is not sufficient evidence of cancellation');
 const stopped=await run('audio',{status:'failed',message:'HTTP 429 rate limit'},{staleStop:true});assert.equal(stopped.tasks[0].stoppedByUser,true);assert.equal(stopped.tasks[0].errorMsg,'已取消');assert.equal(stopped.nodes[0].data.loading,false);assert.equal(stopped.nodes[0].data.errorMessage,'已取消');
 const replaced=await run('audio',{status:'failed',message:'HTTP 429 rate limit'},{staleNode:true});assert.equal(replaced.tasks[0].status,'failed');assert.equal(replaced.nodes[0].data.loading,true);assert.equal(replaced.nodes[0].data.errorMessage,undefined);
 const network=await run('video',{}, {networkFailure:true});assert.equal(network.tasks[0].status,'running','a failed query is not a failed generation');assert.match(network.notices[0],/网络错误/);assert.doesNotMatch(network.notices.join(' '),/PRIVATE_TOKEN|synthetic\.invalid/);
 for(const kind of ['video','seedance','image','audio']) {
  const missing=await run(kind,{}, {missingConfig:true});assert.equal(missing.fetchCount,0);assert.equal(missing.tasks[0].status,'running',`${kind}: missing credentials cannot prove generation failed`);assert.equal(missing.nodes[0].data.loading,true);assert.equal(missing.nodes[0].data.errorMessage,undefined);assert.match(missing.notices[0],/原始 API 配置已不存在/);assert.match(missing.notices[0],/实际状态未确认/);assert.match(buildAssistantSelectedTaskResponse(missing.tasks,'fixture-id','en-US'),/running/i);
 }
 for(const kind of ['video','seedance'])for(const status of [401,403]) {
  const denied=await run(kind,{error:`${PRIVATE}`},{httpStatus:status});assert.equal(denied.fetchCount,1);assert.equal(denied.tasks[0].status,'running');assert.equal(denied.nodes[0].data.loading,true);assert.equal(denied.nodes[0].data.errorMessage,undefined);assert.match(denied.notices[0],new RegExp(String(status)));assert.match(denied.notices[0],/实际状态未确认/);assert.doesNotMatch(JSON.stringify(denied.notices),/PRIVATE_TOKEN|synthetic\.invalid/);
  const stopped=await run(kind,{error:`${PRIVATE}`},{httpStatus:status,staleStop:true});assert.equal(stopped.tasks[0].stoppedByUser,true);assert.equal(stopped.nodes[0].data.manuallyStopped,true);
 }
 const completed=await run('video',{status:'completed',video_url:'https://fixture.invalid/output.mp4'});assert.equal(completed.tasks[0].status,'completed');assert.equal(completed.resources.length,1,'successful recovery stays functional');
 console.log('PASS_TASK_REFRESH_SAFE_DIAGNOSTICS_AND_RECOVERY');
})().catch(error=>{console.error(error);process.exitCode=1});
