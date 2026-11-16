const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {createCustomNodeConfigVault, PREFIX} = require('../electron/main/custom-node-config-vault.cjs');
const {createCustomNodeConfigService} = require('../electron/main/custom-node-config-service.cjs');

(async () => {
  const scope = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-config-vault-test-'));
  const key = crypto.randomBytes(32);
  const encrypt = async value => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
  };
  const decrypt = async text => {
    const data=Buffer.from(text,'base64'), decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
  };
  try {
    const vault=createCustomNodeConfigVault({userDataPath:scope,encrypt,decrypt});
    const first={apiUrl:'https://fixture.invalid/?key=SYNTHETIC_KEY',headers:'{"Authorization":"SYNTHETIC_SECRET"}',body:'SYNTHETIC_PROMPT',variables:{private:'SYNTHETIC_PRIVATE'}};
    const ref=await vault.put(first);assert.ok(ref.startsWith(PREFIX));assert.deepEqual(await vault.get(ref),first);
    const files=await fs.readdir(path.join(scope,'custom-node-config-v1'));assert.equal(files.length,1);
    const stored=await fs.readFile(path.join(scope,'custom-node-config-v1',files[0]),'utf8');assert.doesNotMatch(stored,/SYNTHETIC_|fixture\.invalid|Authorization/);
    const [a,b]=await Promise.all([vault.put({...first,body:'first'}),vault.put({...first,body:'second'})]);
    assert.notEqual(a,b);assert.equal((await vault.get(a)).body,'first');assert.equal((await vault.get(b)).body,'second');assert.deepEqual(await vault.get(ref),first);
    await assert.rejects(vault.get(PREFIX+'../../outside'),{code:'CONFIG_VAULT_INVALID_REFERENCE'});
    await assert.rejects(vault.get(PREFIX+'00000000-0000-4000-8000-000000000000'),{code:'CONFIG_VAULT_NOT_FOUND'});
    await assert.rejects(vault.put([]),{code:'CONFIG_VAULT_INVALID_CONTENT'});
    await assert.rejects(vault.put({data:'a'.repeat(300000)}),{code:'CONFIG_VAULT_INVALID_CONTENT'});
    const fails=createCustomNodeConfigVault({userDataPath:scope,encrypt:async()=>{throw Error('SYNTHETIC_SECRET')},decrypt});
    await assert.rejects(fails.put(first),{code:'CONFIG_VAULT_ENCRYPT_FAILED'});assert.deepEqual(await vault.get(ref),first);
    const noEncryption=createCustomNodeConfigVault({userDataPath:scope,encrypt:async value=>value,decrypt});
    await assert.rejects(noEncryption.put(first),{code:'CONFIG_VAULT_ENCRYPT_FAILED'});assert.deepEqual(await vault.get(ref),first);
    const badDecrypt=createCustomNodeConfigVault({userDataPath:scope,encrypt,decrypt:async()=>{throw Error('SYNTHETIC_SECRET')}});
    await assert.rejects(badDecrypt.get(ref),{code:'CONFIG_VAULT_DECRYPT_FAILED'});assert.deepEqual(await vault.get(ref),first);
    const service=createCustomNodeConfigService(vault), protectedConfig=await service.protect(first);
    assert.equal(protectedConfig.ok,true);assert.doesNotMatch(JSON.stringify(protectedConfig),/SYNTHETIC/);
    assert.deepEqual(await service.restore(protectedConfig.reference),{ok:true,config:first});
    await fs.writeFile(path.join(scope,'custom-node-config-v1',files[0]),'{broken');
    await assert.rejects(vault.get(ref),{code:'CONFIG_VAULT_INVALID_RECORD'});
    const symlinkId='11111111-1111-4111-8111-111111111111';
    await fs.symlink(path.join(scope,'custom-node-config-v1',files[0]),path.join(scope,'custom-node-config-v1',symlinkId+'.json'));
    await assert.rejects(vault.get(PREFIX+symlinkId),{code:'CONFIG_VAULT_INVALID_RECORD'});
    console.log('PASS_CUSTOM_NODE_CONFIG_VAULT_ISOLATED');
  } finally { await fs.rm(scope,{recursive:true,force:true}); }
})().catch(error=>{console.error(error.code || 'TEST_FAILED');process.exitCode=1});
