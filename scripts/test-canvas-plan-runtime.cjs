const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {use_createNodeAt}=require('../src/renderer/hooks/use_createNodeAt.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {canvasNodePlanCapability,initializeCanvasPlanNode}=require('../src/renderer/lib/canvas-plan-capabilities.ts');
const {captureCanvasPersistenceSnapshot}=require('../src/renderer/lib/canvas-persistence-snapshot.ts');
const {wanjuanStripRuntimeNodeData}=require('../src/renderer/lib/node-runtime-contract.ts');
const {commitCanvasPlanBatch}=require('../src/renderer/hooks/useCanvasOperationPlans.ts');
const {canvasPlanFocusViewport}=require('../src/renderer/lib/canvas-plan-layout.ts');
function fixture(){
 let nodes=[],edges=[],menuCalls=0,generationCalls=0;
 const generate=()=>{generationCalls++;assert.fail('paid generation must not run');};
 const deps={nodesRef:{current:nodes},projectIdRef:{current:'QA_ONLY'},projectId:'QA_ONLY',setNodes:update=>{nodes=typeof update==='function'?update(nodes):update;deps.nodesRef.current=nodes;},setEdges:update=>{edges=typeof update==='function'?update(edges):update;},setMenuPosition:()=>menuCalls++,
  generateImage:generate,generateText:generate,generateVideo:generate,stopGeneration:()=>{},textModel:'text-fixture',drawingModel:'image-fixed\nimage-flex',videoModel:'video-fixture',imageCompatResolutions:'512x512 1024x1024',videoDurations:'5 10',videoResolutions:'720x1280 1280x720',videoAspectRatios:'9:16 16:9',
  apiConfigs:[{id:'qa-api',url:'https://DO_NOT_CALL.invalid',key:'PRIVATE_SYNTHETIC_KEY'}],
  imageModelApiBindings:{'image-fixed':'qa-api','image-flex':'qa-api'},imageModelProtocolBindings:{'image-fixed':'image-protocol'},
  videoModelApiBindings:{'video-fixture':'qa-api'},videoModelProtocolBindings:{'video-fixture':'video-protocol'},modelProtocolRegistry:{
   'image-protocol':{category:'image',parameterAdapter:{fixedImageSize:'2K'}},
   'video-protocol':{category:'video',parameterMode:'ratio-quality',parameterModeLocked:true,parameterOptions:{durations:[6,12],qualities:['720P','1080P'],aspectRatios:['1:1','9:16']}},
  }};
 const factory=use_createNodeAt(deps);
 const controller=createCanvasPlanController({id:(()=>{let i=0;return()=>`runtime-fixture-${++i}`;})(),read:()=>({projectId:'QA_ONLY',instanceId:'QA_MOUNT',ready:true,nodes,edges}),
  prepareNode:(type,position,data)=>initializeCanvasPlanNode(factory.prepareNodeAt(type,position,data)),
  capabilities:()=>Object.fromEntries(['textNode','promptNode','videoNode'].map(type=>[type,canvasNodePlanCapability(factory.prepareNodeAt(type,{x:0,y:0},{__nodeId:'probe'}))])),
  commit:(before,after)=>{assert.deepEqual(nodes,before.nodes);deps.setNodes(after.nodes);deps.setEdges(after.edges);},
 });
 return {deps,factory,controller,get nodes(){return nodes;},get edges(){return edges;},get menuCalls(){return menuCalls;},get generationCalls(){return generationCalls;}};
}
test('shared real factory preparation has no setter/menu/generation effects; legacy creation remains normal',()=>{
 const f=fixture(),prepared=f.factory.prepareNodeAt('promptNode',{x:10,y:20},{__nodeId:'prepared-only',prompt:'QA_PROMPT'});
 assert.equal(f.nodes.length,0);assert.equal(f.menuCalls,0);assert.equal(prepared.id,'prepared-only');assert.equal(prepared.style.width,224);assert.equal(prepared.data.onGenerate,f.deps.generateImage);assert.equal(prepared.data.apiConfigs,f.deps.apiConfigs);
 f.factory.createNodeAt('textNode',{x:0,y:0},{__nodeId:'legacy-source',text:'QA_TEXT'});
 f.factory.createNodeAt('videoNode',{x:400,y:0},{__nodeId:'legacy-target'},{source:'legacy-source'});
 assert.equal(f.nodes.length,2);assert.equal(f.edges.length,1);assert.equal(f.menuCalls,2);assert.equal(f.nodes[1].data.onGenerateVideo,f.deps.generateVideo);assert.equal(f.generationCalls,0);
});
test('capabilities derive exact real model/protocol choices, without leaking credentials or URLs',()=>{
 const f=fixture(),read=f.controller.capture({scope:'structure'}),c=read.capabilities;
 assert.deepEqual(c.promptNode.modelParameters['image-fixed'].imageSize,['2K']);assert.deepEqual(c.promptNode.modelParameters['image-flex'].imageSize,['1K','2K','4K']);
 assert.deepEqual(c.videoNode.parameters.selectedSeconds,['6','12']);assert.deepEqual(c.videoNode.parameters.videoParameterMode,['ratio-quality']);assert.deepEqual(c.videoNode.parameters.selectedAspectRatio,['1:1','9:16']);assert.deepEqual(c.videoNode.parameters.size,['720x1280','1280x720']);
 assert.equal(JSON.stringify(read).includes('PRIVATE_SYNTHETIC_KEY'),false);assert.equal(JSON.stringify(read).includes('DO_NOT_CALL'),false);
});
test('real factory plan prepares a connected text/image/video draft; normal persistence shape can reload it without callbacks or keys',()=>{
 const f=fixture(),read=f.controller.capture(),p=f.controller.preview(read.ticketId,{version:1,operations:[
  {op:'create',key:'text',kind:'text',position:{x:0,y:0},fields:{text:'SYNTHETIC_SCENE'}},
  {op:'create',key:'image',kind:'image',position:{x:400,y:0},fields:{prompt:'SYNTHETIC_STILL',selectedModel:'image-fixed',imageSize:'2K'}},
  {op:'create',key:'video',kind:'video',position:{x:800,y:0},fields:{prompt:'SYNTHETIC_MOTION',selectedModel:'video-fixture',selectedSeconds:'6'}},
  {op:'connect',source:'text',target:'image'},{op:'connect',source:'image',target:'video'},
 ]});
 assert.equal(f.nodes.length,0);f.controller.execute(p.planId);assert.equal(f.nodes.length,3);assert.equal(f.edges.length,2);assert.equal(f.generationCalls,0);
 assert.equal(f.nodes[1].data.onGenerate,f.deps.generateImage);assert.equal(f.nodes[2].data.onGenerateVideo,f.deps.generateVideo);
 assert.equal(f.nodes[1].data.imageSizeMode,'quality');assert.equal(f.nodes[2].data.videoParameterMode,'ratio-quality');assert.equal(f.nodes[2].data.selectedVideoQuality,'720P');
 const snapshot=captureCanvasPersistenceSnapshot(f.nodes,f.edges,wanjuanStripRuntimeNodeData),serialized=JSON.stringify(snapshot);
 assert.equal(serialized.includes('PRIVATE_SYNTHETIC_KEY'),false);assert.equal(serialized.includes('onGenerate'),false);
 const reopened=JSON.parse(serialized);assert.equal(reopened.nodes[0].data.text,'SYNTHETIC_SCENE');assert.equal(reopened.nodes[1].data.selectedModel,'image-fixed');assert.equal(reopened.nodes[2].data.selectedSeconds,'6');assert.equal(reopened.edges.length,2);
 // Reproduce the real canvas loading-animation effect (including its first
 // normalization pass) without weakening the content/connection undo fence.
 assert.equal(f.edges.every(edge=>edge.animated===false),true);
 f.deps.setEdges(edges=>edges.map(edge=>({...edge,animated:!!f.nodes.find(node=>node.id===edge.target)?.data.loading})));
 f.controller.observe();f.controller.undo(p.planId);assert.equal(f.nodes.length,0);assert.equal(f.edges.length,0);
});
test('unknown/missing protocol candidates are not advertised as selectable models',()=>{
 const f=fixture();f.deps.imageModelProtocolBindings['image-flex']='missing-protocol';
 const c=f.controller.capture().capabilities;assert.deepEqual(c.promptNode.models,['image-fixed']);
 f.deps.modelProtocolRegistry['image-protocol'].category='video';assert.deepEqual(f.controller.capture().capabilities.promptNode.models,[]);
});
test('actual batched commit rolls both arrays back when a setter fails; failure is not reported as applied or automatically replayed',()=>{
 const before={projectId:'QA',instanceId:'QA',ready:true,nodes:[{id:'original'}],edges:[]},after={...before,nodes:[{id:'new'}],edges:[{id:'edge'}]};
 let state={...before},first=true;
 const owner={setNodes(nodes){state={...state,nodes};},setEdges(edges){if(first){first=false;throw Error('SYNTHETIC_SETTER_FAILURE');}state={...state,edges};}};
 assert.throws(()=>commitCanvasPlanBatch(owner,before,after),{code:'PLAN_COMMIT_ROLLED_BACK'});assert.deepEqual(state,before);
 const c=createCanvasPlanController({id:()=> 'commit-failure',read:()=>({...before,nodes:[],edges:[]}),capabilities:()=>({}),prepareNode:(type,position,data)=>({id:data.__nodeId,type,position,data}),commit(){throw Error('SYNTHETIC_UNKNOWN_COMMIT_OUTCOME');}});
 const r=c.capture(),p=c.preview(r.ticketId,{version:1,operations:[{op:'create',key:'text',kind:'text',position:{x:0,y:0},fields:{text:'QA'}}]});
 assert.throws(()=>c.execute(p.planId),{code:'PLAN_COMMIT_UNCERTAIN'});assert.throws(()=>c.execute(p.planId),{code:'PLAN_ALREADY_CONSUMED'});
});
test('focus accounts for expanded editors and reserves a visible right/left float without changing nodes',()=>{
 const nodes=[{id:'a',type:'textNode',position:{x:0,y:0}},{id:'b',type:'promptNode',position:{x:1000,y:0}}],before=structuredClone(nodes),area={width:1280,height:860};
 const right=canvasPlanFocusViewport(nodes,area,{left:850,right:1260,top:20,bottom:800});assert(right.x>=24);assert(right.x+1900*right.zoom<850);
 const left=canvasPlanFocusViewport(nodes,area,{left:20,right:440,top:20,bottom:800});assert(left.x>440);assert(left.x+1900*left.zoom<=1280);assert.deepEqual(nodes,before);
 assert.equal(canvasPlanFocusViewport([{...nodes[0],parentId:'group'}],area),null);
});
