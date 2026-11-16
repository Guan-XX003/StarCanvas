// Local candidate QA only. Packaged Apps must launch their own executable,
// never a development Electron or a source-directory fallback.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

const fail = code => { throw Object.assign(new Error(code), {code}); };
function realTarget(value) {
  let parent = path.resolve(value);
  const pending = [];
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) fail('CANDIDATE_PROFILE_INVALID');
    pending.unshift(path.basename(parent)); parent = next;
  }
  return path.join(fs.realpathSync(parent), ...pending);
}
function nativeFile(value) {
  try {
    const stat = fs.lstatSync(value);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) fail('CANDIDATE_EXECUTABLE_INVALID');
  } catch { fail('CANDIDATE_EXECUTABLE_INVALID'); }
  return value;
}
function macExecutable(appPath) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], {encoding:'utf8', timeout:5000, stdio:['ignore','pipe','pipe']}).trim();
  } catch { fail('CANDIDATE_BUNDLE_INVALID'); }
}
function qaService(profile) {
  const hex = crypto.createHash('sha256').update(profile).digest('hex').slice(0,32).toUpperCase();
  return 'org.starcanvas.account-secret.qa.' + [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function createCandidateLaunchPlan({
  projectRoot = path.resolve(__dirname, '..'), env = process.env,
  platform = process.platform, home = os.homedir(), temp = os.tmpdir(),
  readMacExecutable = macExecutable,
  verifySourceRuntime = root => require('./verify-electron-runtime.cjs').verifyElectronRuntime(root),
  sourceElectron = () => require('electron'),
} = {}) {
  const root = path.resolve(projectRoot);
  const appPath = path.resolve(env.STARCANVAS_CANDIDATE_APP || root);
  const suffix = path.extname(appPath).toLowerCase();
  let command, args, kind;
  if (suffix === '.app') {
    if (platform !== 'darwin') fail('CANDIDATE_PLATFORM_MISMATCH');
    if ([ '/Applications/StarCanvas.app', path.join(home,'Applications','StarCanvas.app') ].some(value=>value.toLowerCase()===appPath.toLowerCase())) fail('CANDIDATE_FORMAL_APP_REFUSED');
    try { if (!fs.lstatSync(appPath).isDirectory() || fs.lstatSync(appPath).isSymbolicLink()) fail('CANDIDATE_BUNDLE_INVALID'); }
    catch { fail('CANDIDATE_BUNDLE_INVALID'); }
    const name = readMacExecutable(appPath);
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) fail('CANDIDATE_BUNDLE_INVALID');
    command = nativeFile(path.join(appPath,'Contents','MacOS',name)); args = []; kind = 'packaged-macos';
  } else if (suffix === '.exe') {
    if (platform !== 'win32') fail('CANDIDATE_PLATFORM_MISMATCH');
    command = nativeFile(appPath); args = []; kind = 'packaged-windows';
  } else {
    if (appPath !== root) fail('CANDIDATE_SOURCE_TARGET_INVALID');
    verifySourceRuntime(root); command = sourceElectron(); args = [root]; kind = 'source';
  }

  // Explicit profiles can be reused for restart/upgrade fixtures, but must stay
  // below the real OS temporary root. Symlinks cannot alias the formal profile.
  const tempRoot = fs.realpathSync(temp);
  const requested = env.STARCANVAS_CANDIDATE_USER_DATA;
  const compare = value => platform === 'win32' ? value.toLowerCase() : value;
  if (requested) {
    const resolved=path.resolve(requested);
    if (![path.resolve(temp),tempRoot].some(base=>compare(resolved).startsWith(compare(base+path.sep)))) fail('CANDIDATE_PROFILE_NOT_ISOLATED');
  }
  const profile = requested ? realTarget(requested) : fs.mkdtempSync(path.join(tempRoot,'starcanvas-candidate-'));
  if (!compare(profile).startsWith(compare(tempRoot + path.sep))) fail('CANDIDATE_PROFILE_NOT_ISOLATED');
  fs.mkdirSync(profile,{recursive:true,mode:0o700});
  if (!fs.lstatSync(profile).isDirectory() || fs.lstatSync(profile).isSymbolicLink()) fail('CANDIDATE_PROFILE_INVALID');
  // Let Chromium see the same isolated profile before application JavaScript
  // initializes; the app's early setPath and native vault use this exact root.
  args.push('--user-data-dir='+profile);
  const cwd = kind === 'source' ? root : path.join(profile,'working-directory');
  if (kind !== 'source') {
    if (fs.existsSync(cwd) && fs.lstatSync(cwd).isSymbolicLink()) fail('CANDIDATE_WORKING_DIRECTORY_INVALID');
    fs.mkdirSync(cwd,{recursive:true,mode:0o700});
    if (!fs.lstatSync(cwd).isDirectory() || realTarget(cwd)!==cwd) fail('CANDIDATE_WORKING_DIRECTORY_INVALID');
  }
  const childEnv = {...env, WANJUAN_TEST_USER_DATA_PATH:profile,
    STARCANVAS_ISOLATED_CANDIDATE_QA:'1',
    WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA:'1', WANJUAN_ALLOW_RANDOM_PORT:'1', WANJUAN_DISABLE_UPDATE_CHECK:'1'};
  for (const name of Object.keys(childEnv)) if (name === 'ELECTRON_RUN_AS_NODE' || name === 'NODE_OPTIONS' || name === 'NODE_PATH' || name === 'ELECTRON_OVERRIDE_DIST_PATH' || name.startsWith('DYLD_')) delete childEnv[name];
  if(kind!=='source')delete childEnv.WANJUAN_DEV_SERVER_URL;
  if (platform === 'darwin') {
    const service = env.STARCANVAS_KEYCHAIN_QA_SERVICE || qaService(profile);
    if (!/^org\.starcanvas\.account-secret\.qa\.[A-F0-9-]{36}$/.test(service)) fail('CANDIDATE_QA_IDENTITY_INVALID');
    childEnv.STARCANVAS_KEYCHAIN_QA_SERVICE = service;
    if (kind === 'source') childEnv.STARCANVAS_DEV_KEYCHAIN_QA = '1';
  }
  return {kind,command,args,cwd,env:childEnv,userDataPath:profile};
}
module.exports = {createCandidateLaunchPlan};
