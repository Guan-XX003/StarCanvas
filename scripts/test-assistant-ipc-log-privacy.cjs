// Run the actual IPC source guard with synthetic URLs and an in-memory logger.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {sanitizeLogPayload} = require('../electron/shared/diagnostic-policy.cjs');
const file = path.join(__dirname, '../electron/main/ipc.cjs');
const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = ['getIpcSenderUrl', 'isTrustedIpcEvent', 'rejectUntrustedIpc'];
const declarations = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(declarations.length, names.length);
const entries = [];
const ctx = {getDesktopBaseUrl:()=> 'http://127.0.0.1:5555', appendDesktopLog:(...entry)=>entries.push(entry)};
const reject = vm.runInNewContext(`${declarations.map(node=>node.getText(tree)).join('\n')}\nrejectUntrustedIpc`, ctx);
for (const url of ['https://PRIVATE_HOST.invalid/PRIVATE_PATH?token=PRIVATE_KEY#PRIVATE_FRAGMENT','http://127.0.0.1:55550/PRIVATE_PATH','not-a-url/PRIVATE_PATH']) {
  assert.equal(reject({senderFrame:{url}}, 'wanjuan:assistant-send').ok, false);
}
assert.equal(entries.length,3);
for (const entry of entries) {
  assert.equal(entry[0], 'untrusted-ipc-blocked');
  assert.deepEqual(JSON.parse(JSON.stringify(entry[1])), {channel:'wanjuan:assistant-send'});
  assert.deepEqual(sanitizeLogPayload(entry[1]), {channel:'wanjuan:assistant-send'}, 'the fixed channel survives the actual disk-log sanitizer');
  assert.doesNotMatch(JSON.stringify(entry), /PRIVATE_|55550/);
}
assert.equal(reject({senderFrame:{url:'http://127.0.0.1:5555/index.html'}}, 'wanjuan:assistant-send'), null);
assert.equal(entries.length,3, 'trusted IPC remains unchanged');
ctx.getDesktopBaseUrl = () => '';
assert.equal(reject({senderFrame:{url:'http://127.0.0.1:5555/index.html'}}, 'wanjuan:assistant-send').ok,false);
const unknown = sanitizeLogPayload({channel:'wanjuan:assistant-PRIVATE_KEY',senderUrl:'https://PRIVATE_HOST.invalid/PRIVATE_PATH?token=PRIVATE_KEY'});
assert.doesNotMatch(JSON.stringify(unknown), /PRIVATE_/,'an unrecognized channel or URL cannot enter the persisted log');
console.log('PASS_ASSISTANT_IPC_BLOCKED_LOG_PRIVACY');
