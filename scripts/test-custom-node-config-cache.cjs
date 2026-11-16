const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const ts=require('typescript');
const oldExtension=require.extensions['.ts'];
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f,
}).outputText,f);
const {createCustomConfigSnapshotCache:createCache}=require('../src/renderer/lib/custom-node-config-cache.ts');
const {restoreCanvasCustomConfigs}=require('../src/renderer/lib/custom-node-config-transform.ts');
const {createCustomNodeConfigVault}=require('../electron/main/custom-node-config-vault.cjs');
const marker='$starcanvasEncryptedConfig';
const ref=()=>`custom-config-v1:${crypto.randomUUID()}`;
const state=(config={headers:{Authorization:'SYNTHETIC_PRIVATE_KEY'}})=>({nodes:[{id:'fixture',type:'customNode',data:{name:'manual',config}}],edges:[]});
const pause=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const failed={code:'CUSTOM_CONFIG_PROTECTION_FAILED'};

test('no config requires no native storage',async()=>{
  const cache=createCache({}),input={nodes:[{id:'text',type:'textNode',data:{text:'fixture'}}],edges:[]};
  assert.deepEqual(await cache.prepare(input),input);assert.deepEqual(cache.snapshot(input),input);
});
test('deduplicates immutable configs and keeps synchronous snapshots secret-free',async()=>{
  let calls=0;const r=ref(),cache=createCache({customConfigProtect:async()=>{calls++;return {ok:true,reference:r}}});
  const input=state();input.nodes.push({...input.nodes[0],id:'second'});const before=JSON.stringify(input);
  const saved=await cache.prepare(input);assert.equal(calls,1);assert.equal(JSON.stringify(input),before);
  assert.equal(saved.nodes[0].data.config[marker],r);assert.deepEqual(saved.nodes[0].data.config,saved.nodes[1].data.config);
  assert.doesNotMatch(JSON.stringify(cache.snapshot(input)),/SYNTHETIC_PRIVATE_KEY/);
  await cache.prepare(input);assert.equal(calls,1);
});
test('captures every config and node before asynchronous encryption',async()=>{
  const gate=pause(),calls=[],r=ref();const cache=createCache({customConfigProtect:async value=>{calls.push(value);await gate.promise;return {ok:true,reference:r}}});
  const input=state(),operation=cache.prepare(input);await Promise.resolve();
  input.nodes[0].data.config.headers.Authorization='SYNTHETIC_NEW_KEY';input.nodes[0].data.name='edited';
  gate.resolve();const saved=await operation;
  assert.equal(calls[0].headers.Authorization,'SYNTHETIC_PRIVATE_KEY');assert.equal(saved.nodes[0].data.name,'manual');
  assert.equal(saved.nodes[0].data.config[marker],r);assert.equal(cache.snapshot(input),null);
});
test('overlapping preparations retain each caller snapshot without reviving evicted entries',async()=>{
  const gate=pause(),a=ref(),b=ref();
  const cache=createCache({customConfigProtect:async value=>{if(value.name==='a'){await gate.promise;return {ok:true,reference:a}}return {ok:true,reference:b}}});
  const inputA=state({name:'a'}),inputB=state({name:'b'}),first=cache.prepare(inputA);
  const second=await cache.prepare(inputB);gate.resolve();const old=await first;
  assert.equal(old.nodes[0].data.config[marker],a);assert.equal(second.nodes[0].data.config[marker],b);
  assert.equal(cache.snapshot(inputA),null);assert.equal(cache.snapshot(inputB).nodes[0].data.config[marker],b);
});
test('clear fences pending callers and never repopulates the close cache',async()=>{
  const gate=pause(),cache=createCache({customConfigProtect:async()=>{await gate.promise;return {ok:true,reference:ref()}}});
  const input=state(),pending=cache.prepare(input);cache.clear();gate.resolve();
  await assert.rejects(pending,failed);assert.equal(cache.snapshot(input),null);
});
test('partial failure never substitutes an old config or mutates input',async()=>{
  let calls=0;const input=state({n:1});input.nodes.push({...state({n:2}).nodes[0],id:'second'});
  const before=JSON.stringify(input),cache=createCache({customConfigProtect:async()=>++calls===2?{ok:false}:{ok:true,reference:ref()}});
  await assert.rejects(cache.prepare(input),failed);assert.equal(JSON.stringify(input),before);assert.equal(cache.snapshot(input),null);
  const retried=await cache.prepare(input);assert.equal(calls,3);assert(retried.nodes.every(n=>n.data.config[marker]));
});
test('malformed references and bridge exceptions expose only a fixed error',async()=>{
  for(const protect of [async()=>({ok:true,reference:'SYNTHETIC_PRIVATE'}),async()=>{throw Error('SYNTHETIC_PRIVATE')}]){
    const cache=createCache({customConfigProtect:protect});await assert.rejects(cache.prepare(state()),e=>e.code===failed.code&&!e.message.includes('SYNTHETIC_PRIVATE'));
    assert.equal(cache.snapshot(state()),null);
  }
  await assert.rejects(createCache({}).prepare(state()),failed);
});
test('validates all configs and capacity before invoking native writes',async()=>{
  let calls=0;const bridge={customConfigProtect:async()=>{calls++;return {ok:true,reference:ref()}}};
  const input=state();input.nodes.push({...state({[marker]:ref()}).nodes[0],id:'invalid'});
  await assert.rejects(createCache(bridge).prepare(input),failed);assert.equal(calls,0);
  const two=state({a:1});two.nodes.push({...state({a:2}).nodes[0],id:'two'});
  await assert.rejects(createCache(bridge,1).prepare(two),failed);assert.equal(calls,0);
  const cycle={};cycle.self=cycle;await assert.rejects(createCache(bridge).prepare(state(cycle)),failed);
  await assert.rejects(createCache(bridge).prepare(state({data:'x'.repeat(65537)})),failed);assert.equal(calls,0);
  assert.throws(()=>createCache(bridge,0),failed);
});
test('encrypted disk records round-trip both async and close snapshots without plaintext files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-config-cache-'));
  const key=crypto.randomBytes(32);
  const encrypt=async text=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64')};
  const decrypt=async text=>{const b=Buffer.from(text,'base64'),c=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8')};
  try{
    const vault=createCustomNodeConfigVault({userDataPath:dir,encrypt,decrypt});
    const bridge={customConfigProtect:async config=>({ok:true,reference:await vault.put(config)}),customConfigRestore:async reference=>({ok:true,config:await vault.get(reference)})};
    const cache=createCache(bridge),input=state(),saved=await cache.prepare(input),close=cache.snapshot(input);
    assert.deepEqual(await restoreCanvasCustomConfigs(saved,bridge),input);assert.deepEqual(await restoreCanvasCustomConfigs(close,bridge),input);
    for(const file of fs.readdirSync(path.join(dir,'custom-node-config-v1'))){assert.doesNotMatch(fs.readFileSync(path.join(dir,'custom-node-config-v1',file),'utf8'),/SYNTHETIC_PRIVATE_KEY/)}
    const r=saved.nodes[0].data.config[marker];fs.unlinkSync(path.join(dir,'custom-node-config-v1',r.split(':')[1]+'.json'));
    await assert.rejects(restoreCanvasCustomConfigs(saved,bridge),failed);
  }finally{key.fill(0);fs.rmSync(dir,{recursive:true,force:true})}
});

(async()=>{try{for(const [name,fn] of tests){await fn();console.log('PASS '+name)}console.log(`PASS_CUSTOM_CONFIG_CACHE ${tests.length}`)}finally{if(oldExtension)require.extensions['.ts']=oldExtension;else delete require.extensions['.ts']}})().catch(e=>{console.error(e);process.exitCode=1});
