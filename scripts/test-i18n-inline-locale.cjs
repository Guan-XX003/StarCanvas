const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {isCompleteInlineLocale} = require('./i18n-inline-locale.cjs');

function check(source, expected) {
  const file = ts.createSourceFile('example.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /[\u3400-\u9fff]/.test(node.text)) found.push(isCompleteInlineLocale(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(found, expected, source);
}
check('const copy={"zh-CN":{title:"你好 {name}"},"zh-TW":{title:"你好 {name}"},"en-US":{title:"Hello {name}"}};', [true,true]);
check('const copy={"zh-CN":{title:"你好"},"zh-TW":{title:"你好"},en:{title:"Hello"}};', [true,true]);
check('const copy={"zh-CN":{title:"你好"},"zh-TW":{title:"你好"}};', [false,false]);
check('const copy={"zh-CN":{title:"你好 {name}"},"zh-TW":{title:"你好 {name}"},"en-US":{title:"Hello"}};', [false,false]);
check('const copy={"zh-CN":{title:"你好"},"zh-TW":{title:"你好"},"en-US":{title:"你好"}};', [false,false,false]);
check('const x=appLanguage === "en-US" ? "Hello" : appLanguage === "zh-TW" ? "你好" : "您好";', [true,true]);
check('const x=appLanguage === "en-US" ? "Hello" : appLanguage === "zh-TW" ? "你好" : dynamic;', [false]);
check('const x=someOtherValue === "en-US" ? "Hello" : appLanguage === "zh-TW" ? "你好" : "您好";', [false,false]);
check('const x=appLanguage === "en-US" ? "Hello" : appLanguage === "zh-TW" ? "你好 {name}" : "您好 {name}";', [false,false]);
// Check every key, not only properties the general UI-literal scanner sees.
const appFile = ts.createSourceFile('assistant-onboarding.tsx', fs.readFileSync(path.join(__dirname, '../src/renderer/components/assistant-onboarding.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expectedDictionaries = new Set(['copy','accountCopy','connectionCopy','handoffCopy']);
const placeholders = value => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(item => item[1]).sort();
for (const statement of appFile.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    const dictionaryName = declaration.name.text;
    if (!expectedDictionaries.has(dictionaryName)) continue;
    expectedDictionaries.delete(dictionaryName);
    assert.ok(ts.isObjectLiteralExpression(declaration.initializer), dictionaryName);
    const locales = {};
    for (const entry of declaration.initializer.properties) {
      assert.ok(ts.isPropertyAssignment(entry) && ts.isObjectLiteralExpression(entry.initializer), dictionaryName);
      const lang = entry.name.text;
      locales[lang] = {};
      for (const item of entry.initializer.properties) {
        assert.ok(ts.isPropertyAssignment(item) && ts.isStringLiteral(item.initializer), `${dictionaryName}.${lang}`);
        const key = item.name.text;
        assert.equal(Object.hasOwn(locales[lang], key), false, `duplicate ${dictionaryName}.${lang}.${key}`);
        locales[lang][key] = item.initializer.text;
      }
    }
    assert.deepEqual(Object.keys(locales).sort(), ['en-US','zh-CN','zh-TW'], dictionaryName);
    const keys = Object.keys(locales['zh-CN']).sort();
    for (const lang of ['zh-TW','en-US']) {
      assert.deepEqual(Object.keys(locales[lang]).sort(), keys, `${dictionaryName}.${lang} keys`);
      for (const key of keys) {
        assert.ok(locales[lang][key].trim(), `${dictionaryName}.${lang}.${key} empty`);
        assert.deepEqual(placeholders(locales[lang][key]), placeholders(locales['zh-CN'][key]), `${dictionaryName}.${lang}.${key} placeholders`);
        if (lang === 'en-US') assert.doesNotMatch(locales[lang][key], /[\u3400-\u9fff]/, `${dictionaryName}.${lang}.${key} contains Chinese`);
      }
    }
  }
}
assert.equal(expectedDictionaries.size, 0, `missing dictionaries: ${[...expectedDictionaries].join(', ')}`);
console.log('PASS_I18N_INLINE_LOCALE_VALIDATION');
