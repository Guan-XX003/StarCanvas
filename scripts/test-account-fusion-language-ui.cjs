const assert = require("node:assert/strict");
const { navClickExpression, LANGUAGE_SELECT_EXPRESSION, languageChangeExpression, languageCommittedExpression, switchAccountFusionLanguage } = require("./account-fusion-language-ui.cjs");

async function main() {
  const storage = new Map();
  const events = [];
  let runtimeLanguage = 'zh-CN';
  const options = [{ value: 'zh-CN' }, { value: 'zh-TW' }, { value: 'en-US' }];
  class Select {
    constructor() { this.options = options; this.selected = 'zh-CN'; this.disabled = false; }
    get value() { return this.selected; }
    set value(value) { this.selected = value; }
    dispatchEvent(event) {
      events.push(event.type);
      runtimeLanguage = this.value;
      storage.set('appLanguage', this.value);
      storage.set('uiLanguage', this.value);
    }
  }
  const select = new Select();
  const buttons = ['Appearance & General', 'My Account'].map((label) => ({ textContent: label, click() { events.push(label); } }));
  const runtime = { t: (source, language) => ({ '外观与通用': 'Appearance & General', '我的账号': 'My Account' }[source] || source), getLanguage: () => runtimeLanguage };
  const document = {
    querySelectorAll: (selector) => selector.includes('sidebar') ? buttons : [select],
    querySelector: () => ({}),
  };
  const evaluate = (expression) => new Function('document','globalThis','HTMLSelectElement','Event','localStorage', `return ${expression};`)(
    document, { wanjuanI18nRuntime: runtime }, Select, class Event { constructor(type) { this.type = type; } }, { getItem: (key) => storage.get(key) });
  assert.equal(evaluate(LANGUAGE_SELECT_EXPRESSION), true);
  for (const language of ['en-US','zh-TW','zh-CN']) {
    await switchAccountFusionLanguage({ evaluate: async (expression) => evaluate(expression), waitFor: async (expression) => assert.equal(evaluate(expression), true) }, language);
    assert.equal(select.value, language);
    assert.equal(evaluate(languageCommittedExpression(language)), true);
  }
  assert.deepEqual(events, Array(3).fill(['Appearance & General','change','My Account']).flat());
  select.disabled = true;
  assert.equal(evaluate(languageChangeExpression('en-US')), false);
  storage.set('appLanguage','en-US');
  assert.equal(evaluate(languageCommittedExpression('zh-CN')), false, 'partial storage/runtime mismatch must fail');
  assert.throws(() => navClickExpression('untrusted'), /NAV_INVALID/);
  assert.throws(() => languageChangeExpression('untrusted'), /LANGUAGE_INVALID/);
  assert.equal(languageChangeExpression('en-US').includes('setLanguage'), false);
  assert.equal(languageChangeExpression('en-US').includes('setItem'), false);
  console.log(JSON.stringify({ ok:true, actualControlEvent:'change', mockedDom:true, networkUsed:false, secretsUsed:false }));
}
main().catch((error) => { console.error(error); process.exitCode=1; });
