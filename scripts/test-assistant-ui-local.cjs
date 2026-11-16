// Interactive source-window fixture: real Harness and secure storage, synthetic
// key and localhost-only model. This script is never packaged or shipped.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {app, net} = require('electron');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-assistant-ui-fixture-'));
const qaService = `org.starcanvas.account-secret.qa.${crypto.randomUUID().toUpperCase()}`;
process.env.WANJUAN_TEST_USER_DATA_PATH = home;
process.env.WANJUAN_ALLOW_RANDOM_PORT = '1';
process.env.WANJUAN_DISABLE_UPDATE_CHECK = '1';
process.env.STARCANVAS_DEV_KEYCHAIN_QA = '1';
process.env.STARCANVAS_KEYCHAIN_QA_SERVICE = qaService;
app.setPath('userData', home);
app.getAppPath = () => path.resolve(__dirname, '..');
let server, assistant, closing = false;

async function start() {
  if (process.platform !== 'darwin') throw Error('MACOS_ONLY');
  server = http.createServer((req, res) => {
    if (req.url === '/models') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({object:'list',data:[{id:'deepseek-flash'}]}));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
    if (body.includes('SYNTHETIC_AUTH_FAILURE')) {
      res.writeHead(401, {'Content-Type':'application/json'});
      res.end(JSON.stringify({type:'error',error:{type:'authentication_error',message:'synthetic-secret-should-not-appear'}}));
      return;
    }
    const events = [
      ['message_start',{type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model:'deepseek-v4-flash',content:[],stop_reason:null,usage:{input_tokens:4,output_tokens:1}}}],
      ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
      ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:body.includes('api-docs.deepseek.com') ? JSON.stringify({modelName:'deepseek-flash',category:'text',apiConfig:{name:'Synthetic QA'},protocol:{name:'OpenAI Chat 原生',config:{category:'text',requestType:'openai-chat',submitPath:'/chat/completions'}}}) : body.includes('SYNTHETIC_DRAFT_NODE') ? '请先检查内容，再决定是否创建节点。\n[[STARCANVAS_NODE:{"type":"image","content":"Sunrise over the sea"}]]' : body.includes('SYNTHETIC_CREATE_NODE') ? '可以点击按钮创建一个空白生图节点，不会自动生成。\n[[STARCANVAS_ACTION:create_image_node]]' : '可以先打开 API 配置，填写服务商地址和密钥。\n[[STARCANVAS_ACTION:open_api_settings]]'}}],
      ['content_block_stop',{type:'content_block_stop',index:0}],
      ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}}],
      ['message_stop',{type:'message_stop'}],
    ];
    const reply = () => {
      if (res.destroyed) return;
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      res.end(events.map(([name,data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
    };
    if (body.includes('SYNTHETIC_DELAY')) {
      const timer = setTimeout(reply, 15000);
      res.once('close', () => clearTimeout(timer));
    } else reply();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const clientModule = require('../electron/main/assistant-harness-client.cjs');
  const create = clientModule.createHarnessClient;
  clientModule.createHarnessClient = options => create({...options, env:{...options.env,DEEPSEEK_BASE_URL:`http://127.0.0.1:${server.address().port}`}});
  const probeModule = require('../electron/main/assistant-connection-probe.cjs');
  const createProbe = probeModule.createAssistantConnectionProbe;
  probeModule.createAssistantConnectionProbe = () => createProbe({request(options) {
    if (options.url !== 'https://api.deepseek.com/models') throw Error('UNEXPECTED_PROBE_ENDPOINT');
    return net.request({...options,url:`http://127.0.0.1:${server.address().port}/models`});
  }});
  assistant = require('../electron/main/assistant-service.cjs');
  await assistant.setKey('sk-synthetic-ui-fixture-only');
  require('../electron/main/index.cjs');
}
app.on('before-quit', event => {
  if (closing) return;
  closing = true; event.preventDefault();
  (async () => {
    try { if (assistant) await assistant.shutdown(); } catch { process.exitCode = 1; }
    if (server) await new Promise(resolve => server.close(resolve));
    const helper = path.join(__dirname, '..', 'build', 'native-tools', 'macos-account-keychain');
    const cleanup = spawnSync(helper, [], {input:JSON.stringify({operation:'qa-delete',value:'',qaService}),encoding:'utf8',timeout:10000,env:{...process.env,STARCANVAS_KEYCHAIN_QA:'1'}});
    try { if (cleanup.status !== 0 || JSON.parse(cleanup.stdout).ok !== true) throw Error(); }
    catch { console.error('SYNTHETIC_KEYCHAIN_CLEANUP_FAILED'); process.exitCode = 1; }
    fs.rmSync(home, {recursive:true,force:true});
    app.exit(process.exitCode || 0);
  })().catch(() => app.exit(1));
});
app.whenReady().then(start).catch(error => { console.error('ASSISTANT_UI_FIXTURE_FAILED', error.code || 'UNKNOWN'); process.exitCode = 1; app.quit(); });
