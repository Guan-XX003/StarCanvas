import type { ProtocolConfig } from "./app-types";

const DEFAULT_GEMINI_IMAGE_SUBMIT_PATH = "/v1beta/models/{model}:generateContent";

export function wanjuanBuildGeminiImageTransport(options: {
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  protocol?: ProtocolConfig | null;
}) {
  const baseUrl = String(options.apiBaseUrl || "").trim().replace(/\/+$/, "");
  const model = String(options.model || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const protocol = options.protocol && typeof options.protocol === "object" ? options.protocol : {};
  const submitPath = String(protocol.submitPath || DEFAULT_GEMINI_IMAGE_SUBMIT_PATH)
    .replaceAll("{model}", encodeURIComponent(model));
  const requestUrl = /^https?:\/\//i.test(submitPath) ? submitPath : `${baseUrl}${submitPath.startsWith("/") ? "" : "/"}${submitPath}`;
  let hostname = "";
  try { hostname = new URL(baseUrl).hostname.toLowerCase(); } catch {}
  const directGoogleApi = hostname === "generativelanguage.googleapis.com";
  let resolvedRequestUrl = requestUrl;
  if (directGoogleApi && apiKey) {
    const url = new URL(requestUrl);
    url.searchParams.set("key", apiKey);
    resolvedRequestUrl = url.toString();
  }
  const fixedImageSize = String(protocol.parameterAdapter?.fixedImageSize || "").trim();
  return {
    requestUrl: resolvedRequestUrl,
    headers: {
      ...(directGoogleApi ? {} : { Authorization: `Bearer ${apiKey}` }),
      "Content-Type": "application/json",
    },
    fixedImageSize,
    directGoogleApi,
  };
}
