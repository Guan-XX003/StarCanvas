const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {describeApplicationGeneration,assertApplicationGenerationTarget,assertApplicationTaskCancellationTarget}=require('../src/renderer/lib/application-generation.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const config=(kind='image')=>({models:['qa-model'],apiConfigs:[],apiBindings:{},protocolBindings:{},registry:{},url:'https://qa.invalid/v1',key:'QA_SYNTHETIC_KEY',durations:'5 10',resolutions:'720p 1080p',ratios:'16:9 9:16',probe:{id:'probe',type:kind==='image'?'promptNode':'videoNode',position:{x:0,y:0},data:{drawingModel:'qa-model',videoModel:'qa-model',videoDurations:'5 10',videoModelRequestProfiles:{'qa-model':{requestType:'multipart-video'}}}}});
const wait=async fn=>{for(let i=0;i<200;i++){const r=fn();if(r.status!=='preparing'&&r.status!=='queued'&&r.status!=='running')return r;await new Promise(setImmediate);}assert.fail('No request state');};
test('generation parser is strict, preserves multiline prompt and never grants media scope from a string or flag',async()=>{
 const {parseApplicationGeneration}=await import('../electron/shared/application-generation-contract.mjs');
 assert.equal(parseApplicationGeneration('generation.image',{prompt:'line one\nline two'}).prompt,'line one\nline two');
 assert.throws(()=>parseApplicationGeneration('generation.image',{prompt:'QA',confirmed:true}),{code:'OPERATION_INVALID_REQUEST'});
 for(const [operation,args]of [['generation.image',{referenceImage:'/NO_READ'}],['generation.video',{referenceImage:'https://NO_FETCH.invalid'}],['generation.tianji',{images:['/NO_UPLOAD']}]])assert.throws(()=>parseApplicationGeneration(operation,{prompt:'QA',...args}),{code:'OPERATION_MEDIA_SCOPE_REQUIRED'});
 assert.deepEqual(parseApplicationGeneration('generation.tianji',{prompt:'QA',portraitAssetIds:['asset-one']}).portraitAssetIds,['asset-one']);
 assert.throws(()=>parseApplicationGeneration('generation.tianji',{prompt:'QA',portraitAssetIds:['asset-one'],portraitStatus:'Active'}),{code:'OPERATION_INVALID_REQUEST'});
 assert.throws(()=>parseApplicationGeneration('generation.tianji',{prompt:'QA',callbackUrl:'https://NO_CALLBACK.invalid'}),{code:'OPERATION_INVALID_REQUEST'});
});
test('effective models and parameters come from the real configured node contract; credentials never enter review',()=>{
 const image=describeApplicationGeneration('image',{prompt:'QA_PROMPT',model:'',size:'1024x1024'},config());assert.equal(image.model,'qa-model');assert.equal(image.nodeFields.imageSizeMode,'resolution');assert.equal(image.nodeFields.imageResolution,'1024x1024');
 const video=describeApplicationGeneration('video',{prompt:'QA_PROMPT',model:'qa-model',resolution:'1280x720',duration:5,aspectRatio:'16:9'},config('video'));assert.equal(video.nodeFields.selectedSeconds,'5');assert.equal(video.nodeFields.videoParameterMode,'exact-resolution');
 const tianji=describeApplicationGeneration('tianji',{prompt:'QA_PROMPT',model:'qa-model',resolution:'720p',duration:5,aspectRatio:'16:9',mode:'text-to-video'},config('video'));assert.equal(tianji.nodeFields.seedanceMode,'tianji');
 for(const review of [image,video,tianji]){assert.equal(review.priceChecked,false);assert.equal(review.networkChecked,false);assert(!JSON.stringify(review).includes('QA_SYNTHETIC_KEY'));assert(!JSON.stringify(review).includes('qa.invalid'));}
 assert.throws(()=>describeApplicationGeneration('image',{prompt:'QA',model:'invented',size:'1024x1024'},config()),{code:'OPERATION_MODEL_UNAVAILABLE'});
 assert.throws(()=>describeApplicationGeneration('image',{prompt:'QA',model:'qa-model',size:'BAD'},config()),{code:'OPERATION_PARAMETER_UNAVAILABLE'});
 assert.throws(()=>describeApplicationGeneration('image',{prompt:'QA',size:'1024x1024'},{...config(),key:''}),{code:'OPERATION_CONFIGURATION_REQUIRED'});
});
test('environment ticket permits only owned graph creation, never changed project/configuration or revived navigation',()=>{
 let state={projectId:'qa',instanceId:'a',ready:true,nodes:[],edges:[],configurationIdentity:{key:'ONE'}};
 const controller=createCanvasPlanController({read:()=>state,capabilities:()=>({}),prepareNode:()=>assert.fail('No plan'),commit:()=>assert.fail('No commit')});
 const t=controller.capture();controller.validateEnvironment(t.ticketId);state.nodes.push({id:'own',type:'textNode',position:{x:0,y:0},data:{}});controller.observe();assert.throws(()=>controller.validateRead(t.ticketId),{code:'PLAN_EXPIRED'});assert.equal(controller.validateEnvironment(t.ticketId),true);
 state.projectId='other';controller.observe();state.projectId='qa';assert.throws(()=>controller.validateEnvironment(t.ticketId),{code:'PLAN_EXPIRED'});
 const q=controller.capture();controller.validateEnvironment(q.ticketId);state.configurationIdentity.key='TWO';assert.throws(()=>controller.validateEnvironment(q.ticketId),{code:'PLAN_STALE'});
});
test('target guard rejects manual prompt/model/config/parameter changes, stopped targets and newly connected inputs',()=>{
 const fields={prompt:'QA',selectedModel:'qa-model',imageSizeMode:'resolution',imageResolution:'1024x1024'},node={id:'target',type:'promptNode',data:{...fields}};
 assertApplicationGenerationTarget([node],[],'target','promptNode','QA','qa-model',fields);
 for(const patch of [{prompt:'MANUAL'},{selectedModel:'other'},{imageResolution:'2048x2048'},{manuallyStopped:true},{selectedApiConfigId:'new'}])assert.throws(()=>assertApplicationGenerationTarget([{...node,data:{...node.data,...patch}}],[],'target','promptNode','QA','qa-model',fields),{code:'PLAN_STALE'});
 assert.throws(()=>assertApplicationGenerationTarget([node],[{source:'injected',target:'target'}],'target','promptNode','QA','qa-model',fields),{code:'PLAN_STALE'});
 const running={...node,data:{...node.data,loading:true}};
 assert.throws(()=>assertApplicationGenerationTarget([running],[],'target','promptNode','QA','qa-model',fields),{code:'PLAN_STALE'});
 assertApplicationGenerationTarget([running],[],'target','promptNode','QA','qa-model',fields,[],[],true);
 assert.throws(()=>assertApplicationGenerationTarget([{...running,data:{...running.data,manuallyStopped:true}}],[],'target','promptNode','QA','qa-model',fields,[],[],true),{code:'PLAN_STALE'});
});
test('controlled quality image review discloses an explicit ratio instead of a hidden paid Auto analysis',()=>{
 const described=describeApplicationGeneration('image',{prompt:'QA',size:'1K'},config());
 assert.equal(described.nodeFields.aspectRatio,'1:1');assert.equal(described.parameters.aspectRatio,'1:1');assert.equal(described.effectiveArguments.aspectRatio,'1:1');
});
test('paid video review rejects missing/blocked protocol and required media before approval or node creation',()=>{
 const c=config('video'),a={prompt:'QA',model:'qa-model',resolution:'1280x720',duration:5,aspectRatio:'16:9'};
 const withProfile=profile=>({...c,probe:{...c.probe,data:{...c.probe.data,videoModelRequestProfiles:{'qa-model':profile}}}});
 for(const profile of [{},{requestType:'multipart-video',blockedReason:'Unsupported mode'}])assert.throws(()=>describeApplicationGeneration('video',a,withProfile(profile)),{code:'OPERATION_CONFIGURATION_REQUIRED'});
 for(const required of ['requiresReferenceImage','requiresReferenceVideo','requiresAnyReference'])assert.throws(()=>describeApplicationGeneration('video',a,withProfile({requestType:'multipart-video',[required]:true})),{code:'OPERATION_MEDIA_SCOPE_REQUIRED'});
});
test('shared legacy video profile preserves explicit protocols, old JSON profiles and provider exceptions',()=>{
 const {resolveVideoRequestProfile:resolve}=require('../src/renderer/lib/video-request-profile.ts');
 const explicit={category:'video',requestType:'json-video',submitPath:'/CUSTOM'};
 assert.equal(resolve({modelName:'sora-2',baseUrl:'https://qa.invalid',protocol:explicit,profiles:{'sora-2':{requestType:'multipart-video'}}}),explicit);
 assert.equal(resolve({modelName:'sora-2',baseUrl:'https://qa.invalid',profiles:'{"sora-2":{"requestType":"multipart-video"}}'}).requestType,'multipart-video');
 assert.deepEqual(resolve({modelName:'sora-2',baseUrl:'https://qa.invalid'}),{});
 assert.equal(resolve({modelName:'MiniMax-Hailuo-2.3',baseUrl:'https://xpclaw.ai/v1'}).requestType,'openai-video');
 assert.equal(resolve({modelName:'MiniMax-Hailuo-2.3',baseUrl:'https://qa.invalid/v1'}).requestType,'json-video');
 assert.equal(resolve({modelName:'grok-video-3',baseUrl:'https://xpclaw.ai/v1'}).requestType,'multipart-video');
 let warned=false;resolve({modelName:'qa',baseUrl:'https://qa.invalid',profiles:'BAD',onInvalid:()=>warned=true});assert(warned);
});
function fixture(t){
 let state={projectId:'qa-project',instanceId:'a',ready:true,nodes:[],edges:[],configurationIdentity:{key:'QA_ONE'}},calls=0,stops=0;
 let task={id:'qa-task',nodeId:'qa-node',projectId:'qa-project',createdAt:1,modelName:'qa-model',type:'image',status:'running',progress:1},service;
 const canvas=createCanvasPlanController({read:()=>state,capabilities:()=>({}),prepareNode:()=>assert.fail(),commit:()=>assert.fail()});
 const generation=async(args,guard)=>{guard('create');calls++;state.nodes.push({id:'created',type:'promptNode',position:{x:0,y:0},data:{prompt:args.prompt}});canvas.observe();guard('dispatch');return {ok:true,accepted:true,nodeId:'created'};};
 const automation={describeGeneration:(kind,args)=>describeApplicationGeneration(kind,args,config(kind==='image'?'image':'video')),generateImage:generation,generateVideo:generation,generateTianjiVideo:generation,
 task:async args=>{assert.equal(args.materialize,false);return {task};},cancel:async(args,guard)=>{guard();stops++;return {ok:true};}};
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>state.projectId,getProjects:()=>[],getCanvas:()=>canvas,getAutomation:()=>automation,consume:async(id,nonce)=>service.consume(id,nonce)});
 service=createApplicationOperationService({prepare:dispatcher.prepare,commit:dispatcher.commit,release:dispatcher.release});t.after(()=>{service.close();dispatcher.close();});
 const submit=(operation,args,key='qa-generation-request-0001')=>service.submit('external',{operation,projectId:'qa-project',arguments:args,idempotencyKey:key});
 const read=h=>service.read('external',h.request.id,h.receipt);
 return {service,submit,read,get calls(){return calls;},get stops(){return stops;},get state(){return state;},setTask:value=>task={...task,...value}};
}
test('shared service generation waits for approval, is scoped/idempotent and returns submission not finished generation',async t=>{
 const f=fixture(t),h=await f.submit('generation.image',{prompt:'QA',size:'1024x1024'}),w=await wait(()=>f.read(h));assert.equal(w.status,'awaiting_confirmation');assert.equal(f.calls,0);assert.deepEqual(w.permissions,['generation.paid','canvas.edit']);
 const replay=await f.submit('generation.image',{prompt:'QA',size:'1024x1024'});assert.equal(replay.request.id,h.request.id);f.service.approve(h.request.id,w.revision);
 const r=await wait(()=>f.read(h));assert.equal(r.status,'completed');assert.equal(r.result.accepted,true);assert.equal(r.result.generationCompleted,false);assert.equal(f.calls,1);
 assert.equal((await f.submit('generation.image',{prompt:'QA',size:'1024x1024'})).replayed,true);assert.equal(f.calls,1);
});
test('project or configuration changes before approval prevent generation, not just the review UI',async t=>{
 for(const mutate of [f=>f.state.projectId='other',f=>f.state.configurationIdentity.key='CHANGED']){
  const f=fixture(t),h=await f.submit('generation.image',{prompt:'QA',size:'1024x1024'}),w=await wait(()=>f.read(h));mutate(f);f.service.approve(h.request.id,w.revision);const r=await wait(()=>f.read(h));assert.equal(r.status,'failed');assert.equal(r.code,'PLAN_STALE');assert.equal(f.calls,0);
 }
});
test('task cancellation has its own approval and target identity; no success claim for upstream cancellation',async t=>{
 const f=fixture(t),h=await f.submit('tasks.cancel',{id:'qa-task'}),w=await wait(()=>f.read(h));assert.equal(f.stops,0);assert.equal(w.status,'awaiting_confirmation');f.service.approve(h.request.id,w.revision);const r=await wait(()=>f.read(h));assert.equal(r.result.cancellationRequested,true);assert.equal(r.result.remoteStoppedConfirmed,false);assert.equal(f.stops,1);
 const other=fixture(t),q=await other.submit('tasks.cancel',{id:'qa-task'}),qw=await wait(()=>other.read(q));other.setTask({status:'completed'});other.service.approve(q.request.id,qw.revision);assert.equal((await wait(()=>other.read(q))).code,'OPERATION_TASK_CHANGED');assert.equal(other.stops,0);
});
test('stale task cancellation cannot stop a newer task on the same node or a mismatched fallback job',()=>{
 const task={id:'old-task',nodeId:'qa-node',projectId:'qa',status:'running'},node={id:'qa-node',data:{taskId:'old-task',loading:true}};
 assertApplicationTaskCancellationTarget([node],task);
 for(const data of [{taskId:'new-task',loading:true},{taskId:'old-task',loading:false},{taskId:'old-task',loading:true,manuallyStopped:true}])assert.throws(()=>assertApplicationTaskCancellationTarget([{...node,data}],task),{code:'OPERATION_TASK_CHANGED'});
 assert.throws(()=>assertApplicationTaskCancellationTarget([],task),{code:'OPERATION_TASK_CHANGED'});
 const pending={...task,id:'qa-node',status:'submitting'},blank={id:'qa-node',data:{}};
 assertApplicationTaskCancellationTarget([blank],pending,{id:'qa-node',projectId:'qa'});
 assert.throws(()=>assertApplicationTaskCancellationTarget([blank],pending,{id:'qa-node',projectId:'another'}),{code:'OPERATION_TASK_CHANGED'});
});
test('review uses effective provider overrides, normalized wire values and redacts private extras',()=>{
 const c=config('video'),a={prompt:'QA',model:'qa-model',resolution:'1280x720',duration:5,aspectRatio:'16:9'};
 const withProfile=p=>({...c,protocolBindings:{'qa-model':'qa'},registry:{qa:p},probe:{...c.probe,data:{...c.probe.data,videoModelProtocolBindings:{'qa-model':'qa'},modelProtocolRegistry:{qa:p}}}});
 let review=describeApplicationGeneration('video',a,withProfile({category:'video',requestType:'multipart-video'}));
 assert.equal(review.parameters.resolution,'1280x720');assert.equal(review.requestPreview.fields.find(f=>f.name==='size').value,'720P');
 review=describeApplicationGeneration('video',a,withProfile({category:'video',requestType:'json-video',extraBody:{model:'provider-alias',prompt:'ACTUAL_PROMPT',token:'PRIVATE_KEY',privateOption:'PRIVATE_CONFIG',callback:'https://PRIVATE_URL.invalid'}}));
 assert.equal(review.requestPreview.fields.find(f=>f.name==='model').value,'provider-alias');assert.equal(review.requestPreview.fields.find(f=>f.name==='prompt').value,'ACTUAL_PROMPT');
 assert.equal(review.requestPreview.hiddenFields,3);assert(!JSON.stringify(review.requestPreview).includes('PRIVATE_'));
 assert.throws(()=>describeApplicationGeneration('video',{...a,model:'veo-portrait'},{...withProfile({category:'video',requestType:'json-video'}),models:['veo-portrait'],url:'https://aigc.x-see.cn',protocolBindings:{'veo-portrait':'qa'}}),{code:'OPERATION_MEDIA_SCOPE_REQUIRED'});
});
test('actual canvas hook fences legacy request-profile changes even when public model choices are unchanged',()=>{
 const Module=require('node:module'),path=require('node:path'),file=path.resolve(__dirname,'../src/renderer/hooks/useCanvasOperationPlans.ts');
 const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;const original=compiled.require.bind(compiled),refs=[];let cursor=0,effects=[];
 compiled.require=name=>name==='react'?{useRef:value=>refs[cursor++]||(refs[cursor-1]={current:value}),useLayoutEffect:fn=>effects.push(fn)}:original(name);
 compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
 let profile={model:{requestType:'json-video',extraBody:{token:'PRIVATE_ONE'}}};
 const deps={projectId:'qa',nodes:[],edges:[],projectIdRef:{current:'qa'},nodesRef:{current:[]},edgesRef:{current:[]},loadedProjectRef:{current:'qa'},shouldFitViewRef:{current:true},setNodes:()=>assert.fail(),setEdges:()=>assert.fail(),prepareNodeAt:(type,position,data)=>({id:data.__nodeId,type,position,data:{videoModelRequestProfiles:profile}})};
 const render=()=>{cursor=0;effects=[];const api=compiled.exports.useCanvasOperationPlans(deps);for(const effect of effects)effect();return api;};
 const api=render(),read=api.capture();api.validateEnvironment(read.ticketId);assert(!JSON.stringify(read).includes('PRIVATE_'));
 profile={model:{requestType:'json-video',extraBody:{token:'PRIVATE_TWO'}}};assert.equal(render(),api);
 assert.throws(()=>api.validateEnvironment(read.ticketId),{code:'PLAN_EXPIRED'});
 profile={model:{requestType:'json-video',extraBody:{token:'PRIVATE_ONE'}}};render();assert.throws(()=>api.validateEnvironment(read.ticketId),{code:'PLAN_EXPIRED'});
});
