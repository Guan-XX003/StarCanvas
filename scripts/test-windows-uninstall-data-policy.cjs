const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const installer = fs.readFileSync(path.join(root, "build/installer.nsh"), "utf8");
const config = fs.readFileSync(path.join(root, "electron/main/config.cjs"), "utf8");

assert.notEqual(packageJson.build?.deleteAppDataOnUninstall, true,
  "Uninstall must not silently delete app data");
assert.notEqual(packageJson.build?.nsis?.deleteAppDataOnUninstall, true,
  "NSIS uninstall must preserve the custom userData directory");
assert.doesNotMatch(installer, /RMDir\s+\/r\s+"\$APPDATA\\[^\"]+"/i,
  "Custom NSIS uninstall hooks must not recursively remove user data");
assert.match(config, /TEST_USER_DATA_DIR\s*=\s*["']wanjuan-ai-canvas-desktop-test["']/,
  "The uninstall policy must cover the actual custom Windows userData directory");
// Execute the actual initializer with a synthetic Windows appData path. A QA
// profile prefix must not make this test mistake stronger isolation for a
// change to the ordinary packaged user's long-standing data directory.
const source=fs.readFileSync(path.join(root,"electron/main/index.cjs"),"utf8");
const tree=ts.createSourceFile('index.cjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const initializer=tree.statements.find(node=>ts.isTryStatement(node)&&node.tryBlock.statements[0]?.getText(tree)==='app.setName(TEST_BUILD_NAME);');
assert(initializer,'The actual userData initializer must remain testable');
const stable=path.win32.join('C:\\QA\\AppData\\Roaming','wanjuan-ai-canvas-desktop-test');
for(const [packaged,testPath,allow,qa,expected]of [
  [true,'',false,undefined,stable],
  [true,'D:\\QA\\not-enabled',false,undefined,stable],
  [true,'D:\\QA\\isolated',true,undefined,'D:\\QA\\isolated'],
  [false,'D:\\QA\\dev',false,undefined,'D:\\QA\\dev'],
  [true,'D:\\QA\\other',true,{profile:'C:\\QA\\Temp\\candidate'},'C:\\QA\\Temp\\candidate'],
]){
 let actual;
 vm.runInNewContext(initializer.getText(tree),{app:{isPackaged:packaged,setName(){},getPath:key=>{assert.equal(key,'appData');return 'C:\\QA\\AppData\\Roaming';},setPath:(key,value)=>{assert.equal(key,'userData');actual=value;}},path:path.win32,TEST_BUILD_NAME:'StarCanvas',TEST_USER_DATA_DIR:'wanjuan-ai-canvas-desktop-test',TEST_USER_DATA_PATH:testPath,process:{env:allow?{WANJUAN_ALLOW_PACKAGED_TEST_USER_DATA:'1'}:{}},candidateQaPaths:qa});
 assert.equal(actual,expected,'Packaged defaults must preserve old data; explicit test profiles remain isolated');
}

console.log("Windows uninstall preserves StarCanvas userData: PASS");
