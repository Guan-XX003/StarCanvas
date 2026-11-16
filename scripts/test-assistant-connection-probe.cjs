const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createAssistantConnectionProbe} = require('../electron/main/assistant-connection-probe.cjs');

function fakeNet({status = 200, body = '{"object":"list","data":[{"id":"deepseek-flash"}]}', redirect = false, hang = false, fail = false} = {}) {
  const observations = {requests:[], aborted:0};
  const net = {request(options) {
    const req = new EventEmitter();
    const call = {options, headers:{}}; observations.requests.push(call);
    req.setHeader = (name, value) => { call.headers[name] = value; };
    req.abort = () => { observations.aborted++; };
    req.end = () => {
      if (hang) return;
      queueMicrotask(() => {
        if (redirect) { req.emit('redirect', 302, 'GET', 'https://evil.example/'); return; }
        if (fail) { req.emit('error', new Error('synthetic-secret-in-error')); return; }
        const res = new EventEmitter(); res.statusCode = status; res.destroy = () => {};
        req.emit('response', res);
        if (status === 200) { res.emit('data', Buffer.from(body)); res.emit('end'); }
      });
    };
    return req;
  }};
  return {net, observations};
}

async function main() {
  const {net, observations} = fakeNet();
  assert.deepEqual(await createAssistantConnectionProbe(net)('synthetic-key'), {modelAvailable:true});
  assert.equal(observations.requests.length, 1);
  assert.deepEqual(observations.requests[0].options, {method:'GET',url:'https://api.deepseek.com/models',redirect:'manual',useSessionCookies:false});
  assert.deepEqual(observations.requests[0].headers, {Authorization:'Bearer synthetic-key',Accept:'application/json','Cache-Control':'no-store'});
  for (const [scenario, code] of [
    [{status:401}, 'ASSISTANT_AUTH_REJECTED'], [{status:403}, 'ASSISTANT_AUTH_REJECTED'],
    [{status:429}, 'ASSISTANT_RATE_LIMITED'], [{status:503}, 'ASSISTANT_SERVICE_UNAVAILABLE'],
    [{body:'not-json'}, 'ASSISTANT_INVALID_RESPONSE'], [{body:'x'.repeat(256 * 1024 + 1)}, 'ASSISTANT_INVALID_RESPONSE'],
    [{redirect:true}, 'ASSISTANT_UNEXPECTED_REDIRECT'], [{fail:true}, 'ASSISTANT_NETWORK_ERROR'],
    [{hang:true}, 'ASSISTANT_NETWORK_TIMEOUT'],
  ]) {
    const fake = fakeNet(scenario);
    await assert.rejects(createAssistantConnectionProbe(fake.net, 20)('synthetic-key'), error => error.code === code && !error.message.includes('synthetic-secret'));
    assert.equal(fake.observations.requests.length, 1, 'no retry or redirected request');
  }
  const absent = fakeNet({body:'{"object":"list","data":[{"id":"other"}]}'});
  assert.deepEqual(await createAssistantConnectionProbe(absent.net)('synthetic-key'), {modelAvailable:false});
  const forbidden = fakeNet();
  await assert.rejects(createAssistantConnectionProbe(forbidden.net)('bad\r\nkey'), {code:'ASSISTANT_INVALID_KEY'});
  assert.equal(forbidden.observations.requests.length, 0);
  console.log('PASS_ASSISTANT_CONNECTION_PROBE');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
