#!/usr/bin/env node
// Closed-network regression for the existing canvas interaction, not provider certification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: filename,
    });
    module._compile(result.outputText, filename);
  };
}
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'react') return { ...originalLoad.apply(this, arguments), useCallback: (fn) => fn };
  return originalLoad.apply(this, arguments);
};

global.localStorage = { getItem: () => null, setItem() {} };
global.window = { addEventListener() {}, dispatchEvent() {}, wanjuanDesktop: {} };
global.Image = class {
  width = 1024;
  height = 1024;
  set src(value) { this.onload?.(); }
};
const { useImageGeneration } = require('../src/renderer/hooks/useImageGeneration.ts');
const { resolveMediaModelContract } = require('../src/renderer/lib/media-model-contract.ts');

const editedImage = 'data:image/png;base64,ZWRpdGVk';
const generatedImage = 'data:image/png;base64,Z2VuZXJhdGVk';
const model = 'fixture.image/v1';
const apiConfigs = [
  { id: 'relay', url: 'https://fixture-relay.invalid', key: 'fixture-relay-key', imageProtocolBindings: { [model]: 'relay-image' } },
  { id: 'official', url: 'https://fixture-official.invalid', key: 'fixture-official-key', imageProtocolBindings: { [model]: 'official-image' } },
];
const registry = {
  'relay-image': {
    category: 'image', requestType: 'openai-images', submitPath: '/relay/generate',
    fieldMapping: { referenceImage: 'reference_images', size: 'size' },
    parameterAdapter: { sizeValueMode: 'dimension' },
  },
  'official-image': {
    category: 'image', requestType: 'openai-images', submitPath: '/official/generate', editPath: '/official/edit',
    fieldMapping: { referenceImage: 'image[]', size: 'size' },
    parameterAdapter: { sizeValueMode: 'dimension' },
  },
};

async function runFlow(channel, invalidProfile = false) {
  const bindings = { [model]: 'relay' };
  const configs = invalidProfile ? apiConfigs.map((config) => config.id === channel
    ? { ...config, imageProtocolBindings: { [model]: 'removed-profile' } } : config) : apiConfigs;
  const data = { selectedApiConfigId: channel, selectedModel: model, aspectRatio: '1:1', imageSizeMode: 'resolution', imageResolution: '1024x1024' };
  let nodes = [
    { id: 'source', type: 'imageNode', data: {
      imageUrl: editedImage,
      projectAssetBindings: { imageUrl: { localPath: '/fixture/stale-original.png', sourceSignature: 'data:image/png;base64,b3JpZ2luYWw=', ok: true } },
    } },
    { id: 'first', type: 'imageNode', data: { ...data } },
    { id: 'downstream', type: 'imageNode', data: { ...data } },
  ];
  let edges = [
    { id: 'reference', source: 'source', target: 'first' },
    { id: 'reuse', source: 'first', target: 'downstream' },
  ];
  let tasks = [];
  const requests = [];
  const notices = [];
  const persisted = [];
  window.wanjuanDesktop.persistProjectAsset = async (asset) => {
    persisted.push(asset);
    return { ok: true, localPath: `/fixture/${asset.nodeId}.png`, value: generatedImage };
  };
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.ok(['fixture-relay.invalid', 'fixture-official.invalid'].includes(parsed.hostname), `external network forbidden: ${url}`);
    assert.equal(init.method, 'POST');
    requests.push({ url: String(url), init });
    return Response.json({ data: [{ url: 'https://fixture-output.invalid/generated.png' }] });
  };
  const contract = resolveMediaModelContract({ category: 'image', model, apiConfigs: configs, apiBindings: bindings, selectedApiConfigId: channel, registry });
  if (!invalidProfile) assert.equal(contract.protocolName, `${channel}-image`, 'node and request share selected channel contract');
  const { generateImage } = useImageGeneration({
    propImageApiKey: 'fixture-fallback-key', propImageApiUrl: 'https://fixture-fallback.invalid', drawingModel: model,
    apiConfigs: configs, imageModelApiBindings: bindings, imageModelProtocolBindings: {}, modelProtocolRegistry: registry,
    planLimits: {}, membership: {}, showToast: (message) => notices.push(message),
    getNodes: () => nodes, getEdges: () => edges,
    setNodes: (updater) => { nodes = typeof updater === 'function' ? updater(nodes) : updater; },
    setEdges: (updater) => { edges = typeof updater === 'function' ? updater(edges) : updater; },
    updateTaskList: (updater) => { tasks = typeof updater === 'function' ? updater(tasks) : updater; },
    addGeneratedAsset() {}, abortControllersRef: { current: new Map() },
    localforageModule: { default: { setItem: async () => {} } }, projectIdRef: { current: 'fixture-project' },
    setDailyGenerationCount() {}, audioApiKey: 0, timeoutSeconds: 5,
    propTextApiUrl: 'https://fixture-forbidden-text.invalid', propTextApiKey: '', textModel: '',
  });
  await generateImage('first', 'Synthetic canvas prompt', '1024x1024', model);
  if (invalidProfile) {
    assert.equal(requests.length, 0);
    assert.equal(persisted.length, 0);
    assert.equal(tasks.length, 0);
    assert.ok(notices.some((message) => message.includes('协议不存在')));
    return;
  }
  assert.equal(nodes.find((node) => node.id === 'first').data.imageUrl, generatedImage);
  await generateImage('downstream', 'Reuse the previous result', '1024x1024', model);
  assert.equal(requests.length, 2, 'one submission per node; no extra form or hidden request');
  for (const [index, request] of requests.entries()) {
    assert.equal(request.init.headers.Authorization, `Bearer fixture-${channel}-key`);
    const reference = index === 0 ? editedImage : generatedImage;
    if (channel === 'relay') {
      assert.equal(request.url, 'https://fixture-relay.invalid/relay/generate');
      const body = JSON.parse(request.init.body);
      assert.equal(body.model, model);
      assert.equal(body.size, '1024x1024');
      assert.equal(body.reference_images, reference, 'edited and generated results travel through existing canvas edges');
    } else {
      assert.equal(request.url, 'https://fixture-official.invalid/official/edit');
      assert.ok(request.init.body instanceof FormData);
      assert.equal(request.init.body.get('model'), model);
      assert.equal(request.init.body.get('size'), '1024x1024');
      assert.equal(await request.init.body.get('image[]').text(), Buffer.from(reference.split(',')[1], 'base64').toString());
    }
  }
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.status === 'completed' && task.apiConfigId === channel));
  assert.equal(persisted.length, 2);
  assert.equal(nodes.find((node) => node.id === 'downstream').data.imageUrl, generatedImage);
  assert.ok(edges.every((edge) => edge.animated === false));
}

(async () => {
  for (const channel of ['relay', 'official']) {
    await runFlow(channel);
    await runFlow(channel, true);
  }
  console.log('Media canvas flow: edited reference -> per-channel request -> persisted output -> downstream reference; missing profile makes zero requests PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
