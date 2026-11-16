#!/usr/bin/env node
// Explicit, offline staging of a previously downloaded official runtime wheel.
// It never overwrites a staged runtime or downloads/executes wheel contents.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const specs = require('../electron/main/assistant-runtime-specs.cjs');

function hashFile(file) {
  const h = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) h.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function entryExists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--target' || args[2] !== '--wheel' || !specs[args[1]]) throw Error('Usage: --target darwin-arm64|win32-x64 --wheel /absolute/path/to/verified.whl');
  const target = args[1], wheel = path.resolve(args[3]), spec = specs[target];
  if (!fs.lstatSync(wheel).isFile() || hashFile(wheel) !== spec.wheelSha256) throw Error('WHEEL_INTEGRITY_MISMATCH');
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';
  const list = spawnSync(tar, ['-tf', wheel], {encoding:'utf8',maxBuffer:1024*1024,timeout:30000});
  if (list.status !== 0) throw Error('WHEEL_LIST_FAILED');
  const names = list.stdout.trim().split(/\r?\n/);
  if (!names.length || names.length > 100 || names.some(name => !/^(?:deepseek_harness_runtime|deepseek_harness_runtime_bin-0\.2\.1rc2\.dist-info)\/[A-Za-z0-9_./-]+$/.test(name) || name.split('/').includes('..'))) throw Error('WHEEL_UNEXPECTED_PATH');
  const root = path.resolve(__dirname, '../tool-runtime/deepseek-harness');
  fs.mkdirSync(root, {recursive:true,mode:0o700});
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw Error('INVALID_STAGING_ROOT');
  const destination = path.join(root, target);
  if (entryExists(destination)) throw Error('TARGET_ALREADY_EXISTS_NOT_OVERWRITTEN');
  const stage = fs.mkdtempSync(path.join(root, '.stage-'));
  let published = false;
  try {
    const extract = spawnSync(tar, ['-xf', wheel, '-C', stage], {encoding:'utf8',maxBuffer:1024*1024,timeout:120000});
    if (extract.status !== 0 || hashFile(wheel) !== spec.wheelSha256) throw Error('WHEEL_EXTRACTION_FAILED');
    const runtimeDir = path.join(stage, 'deepseek_harness_runtime', 'runtime');
    for (const [name, digest] of Object.entries(spec.files)) {
      const file = path.join(runtimeDir, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || hashFile(file) !== digest) throw Error('RUNTIME_FILE_INTEGRITY_MISMATCH');
    }
    if (entryExists(destination)) throw Error('TARGET_ALREADY_EXISTS_NOT_OVERWRITTEN');
    fs.renameSync(stage, destination); published = true;
    console.log(`ASSISTANT_RUNTIME_PREPARED ${target} ${spec.version}`);
  } finally {
    if (!published) fs.rmSync(stage, {recursive:true,force:true});
  }
}
try { main(); } catch (error) { console.error(String(error.message || 'PREPARATION_FAILED')); process.exitCode = 1; }
