// Synthetic macOS Keychain integration using a unique QA-only item and userData.
// No real user credentials, model call, or production Keychain service is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {app} = require('electron');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starcanvas-assistant-vault-electron-'));
const service = `org.starcanvas.account-secret.qa.${crypto.randomUUID().toUpperCase()}`;
process.env.WANJUAN_TEST_USER_DATA_PATH = home;
process.env.STARCANVAS_DEV_KEYCHAIN_QA = '1';
process.env.STARCANVAS_KEYCHAIN_QA_SERVICE = service;
app.setPath('userData', home);
// This isolated test is launched as a script, rather than through the app's
// package entry. Keep the helper lookup rooted at the actual source tree.
app.getAppPath = () => path.resolve(__dirname, '..');

async function main() {
  if (process.platform !== 'darwin') throw Error('MACOS_ONLY');
  const {createSystemAssistantCredentialVault, VAULT_NAME, ACCOUNT_VAULT_NAME} = require('../electron/main/assistant-credential-vault.cjs');
  const {createSystemAssistantAccountVault} = require('../electron/main/assistant-account-vault.cjs');
  const vault = createSystemAssistantCredentialVault();
  const accountVault = createSystemAssistantAccountVault();
  const synthetic = 'sk-synthetic-assistant-fixture-only';
  assert.equal(await vault.hasCredential(), false);
  await vault.set(synthetic);
  assert.equal(await vault.getForMainProcess(), synthetic);
  assert.equal(fs.readFileSync(path.join(home, VAULT_NAME), 'utf8').includes(synthetic), false);
  const grant = {version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-grant-only'};
  assert.equal(await accountVault.hasRecord(),false);
  await accountVault.saveGrant(grant);
  assert.deepEqual(await accountVault.getForMainProcess(),grant);
  assert.equal(fs.readFileSync(path.join(home,ACCOUNT_VAULT_NAME),'utf8').includes(grant.token),false);
  await accountVault.clear();
  assert.equal(await accountVault.hasRecord(),false);
  assert.equal(await vault.getForMainProcess(),synthetic,'account disconnect preserves the separate API Key');
  await vault.clear();
  assert.equal(await vault.hasCredential(), false);
  console.log('PASS_ASSISTANT_AND_ACCOUNT_VAULTS_ELECTRON_SYNTHETIC_KEYCHAIN');
}
app.whenReady().then(main).catch(error => {
  console.error('ASSISTANT_VAULT_ELECTRON_TEST_FAILED', error.code || 'UNKNOWN');
  process.exitCode = 1;
}).finally(() => {
  // Only the newly-generated QA item is eligible for deletion.
  const executable = path.join(__dirname, '..', 'build', 'native-tools', 'macos-account-keychain');
  const cleanup = spawnSync(executable, [], {
    input:JSON.stringify({operation:'qa-delete', value:'', qaService:service}),
    encoding:'utf8', timeout:10000, env:{...process.env,STARCANVAS_KEYCHAIN_QA:'1'},
  });
  try { if (cleanup.status !== 0 || JSON.parse(cleanup.stdout).ok !== true) throw Error(); }
  catch { console.error('SYNTHETIC_KEYCHAIN_CLEANUP_FAILED'); process.exitCode = 1; }
  fs.rmSync(home, {recursive:true, force:true});
  app.exit(process.exitCode || 0);
});
