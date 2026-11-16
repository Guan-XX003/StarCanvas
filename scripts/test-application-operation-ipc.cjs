const {test}=require('node:test'),assert=require('node:assert/strict');
const {registerApplicationOperationIpc}=require('../electron/main/application-operation-ipc.cjs');
test('every approval and nonce route checks trusted App sender before accessing service',async()=>{
 const routes=new Map();let serviceReads=0;
 registerApplicationOperationIpc({ipcMain:{handle:(name,fn)=>routes.set(name,fn)},rejectUntrustedIpc:()=>{throw Object.assign(Error('UNTRUSTED'),{code:'UNTRUSTED'});},getService:()=>{serviceReads++;assert.fail('Service reached');}});
 assert.equal(routes.size,9);for(const route of routes.values())await assert.rejects(()=>route({},{}),{code:'UNTRUSTED'});assert.equal(serviceReads,0);
});
test('IPC forwards only fixed operation arguments and sanitizes exception content',async()=>{
 const routes=new Map(),calls=[];
 registerApplicationOperationIpc({ipcMain:{handle:(name,fn)=>routes.set(name,fn)},rejectUntrustedIpc:()=>{},getService:()=>Object.fromEntries(['list','approve','reject','dismiss','consume'].map(name=>[name,(...args)=>{calls.push({name,args});if(name==='consume')throw Error('PRIVATE_TOKEN_AND_CONTENT');return name;}]))});
 for(const [name,fn]of routes){if(name.endsWith('-internal'))continue;const r=await fn({},{id:'QA_ID',revision:3,nonce:'QA_NONCE',permissions:['all']});assert(!JSON.stringify(r).includes('PRIVATE'));if(name.endsWith('consume'))assert.deepEqual(r,{ok:false,code:'OPERATION_FAILED'});else assert.equal(r.ok,true);}
 assert.deepEqual(calls,[{name:'list',args:[]},{name:'approve',args:['QA_ID',3]},{name:'reject',args:['QA_ID',3]},{name:'dismiss',args:['QA_ID']},{name:'consume',args:['QA_ID','QA_NONCE']}]);
});
test('internal IPC binds owner outside model arguments and cannot read or approve another session request',async t=>{
 const {applicationOperationActor}=await import('../electron/shared/application-operation-contract.mjs');
 const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
 const routes=new Map(),service=createApplicationOperationService({prepare:async()=>({}),commit:()=>assert.fail('No approval should execute')});t.after(()=>service.close());
 registerApplicationOperationIpc({ipcMain:{handle:(name,fn)=>routes.set(name,fn)},rejectUntrustedIpc:()=>{},getService:()=>service});
 const invoke=(name,p)=>routes.get('wanjuan:application-operation-'+name)({},p),request={operation:'canvas.read',projectId:'QA_PROJECT',arguments:{includeContent:true},idempotencyKey:'qa-owner-request-0001'};
 const submitted=await invoke('submit-internal',{owner:'SESSION_A',request});assert(submitted.ok);const id=submitted.value.request.id;
 for(const name of ['read-internal','approve-internal','cancel-internal']){const result=await invoke(name,{owner:'SESSION_B',id,revision:2});assert.deepEqual(result,{ok:false,code:'OPERATION_NOT_FOUND'});}
 assert.throws(()=>applicationOperationActor('wrong owner with spaces'),{code:'OPERATION_INVALID_AUTHORITY'});
 const malformed=await invoke('submit-internal',{owner:'SESSION_A',request:{...request,selectionVersion:1}});assert.equal(malformed.code,'OPERATION_INVALID_REQUEST');
 const noSelection=await invoke('submit-internal',{owner:'SESSION_A',request:{operation:'canvas.plan.apply',projectId:'QA_PROJECT',arguments:{planId:'QA_PLAN'},idempotencyKey:'qa-mutation-request-0001'}});assert.equal(noSelection.code,'OPERATION_INVALID_AUTHORITY');
 for(const [operation,args]of [['app.preferences.set',{kind:'theme',value:'dark'}],['app.navigate',{destination:'appearance'}]])assert.equal((await invoke('submit-internal',{owner:'SESSION_A',request:{operation,projectId:'QA_PROJECT',arguments:args,idempotencyKey:'qa-local-no-selection-0001'}})).code,'OPERATION_INVALID_AUTHORITY');
});
