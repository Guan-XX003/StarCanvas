/** Only fixed enum values are sent as implicit context. Free-form descriptions,
 * addresses, headers, bodies, variables and unknown fields stay on device. */
export function customNodeAiContext(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const config = input as Record<string, unknown>, result: Record<string, string> = {};
  const choices: Record<string, readonly string[]> = {
    method:["GET", "POST", "PUT"], outputType:["text", "image", "video", "audio"],
    executionMode:["sync", "async"], pollingMethod:["GET", "POST"],
  };
  for (const [key, allowed] of Object.entries(choices)) {
    if (typeof config[key] === "string" && allowed.includes(config[key] as string)) result[key] = config[key] as string;
  }
  return result;
}

const STRING_FIELDS = ["apiUrl", "method", "headers", "body", "outputType", "executionMode", "resultPath", "taskIdPath", "pollingUrl", "pollingMethod", "pollingHeaders", "pollingBody", "pollingResultPath", "pollingCompletedValue", "pollingFailedValue", "pollingErrorPath", "pollingProgressPath", "pollingResultDataPath"] as const;
const DEFAULTS: Record<string, string> = {method:"POST", outputType:"text", executionMode:"sync", resultPath:"data.result"};

function isInitialTemplate(field: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (DEFAULTS[field] === value) return true;
  if (field !== "headers" && field !== "body") return false;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 1 &&
      (field === "headers" ? parsed["Content-Type"] === "application/json" : parsed.prompt === "{{prompt}}");
  } catch { return false; }
}

/** AI only fills empty fields or the built-in untouched templates. A user's
 * current values (including edits made while waiting) always take priority. */
export function mergeCustomNodeAiSuggestion(previous: Record<string, any>, suggestion: unknown): Record<string, any> {
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) throw new Error("INVALID_AI_SUGGESTION");
  const proposal = suggestion as Record<string, unknown>, next = {...previous};
  const choices: Record<string, readonly string[]> = {method:["GET","POST","PUT"],pollingMethod:["GET","POST"],outputType:["text","image","video","audio"],executionMode:["sync","async"]};
  for (const key of STRING_FIELDS) {
    const value = proposal[key];
    if (typeof value !== "string" || !value.trim() || value.length > 16000 || (choices[key] && !choices[key].includes(value))) continue;
    const old = previous[key];
    if (old === undefined || old === null || old === "" || isInitialTemplate(key, old)) next[key] = value;
  }
  if ((previous.rawTextOutput === undefined || previous.rawTextOutput === null) && typeof proposal.rawTextOutput === "boolean") next.rawTextOutput = proposal.rawTextOutput;
  return next;
}
