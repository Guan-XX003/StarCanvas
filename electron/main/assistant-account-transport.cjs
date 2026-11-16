// Fixed-origin transport for the account PKCE core. The real account login has
// not yet been verified. Protocol shape is pinned to:
// https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/credentials/deepseek-account-platform/src/protocol.ts
const ORIGIN = 'https://platform.deepseek.com';
const FIELDS = Object.freeze({
  auth_init:['code_challenge','code_challenge_method','state','redirect_uri','locale','login_source'],
  auth_exchange:['code','code_verifier','redirect_uri','device_id','device_model','os_version'],
  auth_cancel:['authorize_id','code_verifier'],
});
const MAX_BODY = 16384, MAX_RESPONSE = 65536;
function failure(code) { const error = new Error(code); error.code = code; return error; }
function createAssistantAccountPost(net, {version, language, platformName, timezoneOffsetSeconds, timeoutMs = 30000}) {
  if (!net || typeof net.request !== 'function' || typeof version !== 'string' || !/^[0-9A-Za-z.+_-]{1,64}$/.test(version) || typeof language !== 'string' || language.length > 32 || !['darwin','win32'].includes(platformName) || !Number.isInteger(timezoneOffsetSeconds) || Math.abs(timezoneOffsetSeconds) > 86400 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw failure('ACCOUNT_TRANSPORT_CONFIG');
  const locale = /^zh(?:[-_]|$)/i.test(language) ? 'zh_CN' : 'en_US';
  const clientPlatform = platformName === 'win32' ? 'desktop-win' : 'desktop-mac';
  return function post(method, body, {signal} = {}) {
    if (!Object.hasOwn(FIELDS, method) || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== [...FIELDS[method]].sort().join(',') || Object.values(body).some(value => typeof value !== 'string')) return Promise.reject(failure('ACCOUNT_TRANSPORT_INVALID_REQUEST'));
    let payload;
    try { payload = JSON.stringify(body); } catch { return Promise.reject(failure('ACCOUNT_TRANSPORT_INVALID_REQUEST')); }
    if (Buffer.byteLength(payload,'utf8') > MAX_BODY) return Promise.reject(failure('ACCOUNT_TRANSPORT_INVALID_REQUEST'));
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) return Promise.reject(failure('ACCOUNT_TRANSPORT_INVALID_REQUEST'));
    if (signal?.aborted) return Promise.reject(failure('ACCOUNT_TRANSPORT_CANCELLED'));
    return new Promise((resolve,reject) => {
      let request, response, timer, settled=false, size=0;
      const chunks=[];
      const onAbort = () => stop('ACCOUNT_TRANSPORT_CANCELLED');
      function finish(error,value) {
        if (settled) return;
        settled=true; clearTimeout(timer); signal?.removeEventListener('abort',onAbort);
        if (error) reject(error); else resolve(value);
      }
      function stop(code) {
        finish(failure(code));
        try { response?.destroy(); } catch {}
        try { request?.abort(); } catch {}
      }
      try {
        request = net.request({method:'POST',url:`${ORIGIN}/auth-api/v0/dsh/${method}`,redirect:'manual',useSessionCookies:false});
        for (const [key,value] of Object.entries({'Content-Type':'application/json','Accept':'application/json','Cache-Control':'no-store','x-client-bundle-id':'','x-client-platform':clientPlatform,'x-client-version':version,'x-client-locale':locale,'x-client-timezone-offset':String(timezoneOffsetSeconds)})) request.setHeader(key,value);
        request.on('redirect', () => stop('ACCOUNT_TRANSPORT_REDIRECT'));
        request.on('error', () => finish(failure('ACCOUNT_TRANSPORT_NETWORK')));
        request.on('response', res => {
          response=res;
          res.on('error', () => finish(failure('ACCOUNT_TRANSPORT_NETWORK')));
          if (Number(res.statusCode) < 200 || Number(res.statusCode) >= 300 || !Number.isInteger(Number(res.statusCode))) { stop('ACCOUNT_TRANSPORT_HTTP'); return; }
          res.on('data', chunk => {
            if (settled) return;
            const bytes=Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size+=bytes.length;
            if (size > MAX_RESPONSE) { stop('ACCOUNT_TRANSPORT_RESPONSE'); return; }
            chunks.push(bytes);
          });
          res.on('end', () => {
            if (settled) return;
            try { finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { stop('ACCOUNT_TRANSPORT_RESPONSE'); }
          });
        });
        if (settled) return;
        signal?.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(() => stop('ACCOUNT_TRANSPORT_TIMEOUT'),timeoutMs);
        if (signal?.aborted) { onAbort(); return; }
        request.write(payload); if (!settled) request.end();
      } catch { stop('ACCOUNT_TRANSPORT_NETWORK'); }
    });
  };
}
module.exports = {createAssistantAccountPost};
