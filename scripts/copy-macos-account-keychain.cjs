const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contract = require('../electron/shared/macos-account-helper.cjs');
const resourceRoot = require('./packaged-resource-root.cjs');

module.exports = function copyMacAccountKeychain(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const source = path.join(__dirname, '..', 'build', 'native-tools', contract.executable);
  const sourceCode = path.join(__dirname, '..', 'electron', 'native', 'macos-account-keychain.swift');
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(sourceCode)).digest('hex');
  if (sourceHash !== '283a5a858692f534434eb87b84dffb867355a2d4a0e7ef57118cc1b92088d441') throw Error('MAC_KEYCHAIN_HELPER_SOURCE_CHANGED');
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 10 * 1024 * 1024) throw Error('MAC_KEYCHAIN_HELPER_INVALID');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  if (hash !== contract.sha256) throw Error('MAC_KEYCHAIN_HELPER_IDENTITY_CHANGED');
  const directory = path.join(resourceRoot(context), contract.resourceDirectory);
  fs.mkdirSync(directory, {recursive:false});
  const target = path.join(directory, contract.executable);
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o755);
  if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== hash) throw Error('MAC_KEYCHAIN_HELPER_COPY_MISMATCH');
};
