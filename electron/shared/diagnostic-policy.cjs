// Logging is an allowlist, not redaction of a few known credential spellings.
// Never retain arbitrary keys/strings, URLs (including paths and query), IDs,
// error messages or stacks. Transport errors returned to the UI are separate.
const COUNT_FIELDS = new Set([
  "count", "active", "queued", "limit", "attempt", "attempts", "port", "roots",
  "imageCount", "videoCount", "audioCount", "asset", "http", "other",
  "reviewedPortraitCount", "ordinaryImageCount", "reviewedPortraitResidualCount",
  "portraitConflictCount", "reviewedPortraitPreviewMatches", "generation", "waitMs",
  "hits", "crashCount", "exitCode", "errorCode", "statusCode", "status",
  "line", "messageLength", "argumentCount", "omittedFieldCount", "byteLength",
  "nodeCount", "edgeCount", "activeTasks", "durationMs", "elapsedMs", "progress",
]);
const BOOLEAN_FIELDS = new Set([
  "ok", "ready", "manual", "aborted", "completed", "isLoading", "isDestroyed",
  "contextIsolation", "nodeIntegration", "sandbox", "webSecurity", "signedGet",
  "usingPublicBaseUrl", "hasFileId", "hasDirectVideoUrl", "hasRequestBody",
]);
const CONTAINER_FIELDS = new Set(["media", "images", "videos", "audios", "details", "diagnostic", "status", "validation", "lastRendererMetrics"]);
const DIAGNOSTIC_EVENTS = new Set([
  "renderer-console", "main-uncaught-exception", "main-unhandled-rejection",
  "proxy-fetch-queued", "proxy-fetch-failed", "proxy-http-electron-net-no-replay", "proxy-http-electron-net-fallback", "proxy-http-retry",
  "tianji-generation-request-profile", "untrusted-ipc-blocked", "performance-settings-updated",
  "workspace-team-stopped", "workspace-team-start-failed", "workspace-team-started",
  "enterprise-gateway-usage-summary-failed", "enterprise-gateway-request-failed", "enterprise-gateway-started",
  "save-download-directory-fallback", "test-build-info", "update-check-api-fallback", "update-check-completed", "update-check-failed",
  "file-access-filter-disabled", "file-access-blocked", "file-access-filter-installed",
  "recover-renderer", "recover-renderer-load-failed", "recover-renderer-reveal-failed",
  "proxy-fetch-self-test", "text-api-self-test", "window-shell-shown", "window-reveal-timeout", "window-revealed",
  "desktop-web-preferences", "blank-screen-hit", "blank-screen-check-failed", "render-process-gone", "window-reveal-failed", "loadURL-failed", "window-startup-rearmed", "webview-attach-blocked",
  "upload-custom-public-media-failed", "upload-custom-public-media-fallback-succeeded", "upload-custom-public-media-fallback-failed",
  "upload-tos-media-presigned-put-failed", "upload-tos-media-header-put-failed", "upload-tos-media-succeeded",
  "upload-qiniu-media-put-succeeded", "upload-qiniu-media-put-failed", "upload-qiniu-media-validation-skipped", "upload-qiniu-media-succeeded",
  "anonymous-upload-attempt-failed", "ark-trusted-asset-cache-write-failed", "ark-trusted-asset-ready",
]);
const ENUM_FIELDS = {
  level: ["verbose", "debug", "info", "log", "warn", "warning", "error", "unknown"],
  method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  kind: ["image", "video", "audio", "text", "file"],
  reason: ["env", "unresponsive", "did-fail-load", "render-process-gone", "crashed", "oom", "killed", "clean-exit", "abnormal-exit", "launch-failed", "integrity-failure"],
  readiness: ["app-ready", "stable-shell-fallback"],
  encoding: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"],
};
function diagnosticErrorClass(value) {
  try {
    const source = typeof value === "string" ? value : Object.getOwnPropertyDescriptor(value || {}, "code")?.value
      || Object.getOwnPropertyDescriptor(value || {}, "name")?.value;
    const text = typeof source === "string" ? source.slice(0, 4000) : "";
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "EACCES", "EPERM", "ENOENT", "SECURE_STORAGE_BUSY", "SECURE_STORAGE_TIMEOUT", "SECURE_STORAGE_UNAVAILABLE", "SECURE_STORAGE_ASYNC_UNSUPPORTED"]) {
      if (new RegExp(`\\b${code}\\b`).test(text)) return code;
    }
    if (/AbortError|\babort(?:ed)?\b/i.test(text)) return "aborted";
    if (/\btimeout\b|\btimed out\b/i.test(text)) return "timeout";
  } catch {}
  return "unclassified";
}
function sanitizeLogPayload(payload, depth = 0) {
  try { return summarizeLogPayload(payload, depth); } catch { return { omitted: true }; }
}
function summarizeLogPayload(payload, depth) {
  if (depth > 4) return { omitted: true };
  if (typeof payload === "string") return { messageLength: payload.length, errorClass: diagnosticErrorClass(payload) };
  if (!payload || typeof payload !== "object") return { omitted: true };
  if (Array.isArray(payload)) return { count: payload.length };
  if (ArrayBuffer.isView(payload)) return { byteLength: Math.min(payload.byteLength, 1e9) };
  const result = {};
  let omitted = 0;
  try {
    const keys = Object.keys(payload);
    omitted += Math.max(0, keys.length - 64);
    for (const key of keys.slice(0, 64)) {
      const descriptor = Object.getOwnPropertyDescriptor(payload, key);
      if (!descriptor) { omitted++; continue; }
      if (!("value" in descriptor)) { omitted++; continue; }
      const value = descriptor.value;
      if (COUNT_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9) result[key] = value;
      else if (BOOLEAN_FIELDS.has(key) && typeof value === "boolean") result[key] = value;
      else if (Object.hasOwn(ENUM_FIELDS, key) && ENUM_FIELDS[key].includes(value)) result[key] = value;
      else if (["error", "message", "errorClass", "code", "name"].includes(key)) result.errorClass = diagnosticErrorClass(value);
      else if (["url", "src", "senderUrl", "validatedURL", "preferredUrl"].includes(key) && typeof value === "string") {
        result.urlScheme = /^https:/i.test(value) ? "https" : /^http:/i.test(value) ? "http" : /^file:/i.test(value) ? "file" : "other";
      } else if (key === "endpoint" && typeof value === "string" && /^\/api\/cut\/model\/coze-seedance-(?:text|video|image-first|image-first-last)-special$/.test(value)) result.endpoint = value;
      else if (CONTAINER_FIELDS.has(key) && value && typeof value === "object") result[key] = sanitizeLogPayload(value, depth + 1);
      else omitted++;
    }
  } catch { omitted++; }
  if (omitted) result.omittedFieldCount = omitted;
  return result;
}

const guardedConsoles = new WeakSet();
function installDiagnosticConsole(target = console) {
  if (guardedConsoles.has(target)) return;
  guardedConsoles.add(target);
  const baseLog = typeof target.log === "function" ? target.log.bind(target) : () => {};
  const emit = (write, level, args) => {
    try {
      write("application-console", {
        level, argumentCount: args.length,
        arguments: args.slice(0, 12).map(value => sanitizeLogPayload(value)),
      });
    } catch { /* Diagnostics must not affect application work. */ }
  };
  for (const level of ["debug", "log", "info", "warn", "error", "trace", "dir", "dirxml", "table", "group", "groupCollapsed", "profile", "profileEnd", "timeStamp"]) {
    if (typeof target[level] !== "function") continue;
    // Native trace adds a stack even for sanitized arguments. Profiling and
    // timestamps can retain original labels/stacks in a separate recording.
    const write = ["trace", "profile", "profileEnd", "timeStamp", "dir", "dirxml", "table"].includes(level) ? baseLog : target[level].bind(target);
    target[level] = (...args) => emit(write, level, args);
  }
  if (typeof target.assert === "function") target.assert = (condition, ...args) => {
    if (!condition) emit(baseLog, "assert", args);
  };
  const timers = new Map();
  const counters = new Map();
  const labelKey = value => typeof value === "string" ? value : "default";
  const bound = map => { if (map.size > 128) map.delete(map.keys().next().value); };
  if (typeof target.time === "function") target.time = label => {
    const key = labelKey(label);
    if (!timers.has(key)) timers.set(key, Date.now());
    bound(timers);
  };
  for (const method of ["timeLog", "timeEnd"]) if (typeof target[method] === "function") target[method] = (label, ...args) => {
    const key = labelKey(label);
    const started = timers.get(key);
    if (method === "timeEnd") timers.delete(key);
    emit(baseLog, method, [{ ok: started !== undefined, durationMs: started === undefined ? 0 : Math.max(0, Date.now() - started) }, ...args]);
  };
  if (typeof target.count === "function") target.count = label => {
    const key = labelKey(label);
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count); bound(counters);
    emit(baseLog, "count", [{ count }]);
  };
  if (typeof target.countReset === "function") target.countReset = label => { counters.delete(labelKey(label)); };
}

module.exports = { sanitizeLogPayload, diagnosticErrorClass, installDiagnosticConsole, DIAGNOSTIC_EVENTS };
