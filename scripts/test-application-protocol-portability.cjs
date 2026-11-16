const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),protocol=()=>import(pathToFileURL(path.join(root,'bin/application-operation-protocol.mjs')).href);
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'starcanvas-protocol-portable-')),infoFile=path.join(dir,'automation.json'),token='QA_PROTOCOL_ONLY_'+ 'a'.repeat(40);let code='PLAN_CANVAS_NOT_READY',permission='';
 const server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.writeHead(400,{'content-type':'application/json',connection:'close'});res.end(JSON.stringify({ok:false,code,permission,error:'PRIVATE_SYNTHETIC_TOKEN_AND_CONTENT'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.writeFile(infoFile,JSON.stringify({host:'127.0.0.1',port:server.address().port,token,pid:process.pid,protocolVersion:2}));
 const env={...process.env,STARCANVAS_AUTOMATION_FILE:infoFile},children=new Set();
 const child=(entry,args,input)=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[entry,...args],{env,stdio:['pipe','pipe','pipe']});children.add(c);let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('error',reject);c.on('close',exit=>{children.delete(c);resolve({exit,out,err});});if(input)c.stdin.end(input);else c.stdin.end();});
 t.after(async()=>{for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});});
 return {dir,infoFile,env,child,set(value,p=''){code=value;permission=p;}};
}
test('App and portable client use the identical frozen public codes/permission registry',async()=>{
 const p=await protocol(),contract=await import('../electron/shared/application-operation-contract.mjs'),policy=await import('../electron/shared/application-operation-policy.mjs');
 assert.equal(contract.APPLICATION_OPERATION_RESULT_CODES,p.APPLICATION_OPERATION_RESULT_CODES);assert.equal(policy.APPLICATION_PERMISSIONS,p.APPLICATION_PERMISSIONS);assert.equal(contract.applicationOperationErrorCode,p.applicationOperationErrorCode);
 assert(Object.isFrozen(p.APPLICATION_OPERATION_RESULT_CODES)&&Object.isFrozen(p.APPLICATION_CLIENT_RESULT_CODES)&&Object.isFrozen(p.APPLICATION_PERMISSIONS));
 assert.equal(new Set(p.APPLICATION_CLIENT_RESULT_CODES).size,p.APPLICATION_CLIENT_RESULT_CODES.length);
 assert(p.APPLICATION_OPERATION_RESULT_CODES.includes('OPERATION_NOT_SUBMITTED'));assert(p.APPLICATION_CLIENT_RESULT_CODES.includes('PLAN_CANVAS_NOT_READY'));
 assert.equal(p.applicationOperationErrorCode({code:'PLAN_PRIVATE_SYNTHETIC_TOKEN'}),'OPERATION_FAILED');
});
test('direct HTTP client preserves every canonical code but never echoes unknown codes, raw errors or forged permissions',async t=>{
 const f=await fixture(t),p=await protocol(),{starcanvasRequest}=await import('../bin/starcanvas-client.mjs'),prior=process.env.STARCANVAS_AUTOMATION_FILE;process.env.STARCANVAS_AUTOMATION_FILE=f.infoFile;t.after(()=>{if(prior===undefined)delete process.env.STARCANVAS_AUTOMATION_FILE;else process.env.STARCANVAS_AUTOMATION_FILE=prior;});
 for(const code of p.APPLICATION_CLIENT_RESULT_CODES){f.set(code);await assert.rejects(starcanvasRequest('GET','/v1/status'),e=>{assert.equal(e.code,code);assert(!e.message.includes('PRIVATE'));return true;});}
 for(const code of ['PLAN_PRIVATE_SYNTHETIC_TOKEN','OPERATION_PRIVATE_SYNTHETIC_TOKEN',{},null]){f.set(code,'PRIVATE_PERMISSION');await assert.rejects(starcanvasRequest('GET','/v1/status'),e=>{assert.equal(e.code,'OPERATION_FAILED');assert(!e.permission);assert(!e.message.includes('PRIVATE'));return true;});}
 for(const value of p.APPLICATION_PERMISSIONS){f.set('OPERATION_PERMISSION_REQUIRED',value);await assert.rejects(starcanvasRequest('GET','/v1/status'),e=>e.code==='OPERATION_PERMISSION_REQUIRED'&&e.permission===value);}
});
test('real CLI/MCP direct error responses preserve the same canvas/no-submit codes and redact backend text',async t=>{
 const f=await fixture(t);
 for(const code of ['PLAN_STALE','PLAN_CANVAS_NOT_READY','OPERATION_NOT_SUBMITTED']){
  f.set(code);const cli=await f.child(path.join(root,'bin/starcanvas.mjs'),['status']),failure=JSON.parse(cli.err);assert.equal(cli.exit,1);assert.equal(failure.code,code);assert(!JSON.stringify(failure).includes('PRIVATE'));
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'starcanvas_status',arguments:{}}}].map(v=>JSON.stringify(v)).join('\n')+'\n',mcp=await f.child(path.join(root,'bin/starcanvas-mcp.mjs'),[],messages),reply=mcp.out.trim().split('\n').map(JSON.parse).find(r=>r.id===2);
  assert.equal(reply.result.isError,true);assert.deepEqual(reply.result.structuredContent,failure);assert(!JSON.stringify(reply).includes('PRIVATE'));
 }
});
test('standalone bin-only CLI and isolated App module layout both retain the public registry dependency',async t=>{
 const f=await fixture(t),binDir=path.join(f.dir,'standalone'),appDir=path.join(f.dir,'app');await fs.mkdir(binDir);
 for(const name of await fs.readdir(path.join(root,'bin'))){const s=await fs.lstat(path.join(root,'bin',name));assert(s.isFile()&&!s.isSymbolicLink());await fs.copyFile(path.join(root,'bin',name),path.join(binDir,name));}
 f.set('PLAN_CANVAS_NOT_READY');const cli=await f.child(path.join(binDir,'wanjuan.mjs'),['status']);assert.equal(cli.exit,1);assert.equal(JSON.parse(cli.err).code,'PLAN_CANVAS_NOT_READY','no repository import fallback required');
 await fs.mkdir(path.join(appDir,'bin'),{recursive:true});await fs.cp(path.join(root,'electron/shared'),path.join(appDir,'electron/shared'),{recursive:true});await fs.copyFile(path.join(root,'bin/application-operation-protocol.mjs'),path.join(appDir,'bin/application-operation-protocol.mjs'));
 const c=await import(pathToFileURL(path.join(appDir,'electron/shared/application-operation-contract.mjs')).href);assert.equal(c.applicationOperationErrorCode({code:'OPERATION_NOT_SUBMITTED'}),'OPERATION_NOT_SUBMITTED');
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));assert(pkg.build.files.includes('bin/application-operation-protocol.mjs'));for(const dest of ['starcanvas-cli','wanjuan-cli'])assert(pkg.build.extraResources.some(r=>r.from==='bin'&&r.to===dest));
 assert((await fs.readFile(path.join(root,'scripts/build-standalone-cli-candidate.mjs'),'utf8')).includes("['application-operation-protocol.mjs',"),'standalone zip cannot omit the shared file');
});
