/** Guard machine-generated configuration before it can be applied. Existing
 * manually managed protocols are not changed. Cross-origin providers can still
 * be configured manually after the user verifies their documentation. */
export function validateButlerProtocolSafety(input: unknown, apiBase: unknown) {
  const errors: string[] = [];
  let containsCredential = false;
  let base: URL;
  try {
    base = new URL(String(apiBase || "").trim());
    if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return {ok:false, errors:["目标 API 地址无效，或包含凭据、查询参数或片段"]}; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return {ok:false, errors:["协议配置格式无效"]};
  const config = input as Record<string, unknown>;
  const sensitiveField = /^(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|key|token|secret|password|passwd|pwd|authorization|credential|signature)$/i;
  const placeholder = (value:unknown) => typeof value === "string" && /^(?:bearer\s+)?\{apiKey\}$/i.test(value.trim());
  // Model-generated request bodies may contain embedded credentials under a
  // provider-specific field. Inspect the object without echoing its contents.
  // Limits and cycle detection fail closed rather than skipping nested data.
  const unsafeBody = (body:unknown) => {
    const pending = [{value:body,depth:0}], seen = new WeakSet<object>();
    let visited = 0;
    while (pending.length) {
      const {value,depth} = pending.pop()!;
      if (!value || typeof value !== "object") continue;
      if (seen.has(value) || depth > 32 || ++visited > 4096) return true;
      seen.add(value);
      for (const [name,item] of Object.entries(value)) {
        if (sensitiveField.test(name) && item != null && item !== "" && !placeholder(item)) return true;
        if (typeof item === "string" && /\b(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/i.test(item)) return true;
        if (item && typeof item === "object") pending.push({value:item,depth:depth+1});
      }
    }
    return false;
  };
  for (const [name,value] of Object.entries(config)) {
    if (sensitiveField.test(name) && value != null && value !== "" && !placeholder(value)) {
      containsCredential = true; errors.push("协议配置包含疑似明文凭据，不能自动应用"); break;
    }
  }
  if (config.extraBody != null && (typeof config.extraBody !== "object" || Array.isArray(config.extraBody) || unsafeBody(config.extraBody))) { containsCredential = true; errors.push("附加请求体格式无效或包含疑似明文凭据，不能自动应用"); }
  const pathKeys = ["submitPath", "editPath", "pollPath", "contentPath", "statusPath", "resultPath"];
  for (const field of pathKeys) {
    const value = config[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) {
      errors.push(`${field} 格式不安全`); continue;
    }
    let decoded = value;
    try { for (let i = 0; i < 2; i++) decoded = decodeURIComponent(decoded); } catch { errors.push(`${field} 编码无效`); continue; }
    if (/\{\s*api[_-]?key\s*\}/i.test(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded)) {
      errors.push(`${field} 不得包含密钥占位符或控制字符`); continue;
    }
    try {
      const resolved = /^https?:\/\//i.test(value) ? new URL(value) : new URL(`${base.href.replace(/\/$/, "")}/${value.replace(/^\/+/, "")}`);
      if (!/^https?:$/.test(resolved.protocol) || resolved.username || resolved.password || resolved.hash || resolved.origin !== base.origin) {
        errors.push(`${field} 指向所选 API 之外的地址，不能自动应用`);
      }
      for (const key of resolved.searchParams.keys()) {
        if (/(?:^|[_-])(?:api[_-]?key|key|access[_-]?token|token|secret|password|sig|signature|credential)(?:$|[_-])/i.test(key)) {
          containsCredential = true; errors.push(`${field} 含敏感查询参数，不能自动应用`); break;
        }
      }
    } catch { errors.push(`${field} 不是有效的请求路径`); }
  }
  const headerNames = new Set<string>();
  for (const field of ["headers", "extraHeaders"]) {
    const value = config[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object" || Array.isArray(value)) { errors.push(`${field} 格式无效`); continue; }
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      const key = name.trim().toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || headerNames.has(key)) { errors.push(`${field} 包含无效或重复的请求头`); continue; }
      headerNames.add(key);
      if (typeof raw !== "string" || /[\r\n\0]/.test(raw) || raw.length > 4096) { errors.push(`${field} 包含无效的请求头内容`); continue; }
      if (key === "cookie" || key === "proxy-authorization" || key === "host") { if (key !== "host") containsCredential = true; errors.push(`${field} 包含不可自动应用的请求头`); continue; }
      if ((/(?:^|-)(?:authorization|auth|key|token|secret|password|passwd|credential|signature)(?:$|-)/i.test(key)
        || /(?:clientsecret|accesstoken|apikey|authorization)$/i.test(key))
        && !placeholder(raw)) { containsCredential = true; errors.push(`${field} 中的认证头必须使用 {apiKey} 占位符`); }
      else if (/\[REDACTED|\bsk-[A-Za-z0-9_-]{12,}/i.test(raw)) { containsCredential = true; errors.push(`${field} 包含疑似密钥或被遮盖的内容`); }
    }
  }
  return {ok:errors.length === 0, errors, containsCredential};
}
