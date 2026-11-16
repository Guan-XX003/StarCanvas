// Real Electron secure storage and signed Harness, isolated QA Keychain item,
// local synthetic model. Production never accepts the test endpoint override.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {app} = require('electron');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-assistant-service-electron-'));
const serviceName = `org.starcanvas.account-secret.qa.${crypto.randomUUID().toUpperCase()}`;
process.env.WANJUAN_TEST_USER_DATA_PATH = home;
process.env.STARCANVAS_DEV_KEYCHAIN_QA = '1';
process.env.STARCANVAS_KEYCHAIN_QA_SERVICE = serviceName;
app.setPath('userData', home);
app.getAppPath = () => path.resolve(__dirname, '..');
let assistant, server;

async function main() {
  if (process.platform !== 'darwin') throw Error('MACOS_ONLY');
  let calls = 0, delayedResolve;
  const delayedArrived = new Promise(resolve => { delayedResolve = resolve; });
  server = http.createServer((req, res) => {
    calls++;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
    if (body.includes('SYNTHETIC_SLOW_REQUEST')) { delayedResolve(); return; }
    const frames = [
      ['message_start',{type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
      ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'LOCAL_SERVICE_REPLY'}}],
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
  const realCreate = clientModule.createHarnessClient;
  clientModule.createHarnessClient = options => realCreate({...options, env:{...options.env,DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
  // Hold an ordered read-only probe so "cancel before start" genuinely tests a
  // queued turn, not a race with an already warm localhost model response.
  let releaseQueue, probeEntered;
  const queueGate=new Promise(resolve=>{releaseQueue=resolve});
  const entered=new Promise(resolve=>{probeEntered=resolve});
  require('../electron/main/assistant-connection-probe.cjs').createAssistantConnectionProbe=()=>async()=>{probeEntered();return queueGate};
  assistant = require('../electron/main/assistant-service.cjs');
  assert.equal((await assistant.status()).configured, false);
  await assistant.setKey('sk-synthetic-assistant-fixture-only');
  assert.equal((await assistant.status()).configured, true);
  assert.equal(await assistant.send('Hello'), 'LOCAL_SERVICE_REPLY');
  assert.equal(await assistant.send('Again'), 'LOCAL_SERVICE_REPLY');
  assert.equal(await assistant.analyzeConfiguration('Synthetic documentation analysis'), 'LOCAL_SERVICE_REPLY');
  assert.equal(calls, 3);
  const heldProbe=assistant.checkConnection();
  await entered;
  const early = assistant.send('SYNTHETIC_CANCEL_BEFORE_START'); early.catch(() => {});
  await assert.rejects(assistant.send('SYNTHETIC_DUPLICATE'), {code:'ASSISTANT_BUSY'});
  try { await assistant.cancel(); } finally { releaseQueue({ok:true}); }
  await heldProbe;
  await assert.rejects(early, {code:'ASSISTANT_CANCELLED'});
  assert.equal(calls, 3, 'cancelled queued requests are not sent');
  const slow = assistant.send('SYNTHETIC_SLOW_REQUEST'); slow.catch(() => {});
  await delayedArrived;
  await assistant.cancel();
  await assert.rejects(slow, {code:'ASSISTANT_CANCELLED'});
  assert.equal(calls, 4, 'an interrupted request is not retried');
  assert.equal(await assistant.send('Fresh session'), 'LOCAL_SERVICE_REPLY');
  assert.equal(calls, 5);
  await assistant.clearKey();
  assert.equal((await assistant.status()).configured, false);
  console.log('PASS_ASSISTANT_SERVICE_ELECTRON_CHAT_AND_ANALYSIS');
}
app.whenReady().then(main).catch(error => {
  // Locate a failing synthetic assertion without echoing provider text,
  // credentials, native errors, or temporary user-data paths.
  const testLine=String(error?.stack||'').match(/test-assistant-service-electron\.cjs:(\d+):\d+/)?.[1]||'unknown';
  console.error('ASSISTANT_SERVICE_ELECTRON_TEST_FAILED', error.code || 'UNKNOWN', `testLine=${testLine}`);
  process.exitCode = 1;
}).finally(async () => {
  try { if (assistant) await assistant.shutdown(); } catch { process.exitCode = 1; }
  if (server) await new Promise(resolve => server.close(resolve));
  const executable = path.join(__dirname, '..', 'build', 'native-tools', 'macos-account-keychain');
  const cleanup = spawnSync(executable, [], {
    input:JSON.stringify({operation:'qa-delete', value:'', qaService:serviceName}),
    encoding:'utf8', timeout:10000, env:{...process.env,STARCANVAS_KEYCHAIN_QA:'1'},
  });
  try { if (cleanup.status !== 0 || JSON.parse(cleanup.stdout).ok !== true) throw Error(); }
  catch { console.error('SYNTHETIC_KEYCHAIN_CLEANUP_FAILED'); process.exitCode = 1; }
  fs.rmSync(home, {recursive:true, force:true});
  app.exit(process.exitCode || 0);
});
