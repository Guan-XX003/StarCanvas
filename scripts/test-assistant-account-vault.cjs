const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createAssistantCredentialVault, VAULT_NAME, ACCOUNT_VAULT_NAME} = require('../electron/main/assistant-credential-vault.cjs');
const {createAssistantAccountVault} = require('../electron/main/assistant-account-vault.cjs');

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-account-vault-test-'));
  const key = crypto.randomBytes(32);
  const encrypt = async text => {
    const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
  };
  const decrypt = async data => {
    const b=Buffer.from(data,'base64'), cipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
    cipher.setAuthTag(b.subarray(12,28)); return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');
  };
  const grant={version:1,issuer:'https://platform.deepseek.com',token:'synthetic-account-token'};
  try {
    const api=createAssistantCredentialVault({userDataPath:dir,encrypt,decrypt});
    const account=createAssistantAccountVault({userDataPath:dir,encrypt,decrypt});
    await api.set('synthetic-api-key');
    assert.equal(await account.hasRecord(),false);
    await account.saveGrant(grant);
    assert.deepEqual(await account.getForMainProcess(),grant);
    const data=await fs.readFile(path.join(dir,ACCOUNT_VAULT_NAME),'utf8');
    assert.equal(data.includes(grant.token),false);
    assert.equal(data.includes(grant.issuer),false);
    assert.equal((await fs.readFile(path.join(dir,VAULT_NAME),'utf8')).includes('synthetic-api-key'),false);
    for (const bad of [{...grant,issuer:'https://evil.example'}, {...grant,token:'bad\nvalue'}, {...grant,token:'x'.repeat(8200)}, {...grant,extra:'unexpected'}]) {
      await assert.rejects(account.saveGrant(bad), {code:'ASSISTANT_ACCOUNT_GRANT_INVALID'});
    }
    assert.deepEqual(await account.getForMainProcess(),grant, 'invalid replacement leaves the existing grant intact');
    await Promise.all([account.saveGrant({...grant,token:'synthetic-next-token'}),account.clear()]);
    assert.equal(await account.hasRecord(),false, 'clear is serialized after a preceding save');
    assert.equal(await api.getForMainProcess(),'synthetic-api-key', 'account changes never clear the API key');
    await fs.writeFile(path.join(dir,ACCOUNT_VAULT_NAME),'{invalid');
    await assert.rejects(account.saveGrant(grant), {code:'ASSISTANT_VAULT_INVALID'});
    await assert.rejects(account.clear(), {code:'ASSISTANT_VAULT_INVALID'});
    assert.equal(await fs.readFile(path.join(dir,ACCOUNT_VAULT_NAME),'utf8'),'{invalid');
    if (process.platform !== 'win32') {
      await fs.unlink(path.join(dir,ACCOUNT_VAULT_NAME));
      await fs.symlink(path.join(dir,VAULT_NAME),path.join(dir,ACCOUNT_VAULT_NAME));
      await assert.rejects(account.saveGrant(grant), {code:'ASSISTANT_VAULT_INVALID'});
      assert.equal(await api.getForMainProcess(),'synthetic-api-key');
    }
    assert.throws(() => createAssistantCredentialVault({userDataPath:dir,encrypt,decrypt,vaultName:'../unexpected'}), {code:'ASSISTANT_VAULT_INVALID_CONFIG'});
    console.log('PASS_SEPARATE_ASSISTANT_ACCOUNT_VAULT_SYNTHETIC');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}
main().catch(error => { console.error('ASSISTANT_ACCOUNT_VAULT_TEST_FAILED',error.code || error.message); process.exitCode=1; });
