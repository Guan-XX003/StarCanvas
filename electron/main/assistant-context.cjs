// Only coarse allowlisted UI locations may accompany a chat message. Never
// accept renderer-supplied names, project data, node content, or credentials.
const VIEWS = Object.freeze({canvas:'canvas',transit:'resources',agents:'agents',settings:'settings'});
const SETTINGS = Object.freeze({account:'account',oneStop:'model center',api:'API configuration',models:'model configuration',cloud:'uploads',generation:'generation',extensions:'local tools',data:'projects and backups',basic:'appearance and preferences',general:'appearance and preferences'});

// Defense in depth for the chat IPC. Keep in parity with the renderer's
// best-effort check; it is not a comprehensive secret-detection solution.
function containsLikelyAssistantSecret(value) {
  if (typeof value !== 'string') return false;
  let candidate = value.normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '');
  for (let i=0; i<2; i++) {
    candidate = candidate.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
      try { return decodeURIComponent(encoded); }
      catch { return encoded.replace(/%([0-7][0-9a-f])/gi, (_, hex) => String.fromCharCode(parseInt(hex,16))); }
    }).normalize('NFKC').replace(/[\u00ad\u200b-\u200f\u2060\ufeff]/g, '');
  }
  return /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/i.test(candidate)
    || /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(candidate)
    || /\bauthorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/i.test(candidate)
    || /\b(?:https?|wss?):\/\/[^\s/@]+@[^\s/]+/i.test(candidate)
    || /(?:[?&#](?:password|passwd|pwd)=)[^&#\s"']+/i.test(candidate)
    || /(?:\b(?:password|passwd|pwd)\b|密码|密碼)["']?\s*[:=：]\s*["']?[A-Za-z0-9!@#$%^&*._~+/=-]+/i.test(candidate)
    || /(?:[?&#](?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|key|access[_-]?token|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)=)[^&#\s"']+/i.test(candidate)
    || /(?:["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)["']?)\s*[:=]\s*["']?[^\s"',;}]{12,}/i.test(candidate);
}

function buildAssistantChatPrompt(text, context) {
  if (typeof text !== 'string' || !text.trim() || text.length > 16000) {
    const error = new Error('ASSISTANT_INVALID_MESSAGE'); error.code = 'ASSISTANT_INVALID_MESSAGE'; throw error;
  }
  if (containsLikelyAssistantSecret(text)) {
    const error = new Error('ASSISTANT_SENSITIVE_INPUT'); error.code = 'ASSISTANT_SENSITIVE_INPUT'; throw error;
  }
  const view = context && typeof context === 'object' && typeof context.view === 'string' && Object.hasOwn(VIEWS, context.view) ? VIEWS[context.view] : '';
  if (!view) return text;
  const tab = view === 'settings' && typeof context.settingsTab === 'string' && Object.hasOwn(SETTINGS, context.settingsTab) ? SETTINGS[context.settingsTab] : '';
  const location = tab ? `${view} / ${tab}` : view;
  return `[StarCanvas UI location: ${location}. This is a coarse navigation hint, not a view of user content.]\n\nUser message:\n${text}`;
}

// Config analysis can contain long documentation, but must not bypass the
// main-process credential gate. The renderer's redaction intentionally keeps
// these two exact placeholders as documentation; ignore only those complete
// placeholders during inspection, never alter the actual prompt sent.
function buildAssistantAnalysisPrompt(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 512000) {
    const error = new Error('ASSISTANT_INVALID_MESSAGE'); error.code = 'ASSISTANT_INVALID_MESSAGE'; throw error;
  }
  const inspected = text
    .replace(/(\bhttps?:\/\/)\[REDACTED\]@/gi, '$1')
    .replace(/([?&#])(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|key|access[_-]?token|token|secret|password|passwd|pwd|session[_-]?id|signature|sig|credential)=\[REDACTED\](?=$|[&#\s"'`),;])/gi, '$1redacted');
  if (containsLikelyAssistantSecret(inspected)) {
    const error = new Error('ASSISTANT_SENSITIVE_INPUT'); error.code = 'ASSISTANT_SENSITIVE_INPUT'; throw error;
  }
  return text;
}

module.exports = {buildAssistantChatPrompt, buildAssistantAnalysisPrompt, containsLikelyAssistantSecret};
