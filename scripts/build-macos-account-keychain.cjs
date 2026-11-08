// Build the release helper ONCE. Future builds must reuse the same exact signed
// file; changing its identity may require users to reauthenticate.
const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
if(process.platform!=='darwin')throw Error('MACOS_BUILD_HOST_REQUIRED');
const root=path.join(__dirname,'..');
const targetDir=path.join(root,'build','native-tools');
const target=path.join(targetDir,'macos-account-keychain');
if(fs.existsSync(target))throw Error('FROZEN_HELPER_EXISTS_DO_NOT_OVERWRITE');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'starcanvas-helper-build-'));
const source=path.join(root,'electron','native','macos-account-keychain.swift');
function run(file,args){const r=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:131072});if(r.error||r.status!==0)throw Error('NATIVE_HELPER_BUILD_FAILED');}
try {
  for(const arch of ['arm64','x86_64'])run('/usr/bin/xcrun',['swiftc','-O','-target',`${arch}-apple-macos11.0`,source,'-o',path.join(tmp,arch)]);
  const universal=path.join(tmp,'helper');
  run('/usr/bin/xcrun',['lipo','-create',path.join(tmp,'arm64'),path.join(tmp,'x86_64'),'-output',universal]);
  run('/usr/bin/codesign',['--force','--sign','-','--identifier','org.starcanvas.account-keychain-helper',universal]);
  run('/usr/bin/codesign',['--verify','--strict',universal]);
  fs.mkdirSync(targetDir,{recursive:true});
  fs.copyFileSync(universal,target,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target,0o755);
  console.log(JSON.stringify({status:'BUILT_FROZEN_HELPER_NOT_RELEASED',sha256:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),target}));
} finally {
  if(path.dirname(tmp)!==os.tmpdir()||!path.basename(tmp).startsWith('starcanvas-helper-build-'))throw Error('TEMP_ROOT_INVALID');
  fs.rmSync(tmp,{recursive:true,force:false});
}
