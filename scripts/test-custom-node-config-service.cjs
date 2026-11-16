const assert=require('node:assert/strict');
const {createCustomNodeConfigService}=require('../electron/main/custom-node-config-service.cjs');
(async()=>{
  let release;const waiting=new Promise(resolve=>{release=resolve}),captured=[];
  const service=createCustomNodeConfigService({
    async put(value){captured.push(value);if(captured.length===1)await waiting;if(value.fail)throw Object.assign(Error('SYNTHETIC_SECRET'),{code:'CONFIG_VAULT_ENCRYPT_FAILED'});return `fixture-${captured.length}`},
    async get(reference){if(reference==='missing')throw Object.assign(Error('SYNTHETIC_SECRET'),{code:'CONFIG_VAULT_NOT_FOUND'});return {headers:'SYNTHETIC_SECRET'}}
  });
  const one=service.protect({a:1});const input={nested:{text:'original'}};const two=service.protect(input);input.nested.text='changed';
  await Promise.resolve();assert.equal(captured.length,1,'operations are serialized');release();
  assert.equal((await one).ok,true);assert.equal((await two).ok,true);assert.equal(captured[1].nested.text,'original','snapshot is captured before queueing');
  const failure=await service.protect({fail:true});assert.deepEqual(failure,{ok:false,code:'CONFIG_VAULT_ENCRYPT_FAILED'});assert.doesNotMatch(JSON.stringify(failure),/SYNTHETIC/);
  assert.deepEqual(await service.restore('missing'),{ok:false,code:'CONFIG_VAULT_NOT_FOUND'});
  assert.deepEqual(await service.protect([]),{ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'});
  assert.deepEqual(await service.protect({text:'x'.repeat(70000)}),{ok:false,code:'CONFIG_VAULT_INVALID_CONTENT'});
  assert.deepEqual(await service.restore('fixture'),{ok:true,config:{headers:'SYNTHETIC_SECRET'}});
  console.log('PASS_CUSTOM_NODE_CONFIG_SERVICE_BOUNDARY');
})().catch(error=>{console.error(error);process.exitCode=1});
