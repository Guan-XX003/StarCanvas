// Official inference bridge. The real account grant or API Key stays in the main
// process; the restricted Harness receives only a random, short-lived local key.
// The target and protocol are pinned to the official Harness account adapter.
const http = require('node:http');
const crypto = require('node:crypto');
const {createAssistantAnswerTap} = require('./assistant-answer-tap.cjs');

const UPSTREAM = 'https://api.deepseek.com/anthropic/v1/messages';
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_OUTPUT = 20 * 1024 * 1024;
function error(code) { const e = new Error(code); e.code = code; return e; }
function createAssistantAccountBroker({net, getGrant, getKey, onText, timeoutMs = 180000}) {
  if (!net || typeof net.request !== 'function' || (typeof getGrant === 'function') === (typeof getKey === 'function') || (getGrant !== undefined && typeof getGrant !== 'function') || (getKey !== undefined && typeof getKey !== 'function') || (onText !== undefined && typeof onText !== 'function') || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw error('ACCOUNT_BROKER_CONFIG');
  const secret = `sk-local-${crypto.randomBytes(32).toString('hex')}`;
  const active = new Set();
  let listening = false, closing = false, port, listenPromise, closePromise;
  const server = http.createServer((req, res) => {
    const reject = (status) => { if (!res.headersSent) res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end('{"type":"error","error":{"type":"request_error","message":"Request unavailable"}}'); req.resume(); };
    const raw = req.rawHeaders;
    const keys = [];
    for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === 'x-api-key') keys.push(raw[i + 1]);
    const candidate = Buffer.from(keys[0] || '');
    const expected = Buffer.from(secret);
    if (closing || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== `127.0.0.1:${port}` || req.method !== 'POST' || req.url !== '/v1/messages' || keys.length !== 1 || candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected) || req.headers.origin || req.headers.cookie || req.headers.authorization || req.headers['x-dsh-auth-token'] || req.headers['proxy-authorization'] || req.headers['transfer-encoding'] || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { reject(403); return; }
    const declared = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_INPUT) { reject(413); return; }
    if (active.size >= 1) { reject(429); return; }
    let upstream, upstreamResponse, done = false, size = 0, output = 0;
    const chunks = [];
    const job = {cancel: () => stop(503)};
    active.add(job);
    const timer = setTimeout(() => stop(504), timeoutMs);
    function finish() { if (done) return false; done = true; clearTimeout(timer); active.delete(job); return true; }
    function stop(status) {
      if (!finish()) return;
      try { upstreamResponse?.destroy(); } catch {}
      try { upstream?.abort(); } catch {}
      if (!res.headersSent && !res.destroyed) reject(status);
      else if (!res.destroyed) res.destroy();
    }
    req.on('aborted', () => stop(499));
    req.on('error', () => stop(400));
    res.on('close', () => { if (!done) stop(499); });
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_INPUT || size > declared) { stop(413); return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (done) return;
      if (size !== declared) { stop(400); return; }
      const body = Buffer.concat(chunks);
      try { const parsed = JSON.parse(body.toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.stream !== true) { stop(400); return; } } catch { stop(400); return; }
      let credential;
      try {
        if (getKey) credential = await getKey();
        else {
          const grant = await getGrant();
          if (grant?.version === 1 && grant.issuer === 'https://platform.deepseek.com') credential = grant.token;
        }
      } catch { stop(401); return; }
      if (done) return;
      if (typeof credential !== 'string' || credential.length < 1 || credential.length > 8192 || !/^[\x21-\x7e]+$/.test(credential)) { stop(401); return; }
      try {
        upstream = net.request({method:'POST',url:UPSTREAM,redirect:'manual',useSessionCookies:false});
        // Electron's Chromium network stack computes the outgoing length. An
        // explicit Content-Length causes net::ERR_INVALID_ARGUMENT even when
        // it matches the body, so never set it on this outbound ClientRequest.
        for (const [name, value] of Object.entries({'Content-Type':'application/json','Accept':'text/event-stream','anthropic-version':'2023-06-01','Cache-Control':'no-store',[getKey ? 'x-api-key' : 'x-dsh-auth-token']:credential})) upstream.setHeader(name,value);
        credential = null;
        upstream.on('redirect', () => stop(502));
        upstream.on('error', () => stop(502));
        upstream.on('response', response => {
          upstreamResponse = response;
          response.on('error', () => stop(502));
          response.on('close', () => { if (!done) stop(502); });
          const status = Number(response.statusCode);
          if (status !== 200) { stop(status >= 400 && status <= 599 ? status : 502); return; }
          if (!/^text\/event-stream(?:\s*;|$)/i.test(String(response.headers['content-type'] || ''))) { stop(502); return; }
          res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          const tap = createAssistantAnswerTap(onText);
          response.on('data', chunk => {
            if (done) return;
            output += chunk.length;
            if (output > MAX_OUTPUT) { stop(502); return; }
            tap.write(chunk);
            if (!res.write(chunk)) { response.pause(); res.once('drain', () => { if (!done) response.resume(); }); }
          });
          response.on('end', () => { if (finish()) res.end(); });
        });
        if (!done) { upstream.write(body); upstream.end(); }
      } catch { stop(502); }
    });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 1;
  server.on('clientError', (_err, socket) => socket.destroy());
  return Object.freeze({
    async start() {
      if (listening || closing) throw error('ACCOUNT_BROKER_STATE');
      listening = true;
      listenPromise = new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      await listenPromise;
      if (closing) throw error('ACCOUNT_BROKER_STATE');
      port = server.address().port;
      return Object.freeze({baseURL:`http://127.0.0.1:${port}`, clientKey:secret});
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const job of [...active]) job.cancel();
      closePromise = (async () => {
        if (listenPromise) await listenPromise.catch(() => {});
        if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
      })();
      return closePromise;
    },
  });
}
module.exports = {createAssistantAccountBroker};
