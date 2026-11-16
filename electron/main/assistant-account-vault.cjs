// Main-process-only account grant storage. It never exposes a token to the
// renderer or reuses another application's key.
const {createAssistantCredentialVault, ACCOUNT_VAULT_NAME} = require('./assistant-credential-vault.cjs');
const ISSUER = 'https://platform.deepseek.com';
function failure() { const error = new Error('ASSISTANT_ACCOUNT_GRANT_INVALID'); error.code = 'ASSISTANT_ACCOUNT_GRANT_INVALID'; return error; }
function validateGrant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'issuer,token,version' || value.version !== 1 || value.issuer !== ISSUER || typeof value.token !== 'string' || !/^[\x21-\x7e]+$/.test(value.token)) throw failure();
  const encoded = JSON.stringify({version:1,token:value.token,issuer:ISSUER});
  if (Buffer.byteLength(encoded, 'utf8') > 8192) throw failure();
  return encoded;
}
function createAssistantAccountVault({userDataPath, encrypt, decrypt}) {
  const vault = createAssistantCredentialVault({userDataPath, encrypt, decrypt, vaultName:ACCOUNT_VAULT_NAME});
  let pending = Promise.resolve();
  function serial(fn) { const next = pending.then(fn); pending = next.catch(() => {}); return next; }
  async function readValidated() {
    const text = await vault.getForMainProcess();
    if (text === null) return null;
    let result;
    try { result = JSON.parse(text); validateGrant(result); } catch { throw failure(); }
    return result;
  }
  return Object.freeze({
    // Presence only, not proof of decryption, validity or an active session.
    hasRecord: () => serial(() => vault.hasCredential()),
    getForMainProcess: () => serial(readValidated),
    saveGrant: value => serial(async () => { const text = validateGrant(value); await readValidated(); await vault.set(text); }),
    clear: () => serial(async () => { if (await readValidated()) await vault.clear(); }),
  });
}
function createSystemAssistantAccountVault() {
  const {app} = require('./electron-refs.cjs');
  const {encryptSecret, decryptSecret} = require('./account-secret-storage.cjs');
  return createAssistantAccountVault({userDataPath:app.getPath('userData'), encrypt:encryptSecret, decrypt:decryptSecret});
}
module.exports = {createAssistantAccountVault, createSystemAssistantAccountVault};
