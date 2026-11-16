const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function verifyPackagedMacSignature(context,{run=execFileSync}={}){
 if(context.electronPlatformName!=='darwin')return {supported:false};
 const product=context.packager?.appInfo?.productFilename||'StarCanvas';
 if(!product||/[\\/\x00-\x1f]/.test(product)||product==='.'||product==='..')throw Error('PACKAGED_MAC_SIGNATURE_INVALID');
 const app=path.join(context.appOutDir,product+'.app');
 try{const stat=fs.lstatSync(app);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error();run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});}
 catch{throw Error('PACKAGED_MAC_SIGNATURE_INVALID');}
 return {supported:true};
}
module.exports={verifyPackagedMacSignature};
