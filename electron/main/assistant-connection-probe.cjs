// This check is deliberately narrower than a model call: one authenticated GET
// to a fixed official endpoint, no prompts, redirects, cookies or retries.
const MODELS_URL = 'https://api.deepseek.com/models';
const MAX_BYTES = 256 * 1024;
const MODEL = 'deepseek-flash';

function failure(code) { const error = new Error(code); error.code = code; return error; }

function createAssistantConnectionProbe(net, timeoutMs = 15000) {
  return function probe(key) {
    if (typeof key !== 'string' || !key || /[\r\n\0]/.test(key)) return Promise.reject(failure('ASSISTANT_INVALID_KEY'));
    if (!net || typeof net.request !== 'function') return Promise.reject(failure('ASSISTANT_NETWORK_ERROR'));
    return new Promise((resolve, reject) => {
      let request, response, timer, settled = false, bytes = 0;
      const chunks = [];
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      }
      function stop(code) {
        // Mark settled first: abort may synchronously emit another error.
        finish(failure(code));
        try { response?.destroy(); } catch {}
        try { request?.abort(); } catch {}
      }
      try {
        request = net.request({method:'GET', url:MODELS_URL, redirect:'manual', useSessionCookies:false});
        request.setHeader('Authorization', `Bearer ${key}`);
        request.setHeader('Accept', 'application/json');
        request.setHeader('Cache-Control', 'no-store');
        request.on('redirect', () => stop('ASSISTANT_UNEXPECTED_REDIRECT'));
        request.on('error', () => finish(failure('ASSISTANT_NETWORK_ERROR')));
        request.on('response', res => {
          response = res;
          res.on('error', () => finish(failure('ASSISTANT_NETWORK_ERROR')));
          const status = Number(res.statusCode || 0);
          if (status === 401 || status === 403) { stop('ASSISTANT_AUTH_REJECTED'); return; }
          if (status === 429) { stop('ASSISTANT_RATE_LIMITED'); return; }
          if (status < 200 || status >= 300) { stop('ASSISTANT_SERVICE_UNAVAILABLE'); return; }
          res.on('data', chunk => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > MAX_BYTES) { stop('ASSISTANT_INVALID_RESPONSE'); return; }
            chunks.push(buffer);
          });
          res.on('end', () => {
            if (settled) return;
            try {
              const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (payload?.object !== 'list' || !Array.isArray(payload.data)) throw new Error();
              finish(null, {modelAvailable:payload.data.some(item => item && item.id === MODEL)});
            } catch { finish(failure('ASSISTANT_INVALID_RESPONSE')); }
          });
        });
        timer = setTimeout(() => stop('ASSISTANT_NETWORK_TIMEOUT'), timeoutMs);
        request.end();
      } catch { stop('ASSISTANT_NETWORK_ERROR'); }
    });
  };
}

module.exports = {createAssistantConnectionProbe};
