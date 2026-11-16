// Private main-process client for the official Harness newline JSON-RPC wire.
// No IPC exposure here. The caller owns runtime verification, environment and
// temporary home; all wire errors are deliberately reduced to generic codes.
const {spawn} = require('node:child_process');
const {StringDecoder} = require('node:string_decoder');
const {randomUUID} = require('node:crypto');

function problem(code) { const error = new Error(code); error.code = code; return error; }
const SAFE_FAILURE_CODES = Object.freeze({
  AUTH:'ASSISTANT_PROVIDER_AUTH', QUOTA:'ASSISTANT_PROVIDER_QUOTA',
  RATE_LIMIT:'ASSISTANT_PROVIDER_RATE_LIMIT', SERVER:'ASSISTANT_PROVIDER_SERVER',
  TIMEOUT:'ASSISTANT_PROVIDER_TIMEOUT', TRANSPORT:'ASSISTANT_PROVIDER_NETWORK',
  MISSING_CREDENTIAL:'ASSISTANT_KEY_REQUIRED',
});
function safeFailure(reason) {
  const code = reason?.kind === 'error' ? reason?.error?.code : null;
  return typeof code === 'string' && Object.hasOwn(SAFE_FAILURE_CODES, code) ? SAFE_FAILURE_CODES[code] : null;
}

function createHarnessClient({launcher, patch, home, env, initializeTimeoutMs = 30000, turnTimeoutMs = 180000, shutdownTimeoutMs = 2000, shutdownGraceMs = 2500, shutdownExitTimeoutMs = 2000}) {
  const sessionId = `starcanvas-${randomUUID().replaceAll('-', '')}`;
  const child = spawn(launcher, ['--profile', 'sdk-minimal', '--patch', patch], {
    cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  // Never forward raw stderr or JSON-RPC errors to logs/UI: either may contain
  // credentials, prompts, provider output, or local filesystem paths.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const decoder = new StringDecoder('utf8');
  const pending = new Map();
  let buffer = '', nextId = 0, closed = false, closing = false, stopUnconfirmed = false, closePromise = null, turn = null, busy = false;
  let exitResolve;
  const exited = new Promise(resolve => { exitResolve = resolve; });
  function failAll(code) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(problem(code)); }
    pending.clear();
  }
  child.on('error', () => failAll('ASSISTANT_RUNTIME_UNAVAILABLE'));
  child.once('close', () => { closed = true; failAll('ASSISTANT_RUNTIME_CLOSED'); exitResolve(); });
  function send(frame) {
    if (closed || !child.stdin.writable) throw problem('ASSISTANT_RUNTIME_CLOSED');
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  }
  function request(method, params, timeoutMs) {
    if (closed) return Promise.reject(problem('ASSISTANT_RUNTIME_CLOSED'));
    if ((closing || stopUnconfirmed) && method !== 'shutdown') return Promise.reject(problem('ASSISTANT_RUNTIME_STOP_UNCONFIRMED'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // An SDK timeout does not cancel work. Terminate rather than retry a
        // possibly billable request or let it run invisibly.
        try { child.kill('SIGKILL'); } catch { /* Exit is checked separately. */ }
        reject(problem('ASSISTANT_RUNTIME_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, {resolve, reject, timer});
      try { send({jsonrpc: '2.0', id, method, params}); }
      catch { clearTimeout(timer); pending.delete(id); reject(problem('ASSISTANT_RUNTIME_CLOSED')); }
    });
  }
  function accept(frame) {
    if (!frame || frame.jsonrpc !== '2.0') return;
    if (typeof frame.method === 'string' && frame.id !== undefined) {
      if (frame.method === 'approval/request') send({jsonrpc:'2.0', id:frame.id, result:{outcome:'rejected'}});
      else if (frame.method === 'user-question/ask') send({jsonrpc:'2.0', id:frame.id, result:{cancelled:true}});
      else send({jsonrpc:'2.0', id:frame.id, error:{code:-32601, message:'Not supported'}});
      return;
    }
    if (frame.id !== undefined && pending.has(frame.id)) {
      const item = pending.get(frame.id); pending.delete(frame.id); clearTimeout(item.timer);
      if (frame.error) item.reject(problem('ASSISTANT_REQUEST_FAILED')); else item.resolve(frame.result);
      return;
    }
    if (!turn || frame.method !== 'session.event' || frame.params?.sessionId !== turn.sessionId) return;
    const event = frame.params.event;
    if (event?.type === 'assistant/message') {
      const blocks = event.data?.message?.content;
      if (Array.isArray(blocks)) turn.text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('').slice(0, 200000);
    } else if (event?.type === 'turn/end') {
      turn.completed = event.data?.reason?.kind === 'completed';
      turn.failureCode = safeFailure(event.data?.reason);
    }
  }
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 2_000_000) { child.kill('SIGKILL'); failAll('ASSISTANT_RUNTIME_OUTPUT_LIMIT'); return; }
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try { accept(JSON.parse(line)); } catch { /* Invalid or unhandled frames cannot grant permissions. */ }
    }
  });
  // Current official API alias; older pinned Harness versions pass unlisted
  // DeepSeek model identifiers through to the provider.
  const initialized = request('initialize', {cwd:home, provider:'deepseek-official', model:'deepseek-flash', approvalRequests:true, maxTokens:4096}, initializeTimeoutMs)
    .then(result => { if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw problem('ASSISTANT_RUNTIME_PROTOCOL'); });
  // The caller can close without ever sending a message; retain the original
  // rejected promise for sendMessage while avoiding an unhandled rejection.
  initialized.catch(() => {});
  return Object.freeze({
    async sendMessage(text, options = {}) {
      if (closing || stopUnconfirmed || closed) throw problem('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
      if (busy) throw problem('ASSISTANT_BUSY');
      const independent = options.independent === true;
      // The host validates user text to 16,000 characters; allow room for its
      // fixed, allowlisted UI-location envelope on ordinary chat requests.
      if (typeof text !== 'string' || !text.trim() || text.length > (independent ? 260000 : 16512)) throw problem('ASSISTANT_INVALID_MESSAGE');
      busy = true;
      try {
        await initialized;
        const activeId = independent ? `starcanvas-task-${randomUUID().replaceAll('-', '')}` : sessionId;
        turn = {sessionId:activeId, text:'', completed:false, failureCode:null};
        const receipt = await request('session/prompt', {sessionId:activeId, contentBlocks:[{type:'text', text}]}, turnTimeoutMs);
        if (typeof receipt?.messageId !== 'string' || !receipt.messageId) throw problem('ASSISTANT_RUNTIME_PROTOCOL');
        try { await request('session/wait', {sessionId:activeId}, turnTimeoutMs); }
        catch (error) { if (turn.failureCode) throw problem(turn.failureCode); throw error; }
        if (!turn.completed || !turn.text) throw problem(turn.failureCode || 'ASSISTANT_TURN_FAILED');
        return turn.text;
      } finally { turn = null; busy = false; }
    },
    close() {
      if (closed) return Promise.resolve();
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        try { await request('shutdown', {}, shutdownTimeoutMs); } catch { /* Process exit is checked below. */ }
        if (closed) return;
        try { child.stdin.end(); } catch { /* Process exit is checked below. */ }
        const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, shutdownGraceMs);
        let exitTimer;
        const didExit = await Promise.race([exited.then(() => true), new Promise(resolve => {exitTimer = setTimeout(() => resolve(false), shutdownGraceMs + shutdownExitTimeoutMs);})]);
        clearTimeout(killTimer); clearTimeout(exitTimer);
        if (!didExit) {
          stopUnconfirmed = true;
          failAll('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
          throw problem('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
        }
      })().finally(() => {closing = false; closePromise = null;});
      return closePromise;
    },
  });
}

module.exports = {createHarnessClient};
