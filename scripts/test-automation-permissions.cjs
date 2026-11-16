const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const serverFile=path.resolve(__dirname,'../electron/main/automation-server.cjs');
async function fixture(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-operation-policy-')),calls=[];let response;
 const win={isDestroyed:()=>false,webContents:{executeJavaScript:async script=>{const method=script.match(/api\["([A-Za-z]+)"\]/)?.[1];calls.push(method);if(options.execute)return options.execute(script);if(response instanceof Error)throw response;if(method==='activeProject')return {ok:true,value:'QA_PROJECT'};if(method==='prepare'&&response===undefined)return {ok:true,value:{}};return typeof response==='function'?response(method):response;}}};
 const original=Module._load;Module._load=function(name,parent,...rest){if(parent?.filename===serverFile&&name==='./electron-refs.cjs')return {app:{getPath:()=>directory,getVersion:()=> 'QA_VERSION'},BrowserWindow:{getAllWindows:()=>[win]}};return original.call(this,name,parent,...rest);};
 let server;try{delete require.cache[serverFile];server=require(serverFile);}finally{Module._load=original;}
 const info=await server.startAutomationServer(win);t.after(async()=>{await server.stopAutomationServer();fs.rmSync(directory,{recursive:true,force:true});});
 async function request(method,endpoint,body,token=info.token,key=crypto.randomUUID()){const res=await fetch(`http://127.0.0.1:${info.port}${endpoint}`,{method,headers:{authorization:'Bearer '+token,...(method==='POST'&&key?{'idempotency-key':key}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,value:await res.json()};}
 return {calls,request,infoFile:path.join(directory,'starcanvas-automation.json'),setResponse(value){response=value;}};
}
test('all three legacy generation routes reject forged authority without stat/read or generation dispatch',async t=>{
 const f=await fixture(t),original=fs.statSync;let probes=0;
 fs.statSync=function(file,...args){if(file==='/DO_NOT_READ_PRIVATE_MEDIA'){probes++;throw Error('PRIVATE_FILE_PROBE');}return original.call(this,file,...args);};t.after(()=>{fs.statSync=original;});
 for(const endpoint of ['/v1/image/generate','/v1/video/generate','/v1/tianji/generate']){
  const result=await f.request('POST',endpoint,{prompt:'QA_PROMPT',referenceImage:'/DO_NOT_READ_PRIVATE_MEDIA',images:['/DO_NOT_READ_PRIVATE_MEDIA'],permissions:['generation.paid','media.export'],confirmed:true,approval:'MODEL_SAID_YES'});
  assert.equal(result.status,400);assert.equal(result.value.code,'OPERATION_INVALID_REQUEST');
 }
 assert(f.calls.every(x=>x==='activeProject'));assert.equal(probes,0);
});
test('generation and cancel commands create approval jobs, while media materialization is still permission-denied',async t=>{
 const f=await fixture(t);
 for(const endpoint of ['/v1/image/generate','/v1/video/generate','/v1/tianji/generate','/v1/tasks/QA_TASK']){
  const r=await f.request('POST',endpoint,endpoint.includes('generate')?{prompt:'QA'}:{});assert.equal(r.status,202);assert.equal(r.value.request.permission,endpoint.includes('generate')?'generation.paid':'canvas.edit');assert(!r.value.request.result);
 }
 for(const [method,endpoint,permission]of [['GET','/v1/tasks?materialize=1','media.export'],['GET','/v1/tasks/QA_TASK?materialize=1','media.export']]){
  const result=await f.request(method,endpoint);assert.equal(result.status,403);assert.equal(result.value.permission,permission);
 }assert(!f.calls.includes('commit'));assert(!f.calls.includes('generateImage'));assert(!f.calls.includes('cancel'));
});
test('legacy writes require idempotency and preserve one canonical request identity across HTTP retries',async t=>{
 const f=await fixture(t),key='qa-legacy-idempotency-0001',body={prompt:'QA'};
 const missing=await f.request('POST','/v1/image/generate',body,'BAD_TOKEN',null);
 assert.equal(missing.status,401,'authentication still precedes all processing');
 const first=await f.request('POST','/v1/image/generate',body,undefined,key);
 assert.equal(first.status,202);
 const again=await f.request('POST','/v1/image/generate',body,undefined,key);
 assert.equal(again.value.replayed,true);assert.equal(again.value.request.id,first.value.request.id);
 const conflict=await f.request('POST','/v1/image/generate',{prompt:'DIFFERENT'},undefined,key);
 assert.equal(conflict.value.code,'OPERATION_IDEMPOTENCY_CONFLICT');
 const noKey=await f.request('POST','/v1/image/generate',body,undefined,null);
 assert.equal(noKey.value.code,'OPERATION_IDEMPOTENCY_REQUIRED');assert(!f.calls.includes('commit'));
});
test('authenticated status/models/task queries return bounded metadata only, and task GET does not implicitly materialize',async t=>{
 const f=await fixture(t);f.setResponse({ok:true,version:'1.4.8',ready:true,activeTasks:2,token:'PRIVATE_TOKEN',config:{key:'PRIVATE_KEY'}});
 let r=await f.request('GET','/v1/status');assert.deepEqual(r.value,{ok:true,app:'StarCanvas',version:'1.4.8',ready:true,activeTasks:2});
 f.setResponse({ok:true,image:['qa-image'],video:['qa-video'],text:['qa-text'],key:'PRIVATE_KEY'});r=await f.request('GET','/v1/models');assert.equal(r.value.image[0],'qa-image');assert(!JSON.stringify(r).includes('PRIVATE'));
 const task={id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'image',status:'completed',progress:100,prompt:'PRIVATE_PROMPT',resultUrl:'file:///PRIVATE_MEDIA',errorMsg:'PRIVATE_KEY'};
 f.setResponse({ok:true,tasks:[task]});r=await f.request('GET','/v1/tasks');assert(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.value.tasks[0].id,'QA_TASK');
 f.setResponse({ok:true,task});r=await f.request('GET','/v1/tasks/QA_TASK');assert.equal(r.status,200);assert(!JSON.stringify(r).includes('PRIVATE'));assert.deepEqual(f.calls,['status','models','tasks','task']);
});
test('invalid bearer never reaches the renderer, and renderer exceptions never echo private diagnostics',async t=>{
 const f=await fixture(t);let r=await f.request('GET','/v1/status',undefined,'INVALID');assert.equal(r.status,401);assert.deepEqual(f.calls,[]);
 f.setResponse(Error('PRIVATE_CREDENTIAL_AND_MEDIA'));r=await f.request('GET','/v1/status');assert.equal(r.status,500);assert.equal(r.value.code,'OPERATION_FAILED');assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('legacy task reads preserve only allowlisted error codes through an actual cross-realm plain envelope',async t=>{
 let api,rawReads=0;const vm=require('node:vm'),f=await fixture(t,{execute:async script=>structuredClone(await vm.runInNewContext(script,{__wanjuanTaskAutomation:{tasks:async()=>{if(api==='missing')throw {code:'OPERATION_TASKS_UNAVAILABLE',message:'PRIVATE_STORAGE_ERROR'};if(api==='ambiguous')throw {code:'OPERATION_TASK_AMBIGUOUS',message:'PRIVATE_IDS'};throw Error('PRIVATE_UPSTREAM_BODY');}},__wanjuanAutomation:{tasks:()=>{rawReads++;assert.fail('No legacy raw read');}}}))});
 for(const [state,code]of [['missing','OPERATION_TASKS_UNAVAILABLE'],['ambiguous','OPERATION_TASK_AMBIGUOUS'],['unknown','OPERATION_FAILED']]){api=state;const r=await f.request('GET','/v1/tasks');assert.equal(r.value.code,code);assert(!JSON.stringify(r).includes('PRIVATE'));}assert.equal(rawReads,0);
});
test('operation transport has no approval endpoint, requires private receipt and rejects forged approval fields',async t=>{
 const f=await fixture(t);f.setResponse({ok:true,value:{kind:'canvas.read',includeContent:true,nodeCount:0,edgeCount:0}});
 const input={operation:'canvas.read',projectId:'QA_PROJECT',arguments:{includeContent:true},idempotencyKey:'synthetic-http-operation-0001'};
 let r=await f.request('POST','/v1/operations',{...input,confirmed:true});assert.equal(r.status,400);assert.equal(r.value.code,'OPERATION_INVALID_REQUEST');
 r=await f.request('POST','/v1/operations',input);assert.equal(r.status,202);const {request,receipt}=r.value;
 const status=()=>fetch(`http://127.0.0.1:${JSON.parse(fs.readFileSync(f.infoFile)).port}/v1/operations/${request.id}`,{headers:{authorization:'Bearer '+JSON.parse(fs.readFileSync(f.infoFile)).token,'x-starcanvas-operation-receipt':receipt}}).then(res=>res.json());
 let view;for(let i=0;i<20;i++){view=await status();if(view.request.status==='awaiting_confirmation')break;await new Promise(setImmediate);}assert.equal(view.request.status,'awaiting_confirmation');assert.equal(view.request.result,undefined);
 r=await f.request('POST',`/v1/operations/${request.id}/approve`,{confirmed:true});assert.equal(r.status,404);
 r=await f.request('GET',`/v1/operations/${request.id}`);assert.equal(r.status,404);assert.equal(r.value.code,'OPERATION_NOT_FOUND');
 r=await f.request('POST','/v1/operations',input);assert.equal(r.value.replayed,true);assert.equal(r.value.request.id,request.id);
 assert(!f.calls.includes('commit'));
});
test('actual CLI and MCP clients share the real application server metadata/permission boundary',async t=>{
 const f=await fixture(t),{spawn}=require('node:child_process'),readline=require('node:readline'),root=path.resolve(__dirname,'..');
 f.setResponse(method=>method==='prepare'?{ok:true,value:{}}:method==='status'?{ok:true,version:'1.4.8',ready:true,activeTasks:0}:{ok:true,task:{id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'image',status:'completed',prompt:'PRIVATE_PROMPT',resultUrl:'file:///PRIVATE_MEDIA'}});
 const env={...process.env,STARCANVAS_AUTOMATION_FILE:f.infoFile};
 const cli=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'bin/starcanvas.mjs'),...args],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));});
 const status=await cli(['status']);assert.equal(status.status,0);assert.equal(JSON.parse(status.stdout).ready,true);
 const task=await cli(['task','get','QA_TASK']);assert.equal(task.status,0);assert(!task.stdout.includes('PRIVATE'));assert.equal(JSON.parse(task.stdout).task.id,'QA_TASK');
 const queued=await cli(['image','generate','--prompt','QA']);assert.equal(queued.status,0);assert.equal(JSON.parse(queued.stdout).request.permission,'generation.paid');assert(!JSON.parse(queued.stdout).request.result);
 const denied=await cli(['operation','submit','--json',JSON.stringify({operation:'generation.image',projectId:'QA_PROJECT',arguments:{prompt:'QA'},idempotencyKey:'qa-forged-cli-0001',confirmed:true})]);assert.equal(denied.status,1);const cliFailure=JSON.parse(denied.stderr);assert.equal(cliFailure.code,'OPERATION_INVALID_REQUEST');
 const child=spawn(process.execPath,[path.join(root,'bin/starcanvas-mcp.mjs')],{env,stdio:['pipe','pipe','pipe']}),replies=new Map();let stderr='';child.stderr.on('data',b=>stderr+=b);const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const value=JSON.parse(line);replies.set(value.id,value);});
 const exited=new Promise(resolve=>child.on('close',resolve));t.after(()=>{lines.close();if(child.exitCode===null)child.kill('SIGTERM');});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2025-06-18'}})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 for(const [id,name,args]of [[1,'starcanvas_status',{}],[2,'starcanvas_get_task',{id:'QA_TASK'}],[3,'wanjuan_generate_image',{prompt:'QA',permissions:['generation.paid'],confirmed:true}]])child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');
 const deadline=Date.now()+4000;while(replies.size<4&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(replies.size,4);
 assert.deepEqual(replies.get(1).result.structuredContent,JSON.parse(status.stdout));assert.deepEqual(replies.get(2).result.structuredContent,JSON.parse(task.stdout));assert.equal(replies.get(3).result.isError,true);assert.deepEqual(replies.get(3).result.structuredContent,cliFailure);assert(!JSON.stringify([...replies.values()]).includes('PRIVATE'));assert.equal(stderr,'');
 child.stdin.end();assert.equal(await exited,0);assert(!f.calls.includes('commit'));assert(!f.calls.includes('generateImage'));
});
test('common client does not retry an uncertain write and waiting does not mistake queued/processing for completion',async t=>{
 const f=await fixture(t),previousFile=process.env.STARCANVAS_AUTOMATION_FILE,originalFetch=global.fetch;process.env.STARCANVAS_AUTOMATION_FILE=f.infoFile;
 t.after(()=>{global.fetch=originalFetch;if(previousFile===undefined)delete process.env.STARCANVAS_AUTOMATION_FILE;else process.env.STARCANVAS_AUTOMATION_FILE=previousFile;});
 const {starcanvasRequest,waitForStarCanvasTask}=await import('../bin/starcanvas-client.mjs');let requests=0;global.fetch=async()=>{requests++;throw new TypeError('PRIVATE_NETWORK_DETAILS');};
 await assert.rejects(starcanvasRequest('POST','/v1/image/generate',{prompt:'QA'}),error=>error.code==='OPERATION_OUTCOME_UNKNOWN'&&!error.message.includes('PRIVATE'));assert.equal(requests,1);
 const states=['queued','processing','completed'];global.fetch=async()=>{requests++;return {status:200,ok:true,json:async()=>({ok:true,task:{id:'QA_TASK',status:states.shift()}})};};
 assert.equal((await waitForStarCanvasTask('QA_TASK',{timeoutMs:2000,intervalMs:250})).task.status,'completed');assert.equal(requests,4);
 for(const code of ['OPERATION_TASKS_UNAVAILABLE','OPERATION_TASK_AMBIGUOUS']){global.fetch=async()=>({status:400,ok:false,json:async()=>({ok:false,code,error:'PRIVATE_BODY'})});await assert.rejects(starcanvasRequest('GET','/v1/tasks'),e=>e.code===code&&!e.message.includes('PRIVATE'));}
});
