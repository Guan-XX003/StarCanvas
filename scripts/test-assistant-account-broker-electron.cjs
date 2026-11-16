// Exercise Electron's actual network transport against localhost only.
// No real credentials or model calls are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {app, net} = require('electron');
const {createAssistantAccountBroker} = require('../electron/main/assistant-account-broker.cjs');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-broker-electron-'));
app.setPath('userData', home);
let server, broker;
async function main() {
  let calls = 0;
  server = http.createServer((req, res) => {
    calls++;
    assert.equal(req.method, 'POST');
    assert.equal(req.headers['x-dsh-auth-token'], 'synthetic-account-token');
    assert.equal(req.headers.cookie, undefined);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {stream:true,messages:[]});
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      res.end('event: message_start\ndata: {}\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const adapter = {request(options) {
    assert.equal(options.url, 'https://api.deepseek.com/anthropic/v1/messages');
    return net.request({...options, url:`http://127.0.0.1:${server.address().port}/v1/messages`});
  }};
  broker = createAssistantAccountBroker({net:adapter,getGrant:async()=>({version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-token'})});
  const {baseURL, clientKey} = await broker.start();
  const body = JSON.stringify({stream:true,messages:[]});
  const result = await new Promise((resolve, reject) => {
    const req = http.request(`${baseURL}/v1/messages`, {method:'POST',headers:{'x-api-key':clientKey,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(result.status, 200);
  assert.match(result.body, /event: message_start/);
  assert.equal(calls, 1, 'one request reaches the local upstream');
  console.log('PASS_ASSISTANT_ACCOUNT_BROKER_ELECTRON');
}
app.whenReady().then(main).catch(error => { console.error('ACCOUNT_BROKER_ELECTRON_FAILED',error.code || error.message); process.exitCode = 1; }).finally(async () => {
  if (broker) await broker.close();
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  try { fs.rmSync(home,{recursive:true,force:true}); }
  catch (error) {
    // Windows may keep the isolated Chromium profile locked until Electron exits.
    // Tell the test runner the exact disposable directory to remove afterward.
    if (process.platform === 'win32' && ['EPERM','EBUSY','ENOTEMPTY'].includes(error?.code)) console.warn('TEST_TEMP_CLEANUP_DEFERRED',home);
    else { console.error('TEST_TEMP_CLEANUP_FAILED',error?.code || 'unknown'); process.exitCode = 1; }
  }
  app.exit(process.exitCode || 0);
});
