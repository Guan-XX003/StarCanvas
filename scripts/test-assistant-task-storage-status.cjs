const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../electron/preload/storage.cjs'), 'utf8');
async function expectAbort(promise, message) {
  let timer;
  try {
    const bounded = Promise.race([promise, new Promise((_,reject) => {timer=setTimeout(() => reject(Error('TIMEOUT_WAITING_FOR_ABORT')),500);})]);
    await assert.rejects(bounded,/aborted/,message);
  } finally {clearTimeout(timer);}
}

function fixture({readFails = false, readAborts = false, writeAborts = false, migrationFails = false, legacy = '{}', legacyReadFails = false} = {}) {
  const module = {exports: {}};
  const records = {globalTasks: [{status: 'running'}]};
  let writes = 0;
  let removals = 0;
  const db = {
    transaction(_store, mode) {
      const transaction = {error: new Error('SYNTHETIC_STORAGE_FAILURE')};
      transaction.objectStore = () => ({
        get(key) {
          const request = {};
          queueMicrotask(() => {
            if (readFails && key === 'globalTasks') {
              request.error = transaction.error;
              request.onerror();
            } else {
              request.result = records[key];
              request.onsuccess();
            }
          });
          return request;
        },
        openCursor() { const request = {}; queueMicrotask(() => { request.result = null; request.onsuccess(); }); return request; },
        put() { writes++; },
        delete() {},
        clear() {},
      });
      if (mode === 'readwrite') queueMicrotask(() => {if (writeAborts) {transaction.error = null;transaction.onabort();} else migrationFails ? transaction.onerror() : transaction.oncomplete();});
      else setTimeout(() => {if (readAborts) {transaction.error = null;transaction.onabort();} else transaction.oncomplete();}, 0);
      return transaction;
    },
  };
  const window = {
    indexedDB: {open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; }},
    localStorage: {getItem() { if (legacyReadFails) throw Error('SYNTHETIC_LEGACY_READ_FAILURE'); return legacy; }, removeItem() { removals++; }, setItem() { throw Error('UNEXPECTED_WRITE'); }},
  };
  const constants = {STORAGE_KEY:'legacy', STORAGE_DB_NAME:'synthetic', STORAGE_DB_VERSION:1, STORAGE_DB_STORE:'values'};
  vm.runInNewContext(source, {module, window, queueMicrotask, console: {warn() {}}, require(name) {
    if (name === './constants.cjs') return constants;
    if (name === './runtime.cjs') return {ipcRenderer: {invoke: async () => ({active: false})}};
    if (name === './boot-theme.cjs') return {mirrorBootThemeFromStore() {}};
    if (name === './chrome-shim.cjs') return {pickStorage(keys, store) {
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, store[key]]));
      return {};
    }};
    throw Error('UNEXPECTED_REQUIRE: ' + name);
  }});
  return {storage: module.exports, getWrites: () => writes, getRemovals: () => removals};
}

(async () => {
  const good = fixture();
  const successful = await good.storage.getDesktopStorageItemsWithStatus(['globalTasks']);
  assert.equal(successful.reliable, true);
  assert.equal(successful.values.globalTasks[0].status, 'running');
  assert.equal((await good.storage.getDesktopStorageItems(['globalTasks'])).globalTasks[0].status, 'running');

  const failed = fixture({readFails: true});
  const fallback = await failed.storage.getDesktopStorageItemsWithStatus(['globalTasks']);
  assert.equal(fallback.reliable, false);
  assert.equal(fallback.values.globalTasks, undefined);
  assert.equal((await failed.storage.getDesktopStorageItems(['globalTasks'])).globalTasks, undefined);
  assert.equal(failed.getWrites(), 0, 'fallback inspection must not write');

  const aborted = fixture({readAborts: true});
  const abortedRead = await aborted.storage.getDesktopStorageItemsWithStatus(['globalTasks']);
  assert.equal(abortedRead.reliable, false, 'a successful request followed by an abort is not a successful read');
  await expectAbort(aborted.storage.getIndexedDesktopStorage(), 'an all-keys read abort must settle');

  for (const [method,args] of [['setIndexedDesktopStorageItems',[{synthetic:true}]],['removeIndexedDesktopStorageItems',['synthetic']],['clearIndexedDesktopStorage',[]]]) {
    const abortedWrite=fixture({writeAborts:true});
    await expectAbort(abortedWrite.storage[method](...args), `${method}: transaction abort must settle`);
  }

  const migration = fixture({migrationFails: true, legacy: '{"globalTasks":[{"status":"failed"}]}'});
  const migrated = await migration.storage.getDesktopStorageItemsWithStatus(['globalTasks']);
  assert.equal(migrated.reliable, false, 'failed legacy migration cannot prove the list is complete');
  assert.equal(migrated.values.globalTasks[0].status, 'running', 'legacy get behavior remains unchanged');
  assert.equal(migration.getWrites(), 1);

  for (const options of [{legacy: '{not-json'}, {legacy: 'null'}, {legacy: '[{"status":"failed"}]'}, {legacy: '"synthetic"'}, {legacyReadFails: true}]) {
    const brokenLegacy = fixture(options);
    const read = await brokenLegacy.storage.getDesktopStorageItemsWithStatus(['globalTasks']);
    assert.equal(read.reliable, false, 'an unreadable or malformed legacy mirror makes task history uncertain');
    assert.equal(read.values.globalTasks[0].status, 'running', 'ordinary keyed result remains unchanged');
    assert.equal(brokenLegacy.getWrites(), 0, 'invalid legacy mirror is not overwritten');
    assert.equal(brokenLegacy.getRemovals(), 0, 'invalid legacy mirror is retained');
  }

  const concurrent = fixture({readFails: true});
  const [ok, no] = await Promise.all([
    concurrent.storage.getDesktopStorageItemsWithStatus(['other']),
    concurrent.storage.getDesktopStorageItemsWithStatus(['globalTasks']),
  ]);
  assert.equal(ok.reliable, true);
  assert.equal(no.reliable, false, 'per-read status cannot be overwritten by a concurrent success');
  console.log('assistant task storage provenance: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
