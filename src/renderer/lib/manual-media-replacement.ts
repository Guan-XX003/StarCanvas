/** A small in-memory identity hint. This is not a cryptographic hash or a
 * security boundary; sampling keeps large data URLs off the hot path. */
export function manualMediaFingerprint(value:unknown):string {
  if (typeof value !== "string" || !value) return "";
  const sample = value.slice(0, 192) + value.slice(-192);
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < sample.length; i++) { const c = sample.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 3266489917); }
  return `v1:${value.length}:${a >>> 0}:${b >>> 0}`;
}
/** Tell the observer about an existing input without sending the URL or file. */
export function noteManualMediaReplacement(nodeId:unknown, value?:unknown):void {
  if (typeof nodeId !== "string" || !nodeId || nodeId.length > 1024) return;
  try {
    const fingerprint = manualMediaFingerprint(value);
    window.dispatchEvent(new CustomEvent("wanjuan:manual-media-replacement", {detail:fingerprint ? {nodeId,fingerprint} : {nodeId}}));
  } catch { /* Non-desktop and unavailable windows keep their existing flow. */ }
}
