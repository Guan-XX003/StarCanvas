const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const file=path.resolve(__dirname,'../src/renderer/components/WanJuanSettingsSectionD.tsx'),compiled=new Module(file,module);compiled.filename=file;compiled.paths=module.paths;
const element=(type,props)=>({type,props});
compiled.require=name=>name==='react/jsx-runtime'?{jsx:element,jsxs:element,Fragment:'fragment'}:name==='react'?{useEffect:()=>{},useState:initial=>[typeof initial==='function'?initial():initial,()=>{}]}:new Proxy({},{get:(_t,k)=>String(k)});
compiled._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {WanJuanSettingsSectionD}=compiled.exports,Shell=()=>assert.fail('tree inspection never mounts a child');
const walk=(el,result=[])=>{if(el&&typeof el==='object'&&el.props){result.push(el);for(const child of [el.props.children].flat(Infinity))walk(child,result);}return result;};
function render(ready,unavailable=false){const previous=global.wanjuanT;global.wanjuanT=x=>x;try{return walk(WanJuanSettingsSectionD({modelConfigurationReady:ready,modelConfigurationUnavailable:unavailable,WanJuanCanvasShell:Shell,activeView:'canvas',activeProjectId:'QA',projects:[],newProjectIds:[],projectUngroupedAll:[],projectGroupedSectionsAll:[],globalTasks:[],projectStorageLabel:()=>'',getUnreadSystemNotifications:()=>[]}));}finally{if(previous===undefined)delete global.wanjuanT;else global.wanjuanT=previous;}}
test('the real canvas mount boundary does not instantiate editable nodes against unhydrated/default settings',()=>{
 const loading=render(false);assert.equal(loading.filter(e=>e.type===Shell).length,0);assert.equal(loading.find(e=>e.props['data-wanjuan-model-config-state']).props['data-wanjuan-model-config-state'],'loading');
 assert.equal(render(true).filter(e=>e.type===Shell).length,1);
 const failed=render(false,true);assert.equal(failed.filter(e=>e.type===Shell).length,0);assert.equal(failed.find(e=>e.props['data-wanjuan-model-config-state']).props['data-wanjuan-model-config-state'],'unavailable');
});
test('readiness is an explicit reactive Root prop, not a model-selection policy change or blanket App loading gate',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/renderer/bundle/index.js'),'utf8');
 assert(source.includes('[modelConfigurationReady, setModelConfigurationReady] = useState(false)'));
 assert(source.includes('usePluginEnvEffect({ setModelConfigurationReady,'));assert(source.includes('jsx(WanJuanSettingsSectionD, { modelConfigurationReady,'));
 assert(!source.includes('return isLoading || !modelConfigurationReady'));
});
