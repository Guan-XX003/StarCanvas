// Closed-loop integration of dormant PKCE, fixed-origin transport and separate
// vault. The provider, browser and encryption are synthetic; no real login.
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createAssistantAccountPkce}=require('../electron/main/assistant-account-pkce.cjs');
const {createAssistantAccountPost}=require('../electron/main/assistant-account-transport.cjs');
const {createAssistantAccountVault}=require('../electron/main/assistant-account-vault.cjs');
const {createAssistantAccountDevice,NAME:DEVICE_NAME}=require('../electron/main/assistant-account-device.cjs');
const {ACCOUNT_VAULT_NAME}=require('../electron/main/assistant-credential-vault.cjs');
const wrap=biz_data=>({code:0,data:{biz_code:0,biz_data}});
function request(url){return new Promise((resolve,reject)=>{http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});}
async function main(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-auth-integration-'));
  const key=crypto.randomBytes(32), requests=[];
  const encrypt=async text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),b=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64');};
  const decrypt=async value=>{const b=Buffer.from(value,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');};
  let initial,opened,auth;
  const net={request:options=>{
    const req=new EventEmitter();req.headers={};req.payload='';req.setHeader=(k,v)=>{req.headers[k]=v};req.write=value=>{req.payload+=value};req.abort=()=>{};
    req.end=()=>setImmediate(()=>{
      const body=JSON.parse(req.payload);requests.push({options,body});
      const init=options.url.endsWith('/auth_init');if(init)initial=body;
      const result=init?wrap({authorize_id:'synthetic-attempt',authorize_url:'https://platform.deepseek.com/dsh/authorize',expires_in:60}):wrap({token:'synthetic-account-grant',authorized_url:'https://platform.deepseek.com/dsh/authorized'});
      const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};req.emit('response',res);res.emit('data',Buffer.from(JSON.stringify(result)));res.emit('end');
    });return req;
  }};
  try{
    const vault=createAssistantAccountVault({userDataPath:dir,encrypt,decrypt});
    const device=createAssistantAccountDevice(dir);
    const post=createAssistantAccountPost(net,{version:'1.4.8',language:'zh-CN',platformName:'darwin',timezoneOffsetSeconds:28800});
    auth=createAssistantAccountPkce({post,openExternal:async url=>{opened=url;},saveGrant:value=>vault.saveGrant(value),getDeviceId:()=>device.getDeviceId()});
    assert.deepEqual(await auth.start(),{phase:'waiting'});
    assert.equal(new URL(opened).origin,'https://platform.deepseek.com');
    assert.equal(await request(`${initial.redirect_uri}?state=${initial.state}&code=synthetic-code`),302);
    assert.equal(auth.status().phase,'complete');
    const grant=await vault.getForMainProcess();assert.equal(grant.token,'synthetic-account-grant');
    const contents=await fs.readFile(path.join(dir,ACCOUNT_VAULT_NAME),'utf8');
    assert.equal(contents.includes(grant.token),false);
    assert.equal(requests.length,2);assert.equal(requests[0].options.url,'https://platform.deepseek.com/auth-api/v0/dsh/auth_init');
    assert.equal(requests[1].options.url,'https://platform.deepseek.com/auth-api/v0/dsh/auth_exchange');
    assert.equal(crypto.createHash('sha256').update(requests[1].body.code_verifier).digest('base64url'),initial.code_challenge);
    assert.equal(requests[1].body.device_id,await createAssistantAccountDevice(dir).getDeviceId());
    assert.equal((await fs.readFile(path.join(dir,DEVICE_NAME),'utf8')).includes(grant.token),false);
    console.log('PASS_ASSISTANT_ACCOUNT_SYNTHETIC_CLOSED_LOOP');
  }finally{if(auth)await auth.cancel();await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error('ASSISTANT_ACCOUNT_INTEGRATION_FAILED',error.code||error.message);process.exitCode=1});
