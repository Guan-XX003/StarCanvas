type StorageWriteTask<T> = () => Promise<T> | T;

const controllers = new WeakMap<object, any>();

const createController = (localforage: any, chromeStorage: any, chromeRuntime: any) => {
  const rawLocalforage = {
    keys: localforage.keys.bind(localforage),
    getItem: localforage.getItem.bind(localforage),
    setItem: localforage.setItem.bind(localforage),
    removeItem: localforage.removeItem.bind(localforage),
    clear: typeof localforage.clear === `function` ? localforage.clear.bind(localforage) : undefined,
  };
  const rawChromeStorage = chromeStorage ? {
    get: chromeStorage.get.bind(chromeStorage),
    set: chromeStorage.set.bind(chromeStorage),
    remove: chromeStorage.remove.bind(chromeStorage),
    clear: typeof chromeStorage.clear === `function` ? chromeStorage.clear.bind(chromeStorage) : undefined,
  } : null;
  let tail: Promise<any> = Promise.resolve();
  let blockedError: Error | null = null;
  let pendingWrites = 0;
  let exclusivePending = 0;
  let suppressedWrites = 0;
  let generation = 0;
  let holdUntilReload = false;
  let chromeInterception = !chromeStorage;
  let callbackLastError: any = null;
  const deferredWrites: any[] = [];
  const chromeRuntimeFacade = chromeRuntime ? { ...chromeRuntime } : {};
  Object.defineProperty(chromeRuntimeFacade, `lastError`, {
    configurable: false,
    enumerable: true,
    get: () => callbackLastError || chromeRuntime?.lastError || null,
  });

  const enqueue = <T>(task: StorageWriteTask<T>, options: any = {}) => {
    if (holdUntilReload && options.exclusive !== true) {
      return Promise.reject(new Error(`STORAGE_WRITE_SUPERSEDED_BY_RESTORE`));
    }
    if (exclusivePending > 0 && options.exclusive !== true) {
      suppressedWrites += 1;
      const capturedGeneration = generation;
      return new Promise<T>((resolve, reject) => deferredWrites.push({ task, capturedGeneration, resolve, reject }));
    }
    pendingWrites += 1;
    const scheduled = tail.catch(() => {}).then(async () => {
      if (blockedError && options.allowBlocked !== true) throw blockedError;
      return task();
    });
    tail = scheduled.catch(() => {}).finally(() => { pendingWrites -= 1; });
    return scheduled;
  };
  const chromeOperation = (method: `set` | `remove` | `clear`, args: any[]) => {
    const callback = typeof args[args.length - 1] === `function` ? args.pop() : null;
    let callbackCalled = false;
    const scheduled = enqueue(() => new Promise<void>((resolve, reject) => {
      rawChromeStorage[method](...args, () => {
        const runtimeError = chromeRuntime?.lastError;
        callbackCalled = true;
        callback?.();
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve();
      });
    }));
    if (callback) {
      scheduled.then(() => {
        if (!callbackCalled) callback();
      }).catch((error) => {
        if (!callbackCalled) {
          callbackCalled = true;
          callbackLastError = { message: String(error?.message || error) };
          try {
            callback();
          } finally {
            callbackLastError = null;
          }
        }
        console.error(`Storage write blocked`, error);
      });
      return undefined;
    }
    return scheduled;
  };

  localforage.setItem = (key: any, value: any) => enqueue(() => rawLocalforage.setItem(key, value));
  localforage.removeItem = (key: any) => enqueue(() => rawLocalforage.removeItem(key));
  if (rawLocalforage.clear) localforage.clear = () => enqueue(() => rawLocalforage.clear());
  const chromeStorageFacade = chromeStorage && rawChromeStorage ? {
    ...chromeStorage,
    get: (...args: any[]) => rawChromeStorage.get(...args),
    set: (...args: any[]) => chromeOperation(`set`, args),
    remove: (...args: any[]) => chromeOperation(`remove`, args),
    ...(rawChromeStorage.clear ? { clear: (...args: any[]) => chromeOperation(`clear`, args) } : {}),
  } : null;

  return {
    rawLocalforage,
    rawChromeStorage,
    chromeStorage: chromeStorageFacade,
    chromeRuntime: chromeRuntimeFacade,
    installChromeFacade(chromeObject: any = globalThis.chrome) {
      if (!chromeStorageFacade || !chromeObject) return false;
      try {
        const facade = {
          ...chromeObject,
          runtime: chromeRuntimeFacade,
          storage: { ...(chromeObject.storage || {}), local: chromeStorageFacade },
        };
        globalThis.chrome = facade;
        chromeInterception = globalThis.chrome?.storage?.local === chromeStorageFacade && globalThis.chrome?.runtime === chromeRuntimeFacade;
      } catch {
        chromeInterception = false;
      }
      return chromeInterception;
    },
    enqueue,
    async exclusive(task: any, blockOnError: (error: any) => boolean = () => false, allowBlocked = false, holdAfterSuccess = false, supersedeOnSuccess: boolean | ((result: any) => boolean) = true) {
      if (exclusivePending > 0) throw new Error(`STORAGE_WRITE_TRANSACTION_BUSY`);
      exclusivePending += 1;
      let succeeded = false;
      let supersede = false;
      try {
        const result = await enqueue(async () => {
        try {
          const result = await task({ localforage: rawLocalforage, chromeStorage: rawChromeStorage });
          if (allowBlocked) blockedError = null;
          return result;
        } catch (error: any) {
          if (blockOnError(error)) blockedError = error instanceof Error ? error : new Error(String(error));
          throw error;
        }
        }, { allowBlocked, exclusive: true });
        supersede = typeof supersedeOnSuccess === `function` ? supersedeOnSuccess(result) : supersedeOnSuccess;
        succeeded = true;
        return result;
      } finally {
        exclusivePending -= 1;
        if (exclusivePending === 0) {
          const pending = deferredWrites.splice(0);
          if (succeeded && supersede) {
            generation += 1;
            if (holdAfterSuccess) holdUntilReload = true;
            const superseded = new Error(`STORAGE_WRITE_SUPERSEDED_BY_RESTORE`);
            for (const entry of pending) entry.reject(superseded);
          } else if (blockedError) {
            for (const entry of pending) entry.reject(blockedError);
          } else {
            for (const entry of pending) {
              if (entry.capturedGeneration !== generation) entry.resolve(undefined);
              else enqueue(entry.task).then(entry.resolve, entry.reject);
            }
          }
        }
      }
    },
    getState: () => ({ installed: true, blocked: Boolean(blockedError), pendingWrites, exclusivePending, suppressedWrites, generation, holdUntilReload, chromeInterception }),
  };
};

export function installStorageWriteBarrier(options: any) {
  const localforage = options?.localforage;
  if (!localforage || typeof localforage !== `object`) throw new Error(`STORAGE_WRITE_BARRIER_LOCALFORAGE_REQUIRED`);
  const existing = controllers.get(localforage);
  if (existing) return existing;
  const controller = createController(localforage, options?.chromeStorage, options?.chromeRuntime);
  controllers.set(localforage, controller);
  if (options?.installChromeFacade === true) controller.installChromeFacade(options?.chromeObject || globalThis.chrome);
  return controller;
}

export function runExclusiveStorageWrite(options: any, task: any, blockOnError?: (error: any) => boolean, allowBlocked = false, holdAfterSuccess = false, supersedeOnSuccess: boolean | ((result: any) => boolean) = true) {
  const controller = controllers.get(options?.localforage);
  if (!controller) return task({ localforage: options?.localforage, chromeStorage: options?.chromeStorage });
  return controller.exclusive(task, blockOnError, allowBlocked, holdAfterSuccess, supersedeOnSuccess);
}

export function getStorageWriteBarrierState(localforage: any) {
  return controllers.get(localforage)?.getState() || { installed: false, blocked: false, pendingWrites: 0, chromeInterception: false };
}
