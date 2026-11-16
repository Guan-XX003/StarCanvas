// Evaluate actual registration/guard source, not a duplicate IPC implementation.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../electron/main/ipc.cjs'),'utf8');
const tree=ts.createSourceFile('ipc.cjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&['getIpcSenderUrl','isTrustedIpcEvent','rejectUntrustedIpc'].includes(node.name?.text));
const register=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='registerDesktopIpc');
const loop=register.body.statements.find(node=>ts.isForOfStatement(node)&&node.getText(tree).includes('wanjuan:assistant-workspace-list'));
assert.ok(loop);assert.equal(declarations.length,3);
const payload={id:'synthetic',assetId:'synthetic-asset',text:'draft',turnId:'synthetic-turn',requestId:'synthetic-request',afterRevision:5,context:{view:'canvas'},patch:{draft:'draft'},revision:7,configuration:{name:'Role'}};
const pairs=[
  ['list','workspaceList',[]],
  ['create-session','workspaceCreateSession',[payload]],
  ['read-session','workspaceReadSession',['synthetic']],
  ['progress','workspaceProgress',['synthetic','synthetic-request',5]],
  ['patch-session','workspacePatchSession',['synthetic',{draft:'draft'},7]],
  ['change-session','workspaceChangeSession',['synthetic',{draft:'draft'},7]],
  ['select-session','workspaceSelectSession',['synthetic']],
  ['create-role','workspaceCreateRole',[{name:'Role'}]],
  ['read-role','workspaceReadRole',['synthetic']],
  ['patch-role','workspacePatchRole',['synthetic',{name:'Role'},7]],
  ['add-attachment','workspaceAddAttachment',['synthetic',null]],
  ['read-turn-attachments','workspaceReadTurnAttachments',['synthetic','synthetic-turn']],
  ['preview-attachment','workspacePreviewAttachment',['synthetic','synthetic-asset']],
  ['export-backup','workspaceExportBackup',[payload]],
  ['import-backup','workspaceImportBackup',[payload]],
  ['import-legacy-role','workspaceImportLegacyRole',[payload]],
  ['begin-custom-turn','workspaceBeginCustomTurn',['synthetic','draft']],
  ['custom-running','workspaceCustomRunning',['synthetic','synthetic-turn']],
  ['complete-custom-turn','workspaceCompleteCustomTurn',['synthetic','synthetic-turn',{text:'draft'}]],
  ['send','workspaceSend',['synthetic','draft',{view:'canvas'},'synthetic-request']],
  ['cancel','workspaceCancel',['synthetic']],
];
function fixture(){
  const handlers=new Map(),calls=[],logs=[];let thrown;
  const context={ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},getDesktopBaseUrl:()=> 'http://127.0.0.1:5555',appendDesktopLog:(...args)=>logs.push(args),assistant:new Proxy({}, {get:(_,method)=>async(...args)=>{calls.push({method,args});if(thrown)throw thrown;return 'SYNTHETIC_REPLY';}})};
  vm.runInNewContext(declarations.map(node=>node.getText(tree)).join('\n')+'\n'+loop.getText(tree),context);
  return {handlers,calls,logs,setError:value=>{thrown=value;}};
}
const trusted={senderFrame:{url:'http://127.0.0.1:5555/index.html'}};
test('all workspace routes reject untrusted renderers before touching storage/runtime',async()=>{
  const f=fixture();
  for(const [suffix] of pairs){
    const handler=f.handlers.get('wanjuan:assistant-workspace-'+suffix);assert.equal(typeof handler,'function');
    for(const url of ['https://private.invalid/?token=PRIVATE_KEY','http://127.0.0.1:55550/',''])assert.equal((await handler({senderFrame:{url}},payload)).ok,false);
  }
  assert.equal(f.calls.length,0);assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE_|private\.invalid/);
});
test('trusted workspace routes forward exact arguments and return only allowlisted errors',async()=>{
  const f=fixture();
  for(const [suffix,method,args] of pairs){
    const reply=await f.handlers.get('wanjuan:assistant-workspace-'+suffix)(trusted,payload);
    assert.deepEqual(JSON.parse(JSON.stringify(reply)),{ok:true,value:'SYNTHETIC_REPLY'});
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),{method,args});
  }
  const send=f.handlers.get('wanjuan:assistant-workspace-send');
  f.setError(Object.assign(Error('PRIVATE_PROVIDER_ERROR'),{code:'PRIVATE_KEY'}));
  assert.deepEqual(JSON.parse(JSON.stringify(await send(trusted,payload))),{ok:false,code:'ASSISTANT_FAILED'});
  f.setError(Object.assign(Error('PRIVATE_PROVIDER_ERROR'),{code:'ASSISTANT_WORKSPACE_CONFLICT'}));
  assert.deepEqual(JSON.parse(JSON.stringify(await send(trusted,payload))),{ok:false,code:'ASSISTANT_WORKSPACE_CONFLICT'});
  assert.doesNotMatch(JSON.stringify(f.logs),/PRIVATE_/);
});
