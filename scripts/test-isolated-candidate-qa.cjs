const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{pathToFileURL}=require('node:url');
const qa=require('../electron/shared/isolated-candidate-qa.cjs');
const {installCandidateQaStartup}=require('../electron/main/candidate-qa-startup.cjs');
const sourceFunction=require('./source-function.cjs');
function fixture(t){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-candidate-scope-')));
  const env={STARCANVAS_ISOLATED_CANDIDATE_QA:'1',WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA:'1',WANJUAN_TEST_USER_DATA_PATH:root,STARCANVAS_QA_MOCK_PORTS:'54321,54322',STARCANVAS_QA_MODEL_ORIGIN:'http://127.0.0.1:54321'};
  const before={};for(const[k,v]of Object.entries(env)){before[k]=process.env[k];process.env[k]=v;}
  t.after(()=>{for(const k of Object.keys(env)){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}require('../electron/main/runtime-state.cjs').setDesktopBaseUrl(null);fs.rmSync(root,{recursive:true,force:true});});
  return {root,env};
}
function transports(){const calls=[];return {calls,http:{request:(...args)=>{calls.push(args);return 'HTTP_REQUEST';},get:(...args)=>{calls.push(args);return 'HTTP_GET';}},https:{request:(...args)=>{calls.push(args);return 'HTTPS_REQUEST';},get:(...args)=>{calls.push(args);return 'HTTPS_GET';}},targetGlobal:{fetch:(...args)=>{calls.push(args);return 'FETCH';}}};}
test('ordinary production mode does not change roots, request functions, fetch or public-network policy',()=>{
  const t=transports(),original=t.http.request,fetch=t.targetGlobal.fetch;assert.equal(installCandidateQaStartup({setPath(){assert.fail();}},{env:{},...t}),null);assert.equal(t.http.request,original);assert.equal(t.targetGlobal.fetch,fetch);assert.equal(qa.isolatedCandidatePaths({}),null);assert(qa.candidateQaNetworkAllowed('https://example.com',undefined,{}));assert.equal(qa.candidateQaFileAllowed('/outside',{}),null);qa.assertCandidateQaPath('/outside',{});
});
test('QA requires explicit independent existing temp profile and refuses invalid scope before any app initialization',t=>{
  const f=fixture(t);for(const patch of [{WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA:'0'},{WANJUAN_TEST_USER_DATA_PATH:'/Users/synthetic-formal-profile'},{WANJUAN_TEST_USER_DATA_PATH:'relative'},{WANJUAN_TEST_USER_DATA_PATH:os.tmpdir()}])assert.throws(()=>qa.isolatedCandidatePaths({...f.env,...patch}));
  const links=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-scope-alias-'));t.after(()=>fs.rmSync(links,{recursive:true,force:true}));fs.symlinkSync(f.root,path.join(links,'profile'),'dir');assert.throws(()=>qa.isolatedCandidatePaths({...f.env,WANJUAN_TEST_USER_DATA_PATH:path.join(links,'profile')}),{code:'CANDIDATE_QA_PROFILE_INVALID'});
});
test('startup routes all media roots into QA before service loading, preserves security settings and changes no formal path',t=>{
  const f=fixture(t),paths=qa.isolatedCandidatePaths(f.env),calls=[],network=transports();
  const result=installCandidateQaStartup({setPath:(k,v)=>calls.push([k,v]),commandLine:{appendSwitch:(k,v)=>calls.push([k,v])}},{env:f.env,...network});assert.equal(result.profile,f.root);
  assert.equal(calls.length,8);for(const[k,v]of calls.filter(([k])=>k!=='host-resolver-rules'))assert(v===f.root||v.startsWith(f.root+path.sep),k);assert.equal(calls.at(-1)[0],'host-resolver-rules');assert(!JSON.stringify(calls).includes('no-sandbox'));assert(paths.safetyBackup.startsWith(paths.downloads+path.sep));
  const startup=fs.readFileSync(path.join(__dirname,'../electron/main/index.cjs'),'utf8');assert(startup.indexOf('installCandidateQaStartup(app)')<startup.indexOf('require("./ipc.cjs")'));
});
test('Windows directory mode emulation is not mistaken for a POSIX ACL, while own temp and non-alias checks remain',t=>{
  const f=fixture(t),source=fs.readFileSync(path.join(__dirname,'../electron/shared/isolated-candidate-qa.cjs'),'utf8');
  function platformModule(platform){
    const module={exports:{}};
    const fakeFs={...fs,lstatSync(value){const actual=fs.lstatSync(value);return {isDirectory:()=>actual.isDirectory(),isSymbolicLink:()=>actual.isSymbolicLink(),mode:0o40666};}};
    vm.runInNewContext(source,{module,process:{platform,env:{}},require(name){if(name==='node:fs')return fakeFs;if(name==='node:path')return path;if(name==='node:os')return os;assert.fail(name);}});
    return module.exports;
  }
  assert.throws(()=>platformModule('darwin').isolatedCandidatePaths(f.env),{code:'CANDIDATE_QA_PROFILE_INVALID'});
  const win=platformModule('win32');assert.equal(win.isolatedCandidatePaths(f.env).profile,f.root);
  assert.throws(()=>win.isolatedCandidatePaths({...f.env,WANJUAN_TEST_USER_DATA_PATH:os.tmpdir()}),{code:'CANDIDATE_QA_PROFILE_INVALID'});
  const alias=path.join(f.root,'profile-alias');fs.symlinkSync(f.root,alias,'dir');
  assert.throws(()=>win.isolatedCandidatePaths({...f.env,WANJUAN_TEST_USER_DATA_PATH:alias}),{code:'CANDIDATE_QA_PROFILE_INVALID'});
});
test('QA alias and malformed port scopes refuse initialization without creating data in another directory',t=>{
  const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-scope-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(f.root,'Downloads'),'dir');
  const stub={setPath(){assert.fail('must fail before setting paths');},commandLine:{appendSwitch(){assert.fail();}}};assert.throws(()=>installCandidateQaStartup(stub,{env:f.env,...transports()}),{code:'CANDIDATE_QA_PATH_ALIAS'});assert.deepEqual(fs.readdirSync(outside),[]);
  assert.throws(()=>installCandidateQaStartup(stub,{env:{...f.env,STARCANVAS_QA_MOCK_PORTS:'54321,https://example.com'},...transports()}),{code:'CANDIDATE_QA_PORTS_INVALID'});
});
test('HTTP/get/fetch guards allow only declared mock or current static origins and cannot be bypassed by request options',t=>{
  const f=fixture(t),n=transports();installCandidateQaStartup({setPath(){},commandLine:{appendSwitch(){}}},{env:f.env,...n});require('../electron/main/runtime-state.cjs').setDesktopBaseUrl('http://127.0.0.1:54323');
  assert.equal(n.http.request('http://starcanvas-qa.invalid:54321/v1'), 'HTTP_REQUEST');assert.equal(n.http.get({hostname:'127.0.0.1',port:54323,path:'/index.html'}),'HTTP_GET');assert.equal(n.targetGlobal.fetch('http://127.0.0.1:54322/media',{redirect:'follow'}),'FETCH');assert.equal(n.calls.at(-1)[1].redirect,'manual');
  const before=n.calls.length;
  for(const args of [['https://example.com'],['http://127.0.0.1:1'],['http://starcanvas-qa.invalid:54321',{hostname:'example.com',port:80}],['http://starcanvas-qa.invalid:54321',{socketPath:'/synthetic/socket'}],[{hostname:'127.0.0.1',port:54321,createConnection(){}}],[{hostname:'127.0.0.1',port:54321,lookup(){}}]])assert.throws(()=>n.http.request(...args),{code:'CANDIDATE_QA_NETWORK_BLOCKED'});
  assert.throws(()=>n.https.get('https://example.com'),{code:'CANDIDATE_QA_NETWORK_BLOCKED'});assert.throws(()=>n.targetGlobal.fetch('https://example.com'),{code:'CANDIDATE_QA_NETWORK_BLOCKED'});assert.equal(n.calls.length,before);
});
test('file scope rejects outside paths, symlinks and future destinations beneath a foreign alias',t=>{
  const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-file-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.writeFileSync(path.join(outside,'private'),'SYNTHETIC_OUTSIDE');fs.writeFileSync(path.join(f.root,'own'),'OWN');fs.symlinkSync(outside,path.join(f.root,'alias'),'dir');
  assert(qa.candidateQaFileAllowed(path.join(f.root,'own'),f.env));assert.equal(qa.candidateQaFileAllowed(path.join(f.root,'alias/private'),f.env),false);assert.equal(qa.candidateQaFileAllowed(path.join(outside,'private'),f.env),false);qa.assertCandidateQaPath(path.join(f.root,'new/output.png'),f.env);assert.throws(()=>qa.assertCandidateQaPath(path.join(f.root,'alias/new/output.png'),f.env),{code:'CANDIDATE_QA_FILE_SCOPE'});assert.throws(()=>qa.assertCandidateQaPath(path.join(outside,'new'),f.env),{code:'CANDIDATE_QA_FILE_SCOPE'});
});
test('backup defaults and stored backup settings remain within QA without changing original production defaults',async t=>{
  const f=fixture(t),source=fs.readFileSync(path.join(__dirname,'../electron/preload/project-safety.cjs'),'utf8'),module={exports:{}};
  vm.runInNewContext(sourceFunction(source,'defaultProjectSafetyBackupRoot')+'\n'+sourceFunction(source,'getProjectSafetyConfig')+'\nmodule.exports={defaultProjectSafetyBackupRoot,getProjectSafetyConfig};',{module,path,os,isolatedCandidatePaths:()=>qa.isolatedCandidatePaths(f.env),projectSafetyGetMeta:async()=>({backupRoot:'/synthetic-formal/never-read'}),normalizeProjectSafetyInterval:(v,fallback)=>fallback,PROJECT_SAFETY_DEFAULT_CURRENT_BACKUP_INTERVAL_MS:1,PROJECT_SAFETY_DEFAULT_ALL_BACKUP_INTERVAL_MS:2});
  assert.equal(module.exports.defaultProjectSafetyBackupRoot(),qa.isolatedCandidatePaths(f.env).safetyBackup);assert.equal((await module.exports.getProjectSafetyConfig()).backupRoot,qa.isolatedCandidatePaths(f.env).safetyBackup);
});
test('renderer requests use one combined network/file filter, so file guard installation cannot remove the QA network fence',t=>{
  const f=fixture(t),module={exports:{}},callbacks=[];const source=fs.readFileSync(path.join(__dirname,'../electron/main/net/file-access-filter.cjs'),'utf8');
  vm.runInNewContext(source,{module,process,URL,require(name){if(['fs','node:fs'].includes(name))return fs;if(['os','node:os'].includes(name))return os;if(['path','node:path'].includes(name))return path;if(name==='../electron-refs.cjs')return {app:{getPath:()=>f.root},session:{defaultSession:{webRequest:{onBeforeRequest:fn=>callbacks.push(fn)}}}};if(name==='../logging.cjs')return {appendDesktopLog(){},truncateLogValue:()=>''};if(name==='../utils/paths.cjs')return {defaultDownloadDirectory:()=>f.root,localPathFromFileUrl:value=>require('node:url').fileURLToPath(value)};if(name==='../../shared/isolated-candidate-qa.cjs')return qa;if(name==='../runtime-state.cjs')return {getDesktopBaseUrl:()=> 'http://127.0.0.1:54323'};assert.fail(name);}});
  module.exports.installFileAccessFilter();assert.equal(callbacks.length,1);const decision=url=>{let result;callbacks[0]({url},v=>result=v);return result;};
  assert.equal(decision('https://example.com').cancel,true);assert.equal(decision('http://127.0.0.1:54323/index.html').cancel,false);assert.equal(decision('http://starcanvas-qa.invalid:54321/api').cancel,false);fs.writeFileSync(path.join(f.root,'pixel.png'),'QA');assert.equal(decision(pathToFileURL(path.join(f.root,'pixel.png')).href).cancel,false);assert.equal(decision('file:///synthetic-formal/never-read').cancel,true);assert.deepEqual(Array.from(module.exports.computeAllowedFileRoots()),[f.root]);
});
test('Harness QA origin is explicit and loopback-only, never an accidental real provider fallback',t=>{
  const f=fixture(t);assert.equal(qa.candidateQaModelBaseURL(f.env),'http://127.0.0.1:54321');for(const value of ['', 'https://api.deepseek.com','http://127.0.0.1:1','http://user:password@127.0.0.1:54321','http://127.0.0.1:54321/private'])assert.throws(()=>qa.candidateQaModelBaseURL({...f.env,STARCANVAS_QA_MODEL_ORIGIN:value}));
});
