const assert = require("node:assert/strict");

const LANGUAGES = new Set(["zh-CN", "zh-TW", "en-US"]);
const navClickExpression = (source) => {
  if (!["外观与通用", "我的账号"].includes(source)) throw new Error("LANGUAGE_NAV_INVALID");
  return `(() => {
    const labels = new Set([${JSON.stringify(source)}, ...['zh-CN','zh-TW','en-US'].map((language) => globalThis.wanjuanI18nRuntime?.t?.(${JSON.stringify(source)}, language)).filter(Boolean)]);
    const button = [...document.querySelectorAll('.wanjuan-settings-sidebar button')].find((item) => labels.has((item.textContent || '').trim()));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`;
};
const LANGUAGE_SELECT_EXPRESSION = `(() => {
  return [...document.querySelectorAll('.wanjuan-settings-content select')].some((item) =>
    ['zh-CN','zh-TW','en-US'].every((value) => [...item.options].some((option) => option.value === value)));
})()`;
const languageChangeExpression = (language) => {
  if (!LANGUAGES.has(language)) throw new Error("LANGUAGE_INVALID");
  return `(() => {
    const select = [...document.querySelectorAll('.wanjuan-settings-content select')].find((item) =>
      ['zh-CN','zh-TW','en-US'].every((value) => [...item.options].some((option) => option.value === value)));
    if (!select || select.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(select, ${JSON.stringify(language)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
};
const languageCommittedExpression = (language) => {
  if (!LANGUAGES.has(language)) throw new Error("LANGUAGE_INVALID");
  return `(() => {
    const select = [...document.querySelectorAll('.wanjuan-settings-content select')].find((item) =>
      ['zh-CN','zh-TW','en-US'].every((value) => [...item.options].some((option) => option.value === value)));
    return select?.value === ${JSON.stringify(language)}
      && globalThis.wanjuanI18nRuntime?.getLanguage?.() === ${JSON.stringify(language)}
      && localStorage.getItem('appLanguage') === ${JSON.stringify(language)}
      && localStorage.getItem('uiLanguage') === ${JSON.stringify(language)};
  })()`;
};

// Exercise the same React onChange/persistence path as a user's selection;
// never assign runtime language or storage directly to make the test pass.
async function switchAccountFusionLanguage(ui, language) {
  if (!LANGUAGES.has(language)) throw new Error("LANGUAGE_INVALID");
  assert.equal(await ui.evaluate(navClickExpression("外观与通用")), true, "appearance navigation unavailable");
  await ui.waitFor(LANGUAGE_SELECT_EXPRESSION, "语言选择控件");
  assert.equal(await ui.evaluate(languageChangeExpression(language)), true, "language select unavailable");
  await ui.waitFor(languageCommittedExpression(language), "语言设置同步");
  assert.equal(await ui.evaluate(navClickExpression("我的账号")), true, "account navigation unavailable");
  await ui.waitFor("Boolean(document.querySelector('.wanjuan-account-settings-page'))", "返回账号界面");
}

module.exports = { navClickExpression, LANGUAGE_SELECT_EXPRESSION, languageChangeExpression, languageCommittedExpression, switchAccountFusionLanguage };
