// Identify only complete, statically inspectable three-language UI entries.
// Incomplete or dynamic forms remain subject to the ordinary translation audit.
const ts = require('typescript');
const chinese = /[\u3400-\u9fff]/;
const name = node => node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : '';
const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const placeholders = value => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]).sort().join('|');
const complete = (cn, tw, en) => [cn, tw, en].every(value => typeof value === 'string' && value.trim()) && !chinese.test(en) && placeholders(cn) === placeholders(tw) && placeholders(cn) === placeholders(en);
const property = (object, key) => ts.isObjectLiteralExpression(object) ? object.properties.find(item => ts.isPropertyAssignment(item) && name(item.name) === key) : undefined;

function dictionaryEntry(node) {
  const item = node.parent;
  if (!ts.isPropertyAssignment(item) || item.initializer !== node) return false;
  const localeObject = item.parent, locale = localeObject?.parent;
  if (!ts.isObjectLiteralExpression(localeObject) || !ts.isPropertyAssignment(locale) || locale.initializer !== localeObject) return false;
  if (!['zh-CN', 'zh-TW', 'en-US', 'en'].includes(name(locale.name))) return false;
  const dictionary = locale.parent;
  if (!ts.isObjectLiteralExpression(dictionary)) return false;
  const key = name(item.name);
  const get = lang => {
    const entry = property(dictionary, lang);
    const value = entry && property(entry.initializer, key);
    return value ? literal(value.initializer) : null;
  };
  return complete(get('zh-CN'), get('zh-TW'), get('en-US') ?? get('en'));
}

function localeCondition(node) {
  if (!ts.isBinaryExpression(node) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) return '';
  const left = name(node.left), right = name(node.right);
  if (left !== 'appLanguage') return '';
  return ['en-US', 'zh-TW'].includes(right) ? right : '';
}

function ternaryEntry(node) {
  let top = node.parent;
  if (!top || !ts.isConditionalExpression(top)) return false;
  while (top.parent && ts.isConditionalExpression(top.parent) && top.parent.whenFalse === top) top = top.parent;
  const branches = {};
  let current = top;
  while (ts.isConditionalExpression(current)) {
    const lang = localeCondition(current.condition);
    if (!lang || Object.hasOwn(branches, lang)) return false;
    branches[lang] = literal(current.whenTrue);
    current = current.whenFalse;
  }
  branches['zh-CN'] = literal(current);
  return complete(branches['zh-CN'], branches['zh-TW'], branches['en-US']);
}

function isCompleteInlineLocale(node) { return dictionaryEntry(node) || ternaryEntry(node); }
module.exports = { isCompleteInlineLocale };
