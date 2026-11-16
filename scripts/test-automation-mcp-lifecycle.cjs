const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),frame=(id,method,params)=>({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,...(params===undefined?{}:{params})});
test('portable MCP advertises package version, negotiates only its supported protocol and gates tools on initialization',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-mcp-lifecycle-')),file=path.join(dir,'automation.json'),token='SYNTHETIC_MCP_'+ 'a'.repeat(40),children=new Set();let calls=0;
 const server=http.createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer '+token);res.writeHead(200,{'content-type':'application/json',connection:'close'});res.end(JSON.stringify({ok:true,ready:true}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.writeFile(file,JSON.stringify({protocolVersion:2,host:'127.0.0.1',port:server.address().port,token,pid:process.pid}));
 t.after(async()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 const run=messages=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'bin/starcanvas-mcp.mjs')],{env:{...process.env,STARCANVAS_AUTOMATION_FILE:file},cwd:dir,stdio:['pipe','pipe','pipe']});children.add(child);let out='',err='';
  const timeout=setTimeout(()=>{child.kill('SIGTERM');reject(Error('MCP_TEST_TIMEOUT'));},10000);
  child.on('error',reject);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('close',code=>{clearTimeout(timeout);children.delete(child);try{assert.equal(code,0,err);assert.equal(err,'');resolve(out.trim().split('\n').map(JSON.parse));}catch(e){reject(e);}});
  child.stdin.end(messages.map(v=>JSON.stringify(v)).join('\n')+'\n');
 });
 const result=await run([
  null,frame(1,'tools/call',{name:'starcanvas_generate_image',arguments:{prompt:'DO_NOT_SEND'}}),
  frame(2,'initialize',{protocolVersion:{private:'DO_NOT_ECHO'}}),frame(3,'initialize',{protocolVersion:'2025-06-18'}),
  frame(4,'tools/list',{}),frame(undefined,'notifications/initialized'),frame(5,'tools/list',{}),
  frame(6,'tools/call',{name:'starcanvas_status',arguments:{}}),frame(7,'initialize',{protocolVersion:'2025-06-18'}),
  frame(8,'tools/call',{_meta:{'io.modelcontextprotocol/protocolVersion':'2099-01-01'},name:'starcanvas_generate_image',arguments:{prompt:'DO_NOT_SEND'}}),
  frame(9,'tools/list',null),frame(10,'ping',{}),
 ]),r=new Map(result.map(v=>[v.id,v]));
 assert.equal(r.get(null).error.code,-32600);assert.equal(r.get(1).error.code,-32002);assert.equal(r.get(2).error.code,-32602);
 assert.equal(r.get(3).result.protocolVersion,'2025-06-18');assert.equal(r.get(3).result.serverInfo.version,(await fs.readFile(path.join(root,'bin/VERSION.txt'),'utf8')).trim());
 assert.equal(r.get(4).error.code,-32002);assert.equal(r.get(5).result.tools.length,14);assert.equal(r.get(6).result.structuredContent.ready,true);assert.equal(r.get(7).error.code,-32600);assert.equal(r.get(8).error.code,-32602);assert.equal(r.get(9).error.code,-32602);assert.deepEqual(r.get(10).result,{});assert.equal(calls,1);
 assert(!JSON.stringify(result).includes('DO_NOT_ECHO'));assert(!JSON.stringify(result).includes('DO_NOT_SEND'));
 const probe=await run([frame(1,'server/discover',{}),frame(2,'initialize',{protocolVersion:'2099-01-01'}),frame(3,'tools/call',{name:'starcanvas_generate_image',arguments:{prompt:'DO_NOT_SEND'}})]),p=new Map(probe.map(v=>[v.id,v]));
 assert.equal(p.get(1).error.code,-32601);assert.equal(p.get(2).result.protocolVersion,'2025-06-18');assert(p.get(2).result.instructions.includes('disconnect'));assert.equal(p.get(3).error.code,-32002);assert.equal(calls,1,'no App request or paid submission before a compatible client completes the handshake');
});
