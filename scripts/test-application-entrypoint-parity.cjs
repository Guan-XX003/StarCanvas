// Actual shared main host, HTTP server, internal IPC/client, CLI and stdio MCP.
// Synthetic graph/factory only; no Electron GUI, media IO or provider transport.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module'),{spawn}=require('node:child_process'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createAssistantOperationClient}=require('../src/renderer/lib/assistant-operation-client.ts');
const {createApplicationTaskReader}=require('../src/renderer/lib/application-task-records.ts');
const {registerApplicationOperationIpc}=require('../electron/main/application-operation-ipc.cjs');
const host=require('../electron/main/application-operation-host.cjs'),root=path.resolve(__dirname,'..');
const until=async(fn)=>{const end=Date.now()+5000;while(Date.now()<end){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,2));}assert.fail('Parity observation timed out');};
const terminal=s=>['completed','failed','rejected','cancelled','expired','outcome_unknown'].includes(s);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function fixture(t){
 host.closeApplicationOperations();const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'starcanvas-entrypoint-parity-'));
 let state={projectId:'QA_PROJECT',instanceId:'QA_MOUNT',ready:true,nodes:[{id:'original-text',type:'textNode',selected:true,position:{x:0,y:0},data:{text:'PRIVATE_QA_CONTENT',key:'PRIVATE_QA_KEY'}},{id:'original-image',type:'imageNode',selected:true,position:{x:0,y:300},data:{imageUrl:'file:///PRIVATE_QA_MEDIA',projectAssetBindings:{imageUrl:{assetId:'qa-image'}}}}],edges:[]},commits=0,statusCalls=0,hold,selection=1;
 const capabilities={textNode:{models:[],parameters:{}},promptNode:{models:['qa-image'],parameters:{imageSize:['1K'],aspectRatio:['1:1']}},videoNode:{models:['qa-video'],parameters:{selectedSeconds:['5']}}};
 const canvas=createCanvasPlanController({read:()=>state,capabilities:()=>capabilities,prepareNode:(type,position,data)=>({id:data.__nodeId,type,position:{...position},data:Object.fromEntries(Object.entries(data).filter(([k])=>k!=='__nodeId'))}),commit:(_before,after)=>{commits++;state=after;}});
 const tasks=[{id:'qa-task',nodeId:'qa-node',projectId:'QA_PROJECT',type:'video',status:'completed',progress:100,modelName:'qa-video',createdAt:1,prompt:'PRIVATE_QA_PROMPT',resultUrl:'file:///PRIVATE_QA_RESULT',errorMsg:'PRIVATE_QA_ERROR'}],taskReader=createApplicationTaskReader(()=>tasks,new Map());
 const automation={status:async()=>{statusCalls++;await hold?.promise;return {ready:true,version:'QA_VERSION',activeTasks:0,key:'PRIVATE_QA_KEY'};},models:async()=>({image:['qa-image'],video:['qa-video'],text:['qa-text'],key:'PRIVATE_QA_KEY'})};
 let service;
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>state.projectId,getProjects:()=>[{id:'QA_PROJECT',name:'PRIVATE_QA_PROJECT_NAME'}],getCanvas:()=>canvas,getAutomation:()=>automation,getTaskReader:()=>taskReader,consume:(id,nonce)=>service.consume(id,nonce),getInternalScope:owner=>({owner,selected:owner==='QA_SESSION',selectionVersion:selection,projectId:'QA_PROJECT'})});
 // Simulate executeJS's process serialization, not foreign-realm objects being
 // passed directly to Node implementations of strict renderer parsers.
 const rendererBridge=Object.fromEntries(Object.entries(dispatcher.bridge).map(([name,fn])=>[name,value=>fn(structuredClone(value))]));
 const globals={__wanjuanApplicationOperations:rendererBridge,__wanjuanAutomation:automation,__wanjuanTaskAutomation:taskReader};
 const win={isDestroyed:()=>false,webContents:{send(){},executeJavaScript:async script=>structuredClone(await vm.runInNewContext(script,globals))}};
 const file=path.join(root,'electron/main/automation-server.cjs'),load=Module._load;let server;
 try{Module._load=function(name,parent,...rest){if(parent?.filename===file&&name==='./electron-refs.cjs')return {app:{getPath:()=>directory,getVersion:()=> 'QA_VERSION'},BrowserWindow:{getAllWindows:()=>[win]}};return load.call(this,name,parent,...rest);};delete require.cache[file];server=require(file);}finally{Module._load=load;}
 const info=await server.startAutomationServer(win);service=host.getApplicationOperationService();
 const routes=new Map(),trusted={qa:true};registerApplicationOperationIpc({ipcMain:{handle:(name,fn)=>routes.set(name,fn)},rejectUntrustedIpc:event=>assert.equal(event,trusted),getService:()=>service});
 const invoke=(method,payload)=>routes.get('wanjuan:application-operation-'+method)(trusted,payload);
 const bridge={applicationOperationSubmitInternal:(owner,request,selectionVersion)=>invoke('submit-internal',{owner,request,selectionVersion}),applicationOperationReadInternal:(owner,id)=>invoke('read-internal',{owner,id}),applicationOperationApproveInternal:(owner,id,revision)=>invoke('approve-internal',{owner,id,revision}),applicationOperationCancelInternal:(owner,id)=>invoke('cancel-internal',{owner,id})};
 const internal=createAssistantOperationClient(()=>bridge,{intervalMs:2,waitMs:5000}),children=new Set(),env={...process.env,STARCANVAS_AUTOMATION_FILE:path.join(directory,'starcanvas-automation.json')};
 const cli=args=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[path.join(root,'bin/starcanvas.mjs'),...args],{env,stdio:['ignore','pipe','pipe']});children.add(c);let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',code=>{children.delete(c);if(code){let value;try{value=JSON.parse(err);}catch{value={code:'QA_CLI_FAILED'};}reject(Object.assign(Error(value.code),value));}else resolve(JSON.parse(out));});});
 const mcp=(name,args)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[path.join(root,'bin/starcanvas-mcp.mjs')],{env,stdio:['pipe','pipe','pipe']});children.add(c);let out='',settled=false;c.stdout.on('data',b=>{out+=b;for(const line of out.split('\n').slice(0,-1)){let r;try{r=JSON.parse(line);}catch{continue;}if(r.id===2&&!settled){settled=true;c.stdin.end();const v=r.result?.structuredContent;if(r.error||r.result?.isError)reject(Object.assign(Error(v?.code||'QA_MCP_FAILED'),v));else resolve(v);}}});c.on('error',reject);c.on('close',()=>{children.delete(c);if(!settled)reject(Error('QA_MCP_CLOSED'));});for(const r of [{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}}])c.stdin.write(JSON.stringify(r)+'\n');});
 const request=(operation,args={},key='qa-parity-'+crypto.randomUUID())=>({operation,projectId:'QA_PROJECT',arguments:args,idempotencyKey:key});
 const entry=kind=>({
  async submit(r){if(kind==='internal'){const h=await bridge.applicationOperationSubmitInternal('QA_SESSION',r,selection);if(!h.ok)throw Object.assign(Error(h.code),h);return h.value;}return kind==='cli'?cli(['operation','submit','--json',JSON.stringify(r)]):mcp('starcanvas_submit_operation',r);},
  async read(h){if(kind==='internal'){const r=await bridge.applicationOperationReadInternal('QA_SESSION',h.request.id);if(!r.ok)throw Object.assign(Error(r.code),r);return r.value;}return (kind==='cli'?await cli(['operation','get',h.request.id,'--receipt',h.receipt]):await mcp('starcanvas_get_operation',{id:h.request.id,receipt:h.receipt})).request;},
  async approve(h,r){if(kind==='internal')return internal.run('QA_SESSION',r.operation,r.projectId,r.arguments,{confirm:true,selectionVersion:selection,isCurrent:()=>true,idempotencyKey:r.idempotencyKey});
   const waiting=await until(async()=>{const v=await this.read(h);return v.status==='awaiting_confirmation'&&v;});const result=await invoke('approve',{id:h.request.id,revision:waiting.revision});assert(result.ok);const done=await until(async()=>{const v=await this.read(h);return terminal(v.status)&&v;});if(done.status!=='completed')throw Object.assign(Error(done.code),done);return done.result;
  },
  async run(r){if(kind==='internal')return internal.run('QA_SESSION',r.operation,r.projectId,r.arguments,{idempotencyKey:r.idempotencyKey});const h=await this.submit(r),done=await until(async()=>{const v=await this.read(h);return terminal(v.status)&&v;});if(done.status!=='completed')throw Object.assign(Error(done.code),done);return done.result;},
 });
 t.after(async()=>{for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');await server.stopAutomationServer();dispatcher.close();await fsp.rm(directory,{recursive:true,force:true});});
 return {entry,request,cli,mcp,internal,bridge,service,canvas,info,get state(){return state;},get commits(){return commits;},get statusCalls(){return statusCalls;},hold(){hold=deferred();return hold;},selectAway(){selection++;},async http(method,endpoint,body){const r=await fetch('http://127.0.0.1:'+info.port+endpoint,{method,headers:{authorization:'Bearer '+info.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}};
}
const proposal={version:1,operations:[{op:'create',key:'text',kind:'text',position:{x:500,y:0},fields:{text:'QA_DRAFT'}},{op:'create',key:'image',kind:'image',position:{x:900,y:0},fields:{prompt:'QA_IMAGE',selectedModel:'qa-image',imageSize:'1K',aspectRatio:'1:1'}},{op:'create',key:'video',kind:'video',position:{x:1300,y:0},fields:{prompt:'QA_VIDEO',selectedModel:'qa-video',selectedSeconds:'5'}},{op:'reference',key:'reference',source:'original-image',position:{x:500,y:300}},{op:'connect',source:'text',target:'image'},{op:'connect',source:'reference',target:'image'}]};

test('internal client, actual CLI and stdio MCP use the same host/controller for confirmed graph batches and undo',async t=>{
 const f=await fixture(t),snapshots=[];
 for(const kind of ['internal','cli','mcp']){
  const e=f.entry(kind),before=f.commits,capture=await e.run(f.request('canvas.read'));
  assert(!JSON.stringify(capture).includes('PRIVATE_QA'));
  const preview=await e.run(f.request('canvas.plan.preview',{ticketId:capture.ticketId,proposal}));assert.deepEqual(preview.counts,{created:3,updated:0,connected:2,moved:0,references:1});assert.equal(f.commits,before);
  const r=f.request('canvas.plan.apply',{planId:preview.planId}),h=await e.submit(r);await until(async()=>{const v=await e.read(h);return v.status==='awaiting_confirmation';});assert.equal(f.commits,before,'connection or preview must not grant edit');
  const applied=await e.approve(h,r);assert.equal(applied.generationStarted,false);assert.equal(f.commits,before+1);assert.equal(f.state.nodes.length,6);assert.equal(f.state.edges.length,2);
  snapshots.push(f.state.nodes.slice(2).map(n=>({type:n.type,position:n.position,data:n.data})));
  const again=await e.submit(r);assert.equal(again.request.id,h.request.id);assert.equal(again.replayed,true);assert.equal(f.commits,before+1);
  const u=f.request('canvas.plan.undo',{planId:preview.planId}),uh=await e.submit(u);assert.equal((await e.approve(uh,u)).status,'undone');assert.equal(f.commits,before+2);assert.equal(f.state.nodes.length,2);assert.equal(f.state.nodes[0].data.text,'PRIVATE_QA_CONTENT');
 }
 assert.deepEqual(snapshots[1],snapshots[0]);assert.deepEqual(snapshots[2],snapshots[0]);
});
test('same metadata and safe error projections cross the real internal/CLI/MCP transports',async t=>{
 const f=await fixture(t),values=[];
 for(const kind of ['internal','cli','mcp']){const e=f.entry(kind),v={};for(const op of ['app.status','models.list','tasks.list','tasks.get','projects.list'])v[op]=await e.run(f.request(op,op==='tasks.get'?{id:'qa-task'}:{}));assert(!JSON.stringify(v).includes('PRIVATE_QA'));values.push(v);}
 assert.deepEqual(values[1],values[0]);assert.deepEqual(values[2],values[0]);assert.deepEqual(await f.cli(['status']),values[0]['app.status']);assert.deepEqual(await f.mcp('wanjuan_get_task',{id:'qa-task'}),values[0]['tasks.get']);assert.equal(f.commits,0);
 for(const kind of ['internal','cli','mcp'])for(const [op,args]of [['configuration.write',{}],['configuration.read',{}],['data.delete',{}],['canvas.read',{path:'/PRIVATE_QA_FILE'}]])await assert.rejects(f.entry(kind).submit(f.request(op,args)),{code:op==='canvas.read'?'OPERATION_INVALID_REQUEST':'OPERATION_UNSUPPORTED'});
 assert.equal(f.commits,0);
});
test('content approval, owner isolation, forged authority and stale plans are enforced by the App for all entries',async t=>{
 const f=await fixture(t);
 for(const kind of ['internal','cli','mcp']){
  const e=f.entry(kind),read=f.request('canvas.read',{includeContent:true}),h=await e.submit(read),w=await until(async()=>{const r=await e.read(h);return r.status==='awaiting_confirmation'&&r;});assert(!JSON.stringify(w).includes('PRIVATE_QA'));
  if(kind==='internal')await assert.rejects(f.internal.run('QA_SESSION',read.operation,read.projectId,read.arguments,{idempotencyKey:read.idempotencyKey}),{code:'OPERATION_PERMISSION_REQUIRED'});
  const content=await e.approve(h,read);assert.equal(content.nodes[0].content.text,'PRIVATE_QA_CONTENT');assert(!JSON.stringify(content).includes('PRIVATE_QA_KEY'));
  const preview=await e.run(f.request('canvas.plan.preview',{ticketId:content.ticketId,proposal})),r=f.request('canvas.plan.apply',{planId:preview.planId}),a=await e.submit(r);await until(async()=>(await e.read(a)).status==='awaiting_confirmation');
  const before=f.commits;f.state.nodes[0].data.text='MANUAL_EDIT';await assert.rejects(e.approve(a,r),{code:'PLAN_STALE'});assert.equal(f.commits,before);assert.equal(f.state.nodes.length,2);f.state.nodes[0].data.text='PRIVATE_QA_CONTENT';f.canvas.observe();
  await assert.rejects(e.submit({...f.request('canvas.read'),permissions:['all'],confirmed:true}),{code:'OPERATION_INVALID_REQUEST'});
 }
 const internal=f.entry('internal'),capture=await internal.run(f.request('canvas.read'));
 for(const kind of ['cli','mcp'])await assert.rejects(f.entry(kind).run(f.request('canvas.plan.preview',{ticketId:capture.ticketId,proposal})),{code:'OPERATION_NOT_FOUND'});
 assert.equal((await f.http('POST','/v1/operations/not-a-real-operation/approve',{confirmed:true})).status,404);
});
test('CLI/MCP retain shared idempotency and real task aliases without silently granting generation',async t=>{
 const f=await fixture(t),r=f.request('canvas.read'),a=await f.entry('cli').submit(r),b=await f.entry('mcp').submit(r);assert.equal(a.request.id,b.request.id);assert.equal(b.replayed,true);
 await assert.rejects(f.entry('mcp').submit({...r,arguments:{scope:'structure'}}),{code:'OPERATION_IDEMPOTENCY_CONFLICT'});
 const waiting=await f.mcp('starcanvas_generate_image',{prompt:'QA',model:'qa-image',projectId:'QA_PROJECT',idempotencyKey:'qa-parity-no-paid-0001'});await until(()=>f.service.list().some(x=>x.id===waiting.request.id));assert.equal(f.commits,0);
 const staleReceipt=await f.http('GET','/v1/operations/'+waiting.request.id);assert.equal(staleReceipt.body.code,'OPERATION_NOT_FOUND');
 const forgery=await f.http('POST','/v1/video/generate',{prompt:'QA',idempotencyKey:'qa-forged-generation-0001',permissions:['generation.paid'],confirmed:true});assert.equal(forgery.body.code,'OPERATION_INVALID_REQUEST');assert.equal(f.commits,0);
});
