// Separate non-secret installation identity for the account flow.
// Invalid or unexpected records are preserved, never silently regenerated.
const fs=require('node:fs/promises');
const constants=require('node:fs').constants;
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const NAME='assistant-account-device-v1.json';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(){const e=new Error('ASSISTANT_ACCOUNT_DEVICE_INVALID');e.code='ASSISTANT_ACCOUNT_DEVICE_INVALID';return e;}
function createAssistantAccountDevice(userDataPath){
  if(!path.isAbsolute(userDataPath||'')) throw failure();
  const target=path.join(userDataPath,NAME);let pending=Promise.resolve();
  async function read(){
    let handle;
    try{
      const entry=await fs.lstat(target);
      if(!entry.isFile()||entry.isSymbolicLink())throw failure();
      handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      const stat=await handle.stat();
      if(!stat.isFile()||stat.dev!==entry.dev||stat.ino!==entry.ino||stat.size<1||stat.size>256)throw failure();
      const value=JSON.parse(await handle.readFile('utf8'));
      if(!value||Object.keys(value).sort().join(',')!=='id,version'||value.version!==1||typeof value.id!=='string'||!UUID.test(value.id))throw failure();
      return value.id;
    }catch(error){if(error?.code==='ENOENT')return null;throw failure();}
    finally{await handle?.close();}
  }
  async function get(){
    const existing=await read();if(existing)return existing;
    const id=randomUUID();let file;
    try{
      file=await fs.open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
      await file.writeFile(JSON.stringify({version:1,id}),'utf8');await file.sync();return id;
    }catch(error){if(error?.code==='EEXIST'){const concurrent=await read();if(concurrent)return concurrent;}throw failure();}
    finally{await file?.close();}
  }
  return Object.freeze({getDeviceId:()=>{const current=pending.then(get);pending=current.catch(()=>{});return current;}});
}
module.exports={createAssistantAccountDevice,NAME};
