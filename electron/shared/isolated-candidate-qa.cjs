// Explicit local QA only. No renderer/HTTP argument can enable this mode.
// Without both launch flags, production paths and transports are unchanged.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function isolatedCandidatePaths(env=process.env) {
  if(env.STARCANVAS_ISOLATED_CANDIDATE_QA!=='1')return null;
  if(env.WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA!=='1')fail('CANDIDATE_QA_NOT_AUTHORIZED');
  const requested=env.WANJUAN_TEST_USER_DATA_PATH;
  if(typeof requested!=='string'||!path.isAbsolute(requested))fail('CANDIDATE_QA_PROFILE_INVALID');
  const temp=fs.realpathSync(os.tmpdir()),resolved=path.resolve(requested);
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(![temp,path.resolve(os.tmpdir())].some(base=>normalize(resolved).startsWith(normalize(base+path.sep))))fail('CANDIDATE_QA_PROFILE_INVALID');
  let profile;
  try {
    const stat=fs.lstatSync(resolved);profile=fs.realpathSync(resolved);
    // NTFS ACLs are not POSIX mode bits: Node reports writable Windows
    // directories as 0666 even after chmod(0700). Do not interpret those bits
    // as an ACL check. The own OS-temp/non-alias scope remains mandatory on
    // Windows; POSIX platforms additionally reject group/world-writable roots.
    if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o022)!==0)||!normalize(profile).startsWith(normalize(temp+path.sep)))throw Error();
  }catch{fail('CANDIDATE_QA_PROFILE_INVALID');}
  const result={profile};
  for(const [name,folder]of Object.entries({downloads:'Downloads',desktop:'Desktop',documents:'Documents',pictures:'Pictures',videos:'Videos',music:'Music'}))result[name]=path.join(profile,folder);
  result.safetyBackup=path.join(result.downloads,'万卷灵境','自动备份');
  result.rendererLog=path.join(profile,'renderer-debug.log');
  return Object.freeze(result);
}
function candidateQaPorts(env=process.env) {
  const value=env.STARCANVAS_QA_MOCK_PORTS||'';
  if(value==='')return [];
  const parts=value.split(',');
  if(parts.length>8||parts.some(p=>!/^\d{1,5}$/.test(p)||+p<1||+p>65535))fail('CANDIDATE_QA_PORTS_INVALID');
  return [...new Set(parts.map(Number))];
}
function candidateQaModelBaseURL(env=process.env) {
  if(!isolatedCandidatePaths(env))return '';
  const value=env.STARCANVAS_QA_MODEL_ORIGIN;
  if(!value)fail('ASSISTANT_QA_MODEL_ORIGIN_REQUIRED');
  let target;try{target=new URL(value);}catch{fail('CANDIDATE_QA_MODEL_ORIGIN_INVALID');}
  if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/'||target.search||target.hash||!candidateQaPorts(env).includes(Number(target.port)))fail('CANDIDATE_QA_MODEL_ORIGIN_INVALID');
  return target.origin;
}
function candidateQaNetworkAllowed(value,desktopBaseUrl='',env=process.env) {
  if(!isolatedCandidatePaths(env))return true;
  let target;try{target=new URL(typeof value==='string'?value:value.url||value.href);}catch{return false;}
  if(target.username||target.password)return false;
  if(desktopBaseUrl){try{const base=new URL(desktopBaseUrl);if(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&target.origin===base.origin)return true;}catch{}}
  return target.protocol==='http:'&&['127.0.0.1','starcanvas-qa.invalid'].includes(target.hostname)&&candidateQaPorts(env).includes(Number(target.port));
}
function assertCandidateQaNetwork(value,desktopBaseUrl='',env=process.env) {
  if(!candidateQaNetworkAllowed(value,desktopBaseUrl,env))fail('CANDIDATE_QA_NETWORK_BLOCKED');
}
function candidateQaFileAllowed(value,env=process.env) {
  const qa=isolatedCandidatePaths(env);if(!qa)return null;
  try {
    const file=fs.realpathSync(value),relative=path.relative(qa.profile,file);
    return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);
  }catch{return false;}
}
function assertCandidateQaPath(value,env=process.env) {
  const qa=isolatedCandidatePaths(env);if(!qa)return;
  if(typeof value!=='string'||!path.isAbsolute(value))fail('CANDIDATE_QA_FILE_SCOPE');
  const resolved=path.resolve(value),inside=file=>{const relative=path.relative(qa.profile,file);return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);};
  if(!inside(resolved))fail('CANDIDATE_QA_FILE_SCOPE');
  let existing=resolved;
  while(!fs.existsSync(existing)){existing=path.dirname(existing);if(!inside(existing))fail('CANDIDATE_QA_FILE_SCOPE');}
  if(!inside(fs.realpathSync(existing)))fail('CANDIDATE_QA_FILE_SCOPE');
}
module.exports={isolatedCandidatePaths,candidateQaPorts,candidateQaModelBaseURL,candidateQaNetworkAllowed,assertCandidateQaNetwork,candidateQaFileAllowed,assertCandidateQaPath};
