import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {AssistantCanvasPlanPanel} from './assistant-canvas-plan-panel';
import {AssistantGenerationTaskCard} from './assistant-generation-task-card';
import {AssistantModelQuote} from './assistant-model-quote';
import {AssistantHistoryControls} from './assistant-history-controls';
import {AssistantArchivePreview} from './assistant-archive-preview';
import {AssistantAttachments,AssistantAttachmentStatus} from './assistant-attachments';
import {AssistantMediaPreview} from './assistant-media-preview';
import {AssistantGettingStarted} from './assistant-getting-started';
import {appendAssistantExample} from '../lib/assistant-getting-started';
import {assistantHistoryCopy,assistantSessionMatches} from '../lib/assistant-history';
import {useAssistantHistory} from '../hooks/useAssistantHistory';
import {assistantGenerationCopy} from '../lib/assistant-generation-copy';
import {createAssistantCanvasPlanner} from '../lib/assistant-canvas-planner';
import {createAssistantLocalActionClient} from '../lib/assistant-local-action-client';
import {createAssistantTaskReader,assistantTaskReadFailure} from '../lib/assistant-task-reader';
import {assistantPreferenceOperationReceipt,assistantNavigationOperationReceipt} from '../lib/assistant-local-action-copy';
import {applicationOperationCopy} from '../lib/application-operation-copy';
import {assistantCanvasCopy,assistantCanvasError,assistantCanvasPostCommitNotice} from '../lib/assistant-canvas-copy';
import { ArrowRight, BookOpenText, ExternalLink, KeyRound, Link2, MessageSquare, Paperclip, RotateCcw, Send, Settings2, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { assistantChatFailureMessage, assistantMessageOrigin, assistantMessageOriginLabel, assistantLastOperationReceipt, assistantNavigationUnconfirmedNotice, assistantNavigationRejectedNotice, assistantNodeSubmissionNotice, assistantNodeUncertainNotice, assistantPreferenceUncertainNotice, buildAssistantButlerHandoff, buildAssistantFailureSummary, buildAssistantLocalDiagnosis, buildAssistantTypedDiagnosis, buildAssistantSelectedTaskResponse, clampAssistantLauncherPosition, readAssistantLauncherPosition, writeAssistantLauncherPosition, clearAssistantProposals, consumeAssistantNavigationProposal, containsLikelyAssistantSecret, isAssistantDiagnosticDraft, isValidAssistantNodeContent, isValidAssistantPreferenceProposal, markAssistantSessionBoundary, parseAssistantReply, shouldOfferAssistantOnboarding, type AssistantAction, type AssistantCanvasAction, type AssistantMessage, type AssistantNavigationAction, type AssistantPreferenceProposal } from "../lib/assistant-onboarding";
import { assistantPreferenceLabel, assistantPreferenceVisuallyApplied, formatAssistantAppearanceState, formatAssistantAutoDownloadState, parseAssistantPreferenceIntent, type AssistantTheme, type AssistantLanguage } from "../lib/assistant-preferences";
import { subscribeAssistantTaskInspection } from "../lib/assistant-task-inspection";
import { useAssistantWorkspace } from "../hooks/useAssistantWorkspace";
import {WanJuanAgentConfigPanel} from './agent-config-panel';
import {assistantWorkspaceTaskLabel} from '../lib/assistant-workspace-task-copy';
import {assistantBackupCopy,exportAssistantWorkspace,readAssistantWorkspaceBackup} from '../lib/assistant-workspace-backup-client';
import {backupExportFailureMessage,backupImportFailureMessage} from '../lib/backup-export-errors';
import {buildKnowledgeChunks} from '../lib/agent';
import { parseAssistantLocalNavigation, assistantNavigationAvailable, assistantNavigationElementVisible, classifyAssistantSettingChangeQuestion, isAssistantUnsupportedOperation, isAmbiguousAssistantOperation, isUnscopedAssistantStatusInquiry, isAssistantLastOperationInquiry, isAssistantMixedHowToAction, isAssistantDeferredOperation, isAssistantFutureTaskInquiry, isAssistantProjectTaskInquiry, parseAssistantCurrentProjectDiagnosis, selectAssistantCurrentProjectTasks, parseAssistantTaskIntent, parseAssistantTaskIdQuery, parseAssistantTaskIdDiagnosis, classifyAssistantTypedDiagnosis, classifyAssistantStateInquiry, requiresAssistantLocalStateEvidence, formatAssistantTaskSummary, formatAssistantSingleTaskProgress, formatAssistantTypedTaskProgress, formatAssistantCurrentProjectTasks, formatAssistantTaskCategory, formatAssistantLatestTask, formatAssistantTaskById, mayOfferAssistantAction, assistantProposalMatchesRequest, requiresAssistantOperationReceipt, hasUnverifiedAssistantActionClaim, type AssistantDestination, type AssistantTaskCategory } from "../lib/assistant-local-operations";

const SEEN_KEY = "wanjuan.assistant-onboarding.v1.seen";
const robotImage = new URL("../assets/assistant-robot-v1.png", import.meta.url).href;
type AssistantStatus = {installed:boolean; configured:boolean; authMode?:"key"|"account"|null; hasKey?:boolean; hasAccount?:boolean|null; accountPhase?:string};
const accountCopy = {
  "zh-CN": {statusLoading:"正在检查智能体配置…", statusError:"无法读取本机智能体配置，请检查系统安全存储后重试。现有配置未被修改。", retry:"重试", experimental:"账号登录仍处于试用阶段；可用性可能因设备或账号而异。", waiting:"请在系统浏览器完成 DeepSeek 授权，应用会自动更新状态。", committing:"正在安全保存账号，请稍候…", cancel:"取消登录", failed:"账号授权未完成，请检查网络后重试，也可以使用 API Key。", expired:"授权已过期，请重新打开登录页面。", signed:"DeepSeek 账号已连接", remove:"移除本机账号授权", priority:"已保存的 API Key 优先生效；移除 Key 后使用已连接账号。", start:"使用 DeepSeek 账号登录", reauthorize:"重新授权 DeepSeek 账号", rejected:"DeepSeek 拒绝了账号授权或访问权限，请尝试重新授权。"},
  "zh-TW": {statusLoading:"正在檢查智慧助手設定…", statusError:"無法讀取本機智慧助手設定，請檢查系統安全儲存後重試。現有設定未被修改。", retry:"重試", experimental:"帳號登入仍處於試用階段；可用性可能因裝置或帳號而異。", waiting:"請在系統瀏覽器完成 DeepSeek 授權，應用程式會自動更新狀態。", committing:"正在安全儲存帳號，請稍候…", cancel:"取消登入", failed:"帳號授權未完成，請檢查網路後重試，也可使用 API Key。", expired:"授權已過期，請重新開啟登入頁面。", signed:"DeepSeek 帳號已連線", remove:"移除本機帳號授權", priority:"已儲存的 API Key 優先生效；移除 Key 後使用已連線帳號。", start:"使用 DeepSeek 帳號登入", reauthorize:"重新授權 DeepSeek 帳號", rejected:"DeepSeek 拒絕了帳號授權或存取權限，請嘗試重新授權。"},
  "en-US": {statusLoading:"Checking assistant configuration…", statusError:"Unable to read this device's assistant configuration. Check system secure storage and try again. Your existing configuration was not changed.", retry:"Try again", experimental:"Account sign-in is experimental; availability may vary by device or account.", waiting:"Complete DeepSeek authorization in your browser. The app will update automatically.", committing:"Saving your account securely…", cancel:"Cancel sign-in", failed:"Account authorization did not complete. Check your connection or use an API key.", expired:"Authorization expired. Open the sign-in page again.", signed:"DeepSeek account connected", remove:"Remove account from this device", priority:"Your saved API key takes priority. Remove it to use the connected account.", start:"Sign in with DeepSeek", reauthorize:"Reauthorize DeepSeek account", rejected:"DeepSeek rejected the account grant or access. Try authorizing again."},
};
const connectionCopy = {
  "zh-CN": {check:"检查连接", checking:"正在检查…", hint:"仅查询 DeepSeek 官方模型列表，不发送对话或启动生成；结果不能证明余额充足。", ready:"官方模型列表可访问，包含主智能体所需模型；余额和实际对话尚未验证。", missing:"已访问模型列表，但未发现主智能体所需模型。", auth:"官方接口拒绝了凭据或访问权限，请检查 Key 和账号权限。", rate:"官方接口暂时限流，请稍后手动重试。", other:"无法完成连接检查，请检查网络或稍后重试。"},
  "zh-TW": {check:"檢查連線", checking:"正在檢查…", hint:"僅查詢 DeepSeek 官方模型清單，不傳送對話或開始產生；結果不能證明餘額充足。", ready:"可存取官方模型清單，包含主智慧助手所需模型；餘額和實際對話尚未驗證。", missing:"已存取模型清單，但未發現主智慧助手所需模型。", auth:"官方介面拒絕憑證或存取權限，請檢查 Key 和帳號權限。", rate:"官方介面暫時限流，請稍後手動重試。", other:"無法完成連線檢查，請檢查網路或稍後重試。"},
  "en-US": {check:"Check connection", checking:"Checking…", hint:"Only the official DeepSeek model list is requested; no chat or generation is sent. This does not check your balance.", ready:"The official model list is reachable and includes the assistant model. Balance and actual chat remain unverified.", missing:"The model list is reachable but does not include the assistant model.", auth:"The official API rejected the credential or access. Check your key and account permissions.", rate:"The official API is rate-limiting requests. Try again later.", other:"The connection check failed. Check your network or try again later."},
};
const handoffCopy = {
  "zh-CN": {model:"模型 ID（可选）", category:"模型类型（可选）", choose:"请选择类型", image:"图片", video:"视频", pair:"填写模型 ID 时请选择图片或视频；不填则保留配置管家原有选择。", invalid:"模型 ID 格式无效，请勿填写密钥或换行。", hint:"仅预填，下一步还需选择对应的 API 地址与 Key，并确认分析结果。"},
  "zh-TW": {model:"模型 ID（選填）", category:"模型類型（選填）", choose:"請選擇類型", image:"圖片", video:"影片", pair:"填寫模型 ID 時請選擇圖片或影片；不填則保留設定管家原有選擇。", invalid:"模型 ID 格式無效，請勿填入金鑰或換行。", hint:"只會預填，下一步仍需選擇對應的 API 地址與 Key，並確認分析結果。"},
  "en-US": {model:"Model ID (optional)", category:"Model type (optional)", choose:"Choose a type", image:"Image", video:"Video", pair:"Choose Image or Video when entering a model ID; leave both blank to keep the current selection.", invalid:"Invalid model ID. Do not enter a key or a line break.", hint:"Prefill only. Next, select the matching API address and key and review the analysis."},
};

const copy = {
  "zh-CN": {
    title: "欢迎来到 StarCanvas", subtitle: "先连接你的智能助手", intro: "智能助手将帮助你配置模型与排查问题",
    account: "StarCanvas 账号", accountDetail: "用于应用与云功能", provider: "DeepSeek 账号", providerDetail: "用于智能助手模型",
    signIn: "登录 DeepSeek", pending: "官方授权接入尚在验证中", useKey: "使用 API Key 配置", later: "稍后配置",
    browser: "正式授权将通过官方页面完成", cost: "模型调用可能产生费用", open: "打开智能助手引导", close: "关闭",
    drawer: "智能助手", preparing: "配置引导", hello: "我可以引导你接入图片或视频模型。", ask: "粘贴 API 文档链接，继续到配置管家。",
    docs: "公开 API 文档链接", placeholder: "https://...", continue: "继续到配置管家", configure: "配置管家的手动模型",
    hint: "分析时文档链接可能发送至第三方转读服务，文档摘要会发送至所选模型。请勿提供私密文档或包含密钥的链接。", invalid: "请输入不含凭据的公开 HTTP 或 HTTPS 文档链接。",
    details: "继续将替换配置管家当前文档链接；模型配置需另行确认后应用。", viewGuide: "重新打开欢迎引导", continueAssistant: "用主智能体配置模型", assistantDocsHint: "分析时，文档链接会发送至第三方转读服务 r.jina.ai；文档摘要、模型名称和目标请求地址会发送至 DeepSeek，可能产生费用。请勿提供私密内容。", diagnose: "填写最近失败任务摘要", diagnoseHint: "只提取任务类型、状态码和可能的错误类别；可检查或编辑后再发送。", noFailure: "任务清单里没有可用的失败记录。", draftFull: "输入内容太长，请先缩短后再添加摘要。",
    keyLabel: "DeepSeek API Key", keySave: "安全保存并开始", keyEdit: "更换 API Key", keyRemove: "移除 API Key", keySaved: "密钥已保存", keyGet: "前往 DeepSeek 开放平台获取 Key", keyGetHint: "在官方平台登录并创建 API Key，然后返回这里粘贴；账号登录不会自动生成 Key。", keyOpenError: "无法打开浏览器，请手动访问 platform.deepseek.com/api_keys。", keyHint: "密钥由系统安全存储保护，发送消息会调用 DeepSeek 并可能产生费用。", runtimeMissing: "当前设备缺少兼容的主智能体运行时，请更新应用或联系开发者。", chatPlaceholder: "输入问题，向助手发送…", chatSend: "发送", chatWorking: "正在思考…", chatStop: "停止生成", chatStopping: "正在停止…", chatStopped: "已停止并重置会话；已发往上游的请求仍可能计费。", chatError: "助手暂时无法完成请求。请检查密钥、网络和 Harness 版本；对话会话已重置。", chatNote: "支持对话、页面跳转和确认后创建节点；建议内容可先编辑，不会自动开始生成。对话会发送至 DeepSeek；运行期间保存在本机临时目录，异常退出可能留下临时文件。", configureModel: "配置图片或视频模型", keyCancel: "取消更换", openApi: "打开 API 配置", openModels: "打开模型配置",
  },
  "zh-TW": {
    title: "歡迎來到 StarCanvas", subtitle: "先連接你的智慧助手", intro: "智慧助手將幫助你設定模型與排查問題",
    account: "StarCanvas 帳號", accountDetail: "用於應用程式與雲端功能", provider: "DeepSeek 帳號", providerDetail: "用於智慧助手模型",
    signIn: "登入 DeepSeek", pending: "官方授權接入仍在驗證中", useKey: "使用 API Key 設定", later: "稍後設定",
    browser: "正式授權將透過官方頁面完成", cost: "模型呼叫可能產生費用", open: "開啟智慧助手引導", close: "關閉",
    drawer: "智慧助手", preparing: "設定引導", hello: "我可以引導你接入圖片或影片模型。", ask: "貼上 API 文件連結，繼續到設定管家。",
    docs: "公開 API 文件連結", placeholder: "https://...", continue: "繼續到設定管家", configure: "設定管家的手動模型",
    hint: "分析時文件連結可能傳送至第三方轉讀服務，文件摘要會傳送至所選模型。請勿提供私人文件或包含金鑰的連結。", invalid: "請輸入不含憑證的公開 HTTP 或 HTTPS 文件連結。",
    details: "繼續將替換設定管家目前的文件連結；模型設定須另外確認後套用。", viewGuide: "重新開啟歡迎引導", continueAssistant: "用主智慧助手設定模型", assistantDocsHint: "分析時，文件連結會傳送至第三方轉讀服務 r.jina.ai；文件摘要、模型名稱和目標請求地址會傳送至 DeepSeek，可能產生費用。請勿提供私人內容。", diagnose: "填入最近失敗任務摘要", diagnoseHint: "只擷取任務類型、狀態碼和可能的錯誤類別；可檢查或編輯後再傳送。", noFailure: "任務清單中沒有可用的失敗紀錄。", draftFull: "輸入內容太長，請先縮短後再新增摘要。",
    keyLabel: "DeepSeek API Key", keySave: "安全儲存並開始", keyEdit: "更換 API Key", keyRemove: "移除 API Key", keySaved: "金鑰已儲存", keyGet: "前往 DeepSeek 開放平台取得金鑰", keyGetHint: "在官方平台登入並建立 API Key，然後回到這裡貼上；帳號登入不會自動建立金鑰。", keyOpenError: "無法開啟瀏覽器，請手動前往 platform.deepseek.com/api_keys。", keyHint: "金鑰由系統安全儲存保護，傳送訊息會呼叫 DeepSeek 並可能產生費用。", runtimeMissing: "目前裝置缺少相容的主智慧助手執行環境，請更新應用程式或聯絡開發者。", chatPlaceholder: "輸入問題，傳送給助手…", chatSend: "傳送", chatWorking: "正在思考…", chatStop: "停止產生", chatStopping: "正在停止…", chatStopped: "已停止並重設對話；已傳送至上游的請求仍可能計費。", chatError: "助手暫時無法完成請求。請檢查金鑰、網路和 Harness 版本；對話工作階段已重設。", chatNote: "支援對話、頁面跳轉及確認後建立節點；建議內容可先編輯，不會自動開始產生。對話會傳送至 DeepSeek；運行期間保存在本機暫存目錄，異常結束可能留下暫存檔案。", configureModel: "設定圖片或影片模型", keyCancel: "取消更換", openApi: "開啟 API 設定", openModels: "開啟模型設定",
  },
  "en-US": {
    title: "Welcome to StarCanvas", subtitle: "Connect your assistant", intro: "Get help configuring models and diagnosing issues",
    account: "StarCanvas account", accountDetail: "For app and cloud features", provider: "DeepSeek account", providerDetail: "For the assistant model",
    signIn: "Sign in to DeepSeek", pending: "Official authorization is being verified", useKey: "Configure with an API key", later: "Set up later",
    browser: "Authorization will use the official page", cost: "Model usage may incur charges", open: "Open assistant guide", close: "Close",
    drawer: "Assistant", preparing: "Setup guide", hello: "I can guide you through connecting an image or video model.", ask: "Paste an API documentation link to continue to Configuration Butler.",
    docs: "Public API documentation URL", placeholder: "https://...", continue: "Open Configuration Butler", configure: "Configure the manual butler model",
    hint: "Analysis may send the document URL to a third-party reader and its summary to your selected model. Do not provide private documents or URLs containing secrets.", invalid: "Enter a public HTTP or HTTPS documentation URL without credentials.",
    details: "Continuing replaces Configuration Butler's current document link; applying a model configuration requires a separate confirmation.", viewGuide: "Reopen welcome guide", continueAssistant: "Configure with the assistant", assistantDocsHint: "Analysis sends the documentation URL to the third-party reader r.jina.ai, and the summary, model name and target API address to DeepSeek. Charges may apply. Do not submit private content.", diagnose: "Add latest failure summary", diagnoseHint: "Only task type, status code, and a possible error category are added. Review or edit before sending.", noFailure: "No failed task is available.", draftFull: "Shorten the draft before adding the summary.",
    keyLabel: "DeepSeek API key", keySave: "Save securely and start", keyEdit: "Change API key", keyRemove: "Remove API key", keySaved: "Key saved", keyGet: "Get an API key from DeepSeek", keyGetHint: "Sign in and create an API key on the official platform, then paste it here. Signing in does not automatically create a key.", keyOpenError: "Could not open the browser. Visit platform.deepseek.com/api_keys manually.", keyHint: "Your key is protected by system secure storage. Sending messages calls DeepSeek and may incur charges.", runtimeMissing: "A compatible assistant runtime is missing. Update the app or contact the developer.", chatPlaceholder: "Ask the assistant…", chatSend: "Send", chatWorking: "Thinking…", chatStop: "Stop generating", chatStopping: "Stopping…", chatStopped: "Stopped and reset the session. A request already sent to the provider may still be charged.", chatError: "The assistant could not complete the request. Check your key, network, and Harness version. The conversation session was reset.", chatNote: "Chat, navigation, and confirmed node creation with editable drafts; no automatic generation. Conversations are sent to DeepSeek and temporarily stored locally; files may remain after an unexpected exit.", configureModel: "Configure an image or video model", keyCancel: "Cancel change", openApi: "Open API settings", openModels: "Open model settings",
  },
};

export function AssistantOnboarding({ ready, tasksReady = ready, navigationReady = ready, settingsUnavailable = false, hasConfiguration, language, themeMode, autoDownloadGeneratedResults, canSetPreference, canNavigateLocal, onNavigationNotice, activeView, activeSettingsTab, projectId, projectName, getCanvasNodePlacement, onOpenSetup, onOpenModels, onOpenAgents, onOpenResources, onOpenCanvas, onOpenWorkspace, onOpenAccount, onOpenAppearance, onOpenButler, workbench = false, onOpenRoles, agentWorkspace, getCanvasPlanController, onCanvasPlanApplied }: {
  ready: boolean; tasksReady?: boolean; navigationReady?: boolean; settingsUnavailable?: boolean; hasConfiguration: boolean; language: string; activeView: string; activeSettingsTab: string; projectId: string; projectName: string;
  themeMode?: string; autoDownloadGeneratedResults?: boolean; canSetPreference?: boolean;
  canNavigateLocal?: boolean; onNavigationNotice?: (message:string) => void;
  getCanvasNodePlacement?: (projectId:string)=>{x:number;y:number}|null;
  onOpenSetup: () => void; onOpenModels: () => void; onOpenAgents: () => void; onOpenResources: () => void; onOpenCanvas: () => void; onOpenWorkspace: () => void; onOpenAccount: () => void; onOpenAppearance: () => void; onOpenButler: (url: string, useAssistant: boolean, hints?: {model:string; category:"image"|"video"}) => void;
  workbench?:boolean; onOpenRoles?:()=>void;
  agentWorkspace?:{agents:any[];conversations:any;environment:any;theme:any;isLightTheme:boolean};
  getCanvasPlanController?:(projectId:string)=>any;onCanvasPlanApplied?:(projectId:string,nodeIds:string[])=>void;
}) {
  const t = copy[language as keyof typeof copy] || copy["zh-CN"];
  const connectionText = connectionCopy[language as keyof typeof connectionCopy] || connectionCopy["zh-CN"];
  const handoffText = handoffCopy[language as keyof typeof handoffCopy] || handoffCopy["zh-CN"];
  const accountText = accountCopy[language as keyof typeof accountCopy] || accountCopy["zh-CN"];
  const [welcome, setWelcome] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const workspace = useAssistantWorkspace(ready && (drawer || workbench), projectId);
  const chatVisible = drawer || workbench;
  const chatView = workspace.view;
  const canvasPlan=chatView.canvasPlan,canvasCopy=assistantCanvasCopy(language);
  const displayedCanvasPlan=canvasPlan.projectId&&canvasPlan.projectId!==projectId&&canvasPlan.phase!=='idle'?{...canvasPlan,phase:'expired',code:'PLAN_STALE'}:canvasPlan;
  const canvasPlanner=createAssistantCanvasPlanner(workspace.controller,id=>getCanvasPlanController?.(id)||null);
  const localActions=createAssistantLocalActionClient(workspace.controller),localCopy=applicationOperationCopy(language),taskReader=createAssistantTaskReader(workspace.controller),taskRead=chatView.taskRead;
  const [panel, setPanel] = useState<"chat" | "settings" | "model">("chat");
  const [sessionName, setSessionName] = useState<string|null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sessionFilter,setSessionFilter]=useState('');
  const deferredSessionFilter=useDeferredValue(sessionFilter);
  const [archivePreview,setArchivePreview]=useState<{id:string;name:string;roleId:string}|null>(null);
  const archiveOpener=useRef<HTMLButtonElement|null>(null);
  const [roleEditor,setRoleEditor] = useState<any>(null);
  const [roleSaveError,setRoleSaveError] = useState('');
  const [roleSaving,setRoleSaving] = useState(false);
  const roleSaveInFlight = useRef(false);
  const legacyImported = useRef(false);
  const [legacyImportError,setLegacyImportError] = useState(false);
  const [legacyImporting,setLegacyImporting]=useState(false);
  const legacyInFlight=useRef(false);
  const backupCopy=assistantBackupCopy(language);
  const [backupBusy,setBackupBusy]=useState(false),[backupNotice,setBackupNotice]=useState(''),[backupError,setBackupError]=useState('');
  const [pendingBackup,setPendingBackup]=useState<any>(null);
  const backupInFlight=useRef(false),backupInputRef=useRef<HTMLInputElement>(null);
  const customRole = workspace.role?.descriptor?.engine === 'custom';
  const mediaInputRef=useRef<HTMLInputElement>(null);
  const [mediaPreview,setMediaPreview]=useState<{ownerId:string;attachment:any}|null>(null);
  const mediaPreviewOpener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{setMediaPreview(null);},[workspace.id,panel,chatVisible]);
  function openMediaPreview(attachment:any,button:HTMLButtonElement){mediaPreviewOpener.current=button;setMediaPreview({ownerId:workspace.id,attachment});}
  function closeMediaPreview(){const owner=workspace.id;setMediaPreview(null);requestAnimationFrame(()=>{if(workspace.controller.getSnapshot().selectedId===owner&&mediaPreviewOpener.current?.isConnected)mediaPreviewOpener.current.focus();});}
  const attachments=workspace.view.record?.value.attachments||[];
  const mediaCopy=language==='en-US'?{add:'Attach image or video',remove:'Remove attachment',again:'Attach again',hint:'Up to 6 files, 32 MiB each. Images: PNG, JPEG, GIF, WebP. Video is sent only through the existing Gemini inline-video protocol; your selected model must support it. Past media is not automatically resent.',loading:'Encrypting attachment…',prompt:'Please analyze the attached media.'}:language==='zh-TW'?{add:'附加圖片或影片',remove:'移除附件',again:'再次附加',hint:'最多 6 個檔案，單檔 32 MiB。圖片支援 PNG、JPEG、GIF、WebP；影片僅透過現有 Gemini 內嵌影片協定傳送，仍需所選模型支援。歷史媒體不會自動重傳。',loading:'正在加密附件…',prompt:'請分析附加的媒體內容。'}:{add:'附加图片或视频',remove:'移除附件',again:'再次附加',hint:'最多 6 个文件，单个 32 MiB。图片支持 PNG、JPEG、GIF、WebP；视频仅通过现有 Gemini 内嵌视频协议发送，仍需所选模型支持。历史媒体不会自动重传。',loading:'正在加密附件…',prompt:'请分析附加的媒体内容。'};
  const localAction=chatView.localAction;
  const localPending=['running','uncertain'].includes(localAction.phase);
  const pendingPreference=localPending&&localAction.operation==='app.preferences.set';
  const pendingNavigation=localPending&&localAction.operation==='app.navigate';
  const preferenceInFlight={current:pendingPreference?localAction:null},navigationInFlight={current:pendingNavigation?1:null};
  const [geometry, setGeometry] = useState<{x:number; y:number; width:number; height:number} | null>(null);
  const [launcherPosition, setLauncherPosition] = useState<{x:number;y:number}|null>(() => {
    try { return readAssistantLauncherPosition(window.localStorage); } catch { return null; }
  });
  const launcherRef = useRef<HTMLButtonElement>(null);
  const launcherDrag = useRef<{id:number; startX:number; startY:number; originX:number; originY:number; moved:boolean; latest?:{x:number;y:number}}|null>(null);
  const suppressLauncherClick = useRef(false);
  const drawerRef = useRef<HTMLElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const pointerDrag = useRef<{id:number; mode:"move"|"resize"; startX:number; startY:number; rect:{x:number;y:number;width:number;height:number}} | null>(null);
  const [docUrl, setDocUrl] = useState("");
  const [guideModel, setGuideModel] = useState("");
  const [guideCategory, setGuideCategory] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [statusRevision, setStatusRevision] = useState(0);
  const [authPhase, setAuthPhase] = useState("idle");
  const accountPending = authPhase !== "idle";
  const [keyEntry, setKeyEntry] = useState(false);
  const [key, setKey] = useState("");
  const message = chatView.draft, setMessage = workspace.setters.draft;
  const inputRevision = chatView.refs.inputRevision;
  // Block a duplicate submission until the edited/cleared input is committed.
  const localActionSubmitted = chatView.refs.localActionSubmitted;
  const diagnosticDraft = chatView.refs.diagnosticDraft;
  const messages = chatView.messages, setMessages = workspace.setters.messages;
  const history=useAssistantHistory(workspace.id,messages,conversationRef,followConversation);
  const historyCopy=assistantHistoryCopy(language);
  const [taskInspection, setTaskInspection] = useState<{id:string}|null>(null);
  // Fence the selection synchronously, before React commits the queued render.
  const pendingTaskInspection = useRef<{id:string}|null>(null);
  const processedTaskInspection = useRef<{id:string}|null>(null);
  const busy = chatView.busy, setBusy = workspace.setters.busy;
  const sending = chatView.sending, setSending = workspace.setters.sending;
  // React state updates can be batched; guard the IPC synchronously so two
  // clicks in the same render cannot submit two potentially billable turns.
  const modelSendInFlight = chatView.refs.modelSendInFlight;
  // An IPC reply may already be in transit when Stop is clicked. Fence that
  // turn immediately, independently of when cancellation finishes.
  const modelCancellationRequested = chatView.refs.modelCancellationRequested;
  const cancelledTurnWaiting = chatView.cancelledTurnWaiting, setCancelledTurnWaiting = workspace.setters.cancelledTurnWaiting;
  const resetInFlight = chatView.refs.resetInFlight;
  const requiresReset = chatView.requiresReset, setRequiresReset = workspace.setters.requiresReset;
  const cancelling = chatView.cancelling, setCancelling = workspace.setters.cancelling;
  const cancelInFlight = chatView.refs.cancelInFlight;
  const chatNotice = chatView.chatNotice, setChatNotice = workspace.setters.chatNotice;
  const chatError = chatView.chatError, setChatError = workspace.setters.chatError;
  const [connectionNotice, setConnectionNotice] = useState("");
  const checked = useRef(false);
  const authAttempt = useRef(0);
  const consumedActions = chatView.refs.consumedActions;
  const proposalFence = chatView.refs.proposalFence;
  const dialogRef = useRef<HTMLDivElement>(null);
  const boundaryNotice = workspace.active
    ? (language === "en-US" ? "Completed history remains in this conversation. Failed or cancelled turns are excluded from subsequent model context." : language === "zh-TW" ? "已完成的歷史仍保留於此對話；失敗或取消的回合不參與後續模型上下文。" : "已完成的历史仍保留在此会话；失败或取消的回合不参与后续模型上下文。")
    : language === "en-US" ? "A new conversation has started. Earlier messages remain visible here but are not sent as context." : language === "zh-TW" ? "已開始新對話。先前訊息僅保留在此視窗，不會作為上下文傳送。" : "已开始新对话。之前的消息仅保留在此窗口，不会作为上下文发送。";
  const sessionStopNotice = language === "en-US" ? "Generation stopped; completed history is retained. Requests already sent may still be charged." : language === "zh-TW" ? "已停止本次產生，已完成的歷史仍保留；已傳送的請求仍可能計費。" : "已停止本次生成，已完成的历史仍保留；已发出的请求仍可能计费。";
  const newChatLabel = language === "en-US" ? "New conversation" : language === "zh-TW" ? "開始新對話" : "开始新对话";
  const settingsLabel = language === "en-US" ? "Assistant settings" : language === "zh-TW" ? "助手設定" : "助手设置";
  const chatLabel = language === "en-US" ? "Back to chat" : language === "zh-TW" ? "返回對話" : "返回对话";
  const resizeLabel = language === "en-US" ? "Resize assistant window (arrow keys)" : language === "zh-TW" ? "調整助手視窗大小（方向鍵）" : "调整助手窗口大小（方向键）";
  const moveLabel = language === "en-US" ? "Move assistant window (arrow keys)" : language === "zh-TW" ? "移動助手視窗（方向鍵）" : "移动助手窗口（方向键）";
  const proposalBlocked = proposalFence.current || !!taskInspection || taskRead.working || busy || cancelling || accountPending || !!preferenceInFlight.current || !!pendingPreference || !!pendingNavigation || requiresReset || canvasPlan.working || !!canvasPlan.pendingOperation || !status?.configured || !status?.installed;
  const sessionCopy = language === "en-US" ? {title:"Assistant workbench",sessions:"Conversations",fresh:"New conversation",untitled:"Untitled conversation",roles:"Roles and earlier chats",expand:"Workbench",float:"Floating chat",rename:"Rename",archive:"Archive",restore:"Restore",archived:"Show archived",save:"Save",cancel:"Cancel",loading:"Loading encrypted conversations…",failure:"Secure conversation storage is unavailable. Nothing will be saved as plaintext. Check system storage and try again.",retry:"Try again",saved:"Saved securely",saving:"Saving securely…",conflict:"Could not save this conversation safely. Your draft is still here; check storage before closing or switching.",note:"Conversation history is encrypted locally. Only this conversation's completed context is sent to DeepSeek."} : language === "zh-TW" ? {title:"助手工作台",sessions:"對話",fresh:"新建對話",untitled:"未命名對話",roles:"角色與先前對話",expand:"工作台",float:"浮動對話",rename:"重新命名",archive:"封存",restore:"還原",archived:"顯示封存對話",save:"儲存",cancel:"取消",loading:"正在載入加密對話…",failure:"對話安全儲存暫不可用，不會改用明文儲存。請檢查系統儲存後重試。",retry:"重試",saved:"已安全儲存",saving:"正在安全儲存…",conflict:"無法確認對話已安全儲存。草稿仍在此處，請檢查儲存後再關閉或切換。",note:"對話歷史在本機加密儲存，只有本對話已完成的上下文會傳送至 DeepSeek。"} : {title:"助手工作台",sessions:"会话",fresh:"新建会话",untitled:"未命名会话",roles:"角色与之前的对话",expand:"工作台",float:"浮窗聊天",rename:"重命名",archive:"归档",restore:"恢复",archived:"显示归档会话",save:"保存",cancel:"取消",loading:"正在加载加密会话…",failure:"会话安全存储暂不可用，不会改用明文保存。请检查系统存储后重试。",retry:"重试",saved:"已安全保存",saving:"正在安全保存…",conflict:"无法确认会话已安全保存。草稿仍在这里，请检查存储后再关闭或切换。",note:"会话历史在本机加密保存，只有本会话已完成的上下文会发送至 DeepSeek。"};
  // A's pending/unknown local action must not trap B. Changing selection
  // invalidates any unconsumed confirmation in the common authority layer;
  // a result from an already submitted action remains owned by A.
  const switchBlocked = !workspace.active || workspace.snapshot.switching || cancelling || accountPending || (busy && !sending) || !!taskInspection;
  const activeDescriptor = workspace.snapshot.catalog.sessions.find((item:any) => item.id === workspace.id);
  const filteredSessions=useMemo(()=>workspace.snapshot.catalog.sessions.filter((item:any)=>item.archived===showArchived&&item.roleId===workspace.role?.descriptor.id&&assistantSessionMatches(item.name,deferredSessionFilter,sessionCopy.untitled)),[workspace.snapshot.catalog.sessions,workspace.role?.descriptor.id,showArchived,deferredSessionFilter,sessionCopy.untitled]);
  useEffect(()=>{setArchivePreview(null);},[workspace.role?.descriptor.id,showArchived]);
  function closeArchive(){setArchivePreview(null);requestAnimationFrame(()=>{if(archiveOpener.current?.isConnected)archiveOpener.current.focus();});}
  const boundProject=workspace.view.record?.value.projectId||'';
  const projectCopy=language==='en-US'?{title:'Project',none:'Not bound',other:'Another project',bind:'Bind current project',clear:'Remove project binding',note:'Binding does not change the canvas or automatically share its contents. Running requests keep their submitted binding.'}:language==='zh-TW'?{title:'專案',none:'未綁定',other:'其他專案',bind:'綁定目前專案',clear:'解除專案綁定',note:'綁定不會切換畫布，也不會自動傳送專案內容。執行中的請求維持提交時的綁定。'}:{title:'项目',none:'未绑定',other:'其他项目',bind:'绑定当前项目',clear:'解除项目绑定',note:'绑定不会切换画布，也不会自动发送项目内容。执行中的请求保持提交时的绑定。'};
  async function sessionAction(action:()=>Promise<unknown>) {
    if (switchBlocked) return;
    invalidateActionProposals(); setSessionName(null);
    try {await action();} catch {setChatError(sessionCopy.conflict);}
  }
  useEffect(()=>{
    if(!ready||!workspace.active||!agentWorkspace?.agents||legacyImported.current)return;
    legacyImported.current=true;
    void retryLegacyImport();
  },[ready,workspace.active,workspace.controller,agentWorkspace?.agents,agentWorkspace?.conversations]);
  async function retryLegacyImport(){
    if(!agentWorkspace||legacyInFlight.current)return;
    legacyInFlight.current=true;setLegacyImporting(true);
    try{await workspace.controller.importLegacy(agentWorkspace.agents,agentWorkspace.conversations);setLegacyImportError(false);}
    catch{setLegacyImportError(true);}
    finally{legacyInFlight.current=false;setLegacyImporting(false);}
  }
  async function openRole(roleId:string){
    await sessionAction(async()=>{
      const session=workspace.controller.getSnapshot().catalog.sessions.find((item:any)=>item.roleId===roleId&&!item.archived);
      if(session)await workspace.controller.select(session.id);else await workspace.controller.create(projectId,roleId);
    });
  }
  async function newRole(){
    if(!agentWorkspace)return;
    await sessionAction(async()=>{
      const environment=agentWorkspace.environment;
      setRoleEditor({descriptor:{id:'$new',engine:'custom'},revision:0,configuration:{name:language==='en-US'?'New role':'新角色',icon:'bot',model:environment.agentModelOptions?.[0]||'',apiConfigId:environment.textApiConfigId||'',systemPrompt:'',knowledge:'',knowledgeFiles:[],memoryEnabled:false,memoryScope:'session',outputMode:'chat',temperature:'0.7'}});setRoleSaveError('');
    });
  }
  async function saveRole(){
    if(!roleEditor||roleSaveInFlight.current)return;
    roleSaveInFlight.current=true;setRoleSaving(true);setRoleSaveError('');
    try{
      if(roleEditor.descriptor.id==='$new'){
        const result=await workspace.controller.createRole(roleEditor.configuration,projectId);
        if(result?.sessionFailed)setChatError(language==='en-US'?'Role saved, but its conversation could not open. Select the role to try opening it again.':language==='zh-TW'?'角色已儲存，但對話無法開啟，請選擇該角色重試開啟。':'角色已保存，但会话无法打开，请选择该角色重试打开。');
      }else await workspace.controller.saveRole(roleEditor.descriptor.id,roleEditor.configuration,roleEditor.revision);
      setRoleEditor(null);
    }
    catch(error:any){setRoleSaveError(error?.code==='ASSISTANT_WORKSPACE_LIMIT'?(language==='en-US'?'The role exceeds the 8 MiB content limit. Reduce its knowledge data; no plaintext fallback is used.':language==='zh-TW'?'角色內容超過 8 MiB 上限，請縮減知識資料；不會改用明文儲存。':'角色内容超过 8 MiB 上限，请缩减知识资料；不会改用明文保存。'):sessionCopy.conflict);}
    finally{roleSaveInFlight.current=false;setRoleSaving(false);}
  }
  function backupFailure(error:any,importing=false){
    const code=String(error?.code||'');
    if(code==='ASSISTANT_BUSY')return backupCopy.busy;
    if(code==='ASSISTANT_BACKUP_LIMIT')return backupCopy.limit;
    if(code==='ASSISTANT_BACKUP_INVALID')return backupCopy.invalid;
    if(code==='ASSISTANT_BACKUP_ENCRYPTION_REQUIRED')return backupCopy.encryption;
    if(code.startsWith('BACKUP_'))return importing?backupImportFailureMessage(error,language):backupExportFailureMessage(error,language);
    return language==='en-US'?'Could not confirm completion. Existing records will not be overwritten; inspect before retrying.':language==='zh-TW'?'無法確認操作已完成。不會覆蓋現有紀錄，請檢查後再重試。':'无法确认操作已完成。不会覆盖现有记录，请检查后再重试。';
  }
  async function exportWorkspaceBackup(scope:'all'|'session'){
    if(backupInFlight.current||pendingBackup)return;
    backupInFlight.current=true;setBackupBusy(true);setBackupError('');setBackupNotice('');
    try{const result=await exportAssistantWorkspace(workspace.controller,(window.wanjuanDesktop||{}) as any,scope,language);if(!result.cancelled)setBackupNotice(backupCopy.exported);}
    catch(error){setBackupError(backupFailure(error));}
    finally{backupInFlight.current=false;setBackupBusy(false);}
  }
  async function prepareWorkspaceBackup(file:File){
    if(backupInFlight.current||pendingBackup)return;
    backupInFlight.current=true;setBackupBusy(true);setBackupError('');setBackupNotice('');
    try{const value=await readAssistantWorkspaceBackup(file,(window.wanjuanDesktop||{}) as any,language);if(value)setPendingBackup(value);}
    catch(error){setBackupError(backupFailure(error,true));}
    finally{backupInFlight.current=false;setBackupBusy(false);}
  }
  async function confirmWorkspaceBackup(){
    if(backupInFlight.current||!pendingBackup)return;
    backupInFlight.current=true;setBackupBusy(true);setBackupError('');
    try{
      const receipt=await workspace.controller.importBackup(pendingBackup);setPendingBackup(null);
      setBackupNotice(receipt.refreshFailed?(language==='en-US'?'Import committed, but the workbench could not refresh. Reopen it to view the imported copies.':language==='zh-TW'?'匯入已完成，但工作台無法重新整理，請重新開啟查看副本。':'导入已完成，但工作台无法刷新，请重新打开查看副本。'):receipt.alreadyImported?backupCopy.duplicate:backupCopy.imported);
    }catch(error){setBackupError(backupFailure(error,true));}
    finally{backupInFlight.current=false;setBackupBusy(false);}
  }
  async function importRoleKnowledge(){
    if(!roleEditor)return;
    const owner=roleEditor.descriptor.id;
    try{
      const result=await window.wanjuanDesktop?.readKnowledgeFile?.({title:language==='en-US'?'Import role knowledge':language==='zh-TW'?'匯入角色知識':'导入角色知识',maxBytes:50*1024*1024});
      if(result?.canceled)return;
      if(!result?.ok)throw Error('KNOWLEDGE_IMPORT_FAILED');
      const content=String(result.content||'').replace(/\r\n/g,'\n').trim();
      const file={id:crypto.randomUUID(),name:result.name||'Knowledge',path:result.path||'',size:result.size||0,content,totalChars:content.length,excerpt:content.slice(0,180),chunks:buildKnowledgeChunks(content),importedAt:Date.now()};
      setRoleEditor((current:any)=>current?.descriptor.id===owner?{...current,configuration:{...current.configuration,knowledgeFiles:[...(current.configuration.knowledgeFiles||[]),file]}}:current);
    }catch{setRoleSaveError(language==='en-US'?'Could not import this knowledge file. Existing role knowledge is unchanged.':language==='zh-TW'?'無法匯入此知識檔案，現有角色知識未更動。':'无法导入此知识文件，现有角色知识未改动。');}
  }
  async function sendRoleMessage(text:string){
    if(!agentWorkspace||!workspace.role?.configuration)return;
    const revision=inputRevision.current;
    modelSendInFlight.current=true;modelCancellationRequested.current=false;
    setMessage('');setMessages(previous=>[...clearAssistantProposals(previous),{role:'user',text,...(attachments.length?{attachments:structuredClone(attachments)}:{})}]);setBusy(true);setSending(true);setChatError('');setChatNotice('');
    try{
      const result=await workspace.controller.sendCustom(workspace.id,text,agentWorkspace.environment);
      if(modelCancellationRequested.current)return;
      if(!result.ok){
        if(inputRevision.current===revision)setMessage(current=>current||text);
        setChatError(assistantChatFailureMessage(result.code,language,{retainedHistory:true}));return;
      }
      // A custom role's output is model text, never an execution receipt or
      // automatically interpreted main-assistant action marker.
      setMessages(previous=>[...previous,{role:'assistant',text:result.value,modelReply:true}]);
      if(result.warnings?.length)setChatNotice(language==='en-US'?'The model replied, but memory synchronization was incomplete.':language==='zh-TW'?'模型已回答，但記憶同步未完成。':'模型已回答，但记忆同步未完成。');
    }finally{modelSendInFlight.current=false;setBusy(false);setSending(false);setCancelledTurnWaiting(false);}
  }
  async function importWorkspaceMedia(files:File[]){
    const owner=workspace.id;
    try{await workspace.controller.addFiles(owner,files);}
    catch(error:any){if(workspace.controller.viewFor(owner).mediaStatus.phase!=='failed')workspace.controller.set(owner,'mediaStatus',{phase:'failed',code:error?.code||'ASSISTANT_MEDIA_UNAVAILABLE'});}
  }
  async function replaceWorkspaceMedia(next:any[]){
    const owner=workspace.id;
    try{await workspace.controller.setAttachments(owner,next);}
    catch(error:any){workspace.controller.set(owner,'mediaStatus',{phase:'failed',code:error?.code||'ASSISTANT_MEDIA_UNAVAILABLE'});}
  }

  function invalidateActionProposals() {
    // Consume the objects synchronously as well as scheduling a UI update:
    // old button handlers may still exist until React commits that update.
    for (const item of messages) if (item.action || item.preference) consumedActions.current.add(item);
    setMessages(previous => clearAssistantProposals(previous));
  }

  useEffect(() => {
    const unsubscribe = subscribeAssistantTaskInspection(id => {
      const request = {id};
      pendingTaskInspection.current = request;
      setWelcome(false); setPanel("chat"); setDrawer(true); setTaskInspection(request);
    });
    return () => { unsubscribe(); pendingTaskInspection.current = null; };
  }, []);
  useEffect(() => {
    if (!taskInspection || pendingTaskInspection.current !== taskInspection || processedTaskInspection.current === taskInspection) return;
    if (!workspace.active || !tasksReady || taskRead.working || busy || cancelling || accountPending || modelSendInFlight.current || cancelInFlight.current || resetInFlight.current || navigationInFlight.current !== null || preferenceInFlight.current || pendingPreference || pendingNavigation) {
      setChatNotice(language === "en-US" ? "The selected task will be checked after the current operation finishes." : language === "zh-TW" ? "目前操作完成後，將排查選取的任務。" : "当前操作完成后，将排查选中的任务。");
      return;
    }
    processedTaskInspection.current = taskInspection;
    setChatNotice("");
    for (const item of messages) if (item.action || item.preference) consumedActions.current.add(item);
    const prompt = language === "en-US" ? "Diagnose the selected task." : language === "zh-TW" ? "請排查選取的任務。" : "请排查选中的任务。";
    if (pendingTaskInspection.current === taskInspection) pendingTaskInspection.current = null;
    setTaskInspection(current => current === taskInspection ? null : current);
    const owner=workspace.id;
    void queryTaskText(records=>buildAssistantSelectedTaskResponse(records,records[0]?.id||taskInspection.id,language),{id:taskInspection.id,includeDiagnostics:true}).then(reply=>{
      workspace.controller.set(owner,'messages',previous=>[...clearAssistantProposals(previous as AssistantMessage[]),{role:'user',text:prompt},{role:'assistant',text:reply}]);
    });
  }, [taskInspection,tasksReady,taskRead.working,workspace.active,workspace.id,busy,cancelling,accountPending,pendingPreference,pendingNavigation,language,messages]);

  async function queryTaskText(format:(records:any[])=>string,options:{includeDiagnostics?:boolean;id?:string}={}){
    try{return format(await taskReader.read(workspace.id,options));}
    catch(error:any){return assistantTaskReadFailure(error?.code,language);}
  }

  useEffect(()=>{followConversation.current=true;},[workspace.id,panel,drawer]);
  useLayoutEffect(()=>{
    if(!workbench)return;
    for(const selector of ['.wj-assistant-role-item[aria-pressed="true"]','.wj-assistant-session-item[aria-current="true"]']){
      const selected=drawerRef.current?.querySelector<HTMLElement>(selector),list=selected?.closest<HTMLElement>('.wj-assistant-role-list,.wj-assistant-session-list');
      if(!selected||!list)continue;const item=selected.getBoundingClientRect(),box=list.getBoundingClientRect();
      if(item.top<box.top)list.scrollTop+=item.top-box.top;else if(item.bottom>box.bottom)list.scrollTop+=item.bottom-box.bottom;
    }
  },[workbench,workspace.id,workspace.role?.descriptor.id,workspace.snapshot.catalogRevision,filteredSessions]);
  useEffect(() => { if (followConversation.current&&conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight; }, [messages, sending, panel, drawer, workspace.id, canvasPlan.phase, canvasPlan.generation?.phase,chatView.stream.text]);
  useLayoutEffect(() => { localActionSubmitted.current = false; }, [message]);

  useLayoutEffect(() => {
    const launcher = launcherRef.current, parent = launcher?.parentElement;
    if (!launcher || !parent) return;
    const constrain = () => {
      if (!parent.clientWidth || !parent.clientHeight) return;
      setLauncherPosition(previous => previous ? clampAssistantLauncherPosition(previous, {width:parent.clientWidth,height:parent.clientHeight}, {width:launcher.offsetWidth,height:launcher.offsetHeight}) : null);
    };
    constrain();
    const observer = new ResizeObserver(constrain); observer.observe(parent);
    return () => observer.disconnect();
  }, [drawer, welcome]);

  function launcherCoordinates(launcher:HTMLButtonElement) {
    const parent = launcher.parentElement;
    if (!parent) return null;
    const box = launcher.getBoundingClientRect(), container = parent.getBoundingClientRect();
    return {parent, x:box.left - container.left - parent.clientLeft, y:box.top - container.top - parent.clientTop};
  }
  function persistLauncherPosition(position:{x:number;y:number}) {
    try { writeAssistantLauncherPosition(window.localStorage,position); } catch { /* Position remains usable for this session. */ }
  }
  function startLauncherDrag(event:React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const location = launcherCoordinates(event.currentTarget);
    if (!location) return;
    suppressLauncherClick.current = false;
    launcherDrag.current = {id:event.pointerId,startX:event.clientX,startY:event.clientY,originX:location.x,originY:location.y,moved:false};
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveLauncher(event:React.PointerEvent<HTMLButtonElement>) {
    const drag = launcherDrag.current, launcher = event.currentTarget, parent = launcher.parentElement;
    if (!drag || drag.id !== event.pointerId || !parent) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    event.preventDefault(); event.stopPropagation();
    const position = clampAssistantLauncherPosition({x:drag.originX + dx,y:drag.originY + dy}, {width:parent.clientWidth,height:parent.clientHeight}, {width:launcher.offsetWidth,height:launcher.offsetHeight});
    drag.latest = position; setLauncherPosition(position);
  }
  function endLauncherDrag(event:React.PointerEvent<HTMLButtonElement>) {
    if (launcherDrag.current?.id !== event.pointerId) return;
    suppressLauncherClick.current = launcherDrag.current.moved;
    if (launcherDrag.current.moved && launcherDrag.current.latest) persistLauncherPosition(launcherDrag.current.latest);
    launcherDrag.current = null;
    event.stopPropagation();
  }
  function cancelLauncherDrag(event:React.PointerEvent<HTMLButtonElement>) {
    if (launcherDrag.current?.id !== event.pointerId) return;
    launcherDrag.current = null; suppressLauncherClick.current = false;
  }
  function openLauncher(event:React.MouseEvent<HTMLButtonElement>) {
    if (suppressLauncherClick.current && event.detail !== 0) {suppressLauncherClick.current = false; return;}
    suppressLauncherClick.current = false; setPanel("chat"); setDrawer(true);
  }
  function moveLauncherWithKeyboard(event:React.KeyboardEvent<HTMLButtonElement>) {
    const dx = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0;
    const dy = event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0;
    if (!dx && !dy) return;
    const launcher = event.currentTarget, location = launcherCoordinates(launcher);
    if (!location) return;
    event.preventDefault(); event.stopPropagation();
    const position = clampAssistantLauncherPosition({x:location.x + dx,y:location.y + dy}, {width:location.parent.clientWidth,height:location.parent.clientHeight}, {width:launcher.offsetWidth,height:launcher.offsetHeight});
    setLauncherPosition(position); persistLauncherPosition(position);
  }

  useEffect(() => {
    if (!drawer || welcome || !drawerRef.current?.parentElement) return;
    const parent = drawerRef.current.parentElement;
    const constrain = () => {
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      setGeometry(previous => {
        const margin = Math.min(12, w / 4, h / 4);
        const width = Math.min(previous?.width ?? 440, Math.max(1, w - margin * 2));
        const height = Math.min(previous?.height ?? 510, Math.max(1, h - margin * 2));
        return {width, height, x: Math.max(margin, Math.min(previous?.x ?? w - width - 24, w - width - margin)), y: Math.max(margin, Math.min(previous?.y ?? (h - height) / 2, h - height - margin))};
      });
    };
    constrain();
    const observer = new ResizeObserver(constrain); observer.observe(parent);
    return () => observer.disconnect();
  }, [drawer, welcome]);

  function startPointer(event: React.PointerEvent<HTMLElement>, mode: "move" | "resize") {
    if (event.button !== 0 || !geometry || (mode === "move" && (event.target as HTMLElement).closest("button"))) return;
    event.preventDefault(); event.stopPropagation();
    pointerDrag.current = {id:event.pointerId, mode, startX:event.clientX, startY:event.clientY, rect:geometry};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: React.PointerEvent<HTMLElement>) {
    const drag = pointerDrag.current, parent = drawerRef.current?.parentElement;
    if (!drag || drag.id !== event.pointerId || !parent) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    const maxW = parent.clientWidth, maxH = parent.clientHeight, margin = Math.min(12, maxW / 4, maxH / 4);
    if (drag.mode === "move") setGeometry({...drag.rect, x:Math.max(margin, Math.min(drag.rect.x + dx, maxW - drag.rect.width - margin)), y:Math.max(margin, Math.min(drag.rect.y + dy, maxH - drag.rect.height - margin))});
    else setGeometry({...drag.rect, width:Math.max(Math.min(320, maxW - drag.rect.x - margin), Math.min(drag.rect.width + dx, maxW - drag.rect.x - margin)), height:Math.max(Math.min(280, maxH - drag.rect.y - margin), Math.min(drag.rect.height + dy, maxH - drag.rect.y - margin))});
  }
  function endPointer(event: React.PointerEvent<HTMLElement>) { if (pointerDrag.current?.id === event.pointerId) pointerDrag.current = null; }

  useEffect(() => {
    if (!ready || checked.current) return;
    try { if (shouldOfferAssistantOnboarding(ready, checked.current, !!localStorage.getItem(SEEN_KEY), hasConfiguration)) setWelcome(true); } catch { /* Storage unavailable: do not block startup. */ }
    checked.current = true;
  }, [ready, hasConfiguration]);

  useEffect(() => {
    if (!chatVisible) return;
    let active = true;
    const attempt = authAttempt.current;
    setStatusError(false);
    void (async () => {
      try {
        const result = await window.wanjuanDesktop?.assistantStatus?.();
        if (!result?.ok || !result.value || typeof result.value.configured !== "boolean" || typeof result.value.installed !== "boolean") throw new Error();
        if (active && attempt === authAttempt.current) { setStatus(result.value); setStatusError(false); }
      } catch {
        if (active && attempt === authAttempt.current) { setStatus(null); setStatusError(true); }
      }
    })();
    return () => { active = false; };
  }, [chatVisible, statusRevision]);

  useEffect(() => {
    if (!["initializing", "waiting", "exchanging", "committing"].includes(authPhase)) return;
    let active = true, running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await window.wanjuanDesktop?.assistantAccountStatus?.();
        if (!active || !result?.ok) return;
        const phase = result.value?.phase;
        if (phase && phase !== "idle") setAuthPhase(phase);
      } catch { /* Keep the pending state; a later poll can recover. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(poll, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [authPhase]);
  useEffect(() => {
    if (authPhase === "complete") {
      invalidateActionProposals();
      // Refresh credentials separately: the lightweight authorization status
      // must never wait for the model/storage queue.
      const attempt = authAttempt.current;
      void window.wanjuanDesktop?.assistantStatus?.().then((result: any) => {
        if (attempt !== authAttempt.current) return;
        if (result?.ok && result.value && typeof result.value.configured === "boolean" && typeof result.value.installed === "boolean") { setStatus(result.value); setStatusError(false); }
        else { setStatus(null); setStatusError(true); }
      }).catch(() => { if (attempt === authAttempt.current) { setStatus(null); setStatusError(true); } });
      dismiss(); setDrawer(true); setPanel("chat"); setKeyEntry(false); setMessages(previous => previous.length ? markAssistantSessionBoundary(previous, boundaryNotice) : previous); proposalFence.current = false; setRequiresReset(false); setChatError(""); setAuthPhase("idle");
    } else if (authPhase === "failed" || authPhase === "expired") {
      setChatError(authPhase === "expired" ? accountText.expired : accountText.failed); setAuthPhase("idle");
    } else if (authPhase === "cancelled") setAuthPhase("idle");
  }, [authPhase]);

  useEffect(() => {
    if (!welcome) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (authPhase === "idle") dismiss(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'));
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [welcome, authPhase]);

  function dismiss() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* Continue without persistence. */ }
    setWelcome(false);
  }
  function openSetup() { dismiss(); setKey(""); setDrawer(false); onOpenSetup(); }
  function openKeySetup() { dismiss(); setDrawer(true); setPanel("settings"); setKeyEntry(true); }
  async function refreshStatus() {
    try {
      const result = await window.wanjuanDesktop?.assistantStatus?.();
      if (!result?.ok || !result.value || typeof result.value.configured !== "boolean" || typeof result.value.installed !== "boolean") throw new Error();
      setStatus(result.value); setStatusError(false); return result.value as AssistantStatus;
    } catch { setStatus(null); setStatusError(true); throw new Error(); }
  }
  async function startAccount() {
    if (authPhase !== "idle" || busy) return;
    const attempt = ++authAttempt.current;
    setChatError(""); setAuthPhase("initializing");
    try {
      const result = await window.wanjuanDesktop?.assistantAccountStart?.();
      if (attempt !== authAttempt.current) return;
      if (!result?.ok) throw new Error();
      setAuthPhase(result.value?.phase || "waiting");
    } catch { if (attempt === authAttempt.current) { setChatError(accountText.failed); setAuthPhase("idle"); } }
  }
  async function cancelAccount() {
    authAttempt.current++;
    try {
      const result = await window.wanjuanDesktop?.assistantAccountCancel?.();
      if (!result?.ok) throw new Error();
      setAuthPhase(result.value?.phase || "idle");
    } catch { setChatError(accountText.failed); }
  }
  async function removeAccount() {
    if (busy || accountPending) return;
    invalidateActionProposals();
    setBusy(true); setChatError("");
    try {
      const result = await window.wanjuanDesktop?.assistantAccountClear?.();
      if (!result?.ok) throw new Error();
      await refreshStatus();
      // No model credential is needed for local commands. Leave key entry
      // optional so the user can return to chat after removing the account.
      setMessages(previous => workspace.active ? clearAssistantProposals(previous) : []); proposalFence.current = false; setRequiresReset(false); setKeyEntry(false);
    } catch {
      proposalFence.current = true; setRequiresReset(true); setStatus(null); setStatusError(true);
      setChatError(language === "en-US" ? "Could not confirm account removal or the conversation state. Check assistant status before starting a new conversation." : language === "zh-TW" ? "無法確認帳號是否已移除或對話狀態；請先檢查助手狀態，再開始新對話。" : "无法确认账号是否已移除或对话状态；请先检查助手状态，再开始新对话。");
    } finally { setBusy(false); }
  }
  async function openKeyPlatform() {
    try {
      const result = await window.wanjuanDesktop?.openExternal?.("https://platform.deepseek.com/api_keys");
      if (!result?.ok) throw new Error();
      setChatError("");
    } catch { setChatError(t.keyOpenError); }
  }
  async function saveKey() {
    if (!key.trim() || busy || accountPending) return;
    invalidateActionProposals();
    setBusy(true); setChatError(""); setConnectionNotice("");
    const value = key; setKey("");
    let failureCode = "";
    try {
      const result = await window.wanjuanDesktop?.assistantSetKey?.(value);
      if (!result?.ok) { failureCode = result?.code || ""; throw new Error(); }
      await refreshStatus();
      setKeyEntry(false); setPanel("chat"); setMessages(previous => workspace.active ? clearAssistantProposals(previous) : []); proposalFence.current = false; setRequiresReset(false);
    } catch {
      if (failureCode !== "ASSISTANT_INVALID_KEY") {
        proposalFence.current = true; setRequiresReset(true); setStatus(null); setStatusError(true);
        const uncertain = language === "en-US" ? "The conversation state must be reset after the key operation failed." : language === "zh-TW" ? "金鑰操作失敗，對話狀態需要重新確認。" : "密钥操作失败，对话状态需要重新确认。";
        setMessages(previous => previous.length ? markAssistantSessionBoundary(previous, uncertain) : previous);
      }
      setChatError(failureCode === "ASSISTANT_INVALID_KEY"
        ? (language === "en-US" ? "The key contains unsupported control characters or is too long. Re-enter it." : language === "zh-TW" ? "金鑰含不支援的控制字元或過長，請重新輸入。" : "密钥含不支持的控制字符或过长，请重新输入。")
        : (language === "en-US" ? "Could not confirm whether the key was saved. Check assistant status and system secure storage before retrying." : language === "zh-TW" ? "無法確認金鑰是否已儲存；請先檢查助手狀態與系統安全儲存，再決定是否重試。" : "无法确认密钥是否已保存；请先检查助手状态与系统安全存储，再决定是否重试。"));
    } finally { setBusy(false); }
  }
  async function removeKey() {
    if (busy || accountPending) return;
    invalidateActionProposals();
    setBusy(true); setChatError(""); setConnectionNotice("");
    try {
      const result = await window.wanjuanDesktop?.assistantClearKey?.();
      if (!result?.ok) throw new Error();
      await refreshStatus();
      // Keep the local assistant reachable even when this was the last key.
      setMessages(previous => workspace.active ? clearAssistantProposals(previous) : []); setKeyEntry(false); proposalFence.current = false; setRequiresReset(false);
    } catch {
      proposalFence.current = true; setRequiresReset(true); setStatus(null); setStatusError(true);
      setChatError(language === "en-US" ? "Could not confirm key removal or the conversation state. Check assistant status before starting a new conversation." : language === "zh-TW" ? "無法確認金鑰是否已移除或對話狀態；請先檢查助手狀態，再開始新對話。" : "无法确认密钥是否已移除或对话状态；请先检查助手状态，再开始新对话。");
    } finally { setBusy(false); }
  }
  async function checkConnection() {
    if (busy || accountPending || !status?.configured) return;
    setBusy(true); setConnectionNotice("");
    try {
      const result = await window.wanjuanDesktop?.assistantCheckConnection?.();
      if (result?.ok && typeof result.value?.modelAvailable === "boolean") setConnectionNotice(result.value.modelAvailable ? connectionText.ready : connectionText.missing);
      else if (result?.code === "ASSISTANT_AUTH_REJECTED") setConnectionNotice(connectionText.auth);
      else if (result?.code === "ASSISTANT_RATE_LIMITED") setConnectionNotice(connectionText.rate);
      else setConnectionNotice(connectionText.other);
    } catch { setConnectionNotice(connectionText.other); } finally { setBusy(false); }
  }
  function canvasFailure(error:any){const state=workspace.controller.viewFor(workspace.id).canvasPlan,g=state.generation;setChatNotice(g?.code&&g.code===error?.code?(g.phase==='uncertain'?assistantGenerationCopy(language).unknown:assistantGenerationCopy(language).failed):!error?.code&&['applied','undone'].includes(state.phase)?assistantCanvasPostCommitNotice(language):assistantCanvasError(error?.code||'PLAN_REQUEST_FAILED',language));}
  function canvasAction(action:()=>unknown){followConversation.current=true;try{const value=action();if(value&&typeof(value as any).catch==='function')void(value as Promise<unknown>).catch(canvasFailure);}catch(error){canvasFailure(error);}}
  function beginCanvasPlan(){canvasAction(()=>canvasPlanner.begin(workspace.id,projectId,projectName));}
  function requestCanvasPlan(){
    if(accountPending||cancelling||pendingPreference||pendingNavigation||taskInspection)return;
    canvasAction(()=>canvasPlanner.request(workspace.id,projectId,message.trim(),{custom:customRole,environment:agentWorkspace?.environment,ready:workspace.active&&ready&&(customRole?!!agentWorkspace:!!status?.installed&&!!status?.configured&&!requiresReset&&!proposalFence.current),notice:canvasCopy.ready}));
  }
  function sendChatOrPlan(){
    followConversation.current=true;
    if(workspace.view.canvasPlan.working||workspace.view.canvasPlan.pendingOperation)return;
    if(workspace.view.canvasPlan.phase==='scope'){requestCanvasPlan();return;}
    if(workspace.view.canvasPlan.phase==='preview'||workspace.view.canvasPlan.phase==='invalid')canvasAction(()=>canvasPlanner.dismiss(workspace.id));
    void sendMessage();
  }
  async function sendMessage() {
    const text = message.trim() || (customRole&&attachments.length?mediaCopy.prompt:'');
    if (workspace.active && (workspace.controller.getSnapshot().switching || workspace.controller.getSnapshot().selectedId !== workspace.id)) return;
    if (workspace.available && !workspace.active) { setChatError(workspace.snapshot.phase === "failed" ? "ASSISTANT_WORKSPACE_UNAVAILABLE" : "ASSISTANT_WORKSPACE_LOADING"); return; }
    const localWhileCancelled = modelCancellationRequested.current && !cancelInFlight.current && modelSendInFlight.current;
    if (!text || workspace.view?.taskRead?.working || workspace.view?.importingMedia || localActionSubmitted.current || pendingTaskInspection.current || (busy && !localWhileCancelled) || cancelling || cancelInFlight.current || resetInFlight.current || accountPending || (modelSendInFlight.current && !localWhileCancelled) || navigationInFlight.current !== null || preferenceInFlight.current || pendingPreference || pendingNavigation) return;
    if (containsLikelyAssistantSecret(text)) {
      setChatError(language === "en-US" ? "This message may contain a credential. Remove it before sending; nothing was sent." : language === "zh-TW" ? "內容可能包含憑證，請移除後再傳送；本次未傳送。" : "内容可能包含凭据，请移除后再发送；本次未发送。");
      return;
    }
    if (customRole) {await sendRoleMessage(text);return;}
    // Invalidate the currently rendered proposal objects immediately. React's
    // queued message update may not have committed when another click arrives.
    for (const item of messages) if (item.action || item.preference) consumedActions.current.add(item);
    const sendingDiagnostic = diagnosticDraft.current && isAssistantDiagnosticDraft(text);
    if (!sendingDiagnostic) {
    const reportNotReady = (needsSettings = true) => {
      setMessage(""); setChatError(""); setChatNotice("");
      const reply = needsSettings && settingsUnavailable ? (language === "en-US" ? "Local settings could not be read reliably. Automatic settings saves are paused to protect your configuration; check storage and restart the app." : language === "zh-TW" ? "無法可靠讀取本機設定。為保護原有設定，已暫停自動儲存；請檢查儲存空間後重新啟動應用程式。" : "无法可靠读取本地设置。为保护原有配置，已暂停自动保存；请检查存储后重新启动应用。") : language === "en-US" ? "App state is still loading. Please try again shortly." : language === "zh-TW" ? "軟體狀態仍在載入，請稍後再試。" : "软件状态仍在加载，请稍后再试。";
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
    };
    if (isAssistantMixedHowToAction(text)) {
      const reply = language === "en-US" ? "Please ask how to do it separately from the state you want to check or the action you want to perform. Nothing was changed." : language === "zh-TW" ? "請將操作方法與要查詢的狀態或執行的動作分開詢問；本次沒有更改任何內容。" : "请将操作方法与要查询的状态或执行的动作分开询问；本次没有更改任何内容。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isAssistantFutureTaskInquiry(text)) {
      const reply = language === "en-US" ? "I can't predict a task's future status. You can ask me about the current task list." : language === "zh-TW" ? "我無法預測任務未來的狀態；你可以詢問目前的任務清單。" : "我无法预测任务未来的状态；你可以询问当前的任务清单。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isAssistantDeferredOperation(text)) {
      const reply = language === "en-US" ? "I can't schedule an app action yet. Nothing was changed; please ask again when you want to do it." : language === "zh-TW" ? "目前無法預約軟體操作，也沒有更改任何內容；需要執行時請再告訴我。" : "目前无法预约软件操作，也没有更改任何内容；需要执行时请再告诉我。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isAssistantUnsupportedOperation(text)) {
      const reply = language === "en-US" ? "I can't perform that operation. Nothing was changed or generated in this response." : language === "zh-TW" ? "我無法執行這項操作；本次沒有變更任何內容，也沒有開始產生。" : "我无法执行这项操作；本次没有更改任何内容，也没有开始生成。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isAssistantLastOperationInquiry(text)) {
      const reply = assistantLastOperationReceipt(messages, language);
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isAssistantProjectTaskInquiry(text)) {
      if (!tasksReady) { reportNotReady(false); return; }
      const diagnosis = parseAssistantCurrentProjectDiagnosis(text);
      const projectPrefix = language === "en-US" ? "Current project — " : language === "zh-TW" ? "目前專案—" : "当前项目—";
      setMessage(""); setChatError(""); setChatNotice("");
      const reply=await queryTaskText(tasks=>{const selected=diagnosis?selectAssistantCurrentProjectTasks(tasks,projectId):null;return selected&&diagnosis?projectPrefix+(diagnosis==='all'?buildAssistantLocalDiagnosis(selected,language):buildAssistantTypedDiagnosis(selected,diagnosis,language)):formatAssistantCurrentProjectTasks(tasks,projectId,text,language)||(language==='en-US'?'I cannot reliably filter tasks by project. Check the task list, or ask for the overall task status.':language==='zh-TW'?'目前無法可靠依專案篩選任務，請查看任務清單，或詢問全部任務狀態。':'目前无法可靠按项目筛选任务，请查看任务清单，或询问全部任务状态。');},{includeDiagnostics:!!diagnosis});
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const diagnosisTaskId = parseAssistantTaskIdDiagnosis(text);
    if (diagnosisTaskId !== null) {
      if (!tasksReady) { reportNotReady(false); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      const reply=await queryTaskText(tasks=>buildAssistantSelectedTaskResponse(tasks,tasks[0]?.id||diagnosisTaskId,language),{id:diagnosisTaskId,includeDiagnostics:true});
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const requestedTaskId = parseAssistantTaskIdQuery(text);
    if (requestedTaskId !== null) {
      if (!tasksReady) { reportNotReady(false); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      const reply=await queryTaskText(tasks=>formatAssistantTaskById(tasks,tasks[0]?.id||requestedTaskId,language),{id:requestedTaskId});
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const typedDiagnosis = classifyAssistantTypedDiagnosis(text);
    if (typedDiagnosis) {
      if (!tasksReady) { reportNotReady(false); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      const reply = typedDiagnosis === "specific" ? (language === "en-US" ? "I cannot reliably identify that individual task. Check the task list, or ask about a task category." : language === "zh-TW" ? "無法可靠定位你指的單一任務；請查看任務清單，或詢問某一類任務。" : "无法可靠定位你指的单条任务；请查看任务清单，或询问某一类任务。") : typedDiagnosis === "model_scope" ? (language === "en-US" ? "I can't reliably filter failures by model. Check the task list or ask about image, video, audio, or text tasks." : language === "zh-TW" ? "無法可靠地按模型篩選失敗任務；請查看任務清單，或詢問圖片、影片、音訊或文字任務。" : "无法可靠地按模型筛选失败任务；请查看任务清单，或询问图片、视频、音频或文本任务。") : typedDiagnosis === "ambiguous" ? (language === "en-US" ? "Please ask about one task type at a time." : language === "zh-TW" ? "請一次查詢一種任務類型。" : "请一次查询一种任务类型。") : typedDiagnosis === "unsupported_music" ? (language === "en-US" ? "Music tasks may be stored as audio, so I cannot reliably isolate music failures. Check the task list or ask about audio tasks." : language === "zh-TW" ? "音樂任務可能記為音訊，無法可靠區分音樂失敗記錄；請查看任務清單，或詢問音訊任務。" : "音乐任务可能记为音频，无法可靠区分音乐失败记录；请查看任务清单，或询问音频任务。") : await queryTaskText(tasks=>buildAssistantTypedDiagnosis(tasks,typedDiagnosis,language),{includeDiagnostics:true});
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const taskIntent = parseAssistantTaskIntent(text);
    if (taskIntent) {
      if (!tasksReady) { reportNotReady(false); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      const reply=await queryTaskText(tasks=>taskIntent==='summary'?formatAssistantTaskSummary(tasks,language):buildAssistantLocalDiagnosis(tasks,language),{includeDiagnostics:taskIntent!=='summary'});
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (isUnscopedAssistantStatusInquiry(text)) {
      const reply = language === "en-US" ? "Which task, setting, or action do you mean? I can't determine its status from this question alone." : language === "zh-TW" ? "你指的是哪個任務、設定或操作？僅憑這個問題無法確認狀態。" : "你指的是哪个任务、设置或操作？仅凭这个问题无法确认状态。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const destination = parseAssistantLocalNavigation(text);
    if (destination && canNavigateLocal) {
      if (!assistantNavigationAvailable(destination, navigationReady, ready)) { reportNotReady(navigationReady); return; }
      localActionSubmitted.current = true;
      setMessage(""); setChatError(""); setChatNotice(""); setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}]);
      await requestNavigation(destination);
      return;
    }
    const preference = canSetPreference && themeMode ? parseAssistantPreferenceIntent(text) : null;
    if (preference) {
      if (!ready) { reportNotReady(); return; }
      if (preference.kind !== "read" && preference.kind !== "read_download") localActionSubmitted.current = true;
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}]);
      if (preference.kind === "read") {
        try{const values=await localActions.read(workspace.id);const text=formatAssistantAppearanceState(values.theme,values.language,document.documentElement,!!window.matchMedia?.("(prefers-color-scheme: light)").matches);setMessages(previous=>[...previous,{role:'assistant',text}]);}
        catch{setChatError(assistantPreferenceUncertainNotice(language));}
      } else if (preference.kind === "read_download") {
        try{const values=await localActions.read(workspace.id);const text=formatAssistantAutoDownloadState(values.autoDownload,document.documentElement.dataset.wanjuanAutoDownloadListener,language,!!window.wanjuanDesktop);setMessages(previous=>[...previous,{role:'assistant',text}]);}
        catch{setChatError(assistantPreferenceUncertainNotice(language));}
      } else {
        await requestPreference(preference);
      }
      return;
    }
    if (isAmbiguousAssistantOperation(text)) {
      const reply = language === "en-US" ? "Please specify what you want to change or open, and the desired setting. I have not changed anything." : language === "zh-TW" ? "請說明要開啟或變更哪一項，以及希望設定成什麼；我沒有更改任何內容。" : "请说明要打开或更改哪一项，以及希望设置成什么；我没有更改任何内容。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    const settingChangeQuestion = classifyAssistantSettingChangeQuestion(text);
    if (settingChangeQuestion) {
      if (!ready) { reportNotReady(); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      let current:string;try{const values=await localActions.read(workspace.id);current=settingChangeQuestion==='download'?formatAssistantAutoDownloadState(values.autoDownload,document.documentElement.dataset.wanjuanAutoDownloadListener,language,!!window.wanjuanDesktop):formatAssistantAppearanceState(values.theme,values.language,document.documentElement,!!window.matchMedia?.('(prefers-color-scheme: light)').matches);}catch{current=assistantPreferenceUncertainNotice(language);}
      const uncertainty = language === "en-US" ? "I cannot determine what the previous value was or why it changed from the current state alone." : language === "zh-TW" ? "僅憑目前狀態，無法確認之前的值或變更原因。" : "仅凭当前状态，无法确认之前的值或变化原因。";
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:`${current}\n${uncertainty}`}]);
      return;
    }
    const stateInquiry = classifyAssistantStateInquiry(text);
    if (stateInquiry) {
      const needsSettings = stateInquiry === "preferences" || stateInquiry === "download" || stateInquiry === "ambiguous";
      if (!(needsSettings ? ready : tasksReady)) { reportNotReady(needsSettings); return; }
      setMessage(""); setChatError(""); setChatNotice("");
      let reply:string;
      if (stateInquiry === "tasks") reply = await queryTaskText(tasks=>formatAssistantTaskSummary(tasks, language));
      else if (stateInquiry.startsWith("tasks_")) reply = await queryTaskText(tasks=>formatAssistantTaskCategory(tasks, stateInquiry.slice(6) as AssistantTaskCategory, language));
      else if (stateInquiry === "single_task_progress") reply = await queryTaskText(tasks=>formatAssistantSingleTaskProgress(tasks, language));
      else if (stateInquiry.startsWith("task_progress_")) reply = await queryTaskText(tasks=>formatAssistantTypedTaskProgress(tasks,stateInquiry.slice(14) as AssistantTaskCategory,language));
      else if (stateInquiry === "indeterminate_task_eta") reply = language === "en-US" ? "I can't reliably estimate when generation will finish. Check the task list for its current status; no task was retried." : language === "zh-TW" ? "無法可靠預估產生何時完成；請查看任務清單的目前狀態，本次沒有重新執行任務。" : "无法可靠预估生成何时完成；请查看任务清单的当前状态，本次没有重新执行任务。";
      else if (stateInquiry === "indeterminate_task_progress") reply = language === "en-US" ? "I can't reliably identify a single task's progress from this question. Check the task list, or ask for the overall task status." : language === "zh-TW" ? "無法根據這個問題可靠定位單一任務的進度；請查看任務清單，或詢問整體任務狀態。" : "无法根据这个问题可靠定位单条任务的进度；请查看任务清单，或询问整体任务状态。";
      else if (stateInquiry === "ambiguous_task_types") reply = language === "en-US" ? "Please ask about one task type at a time." : language === "zh-TW" ? "請一次查詢一種任務類型。" : "请一次查询一种任务类型。";
      else if (stateInquiry === "unsupported_music") reply = language === "en-US" ? "Music tasks may be stored as audio, so I cannot reliably separate all music tasks. Check the task list or ask about all tasks." : language === "zh-TW" ? "音樂任務可能記為音訊，無法可靠區分全部音樂任務。請查看任務清單，或查詢全部任務。" : "音乐任务可能记为音频，无法可靠区分全部音乐任务。请查看任务清单，或查询全部任务。";
      else if (stateInquiry === "latest_task") reply = await queryTaskText(tasks=>formatAssistantLatestTask(tasks, language));
      else if (stateInquiry === "indeterminate_task_stall") reply = language === "en-US" ? "I can't determine whether a task is stuck from its status alone. You can ask for the current task list; no task has been retried." : language === "zh-TW" ? "僅憑任務狀態無法判斷是否卡住。你可以查詢目前任務清單；我沒有重新執行任務。" : "仅凭任务状态无法判断是否卡住。你可以查询当前任务清单；我没有重新执行任务。";
      else if (stateInquiry === "preferences") {
        try{const values=await localActions.read(workspace.id);reply=formatAssistantAppearanceState(values.theme,values.language,document.documentElement,!!window.matchMedia?.("(prefers-color-scheme: light)").matches);}catch{reply=assistantPreferenceUncertainNotice(language);}
      } else if (stateInquiry === "download") {
        try{const values=await localActions.read(workspace.id);reply=formatAssistantAutoDownloadState(values.autoDownload,document.documentElement.dataset.wanjuanAutoDownloadListener,language,!!window.wanjuanDesktop);}catch{reply=assistantPreferenceUncertainNotice(language);}
      } else if (stateInquiry === "unsupported") reply = language === "en-US" ? "I can summarize local task status and offer basic troubleshooting, but I cannot inspect task content or model details here." : language === "zh-TW" ? "我可以彙總本機任務狀態並提供基礎排查，但目前無法查看任務內容或模型詳情。" : "我可以汇总本地任务状态并提供基础排查，但目前无法查看任务内容或模型详情。";
      else if (stateInquiry === "specific_task") reply = language === "en-US" ? "I cannot reliably identify that individual task. Check the task list, or ask for the status of all tasks." : language === "zh-TW" ? "我無法可靠定位你指的單一任務。請查看任務清單，或詢問全部任務的狀態。" : "我无法可靠定位你指的单条任务。请查看任务清单，或询问全部任务的状态。";
      else reply = language === "en-US" ? "Please ask about one item at a time: appearance, automatic downloads, or task status." : language === "zh-TW" ? "請一次詢問一項：主題語言、自動下載或任務狀態。" : "请一次询问一项：主题语言、自动下载或任务状态。";
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    if (requiresAssistantLocalStateEvidence(text)) {
      const reply = language === "en-US" ? "I can't reliably determine that from your question. Please ask for the current task status, theme, language, or automatic-download setting." : language === "zh-TW" ? "我無法根據這個問題可靠判斷目前狀態；請具體詢問任務狀態、主題、語言或自動下載設定。" : "我无法根据这个问题可靠判断当前状态；请具体询问任务状态、主题、语言或自动下载设置。";
      setMessage(""); setChatError(""); setChatNotice("");
      setMessages(previous => [...clearAssistantProposals(previous), {role:"user",text}, {role:"assistant",text:reply}]);
      return;
    }
    }
    // Exact local operations do not depend on a model session. Unrecognized
    // requests still require a configured runtime and a clean conversation.
    if (modelSendInFlight.current) {
      setChatError(language === "en-US" ? "The previous model request is still finishing. Local commands are available; wait before sending another model request." : language === "zh-TW" ? "先前的模型請求仍在結束中。本機操作可用；傳送新的模型請求前請稍候。" : "之前的模型请求仍在结束中。本地操作可用；发送新的模型请求前请稍候。");
      return;
    }
    if (!status || !status.installed || !status.configured || requiresReset || proposalFence.current) {
      setChatError(!status ? (language === "en-US" ? "Assistant status is unconfirmed, so model requests are unavailable. Local commands remain available." : language === "zh-TW" ? "智慧助手狀態尚未確認，暫時無法傳送模型請求；本機操作仍可使用。" : "智能助手状态尚未确认，暂时无法发送模型请求；本地操作仍可使用。") : requiresReset || proposalFence.current ? (language === "en-US" ? "Start a new conversation before sending a model request. Local commands remain available." : language === "zh-TW" ? "傳送模型請求前請先開始新對話；本機操作仍可使用。" : "发送模型请求前请先开始新对话；本地操作仍可使用。") : !status.installed ? t.runtimeMissing : (language === "en-US" ? "Connect the assistant in Assistant settings to use model chat. Local commands remain available." : language === "zh-TW" ? "請在助手設定中連接智慧助手以使用模型對話；本機操作仍可使用。" : "请在助手设置中连接智能助手以使用模型对话；本地操作仍可使用。"));
      return;
    }
    const requestedProjectId = projectId, requestedProjectName = projectName;
    const requestedInputRevision = inputRevision.current;
    const restoreDraftIfUnchanged = () => {
      if (inputRevision.current !== requestedInputRevision) return;
      diagnosticDraft.current = sendingDiagnostic;
      // React can apply the state update later, after a further user edit.
      setMessage(current => inputRevision.current === requestedInputRevision ? current || text : current);
    };
    let failureCode: unknown = null;
    modelCancellationRequested.current = false;
    modelSendInFlight.current = true;
    diagnosticDraft.current = false;
    setMessage(""); setMessages(previous => [...clearAssistantProposals(previous), {role:"user", text}]); setBusy(true); setSending(true); setChatError(""); setChatNotice("");
    try {
      const result = workspace.active
        ? await workspace.controller.send(workspace.id,text,{view:activeView,settingsTab:activeSettingsTab})
        : await window.wanjuanDesktop?.assistantSend?.(text, {view:activeView, settingsTab:activeSettingsTab});
      if (modelCancellationRequested.current) { restoreDraftIfUnchanged(); return; }
      if (result?.code === "ASSISTANT_CANCELLED") { restoreDraftIfUnchanged(); setMessages(previous => markAssistantSessionBoundary(previous, boundaryNotice)); setChatNotice(workspace.active ? sessionStopNotice : t.chatStopped); return; }
      if (result?.code === "ASSISTANT_BUSY") {
        restoreDraftIfUnchanged();
        setMessages(previous => previous.slice(0, -1));
        setChatError(language === "en-US" ? "Another assistant task is running. Try again when it finishes." : language === "zh-TW" ? "智慧助手正在執行另一項任務，請完成後再試。" : "智能助手正在执行另一项任务，请完成后再试。");
        return;
      }
      if (result?.code === "ASSISTANT_SENSITIVE_INPUT") {
        restoreDraftIfUnchanged();
        setMessages(previous => previous.slice(0, -1));
        setChatError(language === "en-US" ? "This message may contain a credential. Remove it before sending; nothing was sent." : language === "zh-TW" ? "內容可能包含憑證，請移除後再傳送；本次未傳送。" : "内容可能包含凭据，请移除后再发送；本次未发送。");
        return;
      }
      if (!result?.ok || typeof result.value !== "string") { failureCode = result?.code; throw new Error(); }
      const parsed = parseAssistantReply(result.value);
      const isProposal = !!(parsed.action || parsed.preference);
      const permitted = !isProposal || (!sendingDiagnostic && mayOfferAssistantAction(text) && assistantProposalMatchesRequest(text,parsed));
      const proposalText = language === "en-US" ? "Suggested action; not yet performed. Confirm below to proceed." : language === "zh-TW" ? "以下是建議操作，尚未執行；請確認後繼續。" : "以下是建议操作，尚未执行；请确认后继续。";
      const blockedText = language === "en-US" ? "No action was taken. Please state one specific action if you want to proceed." : language === "zh-TW" ? "未執行任何操作；如需操作，請明確說明單一動作。" : "未执行任何操作；如需操作，请明确说明单一动作。";
      const unverifiedText = language === "en-US" ? "I cannot verify that any app action occurred. Please state the specific action you want to perform." : language === "zh-TW" ? "無法確認軟體已執行任何操作，請明確說明要執行的動作。" : "无法确认软件已执行任何操作，请明确说明要执行的动作。";
      setMessages(previous => [...previous, {role:"assistant", ...parsed, ...(parsed.invalidProtocol ? {text:blockedText,executionStatus:"rejected" as const} : isProposal ? {text:permitted ? proposalText : blockedText} : requiresAssistantOperationReceipt(text) || hasUnverifiedAssistantActionClaim(parsed.text) ? {text:unverifiedText} : {modelReply:true}), ...(!permitted ? {action:null,preference:undefined,draft:undefined} : {}), actionProjectId:requestedProjectId, actionProjectName:requestedProjectName}]);
    } catch {
      if (modelCancellationRequested.current) { restoreDraftIfUnchanged(); return; }
      restoreDraftIfUnchanged();
      if (failureCode === "ASSISTANT_RUNTIME_STOP_UNCONFIRMED") {
        proposalFence.current = true; setRequiresReset(true);
        setChatError(language === "en-US" ? "The previous assistant session could not be confirmed safely closed and cleaned up. Start a new conversation to recheck; a request already sent may still be charged." : language === "zh-TW" ? "無法確認先前的智慧助手工作階段已安全關閉並完成清理。請開始新對話以重新檢查；已傳送的請求仍可能計費。" : "无法确认之前的智能助手会话已安全关闭并完成清理。请开始新对话以重新检查；已发出的请求仍可能计费。");
      } else if (typeof failureCode === "string" && failureCode.startsWith("ASSISTANT_")) {
        setMessages(previous => markAssistantSessionBoundary(previous, boundaryNotice));
        setChatError(failureCode === "ASSISTANT_PROVIDER_AUTH" && status.authMode === "account" ? accountText.rejected : assistantChatFailureMessage(failureCode, language,{retainedHistory:workspace.active}));
      } else {
        // If IPC itself failed, the host may still have the old session. Do not
        // pretend it reset or let the next message inherit unknown context.
        setRequiresReset(true);
        setChatError(language === "en-US" ? "Conversation state is uncertain. Start a new conversation before sending again." : language === "zh-TW" ? "無法確認對話狀態。請先開始新對話再傳送。" : "无法确认对话状态，请先开始新对话再发送。");
      }
    } finally { modelSendInFlight.current = false; setBusy(false); setSending(false); setCancelledTurnWaiting(false); }
  }
  async function startNewChat() {
    if (workspace.view?.taskRead?.working || pendingTaskInspection.current || busy || cancelling || cancelInFlight.current || resetInFlight.current || accountPending || modelSendInFlight.current || navigationInFlight.current !== null || preferenceInFlight.current || pendingPreference || pendingNavigation) return;
    resetInFlight.current = true;
    // Invalidate immediately, not after the asynchronous reset resolves. A
    // failed or hanging reset must never leave old confirmation controls live.
    proposalFence.current = true;
    setMessages(previous => clearAssistantProposals(previous));
    setBusy(true); setChatError(""); setChatNotice("");
    try {
      const result = workspace.active
        ? await (async () => { await workspace.controller.cancel(workspace.id); await workspace.controller.create(projectId); return {ok:true}; })()
        : await window.wanjuanDesktop?.assistantReset?.();
      if (!result?.ok) throw new Error();
      setMessages(previous => markAssistantSessionBoundary(previous, boundaryNotice));
      setRequiresReset(false);
      proposalFence.current = false;
    } catch {
      setRequiresReset(true);
      setChatError(language === "en-US" ? "Could not confirm the reset. Try starting a new conversation again after other analysis finishes." : language === "zh-TW" ? "無法確認對話已重設。請等其他分析完成後，再試一次。" : "无法确认对话已重置。请等其他分析完成后，再试一次。");
    } finally { resetInFlight.current = false; setBusy(false); }
  }
  async function stopMessage() {
    if (!sending || !modelSendInFlight.current || modelCancellationRequested.current || resetInFlight.current || cancelling || cancelInFlight.current) return;
    modelCancellationRequested.current = true; cancelInFlight.current = true;
    setCancelling(true);
    try {
      const result = workspace.active ? await workspace.controller.cancel(workspace.id) : await window.wanjuanDesktop?.assistantCancel?.(); if (!result?.ok) throw new Error();
      setMessages(previous => markAssistantSessionBoundary(previous, boundaryNotice)); setChatError(""); setChatNotice(workspace.active ? sessionStopNotice : t.chatStopped);
    } catch {
      // The host may still have accepted or completed the request. Do not
      // expose its answer or allow a new model turn to inherit that session.
      proposalFence.current = true; setRequiresReset(true);
      setChatError(language === "en-US" ? "Could not confirm that the assistant session stopped. Start a new conversation before sending again; the request may still be charged." : language === "zh-TW" ? "無法確認智慧助手工作階段已停止。再次傳送前請先開始新對話；請求仍可能計費。" : "无法确认智能助手会话已停止。再次发送前请先开始新对话；请求仍可能计费。");
    } finally { cancelInFlight.current = false; setCancelling(false); setCancelledTurnWaiting(modelSendInFlight.current); }
  }
  async function addFailureSummary(taskId?:string) {
    const owner=workspace.id,revision=inputRevision.current;let tasks:any[];
    try{tasks=await taskReader.read(owner,{includeDiagnostics:true,...(taskId?{id:taskId}:{})});}catch(error:any){setChatNotice(assistantTaskReadFailure(error?.code,language));return;}
    if(workspace.controller.getSnapshot().selectedId!==owner||inputRevision.current!==revision){setChatNotice(language==='en-US'?'The draft or conversation changed; no summary was inserted. Click again when ready.':language==='zh-TW'?'草稿或對話已變更，沒有插入摘要；準備好後可再次點選。':'草稿或会话已改变，没有插入摘要；准备好后可再次点击。');return;}
    const summary = buildAssistantFailureSummary(tasks, language,taskId?'selected':'list');
    if (!summary) { setChatNotice(buildAssistantLocalDiagnosis(tasks, language)); return; }
    const next = message.trim() ? `${message.trimEnd()}\n\n${summary}` : summary;
    if (next.length > 16000) { setChatNotice(t.draftFull); return; }
    diagnosticDraft.current = true; setMessage(next); setChatNotice(""); setChatError("");
  }
  async function requestNavigation(destination:AssistantDestination, proposalIndex?:number) {
    if (!assistantNavigationAvailable(destination, navigationReady, ready)) {
      const text = navigationReady && settingsUnavailable
        ? (language === "en-US" ? "Cannot open settings while local settings are unavailable. Check storage and restart the app." : language === "zh-TW" ? "本機設定無法讀取，暫時不能開啟設定頁。請檢查儲存空間後重新啟動應用程式。" : "本地设置无法读取，暂时不能打开设置页。请检查存储后重新启动应用。")
        : (language === "en-US" ? "App state is still loading. Please try again shortly." : language === "zh-TW" ? "軟體狀態仍在載入，請稍後再試。" : "软件状态仍在加载，请稍后再试。");
      setMessages(previous => [...previous, {role:"assistant",text}]); return;
    }
    if (!canNavigateLocal || navigationInFlight.current !== null) return;
    // Consume the exact rendered object before asynchronous authority work.
    if (proposalIndex !== undefined) {
      const proposal = messages[proposalIndex];
      if (!proposal || consumedActions.current.has(proposal)) return;
      consumedActions.current.add(proposal);
    }
    if (proposalIndex !== undefined) {
      setMessages(previous => consumeAssistantNavigationProposal(previous, proposalIndex, language));
    }
    try {
      await localActions.run(workspace.id,'app.navigate',projectId,{destination},{intent:crypto.randomUUID(),
        receipt:result=>assistantNavigationOperationReceipt(result.destination,language),
        failure:code=>({text:code==='OPERATION_NAVIGATION_REFUSED'?assistantNavigationRejectedNotice(language):assistantNavigationUnconfirmedNotice(language),executionStatus:code==='OPERATION_NAVIGATION_REFUSED'?'rejected':'unconfirmed'}),
      });
      onNavigationNotice?.(assistantNavigationOperationReceipt(destination,language));
    } catch {
      if(!['failed','uncertain'].includes(workspace.controller.viewFor(workspace.id).localAction.phase))setChatError(assistantNavigationUnconfirmedNotice(language));
    }
  }
  function openSuggestedAction(action: AssistantNavigationAction, proposalIndex:number) {
    const item = messages[proposalIndex];
    if (!item || pendingTaskInspection.current || proposalFence.current || proposalBlocked || item.action !== action || consumedActions.current.has(item)) return;
    const targets:Record<AssistantNavigationAction,AssistantDestination> = {open_api_settings:"api",open_model_settings:"models",open_agents:"agents",open_resources:"resources",open_canvas:"canvas",open_workspace:"workspace",open_account_settings:"account",open_appearance_settings:"appearance",open_settings:"settings",open_generation_settings:"generation"};
    return requestNavigation(targets[action],proposalIndex);
  }
  async function requestPreference(preference:AssistantPreferenceProposal){
    try{await localActions.run(workspace.id,'app.preferences.set',projectId,preference,{intent:crypto.randomUUID(),
      receipt:result=>assistantPreferenceOperationReceipt(result,preference.kind==='language'?String(preference.value):language),
      failure:()=>({text:assistantPreferenceUncertainNotice(language),executionStatus:'unconfirmed'}),
    });}catch{if(!['failed','uncertain'].includes(workspace.controller.viewFor(workspace.id).localAction.phase))setChatError(assistantPreferenceUncertainNotice(language));}
  }
  function confirmPreference(index:number, preference:AssistantPreferenceProposal) {
    const item = messages[index];
    if (!item || pendingTaskInspection.current || item.preference !== preference || !isValidAssistantPreferenceProposal(preference) || !canSetPreference || !ready || preferenceInFlight.current || proposalFence.current || proposalBlocked || consumedActions.current.has(item)) return;
    consumedActions.current.add(item); setChatError("");
    const confirmed = language === "en-US" ? "Suggestion confirmed; see the result or error below." : language === "zh-TW" ? "建議已確認，請查看下方結果或錯誤提示。" : "建议已确认，请查看下方结果或错误提示。";
    setMessages(previous => previous.map((entry, i) => i === index ? {...entry, preference:null, text:confirmed} : entry));
    return requestPreference(preference);
  }
  function actionLabel(action: AssistantAction, hasDraft = false) {
    if (action === "open_api_settings") return t.openApi;
    if (action === "open_model_settings") return t.openModels;
    if (action === "open_agents") return language === "en-US" ? "Open agents" : language === "zh-TW" ? "開啟智能體" : "打开智能体";
    if (action === "open_resources") return language === "en-US" ? "Open resources" : language === "zh-TW" ? "開啟資源中轉站" : "打开资源中转站";
    if (action === "open_canvas") return language === "en-US" ? "Open canvas" : language === "zh-TW" ? "開啟畫布" : "打开画布";
    if (action === "open_workspace") return language === "en-US" ? "Open workspace" : language === "zh-TW" ? "開啟工作空間" : "打开工作空间";
    if (action === "open_account_settings") return language === "en-US" ? "Open account settings" : language === "zh-TW" ? "開啟帳號設定" : "打开账号设置";
    if (action === "open_appearance_settings") return language === "en-US" ? "Open appearance settings" : language === "zh-TW" ? "開啟外觀設定" : "打开外观设置";
    if (action === "open_settings") return language === "en-US" ? "Open settings" : language === "zh-TW" ? "開啟設定" : "打开设置";
    if (action === "open_generation_settings") return language === "en-US" ? "Open generation settings" : language === "zh-TW" ? "開啟生成與下載" : "打开生成与下载";
    const names = language === "en-US" ? {create_text_node:"text",create_image_node:"image",create_video_node:"video"} : language === "zh-TW" ? {create_text_node:"文字",create_image_node:"生圖",create_video_node:"影片"} : {create_text_node:"文本",create_image_node:"生图",create_video_node:"视频"};
    return language === "en-US" ? `Create one ${hasDraft ? "" : "empty "}${names[action]} node` : language === "zh-TW" ? `確認建立一個${hasDraft ? "" : "空白"}${names[action]}節點` : `确认创建一个${hasDraft ? "" : "空白"}${names[action]}节点`;
  }
  async function createSuggestedNode(index: number, action: AssistantCanvasAction, expectedProjectId?: string) {
    const types = {create_text_node:"text", create_image_node:"image", create_video_node:"video"} as const;
    const item = messages[index];
    if (!item || pendingTaskInspection.current || item.action !== action || item.actionProjectId !== expectedProjectId || proposalFence.current || proposalBlocked || consumedActions.current.has(item)) return;
    const content = item.draft ?? "";
    if (containsLikelyAssistantSecret(content)) {
      setChatNotice(language === "en-US" ? "Node content may contain a credential. Remove it before creating the node." : language === "zh-TW" ? "節點內容可能包含憑證，請移除後再建立。" : "节点内容可能包含凭据，请移除后再创建。");
      return;
    }
    if (!isValidAssistantNodeContent(content)) {
      setChatNotice(language === "en-US" ? "The node text contains unsupported control characters or exceeds 4,000 characters." : language === "zh-TW" ? "節點內容含不支援的控制字元或超過 4,000 字。" : "节点内容含不支持的控制字符或超过 4,000 字。");
      return;
    }
    const position=expectedProjectId===projectId&&activeView==="canvas"?getCanvasNodePlacement?.(expectedProjectId):null;
    if(!expectedProjectId||!position){
      setChatNotice(language === "en-US" ? "Return to the original project canvas and wait for it to finish loading." : language === "zh-TW" ? "請回到原專案畫布，並等候載入完成。" : "请回到原项目画布，并等待加载完成。");return;
    }
    const owner=workspace.id;consumedActions.current.add(item);let applied=false;
    try{
      await canvasPlanner.createSingle(owner,expectedProjectId,types[action],content,position,{receipt:assistantNodeSubmissionNotice(language),projectName,intent:crypto.randomUUID()});applied=true;
      const confirmed=language === "en-US" ? "Suggestion confirmed; see the result below." : language === "zh-TW" ? "建議已確認，執行結果見下方。" : "建议已确认，执行结果见下方。";
      setMessages(previous=>previous.map(entry=>entry===item?{...entry,action:null,text:confirmed}:entry));setChatNotice("");
    }catch(error){
      if(applied){setChatNotice(assistantCanvasPostCommitNotice(language));return;}
      const uncertain=error?.code==="OPERATION_OUTCOME_UNKNOWN"||workspace.controller.viewFor(owner).canvasPlan.pendingOperation;
      if(uncertain){
        const confirmed=language === "en-US" ? "Suggestion confirmed; check the original request below." : language === "zh-TW" ? "建議已確認，請在下方核對原請求。" : "建议已确认，请在下方核对原请求。";
        setMessages(previous=>[...previous.map(entry=>entry===item?{...entry,action:null,text:confirmed}:entry),{role:"assistant",text:assistantNodeUncertainNotice(language),executionStatus:"unconfirmed"}]);
      }else{consumedActions.current.delete(item);setChatNotice(assistantCanvasError(error?.code||"PLAN_PREPARE_FAILED",language));}
    }
  }
  function continueToButler() {
    if (!status || statusError) return;
    const handoff = buildAssistantButlerHandoff(docUrl, guideModel, guideCategory);
    if (!handoff.ok) { setError(handoff.field === "url" ? t.invalid : handoff.field === "model" ? handoffText.invalid : handoffText.pair); return; }
    setError(""); setKey(""); setDrawer(false);
    onOpenButler(handoff.url, !!status?.configured && !!status?.installed,
      handoff.model && handoff.category ? {model:handoff.model, category:handoff.category} : undefined);
  }

  return <>
    {!chatVisible && !welcome && <button ref={launcherRef} type="button" className="wj-assistant-launch" style={launcherPosition ? {left:launcherPosition.x,top:launcherPosition.y,right:"auto",bottom:"auto"} : undefined} onPointerDown={startLauncherDrag} onPointerMove={moveLauncher} onPointerUp={endLauncherDrag} onPointerCancel={cancelLauncherDrag} onLostPointerCapture={cancelLauncherDrag} onKeyDown={moveLauncherWithKeyboard} onClick={openLauncher} aria-label={t.open} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" title={language === "en-US" ? "Click to open; drag or use arrow keys to move" : language === "zh-TW" ? "點擊開啟；拖曳或使用方向鍵移動" : "点击打开；拖动或使用方向键移动"}><img src={robotImage} alt="" draggable={false} /></button>}
    {chatVisible && !welcome && <aside ref={drawerRef} className={`wj-assistant-drawer${workbench ? " wj-assistant-workbench" : ""}`} data-wanjuan-assistant-view={workbench ? "agents" : undefined} aria-label={workbench ? sessionCopy.title : t.drawer} style={!workbench && geometry ? {left:geometry.x, top:geometry.y, width:geometry.width, height:geometry.height} : undefined} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <header className="wj-assistant-drawer-head" tabIndex={0} aria-label={workbench ? sessionCopy.title : moveLabel} onKeyDown={event => { if (workbench || event.target !== event.currentTarget) return; const dx = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0; const dy = event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0; if (!dx && !dy) return; event.preventDefault(); const parent = drawerRef.current?.parentElement; if (parent) setGeometry(previous => previous ? {...previous, x:Math.max(12, Math.min(previous.x + dx, parent.clientWidth - previous.width - 12)), y:Math.max(12, Math.min(previous.y + dy, parent.clientHeight - previous.height - 12))} : previous); }} onPointerDown={event => {if (!workbench) startPointer(event, "move");}} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}>
        <div className="wj-assistant-heading"><span className="wj-assistant-icon"><img src={robotImage} alt="" /></span><strong>{workbench ? sessionCopy.title : customRole ? workspace.role.descriptor.name : t.drawer}</strong></div>
        {workspace.active && <button type="button" className="wj-assistant-header-action" onClick={() => {if (workbench) {setDrawer(true);onOpenCanvas();} else onOpenAgents();}}>{workbench ? sessionCopy.float : sessionCopy.expand}</button>}
        <button type="button" className="wj-assistant-header-action" onClick={() => customRole ? setRoleEditor(structuredClone(workspace.role)) : setPanel(panel === "chat" ? "settings" : "chat")} aria-label={customRole ? (language==='en-US'?'Role settings':language==='zh-TW'?'角色設定':'角色设置') : panel === "chat" ? settingsLabel : chatLabel}><Settings2 size={15} />{customRole ? (language==='en-US'?'Role settings':language==='zh-TW'?'角色設定':'角色设置') : panel === "chat" ? settingsLabel : chatLabel}</button>
        <button type="button" className="wj-assistant-icon-button" aria-label={t.close} onClick={() => {setKey("");setDrawer(false);if (workbench) onOpenCanvas();}}><X size={17} /></button>
      </header>
      <div className="wj-assistant-workspace-layout">
      {workbench && <nav className="wj-assistant-session-sidebar" aria-label={sessionCopy.sessions}>
        <div className="wj-assistant-role-list" aria-label={language==='en-US'?'Roles':language==='zh-TW'?'角色':'角色'}>
          {workspace.snapshot.catalog.roles.filter((role:any)=>!role.archived).map((role:any)=><button type="button" className="wj-assistant-role-item" key={role.id} data-wanjuan-assistant-role-id={role.id} aria-pressed={role.id===workspace.role?.descriptor.id} disabled={switchBlocked} onClick={()=>void openRole(role.id)} data-wanjuan-i18n-skip>{role.name}{role.imported&&<small className="wj-assistant-import-badge">{language==='en-US'?'Imported copy':language==='zh-TW'?'匯入副本':'导入副本'}</small>}</button>)}
          {agentWorkspace && <button type="button" className="wj-assistant-text-button" disabled={switchBlocked} onClick={()=>void newRole()}>＋ {language==='en-US'?'New role':language==='zh-TW'?'新角色':'新角色'}</button>}
        </div>
        <button type="button" className="wj-assistant-secondary" disabled={switchBlocked} onClick={() => void sessionAction(() => workspace.controller.create(projectId))}>＋ {sessionCopy.fresh}</button>
        <input type="search" className="wj-assistant-session-filter" aria-label={historyCopy.sessions} placeholder={historyCopy.sessions} value={sessionFilter} maxLength={120} onChange={event=>setSessionFilter(event.target.value)}/>
        <div className="wj-assistant-session-list" aria-busy={sessionFilter!==deferredSessionFilter}>{filteredSessions.map((item:any) => <div className="wj-assistant-session-row" key={item.id}>
          <button type="button" className="wj-assistant-session-item" data-wanjuan-assistant-session-id={item.id} aria-current={!item.archived&&item.id === workspace.id ? "true" : undefined} disabled={switchBlocked} onClick={event => {if(item.archived){archiveOpener.current=event.currentTarget;setArchivePreview({id:item.id,name:item.name||sessionCopy.untitled,roleId:item.roleId});}else void sessionAction(() => workspace.controller.select(item.id));}}><span data-wanjuan-i18n-skip>{item.name || sessionCopy.untitled}</span>{workspace.controller.viewFor(item.id).sending && <span className="wj-assistant-session-status">{assistantWorkspaceTaskLabel(workspace.controller.viewFor(item.id).taskStatusUnavailable?'unavailable':workspace.controller.viewFor(item.id).record?.value.task.status==='queued'?'queued':'running',language)}</span>}</button>
          {item.archived && <button type="button" className="wj-assistant-text-button" disabled={switchBlocked} onClick={() => void sessionAction(async() => {await workspace.controller.change(item.id,{archived:false});setShowArchived(false);setSessionFilter('');await workspace.controller.select(item.id);})}>{sessionCopy.restore}</button>}
        </div>)}{!filteredSessions.length&&<p className="wj-assistant-hint" role="status">{showArchived?historyCopy.archivedEmpty:historyCopy.empty}</p>}</div>
        <label className="wj-assistant-archive-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />{sessionCopy.archived}</label>
        <button type="button" className="wj-assistant-text-button" onClick={() => {setDrawer(false);onOpenRoles?.();}}>{sessionCopy.roles}</button>
        <details className="wj-assistant-backup-controls"><summary>{backupCopy.title}</summary>
          <p className="wj-assistant-hint">{backupCopy.hint}</p>
          <button type="button" className="wj-assistant-text-button" disabled={!workspace.active||backupBusy} onClick={()=>void exportWorkspaceBackup('all')}>{backupCopy.all}</button>
          <button type="button" className="wj-assistant-text-button" disabled={!workspace.active||backupBusy} onClick={()=>void exportWorkspaceBackup('session')}>{backupCopy.current}</button>
          <button type="button" className="wj-assistant-text-button" disabled={!workspace.active||backupBusy} onClick={()=>backupInputRef.current?.click()}>{backupCopy.import}</button>
          <input ref={backupInputRef} type="file" accept=".json,application/json" hidden disabled={!workspace.active||backupBusy} aria-label={backupCopy.import} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void prepareWorkspaceBackup(file);}}/>
          {backupBusy&&<p role="status" className="wj-assistant-hint">{backupCopy.working}</p>}
          {backupNotice&&<p role="status" className="wj-assistant-hint">{backupNotice}</p>}
          {backupError&&<p role="alert" className="wj-assistant-error">{backupError}</p>}
        </details>
        {legacyImportError&&<div role="alert"><p className="wj-assistant-hint">{language==='en-US'?'Some earlier roles could not be imported. Originals remain available.':language==='zh-TW'?'部分先前角色無法匯入，原資料仍保留。':'部分原角色未能导入，原资料仍然保留。'}</p><button type="button" className="wj-assistant-text-button" disabled={legacyImporting} onClick={()=>void retryLegacyImport()}>{sessionCopy.retry}</button></div>}
      </nav>}
      <div className={`wj-assistant-drawer-body${!keyEntry && panel === "chat" ? " wj-assistant-drawer-body-chat" : ""}`}>
      <div className="wj-assistant-scroll-content">
        {workspace.available && !workspace.active && <div role={workspace.snapshot.phase === "failed" ? "alert" : "status"}><p className="wj-assistant-hint">{workspace.snapshot.phase === "failed" ? sessionCopy.failure : sessionCopy.loading}</p>{workspace.snapshot.phase === "failed" && <button type="button" className="wj-assistant-secondary" onClick={() => void workspace.controller.initialize(projectId)}>{sessionCopy.retry}</button>}</div>}
        {workspace.active && <div className="wj-assistant-session-toolbar">
          {!workbench && <select aria-label={sessionCopy.sessions} value={workspace.id} disabled={switchBlocked} onChange={event => void sessionAction(() => workspace.controller.select(event.target.value))}>{workspace.snapshot.catalog.sessions.filter((item:any) => !item.archived).map((item:any) => <option key={item.id} value={item.id}>{workspace.snapshot.catalog.roles.find((role:any)=>role.id===item.roleId)?.name} · {item.name || sessionCopy.untitled}</option>)}</select>}
          {workbench && <strong data-wanjuan-i18n-skip>{activeDescriptor?.name || sessionCopy.untitled}</strong>}
          <button type="button" className="wj-assistant-text-button" disabled={switchBlocked} onClick={() => setSessionName(activeDescriptor?.name || "")}>{sessionCopy.rename}</button>
          {customRole&&agentWorkspace&&<button type="button" className="wj-assistant-text-button" disabled={switchBlocked} onClick={()=>{setRoleEditor(structuredClone(workspace.role));setRoleSaveError('');}}>{language==='en-US'?'Edit role':language==='zh-TW'?'編輯角色':'编辑角色'}</button>}
          <button type="button" className="wj-assistant-text-button" disabled={switchBlocked || sending} onClick={() => void sessionAction(() => workspace.controller.change(workspace.id,{archived:true}))}>{sessionCopy.archive}</button>
          {!workbench && <button type="button" className="wj-assistant-text-button" disabled={switchBlocked} onClick={() => void sessionAction(() => workspace.controller.create(projectId))}>＋</button>}
        </div>}
        {workspace.active&&<details className="wj-assistant-project-binding"><summary>{projectCopy.title}: <span data-wanjuan-i18n-skip>{boundProject?(boundProject===projectId?(projectName||projectCopy.title):projectCopy.other):projectCopy.none}</span></summary><p className="wj-assistant-hint">{projectCopy.note}</p><button type="button" className="wj-assistant-text-button" disabled={switchBlocked||busy||!projectId||boundProject===projectId} onClick={()=>void sessionAction(()=>workspace.controller.bindProject(workspace.id,projectId))}>{projectCopy.bind}</button><button type="button" className="wj-assistant-text-button" disabled={switchBlocked||busy||!boundProject} onClick={()=>void sessionAction(()=>workspace.controller.bindProject(workspace.id,''))}>{projectCopy.clear}</button></details>}
        {sessionName !== null && <form className="wj-assistant-session-rename" onSubmit={event => {event.preventDefault();void sessionAction(() => workspace.controller.change(workspace.id,{name:sessionName}));}}><input aria-label={sessionCopy.rename} value={sessionName} maxLength={120} onChange={event => setSessionName(event.target.value)} autoFocus/><button type="submit" className="wj-assistant-text-button">{sessionCopy.save}</button><button type="button" className="wj-assistant-text-button" onClick={() => setSessionName(null)}>{sessionCopy.cancel}</button></form>}
        {!customRole && status && !status.installed && <p className="wj-assistant-hint">{t.runtimeMissing}</p>}
        {!customRole && !status && (statusError ? <div role="alert"><p className="wj-assistant-error">{accountText.statusError}</p><button type="button" className="wj-assistant-secondary" onClick={() => { setStatusError(false); setStatusRevision(previous => previous + 1); }}>{accountText.retry}</button></div> : <p className="wj-assistant-hint" role="status">{accountText.statusLoading}</p>)}
        {status && (panel === "settings" || keyEntry) && (!status.configured || keyEntry) && <div className="wj-assistant-setup">
          {!status?.configured && <button type="button" className="wj-assistant-secondary" disabled={authPhase !== "idle" || busy} onClick={startAccount}>{accountText.start}</button>}
          {!status?.configured && <p className="wj-assistant-hint">{accountText.experimental}</p>}
          <button type="button" className="wj-assistant-text-button" onClick={openKeyPlatform}><ExternalLink size={15} />{t.keyGet}</button>
          <p className="wj-assistant-hint">{t.keyGetHint}</p>
          <label htmlFor="wj-assistant-key">{t.keyLabel}</label>
          <input id="wj-assistant-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} />
          <button type="button" className="wj-assistant-primary" disabled={!key.trim() || busy || accountPending} onClick={saveKey}>{t.keySave}</button>
          {status?.configured && <button type="button" className="wj-assistant-text-button" disabled={busy} onClick={() => { setKey(""); setKeyEntry(false); }}>{t.keyCancel}</button>}
          <p className="wj-assistant-hint"><ShieldCheck size={15} />{t.keyHint}</p>
        </div>}
        {!keyEntry && panel === "chat" && <>
          {workspace.active&&<AssistantGettingStarted language={language} projectId={projectId} customRole={customRole} assistantStatus={!status?'loading':status.configured?'configured':'missing'} getSummary={()=>getCanvasPlanController?.(projectId)?.configurationSummary()} disabled={switchBlocked||busy||!!pendingPreference||!!pendingNavigation||canvasPlan.phase!=='idle'} onAssistant={()=>{if(customRole)setRoleEditor(structuredClone(workspace.role));else setPanel('settings');}} onApi={()=>{setDrawer(false);onOpenSetup();}} onModels={()=>{setDrawer(false);onOpenModels();}} onExample={text=>{if(!workspace.controller.operationScope(workspace.id)?.selected)return;const next=appendAssistantExample(workspace.controller.viewFor(workspace.id).draft,text);if(next===null){setChatNotice(language==='en-US'?'The draft is full. Shorten it before appending an example.':language==='zh-TW'?'草稿已滿，請先縮短內容再加入範例。':'草稿已满，请先缩短内容再添加示例。');return;}inputRevision.current++;diagnosticDraft.current=false;setMessage(next);}}/>}
          {!customRole && (!status || !status.configured) && <div className="wj-assistant-setup wj-assistant-chat-setup-hint"><p className="wj-assistant-hint">{language === "en-US" ? "Local settings, navigation and task status are available without a model. Connect the assistant for general chat." : language === "zh-TW" ? "本機設定、頁面導覽與任務狀態不需連接模型；一般對話需要連接智慧助手。" : "本地设置、页面导航与任务状态无需连接模型；普通对话需要连接智能助手。"}</p>{status && <button type="button" className="wj-assistant-text-button" onClick={() => setPanel("settings")}>{language === "en-US" ? "Connect assistant" : language === "zh-TW" ? "連接智慧助手" : "连接智能助手"}</button>}</div>}
          {!!messages.length&&<AssistantHistoryControls history={history} language={language}/>}
          <div ref={conversationRef} className="wj-assistant-conversation" role="log" aria-live="polite" onScroll={event=>{const el=event.currentTarget;followConversation.current=!history.range.newer&&el.scrollHeight-el.clientHeight-el.scrollTop<48;}}>
          {!messages.length && <div className="wj-assistant-reply"><img src={robotImage} alt="" /><p className="wj-assistant-message">{customRole ? (workspace.role.configuration.description || (language==='en-US'?'Start a conversation with this role.':language==='zh-TW'?'與這個角色開始對話。':'与这个角色开始对话。')) : <>{t.hello}{"\n"}{language === "en-US" ? "Try: set the theme to graphite." : language === "zh-TW" ? "也可以輸入：把主題切換成石墨灰。" : "也可以输入：把主题切换成石墨灰。"}</>}</p></div>}
          {messages.slice(history.range.start,history.range.end).map((item,offset) => {const index=history.range.start+offset;return <div key={index} tabIndex={-1} data-assistant-history-index={index} data-assistant-history-match={history.match===index?'true':undefined}>
            {item.role === "assistant" ? <><p className="wj-assistant-origin" role="note" data-wanjuan-assistant-origin={assistantMessageOrigin(item)}>{assistantMessageOriginLabel(assistantMessageOrigin(item), language)}</p><div className="wj-assistant-reply"><img src={robotImage} alt="" />{assistantMessageOrigin(item) === "model" ? <AssistantModelQuote text={item.text} language={language} incomplete={item.incomplete}/> : <p className="wj-assistant-message" data-wanjuan-i18n-skip>{item.proposalExpired ? (language === "en-US" ? "This earlier suggestion is no longer available." : language === "zh-TW" ? "此先前建議已失效。" : "此先前建议已失效。") : item.text}</p>}</div></> : <p data-wanjuan-i18n-skip className={item.role === "notice" ? "wj-assistant-hint" : "wj-assistant-message wj-assistant-user"}>{item.text}</p>}
            {item.generationTask&&item.role==='assistant'&&!item.modelReply&&item.executionStatus==='confirmed'&&<AssistantGenerationTaskCard key={item.generationTask.submissionId} ownerId={workspace.id} projectId={item.generationTask.projectId} nodeId={item.generationTask.nodeId} taskReference={item.generationTask} activeProjectId={projectId} getScope={()=>workspace.controller.operationScope(workspace.id)} language={language} onDiagnose={id=>void addFailureSummary(id)} onView={nodeId=>{setDrawer(false);onOpenCanvas();onCanvasPlanApplied?.(item.generationTask!.projectId,[nodeId]);}}/>}
            {!!item.attachments?.length&&<AssistantAttachments items={item.attachments} language={language} onPreview={openMediaPreview} attachedIds={attachments.map((item:any)=>item.id)} disabled={!customRole||busy||workspace.view.importingMedia||attachments.length>=6} onAgain={customRole?(attachment=>{if(!attachments.some((item:any)=>item.id===attachment.id))void replaceWorkspaceMedia([...attachments,attachment]);}):undefined}/>}
            {item.preference && <button type="button" className="wj-assistant-secondary" disabled={!canSetPreference || !ready || proposalBlocked} onClick={() => confirmPreference(index, item.preference!)}>{item.preference.kind === "autoDownload" ? (language === "en-US" ? `Confirm: turn ${item.preference.value ? "on" : "off"} automatic result downloads` : language === "zh-TW" ? `確認${item.preference.value ? "開啟" : "關閉"}生成結果自動下載` : `确认${item.preference.value ? "开启" : "关闭"}生成结果自动下载`) : <>{language === "en-US" ? `Confirm ${item.preference.kind === "theme" ? "theme" : "language"}: ` : language === "zh-TW" ? `確認切換${item.preference.kind === "theme" ? "主題" : "語言"}：` : `确认切换${item.preference.kind === "theme" ? "主题" : "语言"}：`}{assistantPreferenceLabel(item.preference.kind, item.preference.value, language)}</>}</button>}
            {item.action && (item.action.startsWith("create_") ? <>
              <p className="wj-assistant-hint">{language === "en-US" ? "Project" : language === "zh-TW" ? "專案" : "项目"}: {item.actionProjectName || "—"} · {language === "en-US" ? "No generation or charges" : language === "zh-TW" ? "不會執行生成或扣費" : "不会执行生成或扣费"}</p>
              {item.draft !== undefined && <>
                <label htmlFor={`wj-node-draft-${index}`}>{language === "en-US" ? "Review and edit node content" : language === "zh-TW" ? "檢查並編輯節點內容" : "检查并编辑节点内容"}</label>
                <textarea id={`wj-node-draft-${index}`} value={item.draft} maxLength={4000} disabled={proposalBlocked} onChange={event => {
                  const draft = event.target.value;
                  setMessages(previous => previous.map((entry, entryIndex) => entryIndex === index ? {...entry, draft} : entry));
                }} />
              </>}
              <button type="button" className="wj-assistant-secondary" disabled={proposalBlocked} onClick={() => createSuggestedNode(index, item.action as AssistantCanvasAction, item.actionProjectId)}>{actionLabel(item.action, item.draft !== undefined)}</button>
            </> : <button type="button" className="wj-assistant-secondary" disabled={!canNavigateLocal || proposalBlocked} onClick={() => openSuggestedAction(item.action as AssistantNavigationAction, index)}>{actionLabel(item.action)}</button>)}
          </div>;})}
          {chatView.stream.active&&chatView.stream.text&&<div className="wj-assistant-reply"><img src={robotImage} alt=""/><AssistantModelQuote text={chatView.stream.text} language={language} streaming/></div>}
          {workspace.active&&!sending&&workspace.view.record?.value.task.status==='interrupted'&&<p role="status" className="wj-assistant-hint">{assistantWorkspaceTaskLabel('interrupted',language)}</p>}
          {sending && !cancelledTurnWaiting && <><p className="wj-assistant-hint" role="status">{workspace.active?assistantWorkspaceTaskLabel(workspace.view.taskStatusUnavailable?'unavailable':workspace.view.record?.value.task.status==='queued'?'queued':'running',language):t.chatWorking}</p><button type="button" className="wj-assistant-secondary" disabled={cancelling} onClick={stopMessage}>{cancelling ? t.chatStopping : t.chatStop}</button></>}
          {taskRead.working&&<p className="wj-assistant-hint" role="status">{language==='en-US'?'Reading local task records…':language==='zh-TW'?'正在讀取本機任務紀錄…':'正在读取本地任务记录…'}</p>}
          {chatNotice && <p className="wj-assistant-hint" role="status">{chatNotice}</p>}
          <AssistantCanvasPlanPanel state={displayedCanvasPlan} language={language} projectName={canvasPlan.projectName||projectName} disabled={taskRead.working||busy||cancelling||accountPending||workspace.snapshot.switching||canvasPlan.working||!!canvasPlan.pendingOperation||!!pendingPreference||!!pendingNavigation||!!taskInspection} hasMessage={!!message.trim()}
            onConfigure={patch=>canvasAction(()=>canvasPlanner.configure(workspace.id,patch))} onRequest={requestCanvasPlan} onDismiss={()=>canvasAction(()=>canvasPlanner.dismiss(workspace.id))} onRestart={beginCanvasPlan}
            onEdit={(index,key,value)=>canvasAction(()=>canvasPlanner.edit(workspace.id,index,key,value))} onValidate={()=>canvasAction(()=>canvasPlanner.validate(workspace.id,projectId))}
            onPreflight={()=>canvasAction(()=>canvasPlanner.preflight(workspace.id,projectId))}
            onObserve={()=>canvasAction(()=>canvasPlanner.recover(workspace.id))}
            onPrepareGeneration={nodeId=>canvasAction(()=>canvasPlanner.prepareGeneration(workspace.id,projectId,nodeId))}
            onApproveGeneration={consent=>canvasAction(()=>canvasPlanner.approveGeneration(workspace.id,projectId,consent,applicationOperationCopy(language).submitted))}
            onDismissGeneration={()=>canvasAction(()=>canvasPlanner.dismissGeneration(workspace.id))}
            onObserveGeneration={()=>canvasAction(()=>canvasPlanner.observeGeneration(workspace.id))}
            onViewGeneration={nodeId=>{setDrawer(false);onOpenCanvas();onCanvasPlanApplied?.(projectId,[nodeId]);}}
            onApply={()=>canvasAction(async()=>{const owner=workspace.id,result=await canvasPlanner.apply(owner,projectId,canvasCopy.done);if(workspace.controller.operationScope(owner)?.selected){setDrawer(true);setPanel('chat');onOpenCanvas();onCanvasPlanApplied?.(projectId,result.affectedNodeIds||result.createdNodeIds);}})}
            onUndo={()=>canvasAction(()=>canvasPlanner.undo(workspace.id,projectId,canvasCopy.undone))} onView={()=>{setDrawer(false);onOpenCanvas();onCanvasPlanApplied?.(projectId,canvasPlan.preview?.effectiveNodes?.map((n:any)=>n.id)||[]);}}/>
          {canvasPlan.generation?.phase==='accepted'&&!canvasPlan.generation.result?.taskReference&&canvasPlan.generation.result?.nodeId&&<AssistantGenerationTaskCard key={canvasPlan.generation.handle?.id||canvasPlan.generation.result.nodeId} ownerId={workspace.id} projectId={canvasPlan.generation.result.projectId} nodeId={canvasPlan.generation.result.nodeId} activeProjectId={projectId} getScope={()=>workspace.controller.operationScope(workspace.id)} language={language} onView={nodeId=>{setDrawer(false);onOpenCanvas();onCanvasPlanApplied?.(canvasPlan.generation.result.projectId,[nodeId]);}}/>}
          </div>
        </>}
      </div>
        {!keyEntry && panel === "chat" && <>
          <div className="wj-assistant-composer">
          {localAction.phase==='uncertain'&&<section className="wj-assistant-plan-panel" role="status" data-local-operation-phase="uncertain"><strong>{localCopy.outcome_unknown}</strong><p className="wj-assistant-hint">{localCopy.unknownNote}</p><button type="button" className="wj-assistant-secondary" disabled={!!localAction.inFlight} onClick={()=>{try{void localActions.recover(workspace.id).catch(()=>{});}catch{}}}>{localCopy.check}</button></section>}
          {customRole&&<>
            <input ref={mediaInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.m4v,.mov,.webm" multiple hidden disabled={!workspace.active||workspace.snapshot.switching||busy||workspace.view.importingMedia||attachments.length>=6} aria-label={mediaCopy.add} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void importWorkspaceMedia(files);}}/>
            {!!attachments.length&&<AssistantAttachments items={attachments} language={language} onPreview={openMediaPreview} disabled={busy||workspace.view.importingMedia} onRemove={id=>void replaceWorkspaceMedia(attachments.filter((entry:any)=>entry.id!==id))}/>}
            <AssistantAttachmentStatus state={workspace.view.mediaStatus} language={language}/>
          </>}
          <textarea id="wj-assistant-message" aria-label={t.chatPlaceholder} value={message} disabled={workspace.available && (!workspace.active || workspace.snapshot.switching)} maxLength={16000} onChange={event => { const next = event.target.value; inputRevision.current++; if (diagnosticDraft.current && !isAssistantDiagnosticDraft(next)) diagnosticDraft.current = false; setMessage(next); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendChatOrPlan(); } }} placeholder={t.chatPlaceholder} />
          <div className="wj-assistant-composer-actions">
            {getCanvasPlanController&&<button type="button" className="wj-assistant-plan-toggle wj-assistant-text-button" aria-pressed={canvasPlan.phase==='scope'} disabled={taskRead.working||!workspace.active||busy||cancelling||accountPending||workspace.snapshot.switching||canvasPlan.working||!!canvasPlan.pendingOperation} onClick={beginCanvasPlan}><Sparkles size={14}/>{canvasCopy.title}</button>}
            {customRole&&<button type="button" className="wj-assistant-icon-button" aria-label={mediaCopy.add} title={mediaCopy.hint} disabled={!workspace.active||workspace.snapshot.switching||busy||workspace.view.importingMedia||attachments.length>=6} onClick={()=>mediaInputRef.current?.click()}><Paperclip size={16}/></button>}
            <button type="button" className="wj-assistant-icon-button" aria-label={customRole ? (language==='en-US'?'Role settings':language==='zh-TW'?'角色設定':'角色设置') : t.configureModel} onClick={() => customRole ? setRoleEditor(structuredClone(workspace.role)) : setPanel("model")}><Link2 size={16}/></button>
            <button type="button" className="wj-assistant-icon-button" aria-label={t.diagnose} title={`${t.diagnose} — ${t.diagnoseHint}`} disabled={taskRead.working || busy || cancelling} onClick={()=>void addFailureSummary()}><Wrench size={16}/></button>
            <button type="button" className="wj-assistant-icon-button" aria-label={newChatLabel} title={newChatLabel} disabled={taskRead.working || !!taskInspection || busy || cancelling || accountPending || !!pendingPreference || !!pendingNavigation || (!customRole && (!status?.configured || !status?.installed))} onClick={startNewChat}><RotateCcw size={16}/></button>
            <button type="button" className="wj-assistant-send" aria-label={canvasPlan.phase==='scope'?canvasCopy.request:t.chatSend} title={canvasPlan.phase==='scope'?canvasCopy.request:t.chatSend} disabled={taskRead.working||canvasPlan.working||!!canvasPlan.pendingOperation||!!taskInspection || workspace.view.importingMedia || (busy && !cancelledTurnWaiting) || cancelling || accountPending || !!pendingPreference || !!pendingNavigation || (!message.trim()&&!(customRole&&attachments.length))} onClick={sendChatOrPlan}><Send size={17}/></button>
          </div>
          {customRole&&<details className="wj-assistant-hint wj-assistant-media-help"><summary>{language==='en-US'?'Attachment limits and model support':language==='zh-TW'?'附件限制與模型支援':'附件限制与模型支持'}</summary>{mediaCopy.hint}</details>}
          </div>
        </>}
        {status?.configured && !keyEntry && panel === "settings" && <div className="wj-assistant-setup">
          <p className="wj-assistant-hint">{customRole ? (language==='en-US'?'Chat uses this role’s configured model and API. Memory is isolated per conversation unless role sharing is explicitly selected.':language==='zh-TW'?'對話使用此角色設定的模型與 API；記憶預設依對話隔離，除非明確選擇角色共享。':'对话使用此角色配置的模型与 API；记忆默认按会话隔离，除非明确选择角色共享。') : workspace.active ? sessionCopy.note : t.chatNote}</p>
          <p className="wj-assistant-hint">{language === "en-US" ? "The current page and settings section are shared with DeepSeek to tailor guidance; project names and content are not included automatically." : language === "zh-TW" ? "為提供貼合介面的指引，目前頁面和設定分區會傳送給 DeepSeek；不會自動包含專案名稱或內容。" : "为提供贴合界面的指引，当前页面和设置分区会发送给 DeepSeek；不会自动包含项目名称或内容。"}</p>
          {status.authMode !== "account" && <><button type="button" className="wj-assistant-secondary" disabled={busy || accountPending} onClick={checkConnection}>{busy && !sending ? connectionText.checking : connectionText.check}</button><p className="wj-assistant-hint">{connectionText.hint}</p></>}
          {connectionNotice && <p className="wj-assistant-hint" role="status">{connectionNotice}</p>}
          <button type="button" className="wj-assistant-text-button" disabled={busy || accountPending} onClick={() => setKeyEntry(true)}>{status.hasKey === false ? t.useKey : t.keyEdit}</button>
          {status.hasKey !== false && <button type="button" className="wj-assistant-text-button" disabled={busy || accountPending} onClick={removeKey}>{t.keyRemove}</button>}
          {status.hasAccount && <><button type="button" className="wj-assistant-text-button" disabled={busy || accountPending} onClick={startAccount}>{accountText.reauthorize}</button><button type="button" className="wj-assistant-text-button" disabled={busy || accountPending} onClick={removeAccount}>{accountText.remove}</button></>}
          {status.hasKey && status.hasAccount && <p className="wj-assistant-hint">{accountText.priority}</p>}
          {status.hasAccount === null && <p className="wj-assistant-hint">{language === "en-US" ? "The local account record could not be read. Your API key remains available." : language === "zh-TW" ? "無法讀取本機帳號紀錄，API Key 仍可使用。" : "无法读取本机账号记录，API Key 仍可使用。"}</p>}
        </div>}
        {authPhase !== "idle" && <><p className="wj-assistant-hint" role="status">{authPhase === "committing" ? accountText.committing : accountText.waiting}</p><button type="button" className="wj-assistant-text-button" disabled={authPhase === "committing"} onClick={cancelAccount}>{accountText.cancel}</button></>}
        {chatError && <p className="wj-assistant-error" role="alert">{chatError.startsWith("ASSISTANT_WORKSPACE_") ? (chatError.endsWith("LOADING") ? sessionCopy.loading : sessionCopy.conflict) : chatError}</p>}
        {panel === "model" && <div className="wj-assistant-setup"><p className="wj-assistant-hint">{t.configureModel}</p>
        <p className="wj-assistant-message">{t.hello}</p><p className="wj-assistant-message">{t.ask}</p>
        <label htmlFor="wj-assistant-doc">{t.docs}</label><input id="wj-assistant-doc" type="url" value={docUrl} placeholder={t.placeholder} onChange={(event) => { setDocUrl(event.target.value); setError(""); }} />
        <label htmlFor="wj-assistant-model">{handoffText.model}</label><input id="wj-assistant-model" type="text" maxLength={256} autoComplete="off" value={guideModel} onChange={event => { setGuideModel(event.target.value); setError(""); }} />
        <label htmlFor="wj-assistant-category">{handoffText.category}</label><select id="wj-assistant-category" value={guideCategory} onChange={event => { setGuideCategory(event.target.value); setError(""); }}><option value="">{handoffText.choose}</option><option value="image">{handoffText.image}</option><option value="video">{handoffText.video}</option></select>
        {error && <p className="wj-assistant-error" role="alert">{error}</p>}
        <button type="button" className="wj-assistant-primary" disabled={!status || statusError} onClick={continueToButler}><Link2 size={16} />{status?.configured && status?.installed ? t.continueAssistant : t.continue}<ArrowRight size={16} /></button>
        <button type="button" className="wj-assistant-secondary" onClick={openSetup}><KeyRound size={16} />{t.configure}</button>
        <p className="wj-assistant-hint">{handoffText.hint}</p><p className="wj-assistant-hint"><ShieldCheck size={15} />{t.hint}</p><p className="wj-assistant-hint">{t.details}</p>
        {status?.configured && status?.installed && <p className="wj-assistant-hint">{t.assistantDocsHint}</p>}
        </div>}
        {panel === "settings" && <button type="button" className="wj-assistant-text-button" onClick={() => { setDrawer(false); setWelcome(true); }}>{t.viewGuide}</button>}
      </div>
      </div>
      {workbench&&showArchived&&archivePreview&&archivePreview.roleId===workspace.role?.descriptor.id&&<AssistantArchivePreview id={archivePreview.id} name={archivePreview.name} language={language} onClose={closeArchive}/>}
      {chatVisible&&panel==='chat'&&mediaPreview?.ownerId===workspace.id&&<AssistantMediaPreview ownerId={mediaPreview.ownerId} attachment={mediaPreview.attachment} language={language} onClose={closeMediaPreview}/>}
      <button type="button" className="wj-assistant-resize" aria-label={resizeLabel} title={resizeLabel} onPointerDown={event => startPointer(event, "resize")} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer} onKeyDown={event => { const dx = event.key === "ArrowRight" ? 16 : event.key === "ArrowLeft" ? -16 : 0; const dy = event.key === "ArrowDown" ? 16 : event.key === "ArrowUp" ? -16 : 0; if (!dx && !dy) return; event.preventDefault(); const parent = drawerRef.current?.parentElement; if (parent) setGeometry(previous => previous ? {...previous, width:Math.max(Math.min(320, parent.clientWidth - previous.x - 12), Math.min(previous.width + dx, parent.clientWidth - previous.x - 12)), height:Math.max(Math.min(280, parent.clientHeight - previous.y - 12), Math.min(previous.height + dy, parent.clientHeight - previous.y - 12))} : previous); }} />
    </aside>}
    {pendingBackup&&<div className="wj-assistant-backup-backdrop"><section className="wj-assistant-backup-dialog" role="dialog" aria-modal="true" aria-label={backupCopy.confirm}>
      <h2>{backupCopy.confirm}</h2><p>{backupCopy.counts(pendingBackup.roles.length,pendingBackup.sessions.length,pendingBackup.media.length)}</p><p>{backupCopy.confirmHint}</p>
      {backupError&&<p role="alert" className="wj-assistant-error">{backupError}</p>}
      <button type="button" className="wj-assistant-secondary" disabled={backupBusy} onClick={()=>{setPendingBackup(null);setBackupError('');}}>{backupCopy.cancel}</button>
      <button type="button" className="wj-assistant-primary" disabled={backupBusy} onClick={()=>void confirmWorkspaceBackup()}>{backupBusy?backupCopy.working:backupCopy.confirm}</button>
    </section></div>}
    {roleEditor&&agentWorkspace&&<WanJuanAgentConfigPanel
      selectedAgent={roleEditor.configuration} agentTheme={agentWorkspace.theme} isLightAgentTheme={agentWorkspace.isLightTheme}
      agentModelOptions={agentWorkspace.environment.agentModelOptions} apiConfigs={agentWorkspace.environment.apiConfigs}
      textApiConfigId={agentWorkspace.environment.textApiConfigId} textModelApiBindings={agentWorkspace.environment.textModelApiBindings}
      updateSelectedAgent={(patch:any)=>setRoleEditor((current:any)=>({...current,configuration:{...current.configuration,...patch}}))}
      importAgentKnowledgeFile={importRoleKnowledge}
      removeAgentKnowledgeFile={(id:string)=>setRoleEditor((current:any)=>({...current,configuration:{...current.configuration,knowledgeFiles:(current.configuration.knowledgeFiles||[]).filter((file:any)=>file.id!==id)}}))}
      setAgentConfigOpen={(open:boolean)=>{if(!open)void saveRole();}} onCancel={()=>setRoleEditor(null)}
      stagedSave language={language} saving={roleSaving} saveError={roleSaveError}
    />}
    {welcome && <div className="wj-welcome-backdrop"><div className="wj-welcome" role="dialog" aria-modal="true" aria-labelledby="wj-welcome-title" tabIndex={-1} ref={dialogRef}>
      <div className="wj-welcome-brand"><span className="wj-assistant-icon"><Sparkles size={22} /></span>StarCanvas</div>
      <h1 id="wj-welcome-title">{t.title}</h1><h2>{t.subtitle}</h2><p className="wj-welcome-intro">{t.intro}</p>
      <div className="wj-welcome-accounts"><div><MessageSquare size={22} /><span><strong>{t.account}</strong><small>{t.accountDetail}</small></span></div><div><Sparkles size={22} /><span><strong>{t.provider}</strong><small>{t.providerDetail}</small></span></div></div>
      <button type="button" className="wj-assistant-primary" disabled={authPhase !== "idle"} onClick={startAccount}>{t.signIn}</button>
      <p className="wj-welcome-pending">{accountText.experimental}</p>
      {authPhase !== "idle" && <><p className="wj-welcome-pending" role="status">{authPhase === "committing" ? accountText.committing : accountText.waiting}</p><button type="button" className="wj-assistant-text-button" disabled={authPhase === "committing"} onClick={cancelAccount}>{accountText.cancel}</button></>}
      {chatError && <p className="wj-assistant-error" role="alert">{chatError}</p>}
      <button type="button" className="wj-assistant-secondary" disabled={authPhase !== "idle"} onClick={openKeySetup}>{t.useKey}</button>
      <button type="button" className="wj-assistant-text-button" disabled={authPhase !== "idle"} onClick={dismiss}>{t.later}</button>
      <div className="wj-welcome-notes"><p><ExternalLink size={15} />{t.browser}</p><p><BookOpenText size={15} />{t.cost}</p></div>
    </div></div>}
  </>;
}
