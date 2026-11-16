// Real Windows Electron/DPAPI and official standalone Harness; only the model
// endpoint is replaced with localhost. No GUI, real credentials, or paid calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {app} = require('electron');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-assistant-service-win-'));
app.setPath('userData', home);
app.getAppPath = () => path.resolve(__dirname, '..');
let assistant, server;
async function main() {
  if (process.platform !== 'win32') throw Error('WINDOWS_ONLY');
  let requests = 0, readySlow;
  const slowRequest = new Promise(resolve => {readySlow = resolve;});
  server = http.createServer((req, res) => {
    requests++; let body = '';
    req.on('data', chunk => {body += chunk;});
    req.on('end', () => {
      if (body.includes('SYNTHETIC_SLOW_REQUEST')) { readySlow(); return; }
      const frames = [
        ['message_start',{type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
        ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
        ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'WINDOWS_LOCAL_REPLY'}}],
        ['content_block_stop',{type:'content_block_stop',index:0}],
        ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
        ['message_stop',{type:'message_stop'}],
      ];
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      res.end(frames.map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clientModule = require('../electron/main/assistant-harness-client.cjs');
  const create = clientModule.createHarnessClient;
  clientModule.createHarnessClient = options => create({...options,env:{...options.env,DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
  assistant = require('../electron/main/assistant-service.cjs');
  assert.equal((await assistant.status()).installed, true);
  await assistant.setKey('sk-synthetic-windows-fixture-only');
  assert.equal(await assistant.send('Hello'), 'WINDOWS_LOCAL_REPLY');
  assert.equal(await assistant.analyzeConfiguration('Synthetic document'), 'WINDOWS_LOCAL_REPLY');
  const slow = assistant.send('SYNTHETIC_SLOW_REQUEST'); slow.catch(() => {});
  await slowRequest;
  await assistant.cancel();
  await assert.rejects(slow, {code:'ASSISTANT_CANCELLED'});
  assert.equal(requests, 3, 'no retry after cancellation');
  assert.equal(await assistant.send('Fresh session'), 'WINDOWS_LOCAL_REPLY');
  assert.equal(requests, 4);
  await assistant.clearKey();
  assert.equal((await assistant.status()).configured, false);
  console.log('PASS_ASSISTANT_WINDOWS_SERVICE_DPAPI_AND_HARNESS');
}
app.whenReady().then(main).catch(error => {
  console.error('ASSISTANT_WINDOWS_SERVICE_TEST_FAILED', error.code || 'UNKNOWN');
  process.exitCode = 1;
}).finally(async () => {
  try { if (assistant) await assistant.shutdown(); } catch { process.exitCode = 1; }
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(home, {recursive:true,force:true});
  app.exit(process.exitCode || 0);
});
