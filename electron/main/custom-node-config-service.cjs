// Serialized service boundary for normal canvas persistence and selected backup
// import. Trusted IPC returns only a reference on protection, not ciphertext.
const {createCustomNodeConfigVault} = require('./custom-node-config-vault.cjs');
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_HELPER_PAYLOAD = 131072;
const SAFE_CODES = new Set(['CONFIG_VAULT_INVALID_CONTENT','CONFIG_VAULT_INVALID_REFERENCE','CONFIG_VAULT_NOT_FOUND','CONFIG_VAULT_INVALID_RECORD','CONFIG_VAULT_DECRYPT_FAILED','CONFIG_VAULT_ENCRYPT_FAILED','CONFIG_VAULT_UNSAFE_DIRECTORY']);

function createCustomNodeConfigService(vault) {
  if (!vault || typeof vault.put !== 'function' || typeof vault.get !== 'function') throw new Error('CONFIG_SERVICE_INVALID');
  let previous = Promise.resolve();
  const serial = operation => { const current = previous.then(operation); previous = current.catch(() => {}); return current; };
  const errorResult = error => ({ok:false,code:SAFE_CODES.has(error?.code) ? error.code : 'CONFIG_VAULT_UNAVAILABLE'});
  return Object.freeze({
    protect: config => {
      let value;
      try { value = JSON.stringify(config); } catch { return Promise.resolve({ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'}); }
      if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_PLAINTEXT_BYTES || Buffer.byteLength(JSON.stringify({operation:'encrypt',value})) > MAX_HELPER_PAYLOAD) return Promise.resolve({ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'});
      // Capture a JSON snapshot before awaiting native storage; subsequent UI
      // edits cannot silently change what this operation is asked to protect.
      let snapshot;
      try { snapshot=JSON.parse(value); } catch { return Promise.resolve({ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'}); }
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return Promise.resolve({ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'});
      return serial(async () => {try { return {ok:true,reference:await vault.put(snapshot)}; } catch (error) { return errorResult(error); }});
    },
    restore: reference => serial(async () => {
      try { return {ok:true,config:await vault.get(reference)}; } catch (error) { return errorResult(error); }
    }),
  });
}

function createSystemCustomNodeConfigService() {
  const {app} = require('./electron-refs.cjs');
  const {encryptSecret,decryptSecret} = require('./account-secret-storage.cjs');
  return createCustomNodeConfigService(createCustomNodeConfigVault({userDataPath:app.getPath('userData'),encrypt:encryptSecret,decrypt:decryptSecret}));
}
module.exports = {createCustomNodeConfigService,createSystemCustomNodeConfigService};
