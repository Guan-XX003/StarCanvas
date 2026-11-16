const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const handlers=new Map(),logs=[];let loads=0,calls=0,fail=false;
const original=Module._load;
Module._load=function(id,parent,...rest){
  if(parent?.filename?.endsWith(`${path.sep}ipc.cjs`)) {
    if(id==='./electron-refs.cjs')return {ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},dialog:{}};
    if(id==='./runtime-state.cjs')return {getDesktopBaseUrl:()=> 'http://127.0.0.1:42111'};
    if(id==='./logging.cjs')return {appendDesktopLog:(...args)=>logs.push(args),formatErrorMessage:()=>''};
    if(id==='./custom-node-config-ipc.cjs')return original.apply(this,[id,parent,...rest]);
    if(id==='./custom-node-config-service.cjs')return {createSystemCustomNodeConfigService:()=>{loads++;return {protect:async value=>{calls++;if(fail)throw Error('SYNTHETIC_SECRET');return {ok:true,reference:'synthetic-ref'}},restore:async value=>{calls++;return {ok:true,config:{value}}}}}};
    if(id.startsWith('./'))return new Proxy({}, {get:()=>()=>{}});
  }
  return original.apply(this,[id,parent,...rest]);
};
(async()=>{try{
  const {registerDesktopIpc}=require('../electron/main/ipc.cjs');registerDesktopIpc();
  const protect=handlers.get('wanjuan:custom-config-protect'),restore=handlers.get('wanjuan:custom-config-restore');assert.ok(protect&&restore);assert.equal(loads,0);
  const event=url=>({senderFrame:{url}}),trusted=event('http://127.0.0.1:42111/index.html');
  assert.equal((await protect(event('https://private.invalid/?key=SYNTHETIC_SECRET'),{config:{key:'SYNTHETIC_SECRET'}})).ok,false);
  assert.equal(loads,0);assert.equal(calls,0);assert.doesNotMatch(JSON.stringify(logs),/SYNTHETIC_SECRET|private\.invalid/);
  assert.deepEqual(await protect(trusted,{config:{},extra:'SYNTHETIC_SECRET'}),{ok:false,code:'CONFIG_VAULT_INVALID_REQUEST'});assert.equal(loads,0);
  assert.deepEqual(await protect(trusted,{config:{key:'SYNTHETIC_SECRET'}}),{ok:true,reference:'synthetic-ref'});assert.equal(loads,1);
  assert.deepEqual(await restore(trusted,{reference:'synthetic-ref'}),{ok:true,config:{value:'synthetic-ref'}});assert.equal(loads,1);
  fail=true;assert.deepEqual(await protect(trusted,{config:{key:'SYNTHETIC_SECRET'}}),{ok:false,code:'CONFIG_VAULT_UNAVAILABLE'});
  assert.doesNotMatch(JSON.stringify(logs),/SYNTHETIC_SECRET|private\.invalid/);
  console.log('PASS_CUSTOM_NODE_CONFIG_TRUSTED_IPC');
}finally{Module._load=original}})().catch(error=>{console.error(error);process.exitCode=1});
