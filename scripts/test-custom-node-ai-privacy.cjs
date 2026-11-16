// Real hook with synthetic configuration and a closed-network fake model.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const oldLoad=Module._load;Module._load=function(name,parent,...rest){if(name==='react'&&parent?.filename.endsWith('useCustomNodeGeneration.ts'))return {useCallback:fn=>fn};return oldLoad.call(this,name,parent,...rest)};
const {useCustomNodeGeneration}=require('../src/renderer/hooks/useCustomNodeGeneration.ts');Module._load=oldLoad;
const {customNodeAiContext,mergeCustomNodeAiSuggestion}=require('../src/renderer/lib/custom-node-ai-privacy.ts');
(async()=>{
 const config={apiUrl:'https://private.invalid/api?token=PRIVATE_URL',headers:'{"Authorization":"Bearer PRIVATE_HEADER"}',body:'{"prompt":"PRIVATE_BODY"}',pollingUrl:'https://private.invalid/PRIVATE_POLL',pollingHeaders:'PRIVATE_POLL_HEADER',pollingBody:'PRIVATE_POLL_BODY',variables:{key:'PRIVATE_VARIABLE'},unknown:'PRIVATE_OTHER',method:'POST',outputType:'video',executionMode:'async',pollingMethod:'GET'};
 assert.deepEqual(customNodeAiContext(config),{method:'POST',outputType:'video',executionMode:'async',pollingMethod:'GET'});
 assert.deepEqual(customNodeAiContext({method:'PRIVATE',outputType:'PRIVATE',executionMode:'PRIVATE',pollingMethod:'PRIVATE'}),{});
 let captured;const originalFetch=global.fetch;global.fetch=async(url,init)=>{assert.equal(url,'https://fixture.invalid/v1/chat/completions');captured=JSON.parse(init.body);return Response.json({choices:[{message:{content:'{"resultPath":"data.url"}'}}]})};
 try{const hook=useCustomNodeGeneration({propTextApiKey:'MODEL_KEY',propTextApiUrl:'https://fixture.invalid',textModel:'fixture'});assert.equal(await hook.handleAIAssist('Build a video task',config),'{"resultPath":"data.url"}')}finally{global.fetch=originalFetch}
 const request=JSON.stringify(captured);assert.doesNotMatch(request,/PRIVATE_|private\.invalid|MODEL_KEY/);assert.match(request,/Build a video task/);assert.match(request,/"POST"|POST/);
 const suggestion={apiUrl:'https://other.invalid',headers:'{"Authorization":"Bearer model"}',body:'{"prompt":"new"}',pollingUrl:'https://other.invalid/poll',pollingHeaders:'new',pollingBody:'new',method:'GET',outputType:'image',executionMode:'sync',pollingMethod:'POST',resultPath:'data.url',rawTextOutput:true,unknown:'do not inject'};
 const merged=mergeCustomNodeAiSuggestion(config,suggestion);
 for(const key of ['apiUrl','headers','body','pollingUrl','pollingHeaders','pollingBody','outputType','executionMode','pollingMethod'])assert.equal(merged[key],config[key],`${key}: user configuration preserved`);
 assert.equal(merged.method,'GET','built-in default may be suggested');assert.equal(merged.resultPath,'data.url');assert.equal(merged.unknown,'PRIVATE_OTHER');assert.equal(config.apiUrl,'https://private.invalid/api?token=PRIVATE_URL');
 const blank={apiUrl:'',method:'POST',headers:'{"Content-Type":"application/json"}',body:'{"prompt":"{{prompt}}"}',outputType:'text',executionMode:'sync',resultPath:'data.result'};
 const filled=mergeCustomNodeAiSuggestion(blank,suggestion);assert.equal(filled.apiUrl,'https://other.invalid');assert.equal(filled.headers,suggestion.headers);assert.equal(filled.body,suggestion.body);assert.equal(filled.outputType,'image');assert.equal(blank.apiUrl,'');
 const concurrent=mergeCustomNodeAiSuggestion({...blank,apiUrl:'https://user-edited.invalid',body:'USER_EDIT'},suggestion);assert.equal(concurrent.apiUrl,'https://user-edited.invalid');assert.equal(concurrent.body,'USER_EDIT');
 assert.throws(()=>mergeCustomNodeAiSuggestion({},[]));assert.equal(mergeCustomNodeAiSuggestion({}, {method:'DELETE',outputType:'evil',headers:{Authorization:'x'}}).method,undefined);
 console.log('PASS_CUSTOM_NODE_AI_CONTEXT_PRIVACY_AND_PRESERVATION');
})().catch(error=>{console.error(error);process.exitCode=1});
