// Synthetic data only; test interoperable crypto and failure behavior offline.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),nodeCrypto=require('node:crypto');
const previous=require.extensions['.ts'];
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {encryptPortableBackup:encrypt,decryptPortableBackup:decrypt,isEncryptedPortableBackup:isEncrypted}=require('../src/renderer/lib/portable-backup-crypto.ts');
(async()=>{try{
 const original={modules:{projects:{nodes:[{prompt:'SYNTHETIC_PRIVATE_PROMPT',key:'SYNTHETIC_PRIVATE_KEY'}]},settings:{language:'zh-CN'}}},password=' synthetic-password-长一些 ';
 const before=JSON.stringify(original),first=await encrypt(original,password),second=await encrypt(original,password);
 assert.equal(JSON.stringify(original),before,'encryption must not mutate the input');assert.equal(isEncrypted(first),true);assert.equal(isEncrypted(original),false);
 for(const secret of ['SYNTHETIC_PRIVATE_PROMPT','SYNTHETIC_PRIVATE_KEY',password])assert.equal(JSON.stringify(first).includes(secret),false);
 assert.notEqual(first.salt,second.salt);assert.notEqual(first.iv,second.iv);assert.notEqual(first.ciphertext,second.ciphertext);
 assert.deepEqual(await decrypt(first,password),original);
 const key=nodeCrypto.pbkdf2Sync(Buffer.from(password),Buffer.from(first.salt,'base64'),600000,32,'sha256'),combined=Buffer.from(first.ciphertext,'base64');
 const decipher=nodeCrypto.createDecipheriv('aes-256-gcm',key,Buffer.from(first.iv,'base64'));
 decipher.setAAD(Buffer.from('starcanvas-encrypted-backup:v1:PBKDF2-SHA256:600000:AES-256-GCM'));decipher.setAuthTag(combined.subarray(-16));
 assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(combined.subarray(0,-16)),decipher.final()]).toString('utf8')),original,'independent Node implementation can decrypt');key.fill(0);
 await assert.rejects(decrypt(first,'wrong password'),{code:'BACKUP_DECRYPT_FAILED'});
 const altered=structuredClone(first),data=Buffer.from(altered.ciphertext,'base64');data[0]^=1;altered.ciphertext=data.toString('base64');await assert.rejects(decrypt(altered,password),{code:'BACKUP_DECRYPT_FAILED'});
 for(const bad of [{...first,iterations:1},{...first,iterations:999999999},{...first,version:2},{...first,salt:'invalid'},{...first,iv:'AAAAAAAAAAAAAAAA!'},{...first,extra:'SYNTHETIC_PRIVATE'},null,{}])await assert.rejects(decrypt(bad,password),{code:'BACKUP_ENVELOPE_INVALID'});
 await assert.rejects(encrypt(original,'short'),{code:'BACKUP_PASSWORD_INVALID'});await assert.rejects(encrypt(original,' '.repeat(30)),{code:'BACKUP_PASSWORD_INVALID'});await assert.rejects(encrypt(original,'a'.repeat(1025)),{code:'BACKUP_PASSWORD_INVALID'});await assert.rejects(encrypt([],password),{code:'BACKUP_CONTENT_INVALID'});
 const cycle={};cycle.cycle=cycle;await assert.rejects(encrypt(cycle,password),{code:'BACKUP_CONTENT_INVALID'});
 await assert.rejects(encrypt({toJSON:()=>[]},password),{code:'BACKUP_CONTENT_INVALID'});
 console.log('PASS_PORTABLE_BACKUP_CRYPTO');
}finally{if(previous)require.extensions['.ts']=previous;else delete require.extensions['.ts']}})().catch(error=>{console.error(error.code||error.message);process.exitCode=1});
