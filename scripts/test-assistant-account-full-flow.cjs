// Actual service, PKCE, encrypted vault, broker and bundled Harness. Both the
// provider and browser are simulated; the temporary AES key is not system storage.
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
const packagedAsar = process.env.STARCANVAS_TEST_PACKAGED_ASAR;
const root = packagedAsar ? path.resolve(packagedAsar) : path.resolve(__dirname,'..');
const {createAssistantAccountVault} = require(path.join(root,'electron/main/assistant-account-vault.cjs'));
const wrap = biz_data => ({code:0,data:{biz_code:0,biz_data}});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const frames = [
  ['message_start',{type:'message_start',message:{id:'mock',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
  ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
  ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'FULL_ACCOUNT_FLOW_OK'}}],
  ['content_block_stop',{type:'content_block_stop',index:0}],
  ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
  ['message_stop',{type:'message_stop'}],
].map(([n,d])=>`event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join('');
function callback(url) { return new Promise((resolve,reject) => http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject)); }
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-account-full-'));
  const key = crypto.randomBytes(32), calls = [], environments = [];
  const encrypt = async text => { const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv); return Buffer.concat([iv,c.update(text,'utf8'),c.final(),c.getAuthTag()]).toString('base64'); };
  const decrypt = async text => { const b=Buffer.from(text,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString('utf8'); };
  const vault = createAssistantAccountVault({userDataPath:dir,encrypt,decrypt});
  const saveEntered=deferred(), releaseSave=deferred();
  const heldVault = {...vault,saveGrant:async grant=>{saveEntered.resolve();await releaseSave.promise;return vault.saveGrant(grant);}};
  let initial, browser, service;
  const net = {request(options) {
    const req = new EventEmitter(), call = {options,headers:{},body:[],aborted:false}; calls.push(call);
    req.setHeader=(k,v)=>{call.headers[k.toLowerCase()]=v;}; req.write=v=>call.body.push(Buffer.from(v)); req.abort=()=>{call.aborted=true;};
    req.end=()=>setImmediate(()=>{
      if(call.aborted)return;
      const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};response.pause=()=>{};response.resume=()=>{};
      const data=Buffer.concat(call.body).toString();
      let output;
      if(options.url.endsWith('/auth_init')) { initial=JSON.parse(data);output=JSON.stringify(wrap({authorize_id:'qa',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60}));response.headers={'content-type':'application/json'}; }
      else if(options.url.endsWith('/auth_exchange')) { output=JSON.stringify(wrap({token:'synthetic-full-flow-grant',authorized_url:'https://platform.deepseek.com/dsh/authorized'}));response.headers={'content-type':'application/json'}; }
      else { assert.equal(options.url,'https://api.deepseek.com/anthropic/v1/messages');assert.equal(call.headers['x-dsh-auth-token'],'synthetic-full-flow-grant');output=frames;response.headers={'content-type':'text/event-stream'}; }
      req.emit('response',response);if(!call.aborted){response.emit('data',Buffer.from(output));response.emit('end');}
    });return req;
  }};
  const oldLoad=Module._load;
  Module._load=function(name,parent,isMain){
    if(parent?.filename.endsWith('assistant-service.cjs')) {
      if(name==='./electron-refs.cjs') return {app:{isPackaged:!!packagedAsar,getAppPath:()=>root,getPath:()=>dir,getLocale:()=> 'zh-CN'},net,shell:{openExternal:async url=>{browser=url;}}};
      if(name==='./assistant-credential-vault.cjs') return {createSystemAssistantCredentialVault:()=>({hasCredential:async()=>false,getForMainProcess:async()=>null})};
      if(name==='./assistant-account-vault.cjs') return {createSystemAssistantAccountVault:()=>heldVault};
      if(name==='./assistant-harness-client.cjs') {const real=oldLoad.apply(this,arguments);return {createHarnessClient:options=>{environments.push(options.env);return real.createHarnessClient(options);}};}
    }
    return oldLoad.apply(this,arguments);
  };
  try {
    service=require(path.join(root,'electron/main/assistant-service.cjs')); Module._load=oldLoad;
    assert.equal((await service.status()).configured,false);
    assert.equal((await service.startAccountAuth()).phase,'waiting');
    assert.equal(new URL(browser).origin,'https://platform.deepseek.com');
    const pendingCallback=callback(`${initial.redirect_uri}?state=${initial.state}&code=synthetic-code`);
    await saveEntered.promise;
    let queuedStatusDone=false;
    const queuedStatus=service.status().then(value=>{queuedStatusDone=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(queuedStatusDone,false,'ordinary status is queued behind credential persistence');
    assert.equal(service.accountStatus().phase,'committing','authorization progress is readable while storage is pending');
    releaseSave.resolve();
    assert.equal(await pendingCallback,302);
    await queuedStatus;
    const status=await service.status();assert.equal(status.authMode,'account');assert.equal(status.accountPhase,'complete');
    assert.equal(await service.send('synthetic full flow'), 'FULL_ACCOUNT_FLOW_OK');
    assert.equal(environments.length,1);assert.notEqual(environments[0].DEEPSEEK_API_KEY,'synthetic-full-flow-grant');
    assert.equal(JSON.stringify(environments[0]).includes('synthetic-full-flow-grant'),false);
    await service.clearAccount();assert.equal((await service.status()).configured,false);
    console.log('PASS_ACCOUNT_LOGIN_TO_REAL_HARNESS_WITH_SYNTHETIC_PROVIDER');
  } finally { releaseSave.resolve();Module._load=oldLoad;if(service)await service.shutdown();await fs.rm(dir,{recursive:true,force:true}); }
}
main().catch(error=>{console.error('ACCOUNT_FULL_FLOW_FAILED',error.code||error.message);process.exitCode=1;});
