// Isolated Electron network transport against localhost only; synthetic key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {app, net} = require('electron');
const {createAssistantConnectionProbe} = require('../electron/main/assistant-connection-probe.cjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-probe-electron-'));
app.setPath('userData', home);
let server;
async function main() {
  let mode = 'success', trapCalls = 0, calls = 0;
  server = http.createServer((req, res) => {
    if (req.url === '/trap') { trapCalls++; res.end('unexpected'); return; }
    calls++;
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer synthetic-probe-only');
    assert.equal(req.headers.cookie, undefined);
    if (mode === 'redirect') { res.writeHead(302, {location:'/trap'}); res.end(); return; }
    if (mode === 'unauthorized') { res.writeHead(401); res.end(); return; }
    if (mode === 'hang') return;
    res.writeHead(200, {'content-type':'application/json'});
    res.end(JSON.stringify({object:'list', data:[{id:'deepseek-flash'}]}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const adapter = {request(options) {
    assert.equal(options.url, 'https://api.deepseek.com/models');
    return net.request({...options, url:`http://127.0.0.1:${server.address().port}/models`});
  }};
  const probe = createAssistantConnectionProbe(adapter, 1500);
  assert.deepEqual(await probe('synthetic-probe-only'), {modelAvailable:true});
  mode = 'redirect';
  await assert.rejects(probe('synthetic-probe-only'), {code:'ASSISTANT_UNEXPECTED_REDIRECT'});
  assert.equal(trapCalls, 0, 'the credential is never sent to a redirect target');
  mode = 'unauthorized';
  await assert.rejects(probe('synthetic-probe-only'), {code:'ASSISTANT_AUTH_REJECTED'});
  mode = 'hang';
  await assert.rejects(createAssistantConnectionProbe(adapter, 50)('synthetic-probe-only'), {code:'ASSISTANT_NETWORK_TIMEOUT'});
  assert.equal(calls, 4, 'each check sends exactly one request');
  console.log('PASS_ASSISTANT_CONNECTION_PROBE_ELECTRON');
}
app.whenReady().then(main).catch(error => {console.error('CONNECTION_PROBE_ELECTRON_FAILED', error.code || error.message); process.exitCode = 1;}).finally(async () => {
  if (server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(home, {recursive:true,force:true});
  app.exit(process.exitCode || 0);
});
