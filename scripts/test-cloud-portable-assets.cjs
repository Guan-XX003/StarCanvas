const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  const js = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : original(id);
  mod._compile(js, filename); return mod.exports;
}
const safety = load('cloud-project-safety');
const chunks = load('cloud-portable-chunks', {'./cloud-project-safety': safety});
const {collectCloudPortableAssets, preparePortableReferences, cloudPortableReferences, restorePortableReferences} =
  load('cloud-portable-assets', {'./cloud-project-safety': safety, './cloud-portable-chunks': chunks});
const ref = 'project-asset-v2-proj-node-root-imageUrl';
const value = 'data:image/png;base64,' + Buffer.from('synthetic bytes').toString('base64');
const storage = entries => ({getItem: async key => entries[key] ?? null});

test('discovers nested refs once, returns exact bytes and hash without modifying the project', async () => {
  const input = {nodes: [{data: {imageUrlRef: ref, imageUrl: value, nested: [{thumbnailRef: ref}]}}], edges: []};
  const original = structuredClone(input);
  const assets = await collectCloudPortableAssets(input, storage({[ref]: value}));
  assert.equal(assets.length, 1);
  assert.equal(assets[0].mime, 'image/png');
  assert.deepEqual(Buffer.from(assets[0].bytes), Buffer.from('synthetic bytes'));
  assert.equal(assets[0].sha256, crypto.createHash('sha256').update('synthetic bytes').digest('hex'));
  assert.deepEqual(input, original);
});

test('missing, changed, malformed or noncanonical data refuses to prepare', async () => {
  const state = {nodes: [{data: {imageUrlRef: ref, imageUrl: value}}], edges: []};
  for (const candidate of [null, 'data:image/png;base64,eA=', 'blob:ephemeral', 'data:image/png;base64,']) {
    await assert.rejects(collectCloudPortableAssets(state, storage({[ref]: candidate})));
  }
  await assert.rejects(collectCloudPortableAssets(state, storage({[ref]: 'data:image/png;base64,eA=='})),
    error => error.code === 'STALE_MEDIA_BINDING');
});

test('does not invoke getters and detects cycles', async () => {
  let read = false;
  const data = {};
  Object.defineProperty(data, 'imageUrlRef', {enumerable: true, get() { read = true; return ref; }});
  await assert.rejects(collectCloudPortableAssets(data, storage({})), error => error.code === 'INVALID_PROJECT_VALUE');
  assert.equal(read, false);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(collectCloudPortableAssets(cyclic, storage({})), error => error.code === 'CYCLIC_PROJECT');
});

test('portable-only binding survives cloud conversion and restores a fresh local binding', async () => {
  const state = {nodes: [{data: {projectAssetBindings: {imageUrl: {
    field: 'imageUrl', portableDataRef: ref, kind: 'image', mime: 'image/png', originalName: 'image.png',
    valueFormat: 'data-url', sourceSignature: 'local-only'
  }}}}], edges: []};
  const original = structuredClone(state);
  const assets = await collectCloudPortableAssets(state, storage({[ref]: value}));
  const cloud = preparePortableReferences(state, assets);
  const data = cloud.nodes[0].data;
  assert.equal(data.projectAssetBindings, undefined);
  assert.ok(data.imageUrlRef.startsWith('starcanvas-cloud-portable:'));
  assert.equal(data.cloudPortableBindings.imageUrl.originalName, 'image.png');
  assert.equal(JSON.stringify(cloud).includes(ref), false);
  assert.equal(JSON.stringify(cloud).includes('local-only'), false);
  assert.deepEqual(state, original);
  const [entry] = cloudPortableReferences(cloud);
  const restored = restorePortableReferences(cloud, 'recovered-safe',
    new Map([[`starcanvas-cloud-portable:${entry.sha256}:${entry.mime}`, value]]));
  const binding = restored.state.nodes[0].data.projectAssetBindings.imageUrl;
  assert.equal(binding.portableDataRef, restored.state.nodes[0].data.imageUrlRef);
  assert.notEqual(binding.portableDataRef, ref);
  assert.equal(binding.originalName, 'image.png');
  assert.equal(restored.stored.get(binding.portableDataRef), value);
});

test('portable binding conflicts and malformed cloud metadata fail closed', async () => {
  const state = {nodes: [{data: {imageUrlRef: 'project-asset-v2-other',
    projectAssetBindings: {imageUrl: {portableDataRef: ref}}}}], edges: []};
  await assert.rejects(collectCloudPortableAssets(state, storage({[ref]: value})),
    error => error.code === 'STALE_MEDIA_BINDING');
  const good = {nodes: [{data: {projectAssetBindings: {imageUrl: {portableDataRef: ref}}}}], edges: []};
  const cloud = preparePortableReferences(good, await collectCloudPortableAssets(good, storage({[ref]: value})));
  const marker = cloud.nodes[0].data.imageUrlRef;
  cloud.nodes[0].data.cloudPortableBindings.imageUrl.secret = 'not-allowed';
  assert.throws(() => restorePortableReferences(cloud, 'recovered-safe', new Map([[marker, value]])),
    error => error.code === 'INVALID_MEDIA_REFERENCE');
});
