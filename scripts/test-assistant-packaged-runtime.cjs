// No Electron app, Keychain, real runtime access or network. Exercise the actual
// service status against synthetic filesystem answers for packaged/source mode.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
async function status({packaged,bundled,unknown=false}) {
  const file=path.resolve(__dirname,'../electron/main/assistant-service.cjs'),load=Module._load,descriptor=Object.getOwnPropertyDescriptor(process,'resourcesPath'),accesses=[];
  process.resourcesPath=path.join(__dirname,'synthetic-only-resources');delete require.cache[file];
  let service;
  try {
    Module._load=function(name,parent,...rest){if(parent?.filename===file){
      if(name==='fs/promises'||name==='node:fs/promises')return {...require('node:fs/promises'),access:async p=>{accesses.push(p);if(!String(p).startsWith('/Applications/')&&!bundled)throw Object.assign(Error(),{code:'ENOENT'});}};
      if(name==='./electron-refs.cjs')return {app:{isPackaged:packaged,getAppPath:()=>path.join(__dirname,'synthetic-source')},net:{}};
      if(name==='./assistant-credential-vault.cjs')return {createSystemAssistantCredentialVault:()=>({hasCredential:async()=>false})};
      if(name==='./assistant-account-vault.cjs')return {createSystemAssistantAccountVault:()=>({hasRecord:async()=>false})};
      if(name==='./assistant-runtime-specs.cjs'&&unknown)return {};
    }return load.call(this,name,parent,...rest);};
    service=require(file);Module._load=load;return {value:await service.status(),accesses};
  } finally {Module._load=load;await service?.shutdown();delete require.cache[file];if(descriptor)Object.defineProperty(process,'resourcesPath',descriptor);else delete process.resourcesPath;}
}
test('packaged app with missing bundled runtime never discovers a system-installed Harness',async()=>{
  const r=await status({packaged:true,bundled:false});assert.equal(r.value.installed,false);assert(!r.accesses.some(p=>String(p).startsWith('/Applications/')));
});
test('packaged app on an unsupported target never falls back to a development/system runtime',async()=>{
  const r=await status({packaged:true,bundled:false,unknown:true});assert.equal(r.value.installed,false);assert.deepEqual(r.accesses,[]);
});
test('a present platform bundle remains the packaged runtime source',async()=>{
  const r=await status({packaged:true,bundled:true});assert.equal(r.value.installed,true);assert.equal(r.accesses.length,1);assert(r.accesses.every(p=>String(p).startsWith(path.join(__dirname,'synthetic-only-resources'))));
});
test('source mode keeps its existing macOS development fallback without using real files',async()=>{
  const r=await status({packaged:false,bundled:false});assert.equal(r.value.installed,process.platform==='darwin');assert.equal(r.accesses.some(p=>String(p).startsWith('/Applications/')),process.platform==='darwin');
});
