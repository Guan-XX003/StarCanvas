const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const contract=require('../electron/shared/macos-account-helper.cjs');
const resourcesRoot=require('./packaged-resource-root.cjs');

function verifyPackagedMacAccountKeychain(context) {
  if(context.electronPlatformName!=='darwin')return {supported:false};
  const file=path.join(resourcesRoot(context),contract.resourceDirectory,contract.executable);
  try {
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size===0||stat.size>10*1024*1024)throw Error();
    if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==contract.sha256)throw Error();
  } catch {throw Object.assign(new Error('PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'),{code:'PACKAGED_MAC_KEYCHAIN_IDENTITY_CHANGED'});}
  return {supported:true,sha256:contract.sha256};
}
module.exports={verifyPackagedMacAccountKeychain};
