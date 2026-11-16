const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const specs = require('../electron/main/assistant-runtime-specs.cjs');
const resourcesRoot = require('./packaged-resource-root.cjs');
const licenseHashes = {
  'LICENSE': 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be',
  'THIRD_PARTY_NOTICES.md': 'aeea7aa256ede5349cc7903f56a859d54f10b82a45fba7dcce667eb69916dab0',
};

function digest(file) {
  const hash = crypto.createHash('sha256'), buf = Buffer.allocUnsafe(1024 * 1024), fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function verifyPackagedAssistantRuntime(context) {
  const arch = ({0:'ia32', 1:'x64', 2:'armv7l', 3:'arm64', 4:'universal'})[context.arch] || String(context.arch || '');
  const target = `${context.electronPlatformName}-${arch}`, spec = specs[target];
  if (!spec) return {target, supported:false};
  const root = path.join(resourcesRoot(context), 'assistant-harness', target);
  const runtime = path.join(root, 'deepseek_harness_runtime', 'runtime');
  try {
    for (const [name, sha] of Object.entries(spec.files)) {
      const file = path.join(runtime, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || digest(file) !== sha) throw Error();
    }
    for (const [name, expected] of Object.entries(licenseHashes)) {
      const file = path.join(root, 'deepseek_harness_runtime_bin-0.2.1rc2.dist-info', 'licenses', name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || digest(file) !== expected) throw Error();
    }
  } catch { throw Error(`Assistant runtime missing or invalid for ${target}; prepare the pinned official wheel before packaging.`); }
  return {target, supported:true};
}
module.exports = {verifyPackagedAssistantRuntime};
