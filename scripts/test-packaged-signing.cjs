const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {verifyPackagedMacAccountKeychain}=require('./verify-packaged-macos-account-keychain.cjs');
const {verifyPackagedMacSignature}=require('./verify-packaged-macos-signature.cjs');
const contract=require('../electron/shared/macos-account-helper.cjs');

test('Mac signing preserves the exact pinned resource scopes but not the App or Electron framework',()=>{
  const build=require('../package.json').build,filters=build.mac.signIgnore.map(pattern=>new RegExp(pattern));
  for(const relative of [contract.resourceDirectory+'/'+contract.executable,'assistant-harness/darwin-arm64/deepseek_harness_runtime/runtime/helper','tool-runtime/darwin-arm64/deface/runtime/bin/python3'])assert(filters.some(r=>r.test('/candidate/StarCanvas.app/Contents/Resources/'+relative)),relative);
  for(const relative of ['MacOS/StarCanvas','Frameworks/Electron Framework.framework/Versions/A/Electron Framework','Resources/app.asar','Resources/starcanvas-account-keychain-extra/another'])assert(!filters.some(r=>r.test('/candidate/StarCanvas.app/Contents/'+relative)),relative);
  assert.equal(build.afterSign,'scripts/after-sign.cjs');assert.equal(build.mac.identity,'-');assert.equal(build.mac.hardenedRuntime,true);
});
test('signed bundle helper verification accepts only the exact copied native identity and refuses mutation or symlink',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-signed-helper-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const destination=path.join(root,'StarCanvas.app/Contents/Resources',contract.resourceDirectory,contract.executable);fs.mkdirSync(path.dirname(destination),{recursive:true});
  const context={electronPlatformName:'darwin',appOutDir:root};fs.copyFileSync(path.join(__dirname,'../build/native-tools',contract.executable),destination);
  assert.deepEqual(verifyPackagedMacAccountKeychain(context),{supported:true,sha256:contract.sha256});fs.appendFileSync(destination,'synthetic-signature-mutation');assert.throws(()=>verifyPackagedMacAccountKeychain(context),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});
  fs.unlinkSync(destination);fs.symlinkSync(path.join(__dirname,'../build/native-tools',contract.executable),destination);assert.throws(()=>verifyPackagedMacAccountKeychain(context),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});
});
test('afterSign verifies both helper and Harness after signing and propagates a changed identity',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'after-sign.cjs'),'utf8');
  for(const failure of [false,true]){
    const calls=[],module={exports:{}};vm.runInNewContext(source,{module,console:{log(){}},require(name){if(name==='./verify-packaged-macos-account-keychain.cjs')return {verifyPackagedMacAccountKeychain(){calls.push('helper');if(failure)throw Object.assign(Error(),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});}};if(name==='./verify-packaged-assistant-runtime.cjs')return {verifyPackagedAssistantRuntime(){calls.push('harness');return {supported:true};}};if(name==='./verify-packaged-macos-signature.cjs')return {verifyPackagedMacSignature(){calls.push('signature');}};assert.fail(name);}});
    if(failure)await assert.rejects(module.exports({electronPlatformName:'darwin'}),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});else await module.exports({electronPlatformName:'darwin'});
    assert.deepEqual(calls,failure?['helper']:['helper','harness','signature']);
    calls.length=0;await module.exports({electronPlatformName:'win32'});assert.deepEqual(calls,[]);
  }
});
test('Mac package signature gate checks the actual bundle recursively and rejects missing, aliased or invalid signed artifacts',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-signature-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const app=path.join(root,'StarCanvas.app');fs.mkdirSync(app);const calls=[];
 assert.deepEqual(verifyPackagedMacSignature({electronPlatformName:'darwin',appOutDir:root},{run:(...args)=>calls.push(args)}),{supported:true});
 assert.equal(calls[0][0],'/usr/bin/codesign');assert.deepEqual(calls[0][1],['--verify','--deep','--strict','--verbose=2',app]);
 assert.throws(()=>verifyPackagedMacSignature({electronPlatformName:'darwin',appOutDir:root},{run:()=>{throw Error('UNSIGNED');}}),/PACKAGED_MAC_SIGNATURE_INVALID/);
 assert.throws(()=>verifyPackagedMacSignature({electronPlatformName:'darwin',appOutDir:root,packager:{appInfo:{productFilename:'../foreign'}}},{run:()=>assert.fail()}),/PACKAGED_MAC_SIGNATURE_INVALID/);
 assert.deepEqual(verifyPackagedMacSignature({electronPlatformName:'win32'}),{supported:false});
});
test('a missing helper or unsupported signed Harness target cannot be reported as a valid Mac package',async()=>{
  assert.throws(()=>verifyPackagedMacAccountKeychain({electronPlatformName:'darwin',appOutDir:path.join(os.tmpdir(),'nonexistent-starcanvas-signed-bundle')}),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});
  assert.deepEqual(verifyPackagedMacAccountKeychain({electronPlatformName:'win32'}),{supported:false});
  const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'after-sign.cjs'),'utf8'),{module,console:{log(){}},require:name=>name==='./verify-packaged-macos-account-keychain.cjs'?{verifyPackagedMacAccountKeychain(){}}:{verifyPackagedAssistantRuntime:()=>({supported:false})}});
  await assert.rejects(module.exports({electronPlatformName:'darwin'}),/PACKAGED_SIGNED_ASSISTANT_TARGET_UNSUPPORTED/);
});
