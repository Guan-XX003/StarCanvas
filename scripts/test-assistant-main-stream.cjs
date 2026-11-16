const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),http=require('node:http'),{randomUUID}=require('node:crypto');
const {createAssistantAnswerTap}=require('../electron/main/assistant-answer-tap.cjs');
const {createAssistantTurnProgress}=require('../electron/main/assistant-turn-progress.cjs');
const {createAssistantAccountBroker}=require('../electron/main/assistant-account-broker.cjs');
const frame=event=>'data: '+JSON.stringify(event)+'\r\n\r\n';
const start=()=>frame({type:'message_start',message:{role:'assistant'}});
const block=(index,type='text',text='')=>frame({type:'content_block_start',index,content_block:{type,text}});
const delta=(index,text,type='text_delta')=>frame({type:'content_block_delta',index,delta:{type,text}});
test('actual fragmented SSE yields only answer text; thoughts/tools/errors and post-terminal text never preview',()=>{
 const values=[],tap=createAssistantAnswerTap(text=>values.push(text));
 const bytes=Buffer.from(start()+block(0,'thinking')+delta(0,'PRIVATE_REASON','thinking_delta')+block(1,'tool_use')+delta(1,'PRIVATE_TOOL')+block(2,'text','开')+delta(2,'始🙂')+frame({type:'content_block_stop',index:2})+delta(2,'PRIVATE_LATE')+frame({type:'message_stop'})+delta(2,'PRIVATE_AFTER'));
 for(const byte of bytes)tap.write(Buffer.from([byte]));
 assert.deepEqual(values,['','开','开始🙂']);
 const ignored=[];createAssistantAnswerTap(x=>ignored.push(x)).write(Buffer.from(block(0)+delta(0,'PRIVATE_WITHOUT_MESSAGE')));assert.deepEqual(ignored,[]);
});
test('bounded parser stops preview, not inference, when malformed/oversized or UI callback throws',()=>{
 const values=[],tap=createAssistantAnswerTap(x=>values.push(x));tap.write(Buffer.from(start()+block(0)+delta(0,'VALID')));
 tap.write(Buffer.from('data: '+ 'x'.repeat(262145)));tap.write(Buffer.from('\n\n'+delta(0,'NO')));assert.equal(values.at(-1),'VALID');
 const malformed=createAssistantAnswerTap(()=>{throw Error('UI_GONE');});assert.doesNotThrow(()=>malformed.write(Buffer.from(start()+block(0)+delta(0,'VALID'))));
 const capped=[];createAssistantAnswerTap(x=>capped.push(x)).write(Buffer.from(start()+block(0)+delta(0,'a'.repeat(200001))));assert.deepEqual(capped,['']);
});
test('volatile progress exact owner/request/revision, bounded eviction/expiry, close fences late bytes',()=>{
 let time=0;const p=createAssistantTurnProgress({now:()=>time,limit:2,ttl:30}),a='session-'+randomUUID(),b='session-'+randomUUID(),req=randomUUID(),other=randomUUID();
 const turn=p.begin(a,req,'TURN_A');assert.equal(p.read(a,req).phase,'waiting');turn.text('A');const snapshot=p.read(a,req);assert.equal(snapshot.text,'A');assert.equal(p.read(a,req,snapshot.revision).text,undefined);assert.equal(p.read(b,req),null);assert.equal(p.read(a,other),null);
 assert.throws(()=>p.begin(a,req,'DUPLICATE'));assert.throws(()=>p.read(a,req,-1));assert.throws(()=>p.read('PRIVATE_PATH',req));
 p.begin(b,other,'TURN_B');assert.throws(()=>p.begin(a,randomUUID(),'NO_LIVE_EVICT'));turn.close();turn.text('LATE');assert.equal(p.read(a,req).text,'A');p.begin(a,randomUUID(),'NEXT');assert.equal(p.read(a,req),null);
 const q=createAssistantTurnProgress({now:()=>time,ttl:30}),ticket=q.begin(a,req,'T');ticket.close();time=31;assert.equal(q.read(a,req),null);
});
test('API-key broker previews before EOF, preserves wire, pins target/auth, never gives real key to Harness or replays a failure',async t=>{
 const calls=[],values=[];let response,request;
 const net={request(options){const r=new EventEmitter();request=r;const call={options,headers:{},abort:0};calls.push(call);r.setHeader=(n,v)=>{call.headers[n.toLowerCase()]=v;};r.write=()=>{};r.abort=()=>{call.abort++;};r.end=()=>{response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/event-stream'};response.pause=()=>{};response.resume=()=>{};setImmediate(()=>r.emit('response',response));};return r;}};
 assert.throws(()=>createAssistantAccountBroker({net,getKey:async()=>'',getGrant:async()=>''}));
 const broker=createAssistantAccountBroker({net,getKey:async()=>'sk-synthetic-private',onText:x=>values.push(x)});t.after(()=>broker.close());const local=await broker.start();assert.notEqual(local.clientKey,'sk-synthetic-private');
 const body=JSON.stringify({stream:true,messages:[]});let incoming;
 const output=new Promise((resolve,reject)=>{const r=http.request(local.baseURL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'x-api-key':local.clientKey}},res=>{incoming=res;const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve(Buffer.concat(chunks).toString()));res.on('error',reject);});r.on('error',reject);r.end(body);});
 const until=async predicate=>{const end=Date.now()+2000;while(!predicate()){assert(Date.now()<end);await new Promise(setImmediate);}};
 await until(()=>response&&request.listenerCount('response'));await new Promise(setImmediate);
 const wire=start()+block(0)+delta(0,'EARLY_ANSWER');response.emit('data',Buffer.from(wire));await until(()=>incoming);assert.equal(values.at(-1),'EARLY_ANSWER');assert.equal(incoming.complete,false,'upstream has not ended');
 const end=frame({type:'content_block_stop',index:0})+frame({type:'message_stop'});response.emit('data',Buffer.from(end));response.emit('end');assert.equal(await output,wire+end);
 assert.equal(calls.length,1);assert.equal(calls[0].options.url,'https://api.deepseek.com/anthropic/v1/messages');assert.equal(calls[0].headers['x-api-key'],'sk-synthetic-private');assert.equal(calls[0].headers['x-dsh-auth-token'],undefined);assert(!JSON.stringify(calls).includes(local.clientKey));
});
