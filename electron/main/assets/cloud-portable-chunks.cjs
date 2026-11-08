// Bounded private staging for portable media. No caller-supplied paths are
// accepted and this module never publishes a project snapshot.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CHUNK_BYTES = 1024 * 1024;
const MAX_BYTES = 2 * 1024 ** 3;
const MAX_OPEN = 4;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(code) { const error = new Error(code); error.code = code; throw error; }

function createPortableChunkStore(root, guard) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof guard !== 'function') fail('CLOUD_STAGING_UNSAFE');
  const entries = new Map();
  let pendingBegins = 0;
  let closing = false;
  const pendingWaiters = [];
  async function safeRoot() {
    guard();
    const stat = await fsp.lstat(root), canonical = await fsp.realpath(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(path.resolve(root), canonical) !== '' ||
        (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) {
      fail('CLOUD_STAGING_UNSAFE');
    }
  }
  function entry(id) {
    guard();
    if (closing) fail('CLOUD_CHUNK_CLOSED');
    if (typeof id !== 'string' || !UUID.test(id) || !entries.has(id)) fail('CLOUD_CHUNK_HANDLE_INVALID');
    return entries.get(id);
  }
  async function cleanup(item) {
    if (item.closed) return;
    item.closed = true;
    entries.delete(item.id);
    if (item.file) { await item.file.close(); item.file = null; }
    if (item.reader) { await item.reader.close(); item.reader = null; }
    const current = await fsp.lstat(item.source, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== item.identity.dev ||
        current.ino !== item.identity.ino || current.nlink !== 1n) fail('CLOUD_CLEANUP_UNSAFE');
    await fsp.unlink(item.source);
    await fsp.rmdir(item.directory);
  }
  async function begin(size) {
    if (closing) fail('CLOUD_CHUNK_CLOSED');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || entries.size + pendingBegins >= MAX_OPEN) fail('CLOUD_CHUNK_ARGUMENT_INVALID');
    pendingBegins++;
    let directory, source, file, identity;
    try {
      await safeRoot();
      directory = await fsp.mkdtemp(path.join(root, 'cloud-chunks-'));
      source = path.join(directory, 'asset');
      file = await fsp.open(source, 'wx', 0o600);
      identity = await file.stat({ bigint: true });
      guard();
      if (closing) fail('CLOUD_CHUNK_CLOSED');
      const id = crypto.randomUUID();
      entries.set(id, { id, directory, source, file, identity, size, offset: 0,
        hash: crypto.createHash('sha256'), busy: false, sealed: false, closed: false });
      return { id, chunkBytes: CHUNK_BYTES };
    } catch (error) {
      if (file) {
        await file.close();
        const current = await fsp.lstat(source, { bigint: true });
        if (!identity || !current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) fail('CLOUD_CLEANUP_UNSAFE');
        await fsp.unlink(source);
      }
      if (directory) await fsp.rmdir(directory);
      throw error;
    } finally {
      pendingBegins--;
      if (!pendingBegins) pendingWaiters.splice(0).forEach(resolve => resolve());
    }
  }
  async function append(id, offset, input) {
    const item = entry(id);
    if (item.busy || item.sealed || !Number.isSafeInteger(offset) || offset !== item.offset ||
        !(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > CHUNK_BYTES ||
        item.offset + input.byteLength > item.size) fail('CLOUD_CHUNK_ARGUMENT_INVALID');
    item.busy = true;
    try {
      const bytes = Buffer.from(input);
      let position = 0;
      while (position < bytes.length) {
        const written = await item.file.write(bytes, position, bytes.length - position, item.offset + position);
        if (!written.bytesWritten) fail('CLOUD_STAGING_FAILED');
        position += written.bytesWritten;
      }
      guard();
      item.hash.update(bytes); item.offset += bytes.length;
      return { offset: item.offset };
    } catch (error) {
      await cleanup(item);
      throw error;
    } finally { item.busy = false; }
  }
  async function seal(id) {
    const item = entry(id);
    if (item.busy || item.sealed || item.offset !== item.size) fail('CLOUD_CHUNK_INCOMPLETE');
    item.busy = true;
    try {
      await item.file.sync();
      const actual = await item.file.stat({ bigint: true }), current = await fsp.lstat(item.source, { bigint: true });
      if (!actual.isFile() || actual.nlink !== 1n || actual.dev !== item.identity.dev || actual.ino !== item.identity.ino ||
          actual.size !== BigInt(item.size) || current.isSymbolicLink() || current.dev !== actual.dev || current.ino !== actual.ino) {
        fail('CLOUD_STAGING_UNSAFE');
      }
      const sha256 = item.hash.digest('hex');
      // The rolling hash covers received chunks, but the file could have
      // changed independently. Hash the staged bytes again before handing the
      // path to a consumer; the eventual uploader must also verify this digest.
      const input = await fsp.open(item.source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const before = await input.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.dev !== actual.dev || before.ino !== actual.ino ||
            before.size !== BigInt(item.size)) fail('CLOUD_STAGING_UNSAFE');
        const verify = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        for (;;) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          verify.update(buffer.subarray(0, bytesRead));
        }
        const after = await input.stat({ bigint: true }), pathname = await fsp.lstat(item.source, { bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
            before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || pathname.isSymbolicLink() ||
            pathname.dev !== after.dev || pathname.ino !== after.ino || verify.digest('hex') !== sha256) {
          fail('CLOUD_INTEGRITY_FAILED');
        }
        item.reader = input; item.readIdentity = after;
      } catch (error) { await input.close(); throw error; }
      guard();
      item.sealed = true; item.sha256 = sha256; item.readOffset = 0;
      return { sha256, size: item.size, chunkBytes: CHUNK_BYTES };
    } catch (error) { await cleanup(item); throw error; }
    finally { item.busy = false; }
  }
  async function read(id, offset) {
    const item = entry(id);
    if (!item.sealed || item.busy || !Number.isSafeInteger(offset) || offset !== item.readOffset || offset >= item.size) {
      fail('CLOUD_CHUNK_ARGUMENT_INVALID');
    }
    item.busy = true;
    try {
      const check = async () => {
        const stat = await item.reader.stat({ bigint: true }), name = await fsp.lstat(item.source, { bigint: true });
        if (!stat.isFile() || stat.nlink !== 1n || stat.dev !== item.readIdentity.dev || stat.ino !== item.readIdentity.ino ||
            stat.size !== item.readIdentity.size || stat.mtimeNs !== item.readIdentity.mtimeNs || stat.ctimeNs !== item.readIdentity.ctimeNs ||
            name.isSymbolicLink() || name.dev !== stat.dev || name.ino !== stat.ino) fail('CLOUD_INTEGRITY_FAILED');
      };
      await check();
      const bytes = Buffer.alloc(Math.min(CHUNK_BYTES, item.size - offset));
      let count = 0;
      while (count < bytes.length) {
        const part = await item.reader.read(bytes, count, bytes.length - count, offset + count);
        if (!part.bytesRead) fail('CLOUD_INTEGRITY_FAILED');
        count += part.bytesRead;
      }
      await check(); guard(); item.readOffset += count;
      return { bytes, offset: item.readOffset };
    } catch (error) { await cleanup(item); throw error; }
    finally { item.busy = false; }
  }
  async function consume(id, consumer) {
    if (typeof consumer !== 'function') fail('CLOUD_CHUNK_INCOMPLETE');
    const verified = await seal(id), item = entry(id);
    if (item.busy) fail('CLOUD_CHUNK_BUSY');
    item.busy = true;
    try {
      const result = await consumer({ sourcePath: item.source, allowedRoots: [item.directory], sha256: verified.sha256, size: item.size });
      guard();
      return { sha256: verified.sha256, size: item.size, result };
    } finally { item.busy = false; await cleanup(item); }
  }
  async function abort(id) {
    const item = entry(id);
    if (item.busy) fail('CLOUD_CHUNK_BUSY');
    await cleanup(item);
  }
  async function dispose() {
    // Cleanup remains possible after an account lifecycle guard has failed.
    closing = true;
    if (pendingBegins) await new Promise(resolve => pendingWaiters.push(resolve));
    for (const item of [...entries.values()]) {
      if (item.busy) fail('CLOUD_CHUNK_BUSY');
      await cleanup(item);
    }
  }
  return { begin, append, seal, read, consume, abort, dispose };
}

module.exports = { createPortableChunkStore, CHUNK_BYTES, MAX_BYTES };
