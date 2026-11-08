import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "starcanvas-backup-tx-"));
const makeLocal = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    async keys() { return [...values.keys()]; },
    async getItem(key) { return values.get(key); },
    async setItem(key, value) { values.set(key, structuredClone(value)); },
    async removeItem(key) { values.delete(key); },
    values,
  };
};
const makeChrome = (initial = {}) => {
  const values = { ...initial };
  return {
    values,
    get(keys, callback) {
      const requested = Array.isArray(keys) ? keys : Object.keys(values);
      callback(Object.fromEntries(requested.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).map((key) => [key, values[key]])));
    },
    set(next, callback) { Object.assign(values, structuredClone(next)); callback?.(); },
    remove(keys, callback) { for (const key of keys) delete values[key]; callback?.(); },
  };
};

try {
  execFileSync("npx", ["tsc", "--skipLibCheck", "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--esModuleInterop", "--outDir", outDir, join(root, "src/renderer/lib/backup-restore-transaction.ts")], { cwd: root, stdio: "inherit" });
  const { runBackupRestoreTransaction, recoverBackupRestoreTransaction, BACKUP_RESTORE_JOURNAL_KEY } = await import(pathToFileURL(join(outDir, "backup-restore-transaction.js")).href);
  const { installStorageWriteBarrier, getStorageWriteBarrierState } = await import(pathToFileURL(join(outDir, "storage-write-barrier.js")).href);

  const local = makeLocal({ canvas: { old: true }, asset: "old" });
  const chrome = makeChrome({ settings: "old", removeMe: true });
  const committed = await runBackupRestoreTransaction({
    localforage: local,
    chromeStorage: chrome,
    localforageSet: new Map([["canvas", { fresh: true }], ["newAsset", "new"]]),
    localforageRemove: ["asset"],
    chromeSet: { settings: "fresh" },
    chromeRemove: ["removeMe"],
    transactionId: "happy",
  });
  assert.equal(committed.ok, true);
  assert.deepEqual(await local.getItem("canvas"), { fresh: true });
  assert.equal(await local.getItem("asset"), undefined);
  assert.deepEqual(chrome.values, { settings: "fresh" });
  assert.equal(await local.getItem(BACKUP_RESTORE_JOURNAL_KEY), undefined);

  const newProjectId = "recovered-synthetic-1", newCanvasKey = `canvas-state-v1-${newProjectId}`;
  const newMirrorKey = `desktop-canvas-state-v1-${newProjectId}`;
  const cloudLocal = makeLocal({ "canvas-state-v1-existing": { untouched: true } });
  const cloudChrome = makeChrome({ projects: [{ id: "proj-existing", name: "Existing" }] });
  const cloudRestore = {
    localforage: cloudLocal, chromeStorage: cloudChrome,
    localforageSet: new Map([[newCanvasKey, { nodes: [], edges: [] }]]),
    requireAbsentLocalKeys: [newCanvasKey], chromeSet: { [newMirrorKey]: { nodes: [], edges: [] } },
    requireAbsentChromeKeys: [newMirrorKey], appendNewProject: { id: newProjectId, name: "恢复项目", groupId: "" },
    transactionId: "cloud-new-project",
  };
  assert.equal((await runBackupRestoreTransaction(cloudRestore)).ok, true);
  assert.deepEqual(await cloudLocal.getItem("canvas-state-v1-existing"), { untouched: true });
  assert.deepEqual(cloudChrome.values.projects.map((project) => project.id), ["proj-existing", newProjectId]);
  await assert.rejects(() => runBackupRestoreTransaction(cloudRestore), /CLOUD_LOCAL_PROJECT_EXISTS/);
  assert.deepEqual(cloudChrome.values.projects.map((project) => project.id), ["proj-existing", newProjectId]);

  for (const initial of [{}, { projects: [] }]) {
    const freshLocal = makeLocal({ "canvas-state-v1-default": { untouched: true } });
    const freshChrome = makeChrome(initial);
    await runBackupRestoreTransaction({ ...cloudRestore, localforage: freshLocal, chromeStorage: freshChrome,
      transactionId: "cloud-default-project-preservation" });
    assert.deepEqual(freshChrome.values.projects.map((project) => project.id), ["default", newProjectId]);
    assert.deepEqual(await freshLocal.getItem("canvas-state-v1-default"), { untouched: true });
  }

  const cloudRollbackLocal = makeLocal();
  const cloudRollbackChrome = makeChrome({ projects: [{ id: "proj-existing", name: "Existing" }] });
  const cloudSet = cloudRollbackChrome.set.bind(cloudRollbackChrome);
  let failAppend = true;
  cloudRollbackChrome.set = (values, callback) => {
    if (values.projects && failAppend) { failAppend = false; throw new Error("synthetic cloud restore failure"); }
    cloudSet(values, callback);
  };
  await assert.rejects(() => runBackupRestoreTransaction({ ...cloudRestore, localforage: cloudRollbackLocal,
    chromeStorage: cloudRollbackChrome, transactionId: "cloud-restore-rollback" }), /synthetic cloud restore failure/);
  assert.equal(await cloudRollbackLocal.getItem(newCanvasKey), undefined);
  assert.deepEqual(cloudRollbackChrome.values.projects, [{ id: "proj-existing", name: "Existing" }]);
  assert.equal(Object.hasOwn(cloudRollbackChrome.values, newMirrorKey), false);

  const failing = makeLocal({ canvas: "old" });
  const failingChrome = makeChrome({ settings: "old" });
  const originalSet = failing.setItem.bind(failing);
  let failLiveWrite = true;
  failing.setItem = async (key, value) => {
    if (key === "canvas" && failLiveWrite) { failLiveWrite = false; throw new Error("injected live write failure"); }
    return originalSet(key, value);
  };
  await assert.rejects(() => runBackupRestoreTransaction({
    localforage: failing,
    chromeStorage: failingChrome,
    localforageSet: new Map([["canvas", "new"]]),
    chromeSet: { settings: "new" },
    transactionId: "rollback",
  }), /injected live write failure/);
  assert.equal(await failing.getItem("canvas"), "old");
  assert.deepEqual(failingChrome.values, { settings: "old" });

  const recovery = makeLocal({
    canvas: "new",
    "wanjuan-backup-restore-tx-v1-recover-backup-0": { version: 1, exists: true, value: "old" },
    [BACKUP_RESTORE_JOURNAL_KEY]: {
      version: 1,
      id: "recover",
      phase: "applying",
      localforage: { backupKeys: { canvas: "wanjuan-backup-restore-tx-v1-recover-backup-0" }, stageKeys: {} },
      chrome: { original: { present: { settings: "old" }, absent: [] } },
    },
  });
  const recoveryChrome = makeChrome({ settings: "new" });
  const recovered = await recoverBackupRestoreTransaction({ localforage: recovery, chromeStorage: recoveryChrome });
  assert.equal(recovered.rolledBack, true);
  assert.equal(await recovery.getItem("canvas"), "old");
  assert.deepEqual(recoveryChrome.values, { settings: "old" });
  assert.equal(await recovery.getItem(BACKUP_RESTORE_JOURNAL_KEY), undefined);

  const rolledBackJournal = makeLocal({
    canvas: "old",
    "wanjuan-backup-restore-tx-v1-rolled-back-backup-0": { version: 1, exists: true, value: "old" },
    [BACKUP_RESTORE_JOURNAL_KEY]: {
      version: 1,
      id: "rolled-back",
      phase: "rolledBack",
      localforage: { backupKeys: { canvas: "wanjuan-backup-restore-tx-v1-rolled-back-backup-0" }, stageKeys: {} },
      chrome: { original: { present: { settings: "old" }, absent: [] } },
    },
  });
  const rolledBackChrome = makeChrome({ settings: "old" });
  const rolledBackRecovery = await recoverBackupRestoreTransaction({ localforage: rolledBackJournal, chromeStorage: rolledBackChrome });
  assert.equal(rolledBackRecovery.rolledBack, true);
  assert.equal(await rolledBackJournal.getItem("canvas"), "old");
  assert.equal(await rolledBackJournal.getItem(BACKUP_RESTORE_JOURNAL_KEY), undefined);

  const cleanupFailure = makeLocal({ canvas: "old" });
  const cleanupOriginalRemove = cleanupFailure.removeItem.bind(cleanupFailure);
  cleanupFailure.removeItem = async (key) => {
    if (String(key).includes("-backup-")) throw new Error("injected cleanup failure");
    return cleanupOriginalRemove(key);
  };
  const cleanupResult = await runBackupRestoreTransaction({
    localforage: cleanupFailure,
    chromeStorage: makeChrome(),
    localforageSet: new Map([["canvas", "new"]]),
    transactionId: "cleanup-failure",
  });
  assert.equal(cleanupResult.ok, true);
  assert.equal(cleanupResult.cleanupPending, true);
  assert.equal(await cleanupFailure.getItem("canvas"), "new");
  assert.equal((await cleanupFailure.getItem(BACKUP_RESTORE_JOURNAL_KEY)).phase, "committed");

  let releaseHeldWrite;
  let markHeldWrite;
  const heldWriteStarted = new Promise((resolve) => { markHeldWrite = resolve; });
  const heldWrite = new Promise((resolve) => { releaseHeldWrite = resolve; });
  const barrierLocal = makeLocal({ canvas: "original" });
  const barrierRawSet = barrierLocal.setItem.bind(barrierLocal);
  barrierLocal.setItem = async (key, value) => {
    if (key === "before-import") {
      markHeldWrite();
      await heldWrite;
    }
    return barrierRawSet(key, value);
  };
  const barrierChrome = makeChrome({ project: "original" });
  const barrierChromeObject = { runtime: { lastError: null }, storage: { local: barrierChrome } };
  installStorageWriteBarrier({ localforage: barrierLocal, chromeStorage: barrierChrome, chromeRuntime: barrierChromeObject.runtime, chromeObject: barrierChromeObject, installChromeFacade: true });
  const beforeImport = barrierLocal.setItem("before-import", "drained");
  await heldWriteStarted;
  const importRun = runBackupRestoreTransaction({
    localforage: barrierLocal,
    chromeStorage: barrierChrome,
    localforageSet: new Map([["canvas", "imported-new"]]),
    chromeSet: { project: "imported-new" },
    transactionId: "barrier-import",
  });
  while (getStorageWriteBarrierState(barrierLocal).exclusivePending === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  const staleAutosave = barrierLocal.setItem("canvas", "stale-old-react-state");
  releaseHeldWrite();
  await Promise.all([beforeImport, importRun]);
  await assert.rejects(() => staleAutosave, /STORAGE_WRITE_SUPERSEDED_BY_RESTORE/);
  assert.equal(await barrierLocal.getItem("before-import"), "drained", "already in-flight writes must drain before import");
  assert.equal(await barrierLocal.getItem("canvas"), "imported-new", "old autosave queued during import must not overwrite restored data");
  assert.equal(barrierChrome.values.project, "imported-new");
  assert.equal(getStorageWriteBarrierState(barrierLocal).generation, 1);
  assert.equal(getStorageWriteBarrierState(barrierLocal).suppressedWrites, 1);
  assert.equal(getStorageWriteBarrierState(barrierLocal).holdUntilReload, true);
  await assert.rejects(() => barrierLocal.setItem("canvas", "delayed-stale-autosave"), /STORAGE_WRITE_SUPERSEDED_BY_RESTORE/);
  assert.equal(await barrierLocal.getItem("canvas"), "imported-new", "autosave after commit but before reload must remain blocked");
  const callbackError = await new Promise((resolve) => {
    globalThis.chrome.storage.local.set({ project: "delayed-stale-chrome" }, () => resolve(globalThis.chrome.runtime.lastError));
  });
  assert.match(String(callbackError?.message || callbackError), /STORAGE_WRITE_SUPERSEDED_BY_RESTORE/);
  assert.equal(barrierChrome.values.project, "imported-new", "rejected Chrome callback write must not overwrite imported state");

  const busyLocal = makeLocal();
  const busyChrome = makeChrome();
  const busyController = installStorageWriteBarrier({ localforage: busyLocal, chromeStorage: busyChrome });
  let releaseBusy;
  const busyHold = new Promise((resolve) => { releaseBusy = resolve; });
  const firstExclusive = busyController.exclusive(async () => { await busyHold; return { ok: true }; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(() => busyController.exclusive(async () => ({ ok: true })), /STORAGE_WRITE_TRANSACTION_BUSY/);
  releaseBusy();
  await firstExclusive;

  const startupLocal = makeLocal();
  const startupChrome = makeChrome();
  const startupChromeObject = { runtime: { lastError: null }, storage: { local: startupChrome } };
  installStorageWriteBarrier({ localforage: startupLocal, chromeStorage: startupChrome, chromeRuntime: startupChromeObject.runtime, chromeObject: startupChromeObject, installChromeFacade: true });
  assert.deepEqual(await recoverBackupRestoreTransaction({ localforage: startupLocal, chromeStorage: startupChrome }), { recovered: false });
  assert.equal(getStorageWriteBarrierState(startupLocal).holdUntilReload, false, "startup with no journal must not freeze ordinary writes");
  await startupLocal.setItem("ordinary", "allowed");
  assert.equal(await startupLocal.getItem("ordinary"), "allowed");

  // Reproduce the actual cold-start race: another hook saves while journal lookup is pending.
  const startupRaceLocal = makeLocal();
  const startupRaceChrome = makeChrome();
  const rawStartupRaceGet = startupRaceLocal.getItem.bind(startupRaceLocal);
  let markJournalLookup;
  const journalLookupStarted = new Promise((resolve) => { markJournalLookup = resolve; });
  let releaseJournalLookup;
  const journalLookupGate = new Promise((resolve) => { releaseJournalLookup = resolve; });
  startupRaceLocal.getItem = async (key) => {
    if (key === BACKUP_RESTORE_JOURNAL_KEY) { markJournalLookup(); await journalLookupGate; }
    return rawStartupRaceGet(key);
  };
  const startupRaceChromeObject = { runtime: { lastError: null }, storage: { local: startupRaceChrome } };
  const startupRaceController = installStorageWriteBarrier({ localforage: startupRaceLocal, chromeStorage: startupRaceChrome, chromeRuntime: startupRaceChromeObject.runtime, chromeObject: startupRaceChromeObject, installChromeFacade: true });
  const startupRecovery = recoverBackupRestoreTransaction({ localforage: startupRaceLocal, chromeStorage: startupRaceChrome });
  await journalLookupStarted;
  const queuedFirst = startupRaceLocal.setItem("project", "first");
  const queuedSecond = startupRaceLocal.setItem("project", "latest");
  const queuedPreference = globalThis.chrome.storage.local.set({ selectedModel: "fixture" });
  const startupWritesSettled = Promise.all([queuedFirst, queuedSecond, queuedPreference]);
  releaseJournalLookup();
  assert.deepEqual(await startupRecovery, { recovered: false });
  await startupWritesSettled;
  assert.equal(await startupRaceLocal.getItem("project"), "latest", "no-journal recovery must drain ordinary saves in original order");
  assert.equal(startupRaceChrome.values.selectedModel, "fixture", "no-journal startup must preserve queued preferences");
  assert.equal(startupRaceController.getState().generation, 0, "read-only journal check is not a state replacement");
  assert.equal(startupRaceController.getState().exclusivePending, 0);
  assert.equal(startupRaceController.getState().holdUntilReload, false);

  const realRecoveryLocal = makeLocal({
    canvas: "uncommitted-import",
    "wanjuan-backup-restore-tx-v1-real-race-backup-0": { version: 1, exists: true, value: "safe-original" },
    [BACKUP_RESTORE_JOURNAL_KEY]: { version: 1, id: "real-race", phase: "applying", localforage: { backupKeys: { canvas: "wanjuan-backup-restore-tx-v1-real-race-backup-0" }, stageKeys: {} }, chrome: { original: { present: {}, absent: [] } } },
  });
  const realRawGet = realRecoveryLocal.getItem.bind(realRecoveryLocal);
  let releaseRealJournal;
  let markRealJournal;
  const realJournalStarted = new Promise((resolve) => { markRealJournal = resolve; });
  const realJournalGate = new Promise((resolve) => { releaseRealJournal = resolve; });
  realRecoveryLocal.getItem = async (key) => {
    if (key === BACKUP_RESTORE_JOURNAL_KEY) { markRealJournal(); await realJournalGate; }
    return realRawGet(key);
  };
  const realRecoveryChrome = makeChrome();
  const realController = installStorageWriteBarrier({ localforage: realRecoveryLocal, chromeStorage: realRecoveryChrome });
  const realRecoveryRun = recoverBackupRestoreTransaction({ localforage: realRecoveryLocal, chromeStorage: realRecoveryChrome });
  await realJournalStarted;
  const staleDuringRecovery = realRecoveryLocal.setItem("canvas", "stale-uncommitted-import");
  const rejectedStaleRecovery = assert.rejects(() => staleDuringRecovery, /STORAGE_WRITE_SUPERSEDED_BY_RESTORE/);
  releaseRealJournal();
  assert.equal((await realRecoveryRun).rolledBack, true);
  await rejectedStaleRecovery;
  assert.equal(await realRecoveryLocal.getItem("canvas"), "safe-original", "real recovery still rejects writes based on superseded state");
  assert.equal(realController.getState().generation, 1);

  const blockedLocal = makeLocal({ canvas: "safe-old" });
  const blockedRawSet = blockedLocal.setItem.bind(blockedLocal);
  let injectRollbackFailure = true;
  blockedLocal.setItem = async (key, value) => {
    if (key === "canvas" && injectRollbackFailure) throw new Error("injected rollback failure");
    return blockedRawSet(key, value);
  };
  const blockedChrome = makeChrome();
  const blockedChromeObject = { runtime: { lastError: null }, storage: { local: blockedChrome } };
  installStorageWriteBarrier({ localforage: blockedLocal, chromeStorage: blockedChrome, chromeRuntime: blockedChromeObject.runtime, chromeObject: blockedChromeObject, installChromeFacade: true });
  await assert.rejects(() => runBackupRestoreTransaction({
    localforage: blockedLocal,
    chromeStorage: blockedChrome,
    localforageSet: new Map([["canvas", "new"]]),
    transactionId: "blocked-rollback",
  }), /BACKUP_RESTORE_ROLLBACK_FAILED/);
  assert.equal(getStorageWriteBarrierState(blockedLocal).blocked, true);
  await assert.rejects(() => blockedLocal.setItem("unrelated", "must-not-write"), /BACKUP_RESTORE_ROLLBACK_FAILED/);
  injectRollbackFailure = false;
  await recoverBackupRestoreTransaction({ localforage: blockedLocal, chromeStorage: blockedChrome });
  assert.equal(getStorageWriteBarrierState(blockedLocal).blocked, false);
  await blockedLocal.setItem("unrelated", "allowed-after-recovery");
  assert.equal(await blockedLocal.getItem("unrelated"), "allowed-after-recovery");
  console.log("backup restore transaction tests passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
