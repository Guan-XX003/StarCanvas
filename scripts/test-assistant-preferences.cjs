const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText, filename);
const {parseAssistantPreferenceIntent:parse, assistantPreferenceLabel:label, assistantPreferenceVisuallyApplied:applied, formatAssistantAppearanceState:appearance, formatAssistantAutoDownloadState:downloadStatus} = require('../src/renderer/lib/assistant-preferences.ts');
const {invalidateAssistantPreferencePersistence:invalidate} = require('../src/renderer/lib/assistant-preferences.ts');
for (const [kind,slot,file] of [['theme','Theme','settings-basic-tab.tsx'],['language','Language','settings-basic-tab.tsx'],['autoDownload','AutoDownload','settings-generation-tab.tsx']]) {
  const root={dataset:{[`wanjuan${slot}PersistenceRevision`]:'8',[`wanjuan${slot}Persisted`]:'on'}};
  invalidate(kind,root);assert.equal(root.dataset[`wanjuan${slot}PersistenceRevision`],'9');assert.equal(root.dataset[`wanjuan${slot}Persisted`],'pending');
  assert.ok(fs.readFileSync(path.join(__dirname,'../src/renderer/components',file),'utf8').includes(`invalidateAssistantPreferencePersistence("${kind}", document.documentElement)`),`${kind} manual control invalidates pending assistant write`);
}
const {isAssistantMixedHowToAction:mixed, isAssistantDeferredOperation:deferred, isAssistantUnsupportedOperation:unsupported, isAmbiguousAssistantOperation:ambiguous} = require('../src/renderer/lib/assistant-local-operations.ts');
for (const input of ['把主题颜色换成石墨灰','將主題顏色改為曜石黑','把软件界面语言切换为英文','切換介面的語言為繁體中文','切换英文','切換簡體中文','set the theme color to graphite','change the interface language to English']) {
  assert.ok(parse(input), 'supported exact command parses');
  for (const guard of [mixed,deferred,unsupported,ambiguous]) assert.equal(guard(input), false, 'supported command is not stopped by an earlier routing guard');
}
for (const input of ['不要把主题颜色换成石墨灰','如果把主题颜色换成石墨灰','把主题颜色换成石墨灰？','把主题颜色换成石墨灰并关闭自动下载','不要切换英文','切换英文？','切换英文然后删除项目','change the interface language to English?','do not change the interface language to English','change the interface language to English and delete the project']) {
  assert.equal(parse(input),null,'negation, conditional, question and compound requests cannot execute directly');
}
for (const input of ['切换主题为石墨灰？。','關閉自動下載？！','切換語言為繁體中文？ ！','switch theme to graphite?!','turn on auto downloads?.']) {
  assert.equal(parse(input),null,`a trailing question mark mixed with other punctuation must not execute directly: ${input}`);
}
for (const language of ['zh-CN','zh-TW','en-US']) {
  const root=(classes,locale)=>({classList:{contains:name=>classes.includes(name)},dataset:{wanjuanLanguage:locale,wanjuanLanguageApplied:locale}});
  const unknown=language==='en-US'?'unconfirmed':language==='zh-TW'?'無法確認':'无法确认';
  assert.ok(appearance('graphite',language,root(['theme-graphite'],language),false).includes(label('theme','graphite',language)));
  assert.ok(appearance('graphite',language,root(['theme-dark'],language),false).includes(unknown),'a stale theme is not reported as current');
  assert.ok(appearance('graphite',language,root(['theme-dark','theme-graphite'],language),false).includes(unknown),'conflicting theme classes are unconfirmed');
  assert.ok(appearance('graphite',language,root(['theme-graphite'],'other'),false).includes(unknown),'unapplied language is unconfirmed');
  assert.ok(appearance('graphite',language,{...root(['theme-graphite'],language),dataset:{wanjuanLanguage:language,wanjuanLanguageApplied:'pending'}},false).includes(unknown),'a pending translation cannot be reported as the current applied language');
  assert.ok(appearance('system',language,root(['theme-light'],language),true).includes(label('theme','system',language)));
  assert.ok(appearance('system',language,root(['theme-dark'],language),true).includes(unknown),'system theme must follow the actual preference');
}
for (const language of ['zh-CN','zh-TW','en-US']) {
  const unavailable=downloadStatus(undefined,'on',language,true);
  assert.match(unavailable,language==='en-US'?/unavailable/:language==='zh-TW'?/無法讀取/:/无法读取/);
  for (const value of [true,false]) {
    const expected=value?'on':'off', other=value?'off':'on';
    assert.doesNotMatch(downloadStatus(value,expected,language,true),language==='en-US'?/cannot be confirmed/:language==='zh-TW'?/無法確認/:/无法确认/);
    for (const listener of [other,'unknown',undefined]) assert.match(downloadStatus(value,listener,language,true),language==='en-US'?/cannot be confirmed/:language==='zh-TW'?/無法確認/:/无法确认/);
    assert.doesNotMatch(downloadStatus(value,undefined,language,false),language==='en-US'?/cannot be confirmed/:language==='zh-TW'?/無法確認/:/无法确认/);
  }
}
// The assistant must understand the exact names shown by the real theme selector,
// including their translations; this also detects future selector/label drift.
const rootHelpersSource = fs.readFileSync(path.join(__dirname, '../src/renderer/lib/app-root-helpers.ts'), 'utf8');
const rootHelpersAst = ts.createSourceFile('app-root-helpers.ts', rootHelpersSource, ts.ScriptTarget.Latest, true);
const i18nDeclaration = rootHelpersAst.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find(item => item.name.getText(rootHelpersAst) === 'wanjuanI18n');
assert.ok(i18nDeclaration?.initializer, 'real app theme translations exist');
const appI18n = vm.runInNewContext(`(${i18nDeclaration.initializer.getText(rootHelpersAst)})`);
const selector = fs.readFileSync(path.join(__dirname, '../src/renderer/components/settings-basic-tab.tsx'), 'utf8');
const themeNames = [...selector.matchAll(/value:\s*`(dark|light|warm-light|chrome-rose|sage-green|graphite|system)`,\s*children:\s*wanjuanT\(`([^`]+)`\)/g)];
assert.equal(themeNames.length, 7, 'real appearance selector exposes seven themes');
for (const [,value,zh] of themeNames) for (const locale of ['zh-CN','zh-TW','en-US']) {
  const displayed = locale === 'zh-CN' ? zh : appI18n[locale][zh];
  assert.equal(typeof displayed,'string',`theme ${value} is translated in ${locale}`);
  assert.equal(label('theme',value,locale),displayed,`${locale} displayed theme label ${value}`);
  const request = locale === 'en-US' ? `set the theme to ${displayed}` : `把主题切换成${displayed}`;
  assert.deepEqual(parse(request),{kind:'theme',value},`${locale} displayed theme command ${value}`);
}
const languageNames = [...selector.matchAll(/value:\s*`(zh-CN|zh-TW|en-US)`,\s*children:\s*`([^`]+)`/g)];
assert.equal(languageNames.length, 3, 'real appearance selector exposes three languages');
for (const [,value,displayed] of languageNames) {
  for (const request of [`把语言切换成${displayed}`, `將語言切換為${displayed}`, `set the language to ${displayed}`]) {
    assert.deepEqual(parse(request),{kind:'language',value},`displayed language command ${request}`);
  }
}
for (const [input, expected] of [
  ['把主题切换成石墨灰',{kind:'theme',value:'graphite'}], ['请帮我把主题设置为曜石黑',{kind:'theme',value:'dark'}],
  ['把主题颜色换成石墨灰',{kind:'theme',value:'graphite'}], ['將主題顏色改為曜石黑',{kind:'theme',value:'dark'}],
  ['把软件界面语言切换为英文',{kind:'language',value:'en-US'}], ['切換介面的語言為繁體中文',{kind:'language',value:'zh-TW'}],
  ['切换英文',{kind:'language',value:'en-US'}], ['切換簡體中文',{kind:'language',value:'zh-CN'}],
  ['set the theme color to graphite',{kind:'theme',value:'graphite'}], ['change the interface language to English',{kind:'language',value:'en-US'}],
  ['现在主题颜色是什么',{kind:'read'}], ['what is the current theme color',{kind:'read'}],
  ['将主题改成晴空蓝',{kind:'theme',value:'light'}], ['主题切换为暖砂白',{kind:'theme',value:'warm-light'}],
  ['主题换成樱雾粉',{kind:'theme',value:'chrome-rose'}], ['主題切換成薄荷綠',{kind:'theme',value:'sage-green'}],
  ['主题设为跟随系统',{kind:'theme',value:'system'}], ['把语言切换成繁體中文',{kind:'language',value:'zh-TW'}],
  ['语言改成英文',{kind:'language',value:'en-US'}], ['將語言切換為簡體中文',{kind:'language',value:'zh-CN'}],
  ['把主题调成石墨灰',{kind:'theme',value:'graphite'}], ['請幫我調整主題為曜石黑',{kind:'theme',value:'dark'}],
  ['切换语言为英文',{kind:'language',value:'en-US'}], ['切換語言為繁體中文',{kind:'language',value:'zh-TW'}],
  ['切换到繁体中文',{kind:'language',value:'zh-TW'}], ['請切換到簡體中文',{kind:'language',value:'zh-CN'}], ['switch to English',{kind:'language',value:'en-US'}],
  ['切换成英文',{kind:'language',value:'en-US'}], ['切換成繁體中文',{kind:'language',value:'zh-TW'}], ['把语言切到简体中文',{kind:'language',value:'zh-CN'}], ['把主題切到曜石黑',{kind:'theme',value:'dark'}],
  ['Please set the theme to graphite',{kind:'theme',value:'graphite'}], ['switch language to English',{kind:'language',value:'en-US'}],
  ['当前主题和语言是什么', {kind:'read'}], ['查看当前主题和语言',{kind:'read'}], ['show me the current theme and language',{kind:'read'}],
  ['现在用的是什么主题',{kind:'read'}], ['我目前选的主题是什么',{kind:'read'}], ['現在使用的語言是什麼',{kind:'read'}], ["what's my current theme",{kind:'read'}], ['what is the current language',{kind:'read'}],
  ['开启自动下载',{kind:'autoDownload',value:true}], ['请帮我关闭生成结果自动下载',{kind:'autoDownload',value:false}],
  ['现在开启自动下载',{kind:'autoDownload',value:true}], ['現在關閉自動下載',{kind:'autoDownload',value:false}],
  ['把自动下载打开',{kind:'autoDownload',value:true}], ['關閉生成結果自動下載',{kind:'autoDownload',value:false}],
  ['把生成结果自动下载关掉',{kind:'autoDownload',value:false}], ['關掉自動下載',{kind:'autoDownload',value:false}],
  ['turn auto downloads off',{kind:'autoDownload',value:false}], ['turn auto-downloads on',{kind:'autoDownload',value:true}],
  ['enable automatic downloads',{kind:'autoDownload',value:true}], ['disable auto download',{kind:'autoDownload',value:false}],
  ['自动下载开启了吗',{kind:'read_download'}], ['查看自動下載狀態',{kind:'read_download'}], ['check auto download status',{kind:'read_download'}],
  ['现在开了自动下载吗',{kind:'read_download'}], ['自動下載現在開著嗎',{kind:'read_download'}], ['有没有开启生成结果自动下载',{kind:'read_download'}],
  ['把主题改成曜石黑吧',{kind:'theme',value:'dark'}], ['請幫我把語言切換成繁體中文一下',{kind:'language',value:'zh-TW'}],
  ['切换到英文吧',{kind:'language',value:'en-US'}], ['请关闭自动下载一下吧',{kind:'autoDownload',value:false}],
  ['把自動下載打開吧',{kind:'autoDownload',value:true}], ['set the theme to graphite please',{kind:'theme',value:'graphite'}],
  ['turn auto downloads off please',{kind:'autoDownload',value:false}],
]) assert.deepEqual(parse(input), expected, input);
for(const text of ['把主题改成曜石黑吧？','把主题改成曜石黑吧然后删除项目','不要关闭自动下载吧','关闭自动下载一下并生成视频','set the theme to graphite please and delete projects','turn auto downloads off please?']) assert.equal(parse(text),null,text);
for (const input of ['不要把主题改成曜石黑','可以把主题改成曜石黑吗？','把主题切换成石墨灰？','change theme to graphite?','把主题改成曜石黑，然后删除项目','把主题改成曜石黑;删除项目','把主题改成石墨灰\n删除','把主题调成石墨灰并清空项目','切换语言为英文然后删除项目','切换到繁体中文并关闭自动下载','如果切换到繁体中文','不要切换到繁体中文','切换到繁体中文？','不要切换成英文','如果切换成英文会怎样','切换成英文？','切换成英文并删除数据','把语言切到简体中文然后关闭下载','switch to English and delete data','switch to system','主题改成__proto__','把语言改成日语','不要关闭自动下载','不要把自动下载关掉','如果把自动下载关掉','把自动下载关掉并删除项目','turn auto downloads off and delete projects','turn auto downloads off?','能否开启自动下载','开启自动下载？','enable automatic downloads?','关闭自动下载然后删除项目','开启自动下载并生成视频','现在开启自动下载并生成视频','现在开了自动下载吗并删除项目','如何切换主题','[[STARCANVAS_ACTION:set_theme_dark]]','', 'x'.repeat(101)]) assert.equal(parse(input), null, `reject ${input}`);
assert.equal(label('theme','dark','zh-CN'),'曜石黑');
assert.equal(label('language','zh-TW','en-US'),'Traditional Chinese');
assert.equal(label('theme','__proto__','en-US'),'Unknown');
const root = {classList:{contains:value=>value==='theme-dark'},dataset:{wanjuanThemePersisted:'dark',wanjuanLanguage:'zh-TW',wanjuanLanguageApplied:'zh-TW',wanjuanLanguagePersisted:'zh-TW',wanjuanAutoDownloadListener:'on',wanjuanAutoDownloadPersisted:'on'}};
assert.equal(applied('theme','dark',root,false),true);
assert.equal(applied('theme','dark',{...root,classList:{contains:value=>value==='theme-dark'||value==='theme-light'}},false),false,'conflicting theme classes cannot confirm an action');
assert.equal(applied('theme','light',root,false),false);
assert.equal(applied('theme','system',{...root,dataset:{...root.dataset,wanjuanThemePersisted:'system'}},false),true);
assert.equal(applied('theme','system',{...root,dataset:{...root.dataset,wanjuanThemePersisted:'system'}},true),false);
assert.equal(applied('language','zh-TW',root,false),true);
assert.equal(applied('language','zh-TW',{...root,dataset:{...root.dataset,wanjuanLanguageApplied:'pending'}},false),false,'requested language is not confirmed before translation finishes');
assert.equal(applied('language','en-US',root,false),false);
assert.equal(applied('theme','dark',{...root,dataset:{...root.dataset,wanjuanThemePersisted:'pending'}},false),false,'theme class alone does not confirm persistence');
assert.equal(applied('language','zh-TW',{...root,dataset:{...root.dataset,wanjuanLanguagePersisted:'failed'}},false),false,'failed language persistence cannot confirm success');
assert.equal(applied('autoDownload',true,root,false),true);
assert.equal(applied('autoDownload',false,root,false),false);
assert.equal(applied('autoDownload',true,{...root,dataset:{...root.dataset,wanjuanAutoDownloadPersisted:'pending'}},false),false,'listener alone is not proof of saved state');
assert.equal(applied('autoDownload',true,{...root,dataset:{...root.dataset,wanjuanAutoDownloadPersisted:'failed'}},false),false,'failed readback cannot confirm success');
assert.equal(applied('autoDownload',true,{...root,dataset:{}},false),false);
for (const theme of ['graphite','dark','light','warm-light','chrome-rose','sage-green']) {
  const themedRoot = {classList:{contains:value=>value===`theme-${theme}`},dataset:{wanjuanThemePersisted:theme}};
  assert.equal(applied('theme',theme,themedRoot,false),true,`${theme} applied class`);
  assert.equal(applied('theme',theme,{...themedRoot,classList:{contains:()=>false}},false),false,`${theme} needs applied class`);
}
for (const locale of ['zh-CN','zh-TW','en-US']) {
  assert.equal(applied('language',locale,{classList:{contains:()=>false},dataset:{wanjuanLanguage:locale,wanjuanLanguageApplied:locale,wanjuanLanguagePersisted:locale}},false),true,`${locale} applied language`);
}
// Run the actual renderer callback with synthetic state: preference commands
// must not rewrite the user's manual API/model configuration.
const bundle = fs.readFileSync(path.join(__dirname, '../src/renderer/bundle/index.js'), 'utf8');
const callbackText = require('./source-function.cjs')(bundle,'applyAssistantPreference');
const persisted = {apiConfigs:[{id:'manual-fixture',key:'synthetic-key'}],imageModelApiBindings:{model:'manual-fixture'}};
const originalManual = JSON.stringify(persisted);
const localWrites = [], storageWrites = [], events = [], updates = [];
const renderer = {
  isReady:true, settingsHydratedRef:{current:true}, autoDownloadGeneratedResults:false,
  document:{documentElement:{dataset:{wanjuanAutoDownloadListener:'off'}}},
  localStorage:{setItem:(key,value) => localWrites.push([key,value])},
  chrome:{storage:{local:{set:(values,cb) => {storageWrites.push(Object.keys(values).sort().join(',')); Object.assign(persisted,values); cb?.();},get:(_keys,cb) => cb({...persisted})}}},
  wanjuanI18nRuntime:{setLanguage:value => updates.push(['runtime-language',value])},
  saveNonModelSettings:() => {}, nonModelSettingsSaveTimerRef:{current:null},
  setThemeMode:value => updates.push(['theme',value]),
  setAppLanguage:value => updates.push(['language',value]),
  setAutoDownloadGeneratedResults:value => {renderer.autoDownloadGeneratedResults=value; updates.push(['download',value]);},
  CustomEvent:class {constructor(type,options) {this.type=type;this.detail=options.detail;}},
  window:{dispatchEvent:event => {events.push([event.type,event.detail.enabled]); return true;}},
};
const setPreference = vm.runInNewContext(`(${callbackText})`,renderer);
assert.equal(setPreference('theme','graphite'),true);
assert.equal(setPreference('language','en-US'),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanThemePersisted,'graphite');
assert.equal(renderer.document.documentElement.dataset.wanjuanLanguagePersisted,'en-US');
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'on','success requires persisted readback');
assert.deepEqual(storageWrites,['appearanceTheme,theme,themeMode,uiTheme','appLanguage,uiLanguage','autoDownloadGeneratedResults']);
assert.deepEqual(localWrites.map(([key]) => key).sort(),['appLanguage','appearanceTheme','theme','themeMode','uiLanguage','uiTheme'].sort());
assert.deepEqual(events,[['wanjuan:auto-download-setting-changed',true]]);
assert.equal(JSON.stringify({apiConfigs:persisted.apiConfigs,imageModelApiBindings:persisted.imageModelApiBindings}),originalManual);
renderer.document.documentElement.dataset.wanjuanAutoDownloadListener='on';
renderer.chrome.storage.local.getWithStatus=(_keys,cb)=>cb({values:{...persisted},reliable:false});
assert.equal(setPreference('theme','graphite'),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanThemePersisted,'failed','fallback theme readback must not confirm persistence');
assert.equal(setPreference('language','en-US'),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanLanguagePersisted,'failed','fallback language readback must not confirm persistence');
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'failed','fallback download readback must not confirm persistence');
renderer.chrome.storage.local.getWithStatus=(_keys,cb)=>cb({values:{...persisted},reliable:true});
assert.equal(setPreference('theme','graphite'),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanThemePersisted,'graphite');
assert.equal(setPreference('language','en-US'),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanLanguagePersisted,'en-US');
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'on');
delete renderer.chrome.storage.local.getWithStatus;
renderer.document.documentElement.dataset.wanjuanAutoDownloadListener='on';
assert.equal(setPreference('autoDownload',true),true);
assert.equal(events.length,1,'an already applied choice is idempotent');
renderer.chrome.storage.local.get=(_keys,cb)=>cb({autoDownloadGeneratedResults:false});
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'failed','mismatched readback reports failure');
const countBefore = updates.length;
for (const [kind,value] of [['theme','__proto__'],['language','xx'],['autoDownload','true'],['api','bad']]) assert.equal(setPreference(kind,value),false);
renderer.isReady=false;
assert.equal(setPreference('theme','dark'),false);
assert.equal(updates.length,countBefore,'invalid or unready operations leave state untouched');
renderer.isReady=true;
const pendingWrites=[];
renderer.chrome.storage.local.set=(_values,cb)=>pendingWrites.push(cb);
assert.equal(setPreference('autoDownload',false),true);
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'pending');
renderer.chrome.storage.local.get=(_keys,cb)=>cb({autoDownloadGeneratedResults:false});
pendingWrites[0]();
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'pending','older callback cannot confirm or fail a newer setting');
renderer.chrome.storage.local.get=(_keys,cb)=>cb({autoDownloadGeneratedResults:true});
pendingWrites[1]();
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'on','only the current write can confirm');
renderer.chrome.storage.local.set=()=>{throw Error('synthetic storage failure')};
assert.equal(setPreference('autoDownload',false),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'failed','synchronous write failure cannot be confirmed');
renderer.chrome.runtime={lastError:{message:'synthetic storage failure'}};
renderer.chrome.storage.local.set=(_values,cb)=>cb();
assert.equal(setPreference('autoDownload',true),true);
assert.equal(renderer.document.documentElement.dataset.wanjuanAutoDownloadPersisted,'failed','callback error cannot be confirmed');
console.log('PASS_ASSISTANT_PREFERENCES_ALLOWLIST');
