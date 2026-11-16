const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createCanvasPlanController,parseCanvasPlan,canvasPlanStateSignature}=require('../src/renderer/lib/canvas-operation-plan.ts');
function fixture(){
 let state={projectId:'synthetic-project',instanceId:'mount-A',ready:true,nodes:[
  {id:'old-text',type:'textNode',position:{x:0,y:0},selected:true,data:{text:'PRIVATE_TEXT',selectedModel:'text-one',apiConfigs:[{key:'PRIVATE_KEY'}]}},
  {id:'old-image',type:'imageNode',position:{x:0,y:300},selected:true,data:{imageUrl:'file:///PRIVATE_PATH/image.png',projectAssetBindings:{imageUrl:{assetId:'asset-fixture'}}}},
  {id:'hidden-video',type:'videoNode',position:{x:0,y:600},data:{videoUrl:'file:///PRIVATE_PATH/movie.mp4'}},
 ],edges:[]};
 let capabilities={textNode:{models:['text-one'],parameters:{}},promptNode:{models:['image-one'],parameters:{imageSize:['1K','2K'],aspectRatio:['Auto','16:9']}},videoNode:{models:['video-one','video-two'],parameters:{selectedSeconds:['5','10']},modelParameters:{'video-one':{selectedSeconds:['5','10']},'video-two':{selectedSeconds:['6']}}}};
 let count=0,commits=0,prepared=0,clock=1000;
 const generate=()=>assert.fail('plans must never generate');
 const controller=createCanvasPlanController({read:()=>state,capabilities:()=>capabilities,id:()=>`fixture-${++count}`,now:()=>clock,
  prepareNode(type,position,data){prepared++;return {id:data.__nodeId,type,position:{...position},data:{...Object.fromEntries(Object.entries(data).filter(([k])=>k!=='__nodeId')),onGenerate:generate}};},
  commit(before,after){assert.equal(canvasPlanStateSignature(state),canvasPlanStateSignature(before));commits++;state=after;},
 });
 return {controller,get state(){return state;},set state(v){state=v;},get capabilities(){return capabilities;},get commits(){return commits;},get prepared(){return prepared;},advance(){clock+=11*60*1000;}};
}
const proposal=operations=>({version:1,operations});
const create=(key='image',kind='image',fields={prompt:'SYNTHETIC_DRAFT',selectedModel:'image-one',imageSize:'2K'})=>({op:'create',key,kind,fields,position:{x:400,y:0}});
const rejects=(fn,code)=>assert.throws(fn,{code});

test('capture defaults to selected structure, never prompts, file paths, media or keys',()=>{
 const f=fixture();f.capabilities['node:hidden-video']={models:['PRIVATE_HIDDEN_MODEL'],parameters:{}};
 const read=f.controller.capture(),serialized=JSON.stringify(read);
 assert.deepEqual(read.nodes.map(n=>n.id),['old-text','old-image']);
 for(const secret of ['PRIVATE_TEXT','PRIVATE_KEY','PRIVATE_PATH','file:','PRIVATE_HIDDEN_MODEL'])assert.equal(serialized.includes(secret),false);
 assert.equal(read.nodes[1].hasImage,true);
 assert.equal(JSON.stringify(f.controller.capture({includeContent:true})).includes('PRIVATE_TEXT'),true);
 rejects(()=>f.controller.capture({scope:'all'}),'PLAN_INVALID');
});
test('actual create/update/reference/connect/move batch is prepared without changes, committed once and safely undone',()=>{
 const f=fixture(),before=canvasPlanStateSignature(f.state),read=f.controller.capture();
 const preview=f.controller.preview(read.ticketId,proposal([create(),{op:'reference',key:'copy',source:'old-image',position:{x:0,y:320}},
  {op:'update',node:'old-text',fields:{text:'EDITED_FIXTURE'}},{op:'connect',source:'old-text',target:'image'},
  {op:'connect',source:'copy',target:'image'},{op:'move',node:'old-image',position:{x:100,y:200}}]));
 assert.equal(f.commits,0);assert.equal(canvasPlanStateSignature(f.state),before);
 assert.deepEqual(preview.counts,{created:1,updated:1,connected:2,moved:1,references:1});
 const result=f.controller.execute(preview.planId);assert.equal(result.generationStarted,false);assert.equal(f.commits,1);assert.equal(f.state.nodes.length,5);assert.equal(f.state.edges.length,2);
 assert.equal(f.state.nodes[0].data.text,'EDITED_FIXTURE');
 const copy=f.state.nodes.at(-1);assert.deepEqual(copy.data.projectAssetBindings,{imageUrl:{assetId:'asset-fixture'}});
 assert.equal(typeof f.state.nodes.at(-2).data.onGenerate,'function');
 assert.equal(f.controller.execute(preview.planId).replayed,true);assert.equal(f.commits,1);
 assert.equal(f.controller.undo(preview.planId).status,'undone');assert.equal(canvasPlanStateSignature(f.state),before);
 assert.equal(f.controller.undo(preview.planId).replayed,true);assert.equal(f.commits,2);
 rejects(()=>f.controller.execute(preview.planId),'PLAN_ALREADY_CONSUMED');
});
test('the whole plan is validated before committing: later invalid fields never leave early nodes',()=>{
 const f=fixture(),read=f.controller.capture(),before=canvasPlanStateSignature(f.state);
 rejects(()=>f.controller.preview(read.ticketId,proposal([create(),{op:'update',node:'old-text',fields:{apiKey:'NO_SECRET_INPUT'}}])),'PLAN_PARAMETER_UNAVAILABLE');
 assert.equal(f.prepared,1);assert.equal(f.commits,0);assert.equal(canvasPlanStateSignature(f.state),before);
});
test('missing, unexposed or generating nodes are not editable/referenced/connected',()=>{
 const f=fixture(),read=f.controller.capture();
 for(const id of ['missing','hidden-video'])rejects(()=>f.controller.preview(read.ticketId,proposal([{op:'move',node:id,position:{x:5,y:5}}])),'PLAN_NODE_OUT_OF_SCOPE');
 f.state.nodes[0].data.loading=true;const running=f.controller.capture();
 rejects(()=>f.controller.preview(running.ticketId,proposal([{op:'update',node:'old-text',fields:{text:'NO'}}])),'PLAN_NODE_BUSY');assert.equal(f.commits,0);
});
test('fabricated models and per-model invalid parameters are rejected, not normalized into another request',()=>{
 const f=fixture(),read=f.controller.capture();
 rejects(()=>f.controller.preview(read.ticketId,proposal([create('wrong','image',{selectedModel:'invented-model'})])),'PLAN_PARAMETER_UNAVAILABLE');
 rejects(()=>f.controller.preview(read.ticketId,proposal([create('wrong','video',{selectedModel:'video-two',selectedSeconds:'5'})])),'PLAN_PARAMETER_UNAVAILABLE');
 f.controller.preview(read.ticketId,proposal([create('valid','video',{selectedModel:'video-two',selectedSeconds:'6'})]));assert.equal(f.commits,0);
});
test('node-specific options win over global defaults',()=>{
 const f=fixture();f.capabilities['node:old-text']={models:['node-only'],parameters:{}};
 const read=f.controller.capture();
 rejects(()=>f.controller.preview(read.ticketId,proposal([{op:'update',node:'old-text',fields:{selectedModel:'text-one'}}])),'PLAN_PARAMETER_UNAVAILABLE');
 const p=f.controller.preview(read.ticketId,proposal([{op:'update',node:'old-text',fields:{selectedModel:'node-only'}}]));f.controller.execute(p.planId);assert.equal(f.state.nodes[0].data.selectedModel,'node-only');
});
test('manual content, position, task and config changes invalidate an old confirmed plan',()=>{
 for(const mutate of [f=>f.state.nodes[0].data.text='manual',f=>f.state.nodes[0].position.x=99,f=>f.state.nodes[0].data.loading=true,f=>f.capabilities.promptNode.models.push('new-model')]){
  const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));mutate(f);
  rejects(()=>f.controller.execute(p.planId),'PLAN_STALE');assert.equal(f.commits,0);
 }
});
test('change then undo and project away then back do not revive confirmed proposals',()=>{
 for(const property of ['projectId','text']){
  const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));
  if(property==='projectId'){f.state.projectId='other';f.controller.observe();f.state.projectId='synthetic-project';}
  else {f.state.nodes[0].data.text='manual';f.controller.observe();f.state.nodes[0].data.text='PRIVATE_TEXT';}
  rejects(()=>f.controller.execute(p.planId),'PLAN_EXPIRED');assert.equal(f.commits,0);
 }
});
test('unmount/remount and readiness gates prevent stale project writes',()=>{
 const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));
 f.state.instanceId='mount-B';rejects(()=>f.controller.execute(p.planId),'PLAN_STALE');
 f.state.ready=false;rejects(()=>f.controller.capture(),'PLAN_CANVAS_NOT_READY');
});
test('transient selection/render/measurement and callback injection do not stale a plan',()=>{
 const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));
 f.state.nodes[0]={...f.state.nodes[0],selected:false,measured:{width:100,height:100},data:{...f.state.nodes[0].data,wanjuanRenderZoom:0.2,apiConfigs:[{key:'CHANGED_PRIVATE_KEY'}],onGenerate(){}}};
 f.controller.observe();f.controller.execute(p.planId);assert.equal(f.commits,1);
});
test('undo refuses subsequent manual edits, including an observed edit later manually reverted',()=>{
 for(const reverted of [false,true]){
  const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));f.controller.execute(p.planId);f.controller.observe();
  f.state.nodes[0].data.text='MANUAL_LATER';f.controller.observe();if(reverted)f.state.nodes[0].data.text='PRIVATE_TEXT';
  rejects(()=>f.controller.undo(p.planId),'PLAN_UNDO_CONFLICT');assert.equal(f.state.nodes.length,4);assert.equal(f.commits,1);
 }
});
test('preview owns snapshots: later in-place data edits cannot corrupt rollback state',()=>{
 const f=fixture(),original=f.state,r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));f.controller.execute(p.planId);
 original.nodes[0].data.text='MUTATED_OLD_REFERENCE';f.controller.undo(p.planId);assert.equal(f.state.nodes[0].data.text,'PRIVATE_TEXT');
});
test('unsupported/duplicate connections, duplicate aliases, cycles and arbitrary command payloads are rejected',()=>{
 const f=fixture(),r=f.controller.capture();
 rejects(()=>f.controller.preview(r.ticketId,proposal([create(),create()])),'PLAN_DUPLICATE_ID');
 rejects(()=>f.controller.preview(r.ticketId,proposal([{op:'connect',source:'old-text',target:'old-image'}])),'PLAN_CONNECTION_UNSUPPORTED');
 rejects(()=>f.controller.preview(r.ticketId,proposal([create(),{op:'connect',source:'old-text',target:'image'},{op:'connect',source:'image',target:'old-text'}])),'PLAN_CONNECTION_CYCLE');
 rejects(()=>f.controller.preview(r.ticketId,proposal([create(),{op:'connect',source:'old-text',target:'image'},{op:'connect',source:'old-text',target:'image'}])),'PLAN_CONNECTION_EXISTS');
 for(const op of [{op:'generate'},{op:'delete'},{op:'exec',command:'do not run'},{...create(),apiKey:'not allowed'},{op:'reference',key:'x',source:'old-image',position:{x:0,y:0},url:'file:///unapproved'}])rejects(()=>parseCanvasPlan(proposal([op])),op.op==='generate'||op.op==='delete'||op.op==='exec'?'PLAN_OPERATION_UNSUPPORTED':'PLAN_INVALID');
 assert.equal(f.commits,0);
});
test('expired and discarded tickets and exhausted bounded plan capacity are explicit',()=>{
 const f=fixture(),r=f.controller.capture();f.advance();rejects(()=>f.controller.preview(r.ticketId,proposal([create()])),'PLAN_EXPIRED');
 const second=f.controller.capture();f.controller.discard(second.ticketId);rejects(()=>f.controller.preview(second.ticketId,proposal([create()])),'PLAN_EXPIRED');
 const third=f.controller.capture();for(let i=0;i<16;i++)f.controller.preview(third.ticketId,proposal([create()]));rejects(()=>f.controller.preview(third.ticketId,proposal([create()])),'PLAN_LIMIT');
});
test('reserved property names are rejected as fields without prototype lookup or raw exceptions',()=>{
 const f=fixture(),r=f.controller.capture();
 for(const key of ['constructor','__proto__','toString']){
  const fields=Object.fromEntries([[key,'NO_EXECUTABLE_VALUE']]);
  rejects(()=>f.controller.preview(r.ticketId,proposal([{op:'update',node:'old-text',fields}])),'PLAN_PARAMETER_UNAVAILABLE');
 }assert.equal(f.commits,0);
});
test('private binding/configuration identity changes stale plans even with identical public choices',()=>{
 const f=fixture();f.state.configurationIdentity={key:'QA_KEY_ONE',url:'https://do-not-call.invalid/one'};
 const r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));assert.equal(JSON.stringify(r).includes('QA_KEY'),false);
 f.state.configurationIdentity.key='QA_KEY_TWO';rejects(()=>f.controller.execute(p.planId),'PLAN_STALE');assert.equal(f.commits,0);
});
test('discard releases unconfirmed plans, while an applied receipt stays idempotent and undoable',()=>{
 const f=fixture();for(let i=0;i<35;i++){const r=f.controller.capture();f.controller.preview(r.ticketId,proposal([create()]));f.controller.discard(r.ticketId);}
 const r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));f.controller.execute(p.planId);f.controller.discard(r.ticketId);
 assert.equal(f.controller.execute(p.planId).replayed,true);assert.equal(f.controller.undo(p.planId).status,'undone');
});
test('explicitly releasing an undone plan retires its snapshots, without increasing active capacity',()=>{
 const f=fixture();
 for(let i=0;i<40;i++){
  const r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));
  f.controller.execute(p.planId);f.controller.undo(p.planId);
  assert.equal(f.controller.undo(p.planId).replayed,true,'undo remains idempotent until explicitly released');
  f.controller.discard(r.ticketId);
  rejects(()=>f.controller.execute(p.planId),'PLAN_EXPIRED');
 }
 assert.equal(f.commits,80);
});
test('closing a proposal does not disable observation for a still-undoable applied receipt',()=>{
 const f=fixture(),r=f.controller.capture(),p=f.controller.preview(r.ticketId,proposal([create()]));f.controller.execute(p.planId);f.controller.discard(r.ticketId);
 f.state.nodes[0].data.text='LATER_MANUAL';f.controller.observe();f.state.nodes[0].data.text='PRIVATE_TEXT';
 rejects(()=>f.controller.undo(p.planId),'PLAN_UNDO_CONFLICT');
});
