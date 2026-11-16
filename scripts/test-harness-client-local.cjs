// Actual official local Harness, synthetic key and localhost-only model.
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHarnessClient} = require('../electron/main/assistant-harness-client.cjs');

async function main() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-harness-client-'));
  // Override is test-only; production selects from verified, fixed locations.
  const launcher = process.env.STARCANVAS_TEST_DSH_BIN || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
  const patch = path.resolve(__dirname, '../config/harness/sdk-restricted.patch.yml');
  let requests = 0, client, failureStatus = 0, injectTool = null;
  const bodies = [], requestMetadata = [];
  const server = http.createServer((req, res) => {
    requests++;
    requestMetadata.push({method:req.method,path:req.url,headerNames:Object.keys(req.headers),syntheticKeyHeaders:Object.entries(req.headers).filter(([,v]) => typeof v === 'string' && v.includes('sk-synthetic-probe-key')).map(([k]) => k)});
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { bodies.push(body); });
    if (failureStatus) {
      res.writeHead(failureStatus, {'Content-Type':'application/json'});
      res.end(JSON.stringify({type:'error',error:{type:'synthetic',message:'synthetic-secret-in-provider-error'}}));
      return;
    }
    const shouldInject = injectTool;
    injectTool = null;
    const marker = path.join(home, 'SYNTHETIC_TOOL_MUST_NOT_RUN');
    const command = process.platform === 'win32' ? `New-Item -ItemType File -Path '${marker}'` : `touch '${marker}'`;
    const frames = shouldInject ? [
      ['message_start', {type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start', {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'synthetic-tool',name:shouldInject.name,input:{}}}],
      ['content_block_delta', {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(shouldInject.input || {command})}}],
      ['content_block_stop', {type:'content_block_stop',index:0}],
      ['message_delta', {type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:3}}],
      ['message_stop', {type:'message_stop'}],
    ] : [
      ['message_start', {type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start', {type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
      ['content_block_delta', {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'LOCAL_MOCK_RESPONSE'}}],
      ['content_block_stop', {type:'content_block_stop',index:0}],
      ['message_delta', {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
      ['message_stop', {type:'message_stop'}],
    ];
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    res.end(frames.map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    const env = process.platform === 'win32'
      ? {SystemRoot:systemRoot, PATH:path.win32.join(systemRoot, 'System32'), HOME:home, USERPROFILE:home, TEMP:home, TMP:home, TMPDIR:home}
      : {PATH:'/usr/bin:/bin', HOME:home, USERPROFILE:home, TEMP:home, TMP:home, TMPDIR:home};
    client = createHarnessClient({launcher, patch, home, env:{...env, DSH_HOME:home, DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
    assert.equal(await client.sendMessage('Hello'), 'LOCAL_MOCK_RESPONSE');
    assert.equal(await client.sendMessage('Again'), 'LOCAL_MOCK_RESPONSE');
    assert.equal(await client.sendMessage('DOC_ANALYSIS_ONLY', {independent:true}), 'LOCAL_MOCK_RESPONSE');
    assert.equal(await client.sendMessage('After analysis'), 'LOCAL_MOCK_RESPONSE');
    assert.equal(requests, 4);
    assert.equal(requestMetadata[0].method, 'POST');
    assert.equal(requestMetadata[0].path, '/v1/messages');
    assert.deepEqual(requestMetadata[0].syntheticKeyHeaders, ['x-api-key']);
    for (const body of bodies) {
      const offeredTools = JSON.parse(body).tools;
      assert.ok(offeredTools === undefined || (Array.isArray(offeredTools) && offeredTools.length === 0), 'restricted assistant must not advertise local tools to the model');
    }
    for (const body of bodies) assert.equal(JSON.parse(body).model, 'deepseek-flash', 'official model alias reaches the model endpoint');
    assert.ok(bodies[1].includes('Hello'), 'normal chat keeps its prior turn');
    assert.ok(bodies[2].includes('DOC_ANALYSIS_ONLY'));
    assert.equal(bodies[2].includes('Hello'), false, 'documentation analysis uses a separate session');
    assert.ok(bodies[3].includes('Hello'), 'chat history survives an independent documentation analysis');
    assert.equal(bodies[3].includes('DOC_ANALYSIS_ONLY'), false, 'documentation analysis never enters later chat context');
    await assert.rejects(client.sendMessage(''), {code:'ASSISTANT_INVALID_MESSAGE'});
    await client.close(); client = null;
    client = createHarnessClient({launcher, patch, home, turnTimeoutMs:10000, env:{...env, DSH_HOME:home, DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
    assert.equal(await client.sendMessage('Fresh session'), 'LOCAL_MOCK_RESPONSE');
    assert.equal(requests, 5);
    assert.equal(bodies[4].includes('Hello'), false, 'a fresh runtime does not reuse the old chat');
    assert.equal(bodies[4].includes('DOC_ANALYSIS_ONLY'), false, 'a fresh runtime does not reuse documentation analysis');
    injectTool = {name:process.platform === 'win32' ? 'pwsh' : 'bash'};
    await client.sendMessage('Synthetic unregistered tool test').catch(() => {});
    assert.equal(await fs.stat(path.join(home, 'SYNTHETIC_TOOL_MUST_NOT_RUN')).then(() => true, () => false), false, 'unregistered model tool call cannot execute a command');
    await client.close(); client = null;
    assert.equal(await fs.stat(path.join(home, 'SYNTHETIC_TOOL_MUST_NOT_RUN')).then(() => true, () => false), false, 'no delayed command executed during shutdown');
    const privateFile=path.join(home,'synthetic-private-file.txt'), createdFile=path.join(home,'synthetic-forbidden-write.txt');
    await fs.writeFile(privateFile,'SYNTHETIC_PRIVATE_FILE_CONTENT',{mode:0o600});
    for (const [name,input] of [['read_file',{path:privateFile}],['write_file',{path:createdFile,content:'SYNTHETIC_FORBIDDEN_WRITE'}]]) {
      client = createHarnessClient({launcher, patch, home, turnTimeoutMs:10000, env:{...env, DSH_HOME:home, DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
      injectTool={name,input};
      await client.sendMessage('Synthetic unregistered file tool test').catch(() => {});
      await client.close(); client=null;
      assert.equal(await fs.stat(createdFile).then(()=>true,()=>false),false,'unregistered model tool call cannot write a file');
      assert.equal(bodies.some(body=>body.includes('SYNTHETIC_PRIVATE_FILE_CONTENT')),false,'synthetic file contents cannot leak to the model');
    }
    for (const [status, code] of [[401,'ASSISTANT_PROVIDER_AUTH'],[402,'ASSISTANT_PROVIDER_QUOTA'],[429,'ASSISTANT_PROVIDER_RATE_LIMIT'],[500,'ASSISTANT_PROVIDER_SERVER']]) {
      failureStatus = status;
      const before = requests;
      client = createHarnessClient({launcher, patch, home, env:{...env, DSH_HOME:home, DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
      await assert.rejects(client.sendMessage('Synthetic failure'), error => error.code === code && error.message === code);
      assert.equal(requests - before, 1, `no implicit retry on ${status}`);
      await client.close(); client = null;
    }
    failureStatus = 0;
    client = createHarnessClient({launcher, patch, home, env:{...env, DSH_HOME:home, DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
    const privateMarker='SYNTHETIC_PRIVATE_CONVERSATION_82D4F';
    assert.equal(await client.sendMessage(privateMarker),'LOCAL_MOCK_RESPONSE');
    assert.equal(await client.sendMessage('Synthetic follow-up'),'LOCAL_MOCK_RESPONSE');
    assert.ok(bodies.at(-1).includes(privateMarker),'multi-turn history remains in memory');
    // The former JSONL writer flushed asynchronously; inspect only this test's
    // freshly created private home after allowing its flush interval to pass.
    await new Promise(resolve=>setTimeout(resolve,1600));
    async function containsSyntheticSecret(dir) {
      for (const item of await fs.readdir(dir,{withFileTypes:true})) {
        const filename=path.join(dir,item.name);
        if (item.isDirectory()) { if (await containsSyntheticSecret(filename)) return true; }
        else if (item.isFile()) {
          const size=(await fs.stat(filename)).size;
          assert.ok(size <= 4_000_000,'unexpectedly large test-home file');
          const content=await fs.readFile(filename,'utf8');
          if (content.includes(privateMarker) || content.includes('sk-synthetic-probe-key')) return true;
        }
      }
      return false;
    }
    assert.equal(await containsSyntheticSecret(home),false,'private conversation and key must not be written under the temporary home');
    await client.close(); client=null;
    assert.equal(await containsSyntheticSecret(home),false,'shutdown must not flush private conversation or key to disk');
    console.log('PASS_REAL_HARNESS_CHAT_AND_INDEPENDENT_ANALYSIS');
  } finally {
    if (client) await client.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(home, {recursive:true,force:true});
  }
}
main().catch(error => { console.error('HARNESS_CLIENT_LOCAL_TEST_FAILED', error.code || error.message); process.exitCode = 1; });
