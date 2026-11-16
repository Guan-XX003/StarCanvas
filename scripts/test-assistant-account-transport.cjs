const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createAssistantAccountPost} = require('../electron/main/assistant-account-transport.cjs');
const config={version:'1.4.8',language:'zh-CN',platformName:'darwin',timezoneOffsetSeconds:28800,timeoutMs:50};
const body={code_challenge:'synthetic-challenge',code_challenge_method:'S256',state:'synthetic-state',redirect_uri:'http://127.0.0.1:12345/oauth/callback',locale:'zh_CN',login_source:'desktop'};
function fakeNet(mode) {
  const captures=[];
  return {captures,request:options => {
    const req=new EventEmitter(); req.headers={}; req.payload=''; req.aborted=false;
    captures.push({options,req});
    req.setHeader=(k,v)=>{req.headers[k.toLowerCase()]=v};
    req.write=chunk=>{req.payload+=chunk};
    req.abort=()=>{req.aborted=true};
    req.end=()=>setImmediate(()=>{
      if (mode==='hang' || req.aborted) return;
      if (mode==='redirect') {req.emit('redirect');return;}
      if (mode==='network') {req.emit('error',new Error('synthetic secret must not escape'));return;}
      const response=new EventEmitter();response.statusCode=mode==='http'?403:200;response.destroy=()=>{};
      req.emit('response',response);
      if (mode==='http') return;
      response.emit('data',Buffer.from(mode==='oversize'?'x'.repeat(65537):mode==='bad-json'?'{invalid':JSON.stringify({code:0,data:{biz_code:0,biz_data:{ok:true}}})));
      response.emit('end');
    });
    return req;
  }};
}
async function main() {
  const good=fakeNet('ok'), post=createAssistantAccountPost(good,config);
  assert.deepEqual(await post('auth_init',body),{code:0,data:{biz_code:0,biz_data:{ok:true}}});
  assert.equal(good.captures.length,1);
  assert.deepEqual(good.captures[0].options,{method:'POST',url:'https://platform.deepseek.com/auth-api/v0/dsh/auth_init',redirect:'manual',useSessionCookies:false});
  assert.equal(good.captures[0].req.headers['x-client-platform'],'desktop-mac');
  assert.equal(good.captures[0].req.headers['x-client-locale'],'zh_CN');
  assert.equal(good.captures[0].req.headers['x-client-timezone-offset'],'28800');
  assert.equal(good.captures[0].req.headers.authorization,undefined);
  assert.deepEqual(JSON.parse(good.captures[0].req.payload),body);
  for (const [mode,code] of [['redirect','ACCOUNT_TRANSPORT_REDIRECT'],['network','ACCOUNT_TRANSPORT_NETWORK'],['http','ACCOUNT_TRANSPORT_HTTP'],['oversize','ACCOUNT_TRANSPORT_RESPONSE'],['bad-json','ACCOUNT_TRANSPORT_RESPONSE'],['hang','ACCOUNT_TRANSPORT_TIMEOUT']]) {
    const net=fakeNet(mode), send=createAssistantAccountPost(net,config);
    await assert.rejects(send('auth_init',body),error=>error.code===code && !error.message.includes('secret'));
    assert.equal(net.captures.length,1,'no follow or automatic retry');
    if (['redirect','http','oversize','bad-json','hang'].includes(mode)) assert.equal(net.captures[0].req.aborted,true);
  }
  const cancelled=fakeNet('hang'), cancelPost=createAssistantAccountPost(cancelled,config), controller=new AbortController();
  const inFlight=cancelPost('auth_init',body,{signal:controller.signal}); controller.abort();
  await assert.rejects(inFlight,{code:'ACCOUNT_TRANSPORT_CANCELLED'});
  assert.equal(cancelled.captures[0].req.aborted,true);
  const before=fakeNet('ok'), beforePost=createAssistantAccountPost(before,config);
  await assert.rejects(beforePost('auth_init',body,{signal:controller.signal}),{code:'ACCOUNT_TRANSPORT_CANCELLED'});
  await assert.rejects(beforePost('https://evil.example/',body),{code:'ACCOUNT_TRANSPORT_INVALID_REQUEST'});
  await assert.rejects(beforePost('auth_init',{...body,extra:'secret'}),{code:'ACCOUNT_TRANSPORT_INVALID_REQUEST'});
  assert.equal(before.captures.length,0);
  assert.throws(()=>createAssistantAccountPost(before,{...config,version:'bad\nversion'}),{code:'ACCOUNT_TRANSPORT_CONFIG'});
  console.log('PASS_ASSISTANT_ACCOUNT_FIXED_ORIGIN_TRANSPORT');
}
main().catch(error=>{console.error('ASSISTANT_ACCOUNT_TRANSPORT_TEST_FAILED',error.code || error.message);process.exitCode=1});
