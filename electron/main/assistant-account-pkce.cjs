// Account-authorization core. The app integration is experimental and has not
// yet been verified with a real account. Protocol reference:
// https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/credentials/deepseek-account-platform
const http = require('node:http');
const {randomBytes, createHash, timingSafeEqual} = require('node:crypto');
const {platform, arch, release} = require('node:os');

const ORIGIN = 'https://platform.deepseek.com';
function failure(code) { const error = new Error(code); error.code = code; return error; }
function officialBrowserUrl(value, pathname) {
  if (typeof value !== 'string' || value.length > 8192) throw failure('ACCOUNT_AUTH_PROTOCOL');
  let url;
  try { url = new URL(value); } catch { throw failure('ACCOUNT_AUTH_PROTOCOL'); }
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== pathname) throw failure('ACCOUNT_AUTH_PROTOCOL');
  return url;
}
function unwrap(value) {
  if (!value || value.code !== 0 || !value.data || value.data.biz_code !== 0 || !value.data.biz_data || typeof value.data.biz_data !== 'object') throw failure('ACCOUNT_AUTH_PROTOCOL');
  return value.data.biz_data;
}
function sameSecret(received, expected) {
  const left = Buffer.from(received), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function abortable(work, signal) {
  if (signal.aborted) return Promise.reject(failure('ACCOUNT_AUTH_CANCELLED'));
  return new Promise((resolve, reject) => {
    const stop = () => reject(failure('ACCOUNT_AUTH_CANCELLED'));
    signal.addEventListener('abort', stop, {once:true});
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', stop); resolve(value); }, error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}

function createAssistantAccountPkce({post, openExternal, saveGrant, getDeviceId, maxAttemptMs = 600000}) {
  if ([post, openExternal, saveGrant, getDeviceId].some(fn => typeof fn !== 'function') || !Number.isInteger(maxAttemptMs) || maxAttemptMs < 1 || maxAttemptMs > 600000) throw failure('ACCOUNT_AUTH_CONFIG');
  let active = null, phase = 'idle';
  // Timer callbacks can be delayed while the computer sleeps. A status read
  // rechecks the wall-clock deadline so an expired attempt cannot look live.
  const status = () => {
    if (active && active.phase !== 'committing' && Date.now() >= active.expiresAt) abort(active, 'expired');
    return {phase};
  };
  function live(a) { return active === a && !a.controller.signal.aborted && Date.now() < a.expiresAt; }
  function close(a) { clearTimeout(a.timer); if (a.server.listening) a.server.close(); }
  function abort(a, next) {
    if (active !== a || a.phase === 'committing') return;
    active = null; phase = next; a.controller.abort(); close(a);
    if (a.authorizeId) {
      // This best-effort cleanup has its own deadline and cannot restore state.
      Promise.resolve().then(() => post('auth_cancel', {authorize_id:a.authorizeId, code_verifier:a.verifier}, {signal:AbortSignal.timeout(5000)})).catch(() => {});
    }
  }
  async function callback(a, req, res) {
    const reply = (code, headers = {}) => { if (!res.headersSent) res.writeHead(code, {'cache-control':'no-store','referrer-policy':'no-referrer','connection':'close', ...headers}); res.end(); };
    let url;
    if (!req.url || req.url.length > 8192) { reply(400); return; }
    try { url = new URL(req.url, `http://127.0.0.1:${a.port}`); } catch { reply(400); return; }
    const states = url.searchParams.getAll('state'), codes = url.searchParams.getAll('code');
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${a.port}` || url.origin !== `http://127.0.0.1:${a.port}` || url.pathname !== '/oauth/callback' || states.length !== 1 || codes.length !== 1 || !codes[0] || codes[0].length > 4096 || /[\u0000-\u001f\u007f]/.test(codes[0]) || !sameSecret(states[0], a.state)) { reply(400); return; }
    if (!live(a) || a.phase !== 'waiting') { reply(410); return; }
    a.phase = phase = 'exchanging';
    try {
      const deviceId = await abortable(getDeviceId(), a.controller.signal);
      if (!live(a)) throw failure('ACCOUNT_AUTH_CANCELLED');
      if (typeof deviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) throw failure('ACCOUNT_AUTH_DEVICE');
      const result = unwrap(await abortable(post('auth_exchange', {code:codes[0],code_verifier:a.verifier,redirect_uri:a.redirectUri,device_id:deviceId,device_model:`${platform()}-${arch()}`,os_version:`${platform()} ${release()}`}, {signal:a.controller.signal}), a.controller.signal));
      if (!live(a)) throw failure('ACCOUNT_AUTH_CANCELLED');
      if (typeof result.token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(result.token)) throw failure('ACCOUNT_AUTH_PROTOCOL');
      const completion = officialBrowserUrl(result.authorized_url, '/dsh/authorized');
      completion.searchParams.set('login_source', 'desktop');
      // Once persistence starts it must settle; cancellation cannot race a
      // later successful write and falsely claim the account was signed out.
      a.phase = phase = 'committing'; clearTimeout(a.timer);
      await saveGrant({version:1,token:result.token,issuer:ORIGIN});
      if (active !== a) throw failure('ACCOUNT_AUTH_CANCELLED');
      active = null; phase = 'complete';
      reply(302, {location:completion.href}); close(a);
    } catch {
      if (active === a) { active = null; phase = 'failed'; a.controller.abort(); close(a); }
      reply(500);
    }
  }
  return Object.freeze({
    status,
    async start({language = 'zh-CN'} = {}) {
      if (active) throw failure('ACCOUNT_AUTH_BUSY');
      const a = {phase:'initializing',controller:new AbortController(),verifier:randomBytes(32).toString('base64url'),state:randomBytes(32).toString('base64url'),expiresAt:Date.now()+maxAttemptMs};
      active = a; phase = a.phase;
      a.server = http.createServer((req,res) => { void callback(a,req,res); });
      a.server.headersTimeout = 5000; a.server.requestTimeout = 10000; a.server.maxRequestsPerSocket = 1;
      a.server.on('error', () => { if (active === a) abort(a, 'failed'); });
      a.timer = setTimeout(() => abort(a, 'expired'), maxAttemptMs);
      try {
        await new Promise((resolve,reject) => { a.server.once('error',reject); a.server.listen(0,'127.0.0.1',resolve); });
        if (!live(a)) throw failure('ACCOUNT_AUTH_CANCELLED');
        a.port = a.server.address().port;
        a.redirectUri = `http://127.0.0.1:${a.port}/oauth/callback`;
        const challenge = createHash('sha256').update(a.verifier).digest('base64url');
        const locale = /^zh/i.test(String(language)) ? 'zh_CN' : 'en_US';
        const init = unwrap(await abortable(post('auth_init', {code_challenge:challenge,code_challenge_method:'S256',state:a.state,redirect_uri:a.redirectUri,locale,login_source:'desktop'}, {signal:a.controller.signal}), a.controller.signal));
        if (!live(a)) throw failure('ACCOUNT_AUTH_CANCELLED');
        if (typeof init.authorize_id !== 'string' || !init.authorize_id || init.authorize_id.length > 4096 || !Number.isFinite(init.expires_in) || init.expires_in <= 0) throw failure('ACCOUNT_AUTH_PROTOCOL');
        const url = officialBrowserUrl(init.authorize_url, '/dsh/authorize');
        a.authorizeId = init.authorize_id;
        a.expiresAt = Math.min(a.expiresAt, Date.now() + init.expires_in * 1000);
        clearTimeout(a.timer); a.timer = setTimeout(() => abort(a, 'expired'), Math.max(1, a.expiresAt - Date.now()));
        a.phase = phase = 'waiting';
        if (await abortable(openExternal(url.href), a.controller.signal) === false) throw failure('ACCOUNT_AUTH_BROWSER');
        if (active === a && !live(a)) throw failure('ACCOUNT_AUTH_CANCELLED');
        return status();
      } catch (error) {
        // A callback can complete before the platform browser call settles.
        // Once committing starts, do not misreport a successful grant as failed.
        if (a.phase === 'committing' || (active !== a && phase === 'complete')) return status();
        if (active === a) abort(a, 'failed');
        else close(a); // Cancellation may have happened while listen was pending.
        throw failure(error?.code === 'ACCOUNT_AUTH_CANCELLED' ? error.code : 'ACCOUNT_AUTH_FAILED');
      }
    },
    async cancel() {
      const current = status();
      if (!active) return current;
      if (active.phase === 'committing') return status();
      abort(active, 'cancelled'); return status();
    },
  });
}

module.exports = {createAssistantAccountPkce};
