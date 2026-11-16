const fs=require('node:fs');
const {urlToHttpOptions}=require('node:url');
const {isolatedCandidatePaths,candidateQaPorts,assertCandidateQaNetwork}=require('../shared/isolated-candidate-qa.cjs');

function installCandidateQaStartup(app,{env=process.env,http=require('node:http'),https=require('node:https'),targetGlobal=globalThis}={}) {
  const qa=isolatedCandidatePaths(env);if(!qa)return null;
  candidateQaPorts(env); // Malformed scope is rejected before any app writes.
  for(const key of ['downloads','desktop','documents','pictures','videos','music']){
    if(fs.existsSync(qa[key])&&fs.lstatSync(qa[key]).isSymbolicLink())throw Object.assign(Error('CANDIDATE_QA_PATH_ALIAS'),{code:'CANDIDATE_QA_PATH_ALIAS'});
    fs.mkdirSync(qa[key],{recursive:true,mode:0o700});
    if(fs.realpathSync(qa[key])!==qa[key])throw Object.assign(Error('CANDIDATE_QA_PATH_ALIAS'),{code:'CANDIDATE_QA_PATH_ALIAS'});
  }
  app.setPath('userData',qa.profile);
  for(const key of ['downloads','desktop','documents','pictures','videos','music'])app.setPath(key,qa[key]);
  // A reserved test name resolves only to this host. No production URL guard,
  // certificate validation, Chromium switch or file filter is disabled.
  app.commandLine.appendSwitch('host-resolver-rules','MAP starcanvas-qa.invalid 127.0.0.1');
  const desktop=()=>require('./runtime-state.cjs').getDesktopBaseUrl()||'';
  const check=value=>assertCandidateQaNetwork(value,desktop(),env);
  function requestTarget(args,protocol){
    const first=args[0];
    const options=typeof first==='string'||first instanceof URL?{...urlToHttpOptions(new URL(first)),...(args[1]&&typeof args[1]==='object'?args[1]:{})}:first;
    if(!options||typeof options!=='object'||options.socketPath||options.createConnection||options.lookup||options.agent)throw Object.assign(Error('CANDIDATE_QA_NETWORK_BLOCKED'),{code:'CANDIDATE_QA_NETWORK_BLOCKED'});
    return `${options.protocol||protocol}//${options.hostname||options.host||'localhost'}${options.port?':'+options.port:''}${options.path||'/'}`;
  }
  for(const [transport,protocol]of [[http,'http:'],[https,'https:']])for(const method of ['request','get']){
    const original=transport[method];
    transport[method]=function(...args){check(requestTarget(args,protocol));return original.apply(this,args);};
  }
  if(typeof targetGlobal.fetch==='function'){
    const original=targetGlobal.fetch;
    targetGlobal.fetch=function(input,init){check(input);return original.call(this,input,{...init,redirect:'manual'});};
  }
  return qa;
}
module.exports={installCandidateQaStartup};
