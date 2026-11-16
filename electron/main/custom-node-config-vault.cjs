// Immutable encrypted custom-node configurations. Normal canvas persistence and
// selected backup import use local references; runtime values stay in memory.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const DIRECTORY = 'custom-node-config-v1';
const PREFIX = 'custom-config-v1:';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PLAINTEXT = 256 * 1024;
const MAX_RECORD = 1024 * 1024;
const fail = code => Object.assign(new Error(code), {code});

function createCustomNodeConfigVault({userDataPath, encrypt, decrypt}) {
  if (!path.isAbsolute(userDataPath || '') || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw fail('CONFIG_VAULT_INVALID');
  const directory = path.join(userDataPath, DIRECTORY);

  async function secureDirectory(create) {
    const parent = await fs.lstat(userDataPath);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('CONFIG_VAULT_UNSAFE_DIRECTORY');
    if (create) await fs.mkdir(directory, {mode:0o700}).catch(error => {if (error.code !== 'EEXIST') throw error;});
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail('CONFIG_VAULT_UNSAFE_DIRECTORY');
  }
  function fileFor(reference) {
    const id = typeof reference === 'string' && reference.startsWith(PREFIX) ? reference.slice(PREFIX.length) : '';
    if (!ID.test(id)) throw fail('CONFIG_VAULT_INVALID_REFERENCE');
    return path.join(directory, `${id}.json`);
  }
  function parseConfig(text) {
    let value;
    try { value = JSON.parse(text); } catch { throw fail('CONFIG_VAULT_INVALID_CONTENT'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('CONFIG_VAULT_INVALID_CONTENT');
    return value;
  }

  return Object.freeze({
    async put(config) {
      let plaintext;
      try { plaintext = JSON.stringify(config); } catch { throw fail('CONFIG_VAULT_INVALID_CONTENT'); }
      if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MAX_PLAINTEXT) throw fail('CONFIG_VAULT_INVALID_CONTENT');
      parseConfig(plaintext);
      let ciphertext;
      try { ciphertext = await encrypt(plaintext); } catch { throw fail('CONFIG_VAULT_ENCRYPT_FAILED'); }
      if (typeof ciphertext !== 'string' || !ciphertext || ciphertext.includes(plaintext)) throw fail('CONFIG_VAULT_ENCRYPT_FAILED');
      const bytes = Buffer.from(JSON.stringify({version:1,ciphertext}));
      if (bytes.length > MAX_RECORD) throw fail('CONFIG_VAULT_ENCRYPT_FAILED');
      await secureDirectory(true);
      const reference = PREFIX + randomUUID();
      const target = fileFor(reference);
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      let created = false;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600); created = true;
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        // link publishes a fully written immutable file and never overwrites a
        // prior version, even when concurrent saves complete out of order.
        await fs.link(temporary, target);
        await fs.unlink(temporary); created = false;
        return reference;
      } finally { if (created) await fs.unlink(temporary).catch(() => {}); }
    },
    async get(reference) {
      const filename = fileFor(reference);
      let handle;
      try {
        await secureDirectory(false);
        const entry = await fs.lstat(filename);
        if (!entry.isFile() || entry.isSymbolicLink()) throw fail('CONFIG_VAULT_INVALID_RECORD');
        handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const stat = await handle.stat();
        if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino || stat.size < 1 || stat.size > MAX_RECORD) throw fail('CONFIG_VAULT_INVALID_RECORD');
        const record = JSON.parse(await handle.readFile('utf8'));
        if (!record || Object.keys(record).sort().join(',') !== 'ciphertext,version' || record.version !== 1 || typeof record.ciphertext !== 'string' || !record.ciphertext) throw fail('CONFIG_VAULT_INVALID_RECORD');
        let plaintext;
        try { plaintext = await decrypt(record.ciphertext); } catch { throw fail('CONFIG_VAULT_DECRYPT_FAILED'); }
        if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MAX_PLAINTEXT) throw fail('CONFIG_VAULT_DECRYPT_FAILED');
        return parseConfig(plaintext);
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('CONFIG_VAULT_')) throw error;
        throw fail(error?.code === 'ENOENT' ? 'CONFIG_VAULT_NOT_FOUND' : 'CONFIG_VAULT_INVALID_RECORD');
      } finally { await handle?.close(); }
    },
  });
}
module.exports = {createCustomNodeConfigVault, PREFIX};
