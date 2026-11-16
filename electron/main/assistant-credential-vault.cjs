// Main-process credential storage; plaintext is never persisted here. The API
// key vault and separate account grant are both owned by the assistant host.
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const VAULT_NAME = 'assistant-credential-v1.json';
const ACCOUNT_VAULT_NAME = 'assistant-account-grant-v1.json';
const MAX_FILE_BYTES = 131072;

function vaultError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createAssistantCredentialVault({userDataPath, encrypt, decrypt, vaultName = VAULT_NAME}) {
  if (!path.isAbsolute(userDataPath || '') || typeof encrypt !== 'function' || typeof decrypt !== 'function' || ![VAULT_NAME, ACCOUNT_VAULT_NAME].includes(vaultName)) {
    throw vaultError('ASSISTANT_VAULT_INVALID_CONFIG');
  }
  const vaultFile = path.join(userDataPath, vaultName);
  let previous = Promise.resolve();
  // Ordering avoids a slow encryption overwriting a later logout/rotation.
  function serial(operation) {
    const current = previous.then(operation);
    previous = current.catch(() => {});
    return current;
  }
  async function load() {
    let handle;
    try {
      const entry = await fs.lstat(vaultFile);
      if (!entry.isFile() || entry.isSymbolicLink()) throw vaultError('ASSISTANT_VAULT_INVALID');
      handle = await fs.open(vaultFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > MAX_FILE_BYTES
        || info.dev !== entry.dev || info.ino !== entry.ino) throw vaultError('ASSISTANT_VAULT_INVALID');
      const record = JSON.parse(await handle.readFile('utf8'));
      if (!record || record.version !== 1 || typeof record.ciphertext !== 'string'
        || !record.ciphertext || Object.keys(record).sort().join(',') !== 'ciphertext,version') {
        throw vaultError('ASSISTANT_VAULT_INVALID');
      }
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw vaultError('ASSISTANT_VAULT_INVALID');
    } finally {
      await handle?.close();
    }
  }
  return Object.freeze({
    hasCredential: () => serial(async () => (await load()) !== null),
    getForMainProcess: () => serial(async () => {
      const record = await load();
      if (!record) return null;
      let value;
      try { value = await decrypt(record.ciphertext); } catch { throw vaultError('ASSISTANT_VAULT_DECRYPT_FAILED'); }
      if (typeof value !== 'string' || !value) throw vaultError('ASSISTANT_VAULT_DECRYPT_FAILED');
      return value;
    }),
    set: (value) => serial(async () => {
      if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 8192) {
        throw vaultError('ASSISTANT_VAULT_INVALID_CREDENTIAL');
      }
      // Preserve an existing damaged or unexpected file for recovery.
      await load();
      let ciphertext;
      try { ciphertext = await encrypt(value); } catch { throw vaultError('ASSISTANT_VAULT_ENCRYPT_FAILED'); }
      if (typeof ciphertext !== 'string' || !ciphertext || ciphertext === value) {
        throw vaultError('ASSISTANT_VAULT_ENCRYPT_FAILED');
      }
      const payload = JSON.stringify({version: 1, ciphertext});
      if (Buffer.byteLength(payload, 'utf8') > MAX_FILE_BYTES) throw vaultError('ASSISTANT_VAULT_ENCRYPT_FAILED');
      const temporary = path.join(userDataPath, `.${vaultName}.${randomUUID()}.tmp`);
      let created = false;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        created = true;
        try { await file.writeFile(payload, 'utf8'); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, vaultFile);
        created = false;
      } finally {
        if (created) await fs.unlink(temporary).catch(() => {});
      }
    }),
    clear: () => serial(async () => {
      // Refuse to delete a malformed record or symlink on behalf of the user.
      if (await load()) await fs.unlink(vaultFile);
    }),
  });
}

function createSystemAssistantCredentialVault() {
  const {app} = require('./electron-refs.cjs');
  const {encryptSecret, decryptSecret} = require('./account-secret-storage.cjs');
  return createAssistantCredentialVault({userDataPath: app.getPath('userData'), encrypt: encryptSecret, decrypt: decryptSecret});
}

module.exports = {createAssistantCredentialVault, createSystemAssistantCredentialVault, VAULT_NAME, ACCOUNT_VAULT_NAME};
