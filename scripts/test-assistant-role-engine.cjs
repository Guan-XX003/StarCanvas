// Real shared provider builder and memory hooks, entirely synthetic fetch.
// Tests request construction/cancellation, not upstream model capability.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {runWorkspaceRoleTurn,completedRoleHistory,createRoleRequestQueue}=require('../src/renderer/lib/assistant-role-engine.ts');
const {use_searchAgentLongTermMemory}=require('../src/renderer/hooks/use_searchAgentLongTermMemory.ts');
const {use_storeAgentLongTermMemory}=require('../src/renderer/hooks/use_storeAgentLongTermMemory.ts');
const a='session-11111111-1111-4111-8111-111111111111',b='session-22222222-2222-4222-8222-222222222222';
const role={id:'legacy-role',name:'Role',model:'custom-vision',apiConfigId:'explicit',systemPrompt:'ROLE_SYSTEM',knowledge:'ROLE_KNOWLEDGE',outputMode:'prompt'};
const env=(requestType='openai-chat')=>({agentModelOptions:['custom-vision'],apiConfigs:[{id:'explicit',url:'https://synthetic.invalid/v1',key:'SYNTHETIC_PROVIDER_KEY'},{id:'global',url:'https://wrong.invalid',key:'WRONG_PROVIDER_KEY'}],modelProtocolRegistry:{test:{requestType}},textApiConfigId:'global',textApiUrl:'https://wrong.invalid',textApiKey:'WRONG_PROVIDER_KEY',textModelApiBindings:{'custom-vision':'global'},textModelProtocolBindings:{'custom-vision':'test'}});
const response=(requestType='openai-chat',text='SYNTHETIC_REPLY')=>({ok:true,json:async()=>requestType==='openai-responses'?{output_text:text}:requestType==='gemini-generate-content'?{candidates:[{content:{parts:[{text}]}}]}:{choices:[{message:{content:text}}]}});
const originalFetches=new WeakMap();
test('canvas planning keeps the selected provider across three protocols, preserves role knowledge, excludes attachments and bypasses remote memory',async t=>{
 const planningRequest={version:1,scope:'selected',includeContent:false,nodes:[],edges:[],capabilities:{textNode:{models:['text-fixture'],parameters:{}}}};
 for(const requestType of ['openai-chat','openai-responses','gemini-generate-content']){
  let body,calls=0,memoryCalls=0;
  fakeFetch(t,async(_url,options)=>{calls++;body=JSON.parse(options.body);return response(requestType);});
  await runWorkspaceRoleTurn({sessionId:a,configuration:{...role,memoryEnabled:true},messages:[],text:'SYNTHETIC_PLAN_REQUEST',environment:{...env(requestType),searchAgentLongTermMemory:async()=>{memoryCalls++;return 'PRIVATE_MEMORY';},storeAgentLongTermMemory:async()=>{memoryCalls++;}},planningRequest,signal:new AbortController().signal});
  assert.equal(calls,1);assert.equal(memoryCalls,0);assert.match(JSON.stringify(body),/canvas PLAN request/);assert.match(JSON.stringify(body),/ROLE_KNOWLEDGE/);assert.doesNotMatch(JSON.stringify(body),/reusable prompt draft|PRIVATE_MEMORY|SYNTHETIC_PROVIDER_KEY/);
  await assert.rejects(runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[],text:'NO',attachments:[{type:'image'}],environment:env(requestType),planningRequest,signal:new AbortController().signal}),{code:'ASSISTANT_ATTACHMENT_UNSUPPORTED'});assert.equal(calls,1);
 }
});
function fakeFetch(t,handler){if(!originalFetches.has(t)){originalFetches.set(t,global.fetch);t.after(()=>{global.fetch=originalFetches.get(t);originalFetches.delete(t);});}global.fetch=handler;}
test('three protocols retain explicit API/model binding, prompt/knowledge and output mode',async t=>{
  for(const requestType of ['openai-chat','openai-responses','gemini-generate-content']){
    const calls=[];fakeFetch(t,async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return response(requestType);});
    const result=await runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[{role:'user',content:'OLD_A',turnId:'t'},{role:'assistant',content:'OLD_A_REPLY',turnId:'t'}],text:'NEW_A',environment:env(requestType),signal:new AbortController().signal});
    assert.equal(result.text,'SYNTHETIC_REPLY');assert.equal(calls.length,1);assert.match(calls[0].url,/^https:\/\/synthetic\.invalid/);assert.doesNotMatch(calls[0].url,/v1\/v1/);assert.equal(calls[0].options.headers.Authorization,'Bearer SYNTHETIC_PROVIDER_KEY');
    const body=JSON.stringify(calls[0].body);assert.match(body,/ROLE_SYSTEM/);assert.match(body,/ROLE_KNOWLEDGE/);assert.match(body,/reusable prompt draft/);assert.match(body,/OLD_A_REPLY/);assert.match(body,/NEW_A/);assert.doesNotMatch(body,/SYNTHETIC_PROVIDER_KEY|WRONG_PROVIDER/);
    if(requestType!=='gemini-generate-content')assert.equal(calls[0].body.model,'custom-vision');
  }
});
test('images use protocol-native parts; Gemini video uses inline bytes, not a fake URL claim',async t=>{
  for(const requestType of ['openai-chat','openai-responses','gemini-generate-content']){
    let body;fakeFetch(t,async(_url,options)=>{body=JSON.parse(options.body);return response(requestType);});
    await runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[],text:'Describe the selected reference',attachments:[{id:'img',type:'image',mime:'image/png',url:'data:image/png;base64,c3ludGhldGlj'}],environment:env(requestType),signal:new AbortController().signal});
    assert.match(JSON.stringify(body),requestType==='openai-chat'?/image_url/:requestType==='openai-responses'?/input_image/:/inlineData/);
  }
  let body;fakeFetch(t,async(_url,options)=>{body=JSON.parse(options.body);return response('gemini-generate-content');});
  await runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[],text:'Inspect reference',attachments:[{id:'video',type:'video',mime:'video/mp4',url:'data:video/mp4;base64,c3ludGhldGlj'}],environment:env('gemini-generate-content'),signal:new AbortController().signal});
  assert.match(JSON.stringify(body),/inlineData/);assert.match(JSON.stringify(body),/video\/mp4/);
});
test('unsupported video/document, missing bindings, secret prompts fail before provider call',async t=>{
  let calls=0;fakeFetch(t,async()=>{calls++;return response();});
  const send=(configuration,attachments=[])=>runWorkspaceRoleTurn({sessionId:a,configuration,messages:[],text:'Question',attachments,environment:env(),signal:new AbortController().signal});
  await assert.rejects(send(role,[{type:'video',url:'https://synthetic.invalid/reference.mp4'}]),{code:'ASSISTANT_VIDEO_UNSUPPORTED'});
  await assert.rejects(send(role,[{type:'document',url:'blob:synthetic'}]),{code:'ASSISTANT_DOCUMENT_UNSUPPORTED'});
  await assert.rejects(send({...role,apiConfigId:'missing'}),{code:'ASSISTANT_API_REQUIRED'});
  await assert.rejects(send({...role,systemPrompt:'password: PRIVATE_PASSWORD'}),{code:'ASSISTANT_SENSITIVE_INPUT'});
  assert.equal(calls,0);
});
test('safe HTTP failure codes do not expose upstream body or credential diagnostics',async t=>{
  let bodyRead=false;fakeFetch(t,async()=>({ok:false,status:429,json:async()=>{bodyRead=true;return {error:{message:'PRIVATE_PROVIDER_KEY'}};}}));
  await assert.rejects(runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[],text:'Question',environment:env(),signal:new AbortController().signal}),{code:'ASSISTANT_PROVIDER_RATE_LIMIT',message:'ASSISTANT_PROVIDER_RATE_LIMIT'});
  assert.equal(bodyRead,false);
});
test('abort A does not affect B and failed/interrupted history never re-enters context',async t=>{
  const history=[{role:'user',content:'OK',turnId:'ok'},{role:'assistant',content:'OK_REPLY',turnId:'ok'},{role:'user',content:'FAILED',turnId:'bad'},{role:'assistant',content:'FAILED_REPLY',turnId:'bad',failed:true},{role:'user',content:'INTERRUPTED',turnId:'open'}];
  assert.deepEqual(completedRoleHistory(history).map(item=>item.content),['OK','OK_REPLY']);
  const abortA=new AbortController(),abortB=new AbortController();let arrived;
  const ready=new Promise(resolve=>arrived=resolve);
  fakeFetch(t,async(_url,options)=>{
    if(options.body.includes('WAIT_A'))return new Promise((_resolve,reject)=>{arrived();options.signal.addEventListener('abort',()=>reject(Error('PRIVATE_ABORT_DIAGNOSTIC')),{once:true});});
    assert.doesNotMatch(options.body,/WAIT_A|FAILED|INTERRUPTED/);return response();
  });
  const first=runWorkspaceRoleTurn({sessionId:a,configuration:role,messages:[],text:'WAIT_A',environment:env(),signal:abortA.signal});first.catch(()=>{});await ready;
  const second=await runWorkspaceRoleTurn({sessionId:b,configuration:role,messages:history,text:'B QUESTION',environment:env(),signal:abortB.signal});
  abortA.abort();await assert.rejects(first,{code:'ASSISTANT_CANCELLED'});assert.equal(second.text,'SYNTHETIC_REPLY');assert.equal(abortB.signal.aborted,false);
});
test('real memory hooks isolate read/write by session; role sharing is explicit',async t=>{
  const requests=[];fakeFetch(t,async(url,options)=>{requests.push({url,body:JSON.parse(options.body),signal:options.signal});return {ok:true,json:async()=>({results:[{memory:'MEMORY_REPLY'}]})};});
  const normalizeMem0BaseUrl=value=>value.replace(/\/$/,'');
  const read=use_searchAgentLongTermMemory({normalizeMem0BaseUrl,extractMem0Results:()=>['MEMORY_REPLY']}).searchAgentLongTermMemory;
  const write=use_storeAgentLongTermMemory({normalizeMem0BaseUrl}).storeAgentLongTermMemory;
  const configured={...role,memoryEnabled:true,memoryBaseUrl:'https://memory.invalid',memoryApiKey:'SYNTHETIC_MEMORY_KEY'};
  await read(configured,'A query',{sessionId:a});await write(configured,'A','A reply',{sessionId:a});await read(configured,'B query',{sessionId:b});
  assert.equal(requests[0].body.agent_id,requests[1].body.agent_id);assert.notEqual(requests[0].body.agent_id,requests[2].body.agent_id);
  await read({...configured,memoryScope:'role'},'shared',{sessionId:b});assert.equal(requests.at(-1).body.agent_id,role.id);
  assert.doesNotMatch(JSON.stringify(requests.map(item=>item.body)),/SYNTHETIC_MEMORY_KEY/);
});
test('new roles without legacy IDs never collapse into a shared default memory identity',async t=>{
  fakeFetch(t,async()=>response());const identities=[];
  const environment={...env(),searchAgentLongTermMemory:async agent=>{identities.push(agent.id);return '';}};
  const configuration={name:'New',model:'custom-vision',apiConfigId:'explicit',memoryEnabled:true,memoryScope:'role'};
  for(const roleId of ['role-11111111-1111-4111-8111-111111111111','role-22222222-2222-4222-8222-222222222222'])await runWorkspaceRoleTurn({sessionId:a,roleId,configuration,messages:[],text:'Question',environment,signal:new AbortController().signal});
  assert.notEqual(identities[0],identities[1]);assert.ok(identities.every(value=>value.startsWith('role-')));
});
test('custom request queue bounds concurrency and cancels queued jobs without starting them',async()=>{
  const queue=createRoleRequestQueue(2,1),controllers=[new AbortController(),new AbortController(),new AbortController()];let live=0,peak=0;const finish=[];
  const work=()=>new Promise(resolve=>{live++;peak=Math.max(peak,live);finish.push(()=>{live--;resolve('done');});});
  const first=queue.run('A',controllers[0].signal,work),second=queue.run('B',controllers[1].signal,work),third=queue.run('C',controllers[2].signal,()=>{throw Error('must not start');});third.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(peak,2);controllers[2].abort();await assert.rejects(third,{code:'ASSISTANT_CANCELLED'});finish.forEach(resolve=>resolve());await Promise.all([first,second]);assert.equal(live,0);
});
