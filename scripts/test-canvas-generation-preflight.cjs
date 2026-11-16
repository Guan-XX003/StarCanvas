const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {canvasGenerationApiPresence:presence,inspectCanvasGenerationPreflight:inspect,canvasNodeTaskBusy}=require('../src/renderer/lib/canvas-generation-preflight.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const caps={textNode:{models:['qa-text'],parameters:{}},promptNode:{models:['qa-image'],parameters:{}},videoNode:{models:['qa-video'],parameters:{}}};
const node=(id,type,data={})=>({id,type,position:{x:0,y:0},data});
const credentials={url:'https://DO_NOT_REQUEST.invalid/v1',key:'PRIVATE_SYNTHETIC_KEY'};
test('API presence follows actual category bindings and fallback without returning private data',()=>{
 for(const [type,kind,bindings,model]of [['textNode','text','textModelApiBindings','qa-text'],['promptNode','image','imageModelApiBindings','qa-image'],['videoNode','video','videoModelApiBindings','qa-video']]){
  const n=node('qa',type,{selectedModel:model,[bindings]:{[model]:'qa-api'},apiConfigs:[{id:'qa-api',...credentials}]});
  assert.equal(presence(n,{}),'present');
  n.data.apiConfigs=[];assert.equal(presence(n,{[kind]:credentials}),'missing-binding');
  n.data[bindings]={};assert.equal(presence(n,{[kind]:credentials}),'present');
  assert.equal(presence(n,{}),'missing');
 }
 assert.equal(presence(node('asset','imageNode',{imageUrl:'PRIVATE_MEDIA'}),{}),'not-required');
});
test('explicit image/video config wins; ignored text override, managed secrets and partial configs are not declared ready',()=>{
 for(const [type,bindings,model]of [['promptNode','imageModelApiBindings','qa-image'],['videoNode','videoModelApiBindings','qa-video']]){
  const n=node('qa',type,{selectedModel:model,selectedApiConfigId:'explicit',[bindings]:{[model]:'bound'},apiConfigs:[{id:'explicit',...credentials}]});
  assert.equal(presence(n,{}),'present');n.data.apiConfigs[0].key='';assert.equal(presence(n,{image:credentials,video:credentials}),'missing');
  n.data.apiConfigs[0].key='__WANJUAN_MANAGED_RELAY__';assert.equal(presence(n,{}),'unverified');
  n.data.apiConfigs[0]={id:'explicit',...credentials,managed:true};assert.equal(presence(n,{}),'unverified');
 }
 assert.equal(presence(node('qa','textNode',{selectedModel:'qa-text',selectedApiConfigId:'ignored',textModelApiBindings:{'qa-text':'actual'}}),{}),'unverified');
 assert.equal(presence(node('qa','textNode',{}),{text:{url:'file:///PRIVATE',key:'PRIVATE'}}),'missing');
});
test('local inspection is pure, deduplicated, contains no prompts/media/config and grants no generation authority',()=>{
 const state={nodes:[node('source','textNode',{text:'PRIVATE_CONTENT'}),node('image','promptNode',{prompt:'PRIVATE_PROMPT',selectedModel:'qa-image',apiConfigs:[credentials],imageUrl:'file:///PRIVATE_MEDIA'})],edges:[{source:'source',target:'image'}]};
 const before=JSON.stringify(state),oldFetch=global.fetch;global.fetch=()=>assert.fail('preflight must not access a network');
 try{
  const result=inspect(state,['source','image','image'],caps,()=> 'present','proposal');
  assert.equal(result.nodes.length,2);assert(result.nodes.every(n=>n.locallyReady));
  assert.equal(result.basis,'proposal');for(const key of ['generationStarted','canGenerate','networkChecked','balanceChecked'])assert.equal(result[key],false);
  const output=JSON.stringify(result);for(const value of ['PRIVATE_CONTENT','PRIVATE_PROMPT','PRIVATE_MEDIA','PRIVATE_SYNTHETIC_KEY','DO_NOT_REQUEST'])assert(!output.includes(value));
  assert.equal(JSON.stringify(state),before);
 }finally{global.fetch=oldFetch;}
});
test('reference readiness distinguishes missing/pending/unsupported source fields and actual text sources',()=>{
 const nodes=[node('text','textNode',{text:'QA_SOURCE'}),node('empty','promptNode',{}),node('asset','imageNode',{imageUrl:'PRIVATE_REFERENCE'}),node('other','audioNode',{}),node('video','videoNode',{prompt:'QA',selectedModel:'qa-video'})];
 for(const [source,expected]of [['text','ready'],['empty','pending'],['asset','ready'],['other','unverified'],['deleted','missing']]){
  const result=inspect({nodes,edges:[{source,target:'video'}]},['video'],caps,()=> 'present');assert.equal(result.nodes[0].references,expected);
  assert.equal(result.nodes[0].locallyReady,expected==='ready');
 }
 const result=inspect({nodes,edges:[]},['text','asset','deleted','empty'],caps);
 assert.equal(result.nodes[0].mode,'text-source');assert.equal(result.nodes[0].model,'not-required');assert.equal(result.nodes[0].configuration,'not-required');
 assert.equal(result.nodes[1].mode,'reference');assert.equal(result.nodes[2].mode,'missing');assert.equal(result.nodes[3].input,false);assert.equal(result.nodes[3].locallyReady,false);
});
test('unconfigured models and queued/running flags never become locally ready',()=>{
 for(const status of ['pending','queued','running','processing','submitted'])assert(canvasNodeTaskBusy(node('qa','promptNode',{taskStatus:status})));
 for(const data of [{loading:true},{generating:true},{taskStatus:'queued'}]){
  const n=node('qa','promptNode',{prompt:'QA',selectedModel:'qa-image',...data}),result=inspect({nodes:[n],edges:[]},['qa'],caps,()=> 'present');assert.equal(result.nodes[0].taskIdle,false);assert.equal(result.nodes[0].locallyReady,false);
 }
 const n=node('qa','promptNode',{prompt:'QA',selectedModel:'invented'});assert.equal(inspect({nodes:[n],edges:[]},['qa'],caps,()=> 'present').nodes[0].model,'unconfirmed');
 assert.equal(inspect({nodes:[n],edges:[]},['qa'],{...caps,'node:qa':{models:['invented'],parameters:{}}},()=> 'present').nodes[0].model,'available');
});
function controllerFixture(){
 let state={projectId:'QA_PROJECT',instanceId:'QA_MOUNT',ready:true,nodes:[node('source','textNode',{text:'QA_SOURCE'}),node('image','promptNode',{prompt:'QA_IMAGE',selectedModel:'qa-image'})].map(n=>({...n,selected:true})),edges:[]},serial=0,clock=1,commits=0;
 const controller=createCanvasPlanController({read:()=>state,capabilities:()=>caps,apiPresence:()=> 'present',id:()=>`QA-${++serial}`,now:()=>clock,
  prepareNode:(type,position,data)=>({id:data.__nodeId,type,position,data}),commit:(_before,after)=>{commits++;state=after;}});
 const r=controller.capture(),p=controller.preview(r.ticketId,{version:1,operations:[{op:'connect',source:'source',target:'image'}]});
 return {controller,p,get state(){return state;},get commits(){return commits;},expire(){clock+=11*60*1000;}};
}
test('connection-only plans include both endpoints; preflight before and after apply never commits or authorizes',()=>{
 const f=controllerFixture();assert.equal(f.p.generationPreflight.basis,'proposal');
 assert.deepEqual(f.controller.preflight(f.p.planId).nodes.map(n=>n.nodeId),['source','image']);assert.equal(f.commits,0);
 const result=f.controller.execute(f.p.planId);assert.deepEqual(result.affectedNodeIds,['source','image']);
 const current=f.controller.preflight(f.p.planId);assert.equal(current.basis,'current');assert.equal(current.canGenerate,false);assert.equal(f.commits,1);
 f.state.nodes[1].data.loading=true;f.controller.observe();assert.equal(f.controller.preflight(f.p.planId).nodes[1].taskIdle,false);
 f.state.nodes.pop();assert.equal(f.controller.preflight(f.p.planId).nodes[1].mode,'missing');assert.equal(f.commits,1);
 assert.throws(()=>f.controller.undo(f.p.planId),{code:'PLAN_UNDO_CONFLICT'});
});
test('preview preflight respects stale/project/mount/readiness/expiry fences; applied check does not revive undo',()=>{
 for(const change of [f=>f.state.nodes[0].data.text='MANUAL',f=>f.state.projectId='OTHER',f=>f.state.instanceId='OTHER']){
  const f=controllerFixture();change(f);assert.throws(()=>f.controller.preflight(f.p.planId),{code:'PLAN_STALE'});assert.equal(f.commits,0);
 }
 const f=controllerFixture();f.state.ready=false;assert.throws(()=>f.controller.preflight(f.p.planId),{code:'PLAN_CANVAS_NOT_READY'});
 const expired=controllerFixture();expired.expire();assert.throws(()=>expired.controller.preflight(expired.p.planId),{code:'PLAN_EXPIRED'});
 const applied=controllerFixture();applied.controller.execute(applied.p.planId);applied.state.projectId='OTHER';assert.throws(()=>applied.controller.preflight(applied.p.planId),{code:'PLAN_STALE'});
 const undone=controllerFixture();undone.controller.execute(undone.p.planId);undone.controller.undo(undone.p.planId);assert.throws(()=>undone.controller.preflight(undone.p.planId),{code:'PLAN_ALREADY_CONSUMED'});
});
test('preflight labels cover every status in all three locales without credential or live-access claims',()=>{
 const {assistantPreflightCopy}=require('../src/renderer/lib/assistant-preflight-copy.ts');
 for(const language of ['zh-CN','zh-TW','en-US']){
  const c=assistantPreflightCopy(language);for(const value of Object.values(c))if(typeof value==='string')assert(value.length);
  for(const key of ['available','unconfirmed','present','missing','missing-binding','unverified','not-required','ready','pending','none'])assert(c.status[key]);
  for(const key of ['generation','reference','text-source','missing'])assert(c.mode[key]);
 }
});
