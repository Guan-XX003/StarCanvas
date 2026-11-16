// Exercise actual save and export functions using synthetic in-memory data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const oldLoad=Module._load;Module._load=function(name,parent,...rest){if(name==='react')return {...oldLoad.call(this,name,parent,...rest),useCallback:fn=>fn,useEffect:fn=>fn(),useRef:value=>({current:value})};return oldLoad.call(this,name,parent,...rest)};
const {wanjuanStripRuntimeNodeData}=require('../src/renderer/lib/node-runtime-contract.ts');
const {useSaveCanvasState}=require('../src/renderer/hooks/useSaveCanvasState.ts');
const {use_sanitizeProjectNodeDataForExport}=require('../src/renderer/hooks/use_sanitizeProjectNodeDataForExport.ts');
const {use_sanitizeProjectCanvasStateForExport}=require('../src/renderer/hooks/use_sanitizeProjectCanvasStateForExport.ts');Module._load=oldLoad;
Module._load=function(name,parent,...rest){if(name==='react')return {...oldLoad.call(this,name,parent,...rest),useEffect:fn=>fn()};if(name==='../components/render-mode'&&parent?.filename.endsWith('useNodeSyncEffect.ts'))return {WanJuanRenderRuntime:{mark(){}},WanJuanStripRuntimeNodeData:wanjuanStripRuntimeNodeData};return oldLoad.call(this,name,parent,...rest)};
const {useNodeSyncEffect}=require('../src/renderer/hooks/useNodeSyncEffect.ts');Module._load=oldLoad;
const SECRET='SYNTHETIC_RUNTIME_AUDIO_KEY',UPLOADER='SYNTHETIC_RUNTIME_UPLOAD_SECRET';
const data={audioApiKey:SECRET,apiConfigs:[{key:SECRET}],tosConfig:{secretAccessKey:UPLOADER},customPublicUploadConfig:{key:UPLOADER},qiniuConfig:{secretKey:UPLOADER},config:{audioApiKey:'MANUAL_CONFIG',headers:'{"Content-Type":"application/json"}'},label:'Synthetic audio',audioModel:'fixture'};
const node={id:'fixture-node',type:'audioNode',data};
(async()=>{
 let saved,mirror;
 global.window={wanjuanDesktop:{}};global.chrome={storage:{local:{set:value=>{mirror=value}}}};
 global.prepareProjectMediaStateForPersistence=async state=>state;
 const deps={WanJuanStripRuntimeNodeData:wanjuanStripRuntimeNodeData,canvasStateKeyPrefix:'canvas-',desktopCanvasMirrorPrefix:'mirror-',edgesRef:{current:[]},externalizeProjectCanvasState:async state=>state,historyIndexRef:{current:0},isRestoringRef:{current:true},localforageModule:{default:{getItem:async()=>null,setItem:async(_key,state)=>{saved=state}}},nodesRef:{current:[node]},projectIdRef:{current:'fixture'},setHistory(){},setHistoryIndex(){},shouldFitViewRef:{current:true},showToast(){}};
 await useSaveCanvasState(deps).saveCanvasState();
 for(const record of [saved,mirror['mirror-fixture']]){
  assert.ok(record);const text=JSON.stringify(record);assert.doesNotMatch(text,/SYNTHETIC_RUNTIME_AUDIO_KEY|SYNTHETIC_RUNTIME_UPLOAD_SECRET/);assert.equal(record.nodes[0].data.config.audioApiKey,'MANUAL_CONFIG');assert.equal(record.nodes[0].data.label,'Synthetic audio');
 }
 assert.equal(node.data.audioApiKey,SECRET,'saving does not change runtime data');
 const sanitize=use_sanitizeProjectNodeDataForExport({EXPORT_INLINE_MEDIA_FIELDS:[]}).sanitizeProjectNodeDataForExport;
 const exported=use_sanitizeProjectCanvasStateForExport({sanitizeProjectNodeDataForExport:sanitize}).sanitizeProjectCanvasStateForExport({nodes:[node],edges:[]});
 assert.doesNotMatch(JSON.stringify(exported),/SYNTHETIC_RUNTIME_AUDIO_KEY|SYNTHETIC_RUNTIME_UPLOAD_SECRET/);
 assert.equal(exported.nodes[0].data.config.audioApiKey,'MANUAL_CONFIG','nested manual config remains unchanged');
 assert.equal(node.data.audioApiKey,SECRET,'export does not alter existing configuration');
 let restored=['audioNode','musicNode','ttsMusicNode'].map((type,i)=>({id:`fixture-${i}`,type,data:{label:'restored'}}));
 useNodeSyncEffect({audioApiKey:SECRET,projectIdRef:{current:'fixture'},setNodes:updater=>{restored=updater(restored)}});
 for(const item of restored)assert.equal(item.data.audioApiKey,SECRET,`${item.type}: runtime key restored from global configuration`);
 console.log('PASS_PROJECT_RUNTIME_SECRET_SAVE_AND_EXPORT_BOUNDARY');
})().catch(error=>{console.error(error);process.exitCode=1});
