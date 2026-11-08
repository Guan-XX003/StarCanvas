const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {readFileSync} = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
function load(name, dependencies = {}) {
  const filename = path.resolve(__dirname, `../src/renderer/lib/${name}.ts`);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths;
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : original(id);
  mod._compile(output, filename); return mod.exports;
}
const safety = load('cloud-project-safety');
const {decodePortableDataChunks, encodePortableDataChunks} = load('cloud-portable-chunks', {'./cloud-project-safety': safety});
const {createPortableChunkStore} = require('../electron/main/assets/cloud-portable-chunks.cjs');

test('decodes bounded sequential chunks without changing the content', async () => {
  for (const length of [1, 2, 3, 1024 * 1024 - 1, 1024 * 1024 + 5]) {
    const source = crypto.randomBytes(length), parts = [];
    let expectedOffset = 0;
    const info = await decodePortableDataChunks(`data:image/png;base64,${source.toString('base64')}`, async (bytes, offset) => {
      assert.equal(offset, expectedOffset); assert(bytes.length <= 1024 * 1024);
      expectedOffset += bytes.length; parts.push(Buffer.from(bytes));
    });
    assert.deepEqual(Buffer.concat(parts), source);
    assert.deepEqual(info, {mime: 'image/png', size: source.length});
  }
});

test('rejects malformed, noncanonical and oversized content', async () => {
  for (const value of ['data:image/png;base64,', 'data:image/png;base64,eA=', 'data:image/png;base64,eB==',
    'data:image/png;base64,eA==eA==', 'data:image/png;base64,eA==\n', 'blob:local',
    'data:image/png;base64,%%%%']) {
    await assert.rejects(decodePortableDataChunks(value, async () => {}), error => error.code === 'MEDIA_NOT_PREPARED');
  }
  let writes = 0;
  await assert.rejects(decodePortableDataChunks('data:image/png;base64,YWJj', async () => { writes++; }, 2),
    error => error.code === 'MEDIA_NOT_PREPARED');
  assert.equal(writes, 0);
});

test('a write failure stops decoding immediately', async () => {
  const source = Buffer.alloc(2 * 1024 * 1024, 7);
  let writes = 0;
  await assert.rejects(decodePortableDataChunks(`data:video/mp4;base64,${source.toString('base64')}`, async () => {
    writes++; throw new Error('synthetic write failed');
  }), /synthetic write failed/);
  assert.equal(writes, 1);
});

test('decoder and private stage preserve bytes with bounded chunks', async t => {
  const fs = require('node:fs/promises'), os = require('node:os');
  const root = await fs.realpath(await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'sc-chunk-pipeline-')));
  t.after(async () => fs.rm(root, {recursive: true, force: true}));
  const source = crypto.randomBytes(1024 * 1024 + 17);
  const store = createPortableChunkStore(root, () => {}), {id} = await store.begin(source.length);
  const info = await decodePortableDataChunks(`data:image/png;base64,${source.toString('base64')}`,
    (bytes, offset) => store.append(id, offset, bytes));
  assert.equal(info.size, source.length);
  await store.consume(id, async ({sourcePath, sha256}) => {
    assert.deepEqual(await fs.readFile(sourcePath), source);
    assert.equal(sha256, crypto.createHash('sha256').update(source).digest('hex'));
  });
  assert.deepEqual(await fs.readdir(root), []);
});

test('restores base64 across non-aligned chunk boundaries and rejects a wrong digest', async () => {
  for (const length of [1, 2, 3, 1024 * 1024 + 5]) {
    const source = crypto.randomBytes(length), digest = crypto.createHash('sha256').update(source).digest('hex');
    const read = async offset => {
      const bytes = source.subarray(offset, Math.min(offset + 1024 * 1024, source.length));
      return {bytes, offset: offset + bytes.length};
    };
    assert.equal(await encodePortableDataChunks(length, 'image/png', digest, read),
      `data:image/png;base64,${source.toString('base64')}`);
    await assert.rejects(encodePortableDataChunks(length, 'image/png', '0'.repeat(64), read),
      error => error.code === 'MEDIA_NOT_PREPARED');
  }
});

test('long decoding and encoding yield to other event-loop tasks', async () => {
  const source = Buffer.alloc(3 * 1024 * 1024, 0x5a), url = `data:image/png;base64,${source.toString('base64')}`;
  let tick = false, observedDuringDecode = false;
  setTimeout(() => { tick = true; }, 0);
  await decodePortableDataChunks(url, async () => { if (tick) observedDuringDecode = true; });
  assert.equal(observedDuringDecode, true);
  tick = false;
  let observedDuringEncode = false;
  setTimeout(() => { tick = true; }, 0);
  await encodePortableDataChunks(source.length, 'image/png', crypto.createHash('sha256').update(source).digest('hex'), async offset => {
    if (tick) observedDuringEncode = true;
    const bytes = source.subarray(offset, Math.min(offset + 1024 * 1024, source.length));
    return {bytes, offset: offset + bytes.length};
  });
  assert.equal(observedDuringEncode, true);
});

test('129 MiB data URL decodes and reconstructs with the same digest',
  {skip: process.env.STARCANVAS_TEST_LARGE_RENDERER !== '1', timeout: 180000}, async () => {
    const source = Buffer.alloc(129 * 1024 * 1024, 0x5a);
    const expected = crypto.createHash('sha256').update(source).digest('hex');
    const url = `data:video/mp4;base64,${source.toString('base64')}`;
    const decoded = crypto.createHash('sha256');
    const info = await decodePortableDataChunks(url, async bytes => { decoded.update(bytes); });
    assert.equal(info.size, source.length);
    assert.equal(decoded.digest('hex'), expected);
    const reconstructed = await encodePortableDataChunks(source.length, 'video/mp4', expected, async offset => {
      const bytes = source.subarray(offset, Math.min(offset + 1024 * 1024, source.length));
      return {bytes, offset: offset + bytes.length};
    });
    assert.equal(reconstructed, url);
  });
