// Actual main-process service and bundled official Harness with a localhost-only
// fake provider and fake vault; no system keychain or paid API is accessed.
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText, filename);
const {buildAssistantFailureSummary} = require('../src/renderer/lib/assistant-onboarding.ts');
// When explicitly supplied under Electron's Node mode, load the actual
// packaged ASAR and resources instead of the development tree.
const packagedAsar = process.env.STARCANVAS_TEST_PACKAGED_ASAR;
const root = packagedAsar ? path.resolve(packagedAsar) : path.resolve(__dirname, '..');
let endpoint;
const runtimeHomes = [];
const clientHomes = new WeakMap();
let scanError = null, closedHomesChecked = 0;
const privateNeedles = ['synthetic-key','CHAT_ORIGINAL','CHAT_AFTER_SUCCESS','CHAT_AFTER_FAILURE','DOC_SUCCESS_ONLY','DOC_FAILURE_ONLY','Task type: video','MOCK_REPLY','PRIVATE_TASK_PROMPT','PRIVATE_TASK_KEY','PRIVATE_RAW_ERROR','PRIVATE_CONTEXT_PROMPT','PRIVATE_CONTEXT_MEDIA'];
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (parent?.filename.endsWith('assistant-service.cjs')) {
    if (name === './electron-refs.cjs') return {app:{isPackaged:!!packagedAsar,getAppPath:() => root},net:require('./assistant-test-net.cjs')(()=>endpoint)};
    if (name === './assistant-credential-vault.cjs') return {createSystemAssistantCredentialVault:() => ({getForMainProcess:async() => 'synthetic-key'})};
    if (name === './assistant-harness-client.cjs') {
      const real = originalLoad.apply(this, arguments);
      return {createHarnessClient:options => {
        runtimeHomes.push(options.home);
        const client = real.createHarnessClient(options);
        clientHomes.set(client, options.home);
        return client;
      }};
    }
    if (name === './assistant-runtime-close.cjs') {
      const real = originalLoad.apply(this, arguments);
      return {closeAssistantResources:async (...args) => {
        await real.closeAssistantResources(...args);
        const home = clientHomes.get(args[0]?.client);
        if (home && fs.existsSync(home)) {
          try { assertNoPrivateRuntimeFiles(home, privateNeedles); closedHomesChecked++; }
          catch { scanError = 'SYNTHETIC_PRIVATE_RUNTIME_FILE'; }
        }
      }};
    }
  }
  return originalLoad.apply(this, arguments);
};
const assistant = require(path.join(root, 'electron/main/assistant-service.cjs'));
Module._load = originalLoad;
const bodies = [];
// Inspect only the isolated homes handed to this test's child processes. This
// verifies persisted bytes, not just the effective configuration declaration.
function assertNoPrivateRuntimeFiles(directory, needles) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, {withFileTypes:true})) {
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw Error('UNEXPECTED_RUNTIME_SYMLINK');
      if (entry.isDirectory()) { pending.push(item); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(item);
      if (stat.size > 16 * 1024 * 1024) throw Error('UNEXPECTED_RUNTIME_FILE_SIZE');
      const contents = fs.readFileSync(item);
      for (const value of needles) assert.equal(contents.includes(Buffer.from(value)), false, 'synthetic private material persisted in the isolated runtime home');
    }
  }
}
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    bodies.push(body);
    if (body.includes('DOC_FAILURE_ONLY')) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({type:'error',error:{type:'synthetic',message:'synthetic error'}}));
      return;
    }
    const events = [
      ['message_start',{type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
      ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'MOCK_REPLY'}}],
      ['content_block_stop',{type:'content_block_stop',index:0}],
      ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
      ['message_stop',{type:'message_stop'}],
    ];
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end(events.map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const input of ['synthetic sk-abcdefghijklmnop', 's\u200bk-abcdefghijklmnop', 'https://example.test/%253Ftoken%253Dsyntheticvalue', 'https://example.test/%253Fkey%253Dshort', '我的密码：123456', '{"Authorization":"Basic eA=="}', 'https://synthetic:short@example.test/path'])
      await assert.rejects(assistant.send(input), error => error.code === 'ASSISTANT_SENSITIVE_INPUT' && error.message === 'ASSISTANT_SENSITIVE_INPUT');
    for (const input of ['sk-abcdefghijklmnop','AIza'+'a'.repeat(20),'https://example.test/?token=short'])
      await assert.rejects(assistant.analyzeConfiguration(input), error => error.code === 'ASSISTANT_SENSITIVE_INPUT');
    assert.equal(bodies.length, 0, 'the main-process guard rejects before any provider request');
    assert.equal(await assistant.send('CHAT_ORIGINAL', {view:'settings',settingsTab:'api',projectName:'PRIVATE_PROJECT',apiKey:'PRIVATE_KEY'}), 'MOCK_REPLY');
    assert.equal(await assistant.analyzeConfiguration('DOC_SUCCESS_ONLY'), 'MOCK_REPLY');
    assert.equal(await assistant.send('CHAT_AFTER_SUCCESS'), 'MOCK_REPLY');
    await assert.rejects(assistant.analyzeConfiguration('DOC_FAILURE_ONLY'), {code:'ASSISTANT_PROVIDER_SERVER'});
    assert.equal(await assistant.send('CHAT_AFTER_FAILURE', {view:'canvas',settingsTab:'api'}), 'MOCK_REPLY');
    const summary = buildAssistantFailureSummary([{id:'PRIVATE_TASK_ID',type:'video',status:'failed',createdAt:1,prompt:'PRIVATE_TASK_PROMPT',apiKey:'PRIVATE_TASK_KEY',resultUrl:'https://private.invalid/PRIVATE_MEDIA',errorMsg:'HTTP 429 rate limit PRIVATE_RAW_ERROR'}], 'en-US');
    assert.match(summary,/Task type: video/);assert.match(summary,/HTTP status: 429/);assert.match(summary,/Possible error category: rate_limit/);
    assert.equal(await assistant.send(summary, {view:'canvas',taskPrompt:'PRIVATE_CONTEXT_PROMPT',mediaUrl:'https://private.invalid/PRIVATE_CONTEXT_MEDIA'}), 'MOCK_REPLY');
    assert.ok(runtimeHomes.length > 0);
    for (const home of runtimeHomes) {
      // Independent analysis homes are securely discarded immediately after
      // use; if already removed, there is no remaining on-disk content to scan.
      if (!fs.existsSync(home)) continue;
      assertNoPrivateRuntimeFiles(home, privateNeedles);
    }
    assert.ok(closedHomesChecked >= 2, 'successful and failed analysis homes are scanned after process exit and before removal');
    assert.equal(scanError,null,'analysis runtime must not persist synthetic private material');
    assert.equal(bodies.length, 6, 'no implicit retries or extra calls');
    assert.ok(bodies[0].includes('settings / API configuration'), 'the current page reaches the model');
    assert.equal(bodies[0].includes('PRIVATE_PROJECT'), false, 'project metadata is not sent');
    assert.equal(bodies[0].includes('PRIVATE_KEY'), false, 'arbitrary context cannot carry keys');
    assert.ok(bodies[4].includes('UI location: canvas'), 'later requests use their current page');
    for (const index of [2, 4]) {
      assert.ok(bodies[index].includes('CHAT_ORIGINAL'), 'chat remains continuous');
      assert.equal(bodies[index].includes('DOC_SUCCESS_ONLY'), false, 'successful analysis never leaks into chat');
      assert.equal(bodies[index].includes('DOC_FAILURE_ONLY'), false, 'failed analysis never leaks into chat');
    }
    for (const index of [1, 3]) assert.equal(bodies[index].includes('CHAT_ORIGINAL'), false, 'analysis never sees prior chat');
    for (const secret of ['PRIVATE_TASK_ID','PRIVATE_TASK_PROMPT','PRIVATE_TASK_KEY','PRIVATE_MEDIA','PRIVATE_RAW_ERROR','PRIVATE_CONTEXT_PROMPT','PRIVATE_CONTEXT_MEDIA']) assert.equal(bodies[5].includes(secret),false,`diagnostic model request excludes ${secret}`);
    assert.ok(bodies[5].includes('rate_limit') && bodies[5].includes('429'), 'only the deliberately reduced diagnostic fields are sent');
    console.log('PASS_REAL_HARNESS_SERVICE_ANALYSIS_ISOLATION');
  } finally {
    await assistant.shutdown();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error('ASSISTANT_ANALYSIS_ISOLATION_FAILED', error.code || error.message); process.exitCode = 1; });
