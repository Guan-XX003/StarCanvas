// Tests only the dormant auth core. All provider and browser operations are
// injected fakes; no real DeepSeek account, credentials or network is used.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {createAssistantAccountPkce} = require('../electron/main/assistant-account-pkce.cjs');
const wrap = biz_data => ({code:0,data:{biz_code:0,biz_data}});
const deferred = () => { let resolve,reject; const promise = new Promise((r,j) => {resolve=r;reject=j;}); return {promise,resolve,reject}; };
function request(url, options = {}) {
  return new Promise((resolve,reject) => {
    const req = http.request(url, options, res => { res.resume(); res.on('end', () => resolve({status:res.statusCode,location:res.headers.location})); });
    req.on('error',reject); req.end();
  });
}
function fixture(overrides = {}) {
  let initial, opened, grant;
  const calls = [];
  const options = {
    post:async (method, body, options) => {
      calls.push(method);
      if (method === 'auth_init') { initial=body; return wrap({authorize_id:'synthetic-attempt',authorize_url:'https://platform.deepseek.com/dsh/authorize?test=1',expires_in:60}); }
      if (method === 'auth_exchange') {
        assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), initial.code_challenge);
        assert.equal(body.redirect_uri, initial.redirect_uri);
        return wrap({token:'synthetic-account-token',authorized_url:'https://platform.deepseek.com/dsh/authorized'});
      }
      return wrap({});
    },
    openExternal:async url => { opened=url; },
    saveGrant:async value => { grant=value; },
    getDeviceId:async () => '0e3469c6-38bc-4b35-a7fa-d436f2c43103',
    ...overrides,
  };
  return {auth:createAssistantAccountPkce(options),calls,get initial(){return initial},get opened(){return opened},get grant(){return grant}};
}
function callback(f, suffix = '') { return `${f.initial.redirect_uri}?state=${encodeURIComponent(f.initial.state)}&code=synthetic-code${suffix}`; }

test('official origin, one-time state, PKCE and injected-store handoff', async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.start({language:'zh-CN'}), {phase:'waiting'});
  assert.match(f.opened, /^https:\/\/platform\.deepseek\.com\/dsh\/authorize\?/);
  assert.equal((await request(`${f.initial.redirect_uri}?state=wrong&code=x`)).status, 400);
  assert.equal((await request(callback(f,'&state=duplicate'))).status, 400);
  assert.equal((await request(callback(f), {headers:{host:'evil.example'}})).status, 400);
  assert.deepEqual(f.calls, ['auth_init']);
  const result = await request(callback(f));
  assert.equal(result.status,302);
  assert.equal(new URL(result.location).origin,'https://platform.deepseek.com');
  assert.equal(new URL(result.location).pathname,'/dsh/authorized');
  assert.deepEqual(f.auth.status(), {phase:'complete'});
  assert.deepEqual(f.grant,{version:1,token:'synthetic-account-token',issuer:'https://platform.deepseek.com'});
  assert.equal(JSON.stringify(f.auth.status()).includes('synthetic-account-token'),false);
});

test('untrusted authorization URL fails before browser opens', async () => {
  for (const url of ['https://evil.example/dsh/authorize','https://platform.deepseek.com.evil.example/dsh/authorize','http://platform.deepseek.com/dsh/authorize','https://user@platform.deepseek.com/dsh/authorize','https://platform.deepseek.com/dsh/authorize#fragment','https://platform.deepseek.com/other']) {
    let opened = false;
    const f = fixture({post:async()=>wrap({authorize_id:'x',authorize_url:url,expires_in:60}),openExternal:async()=>{opened=true}});
    await assert.rejects(f.auth.start(),{code:'ACCOUNT_AUTH_FAILED'});
    assert.equal(opened,false); assert.equal(f.auth.status().phase,'failed');
  }
});

test('untrusted completion redirect is rejected before storage', async () => {
  let initial,saved=0;
  const f=fixture({post:async(method,body)=>{
    if(method==='auth_init'){initial=body;return wrap({authorize_id:'x',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60});}
    return wrap({token:'synthetic-account-token',authorized_url:'https://evil.example/dsh/authorized'});
  },saveGrant:async()=>{saved++}});
  await f.auth.start();
  assert.equal((await request(`${initial.redirect_uri}?state=${initial.state}&code=x`)).status,500);
  assert.equal(saved,0);assert.equal(f.auth.status().phase,'failed');
});

test('only the first valid callback can exchange a code', async () => {
  let initial;const entered=deferred(),finish=deferred();let exchanges=0;
  const f=fixture({post:async(method,body)=>{
    if(method==='auth_init'){initial=body;return wrap({authorize_id:'x',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60});}
    if(method==='auth_exchange'){exchanges++;entered.resolve();return finish.promise;}
    return wrap({});
  }});
  await f.auth.start();
  const url=`${initial.redirect_uri}?state=${initial.state}&code=x`;
  const first=request(url);await entered.promise;
  assert.equal((await request(url)).status,410);
  finish.resolve(wrap({token:'synthetic-token',authorized_url:'https://platform.deepseek.com/dsh/authorized'}));
  assert.equal((await first).status,302);assert.equal(exchanges,1);
});

test('cancel during exchange defeats even a transport that returns late', async () => {
  const arrived=deferred(), reply=deferred(); let saved=0;
  const f = fixture({post:async(method,body) => {
    if (method==='auth_init') { f.initialBody=body; return wrap({authorize_id:'x',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60}); }
    if (method==='auth_exchange') { arrived.resolve(); return reply.promise; }
    return wrap({});
  },saveGrant:async()=>{saved++}});
  // The custom transport records the initialization body separately.
  await f.auth.start();
  const pending=request(`${f.initialBody.redirect_uri}?state=${f.initialBody.state}&code=synthetic-code`);
  await arrived.promise;
  assert.deepEqual(await f.auth.cancel(),{phase:'cancelled'});
  assert.equal((await pending).status,500);
  reply.resolve(wrap({token:'synthetic-account-token',authorized_url:'https://platform.deepseek.com/dsh/authorized'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saved,0); assert.equal(f.auth.status().phase,'cancelled');
});

test('cancel is prompt even if initialization transport ignores abort', async () => {
  const arrived=deferred(), late=deferred();
  const f=fixture({post:async(method)=>{if(method==='auth_init'){arrived.resolve();return late.promise;}return wrap({});}});
  const starting=f.auth.start(); starting.catch(()=>{});
  await arrived.promise;
  assert.deepEqual(await f.auth.cancel(),{phase:'cancelled'});
  await assert.rejects(starting,{code:'ACCOUNT_AUTH_CANCELLED'});
  late.resolve(wrap({authorize_id:'late',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.auth.status().phase,'cancelled'); assert.equal(f.grant,undefined);
});

test('commit cannot be falsely reported cancelled after storage starts', async () => {
  const arrived=deferred(), finish=deferred();
  const f=fixture({saveGrant:async()=>{arrived.resolve(); await finish.promise;}});
  await f.auth.start();
  const pending=request(callback(f));
  await arrived.promise;
  const originalNow=Date.now;
  try { Date.now=()=>originalNow()+120000; assert.equal(f.auth.status().phase,'committing'); }
  finally { Date.now=originalNow; }
  assert.deepEqual(await f.auth.cancel(),{phase:'committing'});
  finish.resolve();
  assert.equal((await pending).status,302);
  assert.equal(f.auth.status().phase,'complete');
});

test('a late browser-open error cannot hide an already committing authorization', async () => {
  const opener=deferred(), saving=deferred(), entered=deferred();
  const f=fixture({openExternal:()=>opener.promise,saveGrant:async()=>{entered.resolve();await saving.promise;}});
  const starting=f.auth.start();
  for(let i=0;i<100 && !f.initial;i++) await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(f.initial);
  const pending=request(callback(f));
  await entered.promise;
  opener.reject(new Error('synthetic browser failure'));
  assert.deepEqual(await starting,{phase:'committing'});
  saving.resolve(); assert.equal((await pending).status,302);
  assert.equal(f.auth.status().phase,'complete');
});

test('expired attempts close the listener without saving', async () => {
  const f=fixture({maxAttemptMs:40});
  await f.auth.start();
  await new Promise(resolve=>setTimeout(resolve,90));
  assert.equal(f.auth.status().phase,'expired');
  assert.equal(f.grant,undefined);
});

test('status detects wall-clock expiration even when the timer has not fired', async () => {
  const f=fixture(), originalNow=Date.now;
  try {
    await f.auth.start();
    Date.now=()=>originalNow()+120000;
    assert.equal(f.auth.status().phase,'expired');
    assert.equal(f.auth.status().phase,'expired');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.calls.filter(method=>method==='auth_cancel').length,1);
    assert.equal(f.grant,undefined);
  } finally { Date.now=originalNow; await f.auth.cancel(); }
});
