// Headless Windows Electron/DPAPI roundtrip with a fresh synthetic profile.
// Never reads the user's app profile, real credentials, or model endpoints.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {app} = require('electron');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-assistant-dpapi-'));
app.setPath('userData', home);
async function main() {
  if (process.platform !== 'win32') throw Error('WINDOWS_ONLY');
  const {createSystemAssistantCredentialVault, VAULT_NAME, ACCOUNT_VAULT_NAME} = require('../electron/main/assistant-credential-vault.cjs');
  const {createSystemAssistantAccountVault} = require('../electron/main/assistant-account-vault.cjs');
  const vault = createSystemAssistantCredentialVault();
  const accountVault = createSystemAssistantAccountVault();
  const synthetic = 'sk-synthetic-windows-fixture-only';
  assert.equal(await vault.hasCredential(), false);
  await vault.set(synthetic);
  assert.equal(await vault.getForMainProcess(), synthetic);
  assert.equal(fs.readFileSync(path.join(home, VAULT_NAME), 'utf8').includes(synthetic), false);
  const grant = {version:1,issuer:'https://platform.deepseek.com',token:'synthetic-windows-account-grant-only'};
  assert.equal(await accountVault.hasRecord(), false);
  await accountVault.saveGrant(grant);
  assert.deepEqual(await accountVault.getForMainProcess(),grant);
  assert.equal(fs.readFileSync(path.join(home,ACCOUNT_VAULT_NAME),'utf8').includes(grant.token),false);
  await accountVault.clear();
  assert.equal(await accountVault.hasRecord(),false);
  assert.equal(await vault.getForMainProcess(),synthetic,'account disconnect preserves the separate API Key');
  await vault.clear();
  assert.equal(await vault.hasCredential(), false);
  console.log('PASS_ASSISTANT_AND_ACCOUNT_VAULTS_WINDOWS_DPAPI');
}
app.whenReady().then(main).catch(error => {
  console.error('ASSISTANT_WINDOWS_DPAPI_TEST_FAILED', error.code || 'UNKNOWN');
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(home, {recursive:true,force:true});
  app.exit(process.exitCode || 0);
});
