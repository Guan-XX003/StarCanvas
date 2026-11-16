// Real OS-backed key wrapping, separate Electron write/read lifetimes. The only
// Keychain item touched is a new QA identity; the test owns its disposable data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const configuration=()=>({name:'Synthetic custom role',model:'custom-vision',apiConfigId:'manual-only',knowledgeFiles:[{chunks:['SYNTHETIC_KNOWLEDGE']}],memoryApiKey:'SYNTHETIC_MEMORY_KEY',outputMode:'json'});
if(process.versions.electron){
  const {app}=require('electron');
  const scope=process.env.STARCANVAS_WORKSPACE_NATIVE_SCOPE||'',service=process.env.STARCANVAS_WORKSPACE_NATIVE_SERVICE||'',step=process.env.STARCANVAS_WORKSPACE_NATIVE_STEP;
  if(!scope.startsWith(fs.realpathSync(os.tmpdir())+path.sep)||!/^starcanvas-workspace-native-[A-Za-z0-9]+$/.test(path.basename(scope))||!/^org\.starcanvas\.account-secret\.qa\.[A-F0-9-]{36}$/.test(service)||!['write','read'].includes(step)){
    console.error('INVALID_WORKSPACE_NATIVE_TEST_SCOPE');app.exit(1);
  }else{
    const profile=path.join(scope,'profile');fs.mkdirSync(profile,{recursive:true,mode:0o700});
    process.env.WANJUAN_TEST_USER_DATA_PATH=profile;
    if(process.platform==='darwin'){process.env.STARCANVAS_DEV_KEYCHAIN_QA='1';process.env.STARCANVAS_KEYCHAIN_QA_SERVICE=service;}
    app.setPath('userData',profile);app.getAppPath=()=>root;
    app.whenReady().then(async()=>{
      const {createSystemAssistantWorkspaceVault,DIRECTORY}=require('../electron/main/assistant-workspace-vault.cjs');
      const {createAssistantWorkspace}=require('../electron/main/assistant-workspace.cjs');
      const {secretStorageMode}=require('../electron/main/account-secret-storage.cjs');
      const workspace=createAssistantWorkspace({vault:createSystemAssistantWorkspaceVault()});
      if(step==='write'){
        const role=await workspace.createRole(configuration());
        const a=await workspace.createSession({name:'A',roleId:role.id,projectId:'synthetic-project'}),b=await workspace.createSession({name:'B'});
        await workspace.patchSession(a.value.id,{draft:'SYNTHETIC_PRIVATE_DRAFT'},a.revision);
        const turn=await workspace.beginTurn(a.value.id,'SYNTHETIC_QUESTION');
        await workspace.finishTurn(a.value.id,turn.value.task.id,{text:'SYNTHETIC_LONG_REPLY_'.repeat(8000)});
        await workspace.beginTurn(b.value.id,'SYNTHETIC_INTERRUPTED_QUESTION');
      }else{
        await workspace.recoverInterrupted();
        const index=await workspace.list();assert.equal(index.value.sessions.length,2);
        const a=await workspace.readSession(index.value.sessions.find(item=>item.name==='A').id),b=await workspace.readSession(index.value.sessions.find(item=>item.name==='B').id);
        assert.equal(a.value.task.status,'completed');assert.equal(a.value.messages.at(-1).content,'SYNTHETIC_LONG_REPLY_'.repeat(8000));assert.equal(a.value.projectId,'synthetic-project');
        assert.equal(b.value.task.status,'interrupted');assert.equal(b.value.messages.length,1);
        assert.deepEqual((await workspace.readRole(a.value.roleId)).configuration,configuration());
      }
      for(const name of fs.readdirSync(path.join(profile,DIRECTORY))){
        const bytes=fs.readFileSync(path.join(profile,DIRECTORY,name),'utf8');
        assert.doesNotMatch(bytes,/SYNTHETIC_|custom-vision|manual-only|synthetic-project/);
      }
      assert.equal(secretStorageMode(),'system');
      console.log(JSON.stringify({ok:true,step,native:true}));app.exit(0);
    }).catch(error=>{console.error(JSON.stringify({ok:false,step,code:typeof error?.code==='string'?error.code:'NATIVE_WORKSPACE_ASSERTION'}));app.exit(1);});
  }
}else if(!['darwin','win32'].includes(process.platform)){
  console.error('MACOS_OR_WINDOWS_REQUIRED');process.exitCode=1;
}else{
  const scope=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-workspace-native-'))),service='org.starcanvas.account-secret.qa.'+crypto.randomUUID().toUpperCase();
  const receipt={ok:false,native:true,platform:process.platform,steps:[],cleanup:false};
  try{
    const electron=require('electron');
    for(const step of ['write','read']){
      const env={...process.env,STARCANVAS_WORKSPACE_NATIVE_SCOPE:scope,STARCANVAS_WORKSPACE_NATIVE_SERVICE:service,STARCANVAS_WORKSPACE_NATIVE_STEP:step};delete env.ELECTRON_RUN_AS_NODE;
      const result=spawnSync(electron,[__filename],{env,encoding:'utf8',timeout:30000});
      const line=(result.status===0?result.stdout:result.stderr).trim().split('\n').find(line=>line.startsWith('{'));
      let parsed;try{parsed=JSON.parse(line);}catch{parsed={ok:false,step,code:result.error?.code||'NATIVE_PROCESS_FAILED'};}
      receipt.steps.push(parsed);if(result.status!==0||parsed.ok!==true)break;
    }
  }finally{
    if(process.platform==='darwin'){
      const cleanup=spawnSync(path.join(root,'build/native-tools/macos-account-keychain'),[],{input:JSON.stringify({operation:'qa-delete',value:'',qaService:service}),encoding:'utf8',timeout:8000,env:{...process.env,STARCANVAS_KEYCHAIN_QA:'1'}});
      try{receipt.cleanup=cleanup.status===0&&JSON.parse(cleanup.stdout).ok===true;}catch{}
    }else receipt.cleanup=true;
    receipt.ok=receipt.steps.length===2&&receipt.steps.every(item=>item.ok===true)&&receipt.cleanup;
    fs.writeFileSync(path.join(scope,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
    // Remove only this exact test profile after its own system item cleanup.
    fs.rmSync(path.join(scope,'profile'),{recursive:true,force:true});
    console.log(JSON.stringify({...receipt,receipt:path.join(scope,'receipt.json')}));
    if(!receipt.ok)process.exitCode=1;
  }
}
