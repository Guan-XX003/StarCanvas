// Experimental main-process bridge. Project asset paths are accepted only when
// listed in the saved project reference manifest and under its managed roots.
// Account secrets, staging paths and arbitrary filesystem roots are never IPC inputs.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("./electron-refs.cjs");
const { defaultDownloadDirectory, mediaLibraryRoot } = require("./utils/paths.cjs");
const { extensionFromMime } = require("./utils/mime.cjs");
const { createCloudProjectSession } = require("./cloud-project-service.cjs");
const { createAccountOperationGuard, readAccountState, uploadCloudProjectAsset, withDownloadedCloudProjectAsset } = require("./account-service.cjs");
const { withPreparedCloudAsset } = require("./assets/cloud-project-media.cjs");
const { createPortableChunkStore, MAX_BYTES: MAX_CHUNKED_PORTABLE_BYTES } = require("./assets/cloud-portable-chunks.cjs");

const PROJECT_ID = /^(?:default|(?:proj|project|recovered)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119})$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_BYTES = 100 * 1024 ** 3;
// IPC carries IndexedDB bytes, not a filesystem path. File-backed assets use
// the separate streaming path above and do not have this memory-bound limit.
const MAX_PORTABLE_BYTES = 128 * 1024 ** 2;
const SAFE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".avif", ".heic", ".heif", ".tif", ".tiff", ".ico", ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv", ".mpeg", ".mpg", ".3gp", ".3g2", ".ts", ".mts", ".m2ts", ".wmv", ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".flac", ".opus", ".weba", ".amr", ".aif", ".aiff", ".caf", ".txt", ".md", ".json"]);
function failure(code) { const error = new Error(code); error.code = code; throw error; }
function relativeInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function trustedStaging(root) {
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fsp.lstat(root), actual = await fsp.realpath(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(path.resolve(root), actual) !== "" ||
      (process.platform !== "win32" && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) failure("CLOUD_STAGING_UNSAFE");
  return actual;
}

async function authorizeProjectAsset(mediaRoot, projectId, sourcePath) {
  if (!PROJECT_ID.test(projectId) || typeof sourcePath !== "string" || sourcePath.length > 32768 ||
      !path.isAbsolute(sourcePath)) failure("CLOUD_PROJECT_ASSET_INVALID");
  let file;
  try {
    const root = await fsp.realpath(mediaRoot);
    const manifestDir = path.join(root, "_projects"), directory = await fsp.lstat(manifestDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || path.relative(manifestDir, await fsp.realpath(manifestDir)) !== "") {
      failure("CLOUD_PROJECT_MANIFEST_UNSAFE");
    }
    const manifestPath = path.join(manifestDir, `${projectId}.json`);
    file = await fsp.open(manifestPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > 4n * 1024n * 1024n) failure("CLOUD_PROJECT_MANIFEST_UNSAFE");
    const raw = await file.readFile({ encoding: "utf8" });
    const after = await file.stat({ bigint: true }), pathname = await fsp.lstat(manifestPath, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || after.dev !== pathname.dev || after.ino !== pathname.ino || pathname.isSymbolicLink()) {
      failure("CLOUD_PROJECT_MANIFEST_UNSAFE");
    }
    const manifest = JSON.parse(raw), candidate = path.resolve(sourcePath);
    if (manifest?.projectId !== projectId || manifest.complete !== true || !Array.isArray(manifest.references) ||
        manifest.references.length > 200000 || !manifest.references.some((item) =>
          typeof item === "string" && path.isAbsolute(item) && path.relative(path.resolve(item), candidate) === "")) {
      failure("CLOUD_PROJECT_ASSET_NOT_REFERENCED");
    }
    const roots = [];
    for (const segment of [projectId, "_blobs"]) {
      const candidateRoot = path.join(root, segment);
      try {
        const rootInfo = await fsp.lstat(candidateRoot), canonical = await fsp.realpath(candidateRoot);
        if (rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && path.relative(candidateRoot, canonical) === "" &&
            relativeInside(root, canonical)) roots.push(canonical);
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (!roots.some((item) => relativeInside(item, candidate))) failure("CLOUD_PROJECT_ASSET_OUTSIDE_ROOT");
    return { candidate, roots };
  } catch (error) {
    if (error?.code && /^CLOUD_[A-Z0-9_]+$/.test(error.code)) throw error;
    failure("CLOUD_PROJECT_ASSET_UNAVAILABLE");
  } finally { if (file) await file.close(); }
}

async function verifyStoredFile(filePath, expectedHash, expectedSize) {
  let file;
  try {
    file = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expectedSize)) failure("CLOUD_LOCAL_ASSET_CONFLICT");
    const hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) { const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); }
    const after = await file.stat({ bigint: true }), current = await fsp.lstat(filePath, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        after.dev !== current.dev || after.ino !== current.ino || current.isSymbolicLink() || hash.digest("hex") !== expectedHash) {
      failure("CLOUD_LOCAL_ASSET_CONFLICT");
    }
  } catch (error) {
    if (error?.code === "CLOUD_LOCAL_ASSET_CONFLICT") throw error;
    failure("CLOUD_LOCAL_ASSET_CONFLICT");
  } finally { if (file) await file.close(); }
}

async function storeDownloadedAsset(mediaRoot, projectId, source, sha256, size, mime, filename, guard) {
  if (!PROJECT_ID.test(projectId) || typeof mime !== "string" || mime.length > 150 ||
      (mime && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) || typeof filename !== "string" ||
      filename.length > 255 || /[\\/\x00-\x1f]/.test(filename)) failure("CLOUD_MEDIA_METADATA_INVALID");
  const ext = (extensionFromMime(mime) || path.extname(filename).toLowerCase());
  if (!SAFE_EXTENSIONS.has(ext)) failure("CLOUD_MEDIA_TYPE_UNSUPPORTED");
  await fsp.mkdir(mediaRoot, { recursive: true });
  const rootInfo = await fsp.lstat(mediaRoot), root = await fsp.realpath(mediaRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || path.relative(path.resolve(mediaRoot), root) !== "") failure("CLOUD_PROJECT_ASSET_UNAVAILABLE");
  let parent = root;
  for (const segment of [projectId, "assets", "cloud"]) {
    parent = path.join(parent, segment);
    try { await fsp.mkdir(parent, { mode: 0o700 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
    const info = await fsp.lstat(parent), canonical = await fsp.realpath(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(parent, canonical) !== "" || !relativeInside(root, canonical)) {
      failure("CLOUD_PROJECT_ASSET_UNAVAILABLE");
    }
  }
  const target = path.join(parent, `${sha256}${ext}`), temporary = path.join(parent, `.cloud-${crypto.randomUUID()}`);
  let input, output, identity, linked = false, deduplicated = false;
  try {
    input = await fsp.open(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    output = await fsp.open(temporary, "wx", 0o600); identity = await output.stat({ bigint: true });
    const hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      total += bytesRead; if (total > size) failure("CLOUD_INTEGRITY_FAILED");
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) { const result = await output.write(buffer, offset, bytesRead - offset, null);
        if (!result.bytesWritten) failure("CLOUD_STAGING_FAILED"); offset += result.bytesWritten; }
    }
    if (total !== size || hash.digest("hex") !== sha256) failure("CLOUD_INTEGRITY_FAILED");
    await output.sync(); await output.close(); output = null;
    guard();
    try { await fsp.link(temporary, target); linked = true; }
    catch (error) { if (error?.code !== "EEXIST") throw error; deduplicated = true; }
  } finally {
    if (input) await input.close();
    if (output) await output.close();
    if (identity) {
      const current = await fsp.lstat(temporary, { bigint: true });
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) failure("CLOUD_CLEANUP_UNSAFE");
      await fsp.unlink(temporary);
    }
  }
  if (deduplicated) await verifyStoredFile(target, sha256, size);
  guard();
  return { localPath: target, sha256, size, deduplicated: !linked };
}

function createCloudProjectBridge(options = {}) {
  const mediaRoot = options.mediaRoot || mediaLibraryRoot(defaultDownloadDirectory());
  const stagingRoot = options.stagingRoot || path.join(app.getPath("userData"), "cloud-project-staging");
  const sessions = new Map();
  async function dropSession(handle, item) {
    if (item.closing) return item.closing;
    item.closing = (async () => {
      if (item.chunkPromise) {
        let store;
        try { store = await item.chunkPromise; } catch { /* No chunk store was created. */ }
        if (store) await store.dispose();
      }
      if (sessions.get(handle) === item) sessions.delete(handle);
    })();
    try { await item.closing; } catch (error) { item.closing = null; throw error; }
  }
  async function sessionFor(handle) {
    if (typeof handle !== "string" || !UUID.test(handle)) failure("CLOUD_PROJECT_SESSION_INVALID");
    const item = sessions.get(handle);
    if (!item) failure("CLOUD_PROJECT_SESSION_EXPIRED");
    if (item.closing) failure("CLOUD_PROJECT_SESSION_EXPIRED");
    if (item.expiresAt <= Date.now()) { await dropSession(handle, item); failure("CLOUD_PROJECT_SESSION_EXPIRED"); }
    try { item.guard(); } catch (error) { await dropSession(handle, item); throw error; }
    return item;
  }
  async function invoke(payload = {}) {
    if (payload?.operation === "capabilities") {
      if (options.enabled !== true) return { enabled: false, available: false };
      try {
        // An authenticated, validated quota response proves the route is
        // available; it also scopes the probe to the current account epoch.
        await createCloudProjectSession().quota();
        return { enabled: true, available: true };
      } catch (error) {
        // Older deployments do not expose this route. A transient outage is
        // different: keep the entry visible so the user can retry.
        if (Number(error?.status) === 404 || Number(error?.status) === 401 ||
            error?.code === "AUTH_REQUIRED" || error?.code === "ACCOUNT_SESSION_CHANGED") {
          return { enabled: false, available: false };
        }
        return { enabled: true, available: false };
      }
    }
    if (options.enabled !== true) failure("CLOUD_PROJECTS_DISABLED");
    const operation = payload?.operation;
    if (operation === "begin") {
      if (typeof payload.projectId !== "string" || !PROJECT_ID.test(payload.projectId)) failure("CLOUD_PROJECT_INVALID");
      for (const [key, value] of sessions) {
        if (value.expiresAt <= Date.now()) { await dropSession(key, value); continue; }
        try { value.guard(); } catch { await dropSession(key, value); }
      }
      if (sessions.size >= 16) failure("CLOUD_PROJECT_TOO_MANY_SESSIONS");
      const session = createCloudProjectSession(), guard = createAccountOperationGuard();
      guard();
      const user = readAccountState().user;
      const accountId = String(user?.id || user?.userId || user?.accountId || "");
      if (!accountId) failure("AUTH_REQUIRED");
      const handle = crypto.randomUUID();
      sessions.set(handle, { projectId: payload.projectId, accountId, session, guard, expiresAt: Date.now() + 30 * 60 * 1000 });
      return { handle, accountId };
    }
    const current = await sessionFor(payload?.handle), guard = current.guard;
    if (operation === "end") { await dropSession(payload.handle, current); return {}; }
    if (operation === "quota") return current.session.quota();
    if (operation === "list") return current.session.list({ cursor: payload.cursor ?? null, limit: payload.limit ?? 50 });
    if (operation === "read") return current.session.read(payload.projectId, payload.revision ?? null);
    if (operation === "commit") return current.session.commit(payload.snapshot, payload.idempotencyKey);
    if (operation === "portable-chunks-begin" || operation === "portable-chunks-download") {
      if (!current.chunkPromise) {
        const pending = (async () => {
          const stage = await trustedStaging(stagingRoot); guard();
          return createPortableChunkStore(stage, guard);
        })();
        current.chunkPromise = pending;
        pending.catch(() => { if (current.chunkPromise === pending) current.chunkPromise = null; });
      }
      const store = await current.chunkPromise;
      if (operation === "portable-chunks-begin") return store.begin(payload.size);
      const stage = await trustedStaging(stagingRoot); guard();
      return withDownloadedCloudProjectAsset({ sha256: payload.sha256, size: payload.size, stagingRoot: stage,
        maxBytes: MAX_CHUNKED_PORTABLE_BYTES }, async ({ stagedPath, sha256, size, assertSessionActive }) => {
          guard(); assertSessionActive();
          const { id } = await store.begin(size);
          let input;
          try {
            input = await fsp.open(stagedPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
            const buffer = Buffer.allocUnsafe(1024 * 1024);
            let offset = 0;
            for (;;) {
              const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
              if (!bytesRead) break;
              guard(); assertSessionActive();
              await store.append(id, offset, buffer.subarray(0, bytesRead));
              offset += bytesRead;
            }
            const metadata = await store.seal(id);
            if (metadata.sha256 !== sha256 || metadata.size !== size) failure("CLOUD_INTEGRITY_FAILED");
            guard(); assertSessionActive();
            return { id, ...metadata };
          } catch (error) {
            try { await store.abort(id); } catch { /* Already cleaned or account changed. */ }
            throw error;
          } finally { if (input) await input.close(); }
        });
    }
    if (["portable-chunks-append", "portable-chunks-read", "portable-chunks-abort", "portable-chunks-upload"].includes(operation)) {
      if (!current.chunkPromise) failure("CLOUD_CHUNK_HANDLE_INVALID");
      const store = await current.chunkPromise;
      if (operation === "portable-chunks-append") return store.append(payload.chunkHandle, payload.offset, payload.bytes);
      if (operation === "portable-chunks-read") return store.read(payload.chunkHandle, payload.offset);
      if (operation === "portable-chunks-abort") { await store.abort(payload.chunkHandle); return {}; }
      const stage = await trustedStaging(stagingRoot); guard();
      const result = await store.consume(payload.chunkHandle, async ({ sourcePath, allowedRoots, sha256, size }) => {
        const uploaded = await uploadCloudProjectAsset({ sourcePath, allowedRoots, stagingRoot: stage,
          maxBytes: MAX_CHUNKED_PORTABLE_BYTES, expectedSha256: sha256, expectedSize: size });
        if (uploaded.sha256 !== sha256 || uploaded.size !== size) failure("CLOUD_INTEGRITY_FAILED");
        return uploaded;
      });
      guard(); return { sha256: result.sha256, size: result.size };
    }
    if (operation === "inspect-asset" || operation === "upload-asset") {
      const { candidate, roots } = await authorizeProjectAsset(mediaRoot, current.projectId, payload.localPath);
      const stage = await trustedStaging(stagingRoot); guard();
      if (operation === "inspect-asset") {
        const result = await withPreparedCloudAsset({ sourcePath: candidate, allowedRoots: roots, stagingRoot: stage,
          maxBytes: MAX_ASSET_BYTES, expectedSha256: payload.sha256, expectedSize: payload.size },
          async ({ sha256, size }) => { guard(); return { sha256, size }; });
        guard(); return result;
      }
      const result = await uploadCloudProjectAsset({ sourcePath: candidate, allowedRoots: roots, stagingRoot: stage,
        maxBytes: MAX_ASSET_BYTES, expectedSha256: payload.sha256, expectedSize: payload.size,
        ...(payload.reservationId ? { reservationId: payload.reservationId } : {}) });
      guard(); return result;
    }
    if (operation === "upload-portable-asset") {
      if (!(payload.bytes instanceof Uint8Array) || payload.bytes.byteLength < 1 ||
          payload.bytes.byteLength > MAX_PORTABLE_BYTES || typeof payload.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(payload.sha256)) failure("CLOUD_MEDIA_ARGUMENT_INVALID");
      const bytes = Buffer.from(payload.bytes);
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== payload.sha256) failure("CLOUD_INTEGRITY_FAILED");
      const stage = await trustedStaging(stagingRoot); guard();
      const directory = await fsp.mkdtemp(path.join(stage, "cloud-portable-"));
      const source = path.join(directory, "asset");
      let file, identity;
      try {
        file = await fsp.open(source, "wx", 0o600); identity = await file.stat({ bigint: true });
        await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
        guard();
        const result = await uploadCloudProjectAsset({ sourcePath: source, allowedRoots: [directory], stagingRoot: stage,
          maxBytes: MAX_PORTABLE_BYTES, expectedSha256: payload.sha256, expectedSize: bytes.length });
        guard(); return result;
      } finally {
        if (file) await file.close();
        if (identity) {
          const stat = await fsp.lstat(source, { bigint: true });
          if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) failure("CLOUD_CLEANUP_UNSAFE");
          await fsp.unlink(source);
        }
        await fsp.rmdir(directory);
      }
    }
    if (operation === "upload-state") {
      const { prepareCloudProjectState } = await import("../shared/cloud-project-safety.mjs");
      const clean = prepareCloudProjectState(payload.state);
      if (!clean.state || typeof clean.state !== "object" || Array.isArray(clean.state) ||
          !Array.isArray(clean.state.nodes) || !Array.isArray(clean.state.edges)) failure("CLOUD_PROJECT_INVALID_STATE");
      const bytes = Buffer.from(JSON.stringify(clean.state), "utf8");
      if (bytes.length > MAX_STATE_BYTES) failure("CLOUD_PROJECT_STATE_TOO_LARGE");
      const stage = await trustedStaging(stagingRoot); guard();
      const directory = await fsp.mkdtemp(path.join(stage, "cloud-state-"));
      const source = path.join(directory, "state.json");
      let file, identity;
      try {
        file = await fsp.open(source, "wx", 0o600); identity = await file.stat({ bigint: true });
        await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
        guard();
        const result = await uploadCloudProjectAsset({ sourcePath: source, allowedRoots: [directory], stagingRoot: stage,
          maxBytes: MAX_STATE_BYTES, expectedSha256: crypto.createHash("sha256").update(bytes).digest("hex"), expectedSize: bytes.length,
          ...(payload.reservationId ? { reservationId: payload.reservationId } : {}) });
        guard(); return { ...result, removedSecretFields: clean.removedSecretFields };
      } finally {
        if (file) await file.close();
        if (identity) {
          const stat = await fsp.lstat(source, { bigint: true });
          if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) failure("CLOUD_CLEANUP_UNSAFE");
          await fsp.unlink(source);
        }
        await fsp.rmdir(directory);
      }
    }
    if (operation === "read-state") {
      const stage = await trustedStaging(stagingRoot); guard();
      return withDownloadedCloudProjectAsset({ sha256: payload.sha256, size: payload.size, stagingRoot: stage,
        maxBytes: MAX_STATE_BYTES }, async ({ stagedPath, assertSessionActive }) => {
          guard(); assertSessionActive();
          const bytes = await fsp.readFile(stagedPath);
          const state = JSON.parse(bytes.toString("utf8"));
          const { prepareCloudProjectState } = await import("../shared/cloud-project-safety.mjs");
          const clean = prepareCloudProjectState(state);
          if (clean.removedSecretFields || !clean.state || typeof clean.state !== "object" || Array.isArray(clean.state) ||
              !Array.isArray(clean.state.nodes) || !Array.isArray(clean.state.edges)) failure("CLOUD_PROJECT_UNSAFE_STATE");
          guard(); assertSessionActive(); return { state: clean.state };
        });
    }
    if (operation === "download-asset") {
      const stage = await trustedStaging(stagingRoot); guard();
      return withDownloadedCloudProjectAsset({ sha256: payload.sha256, size: payload.size, stagingRoot: stage,
        maxBytes: MAX_ASSET_BYTES }, async ({ stagedPath, sha256, size, assertSessionActive }) => {
          guard(); assertSessionActive();
          return storeDownloadedAsset(mediaRoot, current.projectId, stagedPath, sha256, size,
            payload.mime ?? "", payload.filename ?? "", () => { guard(); assertSessionActive(); });
        });
    }
    if (operation === "download-portable-asset") {
      const stage = await trustedStaging(stagingRoot); guard();
      return withDownloadedCloudProjectAsset({ sha256: payload.sha256, size: payload.size, stagingRoot: stage,
        maxBytes: MAX_PORTABLE_BYTES }, async ({ stagedPath, sha256, size, assertSessionActive }) => {
          guard(); assertSessionActive();
          const bytes = await fsp.readFile(stagedPath);
          if (!bytes.length || bytes.length !== size || crypto.createHash("sha256").update(bytes).digest("hex") !== sha256) {
            failure("CLOUD_INTEGRITY_FAILED");
          }
          guard(); assertSessionActive(); return { sha256, size, bytes };
        });
    }
    failure("CLOUD_PROJECT_OPERATION_INVALID");
  }
  return { invoke };
}
module.exports = { authorizeProjectAsset, createCloudProjectBridge };
