import { getStorageWriteBarrierState, runExclusiveStorageWrite } from "./storage-write-barrier";

const BACKUP_RESTORE_JOURNAL_KEY = `wanjuan-backup-restore-journal-v1`;
const BACKUP_RESTORE_TEMP_PREFIX = `wanjuan-backup-restore-tx-v1-`;

const chromeGet = (storage: any, keys: any = null) => new Promise<any>((resolve, reject) => {
  storage.get(keys, (value: any) => {
    const error = globalThis.chrome?.runtime?.lastError;
    if (error) reject(new Error(error.message));
    else resolve(value || {});
  });
});

const chromeSet = (storage: any, values: any) => new Promise<void>((resolve, reject) => {
  if (!values || Object.keys(values).length === 0) return resolve();
  storage.set(values, () => {
    const error = globalThis.chrome?.runtime?.lastError;
    if (error) reject(new Error(error.message));
    else resolve();
  });
});

const chromeRemove = (storage: any, keys: string[]) => new Promise<void>((resolve, reject) => {
  if (!keys.length) return resolve();
  storage.remove(keys, () => {
    const error = globalThis.chrome?.runtime?.lastError;
    if (error) reject(new Error(error.message));
    else resolve();
  });
});

const transactionLocks = new WeakMap<object, Promise<any>>();
const activeRestoreTransactions = new WeakSet<object>();

async function withStorageTransactionLock(localforage: object, task: () => Promise<any>) {
  const previous = transactionLocks.get(localforage) || Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  transactionLocks.set(localforage, queued);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (transactionLocks.get(localforage) === queued) transactionLocks.delete(localforage);
  }
}

async function cleanupTransactionFiles(localforage: any, journal: any) {
  const temporaryKeys = [
    ...Object.values(journal?.localforage?.backupKeys || {}),
    ...Object.values(journal?.localforage?.stageKeys || {}),
  ].map((value) => String(value || ``)).filter(Boolean);
  for (const key of temporaryKeys) await localforage.removeItem(key);
  await localforage.removeItem(BACKUP_RESTORE_JOURNAL_KEY);
}

async function restoreChromeSnapshot(chromeStorage: any, snapshot: any = {}) {
  const present = snapshot.present && typeof snapshot.present === `object` ? snapshot.present : {};
  const absent = Array.isArray(snapshot.absent) ? snapshot.absent.map(String) : [];
  await chromeRemove(chromeStorage, absent);
  await chromeSet(chromeStorage, present);
}

async function recoverBackupRestoreTransactionInternal({ localforage, chromeStorage }: any) {
  const journal = await localforage.getItem(BACKUP_RESTORE_JOURNAL_KEY);
  if (!journal) return { recovered: false };
  if (journal.version !== 1 || ![`preparing`, `applying`, `rolledBack`, `committed`].includes(journal.phase)) {
    throw new Error(`BACKUP_RESTORE_JOURNAL_INVALID`);
  }
  if (journal.phase === `applying`) {
    for (const [targetKey, backupKey] of Object.entries(journal.localforage?.backupKeys || {})) {
      const snapshot: any = await localforage.getItem(String(backupKey));
      if (!snapshot || snapshot.version !== 1) throw new Error(`BACKUP_RESTORE_SNAPSHOT_MISSING`);
      if (snapshot.exists) await localforage.setItem(targetKey, snapshot.value);
      else await localforage.removeItem(targetKey);
    }
    await restoreChromeSnapshot(chromeStorage, journal.chrome?.original || {});
    journal.phase = `rolledBack`;
    journal.rolledBackAt = Date.now();
    await localforage.setItem(BACKUP_RESTORE_JOURNAL_KEY, journal);
  }
  await cleanupTransactionFiles(localforage, journal);
  return { recovered: true, rolledBack: journal.phase === `rolledBack`, committed: journal.phase === `committed` };
}

export async function recoverBackupRestoreTransaction(options: any) {
  const localforage = options?.localforage;
  if (!localforage || !options?.chromeStorage) return { recovered: false };
  return withStorageTransactionLock(localforage, () => runExclusiveStorageWrite(
    { localforage, chromeStorage: options.chromeStorage },
    (storage: any) => recoverBackupRestoreTransactionInternal(storage),
    () => true,
    true,
    false,
    // A no-journal startup check changes no state: release queued saves in order.
    // A real recovery still invalidates writes derived from the pre-recovery state.
    (result: any) => result?.recovered === true,
  ));
}

export async function runBackupRestoreTransaction(options: any) {
  const localforage = options?.localforage;
  const chromeStorage = options?.chromeStorage;
  if (!localforage || !chromeStorage) throw new Error(`BACKUP_RESTORE_STORAGE_UNAVAILABLE`);
  const barrierState = getStorageWriteBarrierState(localforage);
  if (barrierState.installed && !barrierState.chromeInterception) throw new Error(`STORAGE_WRITE_BARRIER_CHROME_UNAVAILABLE`);
  if (activeRestoreTransactions.has(localforage)) throw new Error(`BACKUP_RESTORE_BUSY`);
  activeRestoreTransactions.add(localforage);
  try {
    return await withStorageTransactionLock(localforage, () => runExclusiveStorageWrite(
    { localforage, chromeStorage },
    async (storage: any) => {
    const localforage = storage.localforage;
    const chromeStorage = storage.chromeStorage;
    await recoverBackupRestoreTransactionInternal({ localforage, chromeStorage });

    const transactionId = String(options.transactionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
      .replace(/[^a-zA-Z0-9_-]+/g, ``)
      .slice(0, 80);
    if (!transactionId) throw new Error(`BACKUP_RESTORE_TRANSACTION_ID_INVALID`);
    const localSetEntries = Array.from(options.localforageSet || []).map(([key, value]: any) => [String(key), value]);
    const localRemoveKeys = [...new Set(Array.from(options.localforageRemove || []).map(String))];
    const localTargetKeys = [...localRemoveKeys, ...localSetEntries.map(([key]) => key)];
    if (localTargetKeys.some((key) => !key || key === BACKUP_RESTORE_JOURNAL_KEY || key.startsWith(BACKUP_RESTORE_TEMP_PREFIX))) {
      throw new Error(`BACKUP_RESTORE_TARGET_KEY_INVALID`);
    }
    const localSetKeys = new Set(localSetEntries.map(([key]) => key));
    const localTouchedKeys = [...new Set(localTargetKeys)];
    const chromeValues = options.chromeSet && typeof options.chromeSet === `object` ? { ...options.chromeSet } : {};
    const appendProject = options.appendNewProject || null;
    if (appendProject && (!appendProject || typeof appendProject !== `object` || Array.isArray(appendProject) ||
        typeof appendProject.id !== `string` || !/^(?:proj|project|recovered)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(appendProject.id) ||
        typeof appendProject.name !== `string` || !appendProject.name.trim() || appendProject.name.length > 160 ||
        Object.keys(appendProject).some((key) => ![`id`, `name`, `groupId`].includes(key)) ||
        (appendProject.groupId != null && typeof appendProject.groupId !== `string`) ||
        Object.prototype.hasOwnProperty.call(chromeValues, `projects`) ||
        (Array.isArray(options.chromeRemove) && options.chromeRemove.includes(`projects`)))) throw new Error(`CLOUD_LOCAL_PROJECT_INVALID`);
    const chromeRemoveKeys = [...new Set(Array.from(options.chromeRemove || []).map(String))]
      .filter((key) => !Object.prototype.hasOwnProperty.call(chromeValues, key));
    const chromeTouchedKeys = [...new Set([...Object.keys(chromeValues), ...chromeRemoveKeys, ...(appendProject ? [`projects`] : [])])];
    const existingLocalKeys = new Set(await localforage.keys());
    const existingChrome = await chromeGet(chromeStorage, chromeTouchedKeys);
    const requireLocalAbsent = Array.isArray(options.requireAbsentLocalKeys) ? options.requireAbsentLocalKeys.map(String) : [];
    if (requireLocalAbsent.some((key: string) => !localSetKeys.has(key) || existingLocalKeys.has(key))) throw new Error(`CLOUD_LOCAL_PROJECT_EXISTS`);
    const requireChromeAbsent = Array.isArray(options.requireAbsentChromeKeys) ? options.requireAbsentChromeKeys.map(String) : [];
    if (requireChromeAbsent.some((key: string) => !Object.prototype.hasOwnProperty.call(chromeValues, key) ||
        Object.prototype.hasOwnProperty.call(existingChrome, key))) throw new Error(`CLOUD_LOCAL_PROJECT_EXISTS`);
    if (appendProject) {
      // A fresh workspace renders the default project before its project list
      // is persisted. Restoring a cloud project must not hide that workspace.
      const existingProjects = existingChrome.projects == null ||
        (Array.isArray(existingChrome.projects) && existingChrome.projects.length === 0)
        ? [{ id: `default`, name: `默认项目` }] : existingChrome.projects;
      if (!Array.isArray(existingProjects)) throw new Error(`CLOUD_LOCAL_PROJECTS_INVALID`);
      if (existingProjects.some((project: any) => project?.id === appendProject.id)) throw new Error(`CLOUD_LOCAL_PROJECT_EXISTS`);
      chromeValues.projects = [...existingProjects, { id: appendProject.id, name: appendProject.name.trim(), groupId: appendProject.groupId || `` }];
    }
    const journal: any = {
      version: 1,
      id: transactionId,
      phase: `preparing`,
      createdAt: Date.now(),
      chrome: {
        original: {
          present: Object.fromEntries(chromeTouchedKeys.filter((key) => Object.prototype.hasOwnProperty.call(existingChrome, key)).map((key) => [key, existingChrome[key]])),
          absent: chromeTouchedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(existingChrome, key)),
        },
        setKeys: Object.keys(chromeValues),
        removeKeys: chromeRemoveKeys,
      },
      localforage: { backupKeys: {}, stageKeys: {}, removeKeys: localRemoveKeys },
    };

    for (const [index, targetKey] of localTouchedKeys.entries()) {
      journal.localforage.backupKeys[targetKey] = `${BACKUP_RESTORE_TEMP_PREFIX}${transactionId}-backup-${index}`;
    }
    for (const [index, [targetKey]] of localSetEntries.entries()) {
      journal.localforage.stageKeys[targetKey] = `${BACKUP_RESTORE_TEMP_PREFIX}${transactionId}-stage-${index}`;
    }

    await localforage.setItem(BACKUP_RESTORE_JOURNAL_KEY, journal);
    try {
      for (const targetKey of localTouchedKeys) {
        await localforage.setItem(journal.localforage.backupKeys[targetKey], {
          version: 1,
          exists: existingLocalKeys.has(targetKey),
          value: existingLocalKeys.has(targetKey) ? await localforage.getItem(targetKey) : null,
        });
      }
      for (const [targetKey, value] of localSetEntries) {
        await localforage.setItem(journal.localforage.stageKeys[targetKey], { version: 1, value });
      }
      journal.phase = `applying`;
      await localforage.setItem(BACKUP_RESTORE_JOURNAL_KEY, journal);

      for (const key of localRemoveKeys) {
        if (!localSetKeys.has(key)) await localforage.removeItem(key);
      }
      for (const [targetKey] of localSetEntries) {
        const staged: any = await localforage.getItem(journal.localforage.stageKeys[targetKey]);
        if (!staged || staged.version !== 1) throw new Error(`BACKUP_RESTORE_STAGE_MISSING`);
        await localforage.setItem(targetKey, staged.value);
      }
      await chromeRemove(chromeStorage, chromeRemoveKeys);
      await chromeSet(chromeStorage, chromeValues);

      journal.phase = `committed`;
      await localforage.setItem(BACKUP_RESTORE_JOURNAL_KEY, journal);
      try {
        await cleanupTransactionFiles(localforage, journal);
        return { ok: true, transactionId, cleanupPending: false };
      } catch (cleanupError: any) {
        return {
          ok: true,
          transactionId,
          cleanupPending: true,
          cleanupError: String(cleanupError?.message || cleanupError),
        };
      }
    } catch (error: any) {
      try {
        await recoverBackupRestoreTransactionInternal({ localforage, chromeStorage });
      } catch (rollbackError: any) {
        const blocked = new Error(`BACKUP_RESTORE_ROLLBACK_FAILED`);
        (blocked as any).cause = error;
        (blocked as any).rollbackError = String(rollbackError?.message || rollbackError);
        throw blocked;
      }
      throw error;
    }
    },
    (error: any) => String(error?.message || error) === `BACKUP_RESTORE_ROLLBACK_FAILED`,
    false,
    true,
    ));
  } finally {
    activeRestoreTransactions.delete(localforage);
  }
}

export { BACKUP_RESTORE_JOURNAL_KEY, BACKUP_RESTORE_TEMP_PREFIX };
