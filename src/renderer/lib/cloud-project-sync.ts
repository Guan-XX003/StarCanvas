/** Experimental cloud upload coordinator; it never overwrites a local project.
 * Bridge is the default-disabled main-process IPC API. The injected storage is
 * the existing localforage instance; only IDs, hashes and pending commit
 * metadata are persisted, never project content or credentials.
 */
import { prepareCloudProjectMedia, restoreCloudProjectMedia, type VerifiedLocalAsset } from "./cloud-project-media";
import { runBackupRestoreTransaction } from "./backup-restore-transaction";
import { collectCloudPortableAssets, preparePortableReferences, cloudPortableReferences, restorePortableReferences } from "./cloud-portable-assets";
import { decodePortableDataChunks, encodePortableDataChunks, MAX_PORTABLE_DATA_BYTES } from "./cloud-portable-chunks";

type Bridge = (payload: Record<string, unknown>) => Promise<any>;
type Storage = { getItem(key: string): Promise<any>; setItem(key: string, value: any): Promise<any> };
type Snapshot = { version: 1; projectId: string; baseRevision: number;
  state: { sha256: string; size: number }; assets: { assetId: string; blob: { sha256: string; size: number } }[] };
type Binding = { version: 1; accountId: string; localProjectId: string; remoteId: string; revision: number;
  pending: null | { idempotencyKey: string; snapshot: Snapshot } };
const HASH = /^[a-f0-9]{64}$/;
const LOCAL_ID = /^(?:default|(?:proj|project|recovered)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119})$/;

export class CloudProjectSyncError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CloudProjectSyncError"; }
}
function fail(code: string): never { throw new CloudProjectSyncError(code); }
function unwrap(result: any) {
  if (!result || result.ok !== true) {
    const code = typeof result?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(result.code) ? result.code : "CLOUD_PROJECT_FAILED";
    return fail(code);
  }
  return result;
}
function opaqueId(): string {
  const bytes = new Uint8Array(32);
  if (!globalThis.crypto?.getRandomValues) return fail("CLOUD_RANDOM_UNAVAILABLE");
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function idempotencyKey(): string {
  if (!globalThis.crypto?.randomUUID) return fail("CLOUD_RANDOM_UNAVAILABLE");
  return `cloud-${globalThis.crypto.randomUUID()}`;
}
function recordKey(accountId: string, localProjectId: string): string {
  // Escape delimiters to avoid collisions while preserving readable local metadata.
  return `wanjuan-cloud-project-v1:${encodeURIComponent(accountId)}:${encodeURIComponent(localProjectId)}`;
}
function validateBinding(value: any, accountId: string, localProjectId: string): Binding {
  if (!value || value.version !== 1 || value.accountId !== accountId || value.localProjectId !== localProjectId ||
      typeof value.remoteId !== "string" || !HASH.test(value.remoteId) ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER ||
      !(value.pending === null || (typeof value.pending?.idempotencyKey === "string" &&
        value.pending.snapshot?.projectId === value.remoteId && value.pending.snapshot?.baseRevision === value.revision))) {
    return fail("CLOUD_PROJECT_BINDING_INVALID");
  }
  return value as Binding;
}
function localMedia(state: any): { localPath: string; sha256?: string; size?: number }[] {
  if (!state || typeof state !== "object" || !Array.isArray(state.nodes) || !Array.isArray(state.edges)) fail("CLOUD_PROJECT_INVALID_STATE");
  const paths = new Map<string, { localPath: string; sha256?: string; size?: number }>();
  for (const node of state.nodes) {
    const bindings = node?.data?.projectAssetBindings;
    if (bindings == null) continue;
    if (typeof bindings !== "object" || Array.isArray(bindings)) fail("MEDIA_NOT_PREPARED");
    for (const binding of Object.values(bindings) as any[]) {
      // IndexedDB-only bindings are validated and uploaded by the portable
      // asset path; they do not have a filesystem path to inspect here.
      if (binding && !binding.localPath && typeof binding.portableDataRef === "string" && binding.portableDataRef) continue;
      if (!binding || typeof binding.localPath !== "string" || !binding.localPath) fail("MEDIA_NOT_PREPARED");
      const item: { localPath: string; sha256?: string; size?: number } = { localPath: binding.localPath };
      if (binding.sha256) {
        if (typeof binding.sha256 !== "string" || !HASH.test(binding.sha256)) fail("ASSET_METADATA_CONFLICT");
        item.sha256 = binding.sha256;
      }
      if (binding.size != null && binding.size !== 0) {
        if (!Number.isSafeInteger(binding.size) || binding.size < 0) fail("ASSET_METADATA_CONFLICT");
        item.size = binding.size;
      }
      const previous = paths.get(item.localPath);
      if (previous && ((item.sha256 && previous.sha256 && item.sha256 !== previous.sha256) ||
          (item.size !== undefined && previous.size !== undefined && item.size !== previous.size))) fail("ASSET_METADATA_CONFLICT");
      paths.set(item.localPath, { ...previous, ...item });
    }
  }
  return [...paths.values()];
}

export async function withCloudProjectLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fail("CLOUD_PROJECT_LOCK_UNAVAILABLE");
  return locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) return fail("CLOUD_PROJECT_BUSY");
    return task();
  });
}

export async function syncCloudProject(options: {
  bridge: Bridge; storage: Storage; localProjectId: string; projectName: string; state: unknown;
  getCurrentState: () => Promise<unknown>;
  withLock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
}): Promise<{ remoteId: string; revision: number; dirty: boolean; removedSecretFields: number }> {
  const { bridge, storage, localProjectId, projectName, getCurrentState } = options;
  if (typeof bridge !== "function" || !storage?.getItem || !storage?.setItem || typeof getCurrentState !== "function" ||
      typeof localProjectId !== "string" || !LOCAL_ID.test(localProjectId) ||
      typeof projectName !== "string" || !projectName.trim() || projectName.length > 160) fail("CLOUD_PROJECT_INVALID");
  const snapshotState: any = structuredClone(options.state);
  if (!snapshotState || typeof snapshotState !== "object" || Array.isArray(snapshotState) ||
      Object.prototype.hasOwnProperty.call(snapshotState, "cloudProjectMeta")) fail("CLOUD_PROJECT_INVALID_STATE");
  const begin = unwrap(await bridge({ operation: "begin", projectId: localProjectId }));
  if (typeof begin.handle !== "string" || typeof begin.accountId !== "string" || !begin.accountId || begin.accountId.length > 320) fail("CLOUD_PROJECT_SESSION_INVALID");
  const { handle, accountId } = begin;
  const call = async (operation: string, data: Record<string, unknown> = {}) => unwrap(await bridge({ operation, handle, ...data }));
  try {
    const key = recordKey(accountId, localProjectId);
    return await (options.withLock || withCloudProjectLock)(`starcanvas-cloud:${key}`, async () => {
      let binding = await storage.getItem(key);
      if (binding == null) {
        binding = { version: 1, accountId, localProjectId, remoteId: opaqueId(), revision: 0, pending: null } as Binding;
        await storage.setItem(key, binding);
      } else binding = validateBinding(binding, accountId, localProjectId);
      if (binding.pending) {
        const replay = await call("commit", { snapshot: binding.pending.snapshot, idempotencyKey: binding.pending.idempotencyKey });
        if (replay.projectId !== binding.remoteId || replay.revision !== binding.revision + 1) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        binding = { ...binding, revision: replay.revision, pending: null };
        await storage.setItem(key, binding);
      }
      const portable = await collectCloudPortableAssets(snapshotState, storage);
      const candidates = localMedia(snapshotState), verifiedFiles: VerifiedLocalAsset[] = [];
      for (const candidate of candidates) {
        const inspected = await call("inspect-asset", candidate);
        if (!HASH.test(inspected.sha256) || !Number.isSafeInteger(inspected.size) || inspected.size < 0) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        verifiedFiles.push({ localPath: candidate.localPath, sha256: inspected.sha256, size: inspected.size });
      }
      const portableState: any = preparePortableReferences(snapshotState, portable);
      const prepared = prepareCloudProjectMedia({ ...portableState,
        cloudProjectMeta: { name: projectName.trim(), sourceLocalProjectId: localProjectId } }, verifiedFiles);
      // All validation is complete before uploading anything, minimizing orphan blobs.
      for (const item of verifiedFiles) {
        const uploaded = await call("upload-asset", { localPath: item.localPath, sha256: item.sha256, size: item.size });
        if (uploaded.sha256 !== item.sha256 || uploaded.size !== item.size) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      }
      const portableUploaded = new Set<string>();
      for (const item of portable) {
        if (portableUploaded.has(item.sha256)) continue;
        let uploaded;
        if (item.bytes) {
          uploaded = await call("upload-portable-asset", { bytes: item.bytes, sha256: item.sha256 });
        } else {
          const started = await call("portable-chunks-begin", { size: item.size });
          if (typeof started.id !== "string" || started.chunkBytes !== 1024 * 1024) fail("CLOUD_PROJECT_RESPONSE_INVALID");
          try {
            const decoded = await decodePortableDataChunks(item.dataUrl, async (bytes, offset) => {
              const written = await call("portable-chunks-append", { chunkHandle: started.id, offset, bytes });
              if (written.offset !== offset + bytes.length) fail("CLOUD_PROJECT_RESPONSE_INVALID");
            });
            if (decoded.size !== item.size || decoded.mime !== item.mime) fail("CLOUD_PROJECT_RESPONSE_INVALID");
            uploaded = await call("portable-chunks-upload", { chunkHandle: started.id });
          } finally {
            try { await call("portable-chunks-abort", { chunkHandle: started.id }); } catch { /* Already consumed or session ended. */ }
          }
        }
        if (uploaded.sha256 !== item.sha256 || uploaded.size !== item.size) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        portableUploaded.add(item.sha256);
      }
      const uploadedState = await call("upload-state", { state: prepared.state });
      if (!HASH.test(uploadedState.sha256) || !Number.isSafeInteger(uploadedState.size) || uploadedState.size < 0 ||
          uploadedState.removedSecretFields !== 0) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      const assetRefs = new Map(prepared.assets.map(item => [item.assetId, item]));
      for (const item of portable) assetRefs.set(item.sha256, { assetId: item.sha256, blob: { sha256: item.sha256, size: item.size } });
      const snapshot: Snapshot = { version: 1, projectId: binding.remoteId, baseRevision: binding.revision,
        state: { sha256: uploadedState.sha256, size: uploadedState.size }, assets: [...assetRefs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)) };
      const pending = { idempotencyKey: idempotencyKey(), snapshot };
      binding = { ...binding, pending };
      await storage.setItem(key, binding); // Commit intent survives a lost response or process restart.
      const committed = await call("commit", { snapshot, idempotencyKey: pending.idempotencyKey });
      if (committed.projectId !== binding.remoteId || committed.revision !== binding.revision + 1) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      binding = { ...binding, revision: committed.revision, pending: null };
      await storage.setItem(key, binding);
      let dirty = true;
      try {
        const current = await getCurrentState();
        const currentPortable = await collectCloudPortableAssets(current, storage);
        const currentState: any = preparePortableReferences(current, currentPortable);
        const other = prepareCloudProjectMedia({ ...currentState,
          cloudProjectMeta: { name: projectName.trim(), sourceLocalProjectId: localProjectId } }, verifiedFiles);
        dirty = JSON.stringify(other.state) !== JSON.stringify(prepared.state);
      } catch { /* A changed/missing asset is conservatively marked unsynced. */ }
      return { remoteId: binding.remoteId, revision: binding.revision, dirty, removedSecretFields: prepared.removedSecretFields };
    });
  } finally { try { await bridge({ operation: "end", handle }); } catch {} }
}

/** Restore to a fresh project id only. Existing canvas/projects are never replaced. */
export async function restoreCloudProjectAsNew(options: {
  bridge: Bridge; storage: Storage & { keys(): Promise<string[]> }; chromeStorage: any;
  remoteId: string; newProjectId: string; revision?: number | null;
  withLock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
}): Promise<{ localProjectId: string; name: string; revision: number; reloadRequired: true }> {
  const { bridge, storage, chromeStorage, remoteId, newProjectId } = options;
  const revision = options.revision ?? null;
  if (typeof bridge !== "function" || !storage?.getItem || !storage?.setItem || !storage?.keys || !chromeStorage ||
      typeof remoteId !== "string" || !HASH.test(remoteId) || typeof newProjectId !== "string" ||
      !/^recovered-[a-zA-Z0-9][a-zA-Z0-9_-]{0,110}$/.test(newProjectId) ||
      (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) fail("CLOUD_PROJECT_INVALID");
  const begin = unwrap(await bridge({ operation: "begin", projectId: newProjectId }));
  if (typeof begin.handle !== "string" || typeof begin.accountId !== "string" || !begin.accountId || begin.accountId.length > 320) fail("CLOUD_PROJECT_SESSION_INVALID");
  const { handle, accountId } = begin;
  const call = async (operation: string, data: Record<string, unknown> = {}) => unwrap(await bridge({ operation, handle, ...data }));
  try {
    const key = recordKey(accountId, newProjectId), canvasKey = `canvas-state-v1-${newProjectId}`;
    const mirrorKey = `desktop-canvas-state-v1-${newProjectId}`;
    return await (options.withLock || withCloudProjectLock)(`starcanvas-cloud:${key}`, async () => {
      const existing = new Set(await storage.keys());
      if (existing.has(key) || existing.has(canvasKey)) fail("CLOUD_LOCAL_PROJECT_EXISTS");
      const manifest = await call("read", { projectId: remoteId, revision });
      if (manifest.projectId !== remoteId || !Number.isSafeInteger(manifest.revision) || manifest.revision < 1 ||
          !manifest.state || !HASH.test(manifest.state.sha256) || !Number.isSafeInteger(manifest.state.size) ||
          manifest.state.size < 0 || !Array.isArray(manifest.assets) || manifest.assets.length > 10000) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      const download = await call("read-state", { sha256: manifest.state.sha256, size: manifest.state.size });
      const cloudState = download.state;
      if (!cloudState || typeof cloudState !== "object" || !Array.isArray(cloudState.nodes) || !Array.isArray(cloudState.edges)) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      const metadata = cloudState.cloudProjectMeta;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
          Object.keys(metadata).sort().join(",") !== "name,sourceLocalProjectId" ||
          typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 160 ||
          typeof metadata.sourceLocalProjectId !== "string" || !LOCAL_ID.test(metadata.sourceLocalProjectId)) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      const references = new Map<string, any>();
      for (const item of manifest.assets) {
        if (!item || typeof item.assetId !== "string" || !HASH.test(item.assetId) ||
            !item.blob || item.blob.sha256 !== item.assetId || !Number.isSafeInteger(item.blob.size) || item.blob.size < 0 ||
            references.has(item.assetId)) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        references.set(item.assetId, item.blob);
      }
      const bindings = new Map<string, any>();
      for (const node of cloudState.nodes) {
        const value = node?.data?.cloudAssetBindings;
        if (value == null) continue;
        if (typeof value !== "object" || Array.isArray(value)) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        for (const item of Object.values(value) as any[]) {
          const ref = references.get(item?.assetId);
          if (!ref || item.sha256 !== item.assetId || item.size !== ref.size ||
              typeof item.mime !== "string" || typeof item.filename !== "string") fail("CLOUD_PROJECT_RESPONSE_INVALID");
          if (!bindings.has(item.assetId)) bindings.set(item.assetId, item);
        }
      }
      const portableRefs = cloudPortableReferences(cloudState);
      const allAssets = new Set([...bindings.keys(), ...portableRefs.map(item => item.sha256)]);
      if (allAssets.size !== references.size || [...allAssets].some(id => !references.has(id))) fail("CLOUD_PROJECT_RESPONSE_INVALID");
      const verifiedFiles: VerifiedLocalAsset[] = [];
      for (const item of bindings.values()) {
        const downloaded = await call("download-asset", { sha256: item.sha256, size: item.size,
          mime: item.mime, filename: item.filename });
        if (typeof downloaded.localPath !== "string" || !downloaded.localPath ||
            downloaded.sha256 !== item.sha256 || downloaded.size !== item.size) fail("CLOUD_PROJECT_RESPONSE_INVALID");
        verifiedFiles.push({ localPath: downloaded.localPath, sha256: downloaded.sha256, size: downloaded.size });
      }
      const portableValues = new Map<string, string>();
      const downloadedBytes = new Map<string, Uint8Array>();
      for (const item of portableRefs) {
        const ref = references.get(item.sha256);
        if (ref.size > 128 * 1024 * 1024) {
          if (ref.size > MAX_PORTABLE_DATA_BYTES) fail("MEDIA_NOT_PREPARED");
          const opened = await call("portable-chunks-download", { sha256: ref.sha256, size: ref.size });
          if (typeof opened.id !== "string" || opened.sha256 !== ref.sha256 || opened.size !== ref.size ||
              opened.chunkBytes !== 1024 * 1024) fail("CLOUD_PROJECT_RESPONSE_INVALID");
          try {
            const value = await encodePortableDataChunks(ref.size, item.mime, ref.sha256, async offset => {
              const chunk = await call("portable-chunks-read", { chunkHandle: opened.id, offset });
              return { bytes: chunk.bytes, offset: chunk.offset };
            });
            portableValues.set(`starcanvas-cloud-portable:${item.sha256}:${item.mime}`, value);
          } finally {
            try { await call("portable-chunks-abort", { chunkHandle: opened.id }); } catch { /* Session cleanup also releases staging. */ }
          }
          continue;
        }
        let bytes = downloadedBytes.get(item.sha256);
        if (!bytes) {
          const downloaded = await call("download-portable-asset", { sha256: ref.sha256, size: ref.size });
          if (!(downloaded.bytes instanceof Uint8Array) || downloaded.sha256 !== ref.sha256 ||
              downloaded.size !== ref.size || downloaded.bytes.length !== ref.size) fail("CLOUD_PROJECT_RESPONSE_INVALID");
          bytes = downloaded.bytes; downloadedBytes.set(item.sha256, bytes);
        }
        let encoded = "";
        for (let offset = 0; offset < bytes.length; offset += 24576) {
          const slice = bytes.subarray(offset, offset + 24576);
          encoded += globalThis.btoa(Array.from(slice, byte => String.fromCharCode(byte)).join(""));
        }
        portableValues.set(`starcanvas-cloud-portable:${item.sha256}:${item.mime}`, `data:${item.mime};base64,${encoded}`);
      }
      const restoredFiles = restoreCloudProjectMedia(cloudState, verifiedFiles);
      const portableRestored = restorePortableReferences(restoredFiles, newProjectId, portableValues);
      const restored: any = portableRestored.state;
      delete restored.cloudProjectMeta;
      for (const node of restored.nodes) {
        if (node?.data?.projectId === metadata.sourceLocalProjectId) node.data.projectId = newProjectId;
      }
      const binding: Binding = { version: 1, accountId, localProjectId: newProjectId, remoteId,
        revision: manifest.revision, pending: null };
      const restoreEntries = new Map<string, any>([[canvasKey, restored], [key, binding], ...portableRestored.stored]);
      await runBackupRestoreTransaction({ localforage: storage, chromeStorage,
        localforageSet: restoreEntries,
        requireAbsentLocalKeys: [...restoreEntries.keys()], chromeSet: { [mirrorKey]: restored },
        requireAbsentChromeKeys: [mirrorKey], appendNewProject: { id: newProjectId, name: metadata.name.trim(), groupId: "" } });
      return { localProjectId: newProjectId, name: metadata.name.trim(), revision: manifest.revision, reloadRequired: true as const };
    });
  } finally { try { await bridge({ operation: "end", handle }); } catch {} }
}
