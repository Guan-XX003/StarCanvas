import { assistantThemes, assistantLanguages, type AssistantTheme, type AssistantLanguage } from "./assistant-preferences";
import {applicationTaskDiagnostic} from '../../../electron/shared/application-task-data.mjs';
import { summarizeAssistantTasks, selectAssistantTasksById, selectLatestAssistantTask, formatAssistantTaskById, classifyAssistantTaskStatus, assistantUnknownTaskTypeNotice, type AssistantTaskCategory } from "./assistant-local-operations";
const sensitiveParameter = /(?:^|[_-])(?:api[_-]?key|key|access[_-]?token|auth(?:orization)?|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)(?:$|[_-])/i;

/** Enqueuing a React canvas update is not proof that a node is rendered. */
export function assistantNodeSubmissionNotice(language:string) {
  return language === "en-US" ? "Node creation requested. Check the canvas to confirm; nothing was generated." : language === "zh-TW" ? "已提交建立節點的請求，請在畫布確認；未執行生成。" : "已提交创建节点的请求，请在画布确认；未执行生成。";
}

/** A callback can fail after a state update has already been requested. */
export function assistantPreferenceUncertainNotice(language:string) {
  return language === "en-US" ? "Could not confirm the setting. It may have changed; check settings before trying again." : language === "zh-TW" ? "無法確認設定結果；設定可能已變更，請檢查後再試。" : "无法确认设置结果；设置可能已更改，请检查后再试。";
}

function hasSensitiveUrlParameters(url: URL) {
  const sensitiveValue = (value:string) => {
    let candidate = value;
    for (let i=0;i<3;i++) {
      if (/\bhttps?:\/\/[^\s/@]+@/i.test(candidate)) return true;
      if (/[?&#](?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|key|access[_-]?token|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)=/i.test(candidate)) return true;
      try { const decoded = decodeURIComponent(candidate); if (decoded === candidate) break; candidate = decoded; }
      catch { break; }
    }
    return false;
  };
  for (const [key,value] of url.searchParams) if (sensitiveParameter.test(key) || sensitiveValue(value)) return true;
  const fragment = url.hash.slice(1);
  const fragmentParams = new URLSearchParams(fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment);
  for (const [key,value] of fragmentParams) if (sensitiveParameter.test(key) || sensitiveValue(value)) return true;
  return false;
}

/** Decisions for the local onboarding UI; these helpers do not store credentials. */
export function shouldOfferAssistantOnboarding(ready: boolean, checked: boolean, seen: boolean, hasConfiguration: boolean) {
  return ready && !checked && !seen && !hasConfiguration;
}

export function normalizeAssistantDocumentationUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    // This early UI guard is not a network security boundary: public names can
    // resolve or redirect to private hosts. Do not claim it prevents SSRF.
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /^\[.*\]$/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid)$/.test(host)) return "";
    if (hasSensitiveUrlParameters(url)) return "";
    return url.href;
  } catch { return ""; }
}

/** Only build a prefill handoff; never import credentials or apply settings. */
export function buildAssistantButlerHandoff(docUrl: string, modelInput: string, categoryInput: string) {
  const url = normalizeAssistantDocumentationUrl(docUrl);
  if (!url) return {ok:false as const, field:"url" as const};
  const model = modelInput.trim();
  const category = categoryInput.trim();
  if (model.length > 256 || /[\u0000-\u001f\u007f]/.test(model) || /\b(?:bearer\s+|sk-[A-Za-z0-9_-]{12,})/i.test(model)) return {ok:false as const, field:"model" as const};
  if ((!model && category) || (model && !category) || (category && !["image", "video"].includes(category))) return {ok:false as const, field:"pair" as const};
  return {ok:true as const, url, ...(model ? {model, category:category as "image"|"video"} : {})};
}

/** The target address is disclosed to the model, but is not fetched here. */
export function assistantCanDiscloseTargetUrl(input: string) {
  try {
    const url = new URL(input.trim());
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !hasSensitiveUrlParameters(url);
  } catch { return false; }
}

/** Best-effort removal of common credential shapes, not a secret scanner. */
export function redactAssistantDocumentation(input: string) {
  return String(input || "")
    .replace(/(\bhttps?:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+(["'])[^\r\n]*?\1/gi, "Bearer [REDACTED]")
    // Stop at the header's closing quote so a one-line curl example keeps
    // later -d/--data arguments. Unquoted values remain redacted to line end.
    .replace(/(\b(?:authorization|x-api-key|api-key)\s*:\s*)[^\s"'\r\n][^"'\r\n]*/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s"'`,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED_API_KEY]")
    .replace(/((?:[?&#]|%3f|%26|%23)(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|key|access[_-]?token|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)(?:=|%3d))(?:(?!%26|%23)[^&#\s"'])+/gi, "$1[REDACTED]")
    .replace(/((?:["']?(?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd|authorization)["']?)\s*[:=]\s*["'])[^"'\n]+(["'])/gi, "$1[REDACTED]$2")
    .replace(/(\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|pwd)\s*[:=]\s*)(?!["'])[^\s,;}]+/gi, "$1[REDACTED]");
}

export type AssistantNavigationAction = "open_api_settings" | "open_model_settings" | "open_agents" | "open_resources" | "open_canvas" | "open_workspace" | "open_account_settings" | "open_appearance_settings" | "open_settings" | "open_generation_settings";
export type AssistantCanvasAction = "create_text_node" | "create_image_node" | "create_video_node";
export type AssistantAction = AssistantNavigationAction | AssistantCanvasAction;
export type AssistantPreferenceProposal = {kind:"theme"; value:AssistantTheme} | {kind:"language"; value:AssistantLanguage} | {kind:"autoDownload"; value:boolean};
export type AssistantMessage = {role:"user"|"assistant"|"notice"; text:string; action?:AssistantAction|null; preference?:AssistantPreferenceProposal|null; draft?:string; actionProjectId?:string; actionProjectName?:string; modelReply?:boolean; incomplete?:boolean;proposalExpired?:boolean; executionStatus?:"confirmed"|"unconfirmed"|"rejected"; attachments?:any[];generationTask?:{version:1;projectId:string;nodeId:string;submissionId:string}};

/** Validate at both the model boundary and the eventual confirmation click. */
export function isValidAssistantPreferenceProposal(value:unknown):value is AssistantPreferenceProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proposal = value as Record<string,unknown>;
  if (Object.keys(proposal).length !== 2 || !Object.hasOwn(proposal,"kind") || !Object.hasOwn(proposal,"value")) return false;
  return (proposal.kind === "theme" && typeof proposal.value === "string" && Object.hasOwn(assistantThemes,proposal.value))
    || (proposal.kind === "language" && typeof proposal.value === "string" && Object.hasOwn(assistantLanguages,proposal.value))
    || (proposal.kind === "autoDownload" && typeof proposal.value === "boolean");
}

export const ASSISTANT_LAUNCHER_POSITION_KEY = "wanjuan.assistant-launcher.v1.position";
type AssistantLauncherPosition = {x:number;y:number};
function validLauncherPosition(value:unknown):value is AssistantLauncherPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string,unknown>;
  return Object.keys(point).length === 2 && typeof point.x === "number" && Number.isFinite(point.x) && point.x >= 0
    && typeof point.y === "number" && Number.isFinite(point.y) && point.y >= 0;
}
/** Only two local coordinates are saved; unavailable storage is non-fatal. */
export function readAssistantLauncherPosition(storage:Pick<Storage,"getItem">):AssistantLauncherPosition|null {
  try { const value = JSON.parse(storage.getItem(ASSISTANT_LAUNCHER_POSITION_KEY) || "null"); return validLauncherPosition(value) ? value : null; }
  catch { return null; }
}
export function writeAssistantLauncherPosition(storage:Pick<Storage,"setItem">, position:AssistantLauncherPosition):void {
  if (!validLauncherPosition(position)) return;
  try { storage.setItem(ASSISTANT_LAUNCHER_POSITION_KEY, JSON.stringify({x:position.x,y:position.y})); } catch { /* The launcher remains usable without persistence. */ }
}

/** Keep the launcher reachable within its clipped workspace, including resize. */
export function clampAssistantLauncherPosition(position:{x:number;y:number}, parent:{width:number;height:number}, launcher:{width:number;height:number}) {
  return {
    x:Math.max(0, Math.min(position.x, Math.max(0, parent.width - launcher.width))),
    y:Math.max(0, Math.min(position.y, Math.max(0, parent.height - launcher.height))),
  };
}

/** Provenance comes from the local message envelope, not model-supplied text. */
export function assistantMessageOrigin(item:AssistantMessage):"model"|"proposal"|"confirmed"|"unconfirmed"|"rejected"|"local" {
  return item.modelReply ? "model" : item.action || item.preference ? "proposal" : item.executionStatus || "local";
}
export function assistantMessageOriginLabel(origin:"model"|"proposal"|"confirmed"|"unconfirmed"|"rejected"|"local", language:string) {
  if (origin === "model") return language === "en-US" ? "Model reply · No app action was performed; check app feedback for results." : language === "zh-TW" ? "模型回答 · 未執行軟體操作；操作結果以軟體回饋為準。" : "模型回答 · 未执行软件操作；操作结果以软件反馈为准。";
  if (origin === "proposal") return language === "en-US" ? "Suggested action · Awaiting confirmation" : language === "zh-TW" ? "建議操作 · 等待確認" : "建议操作 · 等待确认";
  if (origin === "confirmed") return language === "en-US" ? "App action · Confirmed" : language === "zh-TW" ? "軟體操作 · 已確認" : "软件操作 · 已确认";
  if (origin === "unconfirmed") return language === "en-US" ? "App action · Result unconfirmed" : language === "zh-TW" ? "軟體操作 · 結果未確認" : "软件操作 · 结果未确认";
  if (origin === "rejected") return language === "en-US" ? "App action · Not performed" : language === "zh-TW" ? "軟體操作 · 未執行" : "软件操作 · 未执行";
  return language === "en-US" ? "App feedback" : language === "zh-TW" ? "軟體回饋" : "软件反馈";
}

/** Only the immediately preceding message can supply a receipt; pending user
 * turns, model prose, proposals and ordinary feedback are never skipped. */
export function assistantLastOperationReceipt(messages:AssistantMessage[], language:string):string {
  const item=messages[messages.length - 1];
  const unavailable=language === "en-US" ? "I cannot identify a verified result for the immediately preceding assistant response. Please specify the operation or check the current setting." : language === "zh-TW" ? "無法從上一則助手回覆確認操作結果；請具體說明操作或檢查目前設定。" : "无法从上一条助手回复确认操作结果；请具体说明操作或检查当前设置。";
  if (!item || item.role !== "assistant" || item.modelReply || item.action || item.preference || item.proposalExpired || !item.executionStatus) return unavailable;
  const prefix=language === "en-US" ? "Previous app receipt (at that time; the current state may differ): " : language === "zh-TW" ? "上一則軟體回執（僅代表當時結果，目前狀態可能不同）：" : "上一条软件回执（仅代表当时结果，当前状态可能不同）：";
  return prefix + item.text;
}

/** A confirmed proposal is consumed immediately; the later local receipt is
 * the only authority for whether the destination actually opened. */
export function consumeAssistantNavigationProposal(messages:AssistantMessage[], proposalIndex:number, language:string):AssistantMessage[] {
  const text = language === "en-US" ? "Suggestion confirmed; see the result or error below." : language === "zh-TW" ? "建議已確認，請查看下方結果或錯誤提示。" : "建议已确认，请查看下方结果或错误提示。";
  return messages.map((item,index) => index === proposalIndex && item.action?.startsWith("open_") ? {...item, action:null, text} : item);
}
export function assistantNavigationUnconfirmedNotice(language:string) {
  return language === "en-US" ? "Could not confirm that the page opened. Check the current page before trying again." : language === "zh-TW" ? "無法確認頁面已開啟；請檢查目前頁面後再重試。" : "无法确认页面已打开；请检查当前页面后再重试。";
}
/** The app navigation callback returns false only before it mutates the view. */
export function assistantNavigationRejectedNotice(language:string) {
  return language === "en-US" ? "The page is unavailable or restricted. No navigation was performed." : language === "zh-TW" ? "此頁面目前不可用或受到限制，沒有執行跳轉。" : "此页面当前不可用或受到限制，没有执行跳转。";
}
export function assistantNodeUncertainNotice(language:string) {
  return language === "en-US" ? "Could not confirm node creation. It may have been submitted; check the original canvas before trying again." : language === "zh-TW" ? "無法確認節點是否已建立，請先檢查原畫布，再決定是否重試。" : "无法确认节点是否已创建，请先检查原画布，再决定是否重试。";
}

/** Old messages stay visible, but old actionable suggestions cannot be reused
 * after the model's private conversation context has been discarded. */
export function clearAssistantProposals(messages: AssistantMessage[]): AssistantMessage[] {
  return messages.map(item => item.action || item.preference ? {...item, ...(item.action ? {action:null} : {}), ...(item.preference ? {preference:null} : {}), proposalExpired:true} : item);
}
export function markAssistantSessionBoundary(messages: AssistantMessage[], notice: string): AssistantMessage[] {
  const cleared = clearAssistantProposals(messages);
  const last = cleared[cleared.length - 1];
  return last?.role === "notice" && last.text === notice ? cleared : [...cleared, {role:"notice", text:notice}];
}

/** Best-effort gate for common credential shapes, not comprehensive DLP. */
export function containsLikelyAssistantSecret(value:unknown):boolean {
  if (typeof value !== "string") return false;
  // Compare a normalized copy only; never transform the message or draft.
  let candidate = value.normalize("NFKC").replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "");
  for (let i=0; i<2; i++) {
    candidate = candidate.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
      try { return decodeURIComponent(encoded); }
      catch { return encoded.replace(/%([0-7][0-9a-f])/gi, (_, hex) => String.fromCharCode(parseInt(hex,16))); }
    }).normalize("NFKC").replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, "");
  }
  return /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/i.test(candidate)
    || /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(candidate)
    || /\bauthorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/i.test(candidate)
    || /\b(?:https?|wss?):\/\/[^\s/@]+@[^\s/]+/i.test(candidate)
    || /(?:[?&#](?:password|passwd|pwd)=)[^&#\s"']+/i.test(candidate)
    || /(?:\b(?:password|passwd|pwd)\b|密码|密碼)["']?\s*[:=：]\s*["']?[A-Za-z0-9!@#$%^&*._~+/=-]+/i.test(candidate)
    || /(?:[?&#](?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|key|access[_-]?token|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)=)[^&#\s"']+/i.test(candidate)
    || /(?:["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)["']?)\s*[:=]\s*["']?[^\s"',;}]{12,}/i.test(candidate);
}

export function isValidAssistantNodeContent(content: unknown): content is string {
  return typeof content === "string" && content.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content) && !containsLikelyAssistantSecret(content);
}

/** Fixed, non-sensitive explanations for failures crossing the assistant IPC. */
export function assistantButlerFailureMessage(code: unknown, language: string) {
  const messages: Record<string, [string, string, string]> = {
    ASSISTANT_BUSY:["主智能体正在处理其他请求，请稍后再试。","主智慧助手正在處理其他請求，請稍後再試。","The assistant is handling another request. Try again shortly."],
    ASSISTANT_KEY_REQUIRED:["请先登录 DeepSeek 账号或配置主智能体 API Key。","請先登入 DeepSeek 帳號或設定主智慧助手 API Key。","Sign in to DeepSeek or configure an assistant API key first."],
    ASSISTANT_PROVIDER_AUTH:["DeepSeek 拒绝了凭据或访问权限，请检查 Key 或重新授权账号。","DeepSeek 拒絕憑證或存取權限，請檢查 Key 或重新授權帳號。","DeepSeek rejected access. Check the key or reauthorize the account."],
    ASSISTANT_PROVIDER_QUOTA:["DeepSeek 报告余额或额度不足，请到官方平台核对。","DeepSeek 回報餘額或額度不足，請至官方平台確認。","DeepSeek reported insufficient balance or quota."],
    ASSISTANT_PROVIDER_RATE_LIMIT:["DeepSeek 暂时限流，请稍后手动重试。","DeepSeek 暫時限流，請稍後手動重試。","DeepSeek is rate-limiting requests. Retry later."],
    ASSISTANT_RUNTIME_NOT_INSTALLED:["当前设备缺少主智能体运行时，请更新应用。","目前裝置缺少主智慧助手執行環境，請更新應用程式。","The assistant runtime is missing. Update the app."],
    ASSISTANT_CANCELLED:["主智能体分析已取消。","主智慧助手分析已取消。","Assistant analysis was cancelled."],
    ASSISTANT_SENSITIVE_INPUT:["文档或模型信息可能包含凭据，已停止发送；请移除后重试。","文件或模型資訊可能包含憑證，已停止傳送；請移除後重試。","The documentation or model information may contain a credential. Nothing was sent; remove it before retrying."],
  };
  const fallback: [string,string,string] = ["主智能体分析未完成，请检查网络和助手状态后重试。","主智慧助手分析未完成，請檢查網路及助手狀態後重試。","Assistant analysis did not complete. Check the network and assistant status."];
  const entry = typeof code === "string" && Object.hasOwn(messages, code) ? messages[code] : fallback;
  return entry[language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0];
}

/** UI copy comes from a fixed allowlist; never display provider error text. */
export function assistantChatFailureMessage(code: unknown, language: string, options:{retainedHistory?:boolean} = {}) {
  const zh = {
    ASSISTANT_PROVIDER_AUTH:"上游拒绝了凭据或访问权限，请检查 Key 和账号权限。",
    ASSISTANT_PROVIDER_QUOTA:"上游报告余额或额度不足，请到官方平台核对。",
    ASSISTANT_PROVIDER_RATE_LIMIT:"上游暂时限流，请稍后重试。",
    ASSISTANT_PROVIDER_SERVER:"上游服务暂时不可用，请稍后重试。",
    ASSISTANT_PROVIDER_TIMEOUT:"上游响应超时，请检查网络后重试。",
    ASSISTANT_PROVIDER_NETWORK:"无法连接上游，请检查网络和代理设置。",
    ASSISTANT_STREAM_INCOMPLETE:"回复未完整收到，已接收部分会保留并标记；不会自动重试。",
    ASSISTANT_STREAM_LIMIT:"回复超过安全长度限制，已停止接收；不会自动重试。",
    ASSISTANT_RUNTIME_TIMEOUT:"助手运行超时，请检查网络后重试。",
    ASSISTANT_KEY_REQUIRED:"请先配置主智能体 API Key。",
    ASSISTANT_ROLE_KEY_REQUIRED:"所选角色的 API 配置缺少 Key，请检查角色绑定。",
    ASSISTANT_API_REQUIRED:"找不到角色绑定的 API 配置，请在角色设置中重新选择。",
    ASSISTANT_MODEL_REQUIRED:"请先为角色选择模型。",
    ASSISTANT_PROTOCOL_UNSUPPORTED:"此角色的请求协议尚不支持，请检查模型绑定。",
    ASSISTANT_VIDEO_UNSUPPORTED:"所选协议不能传递视频内容，请使用已支持视频输入的协议。",
    ASSISTANT_DOCUMENT_UNSUPPORTED:"此类聊天附件尚不支持，请先通过角色知识库导入文本内容。",
    ASSISTANT_MEDIA_UNAVAILABLE:"参考素材无法读取，本次未发送模型请求。",
    ASSISTANT_MEDIA_UNSUPPORTED:"此附件格式尚不支持，请选择 PNG、JPEG、GIF、WebP 图片或 MP4、MOV、WebM 视频。",
    ASSISTANT_MEDIA_LIMIT:"附件超过限制：最多 6 个，单个 32 MiB，合计 96 MiB；已添加的附件仍保留。",
    ASSISTANT_MEDIA_INVALID:"附件无效，请重新选择本地媒体文件。",
    ASSISTANT_MEDIA_MISSING:"已保存的附件缺失，请重新选择文件；未发送模型请求。",
    ASSISTANT_MEDIA_CORRUPT:"附件完整性校验失败，原记录已保留；未发送模型请求。",
    ASSISTANT_MEDIA_SCOPE:"不能访问其他会话或已结束任务的附件。",
    ASSISTANT_PROVIDER_REQUEST:"模型请求参数不兼容或请求失败，请检查 API、模型和协议。",
    ASSISTANT_QUEUE_FULL:"会话排队已满，请等现有任务结束后再发送。",
  } as const;
  const tw = {
    ASSISTANT_PROVIDER_AUTH:"上游拒絕憑證或存取權限，請檢查 Key 和帳號權限。",
    ASSISTANT_PROVIDER_QUOTA:"上游回報餘額或額度不足，請至官方平台確認。",
    ASSISTANT_PROVIDER_RATE_LIMIT:"上游暫時限流，請稍後重試。",
    ASSISTANT_PROVIDER_SERVER:"上游服務暫時無法使用，請稍後重試。",
    ASSISTANT_PROVIDER_TIMEOUT:"上游回應逾時，請檢查網路後重試。",
    ASSISTANT_PROVIDER_NETWORK:"無法連線上游，請檢查網路和代理設定。",
    ASSISTANT_STREAM_INCOMPLETE:"回覆未完整收到，會保留並標記已接收部分；不會自動重試。",
    ASSISTANT_STREAM_LIMIT:"回覆超過安全長度限制，已停止接收；不會自動重試。",
    ASSISTANT_RUNTIME_TIMEOUT:"助手執行逾時，請檢查網路後重試。",
    ASSISTANT_KEY_REQUIRED:"請先設定主智慧助手 API Key。",
    ASSISTANT_ROLE_KEY_REQUIRED:"所選角色的 API 設定缺少金鑰，請檢查角色綁定。",
    ASSISTANT_API_REQUIRED:"找不到角色綁定的 API 設定，請在角色設定中重新選擇。",
    ASSISTANT_MODEL_REQUIRED:"請先為角色選擇模型。",
    ASSISTANT_PROTOCOL_UNSUPPORTED:"此角色的請求協定尚不支援，請檢查模型綁定。",
    ASSISTANT_VIDEO_UNSUPPORTED:"所選協定無法傳遞影片內容，請使用已支援影片輸入的協定。",
    ASSISTANT_DOCUMENT_UNSUPPORTED:"此類對話附件尚不支援，請先透過角色知識庫匯入文字內容。",
    ASSISTANT_MEDIA_UNAVAILABLE:"參考素材無法讀取，本次未傳送模型請求。",
    ASSISTANT_MEDIA_UNSUPPORTED:"此附件格式尚不支援，請選擇 PNG、JPEG、GIF、WebP 圖片或 MP4、MOV、WebM 影片。",
    ASSISTANT_MEDIA_LIMIT:"附件超過限制：最多 6 個，單檔 32 MiB，合計 96 MiB；已加入的附件仍保留。",
    ASSISTANT_MEDIA_INVALID:"附件無效，請重新選擇本機媒體檔案。",
    ASSISTANT_MEDIA_MISSING:"已儲存的附件遺失，請重新選擇檔案；未傳送模型請求。",
    ASSISTANT_MEDIA_CORRUPT:"附件完整性檢查失敗，原紀錄已保留；未傳送模型請求。",
    ASSISTANT_MEDIA_SCOPE:"無法存取其他對話或已結束任務的附件。",
    ASSISTANT_PROVIDER_REQUEST:"模型請求參數不相容或請求失敗，請檢查 API、模型與協定。",
    ASSISTANT_QUEUE_FULL:"對話排隊已滿，請等目前任務結束後再傳送。",
  } as const;
  const en = {
    ASSISTANT_PROVIDER_AUTH:"The provider rejected the credential or access. Check your key and account permissions.",
    ASSISTANT_PROVIDER_QUOTA:"The provider reported insufficient balance or quota. Check the official platform.",
    ASSISTANT_PROVIDER_RATE_LIMIT:"The provider is rate-limiting requests. Try again later.",
    ASSISTANT_PROVIDER_SERVER:"The provider is temporarily unavailable. Try again later.",
    ASSISTANT_PROVIDER_TIMEOUT:"The provider timed out. Check your network before retrying.",
    ASSISTANT_PROVIDER_NETWORK:"Could not reach the provider. Check your network and proxy settings.",
    ASSISTANT_STREAM_INCOMPLETE:"The reply was incomplete. The received portion is kept and marked; nothing is retried automatically.",
    ASSISTANT_STREAM_LIMIT:"The reply exceeded the safe length limit. Receiving stopped; nothing is retried automatically.",
    ASSISTANT_RUNTIME_TIMEOUT:"The assistant timed out. Check your network before retrying.",
    ASSISTANT_KEY_REQUIRED:"Configure the assistant API key first.",
    ASSISTANT_ROLE_KEY_REQUIRED:"The role's API configuration has no key. Check its binding.",
    ASSISTANT_API_REQUIRED:"The role's API configuration is missing. Select it again in role settings.",
    ASSISTANT_MODEL_REQUIRED:"Select a model for this role first.",
    ASSISTANT_PROTOCOL_UNSUPPORTED:"This role's request protocol is not supported. Check its model binding.",
    ASSISTANT_VIDEO_UNSUPPORTED:"The selected protocol cannot transmit video content. Select a supported video-input protocol.",
    ASSISTANT_DOCUMENT_UNSUPPORTED:"This chat attachment format is not supported. Import its text through role knowledge first.",
    ASSISTANT_MEDIA_UNAVAILABLE:"The reference could not be read. No model request was sent.",
    ASSISTANT_MEDIA_UNSUPPORTED:"Unsupported attachment. Select PNG, JPEG, GIF, WebP images or MP4, MOV, WebM video.",
    ASSISTANT_MEDIA_LIMIT:"Attachment limit: 6 files, 32 MiB each, 96 MiB total. Files already added are retained.",
    ASSISTANT_MEDIA_INVALID:"Invalid attachment. Select a local media file again.",
    ASSISTANT_MEDIA_MISSING:"A saved attachment is missing. Select it again; no model request was sent.",
    ASSISTANT_MEDIA_CORRUPT:"Attachment integrity verification failed. The original record was retained; no model request was sent.",
    ASSISTANT_MEDIA_SCOPE:"Attachments from another conversation or a finished task cannot be accessed.",
    ASSISTANT_PROVIDER_REQUEST:"The model request failed or its parameters were incompatible. Check the API, model and protocol.",
    ASSISTANT_QUEUE_FULL:"The conversation queue is full. Wait for current tasks before sending again.",
  } as const;
  const entries = language === "en-US" ? en : language === "zh-TW" ? tw : zh;
  const fallback = language === "en-US" ? "The assistant could not complete the request." : language === "zh-TW" ? "助手暫時無法完成請求。" : "助手暂时无法完成请求。";
  const text = typeof code === "string" && Object.hasOwn(entries, code) ? entries[code as keyof typeof zh] : fallback;
  const retained=language==='en-US'?'Completed history is retained. Nothing was automatically retried; requests already sent may still be charged.':language==='zh-TW'?'已完成的歷史仍保留，本次沒有自動重試；已傳送的請求仍可能計費。':'已完成的历史仍保留，本次没有自动重试；已发出的请求仍可能计费。';
  return `${text} ${options.retainedHistory ? retained : language === "en-US" ? "The session was reset. A request already sent may still be charged; retry manually if needed." : language === "zh-TW" ? "對話已重設；已送出的請求仍可能計費，請自行決定是否重試。" : "对话已重置；已发出的请求仍可能计费，请自行决定是否重试。"}`;
}

/** Model output is untrusted: recognize only a final allowlisted navigation
 * suggestion. The caller must still wait for an explicit user click. */
export function parseAssistantReply(input: string): { text: string; action: AssistantAction | null; preference?:AssistantPreferenceProposal; draft?: string; invalidProtocol?:boolean } {
  const text = String(input || "");
  // A response may contain only one well-formed control marker. Treat a
  // malformed, unknown, or mixed marker as an invalid proposal rather than
  // displaying its untrusted text as an ordinary answer or accepting its tail.
  const markerCount = (text.match(/\[\[STARCANVAS_/g) || []).length;
  const invalid = () => ({text:"", action:null, invalidProtocol:true as const});
  if (markerCount > 1) return invalid();
  // Untrusted model output can only propose an allowlisted change, never apply it.
  const preferenceMatch = text.match(/(?:^|\n)\[\[STARCANVAS_PREFERENCE:(\{[^\r\n]{0,300}\})\]\]\s*$/);
  if (preferenceMatch && preferenceMatch.index !== undefined) {
    try {
      const proposal = JSON.parse(preferenceMatch[1]);
      const visible = text.slice(0, preferenceMatch.index).trimEnd();
      if (visible && isValidAssistantPreferenceProposal(proposal)) {
        // The rendered label and click handler share this object. Keep its
        // primitive values immutable so a later mutation cannot change what
        // the user is actually confirming without a React update.
        return {text:visible, action:null, preference:Object.freeze(proposal)};
      }
    } catch { /* Invalid proposals remain inert text. */ }
  }
  // The model is untrusted. Only a final single-line JSON object with exactly
  // these two fields may become an editable, user-confirmed node proposal.
  const nodeMatch = text.match(/(?:^|\n)\[\[STARCANVAS_NODE:(\{[^\r\n]{0,12000}\})\]\]\s*$/);
  if (nodeMatch && nodeMatch.index !== undefined) {
    try {
      const node = JSON.parse(nodeMatch[1]);
      const visible = text.slice(0, nodeMatch.index).trimEnd();
      const actions = {text:"create_text_node", image:"create_image_node", video:"create_video_node"} as const;
      if (visible && node && typeof node === "object" && !Array.isArray(node)
        && Object.keys(node).length === 2 && Object.hasOwn(node, "type") && Object.hasOwn(node, "content")
        && typeof node.type === "string" && Object.hasOwn(actions, node.type)
        && isValidAssistantNodeContent(node.content)) {
        return {text:visible, action:actions[node.type as keyof typeof actions], draft:node.content};
      }
    } catch { /* Invalid proposals remain plain text, never executable. */ }
  }
  const match = text.match(/(?:^|\n)\[\[STARCANVAS_ACTION:(open_api_settings|open_model_settings|open_agents|open_resources|open_canvas|open_workspace|open_account_settings|open_appearance_settings|open_settings|open_generation_settings|create_text_node|create_image_node|create_video_node)\]\]\s*$/);
  if (!match || match.index === undefined) return markerCount ? invalid() : { text, action: null };
  const visible = text.slice(0, match.index).trimEnd();
  // Never create an unexplained button from a response that contains no text.
  return visible ? { text: visible, action: match[1] as AssistantAction } : invalid();
}

/** Reduce task records to allowlisted metadata before either display or model handoff. */
function reduceAssistantFailure(tasks: unknown) {
  if (!Array.isArray(tasks)) return {state:"none" as const};
  // Unknown or contradictory records may themselves represent failures. Do
  // not assert there are none, or select a supposedly latest/only failure,
  // until all records in the chosen scope have recognizable status.
  if (summarizeAssistantTasks(tasks)?.unknown) return {state:"status_uncertain" as const};
  const failures = tasks.filter(item => item && typeof item === "object" && typeof item.status === "string" && item.status.toLowerCase() === "failed" && item.stoppedByUser !== true);
  if (!failures.length) return {state:"none" as const};
  const failed = selectLatestAssistantTask(failures);
  if (!failed) return {state:"uncertain" as const};
  // Global tasks use customOutputType for universal-node output; prefer it in
  // the same order as the task list, but expose only known coarse categories.
  const rawOutputType = failed.customOutputType || failed.type;
  const outputType = typeof rawOutputType === "string" ? rawOutputType.toLowerCase() : "";
  const type = ["text", "image", "video", "audio", "music"].includes(outputType) ? outputType : "other";
  const {status,kind}=applicationTaskDiagnostic(failed)!;
  return {state:"found" as const,type,status,kind,onlyFailure:failures.length === 1};
}

/** Construct a deliberately minimal, editable diagnostic prompt. Never include
 * the original error text, prompts, URLs, model names, IDs, or media paths. */
export function buildAssistantFailureSummary(tasks: unknown, language: string,scope:'list'|'selected'='list') {
  const reduced = reduceAssistantFailure(tasks);
  if (reduced.state !== "found") return "";
  const {type,status,kind} = reduced;
  if(scope==='selected'){
    if(language==='en-US')return `Please diagnose this failed task using only this limited summary. This is the task I selected, not the latest task. Do not assume unprovided details.\nTask type: ${type}\nHTTP status: ${status}\nPossible error category: ${kind}\nSuggest safe checks before any changes.`;
    if(language==='zh-TW')return `請依據以下有限摘要協助排查失敗任務；這是我指定的任務，並非自動選取的最近任務。不要臆測未提供的細節。\n任務類型：${type}\nHTTP 狀態碼：${status}\n可能的錯誤類別：${kind}\n請先提供安全的檢查步驟。`;
    return `请根据以下有限摘要协助排查失败任务；这是我指定的任务，并非自动选取的最近任务。不要臆测未提供的细节。\n任务类型：${type}\nHTTP 状态码：${status}\n可能的错误类别：${kind}\n请先提供安全的检查步骤。`;
  }
  if (language === "en-US") return `Please diagnose this failed task using only this limited summary. When several failures exist, it is selected by creation time, not failure time. Do not assume unprovided details.\nTask type: ${type}\nHTTP status: ${status}\nPossible error category: ${kind}\nSuggest safe checks before any changes.`;
  if (language === "zh-TW") return `請依據以下有限摘要協助排查失敗任務；有多條失敗記錄時按建立時間選取，並非失敗時間。不要臆測未提供的細節。\n任務類型：${type}\nHTTP 狀態碼：${status}\n可能的錯誤類別：${kind}\n請先提供安全的檢查步驟。`;
  return `请根据以下有限摘要协助排查失败任务；有多条失败记录时按创建时间选取，并非失败时间。不要臆测未提供的细节。\n任务类型：${type}\nHTTP 状态码：${status}\n可能的错误类别：${kind}\n请先提供安全的检查步骤。`;
}

/** Keep a user-inserted diagnostic draft identifiable while it is edited.
 * This only affects routing after the explicit insert-summary button is used. */
export function isAssistantDiagnosticDraft(text:unknown) {
  if (typeof text !== "string") return false;
  if (/请根据以下有限摘要协助排查失败任务|請依據以下有限摘要協助排查失敗任務|Please diagnose this failed task using only this limited summary/i.test(text)) return true;
  const labels = [/(?:任务类型|任務類型|Task type)\s*[:：]/i, /HTTP\s*(?:状态码|狀態碼|status)\s*[:：]/i, /(?:可能的错误类别|可能的錯誤類別|Possible error category)\s*[:：]/i];
  return labels.filter(label => label.test(text)).length >= 2;
}

/** A local diagnosis uses only the existing reduced fields and never sends raw task data. */
export function buildAssistantLocalDiagnosis(tasks: unknown, language: string, scope:"list"|"selected" = "list") {
  if (!Array.isArray(tasks)) return language === "en-US" ? "The local task list is unavailable." : language === "zh-TW" ? "目前無法讀取本機任務清單。" : "目前无法读取本地任务清单。";
  const reduced = reduceAssistantFailure(tasks);
  if (reduced.state === "none") return language === "en-US" ? "There is no failed task available for diagnosis." : language === "zh-TW" ? "任務清單中沒有可排查的失敗紀錄。" : "任务清单中没有可排查的失败记录。";
  if (reduced.state === "status_uncertain") return language === "en-US" ? "Some task statuses cannot be determined, so I cannot reliably identify failed tasks. Check the task list." : language === "zh-TW" ? "部分任務狀態無法確認，因此無法可靠判斷失敗任務；請查看任務清單。" : "部分任务状态无法确认，因此无法可靠判断失败任务；请查看任务清单。";
  if (reduced.state === "uncertain") return language === "en-US" ? "There are failed tasks, but their creation order cannot be determined reliably. Check the task list." : language === "zh-TW" ? "有失敗任務，但無法可靠判斷建立順序，請查看任務清單。" : "有失败任务，但无法可靠判断创建顺序，请查看任务清单。";
  const types:Record<string,[string,string,string]> = {text:["文本","文字","text"],image:["图片","圖片","image"],video:["视频","影片","video"],audio:["音频","音訊","audio"],music:["音乐","音樂","music"],other:["其他","其他","other"]};
  const kinds:Record<string,[string,string,string]> = {superseded:["被同一节点的新任务替代","被同一節點的新任務取代","superseded by a newer task on the same node"],rate_limit:["访问频率限制","存取頻率限制","rate limit"],quota:["余额或额度不足","餘額或額度不足","insufficient balance or quota"],authentication:["鉴权或凭据问题","驗證或憑證問題","authentication or credential issue"],timeout:["请求超时","請求逾時","request timeout"],network:["网络连接问题","網路連線問題","network connection issue"],content_policy:["内容审核限制","內容審核限制","content policy restriction"],unknown:["暂未识别","暫未識別","unknown"]};
  const index = language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0;
  Object.assign(kinds,{parameters:["请求参数可能不匹配","請求參數可能不符","possibly invalid request parameters"],configuration:["接口地址或方法可能不匹配","介面位址或方法可能不符","possible endpoint or method mismatch"],upstream:["服务端错误","伺服器端錯誤","server-side error"]});
  const type = (types[reduced.type] || types.other)[index], kind = (kinds[reduced.kind] || kinds.unknown)[index];
  const status = reduced.status === "unknown" ? ["未知","未知","unknown"][index] : reduced.status;
  const fields = language === "en-US" ? `Task type: ${type}\nHTTP status: ${status}\nPossible error category: ${kind}` : language === "zh-TW" ? `任務類型：${type}\nHTTP 狀態碼：${status}\n可能的錯誤類別：${kind}` : `任务类型：${type}\nHTTP 状态码：${status}\n可能的错误类别：${kind}`;
  const heading = scope === "selected" ? (language === "en-US" ? "Selected failed task (limited summary):" : language === "zh-TW" ? "指定失敗任務摘要（僅限必要資訊）：" : "指定失败任务摘要（仅限必要信息）：") : reduced.onlyFailure ? (language === "en-US" ? "Only failed task (limited summary):" : language === "zh-TW" ? "唯一失敗任務摘要（僅限必要資訊）：" : "唯一失败任务摘要（仅限必要信息）：") : (language === "en-US" ? "Most recently created failed task (not necessarily the latest failure):" : language === "zh-TW" ? "最近建立的失敗任務（不一定是最近發生的失敗）：" : "最近创建的失败任务（不一定是最近发生的失败）：");
  const checks:Record<string,[string,string,string]> = {
    parameters:["服务拒绝了请求参数；仅凭状态码不能确定具体字段，请对照 API 文档核对已选模型和参数。","服務拒絕了請求參數；僅憑狀態碼無法確定具體欄位，請對照 API 文件核對所選模型及參數。","The request was rejected as invalid. The status alone does not identify a field; compare the selected model and parameters with its API documentation."],
    configuration:["请求地址或方法可能不匹配，请对照 API 文档核对；不要自动更换服务。","請求位址或方法可能不符，請對照 API 文件核對；不要自動更換服務。","The endpoint or method may not match. Check the API documentation without switching services automatically."],
    upstream:["服务端返回错误，请核对上游状态及原任务；不能据此确定是否已经受理。","伺服器端回傳錯誤，請核對上游狀態及原任務；無法據此確定是否已受理。","The server returned an error. Check its status and the original task; this does not prove whether the request was accepted."],
    superseded:["请查看该节点较新的任务。","請查看該節點較新的任務。","Check the newer task on that node."],
    rate_limit:["请检查服务商的限流和并发情况，稍后再决定是否手动重试。","請檢查服務商的流量限制與並發情況，稍後再決定是否手動重試。","Check the provider's rate and concurrency limits before deciding whether to retry manually."],
    quota:["请检查所用服务的余额和可用额度。","請檢查所用服務的餘額和可用額度。","Check the balance and available quota for the service used."],
    authentication:["请核对所选服务配置及凭据是否有效，不要分享完整密钥。","請核對所選服務設定與憑證是否有效，不要分享完整金鑰。","Check the selected service configuration and credential validity; never share a full key."],
    timeout:["请检查网络连接和服务状态，再决定是否手动重试。","請檢查網路連線和服務狀態，再決定是否手動重試。","Check the network and service status before deciding whether to retry manually."],
    network:["请检查网络连接和服务状态，再决定是否手动重试。","請檢查網路連線和服務狀態，再決定是否手動重試。","Check the network and service status before deciding whether to retry manually."],
    content_policy:["请检查提交的内容和素材是否符合服务规则。","請檢查提交的內容和素材是否符合服務規則。","Check whether the submitted content and media meet the service's rules."],
    unknown:["可视情况检查网络、服务状态、余额与凭据；不要提供完整密钥。","可依情況檢查網路、服務狀態、餘額與憑證；不要提供完整金鑰。","Check the network, provider status, balance and credentials as appropriate; never share a full key."],
  };
  const advice = `${(checks[reduced.kind] || checks.unknown)[index]} ${language === "en-US" ? "Nothing will be retried automatically." : language === "zh-TW" ? "不會自動重試。" : "不会自动重试。"}`;
  return `${heading}\n${fields}\n${advice}`;
}

/** Diagnose only records whose category can be recognized locally. */
export function buildAssistantTypedDiagnosis(tasks:unknown, category:AssistantTaskCategory, language:string) {
  if (!Array.isArray(tasks)) return buildAssistantLocalDiagnosis(tasks,language);
  const recognized = tasks.filter(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const raw = item.customOutputType || item.type;
    return typeof raw === "string" && raw.toLowerCase() === category;
  });
  const labels:Record<AssistantTaskCategory,[string,string,string]> = {image:["图片","圖片","image"],video:["视频","影片","video"],audio:["音频","音訊","audio"],text:["文本","文字","text"]};
  const name = labels[category][language === "en-US" ? 2 : language === "zh-TW" ? 1 : 0];
  const prefix = language === "en-US" ? `Only recognized ${name} tasks are included.` : language === "zh-TW" ? `僅排查可識別的${name}任務。` : `仅排查可识别的${name}任务。`;
  return `${prefix}\n${buildAssistantLocalDiagnosis(recognized,language)}${assistantUnknownTaskTypeNotice(tasks,language)}`;
}

/** Local selection only: never put the task ID or raw record into a reply. */
export function buildAssistantSelectedTaskResponse(tasks:unknown, id:string, language:string) {
  const selected=selectAssistantTasksById(tasks,id), current=formatAssistantTaskById(tasks,id,language);
  return selected?.length === 1 && classifyAssistantTaskStatus(selected[0]) === "failed"
    ? `${current}\n${buildAssistantLocalDiagnosis(selected,language,"selected")}` : current;
}
