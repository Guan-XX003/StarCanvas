// Real bundled Harness + actual account broker, with injected fake vaults and
// fake official upstream. Never touches a real user credential or the network.
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(__dirname,'..');
// Exercise the signed installed fallback without hiding or moving bundled files.
const fallbackRoot = process.env.STARCANVAS_TEST_HARNESS_FALLBACK === '1' ? fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-fallback-qa-')) : null;
if (fallbackRoot) {
  fs.mkdirSync(path.join(fallbackRoot,'config','harness'),{recursive:true});
  fs.copyFileSync(path.join(root,'config','harness','sdk-restricted.patch.yml'),path.join(fallbackRoot,'config','harness','sdk-restricted.patch.yml'));
}
let manualKey = null, accountExists = true, accountDamaged = false;
const starts = [], calls = [];
const frames = [
  ['message_start',{type:'message_start',message:{id:'mock',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
  ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
  ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SERVICE_ACCOUNT_OK'}}],
  ['content_block_stop',{type:'content_block_stop',index:0}],
  ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
  ['message_stop',{type:'message_stop'}],
].map(([n,d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join('');
const net = {request(options) {
  const request = new EventEmitter(), call = {options,headers:{},body:[],aborted:false}; calls.push(call);
  request.setHeader = (name,value) => { call.headers[name.toLowerCase()] = value; };
  request.write = value => call.body.push(Buffer.from(value));
  request.abort = () => { call.aborted = true; };
  request.end = () => setImmediate(() => {
    if (call.aborted) return;
    const res = new EventEmitter(); res.statusCode=200; res.headers={'content-type':'text/event-stream'};
    res.destroy=()=>{}; res.pause=()=>{}; res.resume=()=>{};
    request.emit('response',res);
    if (!call.aborted) { res.emit('data',Buffer.from(frames)); res.emit('end'); }
  });
  return request;
}};
const oldLoad = Module._load;
Module._load = function(name,parent,isMain) {
  if (parent?.filename.endsWith('assistant-service.cjs')) {
    if (name === './electron-refs.cjs') return {app:{isPackaged:false,getAppPath:() => fallbackRoot || root},net};
    if (name === './assistant-credential-vault.cjs') return {createSystemAssistantCredentialVault:() => ({hasCredential:async()=>!!manualKey,getForMainProcess:async()=>manualKey,set:async v=>{manualKey=v;},clear:async()=>{manualKey=null;}})};
    if (name === './assistant-account-vault.cjs') return {createSystemAssistantAccountVault:() => ({hasRecord:async()=>{if(accountDamaged)throw Error('synthetic damaged record');return accountExists;},getForMainProcess:async()=>({version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-grant'})})};
    if (name === './assistant-harness-client.cjs') {
      const real = oldLoad.apply(this,arguments);
      return {createHarnessClient:options => { starts.push(options.env); return real.createHarnessClient(options); }};
    }
  }
  return oldLoad.apply(this,arguments);
};
const service = require('../electron/main/assistant-service.cjs');
Module._load = oldLoad;
(async () => {
  try {
    assert.equal((await service.status()).authMode,'account');
    assert.equal(await service.send('SYNTHETIC_CHAT'), 'SERVICE_ACCOUNT_OK');
    assert.match(starts[0].DSH_SYSTEM_PROMPT,/explicitly asks to make the theme darker or lighter/);
    assert.match(starts[0].DSH_SYSTEM_PROMPT,/clearly requiring confirmation/);
    assert.equal(await service.analyzeConfiguration('SYNTHETIC_DOC'), 'SERVICE_ACCOUNT_OK');
    assert.equal(calls.length,2);
    for (const [index,call] of calls.entries()) {
      assert.equal(call.options.url,'https://api.deepseek.com/anthropic/v1/messages');
      assert.equal(call.headers['x-dsh-auth-token'],'synthetic-account-grant');
      assert.equal(call.headers['x-api-key'],undefined);
      assert.match(starts[index].DEEPSEEK_BASE_URL,/^http:\/\/127\.0\.0\.1:\d+$/);
      assert.match(starts[index].DEEPSEEK_API_KEY,/^sk-local-/);
      assert.notEqual(starts[index].DEEPSEEK_API_KEY,'synthetic-account-grant');
    }
    assert.notEqual(starts[0].DEEPSEEK_API_KEY,starts[1].DEEPSEEK_API_KEY,'analysis gets a separate temporary credential');
    await service.setKey('sk-synthetic-existing-manual');
    assert.equal((await service.status()).authMode,'key');
    assert.equal(accountExists,true,'manual configuration does not erase account grant');
    accountDamaged=true;
    assert.equal((await service.status()).hasAccount,null,'a damaged account record cannot disable the existing API Key');
    accountDamaged=false;
    await service.clearKey();
    assert.equal((await service.status()).authMode,'account');
    accountExists=false;
    assert.equal((await service.status()).configured,false);
    await assert.rejects(service.send('no credential'),{code:'ASSISTANT_KEY_REQUIRED'});
    console.log('PASS_REAL_HARNESS_ACCOUNT_SERVICE_SYNTHETIC_UPSTREAM');
  } finally { await service.shutdown(); if (fallbackRoot) fs.rmSync(fallbackRoot,{recursive:true,force:true}); }
})().catch(error => { console.error('ACCOUNT_SERVICE_TEST_FAILED',error.code || error.message); process.exitCode=1; });
