/** Only fixed, coarse error descriptions may enter a saved custom task or
 * canvas node. Provider messages can contain credentials, URLs and prompts. */
const SAFE_LOCAL_GENERATION_ERRORS = new Set([
  "任务已完成，但未返回视频地址",
  "通义万相任务已完成，但未返回视频地址",
  "Seedance 任务已完成，但未返回视频地址",
  "H3 时长必须是 4–15 秒的整数",
  "H3 当前固定为 720p 分辨率",
  "H3 画幅比例无效，请在节点中重新选择支持的比例",
  "H3 当前仅开放文生视频；参考图、首尾帧、参考视频和音频尚未部署兼容适配，请移除参考素材后重试",
]);
export function safeGenerationError(error:unknown, context:"custom"|"media" = "custom"):string {
  let message = "";
  try {
    const value = error && typeof error === "object" ? (error as {message?:unknown}).message : error;
    if (typeof value === "string") message = value.slice(0, 20000);
  } catch { /* An unreadable error falls back to a generic description. */ }
  if (context === "media" && SAFE_LOCAL_GENERATION_ERRORS.has(message)) return message;
  const statusMatch = message.match(/(?:\bHTTP(?:\/\d(?:\.\d)?)?\b|\bstatus(?:\s*code)?\b|状态码|狀態碼|API\s*请求失败)\s*[:=]?\s*([45]\d{2})\b/i);
  const status = statusMatch?.[1] || "";
  const suffix = status ? `（HTTP ${status}）` : "";
  if (/rate.?limit|too many requests|限流|频率限制|頻率限制/i.test(message) || status === "429") return `请求频率受限${suffix}，请检查服务商的限流设置。`;
  if (/insufficient (?:balance|quota)|quota exceeded|余额不足|餘額不足|额度不足|額度不足/i.test(message)) return `可能余额不足或额度不足${suffix}，请检查服务商余额和额度。`;
  if (/unauthori[sz]ed|invalid (?:api.?key|token)|鉴权失败|鑑權失敗|密钥无效|金鑰無效/i.test(message) || status === "401") return `鉴权失败${suffix}，请检查所选服务及凭据。`;
  if (/timeout|timed out|超时|逾時/i.test(message) || status === "408") return `请求超时${suffix}，请检查网络及服务状态。`;
  if (/network error|network request failed|failed to fetch|网络错误|網路錯誤/i.test(message)) return `网络错误${suffix}，请检查网络及服务状态。`;
  if (/content.?policy|safety.?filter|内容审核|內容審核/i.test(message)) return `内容审核可能未通过${suffix}，请检查服务商规则。`;
  if (message === "无法提取 Task ID") return "接口未返回可识别的任务编号，请检查任务编号字段配置。";
  if (message === "无法提取结果") return "接口未返回可识别的结果，请检查结果字段配置。";
  if (status) return `接口请求失败${suffix}，请检查配置及服务商状态。`;
  return context === "custom" ? "自定义任务执行失败，请检查配置、网络及服务商状态。" : "生成任务执行失败，请检查配置、网络及服务商状态。";
}
export const safeCustomTaskError = (error:unknown) => safeGenerationError(error, "custom");
