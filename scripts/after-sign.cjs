// Run after code signing, not just after resource copying. The helper's exact
// identity and the pinned official Harness bytes must survive packaging.
const {verifyPackagedMacAccountKeychain}=require('./verify-packaged-macos-account-keychain.cjs');
const {verifyPackagedAssistantRuntime}=require('./verify-packaged-assistant-runtime.cjs');
const {verifyPackagedMacSignature}=require('./verify-packaged-macos-signature.cjs');

module.exports=async function afterSign(context) {
  if(context.electronPlatformName!=='darwin')return;
  verifyPackagedMacAccountKeychain(context);
  const runtime=verifyPackagedAssistantRuntime(context);
  if(!runtime.supported)throw Error('PACKAGED_SIGNED_ASSISTANT_TARGET_UNSUPPORTED');
  verifyPackagedMacSignature(context);
  console.log('Packaged signed macOS helper identity and pinned assistant runtime verified');
};
