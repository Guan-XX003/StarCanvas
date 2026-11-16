// Local integration probe: synthetic key, mock model server and isolated home.
// Does not read a real Harness home, launch an account, or call a paid API.
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-dsh-probe-'));
  const launcher = process.env.STARCANVAS_TEST_DSH_BIN || '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
  const failureStatus = Number(process.env.STARCANVAS_PROBE_FAILURE_STATUS || 0);
  const patch = path.resolve(__dirname, '../config/harness/sdk-restricted.patch.yml');
  let requests = 0, child;
  const server = http.createServer((req, res) => {
    requests++;
    req.resume();
    if (req.method === 'GET') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"data":[]}'); return; }
    if (failureStatus) {
      res.writeHead(failureStatus, {'Content-Type':'application/json'});
      res.end(JSON.stringify({type:'error',error:{type:'synthetic_error',message:'synthetic diagnostic'}}));
      return;
    }
    const frames = [
      ['message_start', {type:'message_start',message:{id:'msg_test',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start', {type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
      ['content_block_delta', {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'LOCAL_MOCK_RESPONSE'}}],
      ['content_block_stop', {type:'content_block_stop',index:0}],
      ['message_delta', {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
      ['message_stop', {type:'message_stop'}],
    ];
    res.writeHead(200, {'Content-Type':'text/event-stream', 'Cache-Control':'no-cache'});
    res.end(frames.map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    child = spawn(launcher, ['--profile','sdk-minimal','--patch',patch], {
      cwd:root, env:{PATH:'/usr/bin:/bin',HOME:root,DSH_HOME:root,DEEPSEEK_API_KEY:'sk-synthetic-probe-key',DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`},
      stdio:['pipe','pipe','pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 5000); });
    const lines = readline.createInterface({input:child.stdout});
    const send = (id, method, params) => child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);
    let done = false, sawResponse = false, failureProjection = null;
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('probe timeout')), 30000);
      child.once('error', reject);
      child.once('close', code => { clearTimeout(timer); done ? resolve() : reject(Error(`runtime exit ${code}; ${stderr.slice(-1500)}`)); });
      lines.on('line', line => {
        let frame;
        try { frame = JSON.parse(line); } catch { return; }
        if (failureStatus && frame.method === 'session.event' && frame.params?.event?.type === 'turn/end') {
          const reason = frame.params.event.data?.reason;
          failureProjection = {kind:reason?.kind, code:reason?.code, nestedCode:reason?.error?.code, failureCode:reason?.error?.failure?.code};
        }
        if (process.env.STARCANVAS_PROBE_EVENTS === '1' && frame.method === 'session.event') console.log('EVENT', JSON.stringify(frame.params));
        if (JSON.stringify(frame).includes('LOCAL_MOCK_RESPONSE')) sawResponse = true;
        if (frame.id === 1) {
          if (frame.error) { reject(Error(`initialize failed ${JSON.stringify(frame.error)}`)); return; }
          send(2, 'session/prompt', {sessionId:'synthetic-probe', contentBlocks:[{type:'text', text:'Say hello.'}]});
        } else if (frame.id === 2) {
          if (frame.error) { reject(Error(`prompt failed ${JSON.stringify(frame.error)}`)); return; }
          send(3, 'session/wait', {sessionId:'synthetic-probe'});
        } else if (frame.id === 3) {
          if (!failureStatus && frame.error) { reject(Error(`wait failed ${JSON.stringify(frame.error)}`)); return; }
          if (!failureStatus && !sawResponse) { reject(Error('mock response missing')); return; }
          if (failureStatus && !failureProjection) { reject(Error('failure event missing')); return; }
          done = true; send(4, 'shutdown', {});
        } else if (frame.id === 4) { child.stdin.end(); }
        else if (frame.method && frame.id !== undefined) {
          child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id:frame.id,error:{code:-32601,message:'Not supported'}})}\n`);
        }
      });
    });
    send(1, 'initialize', {cwd:root, provider:'deepseek-official',model:'deepseek-v4-flash',approvalRequests:true,maxTokens:1024});
    await finished;
    console.log(failureStatus ? `PASS_REAL_HARNESS_FAILURE status=${failureStatus} projection=${JSON.stringify(failureProjection)} requests=${requests}` : `PASS_REAL_HARNESS_LOCAL_MODEL requests=${requests}`);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await new Promise(resolve => child.once('close', resolve));
    }
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, {recursive:true,force:true});
  }
}
main().catch(error => { console.error('HARNESS_LOCAL_PROBE_FAILED', error.message); process.exitCode = 1; });
