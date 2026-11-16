const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../src/renderer/hooks/useNodeSyncEffect.ts');let effects=[];
const compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;const load=compiled.require.bind(compiled);
compiled.require=name=>name==='react'?{useEffect:fn=>effects.push(fn)}:name==='../components/render-mode'?{WanJuanRenderRuntime:{mark(){}},WanJuanStripRuntimeNodeData:data=>({...data})}:load(name);
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const fields={seedanceMode:'tianji',tianjiModelManual:true,wanjuanModelAuto:false,selectedModel:'qa-tianji',tianjiSelectedModel:'qa-tianji',tianjiSeedanceModel:'qa-tianji',videoModel:'qa-tianji',videoResolutions:'16:9',seedanceRatios:'16:9',size:'16:9',seedanceResolutions:'720p',selectedResolution:'720p',videoDurations:'5',selectedSeconds:'5',generateAudio:false,watermark:true};
function fixture(data={}){
 let nodes=[{id:'QA',type:'seedanceNode',position:{x:0,y:0},data:{...fields,...data}}],setCalls=0;const generate=()=>assert.fail('sync cannot generate'),deps={setNodes:fn=>{setCalls++;nodes=fn(nodes);},shouldFitView:true,generateVideo:generate,seedanceModel:'general-model',tianjiSeedanceModel:'different-tianji-model',seedanceDurations:'10 15',seedanceResolutions:'1080p',seedanceRatios:'9:16',seedanceGenerateAudio:true,seedanceWatermark:false,seedanceUploadMode:'public'};
 const sync=()=>{effects=[];compiled.exports.useNodeSyncEffect(deps);assert.equal(effects.length,1);effects[0]();};
 return {sync,generate,get nodes(){return nodes;},get setCalls(){return setCalls;},restore(){nodes=JSON.parse(JSON.stringify(nodes));}};
}
test('actual sync effect preserves explicit Tianji model/parameter snapshots but refreshes runtime callbacks',()=>{
 const f=fixture(),original=f.nodes;f.sync();const d=f.nodes[0].data;for(const [key,value]of Object.entries(fields))assert.equal(d[key],value,key);assert.equal(d.onGenerateVideo,f.generate);assert.deepEqual(original[0].data,fields,'never mutate original nodes');
 const settled=f.nodes;f.sync();assert.equal(f.nodes,settled,'no array churn after a stable callback refresh');
});
test('normal project serialization/recovery preserves ordinary parameters, never an execution capability',()=>{
 const f=fixture();f.sync();f.restore();f.sync();for(const [key,value]of Object.entries(fields))assert.equal(f.nodes[0].data[key],value,key);assert.equal(f.nodes[0].data.onGenerateVideo,f.generate);assert(!JSON.stringify(f.nodes).includes('execution'));
});
test('ordinary Seedance and auto/unselected Tianji retain their previous global-default synchronization',()=>{
 for(const extra of [{seedanceMode:'official'},{tianjiModelManual:false},{wanjuanModelAuto:true}]){const f=fixture(extra);f.sync();const d=f.nodes[0].data;assert.equal(d.videoDurations,'10 15');assert.equal(d.seedanceResolutions,'1080p');assert.equal(d.seedanceRatios,'9:16');assert.equal(d.generateAudio,true);assert.equal(d.watermark,false);}
});
