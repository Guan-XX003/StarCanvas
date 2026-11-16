const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),path=require('node:path'),{EventEmitter}=require('node:events');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {readAssistantTextResponse}=require('../src/renderer/lib/assistant-text-stream.ts');
const {fetchAssistantStream}=require('../src/renderer/lib/assistant-stream-fetch.ts');
const {invokeDesktopProxyFetchStream}=require('../electron/preload/fetch-stream.cjs');
const tick=()=>new Promise(setImmediate),sse=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
function controlled(){let source;const response=new Response(new ReadableStream({start:c=>{source=c;}}),{headers:{'content-type':'text/event-stream'}});return {response,write:frame=>source.enqueue(new TextEncoder().encode(frame)),close:()=>source.close(),error:e=>source.error(e)};}
const cases={
 'openai-chat':[{choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING',tool_calls:[{arguments:'PRIVATE_TOOL'}],content:'第一'}}]},{choices:[{index:0,delta:{content:'段'}}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]}],
 'openai-responses':[{type:'response.output_text.delta',delta:'第一'},{type:'response.output_text.delta',delta:'段'},{type:'response.completed',response:{status:'completed'}}],
 gemini:[{candidates:[{content:{parts:[{thought:true,text:'PRIVATE_REASONING'},{text:'第一'}]}}]},{candidates:[{content:{parts:[{text:'段'}]}}]},{candidates:[{finishReason:'STOP'}]}],
};
test('all three actual SSE protocols publish text before completion, exclude reasoning/tools and require a terminal marker',async()=>{
 for(const [protocol,frames]of Object.entries(cases)){
  const stream=controlled(),updates=[];let finished=false;const result=readAssistantTextResponse(stream.response,protocol,{onText:text=>updates.push(text)}).then(value=>{finished=true;return value;});
  stream.write(sse(frames[0]));await tick();assert.deepEqual(updates,['第一']);assert.equal(finished,false);
  stream.write(sse(frames[1]));stream.write(sse(frames[2]));stream.close();assert.equal(await result,'第一段');assert(!updates.join('').includes('PRIVATE'));
 }
});
test('UTF-8 and CRLF boundaries are decoded across arbitrary byte chunks without duplicating text',async()=>{
 const bytes=new TextEncoder().encode(sse(cases['openai-chat'][0])+sse(cases['openai-chat'][2]));
 const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 const seen=[];assert.equal(await readAssistantTextResponse(response,'openai-chat',{onText:t=>seen.push(t)}),'第一');assert.deepEqual(seen,['第一']);
});
test('an explicit terminal marker finishes without waiting on an idle keep-alive body',async()=>{
 const stream=controlled(),result=readAssistantTextResponse(stream.response,'openai-chat');stream.write(sse(cases['openai-chat'][0])+sse(cases['openai-chat'][2]));assert.equal(await result,'第一');
});
test('a partial trailing metadata frame after terminal text cannot turn a complete reply into a failure',async()=>{
 const stream=controlled(),result=readAssistantTextResponse(stream.response,'openai-chat');stream.write(sse(cases['openai-chat'][0])+sse(cases['openai-chat'][2])+'data: {"usage":');assert.equal(await result,'第一');
});
test('truncation, max tokens, error, malformed frames and cancelled reads never become complete replies or raw errors',async()=>{
 for(const final of ['',sse({choices:[{index:0,finish_reason:'length'}]}),sse({error:{message:'PRIVATE_DIAGNOSTIC'}}),'data: not json\n\n']){
  const stream=controlled(),updates=[];const result=readAssistantTextResponse(stream.response,'openai-chat',{onText:t=>updates.push(t)});stream.write(sse(cases['openai-chat'][0])+final);stream.close();
  await assert.rejects(result,e=>e.code==='ASSISTANT_STREAM_INCOMPLETE'&&!e.message.includes('PRIVATE'));assert.deepEqual(updates,['第一']);
 }
 const stream=controlled(),abort=new AbortController();const result=readAssistantTextResponse(stream.response,'openai-chat',{signal:abort.signal});stream.write(sse(cases['openai-chat'][0]));await tick();abort.abort();stream.error(Error('PRIVATE_ABORT'));await assert.rejects(result,{code:'ASSISTANT_CANCELLED'});
});
test('a provider ignoring stream gets its ordinary JSON reply once, not a fabricated typing animation',async()=>{
 let updates=0;const response=Response.json({choices:[{message:{content:'WHOLE_REPLY'},finish_reason:'stop'}]});assert.equal(await readAssistantTextResponse(response,'openai-chat',{onText:()=>updates++}),'WHOLE_REPLY');assert.equal(updates,0);
 await assert.rejects(readAssistantTextResponse(Response.json({choices:[{message:{content:'TRUNCATED'},finish_reason:'length'}]}),'openai-chat'),{code:'ASSISTANT_STREAM_INCOMPLETE'});
});
function proxyFixture(){
 let request,response,nodeCalls=0;const module={exports:{}},source=fs.readFileSync(path.join(__dirname,'../electron/main/net/proxy-fetch.cjs'),'utf8');
 const net={request(){request=new EventEmitter();request.setHeader=()=>{};request.write=()=>{};request.abort=()=>{request.wasAborted=true;request.emit('close');};request.end=()=>{response=new EventEmitter();response.statusCode=200;response.statusMessage='OK';response.headers={'content-type':'text/event-stream'};queueMicrotask(()=>request.emit('response',response));};return request;}};
 vm.runInNewContext(source,{module,Buffer,console,setTimeout,clearTimeout,URL,require:name=>name==='../electron-refs.cjs'?{net}:name==='../logging.cjs'?{appendDesktopLog(){}}:name==='./security.cjs'?{assertPublicHttpUrl(){}}:{request(){nodeCalls++;throw Error('NO_TRANSPORT_REPLAY');}}});
 const ipc=new EventEmitter(),abort=new AbortController();let sequence=0,done=false;
 ipc.send=(channel,id)=>{assert.equal(channel,'wanjuan:abort-fetch');abort.abort();};
 ipc.invoke=async(channel,payload)=>{assert.equal(channel,'wanjuan:proxy-fetch');try{const result=await module.exports.proxyHttpRequest('https://synthetic.invalid/v1/chat/completions',{method:'POST',signal:abort.signal,onResponse:meta=>ipc.emit('wanjuan:proxy-fetch-stream',{}, {requestId:payload.requestId,type:'headers',...meta}),onChunk:bytes=>ipc.emit('wanjuan:proxy-fetch-stream',{}, {requestId:payload.requestId,type:'chunk',sequence:++sequence,base64:bytes.toString('base64')})});done=true;return {ok:true,...result,streamed:true,streamChunks:sequence};}catch{return {ok:false,aborted:abort.signal.aborted};}};
 return {ipc,abort,get response(){return response;},get request(){return request;},get nodeCalls(){return nodeCalls;},get done(){return done;}};
}
test('actual proxy transport plus preload stream returns early headers/chunks and releases its listener after the one response',async()=>{
 const f=proxyFixture(),response=await invokeDesktopProxyFetchStream(f.ipc,{requestId:'SYNTHETIC_STREAM'},undefined),seen=[];assert.equal(f.done,false);
 const result=readAssistantTextResponse(response,'openai-chat',{onText:t=>seen.push(t)});f.response.emit('data',Buffer.from(sse(cases['openai-chat'][0])));await tick();assert.deepEqual(seen,['第一']);assert.equal(f.done,false);
 f.response.emit('data',Buffer.from(sse(cases['openai-chat'][1])+sse(cases['openai-chat'][2])));f.response.emit('end');assert.equal(await result,'第一段');assert.equal(f.ipc.listenerCount('wanjuan:proxy-fetch-stream'),0);assert.equal(f.nodeCalls,0);
});
test('partial transport failure errors the original body, aborts it and never falls back to Node',async()=>{
 const f=proxyFixture(),response=await invokeDesktopProxyFetchStream(f.ipc,{requestId:'SYNTHETIC_STREAM'},undefined);const result=readAssistantTextResponse(response,'openai-chat');result.catch(()=>{});f.response.emit('data',Buffer.from(sse(cases['openai-chat'][0])));await tick();f.request.emit('error',Error('PRIVATE_NETWORK'));await assert.rejects(result);assert.equal(f.nodeCalls,0);assert.equal(f.ipc.listenerCount('wanjuan:proxy-fetch-stream'),0);
});
test('the actual main-world sender uses the contextBridge stream callback instead of the buffered HTML fetch shim',async t=>{
 const f=proxyFixture(),oldBridge=global.wanjuanDesktop,oldFetch=global.fetch;t.after(()=>{global.wanjuanDesktop=oldBridge;global.fetch=oldFetch;});let calls=0;
 global.fetch=()=>assert.fail('Must not lose streaming through the buffered main-world fetch shim');
 global.wanjuanDesktop={abortProxyFetch:id=>f.ipc.send('wanjuan:abort-fetch',id),proxyFetchStream:async(payload,onFrame)=>{calls++;assert.equal(payload.method,'POST');assert.deepEqual(JSON.parse(Buffer.from(payload.bodyBase64,'base64')),{stream:true});const listener=(_event,part)=>onFrame(part);f.ipc.on('wanjuan:proxy-fetch-stream',listener);try{return await f.ipc.invoke('wanjuan:proxy-fetch',payload);}finally{f.ipc.removeListener('wanjuan:proxy-fetch-stream',listener);}}};
 const response=await fetchAssistantStream('https://synthetic.invalid/v1/chat/completions',{method:'POST',body:JSON.stringify({stream:true})}),updates=[];
 const result=readAssistantTextResponse(response,'openai-chat',{onText:t=>updates.push(t)});f.response.emit('data',Buffer.from(sse(cases['openai-chat'][0])));await tick();assert.deepEqual(updates,['第一']);assert.equal(f.done,false);f.response.emit('data',Buffer.from(sse(cases['openai-chat'][2])));f.response.emit('end');assert.equal(await result,'第一');await tick();assert.equal(calls,1);assert.equal(f.ipc.listenerCount('wanjuan:proxy-fetch-stream'),0);
});
test('another request ID cannot inject text and a non-monotonic chunk aborts only this original stream',async()=>{
 const f=proxyFixture(),response=await invokeDesktopProxyFetchStream(f.ipc,{requestId:'SYNTHETIC_STREAM'},undefined),result=response.text();result.catch(()=>{});
 f.ipc.emit('wanjuan:proxy-fetch-stream',{}, {requestId:'OTHER',type:'chunk',sequence:1,base64:Buffer.from('PRIVATE_OTHER').toString('base64')});
 f.ipc.emit('wanjuan:proxy-fetch-stream',{}, {requestId:'SYNTHETIC_STREAM',type:'chunk',sequence:2,base64:'QQ=='});await assert.rejects(result);assert.equal(f.abort.signal.aborted,true);assert.equal(f.nodeCalls,0);assert.equal(f.ipc.listenerCount('wanjuan:proxy-fetch-stream'),0);
});
test('cancelling an actual Electron-shaped response without destroy settles its original invoke and aborts ClientRequest',async()=>{
 const f=proxyFixture(),abort=new AbortController(),response=await invokeDesktopProxyFetchStream(f.ipc,{requestId:'SYNTHETIC_CANCEL'},abort.signal),reading=response.text();reading.catch(()=>{});assert.equal(typeof f.response.destroy,'undefined');abort.abort();await assert.rejects(reading,{name:'AbortError'});await tick();assert.equal(f.request.wasAborted,true);assert.equal(f.ipc.listenerCount('wanjuan:proxy-fetch-stream'),0);
});
test('request close before the streamed response ends must not detach its cancellation listener',async t=>{
 const f=proxyFixture(),abort=new AbortController(),response=await invokeDesktopProxyFetchStream(f.ipc,{requestId:'SYNTHETIC_EARLY_CLOSE'},abort.signal),reading=response.text();reading.catch(()=>{});
 t.after(()=>f.response.emit('error',Error('SYNTHETIC_CLEANUP')));
 f.request.emit('close');abort.abort();await assert.rejects(reading,{name:'AbortError'});await tick();assert.equal(f.request.wasAborted,true,'response is still live after request-close');
});
