// 网络安全校验：阻断本地/私网主机、校验公网 HTTP(S) URL、判断外链协议安全性
const {assertCandidateQaNetwork}=require('../../shared/isolated-candidate-qa.cjs');

function isBlockedNetworkHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^fe80:/i.test(host) || /^fc/i.test(host) || /^fd/i.test(host)) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function assertPublicHttpUrl(rawUrl, label = "URL") {
  assertCandidateQaNetwork(rawUrl);
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  if (isBlockedNetworkHost(parsed.hostname)) {
    throw new Error(`${label} cannot target localhost or private network hosts`);
  }
  return parsed;
}

function isSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// A prefix comparison is not an origin check: a longer port or userinfo can
// retain the textual prefix while navigating to a different origin. Never
// expose the desktop preload bridge to such a document.
function classifyAppNavigation(rawUrl, appBaseUrl) {
  let target;
  let base;
  try {
    if (typeof rawUrl !== "string" || typeof appBaseUrl !== "string") return "deny";
    target = new URL(rawUrl);
    base = new URL(appBaseUrl);
  } catch {
    return "deny";
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return "deny";
  if (target.username || target.password) return "deny";
  if (["http:", "https:"].includes(target.protocol) && target.origin === base.origin) return "allow";
  return isSafeExternalUrl(rawUrl) ? "external" : "deny";
}

function createAppNavigationGuard(appBaseUrl, openExternal) {
  if (typeof openExternal !== "function") throw new TypeError("Navigation handler required");
  return (event, rawUrl) => {
    const decision = classifyAppNavigation(rawUrl, appBaseUrl);
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "external") {
      // Desktop shell failure must not turn a denied navigation into an
      // unhandled rejection (nor log a potentially sensitive external URL).
      try { Promise.resolve(openExternal(rawUrl)).catch(() => {}); } catch {}
    }
  };
}

module.exports = {
  isBlockedNetworkHost,
  assertPublicHttpUrl,
  isSafeExternalUrl,
  classifyAppNavigation,
  createAppNavigationGuard
};
