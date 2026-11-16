// Uses the pinned local binary and synthetic dependencies; no vault or network.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
if (process.platform !== 'darwin' && !(process.platform === 'win32' && process.arch === 'x64')) { console.log('SKIP_COMPOSITION_STARTUP_POLICY'); process.exit(0); }
const root = path.resolve(__dirname, '..');
let reads = 0, launches = 0, inspections = 0;
const oldLoad = Module._load;
Module._load = function(name,parent) {
  if (parent?.filename.endsWith('assistant-service.cjs')) {
    if (name === './electron-refs.cjs') return {app:{isPackaged:false,getAppPath:()=>root},net:{}};
    if (name === './assistant-credential-vault.cjs') return {createSystemAssistantCredentialVault:()=>({getForMainProcess:async()=>{reads++;return 'sk-synthetic-only';}})};
    if (name === './assistant-account-vault.cjs') return {createSystemAssistantAccountVault:()=>({hasRecord:async()=>{reads++;return false;}})};
    if (name === './assistant-harness-client.cjs') return {createHarnessClient:()=>{launches++;throw Error('must not start');}};
    if (name === './assistant-harness-policy.cjs') return {checkDump:(dump,profile)=>{
      inspections++;assert.equal(profile,'bundled');assert.match(dump,/^- id: sdk-app-startup$/m);
      return {ok:false,code:'SYNTHETIC_UNKNOWN_PLUGIN'};
    }};
  }
  return oldLoad.apply(this,arguments);
};
const service = require('../electron/main/assistant-service.cjs');
Module._load = oldLoad;
(async()=>{
  try {
    await assert.rejects(service.send('Synthetic policy rejection'),{code:'ASSISTANT_RUNTIME_UNVERIFIED'});
    assert.equal(inspections,1,'actual pinned binary was inspected before rejection');
    assert.equal(reads,0,'no saved credential was read');
    assert.equal(launches,0,'no agent was launched');
    console.log('PASS_RUNTIME_POLICY_REJECTS_BEFORE_CREDENTIALS');
  } finally {await service.shutdown();}
})().catch(error=>{console.error('RUNTIME_POLICY_TEST_FAILED',error.code || error.message);process.exitCode=1;});
