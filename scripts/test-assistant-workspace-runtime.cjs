// Actual main service + pinned official Harness + encrypted workspace store.
// Synthetic local provider/key wrapping only; no system store or paid network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const Module = require('node:module');
const root = path.resolve(__dirname,'..');
const {createAssistantWorkspaceVault,DIRECTORY} = require('../electron/main/assistant-workspace-vault.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-workspace-runtime-'));
const wrapper = crypto.randomBytes(32);
const encrypt = async text => {
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',wrapper,iv);
  const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
};
const decrypt = async encoded => {
  const bytes=Buffer.from(encoded,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',wrapper,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
};
const bodies=[],homes=new Set(),held=new Set();let endpoint,active=0,peak=0,childCount=0;
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){
  if(parent?.filename.endsWith('assistant-service.cjs')){
    if(name==='./electron-refs.cjs')return {app:{isPackaged:false,getAppPath:()=>root,getPath:()=>profile},net:require('./assistant-test-net.cjs')(()=>endpoint)};
    if(name==='./assistant-credential-vault.cjs')return {createSystemAssistantCredentialVault:()=>({getForMainProcess:async()=> 'synthetic-key',hasCredential:async()=>true,set:async()=>{}})};
    if(name==='./assistant-workspace-vault.cjs')return {createSystemAssistantWorkspaceVault:()=>createAssistantWorkspaceVault({userDataPath:profile,encrypt,decrypt})};
    if(name==='./assistant-harness-client.cjs'){
      const actual=originalLoad.apply(this,arguments);
      return {createHarnessClient:options=>{
        assert.match(options.env.DEEPSEEK_API_KEY,/^sk-local-/,'only a short-lived loopback key reaches Harness');
        active++;childCount++;peak=Math.max(peak,active);homes.add(options.home);
        const client=actual.createHarnessClient(options);let closed=false;
        return {sendMessage:(...args)=>client.sendMessage(...args),close:async()=>{await client.close();if(!closed){closed=true;active--;}}};
      }};
    }
  }
  return originalLoad.apply(this,arguments);
};
const assistant=require('../electron/main/assistant-service.cjs');Module._load=originalLoad;
const until=async check=>{for(let i=0;i<1500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('SYNTHETIC_RUNTIME_WAIT_EXPIRED');};
function reply(res,text){
  const events=[
    ['message_start',{type:'message_start',message:{id:'msg_synthetic',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
    ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
    ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text}}],
    ['content_block_stop',{type:'content_block_stop',index:0}],
    ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
    ['message_stop',{type:'message_stop'}],
  ];
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(events.map(([name,data])=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
}
const server=http.createServer((req,res)=>{
  let bytes='';req.on('data',chunk=>{bytes+=chunk;});req.on('end',()=>{
    bodies.push(bytes);
    if(bytes.includes('SYNTHETIC_CANVAS_PLAN_REQUEST')){reply(res,JSON.stringify({version:1,operations:[{op:'create',key:'text',kind:'text',position:{x:0,y:0},fields:{text:'SYNTHETIC_PLANNED_TEXT'}}]}));return;}
    if(bytes.includes('SYNTHETIC_HOLD_A')||bytes.includes('SYNTHETIC_HOLD_B')){
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      res.write('data: '+JSON.stringify({type:'message_start',message:{id:'msg_held_qa',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}})+'\n\n'+'data: '+JSON.stringify({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+'\n\n'+'data: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'PARTIAL_A [[STARCANVAS_ACTION:open_settings]]'}})+'\n\n');
      held.add(res);res.on('close',()=>held.delete(res));return;
    }
    const text=bytes.includes('PRIVATE_B_QUESTION')?'PRIVATE_B_REPLY':bytes.includes('PRIVATE_C_QUESTION')?'PRIVATE_C_REPLY':'PRIVATE_A_REPLY';
    reply(res,text);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));endpoint=`http://127.0.0.1:${server.address().port}`;
  try{
    const a=await assistant.workspaceCreateSession({name:'A'}),b=await assistant.workspaceCreateSession({name:'B'}),c=await assistant.workspaceCreateSession({name:'C'});
    const aid=a.value.id,bid=b.value.id,cid=c.value.id;
    const requestA=crypto.randomUUID(),requestB=crypto.randomUUID();
    const pendingA=assistant.workspaceSend(aid,'SYNTHETIC_HOLD_A',{},requestA);pendingA.catch(()=>{});
    await until(()=>held.size===1);
    await until(()=>assistant.workspaceProgress(aid,requestA)?.text.includes('PARTIAL_A'));
    assert.equal(assistant.workspaceProgress(aid,requestA).phase,'receiving');
    assert.equal((await assistant.workspaceReadSession(aid)).value.messages.length,1,'preview did not commit a reply before SDK terminal');
    await assert.rejects(assistant.workspaceSend(aid,'DUPLICATE',{},crypto.randomUUID()),{code:'ASSISTANT_BUSY'});
    const replyB=await assistant.workspaceSend(bid,'PRIVATE_B_QUESTION',{},requestB);
    assert.equal(replyB.value.messages.at(-1).content,'PRIVATE_B_REPLY');
    assert.equal(assistant.workspaceProgress(bid,requestB).phase,'closed');
    assert.equal(assistant.workspaceProgress(bid,requestB).text,'PRIVATE_B_REPLY');
    assert.equal(assistant.workspaceProgress(bid,requestA),null);
    assert.equal(active,2,'two actual Harness children are independently live');
    assert.equal((await assistant.workspaceReadSession(aid)).value.task.status,'running');
    await assistant.workspaceCancel(aid);await assert.rejects(pendingA,{code:'ASSISTANT_CANCELLED'});
    assert.equal(assistant.workspaceProgress(aid,requestA).phase,'closed');
    assert.equal((await assistant.workspaceReadSession(aid)).value.task.status,'cancelled');
    const count=childCount;
    const againB=await assistant.workspaceSend(bid,'PRIVATE_B_SECOND');
    assert.equal(childCount,count,'B runtime and session survive A cancellation');
    assert.equal(againB.value.messages.length,4);
    const bbody=bodies.at(-1);assert.match(bbody,/PRIVATE_B_QUESTION/);assert.match(bbody,/PRIVATE_B_REPLY/);assert.doesNotMatch(bbody,/SYNTHETIC_HOLD_A/);
    const firstA=await assistant.workspaceSend(aid,'PRIVATE_A_QUESTION');assert.equal(firstA.value.task.status,'completed');
    assert.doesNotMatch(bodies.at(-1),/PRIVATE_B_|SYNTHETIC_HOLD_A/);
    assert.doesNotMatch(bodies.at(-1),/PARTIAL_A/,'incomplete previews never become canonical model context');
    await assistant.workspaceSend(cid,'PRIVATE_C_QUESTION');assert.ok(peak<=2,'third session evicts one idle runtime rather than owning a third');
    await assistant.workspaceSend(bid,'PRIVATE_B_AFTER_EVICTION');assert.match(bodies.at(-1),/PRIVATE_B_QUESTION/);assert.doesNotMatch(bodies.at(-1),/PRIVATE_A_|PRIVATE_C_/);
    assert.ok(peak<=2);
    const before=bodies.length;await assert.rejects(assistant.workspaceSend(bid,'sk-abcdefghijklmnop'),{code:'ASSISTANT_SENSITIVE_INPUT'});assert.equal(bodies.length,before);
    const role=await assistant.workspaceCreateRole({name:'Custom model',model:'custom-vision',apiConfigId:'manual'});
    const custom=await assistant.workspaceCreateSession({roleId:role.id});
    await assert.rejects(assistant.workspaceSend(custom.value.id,'never reroute'),{code:'ASSISTANT_ENGINE_NOT_READY'});assert.equal(bodies.length,before);
    // Credential replacement closes all warm workers. No stale credential
    // runtime may survive a change simply because it owns another session.
    await assistant.setKey('synthetic-replacement');assert.equal(active,0);
    await assistant.workspaceSend(bid,'PRIVATE_B_AFTER_KEY_CHANGE');assert.match(bodies.at(-1),/PRIVATE_B_QUESTION/);
    await assistant.close();assert.equal(active,0);
    await assistant.workspaceSend(bid,'PRIVATE_B_AFTER_REOPEN');assert.match(bodies.at(-1),/PRIVATE_B_QUESTION/);
    const planRequest={version:1,scope:'selected',includeContent:false,nodes:[],edges:[],capabilities:{textNode:{models:['text-fixture'],parameters:{}}}};
    const planId=crypto.randomUUID();
    const planned=await assistant.workspaceSend(bid,'SYNTHETIC_CANVAS_PLAN_REQUEST',{canvasPlan:planRequest},planId);
    assert.equal(assistant.workspaceProgress(bid,planId),null,'strict canvas JSON has no actionable streaming preview');
    assert.equal(JSON.parse(planned.value.messages.at(-1).content).operations[0].fields.text,'SYNTHETIC_PLANNED_TEXT');
    assert.equal(planned.value.messages.at(-2).content,'SYNTHETIC_CANVAS_PLAN_REQUEST','the original user text, not the derived canvas prompt, is the persisted transcript');
    assert.match(bodies.at(-1),/canvas PLAN request/);
    const beforeInvalid=bodies.length;await assert.rejects(assistant.workspaceSend(bid,'NO_SEND',{canvasPlan:{...planRequest,apiKey:'NO'}}),{code:'ASSISTANT_INVALID_MESSAGE'});assert.equal(bodies.length,beforeInvalid);
    for(const name of await fsp.readdir(path.join(profile,DIRECTORY))){
      assert.doesNotMatch(await fsp.readFile(path.join(profile,DIRECTORY,name),'utf8'),/PRIVATE_|SYNTHETIC_HOLD|synthetic-key/);
    }
    console.log(JSON.stringify({ok:true,realHarness:true,encryptedWorkspace:true,syntheticProvider:true,peakWorkspaceChildren:peak,requests:bodies.length}));
  }finally{
    await assistant.shutdown();for(const res of held)res.destroy();await new Promise(resolve=>server.close(resolve));
    for(const home of homes)assert.equal(fs.existsSync(home),false,'confirmed exit removes only the owned temporary runtime home');
    await fsp.rm(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error({ok:false,code:error?.code||'SYNTHETIC_ASSERTION',line:String(error?.stack||'').split('\n').find(line=>line.includes(__filename))?.replace(__filename,'test')});process.exitCode=1;});
