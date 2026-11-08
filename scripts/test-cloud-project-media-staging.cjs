const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, stat, rm, realpath } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const test = require("node:test");
const { withPreparedCloudAsset } = require("../electron/main/assets/cloud-project-media.cjs");

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(await realpath(os.tmpdir()), "sc-cloud-media-test-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "assets"), stagingRoot = path.join(base, "staging");
  await mkdir(root, { mode: 0o700 }); await mkdir(stagingRoot, { mode: 0o700 });
  return { base, root, stagingRoot };
}
const failure = (code) => (error) => error.code === code && !error.message.includes(os.tmpdir());

test("stages an immutable snapshot and cleans its own temporary files", async (t) => {
  const { root, stagingRoot } = await fixture(t);
  const source = path.join(root, "sample.png"), data = Buffer.from("synthetic asset only");
  await writeFile(source, data);
  const expected = crypto.createHash("sha256").update(data).digest("hex");
  const result = await withPreparedCloudAsset({ sourcePath: source, allowedRoots: [root], stagingRoot,
    maxBytes: 1024, expectedSha256: expected, expectedSize: data.length }, async ({ stagedPath, sha256, size }) => {
      assert.equal(sha256, expected); assert.equal(size, data.length);
      assert.deepEqual(await readFile(stagedPath), data);
      if (process.platform !== "win32") assert.equal((await stat(stagedPath)).mode & 0o077, 0);
      await writeFile(source, "modified after staging");
      assert.deepEqual(await readFile(stagedPath), data);
      return "completed";
    });
  assert.equal(result, "completed");
  assert.deepEqual(await readdir(stagingRoot), []);
});

test("rejects unapproved paths, symlinks, changed hashes and size limits", async (t) => {
  const { base, root, stagingRoot } = await fixture(t);
  const source = path.join(root, "file.bin"), outside = path.join(base, "outside.bin");
  await writeFile(source, "abc"); await writeFile(outside, "secret");
  const baseOptions = { allowedRoots: [root], stagingRoot, maxBytes: 3 };
  await assert.rejects(withPreparedCloudAsset({ ...baseOptions, sourcePath: outside }, () => {}), failure("CLOUD_MEDIA_OUTSIDE_ROOT"));
  const link = path.join(root, "escape");
  try {
    await symlink(outside, link);
    await assert.rejects(withPreparedCloudAsset({ ...baseOptions, sourcePath: link }, () => {}), failure("CLOUD_MEDIA_OUTSIDE_ROOT"));
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }
  await assert.rejects(withPreparedCloudAsset({ ...baseOptions, sourcePath: source, expectedSha256: "f".repeat(64) }, () => {}), failure("CLOUD_MEDIA_SOURCE_CHANGED"));
  await assert.rejects(withPreparedCloudAsset({ ...baseOptions, sourcePath: source, expectedSize: 2 }, () => {}), failure("CLOUD_MEDIA_SOURCE_CHANGED"));
  await assert.rejects(withPreparedCloudAsset({ ...baseOptions, sourcePath: source, maxBytes: 2 }, () => {}), failure("CLOUD_MEDIA_SOURCE_INVALID"));
  assert.deepEqual(await readdir(stagingRoot), []);
});

test("callback failure does not retain staged files or reveal local paths", async (t) => {
  const { root, stagingRoot } = await fixture(t), source = path.join(root, "file.bin");
  await writeFile(source, "abc");
  await assert.rejects(withPreparedCloudAsset({ sourcePath: source, allowedRoots: [root], stagingRoot, maxBytes: 10 },
    () => { throw new Error(`sensitive ${source}`); }), failure("CLOUD_MEDIA_PREPARATION_FAILED"));
  assert.deepEqual(await readdir(stagingRoot), []);
});
