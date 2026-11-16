const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationGenerationExecution:create}=require('../src/renderer/lib/application-generation-execution.ts');
const error=code=>Object.assign(Error(code),{code});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tianjiParameters=(extra={})=>({kind:'tianji',model:'fixture-model',resolution:'720p',duration:5,aspectRatio:'16:9',mode:'text-to-video',generateAudio:true,watermark:false,...extra});

test('one root-only fence allows approved input uploads, one submit, and no later paid retry',async()=>{
 const checks=[],e=create((stage,binding)=>checks.push([stage,binding]),()=>checks.push('sync'));let calls=0;
 await e.upload(()=>++calls);await e.upload(()=>++calls);
 await e.submit(()=>++calls,'PRIVATE_CONFIG');await e.waitForSubmission(Promise.resolve());
 await assert.rejects(e.submit(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});
 await assert.rejects(e.upload(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});
 assert.equal(calls,3);assert.deepEqual(checks.filter(Array.isArray),[['upload',undefined],['upload',undefined],['submit','PRIVATE_CONFIG']]);
 assert.equal(JSON.stringify(e),'{}','private closures must not serialize to project/task content');
});
test('parallel submission claims before asynchronous validation; only one transport invocation',async()=>{
 const d=deferred(),e=create(()=>d.promise,()=>{});let calls=0;
 const first=e.submit(()=>++calls);await assert.rejects(e.submit(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});assert.equal(calls,0);
 d.resolve();await first;assert.equal(calls,1);
});
test('a racing input validation failure cannot be revived by a later successful submission validation',async()=>{
 const upload=deferred(),submit=deferred(),e=create(stage=>stage==='upload'?upload.promise:submit.promise,()=>{});let calls=0;
 const a=e.upload(()=>++calls),b=e.submit(()=>++calls);upload.resolve();await assert.rejects(a,{code:'OPERATION_ALREADY_CONSUMED'});submit.resolve();
 await assert.rejects(b,{code:'OPERATION_ALREADY_CONSUMED'});assert.equal(calls,0);await assert.rejects(e.waitForSubmission(Promise.resolve()),{code:'OPERATION_ALREADY_CONSUMED'});
});
test('failed validation is terminal even if an existing upload fallback catches the error',async()=>{
 const e=create(()=>{throw error('PLAN_STALE');},()=>{});let calls=0;
 await assert.rejects(e.upload(()=>++calls),{code:'PLAN_STALE'});
 await assert.rejects(e.upload(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});
 await assert.rejects(e.submit(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});
 await assert.rejects(e.waitForSubmission(Promise.resolve()),{code:'PLAN_STALE'});assert.equal(calls,0);
});
test('transport failure consumes the one attempt, while ordinary upload failure can use an approved fallback',async()=>{
 const e=create(()=>{},()=>{});let calls=0;
 await assert.rejects(e.upload(()=>{calls++;throw Error('upload unavailable');}));
 await e.upload(()=>++calls);
 await assert.rejects(e.submit(()=>{calls++;return Promise.reject(Error('unknown network outcome'));}));
 await e.waitForSubmission(Promise.resolve());
 await assert.rejects(e.submit(()=>++calls),{code:'OPERATION_ALREADY_CONSUMED'});assert.equal(calls,3);
});
test('normal hook ending without reaching its sender cannot be reported as accepted',async()=>{
 const e=create(()=>{},()=>{});await assert.rejects(e.waitForSubmission(Promise.resolve()),{code:'OPERATION_NOT_SUBMITTED'});
 await assert.rejects(e.submit(()=>assert.fail()),{code:'OPERATION_ALREADY_CONSUMED'});
});
test('last synchronous target check follows asynchronous validation, immediately before actual send',async()=>{
 let stopped=false,calls=0;const d=deferred(),e=create(async()=>{await d.promise;},()=>{if(stopped)throw error('PLAN_STALE');});
 const pending=e.submit(()=>++calls);stopped=true;d.resolve();await assert.rejects(pending,{code:'PLAN_STALE'});
 await assert.rejects(e.waitForSubmission(pending),{code:'PLAN_STALE'});assert.equal(calls,0);
});
test('a slow original run settles the same observer and does not execute on observation',async()=>{
 const d=deferred(),e=create(()=>{},()=>{});let calls=0,observed=false;
 const pending=(async()=>{await d.promise;return e.submit(()=>++calls);})();
 const observer=e.waitForSubmission(pending).then(()=>{observed=true;});await new Promise(setImmediate);assert.equal(observed,false);assert.equal(calls,0);
 d.resolve();await observer;await pending;await e.waitForSubmission(pending);assert.equal(calls,1);
});

// Reuse actual-hook synthetic fixtures, not a replacement request builder.
const {runCase}=require('./test-h3-video.cjs');
const {runDirectCase}=require('./test-media-canvas-flow.cjs');
test('actual image OpenAI/Ark/Gemini senders enforce the fence and retain normal result handling',async()=>{
 const rows=[
  {modelName:'gpt-image-1',baseUrl:'https://fixture.invalid',expectedUrl:'https://fixture.invalid/v1/images/generations',response:{data:[{url:'https://fixture.invalid/result.png'}]}},
  {modelName:'doubao-seedream-4-0',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',expectedUrl:'https://ark.cn-beijing.volces.com/api/v3/images/generations',response:{data:[{url:'https://fixture.invalid/result.png'}]}},
  {modelName:'gemini-3.1-flash-image',baseUrl:'https://generativelanguage.googleapis.com/v1beta',expectedUrl:'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=fixture-key',response:{candidates:[{content:{parts:[{inline_data:{mime_type:'image/png',data:'Z2VuZXJhdGVk'}}]}}]}}
 ];
 for(const row of rows){
  let checks=0;const e=create(stage=>{assert.equal(stage,'submit');checks++;},()=>{});
  const run=runDirectCase({...row,expectedImage:'data:image/png;base64,Z2VuZXJhdGVk',execution:e});await Promise.all([run,e.waitForSubmission(run)]);assert.equal(checks,1);
  const blocked=create(()=>{throw error('PLAN_STALE');},()=>{}),bad=runDirectCase({...row,execution:blocked,expectBlocked:true});
  await assert.rejects(blocked.waitForSubmission(bad),{code:'PLAN_STALE'});await bad;
 }
});
test('controlled Auto image does not make a hidden paid text-model request',async()=>{
 const e=create(()=>{},()=>{}),run=runDirectCase({modelName:'gemini-3.1-flash-image',baseUrl:'https://generativelanguage.googleapis.com/v1beta',expectedUrl:'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=fixture-key',response:{candidates:[{content:{parts:[{inline_data:{mime_type:'image/png',data:'Z2VuZXJhdGVk'}}]}}]},expectedImage:'data:image/png;base64,Z2VuZXJhdGVk',aspectRatio:'Auto',imageSizeMode:'quality',size:'1K',execution:e});
 await Promise.all([run,e.waitForSubmission(run)]);assert.equal((await run).requests.length,1);
});
test('actual generic, Tongyi, native Ark and Tianji video senders preserve polling without reusing submission authority',async()=>{
 const rows=[
  {model:'qa-json',profileName:'qa',profile:{category:'video',requestType:'json-video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',__wanjuanPreferExplicitProtocol:true}},
  {model:'qa-multipart',profileName:'qa',profile:{category:'video',requestType:'multipart-video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',__wanjuanPreferExplicitProtocol:true}},
  {nodeType:'tongyiWanxiangNode',model:'wan-fixture',profileName:''},
  {model:'doubao-seedance-2-5-260628',profileName:'',apiUrl:'https://ark.cn-beijing.volces.com/api/v3',pollPayloads:[{status:'succeeded',content:{video_url:'https://fixture.invalid/result.mp4'}}]},
  {nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,duration:5,pollPayloads:[{code:200,data:{status:'success',video_url:'https://fixture.invalid/result.mp4'}}]}
 ];
 for(const row of rows){
  const checks=[],parameters=row.tianjiMode?tianjiParameters():undefined,e=create((stage,binding)=>checks.push({stage,binding}),()=>{},parameters),run=runCase({...row,execution:e});await Promise.all([run,e.waitForSubmission(run)]);const good=await run;
  assert.equal(checks.length,1,JSON.stringify(row));assert.equal(checks[0].stage,'submit');if(row.tianjiMode)assert.match(checks[0].binding,/synthetic-key/);
  assert.equal(good.tasks[0]?.status,'completed',JSON.stringify({row,notices:good.notices,requests:good.requests.map(r=>r.url)}));
  if(!row.tianjiMode)assert.equal(good.tasks[0]?.clientSubmissionId,e.submissionId,'canonical tasks retain only the non-authorizing correlation ID');
  for(const r of good.requests)if(typeof r.init?.body==='string')assert(!r.init.body.includes(e.submissionId),'task correlation does not alter provider payloads');
  assert(good.requests.length>=2,'normal polling must continue after submission');
  const blocked=create(()=>{throw error('PLAN_STALE');},()=>{},parameters),bad=runCase({...row,execution:blocked});await assert.rejects(blocked.waitForSubmission(bad),{code:'PLAN_STALE'});assert.equal((await bad).requests.length,0);
 }
});
test('actual video upload fallbacks cannot bypass a refused scope check',async()=>{
 for(const row of [
  {model:'qa-json',profileName:'qa',profile:{category:'video',requestType:'json-video',submitPath:'/v1/videos',pollPath:'/v1/videos/{taskId}',referenceImageMode:'url',__wanjuanPreferExplicitProtocol:true}},
  {nodeType:'tongyiWanxiangNode',model:'wan-fixture',profileName:'',nodeData:{tongyiWanxiangMode:'image-to-video'}},
  {model:'doubao-seedance-2-5-260628',profileName:'',apiUrl:'https://ark.cn-beijing.volces.com/api/v3'},
  {nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,tianjiGenerationMode:'reference-media'}
 ]){
  let checks=0;const e=create(stage=>{assert.equal(stage,'upload');checks++;throw error('PLAN_SESSION_CHANGED');},()=>{},row.tianjiMode?tianjiParameters({mode:'reference-media'}):undefined),run=runCase({...row,mediaKind:'image',execution:e});
  await assert.rejects(e.waitForSubmission(run),{code:'PLAN_SESSION_CHANGED'});const bad=await run;assert.equal(bad.requests.length,0);assert.equal(bad.uploadCalls,0);assert.equal(checks,1);
 }
});
function asyncImageFixture(model,baseUrl,reference=false){
 const {useImageGeneration}=require('../src/renderer/hooks/useImageGeneration.ts');let nodes=[{id:'qa-image',type:'promptNode',data:{prompt:'QA',selectedModel:model,aspectRatio:'1:1',imageSizeMode:'quality',imageSize:'1K'}}],edges=[],tasks=[],requests=[],uploads=0;
 if(reference){nodes.push({id:'qa-source',type:'imageNode',data:{imageUrl:'data:image/png;base64,aGVsbG8=',mediaKind:'image'}});edges.push({id:'qa-edge',source:'qa-source',target:'qa-image'});}
 window.wanjuanDesktop.uploadPublicMedia=async()=>{uploads++;return {ok:true,url:'https://fixture.invalid/approved.png'};};
 global.fetch=async(url,init)=>{assert.equal(new URL(String(url)).hostname,new URL(baseUrl).hostname);requests.push({url:String(url),method:init.method});return Response.json(init.method==='POST'?{code:200,data:{id:'qa-async'}}:{code:200,data:{status:3,message:'system busy'}});};
 const {generateImage}=useImageGeneration({propImageApiKey:'SYNTHETIC_ONLY',propImageApiUrl:baseUrl,drawingModel:model,apiConfigs:[],imageModelApiBindings:{},imageModelProtocolBindings:{},modelProtocolRegistry:{},planLimits:{},membership:{},showToast(){},getNodes:()=>nodes,getEdges:()=>edges,setNodes:v=>{nodes=typeof v==='function'?v(nodes):v;},setEdges:v=>{edges=typeof v==='function'?v(edges):v;},updateTaskList:v=>{tasks=typeof v==='function'?v(tasks):v;},addGeneratedAsset(){},abortControllersRef:{current:new Map()},localforageModule:{default:{setItem:async()=>{}}},projectIdRef:{current:'QA'},setDailyGenerationCount(){},audioApiKey:0,timeoutSeconds:5,propTextApiUrl:'',propTextApiKey:'',textModel:''});
 return {run:e=>generateImage('qa-image','QA','1K',model,undefined,e),get requests(){return requests;},get tasks(){return tasks;},get uploads(){return uploads;}};
}
test('actual Ark and asynchronous image input upload paths refuse stale scope before IO',async()=>{
 for(const [model,url]of [['doubao-seedream-4-0','https://ark.cn-beijing.volces.com/api/v3'],['GPT-Image-2','https://fixture.invalid/api/async/image_gpt']]){
  let checks=0;const f=asyncImageFixture(model,url,true),e=create(stage=>{assert.equal(stage,'upload');checks++;throw error('PLAN_STALE');},()=>{}),run=f.run(e);
  await assert.rejects(e.waitForSubmission(run),{code:'PLAN_STALE'});await run;assert.equal(checks,1);assert.equal(f.uploads,0);assert.equal(f.requests.length,0);
 }
});
test('actual asynchronous image busy response cannot automatically resubmit a paid controlled operation',async()=>{
 const f=asyncImageFixture('GPT-Image-2','https://fixture.invalid/api/async/image_gpt'),checks=[],e=create(stage=>checks.push(stage),()=>{}),run=f.run(e);
 await e.waitForSubmission(run);await run;
 assert.deepEqual(f.requests.map(r=>r.method),['POST','GET']);assert.deepEqual(checks,['submit']);assert.equal(f.tasks[0].status,'failed');
 await assert.rejects(e.submit(()=>assert.fail('no repeated POST')),{code:'OPERATION_ALREADY_CONSUMED'});
});
test('approved Tianji model and ratio cannot be replaced by unrelated general Seedance node defaults',async()=>{
 const {describeApplicationGeneration}=require('../src/renderer/lib/application-generation.ts'),{use_createNodeAt}=require('../src/renderer/hooks/use_createNodeAt.ts');
 const args={prompt:'QA',model:'fixture-model',resolution:'720p',duration:5,aspectRatio:'16:9',mode:'text-to-video'},configuration={models:['fixture-model'],apiConfigs:[],url:'https://fixture.invalid',key:'synthetic-key',resolutions:'720p',durations:'5',ratios:'16:9',generateAudio:false,watermark:true};
 const d=describeApplicationGeneration('tianji',args,configuration),factory=use_createNodeAt({nodesRef:{current:[]},projectIdRef:{current:'QA'},tianjiSeedanceModel:'unrelated-model',seedanceRatios:'9:16',seedanceGenerateAudio:true,seedanceWatermark:false}),node=factory.prepareNodeAt('seedanceNode',{x:0,y:0},{__nodeId:'qa-controlled',...d.nodeFields});
 const e=create(()=>{},()=>{},{kind:'tianji',...d.effectiveArguments}),run=runCase({nodeType:'seedanceNode',prompt:args.prompt,model:args.model,profileName:'',tianjiMode:true,tianjiConfig:{generateAudio:false,watermark:true},nodeData:node.data,resolution:args.resolution,duration:args.duration,ratio:args.aspectRatio,execution:e,pollPayloads:[{code:200,data:{status:'success',video_url:'https://fixture.invalid/result.mp4'}}]});
 await Promise.all([run,e.waitForSubmission(run)]);const result=await run,body=new URLSearchParams(result.requests[0].init.body);assert.equal(body.get('model_name'),args.model);assert.equal(body.get('ratio'),args.aspectRatio);assert.equal(body.get('generate_audio'),'false');assert.equal(body.get('watermark'),'true');
 assert.deepEqual(Object.fromEntries(d.requestPreview.fields.map(f=>[f.name,f.value])),Object.fromEntries(body));assert.equal(JSON.stringify(e),'{}');assert(Object.isFrozen(e.tianjiParameters()));
});
test('all four controlled Tianji modes preserve reviewed scalar fields and normal reference field shapes',async()=>{
 const {describeApplicationGeneration}=require('../src/renderer/lib/application-generation.ts');
 for(const [mode,count,names]of [['text-to-video',0,[]],['first-frame',1,['first_frame']],['first-last',2,['first_frame','last_frame']],['reference-media',1,['images[]']]]){
  const references=Array.from({length:count},()=>({referenceId:'reference-'+crypto.randomUUID(),type:'image',mime:'image/png',size:68,sha256:'b'.repeat(64),expiresAt:Date.now()+10000})),args={prompt:'QA',model:'fixture-model',mode,resolution:'720p',duration:5,aspectRatio:'16:9',references:references.map(r=>r.referenceId)},d=describeApplicationGeneration('tianji',args,{models:['fixture-model'],apiConfigs:[],url:'https://fixture.invalid',key:'synthetic-key',resolutions:'720p',durations:'5',ratios:'16:9',generateAudio:false,watermark:true,referenceMedia:references});
  const e=create(()=>{},()=>{},{kind:'tianji',...d.effectiveArguments}),run=runCase({nodeType:'seedanceNode',prompt:'QA',model:args.model,profileName:'',tianjiMode:true,tianjiGenerationMode:mode,duration:5,mediaKind:count?'image':'',secondImage:count===2,nodeData:{size:'9:16',selectedResolution:'1080p',selectedSeconds:'10',tianjiSeedanceModel:'unrelated',seedanceRatios:'9:16',generateAudio:true,watermark:false},execution:e,pollPayloads:[{code:200,data:{status:'success',video_url:'https://fixture.invalid/result.mp4'}}]});
  await Promise.all([run,e.waitForSubmission(run)]);const r=await run,body=new URLSearchParams(r.requests[0].init.body);assert.equal(r.tasks[0].status,'completed');
  assert.deepEqual(Object.fromEntries(d.requestPreview.fields.map(f=>[f.name,f.value])),Object.fromEntries([...body].filter(([name])=>!names.includes(name))));assert.deepEqual([...new Set([...body.keys()].filter(name=>names.includes(name)))],names);assert.equal(d.requestPreview.hiddenFields,names.length);
 }
});
test('controlled Tianji generation cannot silently invoke the legacy Jixin configuration sync writer',async()=>{
 const {WANJUAN_JIXIN_DEFAULT_API_CONFIG_ID}=require('../src/renderer/lib/jixin-catalog.ts');
 const options={nodeType:'seedanceNode',model:'fixture-model',profileName:'',tianjiMode:true,duration:5,tianjiConfig:{syncSource:'jixin'},tianjiStored:{apiConfigs:[{id:WANJUAN_JIXIN_DEFAULT_API_CONFIG_ID,url:'https://fixture.invalid',key:'JIXIN_SYNTHETIC_ONLY'}]},pollPayloads:[{code:200,data:{status:'success',video_url:'https://fixture.invalid/result.mp4'}}]};
 const e=create(()=>{},()=>{},tianjiParameters()),run=runCase({...options,execution:e});await Promise.all([run,e.waitForSubmission(run)]);const controlled=await run;assert.equal(controlled.tianjiStorageWrites.length,0);assert.equal(controlled.requests[0].init.headers.Authorization,'Bearer synthetic-key');
 const manual=await runCase(options);assert.equal(manual.tianjiStorageWrites.length,1,'existing manual sync behavior retained');assert.equal(manual.requests[0].init.headers.Authorization,'Bearer JIXIN_SYNTHETIC_ONLY');
});
