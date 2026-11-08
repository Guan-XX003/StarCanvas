// Explicitly opted-in synthetic E2E against an isolated loopback account service.
// This does not exercise a packaged Electron window or real OS secret storage.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const target = process.env.STARCANVAS_SYNTHETIC_ACCOUNT_URL || '';
const isolatedContainerTarget = process.env.STARCANVAS_SYNTHETIC_CONTAINER_CONFIRM === '1' && target === 'http://127.0.0.1:8080';
if (process.env.STARCANVAS_SYNTHETIC_ACCOUNT_CONFIRM !== '1' ||
    (!/^http:\/\/127\.0\.0\.1:185[0-9]{2}$/.test(target) && !isolatedContainerTarget)) {
  throw new Error('SYNTHETIC_LOOPBACK_SCOPE_REQUIRED');
}
function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  let source = readFileSync(filename, 'utf8');
  if (process.env.STARCANVAS_TEST_TINY_CHUNKS === '1' && ['cloud-portable-assets', 'cloud-project-sync'].includes(name)) {
    assert.equal(source.split('128 * 1024 * 1024').length, 2);
    source = source.replace('128 * 1024 * 1024', '16');
  }
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const previous = mod.require.bind(mod);
  mod.require = (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : previous(id);
  mod._compile(js, filename); return mod.exports;
}
const safety = load('cloud-project-safety'), resource = load('resource');
const portableChunks = load('cloud-portable-chunks', {'./cloud-project-safety': safety});
const portableMedia = load('cloud-portable-assets', {'./cloud-project-safety': safety, './cloud-portable-chunks': portableChunks});
const media = load('cloud-project-media', { './cloud-project-safety': safety, './resource': resource });
const barrier = load('storage-write-barrier');
const restore = load('backup-restore-transaction', { './storage-write-barrier': barrier });
const { syncCloudProject, restoreCloudProjectAsNew } = load('cloud-project-sync', {
  './cloud-project-media': media, './backup-restore-transaction': restore,
  './cloud-portable-assets': portableMedia, './cloud-portable-chunks': portableChunks,
});

test('real account HTTP and synthetic project upload/restore', async (t) => {
  const temp = await fsp.realpath(await fsp.mkdtemp(path.join(await fsp.realpath(os.tmpdir()), 'sc-cloud-live-')));
  const mediaRoot = path.join(temp, 'media'), stagingRoot = path.join(temp, 'stage'), projectId = 'proj-synthetic-live';
  await fsp.mkdir(path.join(mediaRoot, projectId, 'assets'), { recursive: true });
  await fsp.mkdir(path.join(mediaRoot, '_projects'), { recursive: true });
  await fsp.mkdir(stagingRoot, { mode: 0o700 });
  const localPath = path.join(mediaRoot, projectId, 'assets', 'sample.png');
  const bytes = Buffer.from('synthetic cloud media only');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await fsp.writeFile(localPath, bytes);
  await fsp.writeFile(path.join(mediaRoot, '_projects', `${projectId}.json`), JSON.stringify({ projectId, complete: true, references: [localPath] }));
  const fakeElectron = { app: { getPath: () => temp, getVersion: () => 'test', isPackaged: false },
    safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
      decryptStringAsync: async (buffer) => ({ result: buffer.toString().replace(/^encrypted:/, ''), shouldReEncrypt: false }) } };
  const oldLoad = Module._load, oldUrl = process.env.WANJUAN_ACCOUNT_API_URL;
  Module._load = function (request, parent, main) {
    if (request === 'electron' || request === 'electron/main') return fakeElectron;
    if (request === 'selfsigned') return { generate: () => { throw new Error('not used'); } };
    if (request === './account-device.cjs' && isolatedContainerTarget) {
      const device = oldLoad.call(this, request, parent, main);
      return { ...device, readOrCreateAccountDevice: (userDataPath, options) =>
        device.readOrCreateAccountDevice(userDataPath, { ...options, platform: 'win32' }) };
    }
    return oldLoad.call(this, request, parent, main);
  };
  const account = require('../electron/main/account-service.cjs');
  const { createCloudProjectBridge } = require('../electron/main/cloud-project-bridge.cjs');
  Module._load = oldLoad;
  process.env.WANJUAN_ACCOUNT_API_URL = target;
  t.after(async () => {
    if (oldUrl === undefined) delete process.env.WANJUAN_ACCOUNT_API_URL; else process.env.WANJUAN_ACCOUNT_API_URL = oldUrl;
    await fsp.rm(temp, { recursive: true, force: true });
  });
  const login = await account.loginAccount({ identifier: 'qa-cloud-client@example.com', password: 'synthetic-password-2026' });
  assert.equal(login.authenticated, true);
  const bridge = createCloudProjectBridge({ enabled: true, mediaRoot, stagingRoot });
  let chunkUploads = 0, chunkDownloads = 0;
  const invoke = async (payload) => {
    if (payload.operation === 'portable-chunks-upload') chunkUploads++;
    if (payload.operation === 'portable-chunks-download') chunkDownloads++;
    try { return { ok: true, ...(await bridge.invoke(payload)) }; }
    catch (error) { return { ok: false, code: error.code || 'CLOUD_PROJECT_FAILED' }; }
  };
  const url = resource.buildProjectMediaFileUrl(localPath);
  const portableRef = 'project-asset-v2-proj-synthetic-live-node-nested';
  const large = process.env.STARCANVAS_TEST_LARGE_LIVE === '1';
  if (large && !isolatedContainerTarget) throw new Error('LARGE_TEST_REQUIRES_ISOLATED_CONTAINER');
  const portableValue = 'data:image/png;base64,' + (large ? Buffer.alloc(129 * 1024 * 1024, 0x5a) : Buffer.from('synthetic idb bytes')).toString('base64');
  const canvas = { nodes: [{ id: 'synthetic', data: { prompt: 'synthetic only', imageUrl: url,
    nested: [{thumbnailRef: portableRef, thumbnail: portableValue}],
    textApiKey: 'private-synthetic', projectId, projectAssetBindings: { imageUrl: {
      localPath, sha256, size: bytes.length, mime: 'image/png', kind: 'image', filename: 'sample.png', sourceSignature: url,
    } } } }], edges: [] };
  const records = new Map();
  const storage = { async keys() { return [...records.keys()]; },
    async getItem(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async setItem(key, value) { records.set(key, structuredClone(value)); }, async removeItem(key) { records.delete(key); } };
  records.set(portableRef, portableValue);
  const withLock = async (_name, fn) => fn();
  const synced = await syncCloudProject({ bridge: invoke, storage, localProjectId: projectId, projectName: 'Synthetic QA',
    state: canvas, getCurrentState: async () => canvas, withLock });
  assert.equal(synced.revision, 1);
  assert.equal(synced.dirty, false);
  assert.ok(synced.removedSecretFields > 0);
  const chromeValues = { projects: [{ id: projectId, name: 'Original' }] };
  const chromeStorage = { get(keys, callback) { callback(Object.fromEntries(keys.filter((k) => Object.hasOwn(chromeValues, k)).map((k) => [k, chromeValues[k]]))); },
    set(values, callback) { Object.assign(chromeValues, structuredClone(values)); callback?.(); },
    remove(keys, callback) { for (const key of keys) delete chromeValues[key]; callback?.(); } };
  const restored = await restoreCloudProjectAsNew({ bridge: invoke, storage, chromeStorage, remoteId: synced.remoteId,
    newProjectId: 'recovered-synthetic-live', withLock });
  assert.equal(restored.revision, 1);
  const newCanvas = records.get('canvas-state-v1-recovered-synthetic-live');
  assert.equal(newCanvas.nodes[0].data.prompt, 'synthetic only');
  assert.equal('textApiKey' in newCanvas.nodes[0].data, false);
  assert.deepEqual(await fsp.readFile(newCanvas.nodes[0].data.projectAssetBindings.imageUrl.localPath), bytes);
  const recoveredRef = newCanvas.nodes[0].data.nested[0].thumbnailRef;
  assert.notEqual(recoveredRef, portableRef);
  assert.equal(records.get(recoveredRef), portableValue);
  assert.equal(records.get(portableRef), portableValue);
  if (process.env.STARCANVAS_TEST_TINY_CHUNKS === '1' || large) { assert(chunkUploads > 0); assert(chunkDownloads > 0); }
  assert.deepEqual(chromeValues.projects.map((p) => p.id), [projectId, 'recovered-synthetic-live']);
  await account.logoutAccount();
});
