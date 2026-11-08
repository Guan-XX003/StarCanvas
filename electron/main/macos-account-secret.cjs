// Main-process only: the helper uses stdio, never argv, for account secrets.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {app} = require('./electron-refs.cjs');
const contract = require('../shared/macos-account-helper.cjs');

function helperError(code = 'SECURE_STORAGE_UNAVAILABLE') {
  const error = new Error(code === 'SECURE_STORAGE_RELOGIN_REQUIRED'
    ? '需要重新登录才能恢复账号安全存储，本地项目不受影响'
    : code === 'SECURE_STORAGE_TIMEOUT' ? '系统安全存储操作超时，登录令牌未保存'
    : '系统安全存储暂不可用，登录令牌未保存');
  error.code = code;
  return error;
}
function devQaEnabled() { return app?.isPackaged === false && process.env.STARCANVAS_DEV_KEYCHAIN_QA === '1'; }
function enabled() { return process.platform === 'darwin' && (app?.isPackaged === true || devQaEnabled()); }
function assertDevQaProfile() {
  const requested = process.env.WANJUAN_TEST_USER_DATA_PATH || '';
  const actual = app.getPath('userData');
  try {
    const temp = fs.realpathSync(os.tmpdir());
    const actualReal = fs.realpathSync(actual);
    if (!requested || fs.realpathSync(requested) !== actualReal || !actualReal.startsWith(temp + path.sep)) throw Error();
  } catch { throw helperError(); }
}
function helperPath() {
  if (devQaEnabled()) assertDevQaProfile();
  const file = devQaEnabled()
    ? path.join(app.getAppPath(), 'build', 'native-tools', contract.executable)
    : path.join(process.resourcesPath, contract.resourceDirectory, contract.executable);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024 || stat.size === 0) throw Error();
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (hash !== contract.sha256) throw Error();
    return file;
  } catch { throw helperError(); }
}
function qaScope() {
  const testing = process.env.WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA === '1' || devQaEnabled();
  if (!testing) return '';
  const service = process.env.STARCANVAS_KEYCHAIN_QA_SERVICE || '';
  if (!process.env.WANJUAN_TEST_USER_DATA_PATH || !/^org\.starcanvas\.account-secret\.qa\.[A-F0-9-]{36}$/.test(service)) throw helperError();
  if (devQaEnabled()) assertDevQaProfile();
  return service;
}
function request(operation, value) {
  const text = String(value || '');
  const qaService = qaScope();
  const payload = JSON.stringify({operation, value:text, ...(qaService ? {qaService} : {})});
  if (Buffer.byteLength(payload, 'utf8') > 131072) return Promise.reject(helperError());
  const file = helperPath();
  const env = {...process.env};
  for (const name of Object.keys(env)) if (name.startsWith('DYLD_') || name.startsWith('NODE_')) delete env[name];
  delete env.STARCANVAS_KEYCHAIN_QA;
  delete env.STARCANVAS_KEYCHAIN_QA_SERVICE;
  if (qaService) env.STARCANVAS_KEYCHAIN_QA = '1';
  return new Promise((resolve, reject) => {
    let settled = false, output = '';
    const child = spawn(file, [], {env, stdio:['pipe','pipe','ignore']});
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(helperError('SECURE_STORAGE_TIMEOUT')); }, 6500);
    child.once('error', () => finish(helperError()));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 524288) { child.kill('SIGKILL'); finish(helperError()); }
    });
    child.once('close', code => {
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.ok !== true || typeof result.value !== 'string') {
          return finish(helperError(result.code === 'KEY_MISSING' || result.code === 'DECRYPT_FAILED'
            ? 'SECURE_STORAGE_RELOGIN_REQUIRED' : 'SECURE_STORAGE_UNAVAILABLE'));
        }
        return finish(null, result.value);
      } catch { return finish(helperError()); }
    });
    child.stdin.end(payload);
  });
}
module.exports = {enabled, request, ciphertextPrefix:contract.ciphertextPrefix, helperError};
