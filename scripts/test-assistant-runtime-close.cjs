// Synthetic shutdown only: no process, account, user files, or network.
const assert=require('node:assert/strict');
const {closeAssistantResources}=require('../electron/main/assistant-runtime-close.cjs');
const options={brokerTimeoutMs:15,clientTimeoutMs:20};
(async()=>{
 let release,clientCalls=0;
 const pending=new Promise(resolve=>{release=resolve});
 const broker={close:()=>pending},client={close:async()=>{clientCalls++}};
 await assert.rejects(closeAssistantResources({broker,client},options),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
 assert.equal(clientCalls,1,'a hung broker must not prevent attempting child shutdown');
 release();await closeAssistantResources({broker,client},options);assert.equal(clientCalls,2,'an explicit later recheck can complete');
 let brokerCalls=0;
 await assert.rejects(closeAssistantResources({broker:{close:async()=>{brokerCalls++}},client:{close:()=>new Promise(()=>{})}},options),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
 assert.equal(brokerCalls,1,'a hung child must not prevent broker shutdown');
 const privateError='SYNTHETIC_PRIVATE_ERROR';clientCalls=0;
 await assert.rejects(closeAssistantResources({broker:{close:()=>{throw Error(privateError)}},client},options),error=>error.code==='ASSISTANT_RUNTIME_STOP_UNCONFIRMED'&&!error.message.includes(privateError));
 assert.equal(clientCalls,1,'both resources receive a close attempt even if one throws');
 await closeAssistantResources({broker:null,client:null},options);
 console.log('PASS_ASSISTANT_RUNTIME_CLOSE_BOUNDARIES');
})().catch(error=>{console.error(error);process.exitCode=1});
