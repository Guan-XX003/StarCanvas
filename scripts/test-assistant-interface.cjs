const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
require.extensions['.tsx']=require.extensions['.ts'];
const {checkAssistantService,assistantServiceEntry,assistantServiceCategory,appendAssistantServiceBinding,assistantFailureChoices,assistantAvatarMime,readAssistantAvatar}=require('../src/renderer/lib/assistant-interface.ts');
const {assistantInterfaceCopy}=require('../src/renderer/lib/assistant-interface-copy.ts');
const {jsx}=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const {AssistantServiceSetup}=require('../src/renderer/components/assistant-service-setup.tsx');
const draft={category:'image',url:'https://api.example.com/v1',model:'example-image',key:'synthetic-private-key',docs:''};
for(const category of ['image','video','jimeng','music','text'])test(`local service review supports ${category} without altering protocol or existing entries`,()=>{
  assert.equal(checkAssistantService({...draft,category}), '');
  const result=assistantServiceEntry({...draft,category},'assistant-service-test');
  assert.equal(result.id,'assistant-service-test');assert.equal(result.key,draft.key);assert.equal(result.protocolFormat,'auto');assert.equal(result.name,'api.example.com');
  assert.equal(assistantServiceCategory(category),category==='jimeng'?'video':category);
  assert.equal(draft.category,'image');
});
test('reject credentials in URLs, invalid models, control characters, unknown types and private docs',()=>{
  for(const [patch,field] of [[{url:'https://user:pass@example.com'},'url'],[{url:'https://example.com?token=private'},'url'],[{url:'https://example.com#secret'},'url'],[{url:'javascript:alert(1)'},'url'],[{model:'sk-abcdefghijklmnop'},'model'],[{model:'bad\nmodel'},'model'],[{model:''},'model'],[{key:'bad\nkey'},'key'],[{key:''},'key'],[{category:'unknown'},'category'],[{docs:'http://localhost/private'},'docs']])assert.equal(checkAssistantService({...draft,...patch}),field);
  assert.throws(()=>assistantServiceEntry(draft,'existing-manual-id'));
});
test('failure choices discard raw content and ambiguous identifiers',()=>{
  const input=[{id:'a',type:'video',status:'failed',errorMsg:'HTTP 401 unauthorized PRIVATE_ERROR',prompt:'PRIVATE_PROMPT',url:'PRIVATE_URL'}, {id:'b',type:'image',status:'completed'}, {id:'duplicate',type:'image',status:'failed'},{id:'duplicate',type:'text',status:'failed'},{id:'cancel',status:'failed',stoppedByUser:true}];
  const choices=assistantFailureChoices(input);assert.equal(choices.length,1);assert.deepEqual(choices[0],{id:'a',type:'video',diagnostic:{status:'401',kind:'authentication'}});assert.doesNotMatch(JSON.stringify(choices),/PRIVATE|errorMsg|prompt|url/);
});
test('new model bindings append while same-name manual choices remain unchanged',()=>{
  const previous={retained:'manual',explicitDefault:''};assert.equal(appendAssistantServiceBinding(previous,'retained','new'),previous);assert.equal(appendAssistantServiceBinding(previous,'explicitDefault','new'),previous);
  assert.deepEqual(appendAssistantServiceBinding(previous,'fresh-model','new'),{...previous,'fresh-model':'new'});assert.deepEqual(previous,{retained:'manual',explicitDefault:''});
});
test('avatar only accepts bounded raster signatures and a local PNG preference',()=>{
  assert.equal(assistantAvatarMime(Uint8Array.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(assistantAvatarMime(Uint8Array.from([255,216,255])),'image/jpeg');
  assert.equal(assistantAvatarMime(new TextEncoder().encode('RIFFxxxxWEBP')),'image/webp');
  assert.equal(assistantAvatarMime(new TextEncoder().encode('<svg onload="bad"/>')),'');
  assert.equal(assistantAvatarMime(new Uint8Array(512*1024+1)),'');
  for(const value of ['https://remote.example.com/avatar.png','file:///private/avatar.png','data:image/svg+xml;base64,AAAA'])assert.equal(readAssistantAvatar({getItem:()=>value}),'');
  assert.equal(readAssistantAvatar({getItem:()=>{throw Error('blocked');}}),'');
});
for(const language of ['zh-CN','zh-TW','en-US'])test(`service interface is localized and does not serialize credentials: ${language}`,()=>{
  const c=assistantInterfaceCopy(language);assert.equal(Object.keys(c).length,Object.keys(assistantInterfaceCopy('zh-CN')).length);assert(Object.values(c).every(Boolean));
  const html=renderToStaticMarkup(jsx(AssistantServiceSetup,{language,connected:true,disabled:false,onBack:()=>{},onManual:()=>{},onContinue:async()=>{}}));
  for(const key of ['setup','image','video','jimeng','music','text','url','model','key','next'])assert(html.includes(c[key]));
  assert.match(html,/type="password"/);assert.match(html,/autocomplete="off"/i);assert.doesNotMatch(html,/synthetic-private-key/);
  if(language==='en-US')assert.doesNotMatch(html,/[\u3400-\u9fff]/);
});
