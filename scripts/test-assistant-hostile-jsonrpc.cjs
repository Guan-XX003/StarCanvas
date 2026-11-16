// Exercise the real Harness client's JSON-RPC handler against an in-memory
// hostile child. No process, network, credentials or user files are touched.
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const childProcess=require('node:child_process');
function hostileChild() {
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const pending=new Set(['approval','question','unknown']);let promptId,sessionId,failed=false,closed=false;
  const write=value=>child.stdout.write(`${JSON.stringify(value)}\n`);
  const close=()=>{if(!closed){closed=true;process.nextTick(()=>child.emit('close',0));}};
  child.kill=close;
  child.stdin=new Writable({write(chunk,_encoding,done){
    try {
      const frame=JSON.parse(String(chunk));
      if(frame.method==='initialize') write({jsonrpc:'2.0',id:frame.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}});
      else if(frame.method==='session/prompt') {
        promptId=frame.id;sessionId=frame.params.sessionId;
        write({jsonrpc:'2.0',id:'approval',method:'approval/request',params:{command:'SYNTHETIC_FORBIDDEN_COMMAND'}});
        write({jsonrpc:'2.0',id:'question',method:'user-question/ask',params:{question:'SYNTHETIC'}});
        write({jsonrpc:'2.0',id:'unknown',method:'execute_shell',params:{command:'SYNTHETIC_FORBIDDEN_COMMAND'}});
      } else if(pending.has(frame.id)) {
        if(frame.id==='approval' && frame.result?.outcome!=='rejected') failed=true;
        if(frame.id==='question' && frame.result?.cancelled!==true) failed=true;
        if(frame.id==='unknown' && frame.error?.code!==-32601) failed=true;
        pending.delete(frame.id);if(!pending.size) write({jsonrpc:'2.0',id:promptId,result:{messageId:'synthetic-message'}});
      } else if(frame.method==='session/wait') {
        write({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:failed?'DENIAL_FAILED':'ALL_DENIED'}]}}}}});
        write({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type:'turn/end',data:{reason:{kind:'completed'}}}}});
        write({jsonrpc:'2.0',id:frame.id,result:{}});
      } else if(frame.method==='shutdown') {write({jsonrpc:'2.0',id:frame.id,result:{}});close();}
      done();
    } catch(error) {done(error);}
  }});
  return child;
}
const originalSpawn=childProcess.spawn;childProcess.spawn=hostileChild;
const {createHarnessClient}=require('../electron/main/assistant-harness-client.cjs');
childProcess.spawn=originalSpawn;
(async()=>{
  const client=createHarnessClient({launcher:'synthetic',patch:'synthetic',home:'synthetic',env:{},initializeTimeoutMs:5000,turnTimeoutMs:5000});
  try {assert.equal(await client.sendMessage('Synthetic hostile RPC'),'ALL_DENIED');}
  finally {await client.close();}
  console.log('PASS_ASSISTANT_HOSTILE_JSONRPC_DENIED');
})().catch(error=>{console.error('HOSTILE_JSONRPC_TEST_FAILED',error.code||error.message);process.exitCode=1;});
