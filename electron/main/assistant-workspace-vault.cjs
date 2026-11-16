// Main-process encrypted documents. The OS protects a random wrapping key;
// authenticated local encryption handles histories without native-pipe limits.
// No plaintext fallback, no automatic reset of damaged or missing keys.
const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIRECTORY = 'assistant-workspace-v1';
const ID = /^(?:catalog|session-[a-f0-9-]{36}|role-[a-f0-9-]{36})$/;
const MAX_DOCUMENT = 8 * 1024 * 1024;
const MAX_MEDIA = 32 * 1024 * 1024;
const MEDIA_ID = /^asset-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNER_ID = /^session-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MEDIA_HEADER = Buffer.from('SCMEDIA1');
const fail = code => Object.assign(new Error(code), {code});
const publicMode = info => process.platform !== 'win32' && (info.mode & 0o077);

function createAssistantWorkspaceVault({userDataPath, encrypt, decrypt}) {
  if (!path.isAbsolute(userDataPath || '') || typeof encrypt !== 'function' || typeof decrypt !== 'function') throw fail('ASSISTANT_WORKSPACE_INVALID');
  const directory = path.join(userDataPath, DIRECTORY);
  let key, previous = Promise.resolve();
  const serial = action => {const result = previous.then(action); previous = result.catch(() => {}); return result;};
  const fileFor = id => {
    if (!ID.test(id || '')) throw fail('ASSISTANT_WORKSPACE_INVALID_ID');
    return path.join(directory, id + '.json');
  };
  const mediaFile = (owner,id) => {
    if (!OWNER_ID.test(owner || '') || !MEDIA_ID.test(id || '')) throw fail('ASSISTANT_MEDIA_INVALID');
    return path.join(directory, id + '.bin');
  };
  async function ensureDirectory() {
    const parent = await fs.lstat(userDataPath);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw fail('ASSISTANT_WORKSPACE_UNSAFE_PATH');
    await fs.mkdir(directory, {mode:0o700}).catch(error => {if (error.code !== 'EEXIST') throw error;});
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || publicMode(info)) throw fail('ASSISTANT_WORKSPACE_UNSAFE_PATH');
  }
  async function readFile(filename, maximum) {
    let handle;
    try {
      const entry = await fs.lstat(filename);
      if (!entry.isFile() || entry.isSymbolicLink() || publicMode(entry)) throw fail('ASSISTANT_WORKSPACE_UNSAFE_PATH');
      handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== entry.dev || info.ino !== entry.ino || info.size < 1 || info.size > maximum) throw fail('ASSISTANT_WORKSPACE_CORRUPT');
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || bytes.length > maximum) throw fail('ASSISTANT_WORKSPACE_CORRUPT');
      return bytes;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error?.code?.startsWith('ASSISTANT_')) throw error;
      throw fail('ASSISTANT_WORKSPACE_CORRUPT');
    } finally {await handle?.close();}
  }
  async function publish(filename, bytes, immutable = false) {
    const temporary = path.join(directory, '.' + crypto.randomUUID() + '.tmp');
    let created = false;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600); created = true;
      try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
      if (immutable) await fs.link(temporary, filename);
      else await fs.rename(temporary, filename);
    } finally {if (created) await fs.unlink(temporary).catch(() => {});}
  }
  async function getKey(create) {
    if (key) return key;
    const filename = path.join(directory, 'key.json');
    let bytes = await readFile(filename, 131072);
    if (!bytes) {
      // A lost key is not a new workspace. Preserve all prior ciphertext.
      if ((await fs.readdir(directory)).some(name => !name.startsWith('.'))) throw fail('ASSISTANT_WORKSPACE_KEY_MISSING');
      if (!create) return null;
      const secret = crypto.randomBytes(32).toString('base64');
      let wrapped;
      try {wrapped = await encrypt(secret);} catch {throw fail('ASSISTANT_WORKSPACE_ENCRYPT_FAILED');}
      if (typeof wrapped !== 'string' || !wrapped || wrapped.includes(secret) || wrapped.length > 120000) throw fail('ASSISTANT_WORKSPACE_ENCRYPT_FAILED');
      const record = Buffer.from(JSON.stringify({version:1,wrapped}));
      try {await publish(filename, record, true); bytes = record;}
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        bytes = await readFile(filename, 131072);
      }
    }
    let record, secret;
    try {
      record = JSON.parse(bytes);
      if (record?.version !== 1 || typeof record.wrapped !== 'string' || !record.wrapped || Object.keys(record).sort().join(',') !== 'version,wrapped') throw Error();
      secret = await decrypt(record.wrapped);
    } catch {throw fail('ASSISTANT_WORKSPACE_DECRYPT_FAILED');}
    if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw fail('ASSISTANT_WORKSPACE_DECRYPT_FAILED');
    key = Buffer.from(secret, 'base64');
    return key;
  }
  async function read(id) {
    await ensureDirectory();
    const bytes = await readFile(fileFor(id), MAX_DOCUMENT * 2);
    const secret = await getKey(false);
    if (!bytes) return null;
    if (!secret) throw fail('ASSISTANT_WORKSPACE_KEY_MISSING');
    try {
      const record = JSON.parse(bytes);
      if (Object.keys(record).sort().join(',') !== 'ciphertext,iv,revision,tag,version' || record.version !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1) throw Error();
      const decode = (value, size) => {
        if (typeof value !== 'string' || !value || Buffer.from(value, 'base64').toString('base64') !== value) throw Error();
        const data = Buffer.from(value, 'base64');
        if (size && data.length !== size) throw Error();
        return data;
      };
      const decipher = crypto.createDecipheriv('aes-256-gcm', secret, decode(record.iv, 12));
      decipher.setAAD(Buffer.from(`starcanvas-workspace:1:${id}:${record.revision}`));
      decipher.setAuthTag(decode(record.tag, 16));
      const plaintext = Buffer.concat([decipher.update(decode(record.ciphertext)), decipher.final()]);
      if (plaintext.length > MAX_DOCUMENT) throw Error();
      return {revision:record.revision, value:JSON.parse(plaintext.toString('utf8'))};
    } catch {throw fail('ASSISTANT_WORKSPACE_CORRUPT');}
  }
  return Object.freeze({
    // Media shares the OS-wrapped workspace key, but has its own immutable
    // binary envelope. Owner AAD prevents moving a ciphertext into B's chat.
    writeMedia(owner,id,input) {
      let bytes,filename;
      try {
        filename=mediaFile(owner,id);
        if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength>MAX_MEDIA) throw Error();
        bytes=Buffer.from(input);
      } catch {return Promise.reject(fail('ASSISTANT_MEDIA_INVALID'));}
      return serial(async()=>{
        await ensureDirectory();const secret=await getKey(true),iv=crypto.randomBytes(12);
        const cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
        cipher.setAAD(Buffer.from(`starcanvas-media:1:${owner}:${id}`));
        const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
        await publish(filename,Buffer.concat([MEDIA_HEADER,iv,cipher.getAuthTag(),ciphertext]),true);
      });
    },
    readMedia(owner,id) {
      let filename;try {filename=mediaFile(owner,id);}catch(error){return Promise.reject(error);}
      return serial(async()=>{
        await ensureDirectory();const bytes=await readFile(filename,MAX_MEDIA+36);
        if(!bytes)throw fail('ASSISTANT_MEDIA_MISSING');
        const secret=await getKey(false);if(!secret)throw fail('ASSISTANT_WORKSPACE_KEY_MISSING');
        try{
          if(bytes.length<=36||!bytes.subarray(0,8).equals(MEDIA_HEADER))throw Error();
          const decipher=crypto.createDecipheriv('aes-256-gcm',secret,bytes.subarray(8,20));
          decipher.setAAD(Buffer.from(`starcanvas-media:1:${owner}:${id}`));decipher.setAuthTag(bytes.subarray(20,36));
          return Buffer.concat([decipher.update(bytes.subarray(36)),decipher.final()]);
        }catch{throw fail('ASSISTANT_MEDIA_CORRUPT');}
      });
    },
    read: id => {try {fileFor(id);} catch (error) {return Promise.reject(error);} return serial(() => read(id));},
    write(id, value, expectedRevision) {
      let bytes;
      try {
        fileFor(id);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error();
        bytes = Buffer.from(JSON.stringify(value));
        if (!bytes.length || bytes.length > MAX_DOCUMENT) throw Error();
      } catch {return Promise.reject(fail('ASSISTANT_WORKSPACE_INVALID'));}
      // Serialize before waiting: callers cannot mutate the captured document.
      return serial(async () => {
        const prior = await read(id);
        if ((prior?.revision || 0) !== expectedRevision) throw fail('ASSISTANT_WORKSPACE_CONFLICT');
        const secret = await getKey(true), revision = expectedRevision + 1;
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
        cipher.setAAD(Buffer.from(`starcanvas-workspace:1:${id}:${revision}`));
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const record = {version:1, revision, iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:encrypted.toString('base64')};
        await publish(fileFor(id), Buffer.from(JSON.stringify(record)));
        return {revision};
      });
    },
  });
}

function createSystemAssistantWorkspaceVault() {
  const {app} = require('./electron-refs.cjs');
  const {encryptSecret, decryptSecret} = require('./account-secret-storage.cjs');
  return createAssistantWorkspaceVault({userDataPath:app.getPath('userData'), encrypt:encryptSecret, decrypt:decryptSecret});
}
module.exports = {createAssistantWorkspaceVault, createSystemAssistantWorkspaceVault, DIRECTORY, MAX_DOCUMENT, MAX_MEDIA, MEDIA_ID};
