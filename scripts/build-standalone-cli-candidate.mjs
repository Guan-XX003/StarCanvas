#!/usr/bin/env node
// Prepare a version-matched, standalone CLI candidate. Never publish or overwrite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || '');
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2]) || fs.existsSync(output)) throw new Error('CLI_CANDIDATE_OUTPUT_INVALID');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || path.basename(output) !== `starcanvas-cli-${version}.zip`) throw new Error('CLI_CANDIDATE_VERSION_INVALID');
if (fs.readFileSync(path.join(root, 'bin/VERSION.txt'), 'utf8').trim() !== version) throw new Error('CLI_CANDIDATE_VERSION_MISMATCH');
const names = ['starcanvas.mjs','starcanvas-client.mjs','starcanvas-mcp.mjs','starcanvas-tianji-input.mjs',
  'wanjuan.mjs','wanjuan-client.mjs','wanjuan-mcp.mjs','wanjuan-tianji-input.mjs','VERSION.txt'];
const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, 'bin', name))]));
let readme = fs.readFileSync(path.join(root, 'docs/AUTOMATION_CLI.md'), 'utf8');
const old = '[下载 starcanvas-cli-1.4.7.zip](https://github.com/Guan-XX003/StarCanvas/releases/download/v1.4.7-release/starcanvas-cli-1.4.7.zip)';
if (readme.split(old).length !== 2) throw new Error('CLI_CANDIDATE_README_CHANGED');
readme = readme.replace(old, '请从 StarCanvas 官网下载与桌面应用版本一致的 CLI/MCP 压缩包。');
files['README.md'] = Buffer.from(readme);
const manifest = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, data.toString('base64')]));
const builder = `import base64,json,sys,zipfile\nfiles=json.load(sys.stdin)\nwith zipfile.ZipFile(sys.argv[1],'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for name,content in sorted(files.items()):\n  i=zipfile.ZipInfo(name,(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16\n  z.writestr(i,base64.b64decode(content,validate=True))\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None and sorted(z.namelist())==sorted(files)\n for name,content in files.items():assert z.read(name)==base64.b64decode(content,validate=True)\n`;
const result = spawnSync('/usr/bin/python3', ['-c', builder, output], {input: JSON.stringify(manifest), timeout: 60000, encoding: 'utf8'});
if (result.status !== 0) throw new Error('CLI_CANDIDATE_BUILD_FAILED');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
console.log(JSON.stringify({status:'PASS_STANDALONE_CLI_CANDIDATE_NOT_PUBLISHED',version,files:Object.keys(files).length,sha256}));
