const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const source=fs.readFileSync(path.join(__dirname,'../electron/main/macos-account-secret.cjs'),'utf8');
const contract=require('../electron/shared/macos-account-helper.cjs');
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-helper-boundary-'));
  const dir=path.join(root,contract.resourceDirectory);fs.mkdirSync(dir);
  const target=path.join(dir,contract.executable);
  fs.copyFileSync(path.join(__dirname,'../build/native-tools',contract.executable),target);
  return {root,target,cleanup:()=>fs.rmSync(root,{recursive:true})};
}
function load(root,env,spawnImpl,appOverride={}) {
  const module={exports:{}};
  vm.runInNewContext(source,{module,Buffer,process:{platform:'darwin',resourcesPath:root,env},setTimeout,clearTimeout,
    require(name){
      if(name==='./electron-refs.cjs')return {app:{isPackaged:true,...appOverride}};
      if(name==='../shared/macos-account-helper.cjs')return contract;
      if(name==='node:child_process')return {spawn:spawnImpl};
      if(['node:fs','node:path','node:crypto','node:os'].includes(name))return require(name);
      throw Error('UNEXPECTED_REQUIRE');
    }});
  return module.exports;
}
test('main-process helper passes secrets only over stdin, removes unsafe environment and returns ciphertext',async()=>{
  const f=fixture(),calls=[];
  try {
    const helper=load(f.root,{HOME:'/synthetic',DYLD_INSERT_LIBRARIES:'/bad',NODE_OPTIONS:'bad'},(file,args,options)=>{
      calls.push({file,args,options});
      const child=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};
      child.stdin.end=payload=>{const request=JSON.parse(payload);assert.equal(request.value,'synthetic-secret');
        process.nextTick(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({ok:true,value:'ciphertext'})));child.emit('close',0);});};
      return child;
    });
    assert.equal(await helper.request('encrypt','synthetic-secret'),'ciphertext');
    assert.equal(calls.length,1);assert.deepEqual(Array.from(calls[0].args),[]);
    assert.equal(JSON.stringify(calls[0].options.env).includes('synthetic-secret'),false);
    assert.equal(calls[0].options.env.DYLD_INSERT_LIBRARIES,undefined);
    assert.equal(calls[0].options.env.NODE_OPTIONS,undefined);
    assert.deepEqual(Array.from(calls[0].options.stdio),['pipe','pipe','ignore']);
  } finally {f.cleanup();}
});
test('development helper is limited to a temporary profile and a synthetic Keychain namespace',async()=>{
  const f=fixture(),root=f.root,profile=path.join(root,'profile'),build=path.join(root,'build','native-tools');
  fs.mkdirSync(profile);fs.mkdirSync(build,{recursive:true});fs.copyFileSync(f.target,path.join(build,contract.executable));
  const scope='org.starcanvas.account-secret.qa.12345678-1234-1234-1234-123456789ABC';
  const env={STARCANVAS_DEV_KEYCHAIN_QA:'1',WANJUAN_TEST_USER_DATA_PATH:profile,STARCANVAS_KEYCHAIN_QA_SERVICE:scope};
  const app={isPackaged:false,getPath:()=>profile,getAppPath:()=>root};let spawned=0;
  const spawnImpl=(file,args,options)=>{
    spawned++;assert.equal(file,path.join(build,contract.executable));assert.equal(options.env.STARCANVAS_KEYCHAIN_QA,'1');
    const child=new EventEmitter();child.stdin=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{};
    child.stdin.end=payload=>{assert.equal(JSON.parse(payload).qaService,scope);process.nextTick(()=>{
      child.stdout.emit('data',Buffer.from(JSON.stringify({ok:true,value:'ciphertext'})));child.emit('close',0);
    });};return child;
  };
  try {
    const helper=load(root,env,spawnImpl,app);assert.equal(helper.enabled(),true);
    assert.equal(await helper.request('encrypt','synthetic'),'ciphertext');assert.equal(spawned,1);
    assert.throws(()=>load(root,{...env,WANJUAN_TEST_USER_DATA_PATH:'/Users/guan'},spawnImpl,app).request('encrypt','synthetic'),{code:'SECURE_STORAGE_UNAVAILABLE'});
    assert.throws(()=>load(root,{...env,STARCANVAS_KEYCHAIN_QA_SERVICE:'production'},spawnImpl,app).request('encrypt','synthetic'),{code:'SECURE_STORAGE_UNAVAILABLE'});
    const link=path.join(root,'outside-profile');fs.symlinkSync('/Users',link);
    assert.throws(()=>load(root,{...env,WANJUAN_TEST_USER_DATA_PATH:link},spawnImpl,{...app,getPath:()=>link}).request('encrypt','synthetic'),{code:'SECURE_STORAGE_UNAVAILABLE'});
    assert.equal(spawned,1);
  } finally {f.cleanup();}
});
test('tampered helper and unsafe synthetic scope fail closed before spawning',async()=>{
  const f=fixture();let spawned=false;
  try {
    const helper=load(f.root,{WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA:'1',WANJUAN_TEST_USER_DATA_PATH:'/tmp/profile'},()=>{spawned=true;});
    assert.throws(()=>helper.request('encrypt','synthetic'),{code:'SECURE_STORAGE_UNAVAILABLE'});
    const helper2=load(f.root,{},()=>{spawned=true;});
    const data=fs.readFileSync(f.target);data[data.length-1]^=1;fs.writeFileSync(f.target,data);
    assert.throws(()=>helper2.request('encrypt','synthetic'),{code:'SECURE_STORAGE_UNAVAILABLE'});
    assert.equal(spawned,false);
  } finally {f.cleanup();}
});
