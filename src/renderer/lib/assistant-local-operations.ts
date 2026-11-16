import { assistantThemes, assistantLanguages } from "./assistant-preferences";
import {applicationTaskSummaryStatus,selectLatestApplicationTask} from '../../../electron/shared/application-task-data.mjs';

/** Local commands are accepted only for a single explicit, allowlisted intent. */
export type AssistantDestination = "canvas"|"resources"|"agents"|"workspace"|"settings"|"account"|"appearance"|"api"|"models"|"generation";
/** Missing individual settings are valid defaults only after a reliable read. */
export function assistantSettingsHydrationAvailable(result:unknown, error:unknown, reliable?:boolean) {
  return !error && reliable !== false && !!result && typeof result === "object" && !Array.isArray(result);
}
/** A missing key after a successful read is empty; a failed or malformed read is not. */
export function assistantTaskHydrationAvailable(result:unknown, error:unknown, reliable?:boolean) {
  if (error || reliable === false || !result || typeof result !== "object" || Array.isArray(result)) return false;
  const tasks = (result as {globalTasks?:unknown}).globalTasks;
  // The task-list compactor silently drops malformed or unidentifiable records.
  // Checking before compaction avoids reporting an incomplete list as empty.
  return tasks === undefined || (Array.isArray(tasks) && tasks.every(item =>
    item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && item.id.trim().length > 0));
}
/** Layout alone cannot confirm a page whose content or ancestor is hidden. */
export function assistantNavigationElementVisible(element:HTMLElement|null|undefined) {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const view = element.ownerDocument?.defaultView;
  if (!view || view.innerWidth <= 0 || view.innerHeight <= 0) return false;
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
  const clips = (value:string) => ["hidden", "clip", "scroll", "auto"].includes(value);
  for (let current:HTMLElement|null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || style.contentVisibility === "hidden") return false;
    // A parent can be visible while its overflow clips the target completely.
    // Intersect each clipped axis separately; do not treat a partial intersection
    // as invisible, and do not use the target's own overflow to clip its box.
    if (current !== element && (clips(style.overflowX) || clips(style.overflowY))) {
      const bounds = current.getBoundingClientRect();
      if (clips(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (clips(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
  }
  if (right <= left || bottom <= top) return false;
  const document = element.ownerDocument;
  if (typeof document?.elementFromPoint !== "function") return false;
  // Layout can be present yet completely covered by a modal or another view.
  // Sample a small grid inside the clipped intersection: one hit on the page
  // or its descendants is enough; no hits means the result is unconfirmed.
  // This is conservative and cannot detect overlays with pointer-events:none.
  for (const y of [0.15,0.5,0.85]) for (const x of [0.15,0.5,0.85]) {
    const hit = document.elementFromPoint(left + (right-left)*x, top + (bottom-top)*y);
    if (hit && (hit === element || element.contains(hit))) return true;
  }
  return false;
}
const destinations: Record<AssistantDestination, readonly string[]> = {
  canvas:["画布","畫布","canvas"], resources:["资源","資源","资源中转站","資源中轉站","assets","resources"],
  agents:["智能体","智能體","智慧體","agents"], workspace:["工作空间","工作空間","workspace"], settings:["设置","設定","settings"],
  account:["账号设置","帳號設定","账户设置","帳戶設定","我的账号","我的帳號","我的账户","我的帳戶","account settings","my account"],
  appearance:["外观设置","外觀設定","外观与通用","外觀與通用","appearance settings","appearance & general"],
  api:["api配置","api设置","api設定","api config","api settings"],
  models:["模型配置","模型设置","模型設定","model settings","model config"],
  generation:["生成与下载","生成與下載","生成设置","生成設定","generation settings","generation and downloads","generation & downloads"],
};
/** Main views can open independently of settings, but settings pages require a reliable read. */
export function assistantNavigationAvailable(destination:unknown, appReady:boolean, settingsReady:boolean) {
  if (!appReady || typeof destination !== "string" || !Object.hasOwn(destinations, destination)) return false;
  return settingsReady || ["canvas", "resources", "agents", "workspace"].includes(destination);
}
// The app does not schedule actions; a future request must not become an
// immediately executable suggestion or a claim about current state.
const deferredRequestPattern = /(?:一会儿|一會兒|过会|過會|过一会|過一會|等下|等我|稍后|稍後|待会|待會|等会|等會|明天|后天|後天|下次|下週|下周|明年|下个月|下個月|下星期|下个星期|下個星期|将来|將來|未来|未來|以后|以後)|\b(?:later|tomorrow|next time|next week|next month|next year|in\s+\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?))\b/i;
/** Respect the same enterprise-managed restrictions as the settings sidebar. */
export function assistantNavigationAllowed(destination:unknown, enterprise:unknown) {
  if (typeof destination !== "string" || !Object.hasOwn(destinations, destination)) return false;
  const e = enterprise && typeof enterprise === "object" ? enterprise as {connected?:unknown; mode?:unknown} : null;
  return !(["api","models"].includes(destination) && e?.connected === true && e.mode !== "host");
}
/** A current setting is observable; its past value and cause are not. */
export function classifyAssistantSettingChangeQuestion(input:unknown): "preferences"|"download"|null {
  if (typeof input !== "string" || input.length > 120 || /[\r\n;；,，、]/.test(input)) return null;
  const text = input.trim().toLowerCase().replace(/[?？.!！。]+$/, "").trim();
  const zh = text.replace(/\s+/g, "");
  const subject = "(?:我的|目前的|当前的|當前的|现在的|現在的)?(主题|主題|语言|語言|(?:生成结果|生成結果)?自动下载|(?:生成结果|生成結果)?自動下載)";
  const why = "(?:为什么|為什麼|为何|為何|怎么|怎麼|怎么会|怎麼會)";
  const changed = "(?:突然)?(?:变了|變了|改变了|改變了|不一样了|不一樣了|打开了|打開了|关闭了|關閉了|开启了|開啟了)";
  const m = new RegExp(`^(?:${why}${subject}${changed}|${subject}${why}${changed})$`).exec(zh);
  if (m) return /下载|下載/.test(m[1] || m[2]) ? "download" : "preferences";
  const en = /^(?:why (?:did|has) (?:my|the) (theme|language|(?:automatic|auto)[ -]?downloads?) (?:change|changed)|why is (?:my|the) (theme|language|(?:automatic|auto)[ -]?downloads?) (?:different|changed))$/i.exec(text);
  return en ? (/download/i.test(en[1] || en[2]) ? "download" : "preferences") : null;
}
export function parseAssistantLocalNavigation(input:unknown): AssistantDestination|null {
  if (typeof input !== "string" || input.length > 100 || /[\r\n;；?？]/.test(input)) return null;
  const text = input.trim().toLowerCase().replace(/[。.!！]+$/, "").trim();
  const zh = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:打开|打開|进入|進入|前往|切换到|切換到|回到|去)(.+)$/.exec(text.replace(/\s+/g,""));
  const en = /^(?:please )?(?:open|go to|go back to|switch to) (?:the )?(.+?)(?: page)?$/.exec(text);
  const target = zh ? zh[1].replace(/(?:一下吧|一下|吧)$/, "") : en?.[1].replace(/\s+please$/, "").trim();
  if (!target) return null;
  for (const [destination, aliases] of Object.entries(destinations)) if (aliases.includes(target)) return destination as AssistantDestination;
  return null;
}

/** Recognizable requests outside the local operation allowlist must never be
 * delegated as if the model could perform them. How-to questions remain chat. */
export function isAssistantUnsupportedOperation(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000) return false;
  const text = input.trim();
  if (!text || /(?:如何|怎么|怎麼|怎样|怎樣|什么是|什麼是|为什么|為什麼|为何|為何|怎么办|怎麼辦)|\b(?:how\s+(?:to|do|can)|why|what\s+is)\b/i.test(text)) return false;
  if (/(?:不要|不用|不必|不想|不需要|无需|無需|别|別|禁止|如果|假如|假设|假設)|\b(?:never|do not|don't|if|unless)\b/i.test(text)) return false;
  const target = /(?:项目|專案|项目|项目数据|資料|数据|數據|文件|檔案|历史记录|歷史紀錄|记录|紀錄|缓存|快取|回收站|全部|所有|密钥|金鑰|密码|密碼|凭证|憑證|账户|帳戶|账号|帳號|模型配置|模型設定|api配置|api設定|api设置)|\b(?:projects?|files?|data|history|cache|everything|keys?|passwords?|credentials?|accounts?|model settings|api settings)\b/i;
  const destructive = /(?:删除|刪除|清空|清除|卸载|解除安裝|格式化|覆盖|覆蓋|重置|修改|更改|更换|更換|导出|導出|复制|複製|显示|顯示|查看|发送|傳送)|\b(?:delete|erase|clear|remove|uninstall|format|overwrite|reset|change|modify|export|copy|reveal|show|send)\b/i;
  // Only credential-related reads are excluded; ordinary account pages remain
  // navigable and normal project/status questions stay read-only.
  const sensitiveRead = /(?:密钥|金鑰|密码|密碼|凭证|憑證)|\b(?:keys?|passwords?|credentials?)\b/i.test(text);
  const mutation = /(?:删除|刪除|清空|清除|卸载|解除安裝|格式化|覆盖|覆蓋|重置|修改|更改|更换|更換|导出|導出)|\b(?:delete|erase|clear|remove|uninstall|format|overwrite|reset|change|modify|export)\b/i.test(text);
  if (target.test(text) && destructive.test(text) && (mutation || sensitiveRead)) return true;
  if (/(?:充值|購買|购买|付款|支付)|\b(?:recharge|top\s*up|purchase|buy|pay)\b/i.test(text) && /(?:余额|餘額|额度|額度|会员|會員|充值|购买|購買|支付)|\b(?:balance|credits?|membership|recharge|purchase|buy|pay)\b/i.test(text)) return true;
  const retry = /(?:重新生成|重试|重試)|\b(?:retry|regenerate)\b/i;
  const directGeneration = /^(?:(?:请|請|麻烦|麻煩)?(?:能否|可以|能不能|能)?(?:帮我|幫我)?(?:现在|現在|马上|馬上)?(?:生成|启动|啟動|开始|開始|运行|運行)|(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:generate|run|start)\b)/i;
  const genTarget = /(?:任务|任務|图片|圖片|图像|圖像|视频|視頻|影片|音频|音訊|音乐|音樂)|\b(?:tasks?|images?|videos?|audio|music)\b/i;
  return (retry.test(text) || (directGeneration.test(text) && !/(?:任务状态|任務狀態|\btask\s+status\b)/i.test(text))) && genTarget.test(text) && !/(?:自动下载|自動下載|生成与下载|生成與下載|\bgeneration\s+(?:and|&)\s+downloads\b)/i.test(text);
}

/** “并发” may mean concurrency, or a second action such as “并发邮件”. */
function hasCompoundSendAction(input:string) {
  return /(?:并|並)(?:发|發)(?:布|佈|送|出|给|給|短信|短訊|信息|訊息|消息|邮件|郵件|帖子|贴文|貼文|视频|視頻|影片|图片|圖片|文件)/.test(input);
}

/** Recognized sequenced account/configuration actions are not node content. */
function hasSequencedSecondaryAction(input:string) {
  return /(?:再|顺带|順帶|顺手|順手)(?:帮我|幫我|替我|给我|給我)?(?:注销|註銷|登出|退出|登录|登入|解绑|解綁|绑定|綁定|充值|购买|購買|付款|支付|清空|重置|导出|導出|删除|刪除|卸载|解除安裝|关闭|關閉|开启|開啟)/.test(input)
    || /\b(?:then|afterwards|after that|also|and)\s+(?:please\s+)?(?:log out|sign out|log in|sign in|delete|unlink|reset|pay|purchase|export|remove|uninstall)\b/i.test(input);
}

/** Do not ask the model to pick between explicitly offered preferences. */
function hasAlternativePreferenceChoices(input:string):boolean {
  if (!/(?:切换|切換|更改|修改|设置|設定|换成|換成|改成|改为|改為|调整|調整)|\b(?:switch|change|set)\b/i.test(input)) return false;
  const parts = input.toLowerCase().split(/(?:或者|或是|还是|還是|抑或|或|\bor\b)/i);
  if (parts.length < 2) return false;
  const groups:Record<string,readonly string[]> = {
    ...Object.fromEntries(Object.entries(assistantThemes).map(([key, names]) => [`theme:${key}`, names])),
    ...Object.fromEntries(Object.entries(assistantLanguages).map(([key, names]) => [`language:${key}`, names])),
  };
  groups["theme:dark"] = [...groups["theme:dark"], "深色", "暗色", "dark", "darker"];
  groups["theme:light"] = [...groups["theme:light"], "浅色", "淺色", "亮色", "light", "lighter"];
  const options = parts.map(part => new Set(Object.entries(groups).filter(([, aliases]) => aliases.some(alias => {
    const needle = alias.toLowerCase();
    if (/^[a-z]/.test(needle)) return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(part);
    return part.includes(needle);
  })).map(([key]) => key)));
  return options.some((left, i) => options.slice(i + 1).some(right => [...left].some(a => [...right].some(b => a !== b && a.split(":")[0] === b.split(":")[0]))));
}

/** Short commands with no target or no chosen theme/language need clarification. */
export function isAmbiguousAssistantOperation(input:unknown):boolean {
  if (typeof input === "string" && input.length <= 16000 && hasAlternativePreferenceChoices(input)) return true;
  if (typeof input === "string" && input.length <= 16000 && hasSequencedSecondaryAction(input)
    && /(?:创建|創建|新建|建立|添加|打开|打開|切换|切換|修改|设置|設定|关闭|關閉|开启|開啟)|\b(?:create|add|open|switch|change|set|enable|disable)\b/i.test(input)
    && !/(?:如何|怎么|怎麼|什么是|什麼是|为什么|為什麼)|\b(?:how|why|what is)\b/i.test(input)) return true;
  if (typeof input === "string" && input.length <= 16000 && hasCompoundSendAction(input)
    && /(?:创建|創建|新建|建立|添加|打开|打開|切换|切換|修改|设置|設定|关闭|關閉|开启|開啟)/.test(input)
    && !/(?:如何|怎么|怎麼|什么是|什麼是|为什么|為什麼)/.test(input)) return true;
  if (typeof input !== "string" || input.length > 100 || /[\r\n;；]/.test(input)) return false;
  const text = input.trim().toLowerCase().replace(/[。.!！?？]+$/, "").trim();
  const zh = text.replace(/\s+/g, "");
  const prefix = "(?:请|請|麻烦|麻煩)?(?:能否|可以|可否|能不能|能)?(?:帮我|幫我)?";
  const targetless = new RegExp(`^${prefix}(?:把|将|將)?(?:它|这个|這個|那个|那個)?(?:调整|調整|调|調|修改|改|设置|設定|切换|切換|打开|打開|关闭|關閉|开启|開啟|配置|删除|刪除)(?:它|这个|這個|那个|那個)?(?:一下|一下吧|好|好吧|吗|嗎)?$`);
  const missingChoice = new RegExp(`^${prefix}(?:(?:切换|切換|更换|更換|改变|改變|设置|設定|修改)(?:主题|主題|语言|語言)|(?:把|将|將)?(?:主题|主題|语言|語言)(?:切换|切換|改|更改|设置|設定|调整|調整))(?:一下|一下吧|吗|嗎)?$`);
  const missingDestination = new RegExp(`^${prefix}(?:带我去|帶我去|前往|(?:我想|我要)去)(?:那里|那裡|那边|那邊|这里|這裡|这个|這個|那个|那個)?(?:一下|吧|吗|嗎)?$`);
  const en = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(?:change|adjust|set|switch|open|close|enable|disable|delete|configure)(?: (?:it|this|that|(?:the )?(?:theme|language)))?(?: please)?$/;
  const enDestination = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(?:take me(?: to)?|go to)(?: (?:there|here|it|this|that))?(?: please)?$/;
  return targetless.test(zh) || missingChoice.test(zh) || missingDestination.test(zh) || en.test(text) || enDestination.test(text);
}

/** An unscoped follow-up cannot safely refer to a specific local operation or task. */
export function isUnscopedAssistantStatusInquiry(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 80 || /[\r\n;；,，、]/.test(input)) return false;
  const text = input.trim().toLowerCase().replace(/[?？.!！。]+$/, "").trim();
  const zh = text.replace(/\s+/g, "");
  return /^(?:你|您|助手)(?:已经|已經)?(?:帮我|幫我|替我)?(?:处理好|處理好|完成|搞定|弄好|做完)(?:了)?(?:吗|嗎|吧|没有|沒有|没|沒)$/.test(zh)
    || /^(?:have you taken care of it|did you finish it)$/i.test(text)
    || /^(?:(?:这个|這個|那个|那個|它)(?:是|已经|已經)?|(?:现在|現在|目前)?(?:是|已经|已經)?)(?:(?:失败|失敗|成功|完成|结束|結束|停止|好了|搞定|做完|弄好)(?:了)?(?:吗|嗎|没有|沒有|没|沒)?|(?:什么|什麼)(?:状态|狀態))$/.test(zh)
    || /^(?:这个|這個|那个|那個|它)(?:现在|現在|目前)?(?:怎么样|怎麼樣|什么情况|什麼情況|什么状态|什麼狀態)(?:了|啦|呢|吗|嗎)?$/.test(zh)
    || /^(?:为什么|為什麼|为何|為何|为啥|為啥|怎么|怎麼)(?:这个|這個|那个|那個|它)?(?:会|會)?(?:失败|失敗|成功|停止)(?:了|啦)?$/.test(zh)
    || /^(?:is|was|has|did) (?:it|that)(?: (?:been|already))? (?:done|finished|completed|successful|failed|fail|stopped|work)$/.test(text)
    || /^(?:how is (?:it|that)(?: (?:now|going))?|what(?: is|'s) (?:its|that(?:'s)?) (?:current )?status)$/.test(text)
    || /^why (?:did|has) (?:it|that) (?:fail|failed|stop|stopped)$/.test(text);
}

/** Only explicit references to the assistant's own preceding operation. */
export function isAssistantLastOperationInquiry(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 100 || /[\r\n;；,，、]/.test(input)) return false;
  const text=input.trim().replace(/[?？.!！。]+$/, "").trim();
  const zh=text.replace(/\s+/g, "");
  return /^(?:(?:上一次|上次|刚才|剛才)(?:的)?(?:助手|智能助手|智慧助手)|(?:助手|智能助手|智慧助手)(?:上一次|上次|刚才|剛才)(?:的)?)(?:操作)(?:的)?(?:结果|結果|结果是什么|結果是什麼|成功了吗|成功了嗎|完成了吗|完成了嗎|状态如何|狀態如何)$/.test(zh)
    || /^(?:what (?:was|is) the result of (?:the )?assistant'?s? (?:last|previous) action|did (?:the )?assistant'?s? (?:last|previous) action (?:succeed|finish))$/i.test(text);
}

/** A how-to question followed by a separate request to act must not be
 * mistaken for a purely informational question or a single executable action. */
export function isAssistantMixedHowToAction(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000) return false;
  const text = input.trim();
  if (!/(?:如何|怎么|怎麼|怎样|怎樣)|\b(?:how\s+(?:to|do|can|should))\b/i.test(text)) return false;
  const zh = /(?:帮我|幫我|替我|请你|請你|麻烦你|麻煩你|然后|然後|顺便|順便|[？?。；;，,]\s*直接)(?:\s|先|直接|现在|現在|再|帮我|幫我|把|将|將|它|这个|這個|那个|那個){0,12}(?:打开|打開|进入|進入|切换|切換|更改|修改|调整|調整|设置|設定|关闭|關閉|开启|開啟|启用|啟用|删除|刪除|创建|創建|生成|重试|重試|弄好|改好|处理|處理)/i;
  const en = /\b(?:(?:(?:can|could|would)\s+you\s+(?:please\s+)?|please\s+|(?:and|then)\s+(?:please\s+)?)(?:open|close|switch|change|set|enable|disable|delete|create|generate|retry|do\s+it)\b|do\s+it\s+for\s+me\b)/i;
  if (zh.test(text) || en.test(text)) return true;
  // An instructional question can be followed by a separate question about
  // live local state. Do not send the whole turn to a model that cannot see
  // that state, nor silently answer only one half. This is a deliberately
  // bounded check of separate clauses, not a general language classifier.
  const clauses = text.split(/[?？.!！。;；,，\n]|(?:以及|并且|並且|还有|還有)|\b(?:and|also)\b/i).map(part => part.trim()).filter(Boolean);
  if (clauses.length < 2) return false;
  const howTo = (part:string) => /(?:如何|怎么|怎麼|怎样|怎樣)|\bhow\s+(?:to|do|can|should)\b/i.test(part);
  return clauses.some(howTo) && clauses.some(part => !howTo(part) && (requiresAssistantLocalStateEvidence(part) || parseAssistantTaskIntent(part) !== null));
}

export type AssistantTaskIntent = "summary"|"diagnose";
export type AssistantTaskCategory = "image"|"video"|"audio"|"text";
const projectTaskCategoryAliases:Record<string,AssistantTaskCategory> = {图片:"image",圖片:"image",图像:"image",圖像:"image",视频:"video",視頻:"video",影片:"video",音频:"audio",音訊:"audio",文本:"text",文字:"text",image:"image",video:"video",audio:"audio",text:"text"};
/** A generic concept question is not a request to read live task data. */
function isAssistantProjectTaskExplanation(input:string):boolean {
  const text = input.trim().toLowerCase().replace(/[?？.!！。]+$/, "").trim();
  const zh = /^(?:请|請)?(?:解释|解釋|介绍|介紹|说明|說明)?(?:项目|專案)(?:的)?(?:任务|任務)(?:的)?(?:用途|作用|意义|意義|定义|定義|含义|含義|意思)(?:是什么|是什麼|吗|嗎)?$/.test(text.replace(/\s+/g, ""));
  const en = /^(?:(?:explain|describe) (?:the )?project tasks?|what is the (?:purpose|meaning|definition) of project tasks?)$/.test(text);
  return zh || en;
}
/** Project-scoped requests must not be silently answered with global counts. */
export function isAssistantProjectTaskInquiry(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000) return false;
  if (!/(?:项目|專案|\bprojects?\b)/i.test(input) || !/(?:任务|任務|\btasks?\b)/i.test(input)) return false;
  if (isAssistantProjectTaskExplanation(input)) return false;
  // A standalone how-to can remain chat.  Do not let one how-to clause
  // suppress the project boundary for a following question: otherwise an
  // English state query may fall through to the global-task summary.
  const standalone = !/[?？,，;；。!！\n]\s*\S/.test(input.trim())
    && !/(?:以及|并且|並且|还有|還有|同时|同時|然后|然後|\b(?:and|then|also)\b).{0,80}(?:任务|任務|\btasks?\b)/i.test(input);
  if (standalone && /(?:如何|怎样|怎樣|什么是|什麼是|怎么(?:查看|查询|查詢|使用)|怎麼(?:查看|查詢|使用))|\b(?:how\s+(?:to|do|can)|what\s+is\s+a)\b/i.test(input)) return false;
  return true;
}
/** Only an explicit single-type or unqualified current-project failure
 * question may be answered from project-scoped records. */
export function parseAssistantCurrentProjectDiagnosis(input:unknown):AssistantTaskCategory|"all"|null {
  if (typeof input !== "string" || input.length > 160) return null;
  const text=input.trim().toLowerCase().replace(/[?？.!！。]+$/, "").trim();
  const zh=text.replace(/\s+/g, "");
  const project="(?:当前|當前|目前|这个|這個|本)(?:项目|專案)(?:的)?(图片|圖片|图像|圖像|视频|視頻|影片|音频|音訊|文本|文字)?(?:任务|任務)";
  const why="(?:为什么|為什麼|为何|為何|为啥|為啥)";
  const cn=new RegExp(`^${why}${project}(?:会|會)?(?:失败|失敗)(?:了|啦)?$`).exec(zh)
    || new RegExp(`^${project}${why}(?:会|會)?(?:失败|失敗)(?:了|啦)?$`).exec(zh);
  if (cn) return cn[1] ? projectTaskCategoryAliases[cn[1]] : "all";
  const en=/^why (?:did|do) (?:the )?(?:current|this|active) project(?:'s)? (?:(image|video|audio|text) )?tasks? fail$/.exec(text)
    || /^why has (?:the )?(?:current|this|active) project(?:'s)? (?:(image|video|audio|text) )?task failed$/.exec(text);
  return en ? (en[1] as AssistantTaskCategory || "all") : null;
}
/** Exact, read-only local task-ID queries; no substring or provider-ID matching. */
export function parseAssistantTaskIdQuery(input:unknown):string|null {
  if (typeof input !== "string" || input.length > 200 || /[\r\n;；]/.test(input)) return null;
  const text = input.trim().replace(/[。.!！?？]+$/, "").trim();
  const id = "([A-Za-z0-9][A-Za-z0-9_.-]{0,127})";
  const chinese = new RegExp(`^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查询|查詢)?(?:任务|任務)(?:编号|編號|id|#)\\s*${id}(?:的)?(?:状态|狀態)(?:是什么|是什麼|如何)?$`, "i").exec(text);
  // Require the word "status" outside the captured ID; otherwise e.g.
  // "task id status" incorrectly treats the missing ID as the word status.
  const english = new RegExp(`^(?:(?:what is )?(?:the )?status of task (?:id\\s+|#)${id}|(?:what is )?task (?:id\\s+|#)${id}(?:'s)? status)$`, "i").exec(text);
  return chinese?.[1] || english?.[1] || english?.[2] || null;
}
/** Only the full local task ID, with an explicit failure question, is eligible
 * for diagnosis. Extra actions, guesses and partial IDs are not accepted. */
export function parseAssistantTaskIdDiagnosis(input:unknown):string|null {
  if (typeof input !== "string" || input.length > 200 || /[\r\n;；]/.test(input)) return null;
  const text=input.trim().replace(/[。.!！?？]+$/, "").trim();
  const id="([A-Za-z0-9][A-Za-z0-9_.-]{0,127})";
  const subject=`(?:任务|任務)(?:编号|編號|id|#)\\s*${id}`;
  const why="(?:为什么|為什麼|为何|為何|为啥|為啥)";
  const cn=new RegExp(`^(?:${why}${subject}|${subject}${why})(?:会|會)?(?:失败|失敗)(?:了|啦)?$`,"i").exec(text);
  if (cn) return cn[1] || cn[2];
  const en=new RegExp(`^why (?:did|does) task (?:id\\s+|#)${id} fail$`,"i").exec(text)
    || new RegExp(`^why has task (?:id\\s+|#)${id} failed$`,"i").exec(text);
  return en?.[1] || null;
}
/** A reference to one task must never be answered as an all-task summary. */
function hasSpecificAssistantTaskReference(text:string):boolean {
  return /(?:这个|這個|这次|這次|那个|那個|(?:这|這|那)(?:一)?[个個条條项項]|第[一二三四五六七八九十百\d]+[个個条條项項]|(?:任务|任務)\s*(?:#|编号|編號|id\b|\d))|\b(?:this|that|first|second|third|\d+(?:st|nd|rd|th))\s+(?:(?:video|image|audio|text)\s+)?task\b|\btask\s*(?:#|id\b|\d)/i.test(text);
}
/** Only clearly generic references may be summarized without model metadata.
 * A specific model cannot be filtered reliably by the privacy-safe summary. */
function isGenericModelTaskReference(text:string):boolean {
  const compact = text.trim().toLowerCase().replace(/[?？.!！。]+$/g, "").replace(/\s+/g, "");
  const zh = /^(?:请|請)?(?:帮我|幫我)?(?:查看|查询|查詢|看看)?(?:我的|当前|當前|目前)?(?:视频|視頻|影片|图片|圖片|图像|圖像|音频|音訊|文本|文字)?模型(?:生成)?(?:任务|任務)(?:状态|狀態|情况|情況|怎么样|怎麼樣)?$/;
  const en = /^(?:show|check)(?:my|the)?(?:(?:video|image|audio|text))?model(?:generation)?tasks?(?:status)?$/;
  return zh.test(compact) || en.test(compact);
}
/** Only use local records for an explicit, single-category failure question. */
export function classifyAssistantTypedDiagnosis(input:unknown):AssistantTaskCategory|"specific"|"model_scope"|"ambiguous"|"unsupported_music"|null {
  if (typeof input !== "string" || input.length > 160 || /[\r\n;；]/.test(input)) return null;
  if (isAssistantProjectTaskExplanation(input)) return null;
  const text = input.trim().toLowerCase();
  if (deferredRequestPattern.test(text) || /(?:不要|不用|不想|別|别|禁止|如果|假如|假设|假設|然后|然後|并且|並且|重试|重試|重新生成|删除|刪除|(?:没有|沒有|尚未|未曾|从未|從未).{0,5}(?:失败|失敗|报错|報錯))|\b(?:never|without|unless|if|then|retry|delete|generate)\b|(?:don|won|wouldn|shouldn)['’]t/i.test(text)) return null;
  // A user's just-generated image or video identifies an individual task,
  // even when they omit the word “task”. Do not invent which record it is or
  // send its status question to a model that cannot inspect the task list.
  const compact = text.replace(/\s+/g, "").replace(/[?？.!！。]+$/, "");
  if (/^我(?:刚才|剛才|刚刚|剛剛|之前)?(?:生成|产生|產生)的(?:视频|視頻|影片|图片|圖片|图像|圖像)(?:为什么|為什麼|为何|為何)(?:失败|失敗)(?:了)?$/.test(compact)
    || /^whydidmygenerated(?:video|image)fail$/.test(compact)) return "specific";
  if (!/(?:任务|任務|\btasks?\b)/i.test(text) || !/(?:失败|失敗|报错|報錯|錯誤|错误|\bfail(?:ed|ure)?\b|\berror\b)/i.test(text) || !/(?:为什么|為什麼|为何|為何|为啥|為啥|什么原因|什麼原因|怎么回事|怎麼回事|排查|诊断|診斷|检查|檢查|\bwhy\b|\bwhat caused\b|\bdiagnose\b|\btroubleshoot\b)/i.test(text)) return null;
  if (/(?:模型|\bmodel\b)/i.test(text)) return "model_scope";
  if (/(?:音乐|音樂|\bmusic\b)/i.test(text)) return "unsupported_music";
  const kinds:AssistantTaskCategory[] = [];
  if (/(?:图片|圖片|图像|圖像|\bimages?\b)/i.test(text)) kinds.push("image");
  if (/(?:视频|視頻|影片|\bvideos?\b)/i.test(text)) kinds.push("video");
  if (/(?:音频|音訊|\baudios?\b)/i.test(text)) kinds.push("audio");
  if (/(?:文本|文字|\btext\b)/i.test(text)) kinds.push("text");
  if (kinds.length > 1) return "ambiguous";
  if (!kinds.length) return null;
  if (hasSpecificAssistantTaskReference(text)) return "specific";
  return kinds[0];
}
/** A fallback for unmistakable read-only questions about current local state.
 * Unclear mixed subjects are clarified locally instead of guessed by a model. */
export function classifyAssistantStateInquiry(input:unknown): "preferences"|"download"|"tasks"|`tasks_${AssistantTaskCategory}`|`task_progress_${AssistantTaskCategory}`|"latest_task"|"specific_task"|"single_task_progress"|"indeterminate_task_stall"|"indeterminate_task_eta"|"indeterminate_task_progress"|"ambiguous"|"ambiguous_task_types"|"unsupported"|"unsupported_music"|null {
  if (typeof input !== "string" || input.length > 160 || /[\r\n;；]/.test(input)) return null;
  if (isAssistantProjectTaskExplanation(input)) return null;
  const text = input.trim().toLowerCase();
  if (deferredRequestPattern.test(text)) return null;
  const compact = text.replace(/\s+/g, "").replace(/[?？.!！。]+$/, "");
  // A request not to inspect state must not be converted into a local query.
  // Do not treat ordinary questions such as “有没有失败任务” as negation.
  if (/(?:不要|不用|不想|不必|不需要|无需|無需|无须|無須|别|別|禁止)|\b(?:never|do not|no need to)\b|(?:don|won|wouldn|shouldn)['’]t/i.test(text)) return null;
  // ETA cannot be derived from a local task status. Exact grammars prevent a
  // compound request from being reduced to just this read-only question.
  if (/^(?:我(?:的)?)?(?:(?:视频|視頻|影片|图片|圖片|音频|音訊)?(?:任务|任務)|生成)(?:现在|現在|目前)?(?:还要|還要)(?:多久|多长时间|多長時間)(?:才能完成|才完成|能完成)?$/.test(compact)
    || /^howlongwillmy(?:generation|task)take$/.test(compact)) return "indeterminate_task_eta";
  if (/^(?:我(?:的)?)?(?:任务|任務)(?:现在|現在|目前)?(?:(?:进度|進度)(?:是)?多少|跑到哪一步了)$/.test(compact)
    || /^whatis(?:my|the)taskprogress$/.test(compact)) return "single_task_progress";
  const typedProgress = /^(?:我(?:的)?)?(视频|視頻|影片|图片|圖片|音频|音訊|文本|文字)(?:任务|任務)(?:现在|現在|目前)?(?:(?:进度|進度)(?:是)?多少|跑到哪一步了)$/.exec(compact)
    || /^whatis(?:my|the)(video|image|audio|text)taskprogress$/.exec(compact);
  if (typedProgress) return `task_progress_${projectTaskCategoryAliases[typedProgress[1]]}`;
  if (/^我(?:刚才|剛才|刚刚|剛剛)?(?:生成|产生|產生)的(?:视频|視頻|影片|图片|圖片)(?:到哪一步了|进度是多少|進度是多少)$/.test(compact)) return "specific_task";
  if (/^(?:我的|這次|这次|刚才的|剛才的)?(?:(?:视频|影片|图片|圖片|图|圖)(?:生成)?|生成(?:视频|影片|图片|圖片|图|圖)?)(?:好|完成|出结果|出結果)(?:了)?(?:吗|嗎|没有|沒有|了吗|了嗎)$/.test(compact)) return "specific_task";
  // “怎么样” asks about state; unlike “怎么查看”, it is not a how-to.
  // Normalize only for how-to detection, leaving all scope checks intact.
  const instructionCheck = text.replace(/(?:状态|狀態|情况|情況)如何|怎么样|怎麼樣/g, "状态");
  if (!text || /(?:如何|怎么|怎麼|怎样|怎樣|区别|區別|对比|對比|如果|假如|假设|假設|然后|然後|并且|並且|接着|接著|稍后|稍後|待会|待會|等会|等會|明天|后天|後天|下次|下週|下周)|\b(?:how to|difference|compare|if|then|later|tomorrow|next time|next week)\b/i.test(instructionCheck)) return null;
  if (/(?:切换|切換|更改|修改|设为|設為|换成|換成|删除|刪除|删掉|刪掉|清理|整理|移除|导出|導出|导入|導入|卸载|卸載|修复|修復|重试|重試|生成视频|生成影片|生成图片|生成圖片)|\b(?:switch|change|delete|purge|remove|export|import|uninstall|repair|retry|generate)\b/i.test(text)) return null;
  if (/(?:请|請|帮我|幫我|能否|可否|可以|能不能|可不可以).{0,12}(?:打开|打開|关闭|關閉|开启|開啟|启用|啟用|停用|禁用)|\b(?:please|could you|can you|would you)\b.{0,20}\b(?:open|enable|disable|turn on|turn off)\b/i.test(text)) return null;
  // A running task does not by itself prove progress or a hang. Do not turn
  // a stall question into a definitive answer from status counts alone.
  if (/(?:任务|任務|\btasks?\b)/i.test(text) && /(?:卡住|卡著|卡着|卡死|停滞|停滯)|\b(?:stuck|hanging|hung|stalled)\b/i.test(text)) return "indeterminate_task_stall";
  const isQuestion = /[?？]|(?:什么|什麼|哪个|哪個|哪种|哪種|是否|有没有|有沒有|多少|几个|幾個|看下|看一下|看看|查一下|查一查|查看|查询|查詢|状态|狀態|情况|情況|怎么样|怎麼樣|了吗|了嗎|吗|嗎)|(?:没|沒)(?:有|呀|啊)?[。.!！\s]*$|\b(?:what|which|how many|status|is|are|do i have|show|check)\b/i.test(text);
  if (!isQuestion) return null;
  const preferences = /主题|主題|语言|語言|\b(?:theme|language)\b/i.test(text);
  const download = /自[动動]下[载載]|\b(?:auto|automatic)[ -]?downloads?\b/i.test(text);
  const tasks = /任务|任務|\btasks?\b/i.test(text);
  // A read-only task question combined with a separate navigation or toggle
  // must not be silently treated as just the read-only half of the request.
  if (tasks && /(?:打开|打開|进入|進入|关闭|關閉|开启|開啟|启用|啟用|停用|禁用)|\b(?:open|close|enable|disable|turn on|turn off)\b/i.test(text)) return null;
  const categories = [preferences && "preferences",download && "download",tasks && "tasks"].filter(Boolean);
  if (!categories.length) return null;
  if (categories.length > 1) return "ambiguous";
  // Merely mentioning a model does not make a status request a request for
  // model metadata. Only explicit detail questions need to be declined; the
  // status formatter below never returns names, IDs, prompts or addresses.
  const modelDetails = /(?:用的|使用的|所用|使用|采用|採用).{0,6}模型|模型.{0,8}(?:是什么|是什麼|哪个|哪個|名称|名稱|编号|編號|详情|詳情|\bid\b)|\b(?:what|which)\s+model\b|\bmodel\s+(?:id|name|details?)\b|\btasks?(?:'s)?\s+model\b/i.test(text);
  const unrecognizedModelScope = /(?:模型|\bmodel\b)/i.test(text) && !isGenericModelTaskReference(text);
  if (tasks && (modelDetails || unrecognizedModelScope || /提示[词詞]|地址|网址|網址|文件|内容|內容|明细|明細|详情|詳情|\b(?:prompt|url|file|details?)\b/i.test(text))) return "unsupported";
  const taskTypes:AssistantTaskCategory[] = [];
  if (tasks && /视频|視頻|影片|\bvideos?\b/i.test(text)) taskTypes.push("video");
  if (tasks && /图片|圖片|图像|圖像|\bimages?\b/i.test(text)) taskTypes.push("image");
  if (tasks && /音频|音訊|\baudios?\b/i.test(text)) taskTypes.push("audio");
  if (tasks && /文本|文字|\btext\b/i.test(text)) taskTypes.push("text");
  // Some music records are stored as audio; do not silently claim a complete
  // music-only count without a reliable canonical music category.
  if (tasks && /音乐|音樂|\bmusic\b/i.test(text)) return "unsupported_music";
  if (taskTypes.length > 1) return "ambiguous_task_types";
  if (tasks && hasSpecificAssistantTaskReference(text)) return "specific_task";
  if (taskTypes.length && /上一个|上一個|上一条|上一條|上一次|上次|最后一个|最後一個|最新|最近|\b(?:last|previous|latest|most recent)\b/i.test(text)) return "specific_task";
  if (tasks && /(?:失败|失敗)(?:的)?(?:任务|任務)|\bfailed\s+task\b/i.test(text) && /上一个|上一個|上一条|上一條|上一次|上次|最后一个|最後一個|最新|最近|\b(?:last|previous|latest|most recent)\b/i.test(text)) return "specific_task";
  // “Previous” is relative to an unspecified current task; it cannot safely
  // be equated with the newest entry in the global list.
  if (tasks && /上一个|上一個|上一条|上一條|上一次|上次|\bprevious\s+(?:created\s+)?task\b/i.test(text)) return "specific_task";
  if (tasks && /最后一个|最後一個|最新(?:的|生成的|建立的|创建的|創建的)?(?:一[个個条條]|任务|任務)|最近(?:的|生成的|建立的|创建的|創建的)?(?:一[个個条條]|任务|任務)|\b(?:last|latest|most recent)\s+(?:created\s+)?task\b/i.test(text)) return "latest_task";
  if (taskTypes.length === 1) return `tasks_${taskTypes[0]}`;
  return categories[0] as "preferences"|"download"|"tasks";
}

/** If a live-state question is not understood locally, do not ask a model
 * without access to that state to invent an answer. General explanations and
 * how-to questions remain ordinary conversation. */
export function requiresAssistantLocalStateEvidence(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000) return false;
  if (isAssistantProjectTaskExplanation(input)) return false;
  const text = input.trim();
  if (!text || /(?:如何|怎么|怎麼|怎样|怎樣|什么是|什麼是|区别|區別|原理|教程)|\b(?:how\s+(?:to|do|does|can)|what\s+(?:is|are)\s+(?:a|an)\b|explain|difference|tutorial)\b/i.test(text)) return false;
  if (mayOfferAssistantAction(text)) return false;
  const subject = /任务|任務|主题|主題|语言|語言|自[动動]下[载載]|\b(?:tasks?|theme|language|automatic[ -]?downloads?|auto[ -]?downloads?)\b/i.test(text);
  const live = /(?:我(?:的)?|当前|當前|目前|现在|現在|刚才|剛才|这个|這個|那个|那個|是不是|是否|卡住|卡著|进展|進展|状态|狀態)|\b(?:my|mine|current|currently|right now|this|that|stuck|status)\b/i.test(text);
  const inquiry = /[?？]|是不是|是否|有没有|有沒有|吗|嗎|什么|什麼|状态|狀態|进展|進展|卡住|卡著|\b(?:is|are|what|which|status|stuck)\b/i.test(text);
  return subject && live && inquiry;
}
export function parseAssistantTaskIntent(input:unknown): AssistantTaskIntent|null {
  if (typeof input !== "string" || input.length > 100 || /[\r\n;；]/.test(input)) return null;
  const text = input.trim().toLowerCase().replace(/[。.!！?？]+$/, "").replace(/\s+/g, "");
  // These are questions about the whole local task list, not a how-to request
  // to an assistant that lacks task state. A singular "this task" stays
  // outside this exact grammar and is handled as an ambiguous reference.
  if (/^(?:现在|現在|目前|当前|當前)?(?:我|我的)?(?:任务|任務)(?:怎么样|怎麼樣|怎么了|怎麼了|什么情况|什麼情況|进展如何|進展如何)$/.test(text)
    || /^(?:howaremytasks(?:doing|going)|howarethetasks(?:doing|going)|what(?:is|'s)thestatusofmytasks)$/.test(text)) return "summary";
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查询|查詢|看看)?(?:我的|当前|當前|目前)?(?:任务|任務)(?:状态|狀態|情况|情況|怎么样|怎麼樣|有哪些|列表)$/.test(text) || /^(?:show|check)(?:my)?(?:taskstatus|tasks)$/.test(text)) return "summary";
  if (/^(?:现在|現在|当前|當前|目前)?(?:有多少|还有|還有|有)?(?:个|個)?(?:任务|任務)(?:正在|在)?(?:排队|排隊|进行中|進行中|运行中|運行中|失败|失敗|成功|完成|停止|已停止)(?:吗|嗎|多少|了吗|了嗎)?$/.test(text) || /^(?:show|check)(?:my)?(?:running|queued|failed|completed|stopped)tasks$/.test(text)) return "summary";
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查詢|查询|看看)?(?:我(?:的)?|目前|当前|當前)?(?:正在|已經|已经|已)?(?:排队|排隊|进行中|進行中|运行中|運行中|失败|失敗|成功|完成|停止)(?:的)?(?:任务|任務)(?:有多少|多少|有哪些|吗|嗎)?$/.test(text) || /^(?:howmany)(?:ofmy)?tasks(?:are|have)?(?:running|queued|failed|completed|stopped)$/.test(text)) return "summary";
  if (/^(?:我|现在|現在|目前|最近|最新)?(?:有(?:没有|沒有)?|有哪些|有多少|还有|還有)(?:正在|已經|已经|已)?(?:排队|排隊|进行中|進行中|运行中|運行中|失败|失敗|成功|完成|停止)(?:的)?(?:任务|任務)(?:吗|嗎|多少|了吗|了嗎)?$/.test(text) || /^(?:arethere|doihave)(?:any)?(?:running|queued|failed|completed|stopped)tasks$/.test(text)) return "summary";
  if (/^(?:我的|当前|當前|现在的|現在的)?(?:任务|任務)(?:都|是否|已經|已经)?(?:完成|结束|結束|失败|失敗|停止|成功)(?:了)?(?:吗|嗎|没有|沒有|了吗|了嗎)$/.test(text)) return "summary";
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:排查|诊断|診斷|检查|檢查)(?:最近|最新)(?:的)?(?:失败|失敗)(?:的)?(?:任务|任務)$/.test(text) || /^(?:diagnose|check)(?:my)?(?:latest|last)failedtask$/.test(text)) return "diagnose";
  // These exact requests describe failed tasks in general. Do not strip extra
  // clauses or a reference to a specific task into a partial diagnosis.
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:排查|诊断|診斷|检查|檢查)(?:我(?:的)?)?(?:失败|失敗)(?:的)?(?:任务|任務)$/.test(text)
    || /^(?:我(?:的)?)?(?:任务|任務)(?:失败|失敗)(?:了)?[，,]?(?:请|請)?(?:帮我|幫我)?(?:排查|诊断|診斷|检查|檢查)$/.test(text)
    || /^(?:我(?:的)?)?(?:失败|失敗)(?:的)?(?:任务|任務)(?:是什么原因|是什麼原因|为什么|為什麼)$/.test(text)
    || /^(?:check|diagnose)why(?:my|the)taskfailed$/.test(text)) return "diagnose";
  // A generic question about a failed task can be answered from local,
  // redacted metadata; do not guess a particular node or task type.
  if (/^(?:请|請)?(?:帮我|幫我)?(?:看看|查查)?(?:(?:为什么|為什麼|为何|為何)(?:我的|目前的|当前的|當前的)?(?:任务|任務)|(?:我的|目前的|当前的|當前的)?(?:任务|任務)(?:为什么|為什麼|为何|為何))(?:会|會)?(?:失败|失敗)(?:了|啦)?$/.test(text) || /^why(?:(?:did|does)(?:my|the)taskfail|has(?:my|the)taskfailed|is(?:my|the)taskfailing)$/.test(text)) return "diagnose";
  return null;
}

/** Fail closed on negation, hypotheticals or multi-step requests before rendering model-proposed controls. */
/** A comparative direction is a suggestion, not a direct setting change. */
function parseComparativeThemeRequest(input:string):"dark"|"light"|null {
  const clauses = input.split(/[，,、:：]/).map(part => part.trim().replace(/[。.!！?？]+$/g, "").trim()).filter(part => part && !/^(?:你好|您好|嗨|谢谢|謝謝|麻烦了|麻煩了|拜托|拜託|hello|hi|thanks|thank you|please)$/i.test(part));
  if (clauses.length !== 1) return null;
  const text = clauses[0].toLowerCase();
  const zh = /^(?:请|請|麻烦|麻煩)?(?:能否|可以|可不可以|能不能|能)?(?:帮我|幫我)?(?:把|将|將)?(?:当前|當前|现在的|現在的|我的)?(?:石墨灰|曜石黑|晴空蓝|晴空藍|暖砂白|樱雾粉|櫻霧粉|薄荷绿|薄荷綠)?(?:主题|主題|外观|外觀)(?:调|調|变|變)(暗|深|亮|浅|淺)(?:一点点|一點點|一点|一點|一些|些)?(?:吧|吗|嗎)?$/.exec(text.replace(/\s+/g,""));
  if (zh) return /^(?:暗|深)$/.test(zh[1]) ? "dark" : "light";
  const en = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(?:make|turn) (?:my |the )?(?:theme|appearance) (?:(?:a bit|a little|slightly) )?(darker|lighter)(?: please)?$/.exec(text);
  return en ? (en[1] === "darker" ? "dark" : "light") : null;
}

export function mayOfferAssistantAction(input:unknown) {
  if (typeof input !== "string" || input.length > 16000 || /[\r\n;；]/.test(input)) return false;
  if (hasAlternativePreferenceChoices(input)) return false;
  if (deferredRequestPattern.test(input)) return false;
  // “并发” may mean concurrency, but it may also introduce a second action
  // (“并发邮件”, “并发布帖子”). Do not turn the latter into a partial
  // node proposal; literal concurrency wording remains available.
  if (hasCompoundSendAction(input) || hasSequencedSecondaryAction(input)) return false;
  // Do not turn a potentially compound request into a partial node or setting
  // proposal. Conservative rejection may also decline literal node content;
  // users can enter that content manually instead.
  if (/(?:格式化|卸载|解除安裝|覆盖|覆蓋|运行|運行|执行|執行|安装|安裝|重启|重啟|关机|關機|发送|發送)|\b(?:format|uninstall|overwrite|execute|install|reboot|shutdown|send)\b|\brun\b.{0,40}\b(?:code|scripts?|commands?|shell|programs?|process(?:es)?)\b/i.test(input)) return false;
  if (/(?:不要|不用|不能|不必|不想|不需要|无需|無需|无须|無須|别|別|禁止|不.{0,8}(?:打开|打開|进入|進入|切换|切換|更改|修改|设置|設定|开启|開啟|关闭|關閉|删|刪|生成|重试|重試)|如果|假如|假设|假設|如何|怎么|怎麼|怎样|怎樣|为什么|為什麼|稍后|稍後|待会|待會|等会|等會|明天|后天|後天|下次|下週|下周|然后|然後|并(?!发|發)|並(?!发|發)|同时|同時|接着|接著|之后|之後|随后|隨後|再(?:去|把|将|將|打|删|刪|切|改|开|開|关|關|生成|重试|重試))|\b(?:not|never|without|unless|if|then|how|why|later|tomorrow|next time|next week|no\s+need)\b|(?:don|can|won|wouldn|shouldn)['’]t/i.test(input)) return false;
  // Separate substantive clauses are not one unambiguous operation. Ignore
  // standalone greetings and thanks, but never discard another request.
  const clauses = input.split(/[，,、:：]/).map(part => part.trim().replace(/[。.!！?？]+$/g, "").trim()).filter(part => part && !/^(?:你好|您好|嗨|谢谢|謝謝|麻烦了|麻煩了|拜托|拜託|hello|hi|thanks|thank you|please)$/i.test(part));
  if (clauses.length > 1) return false;
  if (parseComparativeThemeRequest(input)) return true;
  const normalized = input.replace(/生成(?:结果|結果)自[动動]下[载載]/g, "自动下载").replace(/生成[与與和]下[载載]/g, "下载页").replace(/\bgeneration\s+(?:and|&)\s+downloads\b/gi, "generation downloads").replace(/(?:api|模型|账号|帳號|外观|外觀|语言|語言|主题|主題|生成|下载|下載)(?:设置|設定)/gi, "选项").replace(/(带我去|帶我去|(?:我想|我要)去|前往|打开|打開|进入|進入)(?:设置|設定)/g, "$1页面");
  // A request that joins actions must not be reduced to just the one action
  // the model happened to propose. The real single-page name above is exempt.
  if (/(?:顺便|順便|以及|还要|還要)|\b(?:and|also|plus|as well as)\b/i.test(normalized)) return false;
  const verbs = normalized.match(/带我去|帶我去|(?:我想|我要)去|前往|打开|打開|进入|進入|切换|切換|切到|更改|修改|改成|改为|改為|换成|換成|调成|調成|设置|設定|关闭|關閉|开启|開啟|删除|刪除|删掉|刪掉|清理|整理|移除|导出|導出|导入|導入|迁移|遷移|备份|備份|恢复|恢復|修复|修復|分享|同步|创建|創建|建立|新增|生成|重试|重試|查看|查询|查詢|检查|檢查|选择|選擇|选中|選中|保存|储存|儲存|复制|複製|粘贴|貼上|提交|清空|重置|启动|啟動|退出|登出|登录|登入|绑定|綁定|充值|购买|購買|\b(?:open|close|go to|take me to|switch|change|set|enable|disable|turn on|turn off|delete|purge|remove|archive|export|import|repair|share|sync|create|add|generate|retry|show|check|select|choose|save|copy|paste|submit|reset|sign in|log in|buy|pay)\b/gi) || [];
  return verbs.length === 1;
}

/** A navigation proposal must account for the whole substantive request, not
 * just a destination substring. Anything extra requires clarification. */
function matchesWholeNavigationRequest(input:string, destination:AssistantDestination):boolean {
  const clauses = input.split(/[，,、:：]/).map(part => part.trim().replace(/[。.!！?？]+$/g, "").trim()).filter(part => part && !/^(?:你好|您好|嗨|谢谢|謝謝|麻烦了|麻煩了|拜托|拜託|hello|hi|thanks|thank you|please)$/i.test(part));
  if (clauses.length !== 1) return false;
  const text = clauses[0].toLowerCase();
  const zh = /^(?:请|請|麻烦|麻煩)?(?:能否|可以|可不可以|能不能|能)?(?:帮我|幫我)?(?:我想|我要)?(?:带我去|帶我去|去|打开|打開|进入|進入|前往|切换到|切換到)(?:看看)?(.+?)(?:页面|頁面)?(?:一下|吧|吗|嗎)?$/.exec(text.replace(/\s+/g,""));
  const en = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(?:i want to )?(?:open|go to|switch to|take me to) (?:the )?(.+?)(?: page)?(?: please)?$/.exec(text);
  const target = zh?.[1] || en?.[1];
  return !!target && destinations[destination].some(alias => (zh ? alias.toLowerCase().replace(/\s+/g, "") : alias.toLowerCase()) === target);
}

function matchesWholeAutoDownloadRequest(input:string, value:boolean):boolean {
  const clauses = input.split(/[，,、:：]/).map(part => part.trim().replace(/[。.!！?？]+$/g, "").trim()).filter(part => part && !/^(?:你好|您好|嗨|谢谢|謝謝|麻烦了|麻煩了|拜托|拜託|hello|hi|thanks|thank you|please)$/i.test(part));
  if (clauses.length !== 1) return false;
  const text = clauses[0].toLowerCase(), compact = text.replace(/\s+/g, "");
  const prefix = "(?:请|請|麻烦|麻煩)?(?:能否|可以|可不可以|能不能|能)?(?:帮我|幫我)?";
  const verb = "(开启|開啟|打开|打開|启用|啟用|关闭|關閉|关掉|關掉|停用|禁用)";
  const subject = "(?:生成结果|生成結果)?自[动動]下[载載](?:生成结果|生成結果)?";
  const suffix = "(?:一下|吧|吗|嗎)?";
  const zh = new RegExp(`^${prefix}(?:现在|現在)?${verb}${subject}${suffix}$`).exec(compact)
    || new RegExp(`^${prefix}(?:把|将|將)${subject}${verb}${suffix}$`).exec(compact);
  const en = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(enable|turn on|disable|turn off) (?:automatic|auto) downloads?(?: of generated results)?(?: please)?$/.exec(text);
  const command = zh?.[1] || en?.[1];
  return !!command && /^(?:开启|開啟|打开|打開|启用|啟用|enable|turn on)$/i.test(command) === value;
}

function matchesWholeNodeRequest(input:string):boolean {
  const clauses = input.split(/[，,、:：]/).map(part => part.trim().replace(/[。.!！?？]+$/g, "").trim()).filter(part => part && !/^(?:你好|您好|嗨|谢谢|謝謝|麻烦了|麻煩了|拜托|拜託|hello|hi|thanks|thank you|please)$/i.test(part));
  if (clauses.length !== 1) return false;
  const text = clauses[0].toLowerCase();
  const zh = /^(?:请|請|麻烦|麻煩)?(?:能否|可以|可不可以|能不能|能)?(?:帮我|幫我)?(?:创建|創建|新建|新增|建立|添加)(?:一[个個]|[个個])?(?:文字|文本|图片|圖片|生图|生圖|视频|視頻|影片)(?:节点|節點)(?:(?:内容|內容)(?:为|為|是|写|寫).+|(?:一下|吧|吗|嗎)?)$/;
  const en = /^(?:please )?(?:(?:can|could|would) you )?(?:please )?(?:create|add) (?:a |an |one )?(?:text|image|video) node(?:(?: with content | containing ).+|(?: please)?)$/;
  return zh.test(text.replace(/\s+/g,"")) || en.test(text);
}

/** A model may not turn an unrelated or underspecified request into a button. */
export function assistantProposalMatchesRequest(input:unknown, proposal:{action?:unknown; preference?:{kind?:unknown; value?:unknown}|null}):boolean {
  if (typeof input !== "string" || !mayOfferAssistantAction(input)) return false;
  const text = input.toLowerCase();
  if (proposal.preference) {
    const {kind,value} = proposal.preference;
    if (kind === "theme" || kind === "language") {
      const comparative = kind === "theme" ? parseComparativeThemeRequest(input) : null;
      if (comparative) return value === comparative;
      const change = /(?:切换|切換|更改|修改|改成|改为|改為|换成|換成|调成|調成|设置|設定|设为|設為)|\b(?:switch|change|set)\b/i.exec(text);
      if (!change) return false;
      const before = text.slice(0,change.index).replace(/^(?:你好|您好|嗨|hello|hi)[，,、:：]\s*/i, "").trim();
      const zhBefore = before.replace(/\s+/g, "");
      const zhPrefix = /^(?:请|請|麻烦|麻煩)?(?:能否|可以|可不可以|能不能|能)?(?:帮我|幫我)?(?:把|将|將)?(?:软件|軟體|应用|應用程式|界面|介面)?(?:的)?(?:(?:石墨灰|曜石黑|晴空蓝|晴空藍|暖砂白|樱雾粉|櫻霧粉|薄荷绿|薄荷綠|深色|暗色|浅色|淺色|亮色|简体中文|簡體中文|繁体中文|繁體中文|英语|英語|英文)?(?:主题|主題|语言|語言|外观|外觀))?$/;
      const enPrefix = /^(?:(?:please|can you|could you|would you)\s*)*$/i;
      if (!zhPrefix.test(zhBefore) && !enPrefix.test(before)) return false;
      let targetText = text.slice(change.index + change[0].length);
      // In English, a source may follow the verb (“switch from A to B”).
      // Only the destination after “to” is eligible to authorize a proposal.
      if (/\bfrom\b/i.test(targetText)) {
        const destination = /\bto\b/i.exec(targetText);
        if (!destination) return false;
        targetText = targetText.slice(destination.index + destination[0].length);
      } else if (/\bto\b/i.test(targetText)) {
        const destination = /\bto\b/i.exec(targetText)!;
        targetText = targetText.slice(destination.index + destination[0].length);
      }
      // Consume the entire destination, allowing only grammatical wrappers.
      // A target merely embedded in a longer request cannot authorize a
      // partial setting change, even when the extra action is unfamiliar.
      targetText = targetText.trim().replace(/[。.!！?？]+$/g, "").trim()
        .replace(/^(?:为|為|成|到)/, "").replace(/(?:主题|主題|语言|語言)?(?:一下|吧|吗|嗎)$/, "").trim()
        .replace(/\s+please$/, "").trim();
      const aliases = kind === "theme" ? assistantThemes : assistantLanguages;
      if (typeof value !== "string" || !Object.hasOwn(aliases,value)) return false;
      const found = Object.entries(aliases).filter(([,names]) => (names as readonly string[]).some(name => {
        return name.toLowerCase() === targetText;
      })).map(([key]) => key);
      if (found.length) return found.length === 1 && found[0] === value;
      // A broad light/dark request can receive one explicit, user-confirmed
      // suggestion. It never executes as a direct command or infers a color
      // from unrelated text; competing directions remain ambiguous.
      if (kind === "theme" && /主题|主題|外观|外觀|\b(?:theme|appearance)\b/i.test(text)) {
        const dark = /^(?:深色|暗色|dark(?:er)?(?: mode)?)$/i.test(targetText);
        const light = /^(?:浅色|淺色|亮色|light(?:er)?(?: mode)?)$/i.test(targetText);
        if (dark !== light) return value === (dark ? "dark" : "light");
      }
      // A category alone does not authorize guessing a target value.
      return false;
    }
    if (kind === "autoDownload") {
      if (!/自[动動]下[载載]|\b(?:auto|automatic)[ -]?downloads?\b/i.test(text) || typeof value !== "boolean") return false;
      const on = /开启|開啟|打开|打開|启用|啟用|\b(?:enable|turn on)\b/i.test(text);
      const off = /关闭|關閉|关掉|關掉|停用|禁用|\b(?:disable|turn off)\b/i.test(text);
      return on !== off && value === on && matchesWholeAutoDownloadRequest(input,value);
    }
    return false;
  }
  const targets:Record<string,RegExp> = {
    open_canvas:/画布|畫布|\bcanvas\b/i, open_resources:/资源|資源|\b(?:resources|assets)\b/i,
    open_agents:/智能体|智能體|智慧體|\bagents?\b/i, open_workspace:/工作空间|工作空間|\bworkspace\b/i,
    open_account_settings:/账号|帳號|账户|帳戶|\baccount\b/i, open_appearance_settings:/外观|外觀|主题|主題|语言|語言|\b(?:appearance|theme|language)\b/i,
    open_settings:/设置|設定|\bsettings\b/i, open_api_settings:/\bapi\b/i, open_model_settings:/模型|\bmodels?\b/i,
    open_generation_settings:/生成[与與和].{0,2}下[载載]|生成[设設][置定]|下[载載][设設][置定]|\b(?:generation|downloads?)\b/i,
    create_text_node:/(?:文字|文本|\btext\b).*(?:节点|節點|\bnode\b)|(?:节点|節點|\bnode\b).*(?:文字|文本|\btext\b)/i,
    create_image_node:/(?:生图|生圖|图片|圖片|\bimage\b).*(?:节点|節點|\bnode\b)|(?:节点|節點|\bnode\b).*(?:生图|生圖|图片|圖片|\bimage\b)/i,
    create_video_node:/(?:视频|視頻|影片|\bvideo\b).*(?:节点|節點|\bnode\b)|(?:节点|節點|\bnode\b).*(?:视频|視頻|影片|\bvideo\b)/i,
  };
  if (typeof proposal.action !== "string" || !Object.hasOwn(targets,proposal.action) || !targets[proposal.action].test(text)) return false;
  if (proposal.action.startsWith("open_")) {
    if (!/(?:带我去|帶我去|(?:我想|我要)去|打开|打開|进入|進入|前往|切换到|切換到)|\b(?:open|go to|switch to|take me to)\b/i.test(text)) return false;
    const found = Object.keys(targets).filter(key => key.startsWith("open_") && targets[key].test(text));
    // “Model settings” is one specific destination, not two; but a general
    // settings proposal must not replace an explicitly requested subsection.
    const specificSettings = found.some(key => ["open_account_settings","open_appearance_settings","open_api_settings","open_model_settings","open_generation_settings"].includes(key));
    const distinct = specificSettings ? found.filter(key => key !== "open_settings") : found;
    const destinationByAction:Record<string,AssistantDestination> = {open_canvas:"canvas",open_resources:"resources",open_agents:"agents",open_workspace:"workspace",open_settings:"settings",open_account_settings:"account",open_appearance_settings:"appearance",open_api_settings:"api",open_model_settings:"models",open_generation_settings:"generation"};
    return distinct.length === 1 && distinct[0] === proposal.action && matchesWholeNavigationRequest(input,destinationByAction[proposal.action]);
  }
  if (proposal.action.startsWith("create_")) {
    if (!/(?:创建|創建|新建|新增|建立|添加)|\b(?:create|add)\b/i.test(text)) return false;
    const found = Object.keys(targets).filter(key => key.startsWith("create_") && targets[key].test(text));
    return found.length === 1 && found[0] === proposal.action && matchesWholeNodeRequest(input);
  }
  return false;
}

/** Control requests require a verified local receipt or an explicit proposal;
 * free-form model prose is never accepted as their execution result. */
export function requiresAssistantOperationReceipt(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000) return false;
  const text = input.trim().toLowerCase();
  if (/^(?:好了吗|好了嗎|完成了吗|完成了嗎|做完了吗|做完了嗎|弄好了吗|弄好了嗎|搞定了吗|搞定了嗎|done yet|is it done)[?？.!！。\s]*$/i.test(text)) return true;
  if (/(?:如何|怎么|怎麼|怎样|怎樣|为什么|為什麼|为何|為何|怎么办|怎麼辦)|\b(?:how to|how do|why|what is|what are)\b/i.test(text)) return false;
  if (/^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:把|将|將)?(?:它|这个|這個|那个|那個).{0,20}(?:改|调|調|弄|搞定|处理|處理|打开|打開|关闭|關閉|开启|開啟|切换|切換|删除|刪除)/.test(text)) return true;
  const target = /主题|主題|语言|語言|自[动動]下[载載]|设置|設定|界面|介面|软件|軟體|应用|應用程式|画布|畫布|资源|資源|智能体|智能體|智慧體|工作空间|工作空間|账号|帳號|账户|帳戶|模型|节点|節點|项目|專案|資料|文件|\b(?:app|application|interface|ui|theme|language|downloads?|settings?|canvas|resources?|agents?|workspace|accounts?|models?|nodes?|projects?|files?)\b/i.test(text);
  const verb = /带我去|帶我去|(?:我想|我要)去|前往|打开|打開|进入|進入|切换|切換|更改|修改|调整|調整|设置|設定|设为|設為|换成|換成|关闭|關閉|关掉|關掉|开启|開啟|启用|啟用|删除|刪除|删掉|刪掉|创建|創建|建立|新增|重试|重試|生成|完成|搞定|弄好|处理|處理|修复|修復|\b(?:open|go to|take me to|switch|change|set|enable|disable|turn on|turn off|delete|create|add|retry|generate|finish|done|fix|repair)\b/i.test(text);
  return target && verb;
}

/** Do not imply a scheduled action exists: scheduling is not supported. */
export function isAssistantDeferredOperation(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 16000 || /[\r\n;；]/.test(input)) return false;
  if (!deferredRequestPattern.test(input)) return false;
  if (requiresAssistantOperationReceipt(input)) return true;
  return /(?:任务|任務|\btasks?\b)/i.test(input) && /(?:查看|查询|查詢|检查|檢查|看看|排查|诊断|診斷)|\b(?:check|show|diagnose)\b/i.test(input);
}

/** A future status is not in the local task list and must not be guessed. */
export function isAssistantFutureTaskInquiry(input:unknown):boolean {
  if (typeof input !== "string" || input.length > 160 || /[\r\n;；]/.test(input) || !deferredRequestPattern.test(input)) return false;
  if (/(?:如果|假如|假设|假設|查询|查詢|查看|检查|檢查|排查|诊断|診斷)|\b(?:if|unless|check|show|diagnose|troubleshoot)\b/i.test(input)) return false;
  return /(?:任务|任務|\btasks?\b)/i.test(input) && /(?:状态|狀態|失败|失敗|完成|成功|为什么|為什麼|为何|為何|为啥|為啥)|\b(?:status|fail|failure|complete|finish|succeed|why)\b/i.test(input);
}

/** Untrusted conversational text is not evidence of an app state change. */
export function hasUnverifiedAssistantActionClaim(value:unknown) {
  if (typeof value !== "string") return false;
  // Normalize only the comparison copy, never the user's displayed message.
  // Invisible and directional controls can otherwise split known labels.
  const input = value.normalize("NFKC").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "");
  // Only the local message envelope may display the app's receipt labels.
  if (/(?:软件操作|軟體操作)\s*[·:：-]\s*(?:已确认|已確認)|\bapp action\s*[·:：-]\s*confirmed\b/i.test(input)) return true;
  // A fabricated neutral feedback or pending/rejected label can also look
  // like trusted UI, even when it does not contain an explicit success claim.
  // Only treat a label at the start of a line as impersonation, so discussing
  // these terms in ordinary prose remains possible.
  if (/(?:^|\n)\s*(?:软件反馈|軟體回饋|app feedback)\s*(?:[·:：-]|$)/i.test(input)) return true;
  if (/(?:^|\n)\s*(?:建议操作|建議操作|suggested action|软件操作|軟體操作|app action)\s*[·:：-]\s*(?:等待确认|等待確認|结果未确认|結果未確認|未执行|未執行|awaiting confirmation|result unconfirmed|not performed)/i.test(input)) return true;
  // Conversational paraphrases can assert completion without naming a setting.
  // Keep this a conservative filter: the app's local receipt is the authority,
  // and the separate model-reply notice remains necessary for other wording.
  if (/(?:一切|全部|所有事情|都).{0,24}(?:办妥|辦妥|办好|辦好|安排好|完成|搞定|处理好|處理好)(?:了|啦|囉|咯)?/.test(input)) return true;
  // Generic compliance acknowledgements can falsely imply an action occurred
  // even when the model names no setting or operation. Treat common standalone
  // replies as unverified; normal explanatory text remains conversational.
  if (/(?:^|[\n。.!！?？])\s*(?:(?:好的|好|没问题|沒問題)[，,。.!！\s]*)?(?:已|已经|已經)(?:照办|照辦|遵照(?:你的|您的)?(?:要求|指示)?(?:执行|執行)|按(?:照)?(?:你的|您的)?(?:要求|指示)(?:执行|執行|处理|處理))(?:了|啦|囉)?(?:[，,。.!！\s]|$)/.test(input)) return true;
  if (/(?:^|[\n.!?])\s*(?:as requested[,\s]+)?(?:it(?:'s| is) done|consider it done|i(?:'ve| have) done as (?:you )?requested)(?:[,.!\s]|$)/i.test(input)) return true;
  if (/(?:^|[\n.!！?？])\s*(?:all (?:set|done)|done|finished|completed)[.!！\s]*$/i.test(input.trim())) return true;
  if (/(?:你的|您的|你(?:的)?|您(?:的)?).{0,8}(?:设置|設定|主题|主題|语言|語言).{0,8}(?:已经|已經|已|都).{0,8}(?:准备就绪|準備就緒|安排好)/.test(input)) return true;
  if (/\b(?:your|the)\s+(?:settings?|theme|language|downloads?)\s+(?:is|are)\s+(?:(?:all|now)\s+)?ready\b/i.test(input)) return true;
  // Passive success wording must not become an app receipt either, even
  // when it avoids saying that the assistant personally changed anything.
  if (/(?:你的|您的|所请求的|所請求的|请求的|請求的)(?:更改|变更|變更|调整|調整|设置|設定|主题|主題|语言|語言)(?:现正|現正|现在|現在|目前)(?:已经|已經|已|正)?(?:生效|套用|应用|應用)/.test(input)) return true;
  if (/\b(?:your|the)\s+(?:(?:requested|new)\s+)?(?:changes?|settings?|configuration|theme|language|downloads?)\s+(?:is|are|was|were|has|have)\s+(?:(?:now|already|successfully|been)\s+)*(?:in effect|effective|applied|implemented|activated|fulfilled)\b/i.test(input)) return true;
  if (/(?:我|助手|替您|替你|为您|為您|帮您|幫您).{0,24}(?:办妥|辦妥|妥善落实|妥善落實)|(?:您的|你提出的|您提出的).{0,16}(?:操作|请求|請求|要求).{0,12}(?:已|已经|已經).{0,8}(?:办妥|辦妥|落实|落實)|\b(?:done and dusted|all taken care of)\b/i.test(input)) return true;
  if (/(?:^|[\s，,。.!！])(?:搞定|弄好|完成|处理好|處理好)(?:了|啦|囉|咯)(?:[\s，,。.!！]|$)/.test(input)) return true;
  // Treat model prose as unverified when it describes a completed local action
  // with intervening objects (e.g. “已将您的主题切换到深色”).
  if (/(?:已經|已经|成功|已).{0,30}(?:打開|打开|進入|进入|切換|切换|更改|修改|改為|改为|設為|设为|設定|设置|調整|调整|開啟|开启|關閉|关闭|建立|创建|刪除|删除|啟動|启动)/.test(input)) return true;
  if (/\b(?:your|the)\s+(?:theme|language|settings?|canvas|page|downloads?)\s+(?:is|are|was|were)\s+now\b/i.test(input)) return true;
  if (/(?:已经|已經|已|我(?:已經|已经|已)?|替你|幫你|帮你|為你|为你).{0,8}(?:搞定|弄好|改好|切好|辦好|办好|生效|完成了|處理好了|处理好了)/.test(input)) return true;
  return /(?:我|助手)?(?:已经|已經|已|成功)(?:成功)?(?:为你|為你|帮你|幫你|帮您|幫您|替你|为您|為您)?(?:打开|打開|进入|進入|切换|切換|更改|修改|设置|設定|设为|設為|调整|調整|开启|開啟|关闭|關閉|创建|創建|删除|刪除|完成生成|启动|啟動)|(?:切换|切換|更改|修改|设置|設定|调整|調整|开启|開啟|关闭|關閉|操作)(?:已)?(?:完成|成功)|\b(?:i(?:['’]ve| have)|the assistant has)\s+(?:already\s+)?(?:opened|changed|switched|updated|enabled|disabled|created|deleted|started)\b|\b(?:settings?|theme|language|page)\s+(?:has|have|is|are)\s+(?:been\s+)?(?:opened|changed|updated|enabled|disabled)\b/i.test(input);
}

export type AssistantTaskStatus = "queued"|"running"|"completed"|"failed"|"stopped"|"unknown";
/** Shared interpretation; never expose the task's content or credentials. */
export function classifyAssistantTaskStatus(entry:unknown):AssistantTaskStatus {return applicationTaskSummaryStatus(entry) as AssistantTaskStatus;}
/** Counts only; never return model names, IDs, content, addresses or raw errors. */
export function summarizeAssistantTasks(input:unknown) {
  if (!Array.isArray(input)) return null;
  const counts = {queued:0, running:0, completed:0, failed:0, stopped:0, unknown:0};
  for (const entry of input) counts[classifyAssistantTaskStatus(entry)]++;
  return counts;
}
const assistantTaskFreshnessNotice = (language:string) => language === "en-US" ? " This is the last local record and may be out of date." : language === "zh-TW" ? "以上為上次本機紀錄，可能不是最新狀態。" : "以上为上次本地记录，可能不是最新状态。";
export function formatAssistantTaskSummary(input:unknown, language:string) {
  const c = summarizeAssistantTasks(input);
  if (!c) return language === "en-US" ? "The local task list is unavailable." : language === "zh-TW" ? "目前無法讀取本機任務清單。" : "目前无法读取本地任务清单。";
  if (language === "en-US") return `Local task list: ${c.queued} queued, ${c.running} running, ${c.completed} completed, ${c.failed} failed, ${c.stopped} stopped, ${c.unknown} unknown.` + assistantTaskFreshnessNotice(language);
  if (language === "zh-TW") return `本機任務清單：排隊 ${c.queued}、執行中 ${c.running}、已完成 ${c.completed}、失敗 ${c.failed}、已停止 ${c.stopped}、狀態未知 ${c.unknown}。` + assistantTaskFreshnessNotice(language);
  return `本地任务清单：排队 ${c.queued}、进行中 ${c.running}、已完成 ${c.completed}、失败 ${c.failed}、已停止 ${c.stopped}、状态未知 ${c.unknown}。` + assistantTaskFreshnessNotice(language);
}

/** A progress value belongs to a task, not to the list as a whole. */
export function formatAssistantSingleTaskProgress(input:unknown, language:string, filtered = false) {
  if (!Array.isArray(input)) return formatAssistantTaskSummary(input,language);
  if (!input.length) return language === "en-US" ? "The local task list is empty." : language === "zh-TW" ? "本機任務清單是空的。" : "本地任务清单是空的。";
  if (input.length !== 1) return language === "en-US" ? "There is more than one task. Select the task in the task list to check its progress." : language === "zh-TW" ? "目前有多個任務；請在任務清單中選擇要查看進度的任務。" : "当前有多条任务；请在任务清单中选择要查看进度的任务。";
  const task = input[0];
  if (classifyAssistantTaskStatus(task) !== "running") return formatAssistantTaskSummary(input,language);
  const value = task && typeof task === "object" ? task.progress : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return language === "en-US" ? `The only ${filtered ? "matching " : ""}task is running, but its progress is unavailable.` : language === "zh-TW" ? `${filtered ? "唯一符合條件的任務" : "唯一任務"}正在執行，但無法取得進度。` : `${filtered ? "唯一符合条件的任务" : "唯一任务"}正在进行，但无法取得进度。`;
  return language === "en-US" ? `The only ${filtered ? "matching " : ""}task is running. Recorded progress: ${value}%; this may lag behind.` : language === "zh-TW" ? `${filtered ? "唯一符合條件的任務" : "唯一任務"}正在執行，本機記錄進度為 ${value}%；資訊可能有延遲。` : `${filtered ? "唯一符合条件的任务" : "唯一任务"}正在进行，本地记录进度为 ${value}%；信息可能有延迟。`;
}

/** Unknown output types could also match, so do not guess a single task. */
export function formatAssistantTypedTaskProgress(input:unknown, category:AssistantTaskCategory, language:string) {
  if (!Array.isArray(input)) return formatAssistantTaskSummary(input,language);
  if (!input.length) return formatAssistantSingleTaskProgress(input,language);
  const known = ["image","video","audio","text"];
  const typeOf = (item:unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    const task = item as {customOutputType?:unknown;type?:unknown}, raw = task.customOutputType || task.type;
    return typeof raw === "string" ? raw.toLowerCase() : "";
  };
  if (input.some(item => !known.includes(typeOf(item)))) return language === "en-US" ? "Some task types are unknown, so I can't identify a unique matching task. Check the task list." : language === "zh-TW" ? "部分任務類型無法確認，無法可靠定位唯一符合的任務；請查看任務清單。" : "部分任务类型无法确认，无法可靠定位唯一符合的任务；请查看任务清单。";
  const matching = input.filter(item => typeOf(item) === category);
  if (!matching.length) return language === "en-US" ? "No task of that type was found in the local task list." : language === "zh-TW" ? "本機任務清單中沒有找到該類型的任務。" : "本地任务清单中没有找到该类型的任务。";
  return formatAssistantSingleTaskProgress(matching,language,true);
}

/** Unassigned records could belong to the current project, so fail closed. */
export function selectAssistantCurrentProjectTasks(input:unknown, projectId:unknown):unknown[]|null {
  if (!Array.isArray(input) || typeof projectId !== "string" || !projectId.trim()) return null;
  if (input.some(item => !item || typeof item !== "object" || Array.isArray(item) || typeof item.projectId !== "string" || !item.projectId.trim())) return null;
  return input.filter(item => item.projectId === projectId);
}

/** Only an exact current-project summary is eligible; unassigned records could
 * belong to that project and make even an apparent zero unreliable. */
export function formatAssistantCurrentProjectTasks(input:unknown, projectId:unknown, request:unknown, language:string):string|null {
  if (!Array.isArray(input) || typeof projectId !== "string" || !projectId.trim() || typeof request !== "string") return null;
  const text = request.trim().toLowerCase().replace(/[?？.!！。]+$/, "").trim();
  const zhProgress = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查询|查詢)?(?:当前|當前|目前|这个|這個|本)(?:项目|專案)(?:的)?(图片|圖片|图像|圖像|视频|視頻|影片|音频|音訊|文本|文字)?(?:任务|任務)(?:的)?(?:进度|進度)(?:(?:是)?多少|如何)?$/.exec(text.replace(/\s+/g, ""));
  const enProgress = /^(?:(?:what is|show|check) )?(?:the )?(?:current|this|active) project(?:'s)? (?:(image|video|audio|text) )?tasks? progress$/.exec(text);
  const zh = /^(?:请|請|麻烦|麻煩)?(?:帮我|幫我)?(?:查看|查询|查詢)?(?:当前|當前|目前|这个|這個|本)(?:项目|專案)(?:的)?(图片|圖片|图像|圖像|视频|視頻|影片|音频|音訊|文本|文字)?(?:任务|任務)(?:状态|狀態|情况|情況)(?:是什么|是什麼|如何)?$/.exec(text.replace(/\s+/g, ""));
  const en = /^(?:(?:what is|show|check) )?(?:the )?(?:current|this|active) project(?:'s)? (?:(image|video|audio|text) )?tasks?(?: status)?$/.exec(text);
  if (!zh && !en && !zhProgress && !enProgress) return null;
  const matching = selectAssistantCurrentProjectTasks(input,projectId);
  if (!matching) return null;
  const prefix = language === "en-US" ? "Current project — " : language === "zh-TW" ? "目前專案—" : "当前项目—";
  if (zhProgress || enProgress) {
    if (!matching.length) return language === "en-US" ? "The current project has no tasks in the local list." : language === "zh-TW" ? "本機清單中目前專案沒有任務。" : "本地清单中当前项目没有任务。";
    const category = zhProgress?.[1] || enProgress?.[1];
    return prefix + (category ? formatAssistantTypedTaskProgress(matching,projectTaskCategoryAliases[category],language) : formatAssistantSingleTaskProgress(matching,language,true));
  }
  const category = zh?.[1] || en?.[1];
  return prefix + (category ? formatAssistantTaskCategory(matching,projectTaskCategoryAliases[category],language) : formatAssistantTaskSummary(matching,language));
}

/** A missing or malformed list cannot establish an exact match. */
export function selectAssistantTasksById(input:unknown, id:string):unknown[]|null {
  if (!Array.isArray(input) || input.some(item => !item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id.trim())) return null;
  return input.filter(item => item.id === id);
}
/** Return only the selected local status, never the identifier or task content. */
export function formatAssistantTaskById(input:unknown, id:string, language:string) {
  const unavailable = language === "en-US" ? "The local task list is unavailable." : language === "zh-TW" ? "目前無法讀取本機任務清單。" : "目前无法读取本地任务清单。";
  const matches = selectAssistantTasksById(input,id);
  if (!matches) return unavailable;
  if (matches.length === 0) return language === "en-US" ? "No matching ID was found in the current local task list." : language === "zh-TW" ? "目前本機任務清單中找不到相符的編號。" : "当前本地任务清单中找不到相符的编号。";
  if (matches.length !== 1) return language === "en-US" ? "That ID matches multiple local tasks, so the status cannot be determined reliably." : language === "zh-TW" ? "該編號對應多筆本機任務，無法可靠判斷狀態。" : "该编号对应多条本地任务，无法可靠判断状态。";
  const labels:Record<AssistantTaskStatus,[string,string,string]> = {queued:["排队中","排隊中","queued"],running:["进行中","執行中","running"],completed:["已完成","已完成","completed"],failed:["失败","失敗","failed"],stopped:["已停止","已停止","stopped"],unknown:["状态未知","狀態未知","status unknown"]};
  const label = labels[classifyAssistantTaskStatus(matches[0])][language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0];
  return (language === "en-US" ? `Selected local task: ${label}.` : language === "zh-TW" ? `指定的本機任務：${label}。` : `指定的本地任务：${label}。`) + assistantTaskFreshnessNotice(language);
}

/** Explain when records excluded from type filtering could change the answer. */
export function assistantUnknownTaskTypeNotice(input:unknown, language:string) {
  if (!Array.isArray(input)) return "";
  const count = input.filter(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const raw = item.customOutputType || item.type;
    return typeof raw !== "string" || !["image","video","audio","text"].includes(raw.toLowerCase());
  }).length;
  if (!count) return "";
  return language === "en-US" ? ` ${count} task(s) have an unrecognized type and may also belong to this category; check the task list.` : language === "zh-TW" ? `另有 ${count} 筆任務的類型無法識別，可能也屬於此類，請查看任務清單。` : `另有 ${count} 条任务的类型无法识别，可能也属于此类，请查看任务清单。`;
}

/** Filter by recognized output type only; disclose the excluded records. */
export function formatAssistantTaskCategory(input:unknown, category:AssistantTaskCategory, language:string) {
  if (!Array.isArray(input)) return formatAssistantTaskSummary(input,language);
  const filtered = input.filter(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const raw = item.customOutputType || item.type;
    return typeof raw === "string" && raw.toLowerCase() === category;
  });
  const labels:Record<AssistantTaskCategory,[string,string,string]> = {image:["图片","圖片","Image"],video:["视频","影片","Video"],audio:["音频","音訊","Audio"],text:["文本","文字","Text"]};
  const name = labels[category][language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0];
  const prefix = language === "en-US" ? `${name} tasks (recognized types only): ` : language === "zh-TW" ? `${name}任務（僅統計可識別類型）：` : `${name}任务（仅统计可识别类型）：`;
  return prefix + formatAssistantTaskSummary(filtered,language) + assistantUnknownTaskTypeNotice(input,language);
}

/** Different timestamp scales cannot be safely compared: persisted records
 * can contain epoch seconds, epoch milliseconds, or non-epoch test/order
 * values. ISO timestamps have millisecond precision. Never infer a unit from
 * another record or silently choose the largest raw number across scales. */
export function selectLatestAssistantTask<T extends {createdAt?:unknown}>(items:T[]):T|null {return selectLatestApplicationTask(items) as T|null;}

/** The latest task is selected only when creation order is unambiguous. */
export function formatAssistantLatestTask(input:unknown, language:string) {
  const unavailable = language === "en-US" ? "The local task list is unavailable." : language === "zh-TW" ? "目前無法讀取本機任務清單。" : "目前无法读取本地任务清单。";
  const empty = language === "en-US" ? "The local task list is empty." : language === "zh-TW" ? "本機任務清單是空的。" : "本地任务清单是空的。";
  const uncertain = language === "en-US" ? "I cannot reliably determine the most recently created task. Check the task list." : language === "zh-TW" ? "無法可靠判斷最近建立的是哪個任務，請查看任務清單。" : "无法可靠判断最近创建的是哪条任务，请查看任务清单。";
  if (!Array.isArray(input)) return unavailable;
  if (!input.length) return empty;
  if (input.some(item => !item || typeof item !== "object" || Array.isArray(item))) return uncertain;
  const latest = selectLatestAssistantTask(input);
  if (!latest) return uncertain;
  const counts = summarizeAssistantTasks([latest])!;
  const key = (Object.keys(counts) as Array<keyof typeof counts>).find(name => counts[name] === 1) || "unknown";
  const labels:Record<keyof typeof counts,[string,string,string]> = {queued:["排队中","排隊中","queued"],running:["进行中","執行中","running"],completed:["已完成","已完成","completed"],failed:["失败","失敗","failed"],stopped:["已停止","已停止","stopped"],unknown:["状态未知","狀態未知","unknown"]};
  const label = labels[key][language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0];
  return (language === "en-US" ? `Most recently created task: ${label}.` : language === "zh-TW" ? `最近建立的任務：${label}。` : `最近创建的任务：${label}。`) + assistantTaskFreshnessNotice(language);
}
