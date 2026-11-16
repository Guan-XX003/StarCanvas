const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAssistantAccountBroker} = require('../electron/main/assistant-account-broker.cjs');
const {createHarnessClient} = require('../electron/main/assistant-harness-client.cjs');

const events = [
  ['message_start',{type:'message_start',message:{id:'mock',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
  ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
  ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'ACCOUNT_BRIDGE_OK'}}],
  ['content_block_stop',{type:'content_block_stop',index:0}],
  ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
  ['message_stop',{type:'message_stop'}],
].map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
function fakeNet() {
  const calls = [];
  let status = 200, hang = false;
  return {calls, setStatus(value) { status = value; }, setHang(value) { hang = value; }, request(options) {
    const request = new EventEmitter();
    const call = {options, headers:{}, chunks:[], aborted:false}; calls.push(call);
    request.setHeader = (name,value) => { call.headers[name.toLowerCase()] = value; };
    request.write = data => call.chunks.push(Buffer.from(data));
    request.abort = () => { call.aborted = true; };
    request.end = () => setImmediate(() => {
      if (call.aborted || hang) return;
      const response = new EventEmitter(); response.statusCode = status;
      response.headers = {'content-type':status === 200 ? 'text/event-stream' : 'application/json'};
      response.destroy = () => {}; response.pause = () => {}; response.resume = () => {};
      request.emit('response',response);
      if (!call.aborted) { response.emit('data',Buffer.from(events)); response.emit('end'); }
    });
    return request;
  }};
}
function request(base, key, {url='/v1/messages', headers={}, body=JSON.stringify({model:'deepseek-flash',stream:true,messages:[]}), method='POST'} = {}) {
  return new Promise((resolve,reject) => {
    const u = new URL(base + url);
    const r = http.request(u,{method,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'x-api-key':key,...headers}}, res => {
      const chunks=[]; res.on('data',x => chunks.push(x)); res.on('end',() => resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()})); res.on('error',reject);
    });
    r.on('error',reject); r.end(body);
  });
}
async function main() {
  const racingBroker = createAssistantAccountBroker({net:fakeNet(),getGrant:async () => null});
  const racingStart = racingBroker.start();
  const racingClose = racingBroker.close();
  await assert.rejects(racingStart,{code:'ACCOUNT_BROKER_STATE'});
  await Promise.all([racingClose,racingBroker.close()]);
  const net = fakeNet(); let grantReads = 0, validGrant = true;const previews=[];
  const broker = createAssistantAccountBroker({net,timeoutMs:1000,onText:text=>previews.push(text),getGrant:async () => { grantReads++; return validGrant ? {version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-token'} : null; }});
  const {baseURL,clientKey} = await broker.start();
  try {
    assert.equal((await request(baseURL,'wrong')).status,403);
    assert.equal((await request(baseURL,clientKey,{url:'/v1/messages?redirect=x'})).status,403);
    assert.equal((await request(baseURL,clientKey,{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await request(baseURL,clientKey,{headers:{Authorization:'Bearer fake'}})).status,403);
    assert.equal((await request(baseURL,clientKey,{method:'GET'})).status,403);
    assert.equal((await request(baseURL,clientKey,{body:'{}'})).status,400);
    assert.equal((await request(baseURL,clientKey,{body:'x'.repeat(2 * 1024 * 1024 + 1)})).status,413);
    assert.equal(net.calls.length,0); assert.equal(grantReads,0);
    const good = await request(baseURL,clientKey);
    assert.equal(good.status,200); assert.match(good.body,/ACCOUNT_BRIDGE_OK/);
    assert.equal(previews.at(-1),'ACCOUNT_BRIDGE_OK','account-grant mode uses the same text-only preview tap');
    assert.deepEqual(net.calls[0].options,{method:'POST',url:'https://api.deepseek.com/anthropic/v1/messages',redirect:'manual',useSessionCookies:false});
    assert.equal(net.calls[0].headers['x-dsh-auth-token'],'synthetic-account-token');
    assert.equal(net.calls[0].headers['x-api-key'],undefined);
    assert.equal(JSON.stringify(net.calls[0]).includes(clientKey),false);
    net.setStatus(401); const rejected = await request(baseURL,clientKey); assert.equal(rejected.status,401); assert.doesNotMatch(rejected.body,/synthetic-account-token/);
    net.setStatus(302); assert.equal((await request(baseURL,clientKey)).status,502);
    net.setStatus(200); validGrant = false; assert.equal((await request(baseURL,clientKey)).status,401); validGrant = true;
    net.setHang(true); assert.equal((await request(baseURL,clientKey)).status,504); assert.equal(net.calls.at(-1).aborted,true); net.setHang(false);
    let releaseGrant, notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const slowNet = fakeNet();
    const slowBroker = createAssistantAccountBroker({net:slowNet,getGrant:() => { notifyStarted(); return new Promise(resolve => { releaseGrant = resolve; }); }});
    const slow = await slowBroker.start();
    const pending = request(slow.baseURL,slow.clientKey);
    await started;
    assert.equal((await request(slow.baseURL,slow.clientKey)).status,429);
    await slowBroker.close();
    assert.equal((await pending).status,503);
    releaseGrant({version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-token'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(slowNet.calls.length,0,'closing prevents a delayed grant from reaching the network');
    if (process.env.STARCANVAS_TEST_DSH_BIN) {
      const home = await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-account-bridge-'));
      let client;
      try {
        const root = process.env.SystemRoot || process.env.SYSTEMROOT;
        const env = process.platform === 'win32' ? {SystemRoot:root,PATH:path.win32.join(root,'System32'),HOME:home,USERPROFILE:home,TEMP:home,TMP:home} : {PATH:'/usr/bin:/bin',HOME:home};
        client = createHarnessClient({launcher:process.env.STARCANVAS_TEST_DSH_BIN,patch:path.resolve(__dirname,'../config/harness/sdk-restricted.patch.yml'),home,env:{...env,DSH_HOME:home,DEEPSEEK_API_KEY:clientKey,DEEPSEEK_BASE_URL:baseURL}});
        assert.equal(await client.sendMessage('Synthetic account bridge'), 'ACCOUNT_BRIDGE_OK');
        const payload = JSON.parse(Buffer.concat(net.calls.at(-1).chunks));
        assert.equal(payload.stream,true);
        assert.equal(payload.model,'deepseek-flash');
        assert.ok(!payload.tools || payload.tools.length === 0);
      } finally { if (client) await client.close(); await fs.rm(home,{recursive:true,force:true}); }
    }
    console.log('PASS_ACCOUNT_BROKER_LOCAL' + (process.env.STARCANVAS_TEST_DSH_BIN ? '_WITH_REAL_HARNESS' : ''));
  } finally { await broker.close(); }
}
main().catch(e => { console.error('ACCOUNT_BROKER_TEST_FAILED',e.code || e.message); process.exitCode = 1; });
