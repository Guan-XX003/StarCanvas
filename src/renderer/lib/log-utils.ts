/**
 * 日志与网络错误工具。
 *
 * - serializeErrorPreview：用户可见的上游错误摘要；不能直接用于持久化诊断。
 * - WanJuanIsTransientNetworkError：判断错误是否为可重试的瞬时网络错误。
 * - safeStringifyRequestForLog：仅记录请求/响应结构，不记录正文、凭据或媒体地址。
 *
 * 自 bundle 反混淆迁入，行为保持一致。
 */

export function serializeErrorPreview(errorPayload: any, maxLength = 1200) {
  let truncate = (text) =>
    typeof text == `string` && text.length > maxLength ?
    `${text.slice(0, maxLength)}...(truncated ${text.length} chars)` :
    text;
  try {
    if (typeof errorPayload == `string`) return truncate(errorPayload);
    let serialized = JSON.stringify(errorPayload);
    return typeof serialized == `string` ?
      truncate(serialized) :
      `[unserializable error payload]`;
  } catch (error) {
    try {
      let stringified = String(errorPayload);
      if (stringified && stringified !== `[object Object]`) return truncate(stringified);
    } catch {}
    let messageSuffix = error && error.message ? `: ${error.message}` : ``;
    return `[unserializable error payload${messageSuffix}]`;
  }
}

export function WanJuanIsTransientNetworkError(error: any) {
  let message = String(
      error?.message ||
      error?.reason ||
      error?.code ||
      error?.name ||
      error ||
      ``,
    ),
    code = String(error?.code || error?.cause?.code || ``),
    name = String(error?.name || ``),
    combined = `${name} ${code} ${message}`;
  return /socket hang up|ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|network error|failed to fetch|load failed|fetch failed|Proxy fetch request timeout|request timeout|timed out|timeout|超时/i.test(
    combined,
  );
}

export function safeStringifyRequestForLog(requestPayload: any, maxLength = 4000) {
  try {
    const seen = new WeakSet<object>();
    if (requestPayload === undefined) return `[no diagnostic payload]`;
    const countFields = new Set([`count`, `imageCount`, `videoCount`, `audioCount`, `asset`, `http`, `other`, `reviewedPortraitCount`, `ordinaryImageCount`, `reviewedPortraitResidualCount`, `portraitConflictCount`, `reviewedPortraitPreviewMatches`, `status`, `statusCode`, `progress`, `pollCount`, `errorCount`, `durationMs`, `elapsedMs`]);
    const flagFields = new Set([`ok`, `completed`, `ready`, `aborted`, `hasFileId`, `hasDirectVideoUrl`]);
    const containers = new Set([`media`, `images`, `videos`, `audios`, `body`, `request`, `response`]);
    const summarize = (value: any, depth = 0): any => {
      if (typeof value === `string`) return { messageLength: value.length, errorClass: diagnosticErrorClass(value) };
      if (depth > 4 || !value || typeof value !== `object`) return { omitted: true };
      if (seen.has(value)) return `[circular]`;
      seen.add(value);
      if (Array.isArray(value)) return { count: value.length, items: value.slice(0, 12).map(item => summarize(item, depth + 1)) };
      if (ArrayBuffer.isView(value)) return { byteLength: Math.min(value.byteLength, 1e9) };
      const result: any = {};
      let omitted = 0;
      // Do not invoke provider getters/toJSON or retain provider-controlled keys.
      const keys = Object.keys(value);
      omitted += Math.max(0, keys.length - 64);
      for (const key of keys.slice(0, 64)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) { omitted++; continue; }
        if (!(`value` in descriptor)) { omitted++; continue; }
        const item = descriptor.value;
        if (countFields.has(key) && typeof item === `number` && Number.isFinite(item) && Math.abs(item) <= 1e9) result[key] = item;
        else if (flagFields.has(key) && typeof item === `boolean`) result[key] = item;
        else if ([`error`, `message`, `code`, `name`].includes(key)) result.errorClass = diagnosticErrorClass(item);
        else if (containers.has(key)) result[key] = summarize(item, depth + 1);
        else omitted++;
      }
      if (omitted) result.omittedFieldCount = omitted;
      return result;
    };
    const serialized = JSON.stringify(summarize(requestPayload));
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...(truncated ${serialized.length} chars)` : serialized;
  } catch {
    return `[unserializable diagnostic payload]`;
  }
}

function diagnosticErrorClass(value: any) {
  if (typeof value !== `string`) return `unclassified`;
  for (const code of [`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE`, `SECURE_STORAGE_BUSY`, `SECURE_STORAGE_TIMEOUT`, `SECURE_STORAGE_UNAVAILABLE`]) {
    if (new RegExp(`\\b${code}\\b`).test(value.slice(0, 4000))) return code;
  }
  return /AbortError|\baborted\b/i.test(value) ? `aborted` : /\btimeout\b|\btimed out\b/i.test(value) ? `timeout` : `unclassified`;
}

const guardedConsoles = new WeakSet<object>();
export function installRendererDiagnosticConsole(target: any = console) {
  if (guardedConsoles.has(target)) return;
  guardedConsoles.add(target);
  const baseLog = typeof target.log === `function` ? target.log.bind(target) : () => {};
  const emit = (write: any, args: any[], level = `log`) => {
    try { write(`renderer-diagnostic`, level, safeStringifyRequestForLog(args)); } catch {}
  };
  for (const level of [`debug`, `log`, `info`, `warn`, `error`, `trace`, `dir`, `dirxml`, `table`, `group`, `groupCollapsed`, `profile`, `profileEnd`, `timeStamp`]) {
    if (typeof target[level] !== `function`) continue;
    const write = [`trace`, `profile`, `profileEnd`, `timeStamp`, `dir`, `dirxml`, `table`].includes(level) ? baseLog : target[level].bind(target);
    target[level] = (...args: any[]) => emit(write, args, level);
  }
  if (typeof target.assert === `function`) target.assert = (condition: any, ...args: any[]) => { if (!condition) emit(baseLog, args, `assert`); };
  const timers = new Map<string, number>();
  const counters = new Map<string, number>();
  const labelKey = (value: any) => typeof value === `string` ? value : `default`;
  const bound = (map: Map<string, number>) => { if (map.size > 128) map.delete(map.keys().next().value); };
  if (typeof target.time === `function`) target.time = (label: any) => {
    const key = labelKey(label);
    if (!timers.has(key)) timers.set(key, Date.now());
    bound(timers);
  };
  for (const method of [`timeLog`, `timeEnd`]) if (typeof target[method] === `function`) target[method] = (label: any, ...args: any[]) => {
    const key = labelKey(label);
    const started = timers.get(key);
    if (method === `timeEnd`) timers.delete(key);
    emit(baseLog, [{ ok: started !== undefined, durationMs: started === undefined ? 0 : Math.max(0, Date.now() - started) }, ...args], method);
  };
  if (typeof target.count === `function`) target.count = (label: any) => {
    const key = labelKey(label);
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count); bound(counters);
    emit(baseLog, [{ count }], `count`);
  };
  if (typeof target.countReset === `function`) target.countReset = (label: any) => { counters.delete(labelKey(label)); };
}
