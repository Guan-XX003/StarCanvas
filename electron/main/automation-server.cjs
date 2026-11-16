// 本机自动化控制服务：CLI / MCP 通过 loopback 受控调用正在运行的桌面应用。
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { BrowserWindow, app } = require("./electron-refs.cjs");

const AUTOMATION_FILE_NAMES = ["starcanvas-automation.json", "wanjuan-automation.json"];
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_FILE_BYTES = 100 * 1024 * 1024;
let server = null;
let automationInfo = null;
let registeredWindow = null;
const operationPolicy=import('../shared/application-operation-policy.mjs');
// Until the reviewed application approval flow issues scoped grants, a local
// connection receives metadata reads only. Never trust a permission/approval
// field supplied in an HTTP body or model tool call.
async function authorizeExternalOperation(method,payload={}) {
  return (await operationPolicy).assertApplicationOperationPermission(method,['read'],{materialize:payload.materialize===true});
}
function infoPaths() { return AUTOMATION_FILE_NAMES.map((name) => path.join(app.getPath("userData"), name)); }
function writeInfo() {
  const serialized = `${JSON.stringify(automationInfo, null, 2)}\n`;
  for (const target of infoPaths()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialized, { mode: 0o600 });
    try { fs.chmodSync(target, 0o600); } catch {}
  }
}
function removeInfo() {
  for (const target of infoPaths()) {
    try { fs.rmSync(target, { force: true }); } catch {}
  }
}
function setAutomationWindow(win) {
  registeredWindow = win && !win.isDestroyed?.() ? win : null;
  require('./application-operation-host.cjs').setApplicationOperationWindow(registeredWindow);
}
function getWindow() { return registeredWindow && !registeredWindow.isDestroyed?.() ? registeredWindow : BrowserWindow.getAllWindows?.().find((win) => !win.isDestroyed?.()) || null; }
async function evaluate(method, payload) {
  await authorizeExternalOperation(method,payload);
  const win = getWindow();
  if (!win?.webContents) throw new Error("StarCanvas窗口尚未就绪");
  const m = JSON.stringify(String(method));
  const p = JSON.stringify(payload ?? {});
  let timer;
  const value=await Promise.race([
    win.webContents.executeJavaScript(`(async()=>{try{const taskRead=["tasks","task"].includes(${m}),api=taskRead?globalThis.__wanjuanTaskAutomation:globalThis.__wanjuanAutomation;if(!api||typeof api[${m}]!=="function")return {ok:false,code:taskRead?"OPERATION_TASKS_UNAVAILABLE":"PLAN_CANVAS_NOT_READY"};return await api[${m}](${p});}catch(error){return {ok:false,code:typeof error?.code==="string"?error.code:"OPERATION_FAILED"};}})()`, true),
    new Promise((_, reject) => {timer=setTimeout(() => reject(requestError("自动化接口响应超时，请等待画布加载完成后重试",504)), 10000);}),
  ]).finally(()=>clearTimeout(timer));
  // Electron does not preserve arbitrary Error properties across executeJS.
  // Carry only a plain code envelope, then revalidate it in the trusted host.
  if(value?.ok===false)throw Object.assign(new Error('Application read unavailable'),{code:(await import('../shared/application-operation-contract.mjs')).applicationOperationErrorCode(value)});
  return (await operationPolicy).applicationOperationMetadata(method,value,{includeDiagnostics:payload?.includeDiagnostics===true});
}
async function evaluateValidated(method,req,validate) {
  // Authorize BEFORE validation can stat/read a caller-supplied media path.
  await authorizeExternalOperation(method);
  return evaluate(method,validate(await readJson(req)));
}
function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload ?? { ok: false }), "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store", connection: "close", "x-content-type-options": "nosniff" });
  res.end(body);
}
function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
function safeText(value, name, maxLength, required = false) {
  const text = String(value ?? "").trim();
  if (required && !text) throw requestError(`${name}不能为空`);
  if (text.length > maxLength) throw requestError(`${name}过长`);
  if (text.includes("\0")) throw requestError(`${name}包含无效字符`);
  return text;
}
function validateReferenceImage(value) {
  const referenceImage = safeText(value, "参考图片", 4096);
  if (!referenceImage) return "";
  try {
    const url = new URL(referenceImage);
    if (!/^https?:$/.test(url.protocol)) throw requestError("参考图片 URL 仅支持 http/https");
    return referenceImage;
  } catch (error) {
    if (error?.statusCode) throw error;
  }
  if (!path.isAbsolute(referenceImage) && !path.win32.isAbsolute(referenceImage)) throw requestError("本地参考图片必须使用绝对路径");
  let stat;
  try { stat = fs.statSync(referenceImage); } catch { throw requestError("本地参考图片不存在或不可访问"); }
  if (!stat.isFile()) throw requestError("本地参考图片必须是文件");
  if (stat.size > MAX_REFERENCE_FILE_BYTES) throw requestError("本地参考图片超过 100MB 限制");
  return referenceImage;
}
function validatePortraitAssetId(value) {
  const id = safeText(value, "天玑已审核人像素材 ID", 512, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/.test(id)) throw requestError("天玑已审核人像素材 ID 格式无效");
  return id;
}
function validateGenerationPayload(kind, value) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {
    prompt: safeText(payload.prompt, "提示词", 50000, true),
    model: safeText(payload.model, "模型名称", 512),
    referenceImage: validateReferenceImage(payload.referenceImage),
  };
  if (kind === "image") result.size = safeText(payload.size || "1024x1024", "图片尺寸", 64);
  if (kind === "video") {
    result.resolution = safeText(payload.resolution || "1280x720", "视频分辨率", 64);
    result.aspectRatio = safeText(payload.aspectRatio, "视频比例", 32);
    if (payload.duration !== "" && payload.duration !== undefined && payload.duration !== null) {
      const duration = Number(payload.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600) throw requestError("视频时长必须在 0 到 600 秒之间");
      result.duration = duration;
    }
  }
  return result;
}
function validateTianjiPayload(value) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = safeText(payload.mode || "text-to-video", "天玑生成模式", 64);
  if (!["text-to-video", "first-frame", "first-last", "reference-media"].includes(mode)) throw requestError("不支持的天玑生成模式");
  const list = (name, max) => {
    const values = Array.isArray(payload[name]) ? payload[name] : [];
    if (values.length > max) throw requestError(`${name}最多 ${max} 个`);
    return values.map((item) => validateReferenceImage(item));
  };
  const result = validateGenerationPayload("video", payload);
  const images = list("images", 9);
  const portraitAssetIds = Array.isArray(payload.portraitAssetIds) ? payload.portraitAssetIds.map(validatePortraitAssetId) : [];
  if (portraitAssetIds.length && mode !== "reference-media") throw requestError("已审核天玑人像仅支持 reference-media 模式");
  if (images.length + portraitAssetIds.length > 9) throw requestError("images 与 portraitAssetIds 合计最多 9 个");
  return { ...result, mode, images, portraitAssetIds, videos: list("videos", 3), audios: list("audios", 3), callbackUrl: safeText(payload.callbackUrl, "回调 URL", 4096) };
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        reject(requestError("请求体过大", 413));
      }
    });
    req.on("end", () => { if (settled) return; if (!body.trim()) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(requestError("请求体不是有效 JSON")); } });
    req.on("error", reject);
  });
}
function createServer() {
  return http.createServer(async (req, res) => {
    if (!automationInfo?.token || req.headers.authorization !== `Bearer ${automationInfo.token}`) return send(res, 401, { ok: false, error: "未授权的自动化请求" });
      const parsedUrl = (() => { try { return new URL(req.url || "/", "http://127.0.0.1"); } catch { return new URL("http://127.0.0.1/"); } })();
      const pathname = parsedUrl.pathname;
    try {
      if(req.method==='POST'&&pathname==='/v1/operations')return send(res,202,await require('./application-operation-host.cjs').getApplicationOperationService().submit('external',await readJson(req)));
      if(req.method==='POST'&&pathname==='/v1/media/import')return send(res,202,await require('./application-operation-host.cjs').submitLegacyOperation('media.import',await readJson(req),req.headers['idempotency-key']));
      const operation=pathname.match(/^\/v1\/operations\/([A-Za-z0-9-]+)$/);
      if(operation&&['GET','DELETE'].includes(req.method)){
        const service=require('./application-operation-host.cjs').getApplicationOperationService(),receipt=req.headers['x-starcanvas-operation-receipt'];
        return send(res,200,{request:req.method==='GET'?service.read('external',operation[1],receipt):service.cancel('external',operation[1],receipt)});
      }
      if (req.method === "GET" && pathname === "/v1/status") return send(res, 200, await evaluate("status", {}));
      if (req.method === "GET" && pathname === "/v1/models") return send(res, 200, await evaluate("models", {}));
      if (req.method === "GET" && pathname === "/v1/tasks") return send(res, 200, await evaluate("tasks", { materialize: parsedUrl.searchParams.get("materialize") === "1",includeDiagnostics:parsedUrl.searchParams.get('diagnostics')==='1' }));
      const task = pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      const taskExport=pathname.match(/^\/v1\/tasks\/([^/]+)\/export$/);
      if(taskExport&&req.method==='POST')return send(res,202,await require('./application-operation-host.cjs').submitLegacyOperation('media.export',{...await readJson(req),id:decodeURIComponent(taskExport[1])},req.headers['idempotency-key']));
      if (task && req.method === "GET") return send(res, 200, await evaluate("task", { id: decodeURIComponent(task[1]), materialize: parsedUrl.searchParams.get("materialize") === "1",includeDiagnostics:parsedUrl.searchParams.get('diagnostics')==='1' }));
      if(task&&req.method==='POST')return send(res,202,await require('./application-operation-host.cjs').submitLegacyOperation('tasks.cancel',{...await readJson(req),id:decodeURIComponent(task[1])},req.headers['idempotency-key']));
      const generation={'/v1/image/generate':'generation.image','/v1/video/generate':'generation.video','/v1/tianji/generate':'generation.tianji'}[pathname];
      if(req.method==='POST'&&generation)return send(res,202,await require('./application-operation-host.cjs').submitLegacyOperation(generation,await readJson(req),req.headers['idempotency-key']));
      if (process.env.WANJUAN_AUTOMATION_TEST_ENDPOINTS === "1" && req.method === "POST" && pathname === "/v1/automation-test/materialize") return send(res, 200, await evaluate("materializeTestResult", await readJson(req)));
      return send(res, 404, { ok: false, error: "未找到自动化接口" });
    } catch (error) {
      const code=(await import('../shared/application-operation-contract.mjs')).applicationOperationErrorCode(error);
      return send(res,Number(error?.statusCode||(code==='OPERATION_NOT_FOUND'?404:code==='OPERATION_FAILED'?500:400)),{ok:false,code,error:code==='OPERATION_PERMISSION_REQUIRED'?'Application permission required':error?.statusCode&&!error?.code?String(error.message):'Application operation failed',
        ...(code==='OPERATION_PERMISSION_REQUIRED'?{permission:error.permission}:{} )});
    }
  });
}
async function startAutomationServer(win) {
  if (win) setAutomationWindow(win);
  if (server) return automationInfo;
  // 上次异常退出可能留下旧端口和旧 token；新实例启动前先同步清理。
  removeInfo();
  automationInfo = { protocol: "starcanvas-automation", protocolVersion: 2, host: "127.0.0.1", port: 0, token: crypto.randomBytes(32).toString("hex"), pid: process.pid, appVersion: app.getVersion?.() || "", startedAt: Date.now() };
  server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { automationInfo.port = server.address().port; writeInfo(); resolve(); }); });
  return automationInfo;
}
async function stopAutomationServer() {
  removeInfo();
  registeredWindow = null;
  require('./application-operation-host.cjs').closeApplicationOperations();
  if (!server) { automationInfo = null; return; }
  await new Promise((resolve) => server.close(() => resolve()));
  server = null; automationInfo = null;
}
module.exports = { startAutomationServer, stopAutomationServer, setAutomationWindow, validateTianjiPayload };
