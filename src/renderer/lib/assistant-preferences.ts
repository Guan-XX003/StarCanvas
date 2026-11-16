/** Local, deliberately narrow commands. Never interpret model output as a command. */
export const assistantThemes = {
  graphite: ["石墨灰", "graphite"], dark: ["曜石黑", "obsidian"], light: ["晴空蓝", "晴空藍", "sky blue"],
  "warm-light": ["暖砂白", "warm sand"], "chrome-rose": ["樱雾粉", "櫻霧粉", "rose", "rose mist"],
  "sage-green": ["薄荷绿", "薄荷綠", "mint"], system: ["跟随系统", "跟隨系統", "system", "follow system"],
} as const;
export const assistantLanguages = {"zh-CN":["简体中文", "簡體中文", "简体", "簡體", "simplified chinese"], "zh-TW":["繁體中文", "繁体中文", "繁體", "繁体", "traditional chinese"], "en-US":["英语", "英語", "英文", "english"]} as const;
export type AssistantTheme = keyof typeof assistantThemes;
export type AssistantLanguage = keyof typeof assistantLanguages;
export type AssistantPreferenceIntent = {kind:"theme"; value:AssistantTheme} | {kind:"language"; value:AssistantLanguage} | {kind:"autoDownload"; value:boolean} | {kind:"read"} | {kind:"read_download"};

/** A manual selection supersedes any pending assistant persistence receipt. */
export function invalidateAssistantPreferencePersistence(kind:"theme"|"language"|"autoDownload", root:Pick<HTMLElement,"dataset">|null|undefined) {
  if (!root) return;
  const slot = kind === "theme" ? "Theme" : kind === "language" ? "Language" : "AutoDownload";
  const revision = `wanjuan${slot}PersistenceRevision`, persisted = `wanjuan${slot}Persisted`;
  root.dataset[revision] = String((Number(root.dataset[revision]) || 0) + 1);
  root.dataset[persisted] = "pending";
}

/** The saved switch and the desktop listener are distinct observations. */
export function formatAssistantAutoDownloadState(value:unknown, listener:unknown, language:string, checkListener:boolean) {
  if (typeof value !== "boolean") return language === "en-US" ? "The auto-download setting is unavailable." : language === "zh-TW" ? "無法讀取自動下載設定。" : "无法读取自动下载设置。";
  if (checkListener && listener !== (value ? "on" : "off")) {
    return language === "en-US" ? `Automatic downloads are set to ${value ? "on" : "off"}, but the listener state cannot be confirmed. Check settings and try again.` : language === "zh-TW" ? `生成結果自動下載設定目前${value ? "已開啟" : "已關閉"}，但無法確認監聽狀態；請檢查設定後重試。` : `生成结果自动下载设置目前${value ? "已开启" : "已关闭"}，但无法确认监听状态；请检查设置后重试。`;
  }
  return language === "en-US" ? `Automatic download of generated results is ${value ? "on" : "off"}.` : language === "zh-TW" ? `生成結果自動下載目前${value ? "已開啟" : "已關閉"}。` : `生成结果自动下载目前${value ? "已开启" : "已关闭"}。`;
}

const interfaceThemeClasses=["dark","light","warm-light","mist-blue","chrome-blue","chrome-rose","chrome-sand","chrome-teal","sage-green","graphite"];
function isThemeActuallyApplied(theme:unknown, root:Pick<HTMLElement,"classList">, prefersLight:boolean) {
  try {
    const resolved=theme === "system" ? (prefersLight ? "light" : "dark") : theme;
    const classes=interfaceThemeClasses.filter(name=>root.classList.contains(`theme-${name}`));
    return typeof theme === "string" && Object.hasOwn(assistantThemes,theme) && classes.length === 1 && classes[0] === resolved;
  } catch { return false; }
}

/** State alone is not evidence that a visual theme or language has applied. */
export function assistantPreferenceVisuallyApplied(kind:"theme"|"language"|"autoDownload", value:string|boolean, root:HTMLElement, prefersLight:boolean) {
  if (kind === "theme") {
    return isThemeActuallyApplied(value, root, prefersLight) && root.dataset.wanjuanThemePersisted === value;
  }
  if (kind === "language") return root.dataset.wanjuanLanguage === value && root.dataset.wanjuanLanguageApplied === value && root.dataset.wanjuanLanguagePersisted === value;
  const expected = value === true ? "on" : "off";
  return typeof value === "boolean" && root.dataset.wanjuanAutoDownloadListener === expected && root.dataset.wanjuanAutoDownloadPersisted === expected;
}

/** Report only values that agree with the live renderer markers, not merely
 * requested settings. Persistence is not needed to describe current UI. */
export function formatAssistantAppearanceState(theme:unknown, language:string, root:Pick<HTMLElement,"classList"|"dataset">, prefersLight:boolean) {
  const themeApplied=isThemeActuallyApplied(theme,root,prefersLight);
  const languageApplied=Object.hasOwn(assistantLanguages,language) && root?.dataset?.wanjuanLanguage === language && root?.dataset?.wanjuanLanguageApplied === language;
  const unknown=language === "en-US" ? "unconfirmed" : language === "zh-TW" ? "無法確認" : "无法确认";
  const shownTheme=themeApplied ? assistantPreferenceLabel("theme",String(theme),language) : unknown;
  const shownLanguage=languageApplied ? assistantPreferenceLabel("language",language,language) : unknown;
  return language === "en-US" ? `Current theme: ${shownTheme}. Current language: ${shownLanguage}.` : language === "zh-TW" ? `目前主題：${shownTheme}；語言：${shownLanguage}。` : `当前主题：${shownTheme}；语言：${shownLanguage}。`;
}

export function parseAssistantPreferenceIntent(input: string): AssistantPreferenceIntent | null {
  if (typeof input !== "string" || input.length > 100 || /[\r\n;；]/.test(input)) return null;
  // A question mark remains a question even when followed by other terminal
  // punctuation (e.g. “？！”). Never strip it into an executable command.
  const isQuestion = /[?？][。.!！?？\s]*$/.test(input);
  const text = input.trim().toLowerCase().replace(/[。.!！?？]+$/, "").trim();
  const compact = text.replace(/\s+/g, "");
  // Polite imperative suffixes do not add a second operation. They are used
  // only for exact command matching below, never to strip a question or an
  // arbitrary trailing clause into an executable command.
  const commandText = text.replace(/\s+please$/, "").trim();
  const commandCompact = compact.replace(/(?:一下吧|一下|吧)$/, "");
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查询|查詢)?(?:当前|目前|現在|现在)?(?:的)?(?:生成结果|生成結果)?自[动動]下[载載](?:生成结果|生成結果)?(?:是否开启|是否開啟|开启了吗|開啟了嗎|状态|狀態|是什么状态|是什麼狀態)?$/.test(compact) || /^(?:is |show |check )?(?:automatic|auto) downloads?(?: enabled| on| status)?$/.test(text)) return {kind:"read_download"};
  if (/^(?:(?:现在|現在|目前|当前|當前)(?:是否|有没有|有沒有|有|已經|已经)?(?:开启|開啟|打开|打開|启用|啟用|开了|開了)|(?:是否|有没有|有沒有|有|已經|已经)(?:开启|開啟|打开|打開|启用|啟用|开了|開了))?(?:生成结果|生成結果)?自[动動]下[载載](?:现在|現在|目前)?(?:开着|開著|开启|開啟|打开|打開|开了|開了|启用|啟用|关闭|關閉|关了|關了)?(?:没有|沒有|吗|嗎|了嗎|了吗|还是没开|還是沒開|没|沒)?$/.test(compact) && /(?:是否|有没有|有沒有|吗|嗎|没有|沒有|没|沒|开着|開著)/.test(compact)) return {kind:"read_download"};
  const directDownload = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:现在|現在)?(开启|開啟|打开|打開|启用|啟用|关闭|關閉|关掉|關掉|停用|禁用)(?:生成结果|生成結果)?自[动動]下[载載](?:生成结果|生成結果)?$/.exec(commandCompact);
  const reverseDownload = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:把|将|將)(?:生成结果|生成結果)?自[动動]下[载載](?:生成结果|生成結果)?(开启|開啟|打开|打開|启用|啟用|关闭|關閉|关掉|關掉|停用|禁用)$/.exec(commandCompact);
  const englishDownload = /^(?:please )?(turn on|enable|turn off|disable) (?:automatic|auto)[ -]?downloads?(?: of generated results)?$/.exec(commandText);
  const englishPost = /^(?:please )?turn (?:automatic|auto)[ -]?downloads? (on|off)$/.exec(commandText);
  const downloadCommand = directDownload || reverseDownload || englishDownload || englishPost;
  if (downloadCommand) return isQuestion ? null : {kind:"autoDownload",value:/^(?:开启|開啟|打开|打開|启用|啟用|turn on|enable|on)$/.test(downloadCommand[1])};
  if (/^(?:请|請|麻烦|麻煩)?(?:告诉我|告訴我|查看|查询|查詢)?(?:当前|目前|現在|现在)(?:的)?(?:主题和语言|主題和語言|主题与语言|主題與語言|主题|主題|语言|語言|设置|設定)(?:是什么|是什麼|是哪个|是哪個)?$/.test(text.replace(/\s+/g, "")) || /^(?:what are|show me) (?:my |the )?(?:current )?(?:theme and language|appearance settings)$/.test(text)) return {kind:"read"};
  if (/^(?:请|請|麻烦|麻煩)?(?:告诉我|告訴我|查看|查询|查詢)?(?:我|软件|軟體|应用|應用程式)?(?:现在|現在|目前|当前|當前)?(?:用的|使用的|选的|選的|使用|用|的)?(?:是什么|是什麼|是哪个|是哪個|哪种|哪種)?(?:主题颜色|主題顏色|主题色|主題色|主题|主題|语言|語言)(?:是什么|是什麼|是哪个|是哪個|哪种|哪種|叫什么|叫什麼|吗|嗎)?$/.test(compact) && /(?:现在|現在|目前|当前|當前|什么|什麼|哪个|哪個|哪种|哪種|查询|查詢|查看|告诉我|告訴我)/.test(compact) || /^(?:what(?: is|'s)|which) (?:my |the )?(?:current )?(?:theme(?: colou?r)?|(?:interface )?language)(?: (?:is active|am i using))?$/.test(text)) return {kind:"read"};
  const chinese = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:把|将|將)?(?:软件|軟體|应用|應用程式)?(?:的)?(?:界面|介面)?(?:的)?(主题颜色|主題顏色|主题色|主題色|主题|主題|语言|語言)(?:切换|切換|切|更改|修改|调整|調整|调|調|改|设置|設定|设|設|换|換)(?:为|為|成|到)?(.+?)(?:主题|主題|语言|語言)?$/.exec(commandCompact);
  const chineseVerbFirst = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:切换|切換|更改|修改|调整|調整|设置|設定)(?:软件|軟體|应用|應用程式)?(?:的)?(?:界面|介面)?(?:的)?(主题颜色|主題顏色|主题色|主題色|主题|主題|语言|語言)(?:为|為|成|到)(.+?)(?:主题|主題|语言|語言)?$/.exec(commandCompact);
  const english = /^(?:please )?(?:set|switch|change) (?:the )?(theme(?: colou?r)?|(?:interface )?language) (?:to|as) (.+)$/.exec(commandText);
  const match = chinese || chineseVerbFirst || english;
  if (isQuestion) return null;
  if (!match) {
    // A named language is an unambiguous single target even without the word
    // "language". Require an exact alias; extra clauses cannot be discarded.
    const languageOnly = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:切换到|切換到|切换成|切換成|切换|切換|换成|換成|改成)(.+)$/.exec(commandCompact)
      || /^(?:please )?switch to (.+)$/.exec(commandText);
    if (!languageOnly) return null;
    for (const [value,names] of Object.entries(assistantLanguages)) {
      if ((names as readonly string[]).some(name => name.toLowerCase() === languageOnly[1].trim())) return {kind:"language",value:value as AssistantLanguage};
    }
    return null;
  }
  const type = /主题|主題|theme/.test(match[1]) ? "theme" : "language";
  const aliases = type === "theme" ? assistantThemes : assistantLanguages;
  for (const [value, names] of Object.entries(aliases)) {
    if ((names as readonly string[]).some(name => name.toLowerCase() === match[2].trim())) {
      return type === "theme" ? {kind:"theme",value:value as AssistantTheme} : {kind:"language",value:value as AssistantLanguage};
    }
  }
  return null;
}

export function assistantPreferenceLabel(kind: "theme"|"language", value: string, language: string): string {
  const themes: Record<string, [string,string,string]> = {graphite:["石墨灰","石墨灰","Graphite"],dark:["曜石黑","曜石黑","Obsidian"],light:["晴空蓝","晴空藍","Sky Blue"],"warm-light":["暖砂白","暖砂白","Warm Sand"],"chrome-rose":["樱雾粉","櫻霧粉","Rose Mist"],"sage-green":["薄荷绿","薄荷綠","Mint"],system:["跟随系统","跟隨系統","Follow System"]};
  const languages: Record<string, [string,string,string]> = {"zh-CN":["简体中文","簡體中文","Simplified Chinese"],"zh-TW":["繁体中文","繁體中文","Traditional Chinese"],"en-US":["英语","英語","English"]};
  const labels = kind === "theme" ? themes : languages;
  const entry = Object.hasOwn(labels, value) ? labels[value] : undefined;
  return entry ? entry[language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0] : (language === "en-US" ? "Unknown" : language === "zh-TW" ? "未知" : "未知");
}
