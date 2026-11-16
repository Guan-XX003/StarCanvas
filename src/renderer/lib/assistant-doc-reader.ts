import { normalizeAssistantDocumentationUrl } from "./assistant-onboarding";

// The assistant path sends public documentation URLs to this fixed third-party
// reader. It never navigates a local browser to a user-provided document.
const READER_ORIGIN = "https://r.jina.ai";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 180000;
const TIMEOUT_MS = 60000;

async function readViaPublicReader(documentUrl: string): Promise<string> {
  const normalized = normalizeAssistantDocumentationUrl(documentUrl);
  if (!normalized) throw new Error("仅支持不含凭据的公开文档链接");
  const target = new URL(`${READER_ORIGIN}/${normalized}`);
  if (target.origin !== READER_ORIGIN || target.username || target.password) throw new Error("文档读取地址无效");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.href, {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer", signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("公开文档转读失败");
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) throw new Error("文档内容过大");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0, text = "";
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) { controller.abort(); throw new Error("文档内容过大"); }
        text += decoder.decode(value, {stream:true});
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
    if (!cleaned || /<title>\s*(登录|Login|Feishu|Lark)/i.test(cleaned)) throw new Error("文档为空或需要登录");
    return cleaned.slice(0, MAX_TEXT_CHARS);
  } catch (error) {
    // Do not surface network exception text, which may contain the document URL.
    if (error instanceof Error && ["文档内容过大", "文档为空或需要登录"].includes(error.message)) throw error;
    throw new Error("公开文档读取失败，请确认链接可公开访问或稍后重试");
  } finally { clearTimeout(timer); }
}

/** Read a public page through the fixed reader, including a bounded number of
 * Apifox endpoint pages. Never follows reader redirects or opens the source URL. */
export async function fetchAssistantDocumentation(documentUrl: string): Promise<string> {
  const normalized = normalizeAssistantDocumentationUrl(documentUrl);
  if (!normalized) throw new Error("仅支持不含凭据的公开文档链接");
  const source = new URL(normalized);
  const index = await readViaPublicReader(normalized);
  if (!/(?:^|\.)apifox\.(?:cn|com)$/i.test(source.hostname)) return index;
  const escapedHost = source.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = index.matchAll(new RegExp(`${escapedHost}/(\\d+e0)\\b`, "g"));
  const ids = Array.from(new Set(Array.from(matches, match => match[1]))).slice(0, 20);
  const details: string[] = [];
  for (let start = 0; start < ids.length; start += 4) {
    const batch = ids.slice(start, start + 4);
    const pages = await Promise.all(batch.map(async id => {
      try { return (await readViaPublicReader(`${source.origin}/${id}`)).slice(0, 5000); }
      catch { return ""; }
    }));
    details.push(...pages.filter(Boolean));
  }
  return details.length ? `${index}\n\n===== 接口详情 =====\n\n${details.join("\n\n----- 接口分隔 -----\n\n")}`.slice(0, MAX_TEXT_CHARS) : index;
}
