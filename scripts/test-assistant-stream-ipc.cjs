// Execute the actual registered IPC handler and actual managed retry function
// with closed synthetic transports/credentials. No Electron/real account IO.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function source(file){return ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.ESNext,true);}
const ipc=source(require.resolve('../electron/main/ipc.cjs')),account=source(require.resolve('../electron/main/account-service.cjs'));let handlerText,retryText;
function walk(node,fn){fn(node);ts.forEachChild(node,n=>walk(n,fn));}
walk(ipc,n=>{if(ts.isCallExpression(n)&&n.expression.getText(ipc)==='ipcMain.handle'&&n.arguments[0]?.text==='wanjuan:proxy-fetch')handlerText=n.arguments[1].getText(ipc);});
walk(account,n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='requestWithManagedRelayRetry')retryText=n.getText(account);});assert(handlerText&&retryText);
function fixture({statuses=[200],managed=true,throwAfterText=false,untrusted=false}={}){
 const frames=[],controllers=new Map();let calls=0,preparations=0,refreshes=0;
 const retry=vm.runInNewContext('('+retryText+')',{prepareManagedRelayRequest:async()=>{preparations++;return {managed,headers:{Authorization:'Bearer SYNTHETIC_VERSION_'+preparations}};},refreshManagedRelayCredential:async()=>{refreshes++;}});
 const context={Buffer,AbortController,Error,Number,String,Array,Math,desktopProxyFetchControllers:controllers,rejectUntrustedIpc:()=>untrusted?{ok:false,code:'IPC_UNTRUSTED'}:null,
  sanitizeProxyFetchHeaders:headers=>({...headers}),inspectTianjiGenerationRequest:()=>null,validateTianjiGenerationRequest(){},captureTianjiGenerationPreflight:()=>null,proxyEnterpriseRequest:async()=>({handled:false}),
  assertPublicHttpUrl:url=>assert.equal(url,'https://synthetic.invalid/v1/chat/completions'),requestWithManagedRelayRetry:retry,classifyDesktopProxyFetch:()=>null,
  appendDesktopLog(){},formatErrorMessage:()=> 'Request unavailable',proxyHttpRequest:async(_url,options)=>{
   const status=statuses[calls++];assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_VERSION_'+preparations);options.onResponse({status,statusText:'QA',headers:[['content-type','text/event-stream']]});options.onChunk(Buffer.from(status===401?'PRIVATE_REJECTED_BODY':'SYNTHETIC_ANSWER'));
   if(throwAfterText)throw Error('PRIVATE_NETWORK_ERROR');return {status,statusText:'QA',headers:[],bodyBase64:''};
  }};
 const handler=vm.runInNewContext('('+handlerText+')',context),event={senderFrame:{send:(_channel,frame)=>frames.push(frame)}};
 return {handler,event,frames,controllers,get calls(){return calls;},get preparations(){return preparations;},get refreshes(){return refreshes;}};
}
const payload={requestId:'SYNTHETIC_STREAM_IPC',url:'https://synthetic.invalid/v1/chat/completions',method:'POST',streamResponse:true};
test('real stream IPC preserves managed-key preparation and its single 401 refresh without leaking the rejected response',async()=>{
 const f=fixture({statuses:[401,200]}),result=await f.handler(f.event,payload);assert.equal(result.ok,true);assert.equal(result.streamed,true);assert.equal(result.streamChunks,1);assert.equal(f.calls,2);assert.equal(f.preparations,2);assert.equal(f.refreshes,1);
 assert.equal(f.frames.filter(p=>p.type==='headers').length,1);assert.equal(f.frames[0].status,200);assert(!JSON.stringify(f.frames).includes('PRIVATE_REJECTED_BODY'));assert.equal(Buffer.from(f.frames[1].base64,'base64').toString(),'SYNTHETIC_ANSWER');assert.equal(f.controllers.size,0);
});
test('manual credentials receive one 401, and network failure after published text never performs another request',async()=>{
 const manual=fixture({statuses:[401],managed:false}),a=await manual.handler(manual.event,payload);assert.equal(a.status,401);assert.equal(a.streamed,false);assert.equal(manual.calls,1);assert.equal(manual.refreshes,0);assert.equal(manual.frames.length,0);
 const broken=fixture({throwAfterText:true}),b=await broken.handler(broken.event,payload);assert.equal(b.ok,false);assert.equal(broken.calls,1);assert.equal(broken.refreshes,0);assert.equal(broken.frames[0].status,200);assert(!JSON.stringify(b).includes('PRIVATE'));assert.equal(broken.controllers.size,0);
});
test('untrusted and duplicate request identities are rejected before credential preparation or transport',async()=>{
 const f=fixture({untrusted:true});assert.equal((await f.handler(f.event,payload)).ok,false);assert.equal(f.calls,0);assert.equal(f.preparations,0);
 const duplicate=fixture();duplicate.controllers.set(payload.requestId,{sentinel:true});assert.equal((await duplicate.handler(duplicate.event,payload)).ok,false);assert.equal(duplicate.calls,0);assert.equal(duplicate.preparations,0);assert.equal(duplicate.controllers.get(payload.requestId).sentinel,true);
});
