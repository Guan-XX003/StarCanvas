// Local media staging for cloud project uploads. This module has no IPC or
// network access. The caller must derive asset roots and selected project
// bindings from trusted application state, and consume the staged file only
// inside the callback. Renderer-supplied roots are never acceptable.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

class CloudMediaError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new CloudMediaError(code); };
const contained = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const samePath = (a, b) => path.relative(a, b) === "" && path.relative(b, a) === "";
const stamp = (stat) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
const sameStamp = (a, b) => stamp(a).every((value, index) => value === stamp(b)[index]);

async function withPreparedCloudAsset({ sourcePath, allowedRoots, stagingRoot, maxBytes, expectedSha256, expectedSize }, consume) {
  if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath) || sourcePath.includes("\0") ||
      !Array.isArray(allowedRoots) || !allowedRoots.length || allowedRoots.length > 20 ||
      typeof stagingRoot !== "string" || !path.isAbsolute(stagingRoot) ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof consume !== "function" ||
      (expectedSha256 !== undefined && (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256))) ||
      (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0))) {
    fail("CLOUD_MEDIA_ARGUMENT_INVALID");
  }
  let source, staged, directory, stagedPath, stagedIdentity;
  try {
    const roots = [];
    for (const root of allowedRoots) {
      if (typeof root !== "string" || !path.isAbsolute(root)) fail("CLOUD_MEDIA_ROOT_INVALID");
      const canonical = await fsp.realpath(root);
      if (!samePath(canonical, path.resolve(root)) || !(await fsp.stat(canonical)).isDirectory()) fail("CLOUD_MEDIA_ROOT_INVALID");
      roots.push(canonical);
    }
    const candidate = path.resolve(sourcePath);
    const canonical = await fsp.realpath(candidate);
    if (!samePath(candidate, canonical) || !roots.some((root) => contained(root, canonical))) fail("CLOUD_MEDIA_OUTSIDE_ROOT");
    const tempRoot = await fsp.realpath(stagingRoot);
    const rootStat = await fsp.lstat(stagingRoot);
    if (!samePath(tempRoot, path.resolve(stagingRoot)) || !rootStat.isDirectory() || rootStat.isSymbolicLink() ||
        (process.platform !== "win32" && (rootStat.uid !== process.getuid() || (rootStat.mode & 0o077) !== 0))) {
      fail("CLOUD_MEDIA_STAGING_UNSAFE");
    }
    source = await fsp.open(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await source.stat({ bigint: true });
    const initialPathStat = await fsp.stat(canonical, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || !sameStamp(before, initialPathStat) || before.size > BigInt(maxBytes)) {
      fail("CLOUD_MEDIA_SOURCE_INVALID");
    }
    if (expectedSize !== undefined && before.size !== BigInt(expectedSize)) fail("CLOUD_MEDIA_SOURCE_CHANGED");
    directory = await fsp.mkdtemp(path.join(tempRoot, "cloud-media-"));
    stagedPath = path.join(directory, "asset");
    staged = await fsp.open(stagedPath, "wx", 0o600);
    stagedIdentity = await staged.stat({ bigint: true });
    const digest = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes || BigInt(total) > before.size) fail("CLOUD_MEDIA_SOURCE_CHANGED");
      digest.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await staged.write(buffer, offset, bytesRead - offset, null);
        if (!bytesWritten) fail("CLOUD_MEDIA_WRITE_FAILED");
        offset += bytesWritten;
      }
    }
    const after = await source.stat({ bigint: true });
    const finalPath = await fsp.realpath(candidate);
    const finalPathStat = await fsp.stat(candidate, { bigint: true });
    const sha256 = digest.digest("hex");
    if (!samePath(canonical, finalPath) || !sameStamp(before, after) || !sameStamp(after, finalPathStat) ||
        BigInt(total) !== before.size || (expectedSha256 && expectedSha256 !== sha256)) fail("CLOUD_MEDIA_SOURCE_CHANGED");
    await staged.sync();
    await staged.close(); staged = null;
    return await consume({ stagedPath, sha256, size: total });
  } catch (error) {
    if (error instanceof CloudMediaError) throw error;
    // Do not leak source paths, user data or credentials in thrown diagnostics.
    throw new CloudMediaError("CLOUD_MEDIA_PREPARATION_FAILED");
  } finally {
    if (source) await source.close().catch(() => fail("CLOUD_MEDIA_CLEANUP_UNSAFE"));
    if (staged) await staged.close().catch(() => fail("CLOUD_MEDIA_CLEANUP_UNSAFE"));
    if (stagedPath && stagedIdentity) {
      try {
        const current = await fsp.lstat(stagedPath, { bigint: true });
        if (current.dev !== stagedIdentity.dev || current.ino !== stagedIdentity.ino || !current.isFile()) {
          fail("CLOUD_MEDIA_CLEANUP_UNSAFE");
        }
        await fsp.unlink(stagedPath);
      } catch (error) {
        if (error?.code !== "ENOENT") fail("CLOUD_MEDIA_CLEANUP_UNSAFE");
      }
    }
    if (directory) await fsp.rmdir(directory).catch(() => fail("CLOUD_MEDIA_CLEANUP_UNSAFE"));
  }
}

module.exports = { CloudMediaError, withPreparedCloudAsset };
