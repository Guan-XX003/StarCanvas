// Exercise the real client against a synthetic child that never exits.
// No processes, credentials, user files, or network are accessed.
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const Module=require('node:module');
const original=Module._load;
let child, shutdowns=0, kills=0;
Module._load=function(name,parent,isMain){
  if(name==='node:child_process'&&parent?.filename.endsWith('assistant-harness-client.cjs')) return {spawn(){
    child=new EventEmitter();child.stdout=new EventEmitter();child.stderr={resume(){}};child.stdin=new EventEmitter();child.stdin.writable=true;
    child.stdin.write=data=>{const frame=JSON.parse(data);if(frame.method==='initialize') queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({jsonrpc:'2.0',id:frame.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n')));if(frame.method==='shutdown')shutdowns++;};
    child.stdin.end=()=>{};child.kill=()=>{kills++;return true};return child;
  }};
  return original.apply(this,arguments);
};
const {createHarnessClient}=require('../electron/main/assistant-harness-client.cjs');Module._load=original;
(async()=>{
 const client=createHarnessClient({launcher:'synthetic',patch:'synthetic',home:'synthetic',env:{},initializeTimeoutMs:100,turnTimeoutMs:1000,shutdownTimeoutMs:10,shutdownGraceMs:10,shutdownExitTimeoutMs:10});
 const turn=client.sendMessage('synthetic request');turn.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));
 const first=client.close(),second=client.close();
 await assert.rejects(first,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});await assert.rejects(second,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
 await assert.rejects(turn,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});assert.equal(shutdowns,1,'concurrent close calls share one shutdown');assert.ok(kills>=1);
 await assert.rejects(client.sendMessage('must not run'),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
 child.emit('close');await client.close();assert.equal(shutdowns,1,'a confirmed later exit can be safely rechecked');
 console.log('PASS_ASSISTANT_HARNESS_UNCONFIRMED_EXIT');
})().catch(error=>{console.error(error);process.exitCode=1});
