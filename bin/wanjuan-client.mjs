import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {randomUUID} from 'node:crypto';
import {APPLICATION_CLIENT_RESULT_CODES,APPLICATION_PERMISSIONS} from './application-operation-protocol.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTOMATION_FILE_NAMES = ["starcanvas-automation.json", "wanjuan-automation.json"];
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_MISSING_TASK_GRACE_MS = 12000;
const operationError=(code,permission='')=>Object.assign(new Error(code==='OPERATION_PERMISSION_REQUIRED'?'此操作需要在 StarCanvas 应用中授权':code==='OPERATION_OUTCOME_UNKNOWN'?'无法确认写操作结果；不会自动重试，请先查询状态':'StarCanvas 操作未完成'),{code,...(permission?{permission}:{})});
const publicCodes=new Set(APPLICATION_CLIENT_RESULT_CODES);

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(String(value))))];
}

export function automationCandidates() {
  const explicit = process.env.STARCANVAS_AUTOMATION_FILE || process.env.WANJUAN_AUTOMATION_FILE;
  if (explicit) return unique([explicit]);
  const userDataCandidates = (root) => AUTOMATION_FILE_NAMES.map((name) => path.join(root, name));
  return unique([
    ...userDataCandidates(path.join(process.cwd(), ".wanjuan-dev-user-data")),
    ...userDataCandidates(path.join(packageRoot, ".wanjuan-dev-user-data")),
    ...(process.platform === "darwin" ? userDataCandidates(path.join(os.homedir(), "Library", "Application Support", "wanjuan-ai-canvas-desktop-test")) : []),
    ...(process.platform === "win32" && process.env.APPDATA ? userDataCandidates(path.join(process.env.APPDATA, "wanjuan-ai-canvas-desktop-test")) : []),
    ...(process.platform === "linux" ? userDataCandidates(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "wanjuan-ai-canvas-desktop-test")) : []),
  ]);
}

function normalizeAutomationInfo(value, file) {
  const host = String(value?.host || "");
  const port = Number(value?.port);
  const token = String(value?.token || "");
  const pid = Number(value?.pid || 0);
  if (host !== "127.0.0.1") return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(token)) return null;
  if (pid && (!Number.isInteger(pid) || pid < 1)) return null;
  return { ...value, host, port, token, pid, file };
}

function processIsAlive(pid) {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readAutomationInfos() {
  const infos = [];
  for (const file of automationCandidates()) {
    try {
      const info = normalizeAutomationInfo(JSON.parse(fs.readFileSync(file, "utf8")), file);
      if (info) infos.push(info);
    } catch {}
  }
  return infos;
}

// 保留同步读取函数供外部诊断使用；真正请求会继续校验 PID、端口和鉴权。
export function readAutomationInfo() {
  const info = readAutomationInfos()[0];
  if (info) return info;
  throw new Error("找不到运行中的StarCanvas，请先启动应用");
}

async function requestWithInfo(info, method, endpoint, body, timeoutMs,operationReceipt,idempotencyKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${info.host}:${info.port}${endpoint}`, {
      method,
      headers: {
        authorization: `Bearer ${info.token}`,
        connection: "close",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(operationReceipt ? {"x-starcanvas-operation-receipt":String(operationReceipt)} : {}),
        ...(idempotencyKey ? {'idempotency-key':idempotencyKey}:{}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  } finally {
    clearTimeout(timer);
  }
}

export async function starcanvasRequest(method, endpoint, body, options = {}) {
  const infos = readAutomationInfos();
  if (!infos.length) throw new Error("找不到运行中的StarCanvas，请先启动应用");
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS));
  const idempotencyKey=method==='POST'&&(/^\/v1\/(?:image|video|tianji)\/generate$/.test(endpoint)||endpoint==='/v1/media/import'||/^\/v1\/tasks\//.test(endpoint))?String(options.idempotencyKey||body?.idempotencyKey||randomUUID()):'';
  let lastConnectionError = null,upgradeRequired=false;
  for (const info of infos) {
    if (!processIsAlive(info.pid)) continue;
    if(endpoint!=='/v1/status'&&Number(info.protocolVersion)!==2){upgradeRequired=true;continue;}
    try {
      const { response, result } = await requestWithInfo(info, method, endpoint, body, timeoutMs,options.operationReceipt,idempotencyKey);
      // 失效 token 或被其他进程占用的旧端口应继续尝试下一个候选。
      if (response.status === 401) continue;
      if (!response.ok || result.ok === false) throw operationError(publicCodes.has(result.code)?result.code:'OPERATION_FAILED',
        APPLICATION_PERMISSIONS.includes(result.permission)?result.permission:'');
      return result;
    } catch (error) {
      if (error?.name === "AbortError" || error instanceof TypeError) {
        if(!['GET','HEAD'].includes(String(method).toUpperCase()))throw Object.assign(operationError('OPERATION_OUTCOME_UNKNOWN'),idempotencyKey?{idempotencyKey}:{});
        lastConnectionError = error;
        continue;
      }
      throw error;
    }
  }
  if(upgradeRequired)throw operationError('OPERATION_APP_UPGRADE_REQUIRED');
  throw new Error(lastConnectionError ? "StarCanvas自动化端点不可用，已自动跳过失效凭据；请重启应用后重试" : "没有可用的StarCanvas自动化端点；请启动或重启应用");
}

export async function waitForStarCanvasTask(id, options = {}) {
  const taskId = String(id || "").trim();
  if (!taskId) throw new Error("必须提供 taskId 或 nodeId");
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 600000));
  const intervalMs = Math.max(250, Number(options.intervalMs || 1000));
  const missingGraceMs = Math.max(0, Number(options.missingGraceMs ?? DEFAULT_MISSING_TASK_GRACE_MS));
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await starcanvasRequest("GET", `/v1/tasks/${encodeURIComponent(taskId)}`);
    if (result.task) {
      if (["completed","failed","cancelled","interrupted"].includes(result.task.status)) return result;
      if (!["pending","submitting","submitted","queued","running","processing"].includes(result.task.status))throw operationError('OPERATION_TASK_STATUS_UNKNOWN');
    } else if (Date.now() - startedAt >= missingGraceMs) {
      throw new Error("任务未创建或已不存在；请检查模型配置、输入参数或任务列表");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`等待任务超时（${Math.round(timeoutMs / 1000)} 秒）`);
}

// Compatibility exports for existing scripts and MCP configurations.
export const wanjuanRequest = starcanvasRequest;
export const waitForTask = waitForStarCanvasTask;
