// Real Electron renderer + IndexedDB, isolated profiles and synthetic in-memory service.
// No installed app, user project, account, paid API, or public network is used.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {app, BrowserWindow, ipcMain} = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-cloud-idb-native-'));
app.setPath('userData', path.join(root, 'profile'));
const blobs = new Map(), snapshots = new Map(), chunkSessions = new Map();
let revision = 0;
let chunkUploads = 0, chunkDownloads = 0;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
ipcMain.handle('synthetic-cloud-test', async (_event, payload) => {
  const {operation} = payload;
  if (operation === 'begin') return {ok: true, handle: 'synthetic', accountId: 'qa-account'};
  if (operation === 'end') return {ok: true};
  if (operation === 'portable-chunks-begin') {
    const id = crypto.randomUUID(); chunkSessions.set(id, {parts: [], offset: 0, size: payload.size});
    return {ok:true,id,chunkBytes:1024*1024};
  }
  if (operation === 'portable-chunks-append') {
    const item = chunkSessions.get(payload.chunkHandle); assert.equal(payload.offset,item.offset);
    item.parts.push(Buffer.from(payload.bytes)); item.offset += payload.bytes.length;
    return {ok:true,offset:item.offset};
  }
  if (operation === 'portable-chunks-upload') {
    const item = chunkSessions.get(payload.chunkHandle), bytes = Buffer.concat(item.parts);
    assert.equal(bytes.length,item.size); const sha256=hash(bytes); blobs.set(sha256,bytes);
    chunkUploads++; chunkSessions.delete(payload.chunkHandle); return {ok:true,sha256,size:bytes.length};
  }
  if (operation === 'portable-chunks-download') {
    const bytes=blobs.get(payload.sha256); assert(bytes && bytes.length===payload.size && hash(bytes)===payload.sha256);
    const id=crypto.randomUUID(); chunkSessions.set(id,{bytes,offset:0}); chunkDownloads++;
    return {ok:true,id,sha256:payload.sha256,size:bytes.length,chunkBytes:1024*1024};
  }
  if (operation === 'portable-chunks-read') {
    const item=chunkSessions.get(payload.chunkHandle); assert.equal(payload.offset,item.offset);
    const bytes=item.bytes.subarray(item.offset,Math.min(item.offset+1024*1024,item.bytes.length));
    item.offset+=bytes.length; return {ok:true,bytes,offset:item.offset};
  }
  if (operation === 'portable-chunks-abort') { chunkSessions.delete(payload.chunkHandle); return {ok:true}; }
  if (operation === 'upload-portable-asset') {
    const bytes = Buffer.from(payload.bytes);
    assert.equal(hash(bytes), payload.sha256); blobs.set(payload.sha256, bytes);
    return {ok: true, sha256: payload.sha256, size: bytes.length};
  }
  if (operation === 'upload-state') {
    const bytes = Buffer.from(JSON.stringify(payload.state)), sha256 = hash(bytes);
    blobs.set(sha256, bytes); return {ok: true, sha256, size: bytes.length, removedSecretFields: 0};
  }
  if (operation === 'commit') {
    const snapshot = payload.snapshot;
    assert.equal(snapshot.baseRevision, revision);
    for (const ref of [snapshot.state, ...snapshot.assets.map(asset => asset.blob)]) assert(blobs.has(ref.sha256));
    const result = {...snapshot, revision: ++revision}; snapshots.set(snapshot.projectId, result);
    return {ok: true, projectId: snapshot.projectId, revision};
  }
  if (operation === 'read') return {ok: true, ...snapshots.get(payload.projectId)};
  if (operation === 'read-state') return {ok: true, state: JSON.parse(blobs.get(payload.sha256).toString('utf8'))};
  if (operation === 'download-portable-asset') {
    const bytes = blobs.get(payload.sha256);
    assert(bytes && bytes.length === payload.size && hash(bytes) === payload.sha256);
    return {ok: true, bytes, sha256: payload.sha256, size: bytes.length};
  }
  throw new Error('UNEXPECTED_SYNTHETIC_OPERATION');
});

app.whenReady().then(async () => {
  const {createServer} = await import('vite');
  const tinyChunkPlugin = {name:'synthetic-tiny-chunk-threshold', enforce:'pre', transform(code,id) {
    if (process.env.STARCANVAS_TEST_TINY_CHUNKS !== '1' || !/cloud-(?:portable-assets|project-sync)\.ts$/.test(id)) return null;
    assert.equal(code.split('128 * 1024 * 1024').length,2);
    return {code:code.replace('128 * 1024 * 1024','16'),map:null};
  }};
  const vite = await createServer({configFile: false, root: path.resolve(__dirname, '..'), plugins:[tinyChunkPlugin],
    server: {middlewareMode: true, hmr: false}, appType: 'custom', logLevel: 'error'});
  const server = http.createServer((req, res) => {
    if (req.url === '/qa.html') {
      res.writeHead(200, {'Content-Type': 'text/html'});
      return res.end('<!doctype html><script src="/node_modules/localforage/dist/localforage.js"></script>');
    }
    vite.middlewares(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/qa.html`;
  const windows = [];
  try {
    for (const partition of ['source', 'destination']) {
      const win = new BrowserWindow({show: false, webPreferences: {partition: `qa-${partition}-${crypto.randomUUID()}`,
        preload: path.join(__dirname, 'test-cloud-idb-native-preload.cjs'), contextIsolation: true, nodeIntegration: false}});
      windows.push(win); await win.loadURL(url);
    }
    const first = await windows[0].webContents.executeJavaScript(`(async () => {
      const api = await import('/src/renderer/lib/cloud-project-sync.ts');
      const storage = window.localforage.createInstance({name:'synthetic-source'});
      await storage.setDriver(window.localforage.INDEXEDDB);
      const ref = 'project-asset-v2-proj-synthetic-node-thumbnail';
      const boundRef = 'project-asset-v2-proj-synthetic-node-preview';
      const data = 'data:image/png;base64,' + btoa('synthetic-indexeddb-bytes');
      await storage.setItem(ref, data);
      await storage.setItem(boundRef, data);
      const state = {nodes:[{id:'n',data:{nested:[{thumbnailRef:ref,thumbnail:data}],
        projectAssetBindings:{previewUrl:{portableDataRef:boundRef,kind:'image',originalName:'preview.png'}}}}],edges:[]};
      const result = await api.syncCloudProject({bridge:window.syntheticCloudBridge,storage,localProjectId:'proj-synthetic',
        projectName:'Synthetic',state,getCurrentState:async()=>state,withLock:async(_n,f)=>f()});
      return {driver:storage.driver(),result,sourceUnchanged:(await storage.getItem(ref))===data};
    })()`);
    assert.equal(first.driver, 'asyncStorage'); assert.equal(first.result.revision, 1);
    assert.equal(first.result.dirty, false); assert.equal(first.sourceUnchanged, true);
    const second = await windows[1].webContents.executeJavaScript(`(async () => {
      const api = await import('/src/renderer/lib/cloud-project-sync.ts');
      const storage = window.localforage.createInstance({name:'synthetic-destination'});
      await storage.setDriver(window.localforage.INDEXEDDB);
      const chromeData = {};
      const chromeStorage = {get(keys,cb){cb(Object.fromEntries(keys.filter(k=>Object.hasOwn(chromeData,k)).map(k=>[k,chromeData[k]])));},
        set(values,cb){Object.assign(chromeData,structuredClone(values));cb?.();},remove(keys,cb){keys.forEach(k=>delete chromeData[k]);cb?.();}};
      await storage.setItem('canvas-state-v1-proj-existing',{untouched:true});
      const result = await api.restoreCloudProjectAsNew({bridge:window.syntheticCloudBridge,storage,chromeStorage,
        remoteId:${JSON.stringify(first.result.remoteId)},newProjectId:'recovered-synthetic',withLock:async(_n,f)=>f()});
      const state = await storage.getItem('canvas-state-v1-recovered-synthetic');
      const ref = state.nodes[0].data.nested[0].thumbnailRef;
      const binding = state.nodes[0].data.projectAssetBindings.previewUrl;
      return {driver:storage.driver(),result,ref,value:await storage.getItem(ref),binding,
        bindingRef:state.nodes[0].data.previewUrlRef,bindingValue:await storage.getItem(binding.portableDataRef),
        existing:await storage.getItem('canvas-state-v1-proj-existing')};
    })()`);
    assert.equal(second.driver, 'asyncStorage'); assert.equal(second.result.revision, 1);
    assert(second.ref.startsWith('project-asset-v2-recovered-synthetic-'));
    assert.equal(second.value, 'data:image/png;base64,' + Buffer.from('synthetic-indexeddb-bytes').toString('base64'));
    assert.equal(second.bindingRef, second.binding.portableDataRef);
    assert.equal(second.binding.originalName, 'preview.png');
    assert.equal(second.bindingValue, second.value);
    assert.equal(chunkSessions.size, 0);
    if (process.env.STARCANVAS_TEST_TINY_CHUNKS === '1') { assert(chunkUploads > 0); assert(chunkDownloads > 0); }
    assert.deepEqual(second.existing, {untouched:true});
    console.log(JSON.stringify({status:'PASS_ELECTRON_REAL_INDEXEDDB_CROSS_PARTITION_SYNTHETIC_SERVICE',
      nativeIndexedDB:true, separatePartitions:true, sourceUnchanged:true, restoredBytesMatch:true,
      realUserData:false, realBackend:false, installerTested:false, releaseReady:false}));
  } finally {
    windows.forEach(win => { if (!win.isDestroyed()) win.destroy(); });
    await new Promise(resolve => server.close(resolve)); await vite.close();
  }
  app.quit();
}).catch(error => { console.error('SYNTHETIC_NATIVE_IDB_FAILED', error?.message || 'unknown'); app.exit(1); });
