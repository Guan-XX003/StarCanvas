const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);

// Inspect the actual production call sites, including async catch callbacks.
const expected = new Map([
  ['automation result persistence skipped',1], ['删除项目画布缓存失败',1],
  ['删除项目资产引用失败',1], ['删除项目便携资产失败',1],
  ['删除项目镜像缓存失败',1], ['删除项目媒体目录失败',1],
  ['Project cleanup failed',1], ['Skipped oversized project media data URL during canvas save',1],
  ['Project media force archive skipped',1], ['Project media persist skipped',1],
  ['Interrupted project migration recovery failed',2],
]);
const source = fs.readFileSync(require.resolve('../src/renderer/bundle/index.js'),'utf8');
const tree = ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const found = new Map();
function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(tree) === 'console') {
    const first=node.arguments[0];
    if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && expected.has(first.text)) {
      assert.equal(node.arguments.length,1,`${first.text}: logging must not include user-derived arguments`);
      found.set(first.text,(found.get(first.text)||0)+1);
    }
  }
  ts.forEachChild(node,visit);
}
visit(tree);assert.deepEqual(found,expected);
assert.doesNotMatch(source,/\.catch\(console\.error\)/,'async callbacks must not log raw rejection objects');
assert.doesNotMatch(source,/\[backup-import-report\]/,'restore report must not be dumped to logs');

// Exercise the real media externalizer's oversized-data branch with a
// synthetic private identifier and payload; behavior stays unchanged.
const {use_externalizeProjectAssetContainer} = require('../src/renderer/hooks/use_externalizeProjectAssetContainer.ts');
(async()=>{
  const warnings=[], original=console.warn;console.warn=(...args)=>warnings.push(args);
  try {
    const externalize=use_externalizeProjectAssetContainer({localforageModule:{default:null},PROJECT_ASSET_REF_SUFFIX:'__ref'}).externalizeProjectAssetContainer;
    const result=await externalize({imageUrl:'data:image/png;base64,'+'x'.repeat(1500001)},{nodeId:'SYNTHETIC_PRIVATE_NODE'});
    assert.deepEqual(result,{});
    assert.deepEqual(warnings,[['Skipped oversized project media data URL during canvas externalize']]);
    assert.doesNotMatch(JSON.stringify(warnings),/SYNTHETIC_PRIVATE_NODE|data:image/);
  } finally {console.warn=original;}
  console.log('PASS_CANVAS_STORAGE_LOG_PRIVACY');
})().catch(error=>{console.error(error);process.exitCode=1});
