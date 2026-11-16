import type { ProtocolConfig } from "./app-types";
import { buildMediaApiUrl } from "./model-binding";

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
  const requestUrl = buildMediaApiUrl(baseUrl, submitPath);
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

/** Gemini JSON responses and compatible gateways use both protobuf JSON naming styles. */
export function wanjuanExtractGeminiImage(response: any): { imageUrl: string; text: string } {
  const parts = Array.isArray(response?.candidates?.[0]?.content?.parts) ? response.candidates[0].content.parts : [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (typeof inline?.data === "string" && inline.data.trim()) {
      const mime = String(inline.mimeType || inline.mime_type || "image/png");
      if (/^image\/[a-z0-9.+-]+$/i.test(mime)) return { imageUrl: `data:${mime};base64,${inline.data}`, text: "" };
    }
    const file = part?.fileData || part?.file_data;
    const uri = String(file?.fileUri || file?.file_uri || "").trim();
    if (/^https?:\/\//i.test(uri)) return { imageUrl: uri, text: "" };
  }
  return { imageUrl: "", text: String(parts.find((part: any) => typeof part?.text === "string")?.text || "") };
}
