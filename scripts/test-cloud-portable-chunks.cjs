const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createPortableChunkStore, CHUNK_BYTES, MAX_BYTES} = require('../electron/main/assets/cloud-portable-chunks.cjs');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'sc-chunk-test-')));
  await fs.chmod(root, 0o700);
  t.after(async () => fs.rm(root, {recursive: true, force: true}));
  return root;
}

test('sequential bounded chunks produce exact bytes and digest, then remove only own staging', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  const bytes = crypto.randomBytes(CHUNK_BYTES + 19), {id} = await store.begin(bytes.length);
  await store.append(id, 0, bytes.subarray(0, CHUNK_BYTES));
  await store.append(id, CHUNK_BYTES, bytes.subarray(CHUNK_BYTES));
  const result = await store.consume(id, async ({sourcePath, allowedRoots, sha256, size}) => {
    assert.equal(path.dirname(sourcePath), allowedRoots[0]);
    assert.deepEqual(await fs.readFile(sourcePath), bytes);
    assert.equal(sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(size, bytes.length);
    return 'synthetic';
  });
  assert.equal(result.result, 'synthetic');
  assert.deepEqual(await fs.readdir(root), []);
  await assert.rejects(store.abort(id), error => error.code === 'CLOUD_CHUNK_HANDLE_INVALID');
});

test('invalid size, chunks, offsets and incomplete finish fail closed', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  for (const size of [0, -1, MAX_BYTES + 1, 1.5])
    await assert.rejects(store.begin(size), error => error.code === 'CLOUD_CHUNK_ARGUMENT_INVALID');
  const {id} = await store.begin(3);
  for (const [offset, bytes] of [[1, Buffer.from('x')], [0, Buffer.alloc(0)], [0, Buffer.alloc(CHUNK_BYTES + 1)], [0, Buffer.alloc(4)]])
    await assert.rejects(store.append(id, offset, bytes), error => error.code === 'CLOUD_CHUNK_ARGUMENT_INVALID');
  await assert.rejects(store.consume(id, async () => {}), error => error.code === 'CLOUD_CHUNK_INCOMPLETE');
  await store.abort(id);
  assert.deepEqual(await fs.readdir(root), []);
});

test('account change and consumer failure leave no consumable partial asset', async t => {
  const root = await fixture(t);
  let active = true;
  const store = createPortableChunkStore(root, () => { if (!active) throw Object.assign(new Error('changed'), {code: 'ACCOUNT_SESSION_CHANGED'}); });
  const a = await store.begin(1);
  await store.append(a.id, 0, Buffer.from('a'));
  await assert.rejects(store.consume(a.id, async () => { throw new Error('synthetic failure'); }));
  const b = await store.begin(1);
  active = false;
  await assert.rejects(store.append(b.id, 0, Buffer.from('b')), error => error.code === 'ACCOUNT_SESSION_CHANGED');
  await store.dispose();
  assert.deepEqual(await fs.readdir(root), []);
});

test('changed staging bytes are rejected before a consumer can use them', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  const {id} = await store.begin(3);
  await store.append(id, 0, Buffer.from('abc'));
  const [directory] = await fs.readdir(root);
  await fs.writeFile(path.join(root, directory, 'asset'), 'xyz');
  let invoked = false;
  await assert.rejects(store.consume(id, async () => { invoked = true; }),
    error => error.code === 'CLOUD_INTEGRITY_FAILED');
  assert.equal(invoked, false);
  assert.deepEqual(await fs.readdir(root), []);
});

test('sealed data reads sequentially and detects changes before returning a chunk', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  const source = crypto.randomBytes(CHUNK_BYTES + 5), {id} = await store.begin(source.length);
  await store.append(id, 0, source.subarray(0, CHUNK_BYTES));
  await store.append(id, CHUNK_BYTES, source.subarray(CHUNK_BYTES));
  const metadata = await store.seal(id);
  assert.equal(metadata.sha256, crypto.createHash('sha256').update(source).digest('hex'));
  await assert.rejects(store.read(id, 1), error => error.code === 'CLOUD_CHUNK_ARGUMENT_INVALID');
  const first = await store.read(id, 0), last = await store.read(id, first.offset);
  assert.deepEqual(Buffer.concat([first.bytes, last.bytes]), source);
  await store.abort(id);
  const other = await store.begin(3);
  await store.append(other.id, 0, Buffer.from('abc'));
  await store.seal(other.id);
  const [directory] = await fs.readdir(root);
  await fs.writeFile(path.join(root, directory, 'asset'), 'xyz');
  await assert.rejects(store.read(other.id, 0), error => error.code === 'CLOUD_INTEGRITY_FAILED');
  assert.deepEqual(await fs.readdir(root), []);
});

test('concurrent creation respects the per-session handle limit', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  const results = await Promise.allSettled(Array.from({length: 6}, () => store.begin(1)));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 4);
  assert.equal(results.filter(item => item.status === 'rejected').length, 2);
  await store.dispose();
  assert.deepEqual(await fs.readdir(root), []);
});

test('disposing while a staging file is being created cannot leak a new handle', async t => {
  const root = await fixture(t), store = createPortableChunkStore(root, () => {});
  const pending = store.begin(1);
  const settled = Promise.allSettled([pending]);
  await store.dispose();
  const [result] = await settled;
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason.code, 'CLOUD_CHUNK_CLOSED');
  await assert.rejects(store.begin(1), error => error.code === 'CLOUD_CHUNK_CLOSED');
  assert.deepEqual(await fs.readdir(root), []);
});

test('129 MiB synthetic input stages in bounded chunks with a matching streamed digest',
  {skip: process.env.STARCANVAS_TEST_LARGE_CHUNKS !== '1'}, async t => {
    const root = await fixture(t), store = createPortableChunkStore(root, () => {});
    const chunk = Buffer.alloc(CHUNK_BYTES, 0x5a), count = 129;
    const expected = crypto.createHash('sha256');
    const {id} = await store.begin(chunk.length * count);
    for (let i = 0; i < count; i++) {
      await store.append(id, i * chunk.length, chunk);
      expected.update(chunk);
    }
    const digest = expected.digest('hex');
    await store.consume(id, async ({sourcePath, sha256, size}) => {
      assert.equal(sha256, digest);
      assert.equal(size, chunk.length * count);
      const actual = crypto.createHash('sha256');
      for await (const part of require('node:fs').createReadStream(sourcePath)) actual.update(part);
      assert.equal(actual.digest('hex'), digest);
    });
    assert.deepEqual(await fs.readdir(root), []);
  });
