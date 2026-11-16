#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";
import { starcanvasRequest, waitForStarCanvasTask } from "./starcanvas-client.mjs";
import { normalizeTianjiAutomationPayload } from "./starcanvas-tianji-input.mjs";

// Deliberately support the tested legacy stdio lifecycle, not arbitrary future
// protocol versions echoed from a client. Modern clients can negotiate this
// revision; per-request 2026 discovery is not advertised as implemented.
const MCP_PROTOCOL_VERSION = "2025-06-18";
const serverVersion = fs.readFileSync(new URL("./VERSION.txt", import.meta.url), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(serverVersion)) throw new Error("MCP_PACKAGE_VERSION_INVALID");
let initializationOffered = false, initialized = false;

const tools = [
  {name:'starcanvas_submit_operation',description:'提交结构化应用操作。画布修改、节点文字分享、基础设置和页面导航需要 App 内确认；返回 request 与私有 receipt，用于查询或取消，不表示已执行。保留同一 idempotencyKey 可恢复重复提交结果。',inputSchema:{type:'object',required:['operation','idempotencyKey'],properties:{operation:{type:'string',enum:['app.status','app.preferences.read','app.preferences.set','app.navigate','models.list','tasks.list','tasks.get','tasks.cancel','generation.image','generation.video','generation.tianji','projects.list','canvas.read','canvas.read.release','canvas.plan.release','canvas.plan.preview','canvas.plan.apply','canvas.plan.undo','canvas.generation.preflight']},projectId:{type:'string'},arguments:{type:'object',description:'preferences.read: {}；preferences.set: kind=theme|language|autoDownload,value（只支持基础枚举/布尔值）；app.navigate: destination=canvas|resources|agents|workspace|settings|account|appearance|api|models|generation；canvas.read: scope=selected|structure, includeContent=false；preview: ticketId,proposal；apply/undo/preflight: planId；tasks.get: id。修改设置及导航须提供 projectId。'},idempotencyKey:{type:'string',minLength:16,maxLength:160}},additionalProperties:false}},
  {name:'starcanvas_get_operation',description:'使用提交时返回的 receipt 查询操作状态和实际结果。outcome_unknown 不等于失败，不得自动重做。',inputSchema:{type:'object',required:['id','receipt'],properties:{id:{type:'string'},receipt:{type:'string'}},additionalProperties:false}},
  {name:'starcanvas_cancel_operation',description:'取消尚未执行的请求。执行开始后可能返回 OPERATION_TOO_LATE；不声称取消已发生的画布修改。',inputSchema:{type:'object',required:['id','receipt'],properties:{id:{type:'string'},receipt:{type:'string'}},additionalProperties:false}},
  { name: "starcanvas_status", description: "检查StarCanvas桌面应用是否已启动并可接受自动化任务。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "starcanvas_list_models", description: "列出StarCanvas当前配置的图片、视频和文本模型，不返回 API Key。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "starcanvas_list_tasks", description: "列出StarCanvas任务清单中的生成任务。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "starcanvas_generate_image", description: "使用StarCanvas创建文生图或参考图生图任务。返回 nodeId，可用于查询或等待任务。", inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", description: "图片提示词" }, model: { type: "string", description: "模型名称；留空使用应用首选模型" }, size: { type: "string", default: "1024x1024" }, referenceImage: { type: "string", description: "可选参考图片绝对路径或 URL" } }, additionalProperties: false } },
  { name: "starcanvas_generate_video", description: "使用StarCanvas创建文生视频或图生视频任务。返回 nodeId，可用于查询或等待任务。", inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string", description: "视频提示词" }, model: { type: "string", description: "模型名称；留空使用应用首选模型" }, resolution: { type: "string", default: "1280x720" }, duration: { type: "number", description: "视频时长（秒）" }, aspectRatio: { type: "string", description: "例如 16:9" }, referenceImage: { type: "string", description: "图生视频输入图片绝对路径或 URL" } }, additionalProperties: false } },
  { name: "starcanvas_generate_tianji_video", description: "使用即梦天玑专用节点生成视频，支持文生、首帧、首尾帧和参考素材四种模式。", inputSchema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, model: { type: "string" }, mode: { type: "string", enum: ["text-to-video", "first-frame", "first-last", "reference-media"], default: "text-to-video" }, resolution: { type: "string", default: "720p" }, duration: { type: "number", default: 5 }, aspectRatio: { type: "string", default: "16:9" }, images: { type: "array", maxItems: 9, items: { type: "string" } }, portraitAssetIds: { type: "array", maxItems: 9, description: "已审核且状态为 Active 的天玑最终人像素材 ID；仅用于 reference-media。", items: { type: "string", minLength: 1, maxLength: 512, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" } }, videos: { type: "array", maxItems: 3, items: { type: "string" } }, audios: { type: "array", maxItems: 3, items: { type: "string" } } }, additionalProperties: false } },
  { name: "starcanvas_get_task", description: "按 taskId 或生成命令返回的 nodeId 查询任务。", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false } },
  { name: "starcanvas_wait_task", description: "等待任务结束并返回最终状态。id 可以是 taskId 或 nodeId。", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, timeoutSeconds: { type: "number", default: 600, minimum: 1, maximum: 3600 } }, additionalProperties: false } },
  { name: "starcanvas_cancel_task", description: "取消正在运行的StarCanvas生成任务。", inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false } },
];

const operationTool=tools.find(tool=>tool.name==='starcanvas_submit_operation');operationTool.inputSchema.properties.operation.enum.push('media.export','media.import','media.reference.release');
operationTool.inputSchema.properties.operation.enum.push('canvas.plan.generate');
operationTool.inputSchema.properties.arguments.description+='；canvas.plan.generate: planId,nodeId，仅可生成已执行方案中的图片/视频节点，需在 App 单独确认素材发送与费用。';
operationTool.inputSchema.properties.arguments.description+=' tasks.list/get 可显式 includeDiagnostics=true，仅返回固定错误类别和 HTTP 状态；普通读取不含诊断。未知进度为 null，矛盾状态为 unknown，缺失数据或歧义编号会明确报错。读取不轮询上游或下载素材。media.export: {id}，需 projectId 和 App 单次确认，完成后才提供该结果的本地文件位置。';
tools.push({name:'starcanvas_export_task',description:'提交单条已完成任务结果的导出申请。返回 request/receipt；App 确认前不下载、不提供源地址或文件位置。审批完成后查询同一操作取得本地媒体文件；这不会重新生成。',inputSchema:{type:'object',required:['id'],properties:{id:{type:'string'},projectId:{type:'string'},idempotencyKey:{type:'string',minLength:16,maxLength:160}},additionalProperties:false}});
operationTool.inputSchema.properties.arguments.description+=' media.import: {type:image|video|audio,source:绝对路径或公开HTTP(S)地址}，需项目与单次确认，只返回临时参考编号。media.reference.release: {referenceId}，撤销该编号，不删除媒体文件。';
tools.push({name:'starcanvas_import_media',description:'申请导入一份参考素材。返回 request/receipt；App 批准前不读取文件或下载。完成后仅返回绑定当前调用身份和项目、到期或重启失效的 referenceId 与媒体元数据，不返回本地路径/文件内容。导入不是付费生成授权；可将编号作为 references 提交另一次生成审批。',inputSchema:{type:'object',required:['source','type'],properties:{source:{type:'string',maxLength:8192},type:{type:'string',enum:['image','video','audio']},projectId:{type:'string'},idempotencyKey:{type:'string',minLength:16,maxLength:160}},additionalProperties:false}});
for(const tool of tools)if(/^starcanvas_generate_|^starcanvas_cancel_task$/.test(tool.name)){Object.assign(tool.inputSchema.properties,{projectId:{type:'string',description:'目标项目，省略时绑定请求发出时的当前项目'},idempotencyKey:{type:'string',minLength:16,maxLength:160,description:'同一请求恢复时复用；不要用新键自动重做'}});tool.description='提交 App 审批，返回 request/receipt；确认前不执行。生成可用 references 传入已批准导入的编号，具体类型/数量依实际协议校验。原始路径/URL 会按顺序申请素材导入，再单独申请付费生成；查询同一流程，最终完成后才取得 nodeId，无须手动复制中间编号。天玑 portraitAssetIds 在确认后经当前服务商已有分组核验，可用才创建人像节点；不自动创建分组/审核人像或上传预览图片。结果导出使用单独的 starcanvas_export_task 审批。';}
delete tools.find(tool=>tool.name==='starcanvas_generate_tianji_video').inputSchema.properties.mode.default;
tools.find(tool=>tool.name==='starcanvas_generate_tianji_video').inputSchema.properties.mode.description='省略时：有参考素材则 reference-media，无素材则 text-to-video；显式模式不会被覆盖。';
tools.find(tool=>tool.name==='starcanvas_cancel_task').description='提交指定任务的本机停止申请，返回 request/receipt，需 App 单独确认。查询操作完成仅表示本机已请求停止，不保证上游已取消或退款。';
for(const tool of tools)if(/^starcanvas_generate_/.test(tool.name))tool.inputSchema.properties.references={type:'array',maxItems:15,uniqueItems:true,items:{type:'string',pattern:'^reference-[a-f0-9-]{36}$'},description:'已批准导入且未过期的参考编号，按顺序使用；与当前项目/调用身份绑定。生成另需 App 确认。'};

const legacyAliases = Object.fromEntries(tools.map((tool) => [tool.name.replace(/^starcanvas_/, "wanjuan_"), tool.name]));

async function callTool(requestedName, args = {}) {
  const name = legacyAliases[requestedName] || requestedName;
  if(name==='starcanvas_submit_operation')return starcanvasRequest('POST','/v1/operations',args);
  if(name==='starcanvas_import_media')return starcanvasRequest('POST','/v1/media/import',args);
  if(name==='starcanvas_get_operation'||name==='starcanvas_cancel_operation')return starcanvasRequest(name==='starcanvas_get_operation'?'GET':'DELETE',`/v1/operations/${encodeURIComponent(String(args.id||''))}`,undefined,{operationReceipt:args.receipt});
  if (name === "starcanvas_status") return starcanvasRequest("GET", "/v1/status");
  if (name === "starcanvas_list_models") return starcanvasRequest("GET", "/v1/models");
  if (name === "starcanvas_list_tasks") return starcanvasRequest("GET", "/v1/tasks");
  if (name === "starcanvas_generate_image") return starcanvasRequest("POST", "/v1/image/generate", args);
  if (name === "starcanvas_generate_video") return starcanvasRequest("POST", "/v1/video/generate", args);
  if (name === "starcanvas_generate_tianji_video") return starcanvasRequest("POST", "/v1/tianji/generate", normalizeTianjiAutomationPayload(args));
  if (name === "starcanvas_get_task") return starcanvasRequest("GET", `/v1/tasks/${encodeURIComponent(String(args.id || ""))}`);
  if (name === "starcanvas_export_task") return starcanvasRequest("POST", `/v1/tasks/${encodeURIComponent(String(args.id || ""))}/export`,{...(args.projectId?{projectId:args.projectId}:{}),...(args.idempotencyKey?{idempotencyKey:args.idempotencyKey}:{})});
  if (name === "starcanvas_wait_task") return waitForStarCanvasTask(args.id, { timeoutMs: Math.min(3600, Math.max(1, Number(args.timeoutSeconds || 600))) * 1000 });
  if (name === "starcanvas_cancel_task") return starcanvasRequest("POST", `/v1/tasks/${encodeURIComponent(String(args.id || ""))}`,{...(args.projectId?{projectId:args.projectId}:{}),...(args.idempotencyKey?{idempotencyKey:args.idempotencyKey}:{})});
  throw new Error(`未知工具：${requestedName}`);
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function result(id, value) { send({ jsonrpc: "2.0", id, result: value }); }
function error(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return error(null, -32700, "Parse error"); }
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") return error(null, -32600, "Invalid Request");
  const { id, method, params = {} } = message;
  if (id === undefined && method === "notifications/initialized") { if (initializationOffered) initialized = true; return; }
  if (id === undefined) return;
  if (id !== null && typeof id !== "string" && !(typeof id === "number" && Number.isFinite(id))) return error(null, -32600, "Invalid request ID");
  if (!params || typeof params !== "object" || Array.isArray(params)) return error(id, -32602, "Invalid params");
  try {
    if (method === "initialize") {
      if (initializationOffered) return error(id, -32600, "MCP is already initialized or awaiting notifications/initialized");
      if (typeof params.protocolVersion !== "string" || !params.protocolVersion.trim()) return error(id, -32602, "protocolVersion is required");
      initializationOffered = true;
      return result(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "starcanvas", version: serverVersion }, instructions: "Supports MCP stdio 2025-06-18. If your client cannot use this revision, disconnect; do not submit tools. StarCanvas App automation requires protocol 2. 连接本机 StarCanvas；生成、取消、素材导入及结果导出先返回审批请求，须在 App 内确认。生成操作完成只指本机提交，请另查任务。导入的临时 referenceId 可用于 references，生成须另外确认。原始路径/URL 会分步申请导入和生成，查询原始流程 request/receipt；不会因为批准导入就开始生成。工具参数中的 confirmed 或 permissions 不能自行授权。" });
    }
    if (method === "ping") return result(id, {});
    if (!["tools/list", "tools/call"].includes(method)) return error(id, -32601, "Method not found");
    if (!initialized) return error(id, -32002, "MCP initialization required: initialize, then notifications/initialized (2025-06-18)");
    const requestVersion = params._meta?.["io.modelcontextprotocol/protocolVersion"];
    if (requestVersion !== undefined && requestVersion !== MCP_PROTOCOL_VERSION) return error(id, -32602, "Unsupported MCP protocol version; supported: 2025-06-18");
    if (method === "tools/list") return result(id, { tools });
    if (method === "tools/call") {
      try {
        const value = await callTool(String(params.name || ""), params.arguments || {});
        return result(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false });
      } catch (toolError) {
        const failure={ok:false,code:toolError?.code||'AUTOMATION_ERROR',error:String(toolError?.message||toolError),...(toolError?.permission?{permission:toolError.permission}:{}),...(toolError?.idempotencyKey?{idempotencyKey:toolError.idempotencyKey}:{})};
        return result(id, { content: [{ type: "text", text: JSON.stringify(failure) }],structuredContent:failure,isError:true });
      }
    }
    return error(id, -32601, `Method not found: ${method}`);
  } catch (requestError) { return error(id, -32603, String(requestError?.message || requestError)); }
});
