// Opt-in 129 MiB end-to-end coordinator test. All records and service objects
// are synthetic and in memory; it never accesses a real account or network.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {readFileSync} = require('node:fs');
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
const safety = load('cloud-project-safety'), resource = load('resource');
const chunks = load('cloud-portable-chunks', {'./cloud-project-safety': safety});
const portable = load('cloud-portable-assets', {'./cloud-project-safety': safety, './cloud-portable-chunks': chunks});
const media = load('cloud-project-media', {'./cloud-project-safety': safety, './resource': resource});
const barrier = load('storage-write-barrier');
const transaction = load('backup-restore-transaction', {'./storage-write-barrier': barrier});
const {syncCloudProject, restoreCloudProjectAsNew} = load('cloud-project-sync', {
  './cloud-project-media': media, './backup-restore-transaction': transaction,
  './cloud-portable-assets': portable, './cloud-portable-chunks': chunks,
});

test('129 MiB synthetic portable binding uploads and restores through coordinator',
  {skip: process.env.STARCANVAS_TEST_LARGE_SYNC !== '1', timeout: 180000}, async () => {
    const source = Buffer.alloc(129 * 1024 * 1024, 0x5a);
    const sourceUrl = `data:video/mp4;base64,${source.toString('base64')}`;
    const localRef = 'project-asset-v2-proj-synthetic-node-video';
    const records = new Map([[localRef, sourceUrl]]), blobs = new Map(), staged = new Map();
    let snapshot, uploads = 0, downloads = 0;
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const bridge = async payload => {
      const op = payload.operation;
      if (op === 'begin') return {ok: true, handle: 'session', accountId: 'synthetic-account'};
      if (op === 'end') return {ok: true};
      if (op === 'portable-chunks-begin') {
        const id = crypto.randomUUID(); staged.set(id, {parts: [], size: payload.size, offset: 0});
        return {ok: true, id, chunkBytes: 1024 * 1024};
      }
      if (op === 'portable-chunks-append') {
        const item = staged.get(payload.chunkHandle); assert.equal(payload.offset, item.offset);
        assert(payload.bytes.length <= 1024 * 1024);
        item.parts.push(Buffer.from(payload.bytes)); item.offset += payload.bytes.length;
        return {ok: true, offset: item.offset};
      }
      if (op === 'portable-chunks-upload') {
        const item = staged.get(payload.chunkHandle), bytes = Buffer.concat(item.parts);
        assert.equal(bytes.length, item.size); const sha256 = hash(bytes);
        blobs.set(sha256, bytes); staged.delete(payload.chunkHandle); uploads++;
        return {ok: true, sha256, size: bytes.length};
      }
      if (op === 'portable-chunks-download') {
        const bytes = blobs.get(payload.sha256); assert.equal(bytes.length, payload.size);
        const id = crypto.randomUUID(); staged.set(id, {bytes, offset: 0}); downloads++;
        return {ok: true, id, sha256: payload.sha256, size: bytes.length, chunkBytes: 1024 * 1024};
      }
      if (op === 'portable-chunks-read') {
        const item = staged.get(payload.chunkHandle); assert.equal(item.offset, payload.offset);
        const bytes = item.bytes.subarray(item.offset, Math.min(item.offset + 1024 * 1024, item.bytes.length));
        item.offset += bytes.length; return {ok: true, bytes, offset: item.offset};
      }
      if (op === 'portable-chunks-abort') { staged.delete(payload.chunkHandle); return {ok: true}; }
      if (op === 'upload-state') {
        const bytes = Buffer.from(JSON.stringify(payload.state)), sha256 = hash(bytes); blobs.set(sha256, bytes);
        return {ok: true, sha256, size: bytes.length, removedSecretFields: 0};
      }
      if (op === 'commit') { snapshot = {...payload.snapshot, revision: 1}; return {ok: true, projectId: snapshot.projectId, revision: 1}; }
      if (op === 'read') return {ok: true, ...snapshot};
      if (op === 'read-state') return {ok: true, state: JSON.parse(blobs.get(payload.sha256).toString())};
      throw new Error(`UNEXPECTED_SYNTHETIC_OPERATION:${op}`);
    };
    const storage = {async keys() { return [...records.keys()]; }, async getItem(key) { return records.get(key) ?? null; },
      async setItem(key, value) { records.set(key, value); }, async removeItem(key) { records.delete(key); }};
    const state = {nodes: [{id: 'n', data: {projectAssetBindings: {videoUrl: {
      portableDataRef: localRef, kind: 'video', mime: 'video/mp4', originalName: 'synthetic.mp4',
    }}}}], edges: []};
    const withLock = async (_key, fn) => fn();
    const synced = await syncCloudProject({bridge, storage, localProjectId: 'proj-synthetic', projectName: 'Synthetic',
      state, getCurrentState: async () => state, withLock});
    assert.equal(synced.dirty, false); assert.equal(uploads, 1);
    const chromeData = {};
    const chromeStorage = {get(keys, cb) { cb(Object.fromEntries(keys.filter(k => Object.hasOwn(chromeData, k)).map(k => [k, chromeData[k]]))); },
      set(values, cb) { Object.assign(chromeData, values); cb?.(); }, remove(keys, cb) { keys.forEach(k => delete chromeData[k]); cb?.(); }};
    await restoreCloudProjectAsNew({bridge, storage, chromeStorage, remoteId: synced.remoteId,
      newProjectId: 'recovered-large', withLock});
    const recovered = records.get('canvas-state-v1-recovered-large').nodes[0].data.projectAssetBindings.videoUrl;
    assert.notEqual(recovered.portableDataRef, localRef);
    assert.equal(records.get(recovered.portableDataRef), sourceUrl);
    assert.equal(records.get(localRef), sourceUrl);
    assert.equal(downloads, 1); assert.equal(staged.size, 0);
  });
