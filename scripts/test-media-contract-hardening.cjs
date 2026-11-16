#!/usr/bin/env node
// Local contract tests: no credentials, network, user profile or provider charges.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText, file);
const { buildMediaApiUrl } = require('../src/renderer/lib/model-binding.ts');
const { wanjuanBuildGeminiImageTransport, wanjuanExtractGeminiImage } = require('../src/renderer/lib/gemini-image.ts');
for (const [base, route, expected] of [
  ['https://fixture.invalid', '/v1/videos', 'https://fixture.invalid/v1/videos'],
  ['https://fixture.invalid/v1/', '/v1/videos', 'https://fixture.invalid/v1/videos'],
  ['https://fixture.invalid/proxy/v1', '/v1/videos/t1', 'https://fixture.invalid/proxy/v1/videos/t1'],
  ['https://fixture.invalid/v1beta', '/v1beta/models/id:generateContent', 'https://fixture.invalid/v1beta/models/id:generateContent'],
  ['https://fixture.invalid/api/v3', '/api/v3/contents/generations/tasks', 'https://fixture.invalid/api/v3/contents/generations/tasks'],
  ['https://fixture.invalid/root', '/v1/videos', 'https://fixture.invalid/root/v1/videos'],
  ['https://fixture.invalid/v1', 'https://other.invalid/v1/videos', 'https://other.invalid/v1/videos'],
]) assert.equal(buildMediaApiUrl(base, route), expected);
assert.equal(wanjuanBuildGeminiImageTransport({ apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-flash-image' }).requestUrl,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
for (const part of [
  { inlineData: { mimeType: 'image/png', data: 'dGVzdA==' } },
  { inline_data: { mime_type: 'image/png', data: 'dGVzdA==' } },
]) assert.equal(wanjuanExtractGeminiImage({ candidates: [{ content: { parts: [part] } }] }).imageUrl, 'data:image/png;base64,dGVzdA==');
assert.equal(wanjuanExtractGeminiImage({ candidates: [{ content: { parts: [{ file_data: { file_uri: 'https://fixture.invalid/result.png' } }] } }] }).imageUrl,
  'https://fixture.invalid/result.png');
assert.deepEqual(wanjuanExtractGeminiImage({ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }), { imageUrl: '', text: 'No image' });
assert.equal(wanjuanExtractGeminiImage({ candidates: [{ content: { parts: [{ fileData: { fileUri: 'javascript:alert(1)' } }] } }] }).imageUrl, '');
console.log('PASS_MEDIA_URL_AND_GEMINI_RESPONSE_CONTRACTS');
