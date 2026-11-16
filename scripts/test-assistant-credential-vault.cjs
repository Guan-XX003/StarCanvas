const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createAssistantCredentialVault, VAULT_NAME} = require('../electron/main/assistant-credential-vault.cjs');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-vault-test-'));
  // Synthetic encryption: exercises the vault, not the OS Keychain/DPAPI.
  const key = crypto.randomBytes(32);
  let fail = false;
  const encrypt = async value => {
    if (fail) throw Error('synthetic failure');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  };
  const decrypt = async value => {
    const data = Buffer.from(value, 'base64');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  };
  try {
    const vault = createAssistantCredentialVault({userDataPath: directory, encrypt, decrypt});
    const secret = 'synthetic-api-key-123456789';
    assert.equal(await vault.hasCredential(), false);
    assert.equal(await vault.getForMainProcess(), null);
    await vault.set(secret);
    assert.equal(await vault.getForMainProcess(), secret);
    const content = await fs.readFile(path.join(directory, VAULT_NAME), 'utf8');
    assert.equal(content.includes(secret), false);
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(directory, VAULT_NAME))).mode & 0o077, 0);
    fail = true;
    await assert.rejects(vault.set('different-synthetic-key'), {code: 'ASSISTANT_VAULT_ENCRYPT_FAILED'});
    assert.equal(await vault.getForMainProcess(), secret, 'failed encryption preserves the previous record');
    fail = false;
    await Promise.all([vault.set('synthetic-second-key'), vault.clear()]);
    assert.equal(await vault.hasCredential(), false, 'clear wins over earlier in-flight write');
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const slowVault = createAssistantCredentialVault({userDataPath: directory, encrypt: async value => { await wait; return encrypt(value); }, decrypt});
    const first = slowVault.set('synthetic-slow-key');
    const second = slowVault.clear();
    release();
    await Promise.all([first, second]);
    assert.equal(await slowVault.hasCredential(), false, 'clear is serialized after a slow encryption');
    await assert.rejects(vault.set(''), {code: 'ASSISTANT_VAULT_INVALID_CREDENTIAL'});
    await fs.writeFile(path.join(directory, VAULT_NAME), '{invalid');
    await assert.rejects(vault.getForMainProcess(), {code: 'ASSISTANT_VAULT_INVALID'});
    await assert.rejects(vault.set(secret), {code: 'ASSISTANT_VAULT_INVALID'});
    await assert.rejects(vault.clear(), {code: 'ASSISTANT_VAULT_INVALID'});
    if (process.platform !== 'win32') {
      await fs.unlink(path.join(directory, VAULT_NAME));
      await fs.symlink(path.join(directory, 'other'), path.join(directory, VAULT_NAME));
      await assert.rejects(vault.set(secret), {code: 'ASSISTANT_VAULT_INVALID'});
      await assert.rejects(vault.clear(), {code: 'ASSISTANT_VAULT_INVALID'});
    }
    console.log('PASS_ASSISTANT_CREDENTIAL_VAULT_SYNTHETIC');
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
}
main().catch(() => { console.error('ASSISTANT_CREDENTIAL_VAULT_TEST_FAILED'); process.exitCode = 1; });
