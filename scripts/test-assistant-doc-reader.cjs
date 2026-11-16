const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}, fileName:filename,
}).outputText, filename);
const {fetchAssistantDocumentation} = require('../src/renderer/lib/assistant-doc-reader.ts');

async function main() {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({url, options});
    return new Response('Public API docs: POST /v1/videos', {status:200});
  };
  assert.match(await fetchAssistantDocumentation('https://docs.example.com/api'), /POST \/v1\/videos/);
  assert.equal(new URL(calls[0].url).origin, 'https://r.jina.ai');
  assert.equal(calls[0].url, 'https://r.jina.ai/https://docs.example.com/api');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].options.cache, 'no-store');
  for (const url of ['http://127.0.0.1/private', 'https://user:pass@example.com/', 'https://example.com/?token=secret', 'https://docs.example.com/?key=synthetic-key', 'https://docs.example.com/?passwd=123456', 'https://docs.example.com/#pwd=123456', 'https://docs.example.com/?X-Amz-Credential=synthetic', 'https://docs.example.com/?redirect=https%3A%2F%2Fapi.example.com%2F%3Fkey%3Dsynthetic', 'https://docs.example.com/?redirect=https%253A%252F%252Fapi.example.com%252F%253Ftoken%253Dsynthetic', 'file:///etc/passwd']) {
    await assert.rejects(fetchAssistantDocumentation(url));
  }
  assert.equal(calls.length, 1, 'invalid addresses do not invoke fetch or fall back to direct browser access');

  calls.length = 0;
  global.fetch = async (url, options) => {
    calls.push({url, options});
    return new Response(url.endsWith('/1e0') ? 'Video endpoint details' : 'Index https://demo.apifox.cn/1e0 https://evil.example/2e0 https://demo.apifox.cn/1e0', {status:200});
  };
  const result = await fetchAssistantDocumentation('https://demo.apifox.cn/');
  assert.match(result, /Video endpoint details/);
  assert.equal(calls.length, 2, 'only unique pages from the original Apifox host are read');
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://r.jina.ai'));
  assert.equal(calls[1].url, 'https://r.jina.ai/https://demo.apifox.cn/1e0');

  global.fetch = async () => new Response('x', {status:200, headers:{'content-length':String(2 * 1024 * 1024 + 1)}});
  await assert.rejects(fetchAssistantDocumentation('https://docs.example.com/'), /过大/);
  global.fetch = async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), {status:200});
  await assert.rejects(fetchAssistantDocumentation('https://docs.example.com/'), /过大/);
  global.fetch = async () => new Response('<title>Login</title>', {status:200});
  await assert.rejects(fetchAssistantDocumentation('https://docs.example.com/'), /登录/);
  global.fetch = async () => { throw new TypeError('redirect blocked'); };
  await assert.rejects(fetchAssistantDocumentation('https://docs.example.com/'));
  console.log('PASS_ASSISTANT_PUBLIC_DOCUMENT_READER');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
