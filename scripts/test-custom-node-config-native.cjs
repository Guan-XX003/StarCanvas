// Native OS encryption, real service, two independent Electron lifetimes.
// Uses only a disposable profile and (on macOS) an independent QA Keychain item.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const config=()=>({apiUrl:'https://synthetic.invalid/endpoint',method:'POST',
  headers:JSON.stringify({Authorization:'SYNTHETIC_NATIVE_CONFIG_ONLY'}),
  body:JSON.stringify({prompt:'SYNTHETIC_PRIVATE_BODY'}),variables:{choice:'manual'}});

if(process.versions.electron){
  const {app}=require('electron');
  const scope=process.env.STARCANVAS_CONFIG_NATIVE_QA_SCOPE||'';
  const service=process.env.STARCANVAS_CONFIG_NATIVE_QA_SERVICE||'';
  const step=process.env.STARCANVAS_CONFIG_NATIVE_QA_STEP;
  const allowed=fs.realpathSync(os.tmpdir())+path.sep;
  if(!scope.startsWith(allowed)||!/^starcanvas-config-native-[A-Za-z0-9]+$/.test(path.basename(scope))||
      !/^org\.starcanvas\.account-secret\.qa\.[A-F0-9-]{36}$/.test(service)||!['write','read'].includes(step)){
    console.error('INVALID_NATIVE_TEST_SCOPE');app.exit(1);
  }else{
    const home=path.join(scope,'profile');fs.mkdirSync(home,{recursive:true});
    process.env.WANJUAN_TEST_USER_DATA_PATH=home;
    if(process.platform==='darwin'){
      process.env.STARCANVAS_DEV_KEYCHAIN_QA='1';process.env.STARCANVAS_KEYCHAIN_QA_SERVICE=service;
    }
    app.setPath('userData',home);app.getAppPath=()=>root;
    app.whenReady().then(async()=>{
      const {encryptSecret,decryptSecret,secretStorageMode}=require('../electron/main/account-secret-storage.cjs');
      const {createSystemCustomNodeConfigService}=require('../electron/main/custom-node-config-service.cjs');
      const vault=createSystemCustomNodeConfigService();
      const projectFile=path.join(scope,'canvas.json');
      if(step==='write'){
        // Surface the underlying fixed secure-storage error instead of losing
        // that diagnostic behind the vault's intentionally generic IPC error.
        const cipher=await encryptSecret('SYNTHETIC_NATIVE_PROBE');
        assert.equal(await decryptSecret(cipher),'SYNTHETIC_NATIVE_PROBE');
        const original=config(),frozen=structuredClone(original),pending=vault.protect(original);
        original.variables.choice='changed after request';
        const first=await pending;assert.equal(first.ok,true,'native protect must succeed');
        assert.deepEqual((await vault.restore(first.reference)).config,frozen);
        const second=await vault.protect({...frozen,variables:{choice:'second version'}});
        assert.equal(second.ok,true);assert.notEqual(first.reference,second.reference);
        assert.deepEqual((await vault.restore(first.reference)).config,frozen);
        const state={nodes:[{id:'synthetic-node',type:'customNode',data:{config:{$starcanvasEncryptedConfig:first.reference}}}],edges:[]};
        fs.writeFileSync(projectFile,JSON.stringify(state),{mode:0o600});
        for(const name of fs.readdirSync(path.join(home,'custom-node-config-v1'))){
          const text=fs.readFileSync(path.join(home,'custom-node-config-v1',name),'utf8');
          assert.doesNotMatch(text,/SYNTHETIC_|Authorization|synthetic\.invalid/);
        }
        assert.doesNotMatch(fs.readFileSync(projectFile,'utf8'),/SYNTHETIC_|Authorization/);
      }else{
        const state=JSON.parse(fs.readFileSync(projectFile,'utf8'));
        const reference=state.nodes[0].data.config.$starcanvasEncryptedConfig;
        assert.deepEqual(await vault.restore(reference),{ok:true,config:config()});
        assert.equal((await vault.restore('custom-config-v1:00000000-0000-4000-8000-000000000000')).ok,false);
      }
      assert.equal(secretStorageMode(),'system');
      console.log(JSON.stringify({ok:true,step,native:true}));app.exit(0);
    }).catch(error=>{console.error(JSON.stringify({ok:false,step,code:typeof error?.code==='string'?error.code:'NATIVE_TEST_ASSERTION'}));app.exit(1)});
  }
}else{
  if(!['darwin','win32'].includes(process.platform)){console.error('MACOS_OR_WINDOWS_REQUIRED');process.exitCode=1;}
  else{
    const scope=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-config-native-')));
    const service='org.starcanvas.account-secret.qa.'+crypto.randomUUID().toUpperCase();
    const receipt={native:true,platform:process.platform,steps:[],cleanup:false,ok:false};
    let failed=false;
    try{
      const electron=require('electron');
      for(const step of ['write','read']){
        const env={...process.env,STARCANVAS_CONFIG_NATIVE_QA_SCOPE:scope,STARCANVAS_CONFIG_NATIVE_QA_SERVICE:service,STARCANVAS_CONFIG_NATIVE_QA_STEP:step};
        delete env.ELECTRON_RUN_AS_NODE;
        const result=spawnSync(electron,[__filename],{env,encoding:'utf8',timeout:30000});
        const line=(result.status===0?result.stdout:result.stderr).trim().split('\n').find(line=>line.startsWith('{'));
        let parsed;try{parsed=JSON.parse(line)}catch{parsed={ok:false,step,code:result.error?.code||'NATIVE_PROCESS_FAILED'}}
        receipt.steps.push(parsed);
        if(result.status!==0||parsed.ok!==true){failed=true;break;}
      }
    }finally{
      if(process.platform==='darwin'){
        const cleaned=spawnSync(path.join(root,'build/native-tools/macos-account-keychain'),[],{
          input:JSON.stringify({operation:'qa-delete',value:'',qaService:service}),encoding:'utf8',timeout:8000,
          env:{...process.env,STARCANVAS_KEYCHAIN_QA:'1'},
        });
        try{receipt.cleanup=cleaned.status===0&&JSON.parse(cleaned.stdout).ok===true}catch{}
      }else receipt.cleanup=true;
      receipt.ok=!failed&&receipt.steps.length===2&&receipt.steps.every(step=>step.ok===true)&&receipt.cleanup;
      fs.writeFileSync(path.join(scope,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
      // Keep only this non-secret receipt for auditing; delete exact QA profile
      // and reference file, never the caller's or the formal application data.
      fs.rmSync(path.join(scope,'profile'),{recursive:true,force:true});
      fs.rmSync(path.join(scope,'canvas.json'),{force:true});
      console.log(JSON.stringify({...receipt,receipt:path.join(scope,'receipt.json')}));
      if(!receipt.ok)process.exitCode=1;
    }
  }
}
