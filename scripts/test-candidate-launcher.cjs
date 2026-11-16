const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCandidateLaunchPlan}=require('./candidate-launch-plan.cjs');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-launch-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const app=path.join(root,'Candidate.app'),exe=path.join(app,'Contents','MacOS','StarCanvas'),win=path.join(root,'StarCanvas.exe'),source=path.join(root,'source');
  fs.mkdirSync(path.dirname(exe),{recursive:true});fs.mkdirSync(source);fs.writeFileSync(exe,'synthetic executable');fs.writeFileSync(win,'synthetic PE fixture');
  return {root,app,exe,win,source,options:{temp:root,projectRoot:source,home:path.join(root,'synthetic-home'),readMacExecutable:()=> 'StarCanvas',verifySourceRuntime:()=>assert.fail('packaged mode cannot verify development Electron'),sourceElectron:()=>assert.fail('packaged mode cannot load development Electron')}};
}
test('Mac packaged candidate uses its own executable and a detached cwd, never source Electron',t=>{
  const f=fixture(t),p=createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app,NODE_OPTIONS:'--require synthetic-source',NODE_PATH:'/synthetic/source',ELECTRON_RUN_AS_NODE:'1',DYLD_INSERT_LIBRARIES:'synthetic',WANJUAN_DEV_SERVER_URL:'http://127.0.0.1:54399'}});
  assert.equal(p.kind,'packaged-macos');assert.equal(p.command,f.exe);assert.deepEqual(p.args,['--user-data-dir='+p.userDataPath]);assert.notEqual(p.cwd,f.source);assert(p.cwd.startsWith(p.userDataPath+path.sep));assert.equal(p.env.WANJUAN_TEST_USER_DATA_PATH,p.userDataPath);
  for(const name of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','DYLD_INSERT_LIBRARIES','WANJUAN_DEV_SERVER_URL'])assert(!Object.hasOwn(p.env,name));
  assert.equal(p.env.WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA,'1');assert.equal(p.env.WANJUAN_DISABLE_UPDATE_CHECK,'1');assert.match(p.env.STARCANVAS_KEYCHAIN_QA_SERVICE,/^org\.starcanvas\.account-secret\.qa\.[A-F0-9-]{36}$/);
});
test('Windows packaged executable uses native path without requiring development Electron',t=>{
  const f=fixture(t),p=createCandidateLaunchPlan({...f.options,platform:'win32',env:{STARCANVAS_CANDIDATE_APP:f.win}});assert.equal(p.command,f.win);assert.equal(p.kind,'packaged-windows');assert.deepEqual(p.args,['--user-data-dir='+p.userDataPath]);assert(!Object.hasOwn(p.env,'STARCANVAS_KEYCHAIN_QA_SERVICE'));
});
test('default source mode still verifies its exact runtime before loading Electron',t=>{
  const f=fixture(t),calls=[];const p=createCandidateLaunchPlan({...f.options,platform:'darwin',env:{},verifySourceRuntime:r=>{calls.push('verify');assert.equal(r,f.source);},sourceElectron:()=>{calls.push('electron');return '/synthetic/source-electron';}});assert.deepEqual(calls,['verify','electron']);assert.equal(p.kind,'source');assert.deepEqual(p.args,[f.source,'--user-data-dir='+p.userDataPath]);assert.equal(p.cwd,f.source);assert.equal(p.env.STARCANVAS_DEV_KEYCHAIN_QA,'1');
});
test('default profiles are fresh while an explicit isolated restart profile retains its QA identity',t=>{
  const f=fixture(t),options={...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app}};const a=createCandidateLaunchPlan(options),b=createCandidateLaunchPlan(options);assert.notEqual(a.userDataPath,b.userDataPath);assert.notEqual(a.env.STARCANVAS_KEYCHAIN_QA_SERVICE,b.env.STARCANVAS_KEYCHAIN_QA_SERVICE);
  const again=createCandidateLaunchPlan({...options,env:{...options.env,STARCANVAS_CANDIDATE_USER_DATA:a.userDataPath}});assert.equal(again.userDataPath,a.userDataPath);assert.equal(again.env.STARCANVAS_KEYCHAIN_QA_SERVICE,a.env.STARCANVAS_KEYCHAIN_QA_SERVICE);
});
test('formal/outside/root profiles and symlink aliases fail before launching',t=>{
  const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-other-fixture-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  const options={...f.options,platform:'darwin'};for(const p of [outside,f.root,path.join(outside,'new-profile')])assert.throws(()=>createCandidateLaunchPlan({...options,env:{STARCANVAS_CANDIDATE_APP:f.app,STARCANVAS_CANDIDATE_USER_DATA:p}}),{code:'CANDIDATE_PROFILE_NOT_ISOLATED'});
  const alias=path.join(f.root,'alias');fs.symlinkSync(outside,alias,'dir');assert.throws(()=>createCandidateLaunchPlan({...options,env:{STARCANVAS_CANDIDATE_APP:f.app,STARCANVAS_CANDIDATE_USER_DATA:alias}}),{code:'CANDIDATE_PROFILE_NOT_ISOLATED'});
});
test('malformed/missing/wrong-platform bundles never silently fall back to source',t=>{
  const f=fixture(t);assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'win32',env:{STARCANVAS_CANDIDATE_APP:f.app}}),{code:'CANDIDATE_PLATFORM_MISMATCH'});
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.win}}),{code:'CANDIDATE_PLATFORM_MISMATCH'});
  for(const name of ['../StarCanvas','sub/StarCanvas','sub\\StarCanvas','..',''])assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app},readMacExecutable:()=>name}),{code:'CANDIDATE_BUNDLE_INVALID'});
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:path.join(f.root,'missing.app')}}),{code:'CANDIDATE_BUNDLE_INVALID'});
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:path.join(f.root,'unknown')}}),{code:'CANDIDATE_SOURCE_TARGET_INVALID'});
});
test('symlinked executable and formal installed App are refused',t=>{
  const f=fixture(t);fs.unlinkSync(f.exe);fs.symlinkSync(f.win,f.exe);assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app}}),{code:'CANDIDATE_EXECUTABLE_INVALID'});
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:'/Applications/StarCanvas.app'}}),{code:'CANDIDATE_FORMAL_APP_REFUSED'});
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:'/applications/starcanvas.app'}}),{code:'CANDIDATE_FORMAL_APP_REFUSED'});
});
test('an upgrade fixture cannot redirect its packaged working directory through a symlink',t=>{
  const f=fixture(t),profile=path.join(f.root,'profile'),outside=path.join(f.root,'other');fs.mkdirSync(profile);fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(profile,'working-directory'),'dir');
  assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app,STARCANVAS_CANDIDATE_USER_DATA:profile}}),{code:'CANDIDATE_WORKING_DIRECTORY_INVALID'});
});
test('invalid QA identity never falls back to the formal system key entry',t=>{
  const f=fixture(t);assert.throws(()=>createCandidateLaunchPlan({...f.options,platform:'darwin',env:{STARCANVAS_CANDIDATE_APP:f.app,STARCANVAS_KEYCHAIN_QA_SERVICE:'StarCanvas Safe Storage'}}),{code:'CANDIDATE_QA_IDENTITY_INVALID'});
});
