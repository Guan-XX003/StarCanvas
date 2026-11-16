const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createAssistantAccountDevice,NAME}=require('../electron/main/assistant-account-device.cjs');
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-account-device-test-'));
  try{
    const device=createAssistantAccountDevice(dir),ids=await Promise.all(Array.from({length:8},()=>device.getDeviceId()));
    assert.equal(new Set(ids).size,1);assert.match(ids[0],/^[0-9a-f-]{36}$/);
    assert.equal(await createAssistantAccountDevice(dir).getDeviceId(),ids[0]);
    if(process.platform!=='win32')assert.equal((await fs.stat(path.join(dir,NAME))).mode&0o077,0);
    await fs.writeFile(path.join(dir,NAME),'{invalid');
    await assert.rejects(device.getDeviceId(),{code:'ASSISTANT_ACCOUNT_DEVICE_INVALID'});
    assert.equal(await fs.readFile(path.join(dir,NAME),'utf8'),'{invalid');
    if(process.platform!=='win32'){
      await fs.unlink(path.join(dir,NAME));await fs.symlink(path.join(dir,'elsewhere'),path.join(dir,NAME));
      await assert.rejects(device.getDeviceId(),{code:'ASSISTANT_ACCOUNT_DEVICE_INVALID'});
    }
    assert.throws(()=>createAssistantAccountDevice('../relative'),{code:'ASSISTANT_ACCOUNT_DEVICE_INVALID'});
    console.log('PASS_ASSISTANT_ACCOUNT_DEVICE_ISOLATION');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error('ASSISTANT_ACCOUNT_DEVICE_TEST_FAILED',error.code||error.message);process.exitCode=1});
