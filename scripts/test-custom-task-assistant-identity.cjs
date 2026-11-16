// Exercise the actual custom-node async lifecycle with in-memory state and a
// synthetic fetch adapter. No network, real model, profile, or project data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
const oldTs=require.extensions['.ts'];
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const originalLoad=Module._load;
Module._load=function(name,parent,...rest){if(name==='react'&&parent?.filename.endsWith('useCustomNodeGeneration.ts'))return {useCallback:fn=>fn};return originalLoad.call(this,name,parent,...rest)};
const {useCustomNodeGeneration}=require('../src/renderer/hooks/useCustomNodeGeneration.ts');
Module._load=originalLoad;
const {indexGlobalTasks}=require('../src/renderer/lib/global-tasks.ts');
const {buildAssistantSelectedTaskResponse}=require('../src/renderer/lib/assistant-onboarding.ts');
const {safeCustomTaskError}=require('../src/renderer/lib/custom-task-error.ts');
const {wanjuanStripRuntimeNodeData}=require('../src/renderer/lib/node-runtime-contract.ts');
const privateMarker='SYNTHETIC_PRIVATE_TOKEN';
const generatedLocalIds=new Set();
const response=body=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>body});

async function run(finalStatus, exercisePrivateWarnings=false) {
  const nodeId='fixture-custom-node',projectId='fixture-project',oldTask={id:'old-task',nodeId:'old-node',status:'completed',prompt:'SYNTHETIC_OLD_PRIVATE'};
  const config={apiUrl:`https://synthetic.invalid/submit?token=${privateMarker}`,method:'POST',headers:'{}',body:'{}',variables:{},executionMode:'async',taskIdPath:'task_id',pollingUrl:'https://synthetic.invalid/tasks/{{task_id}}',pollingMethod:'GET',pollingResultPath:'status',pollingCompletedValue:'completed',pollingFailedValue:'failed',pollingErrorPath:'message',pollingResultDataPath:'result',outputType:'image'};
  if(exercisePrivateWarnings){config.headers=`{"Authorization":"${privateMarker}`;config.pollingHeaders=`{"Authorization":"${privateMarker}`;}
  let nodes=[{id:nodeId,type:'customNode',data:{config}}],edges=[],tasks=[oldTask],calls=0,releasePoll,signalPoll;const toasts=[];
  const waiting=new Promise(resolve=>{signalPoll=resolve});
  const originalFetch=global.fetch,originalWarn=console.warn,warnings=[];
  console.warn=(...args)=>warnings.push(args.map(String).join(' '));
  global.fetch=async url=>{
    assert.match(String(url),/^https:\/\/synthetic\.invalid\//,'only synthetic adapter routes are allowed');
    calls++;
    if(calls===1)return response({task_id:`remote-${privateMarker}`,private_field:privateMarker});
    assert.match(String(url),new RegExp(`remote-${privateMarker}`),'provider ID remains available for polling');
    if(exercisePrivateWarnings && calls===2)throw new Error(`network error ${privateMarker} https://synthetic.invalid/private`);
    if(calls===(exercisePrivateWarnings?3:2)){signalPoll();return new Promise(resolve=>{releasePoll=()=>resolve(response({status:'running',progress:12,private_field:privateMarker}))});}
    return response(finalStatus==='completed'?{status:'completed',result:'data:image/png;base64,AA==',private_field:privateMarker}:{status:'failed',message:`HTTP 429 rate limit ${privateMarker} SYNTHETIC_PRIVATE_PROMPT https://synthetic.invalid/private`,private_field:privateMarker});
  };
  const deps={abortControllersRef:{current:new Map()},addGeneratedAsset:()=>{},apiConfigs:[],getEdges:()=>edges,getNodes:()=>nodes,modelProtocolRegistry:{},pollIntervalMs:1,projectIdRef:{current:projectId},propTextApiKey:'',propTextApiUrl:'',setEdges:f=>{edges=typeof f==='function'?f(edges):f},setNodes:f=>{nodes=typeof f==='function'?f(nodes):f},showToast:value=>toasts.push(value),textModel:'',textModelApiBindings:{},textModelProtocolBindings:{},timeoutSeconds:5,updateTaskList:f=>{tasks=typeof f==='function'?f(tasks):f}};
  try {
    const pending=useCustomNodeGeneration(deps).handleGenerateCustom(nodeId);
    await waiting;
    assert.equal(tasks.length,2);assert.equal(tasks[0],oldTask,'existing tasks stay untouched');
    const created=tasks[1];assert.equal(created.nodeId,nodeId);assert.equal(created.projectId,projectId);assert.equal(created.status,'pending');
    assert.equal(Object.hasOwn(created,'customRawResponse'),false);assert.equal(Object.hasOwn(created,'prompt'),false);
    assert.doesNotMatch(JSON.stringify(created),/SYNTHETIC_PRIVATE_TOKEN|SYNTHETIC_OLD_PRIVATE/,'no old task list, API URL or raw response is copied into the record');
    releasePoll();await pending;
    const task=tasks.find(item=>item.id.startsWith('custom-local-'));assert.ok(task);assert.equal(task.nodeId,nodeId);assert.equal(task.status,finalStatus);assert.equal(nodes[0].data.taskId,task.id);
    assert.equal(generatedLocalIds.has(task.id),false,'repeated provider IDs do not merge separate local runs');generatedLocalIds.add(task.id);
    assert.doesNotMatch(JSON.stringify(task),/SYNTHETIC_PRIVATE_TOKEN|SYNTHETIC_OLD_PRIVATE/,'poll responses are not retained in task metadata');
    assert.ok(indexGlobalTasks(tasks).byNode.get(`${projectId}::${nodeId}`)?.some(item=>item.id===task.id),'task index resolves the originating node');
    const diagnostic=buildAssistantSelectedTaskResponse(tasks,task.id,'en-US');
    assert.doesNotMatch(diagnostic,/SYNTHETIC_PRIVATE_TOKEN|SYNTHETIC_OLD_PRIVATE|synthetic\.invalid|data:image/);
    if(finalStatus==='failed'){
      assert.match(diagnostic,/rate limit/i);assert.match(task.errorMsg,/HTTP 429/);
      const savedNode=wanjuanStripRuntimeNodeData(nodes[0].data);
      for(const value of [task.errorMsg,nodes[0].data.errorMessage,savedNode.errorMessage,...toasts])assert.doesNotMatch(value,/SYNTHETIC_PRIVATE_TOKEN|SYNTHETIC_PRIVATE_PROMPT|synthetic\.invalid/,'stored and shown failures contain no provider text or URL');
      for(const language of ['zh-CN','zh-TW','en-US']) assert.doesNotMatch(buildAssistantSelectedTaskResponse(tasks,task.id,language),/SYNTHETIC_PRIVATE|synthetic\.invalid/);
    }
    else assert.equal(nodes[0].data.imageUrl,'data:image/png;base64,AA==','successful result still reaches the original node');
    if(exercisePrivateWarnings){assert.ok(warnings.length>=3,'malformed header and transient network warnings executed');assert.doesNotMatch(warnings.join('\n'),/SYNTHETIC_PRIVATE|synthetic\.invalid/,'warnings contain no raw headers or errors');}
  } finally {global.fetch=originalFetch;console.warn=originalWarn;}
}
(async()=>{try{
  for(const [message,expected] of [['API 请求失败: 401 SECRET',/HTTP 401/],['HTTP 429 SECRET',/HTTP 429/],['insufficient quota SECRET',/额度不足/],['timeout SECRET',/请求超时/],['network error SECRET',/网络错误/],['content policy SECRET',/内容审核/],['无法提取 Task ID',/任务编号/],['SECRET https://synthetic.invalid/',/自定义任务执行失败/]]) {
    const safe=safeCustomTaskError(new Error(message));assert.match(safe,expected);assert.doesNotMatch(safe,/SECRET|synthetic\.invalid/);
  }
  const quotaTask={id:'quota-fixture',status:'failed',type:'image',errorMsg:safeCustomTaskError(new Error('insufficient quota SECRET'))};
  for(const [language,expected] of [['zh-CN',/余额或额度不足/],['zh-TW',/餘額或額度不足/],['en-US',/insufficient balance or quota/]]) {
    const diagnostic=buildAssistantSelectedTaskResponse([quotaTask],quotaTask.id,language);assert.match(diagnostic,expected);assert.doesNotMatch(diagnostic,/SECRET/);
  }
  const limitedTask={id:'rate-fixture',status:'failed',type:'image',errorMsg:safeCustomTaskError(new Error('rate limit SYNTHETIC_PRIVATE'))};
  for(const [language,expected] of [['zh-CN',/访问频率限制/],['zh-TW',/存取頻率限制/],['en-US',/rate limit/]]) {
    const diagnostic=buildAssistantSelectedTaskResponse([limitedTask],limitedTask.id,language);
    assert.match(diagnostic,expected,'a sanitized rate limit without an HTTP status keeps its category');
    assert.doesNotMatch(diagnostic,/SYNTHETIC_PRIVATE/);
  }
  for (const [providerError,localized] of [
    ['invalid api key SYNTHETIC_PRIVATE',[/鉴权或凭据问题/,/驗證或憑證問題/,/authentication or credential issue/]],
    ['timeout SYNTHETIC_PRIVATE',[/请求超时/,/請求逾時/,/request timeout/]],
    ['failed to fetch SYNTHETIC_PRIVATE',[/网络连接问题/,/網路連線問題/,/network connection issue/]],
    ['content policy SYNTHETIC_PRIVATE',[/内容审核限制/,/內容審核限制/,/content policy restriction/]],
  ]) {
    const task={id:'synthetic-failure',status:'failed',type:'image',errorMsg:safeCustomTaskError(new Error(providerError))};
    for (const [index,language] of ['zh-CN','zh-TW','en-US'].entries()) {
      const diagnostic=buildAssistantSelectedTaskResponse([task],task.id,language);
      assert.match(diagnostic,localized[index],`${language}: safe task error retains its diagnostic category`);
      assert.doesNotMatch(diagnostic,/SYNTHETIC_PRIVATE/);
    }
  }
  await run('completed');await run('failed');await run('failed',true);console.log('PASS_CUSTOM_TASK_IDENTITY_AND_PRIVATE_METADATA');
}finally{if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts']}})().catch(error=>{console.error(error);process.exitCode=1});
