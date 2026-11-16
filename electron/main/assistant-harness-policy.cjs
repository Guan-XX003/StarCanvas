// Restrictive composition checks for reviewed macOS Harness versions only.
// This is not an operating-system sandbox or a proof about plugin behavior.
const requiredDisabled = ["persistent-bash", "persistent-pwsh", "tool-fs", "tool-working-directory", "session-log-deepseek", "plugin-package-inventory-deepseek", "llm-retry", "sessions"];
const knownPlugins = Object.freeze({
  "sdk-app-startup":"dsh-sdk-app", "sdk-jsonrpc-server":"dsh-sdk-jsonrpc-server",
  "deepseek-llm-api-extensions":"dsh-deepseek-llm-api-extensions",
  "session-log-deepseek":"dsh-session-log-deepseek", "plugin-package-inventory-deepseek":"dsh-plugin-package-inventory-deepseek",
  "llm-deepseek":"dsh-llm-deepseek-api-key", sandbox:"dsh-sandbox-local", filesystem:"dsh-fs-local",
  "attachment-local":"dsh-attachment-local", "tool-fs":"dsh-tool-fs", "working-directory":"dsh-working-directory",
  "tool-working-directory":"dsh-tool-working-directory", "session-projection":"dsh-session-projection",
  "token-meter":"dsh-token-meter", "compaction-basic":"dsh-compaction-basic", "image-offload":"dsh-compaction-image-offload",
  "sandbox-policy":"dsh-sandbox-policy", subprocess:"dsh-subprocess-local", pty:"dsh-terminal",
  "terminal-bash":"dsh-terminal-bash", "terminal-pwsh":"dsh-terminal-bash", timer:"cordis-plugin-timer",
  llm:"dsh-llm", session:"dsh-session", "session-title":"dsh-session-title", "system-prompt":"dsh-system-prompt",
  tools:"dsh-tools", "mcp-resources":"dsh-mcp-resources", agent:"dsh-agent", "llm-retry":"dsh-llm-retry",
  jobs:"dsh-jobs-local", "agent-loop":"dsh-agent-loop", "persistent-bash":"dsh-tool-bash-persistent",
  "persistent-pwsh":"dsh-tool-pwsh-persistent", sessions:"dsh-session-persistence-jsonl",
});
const installedExtras = Object.freeze({"tool-executor-native":"dsh-tool-executor-native", "session-checkpoint-policy":"dsh-session-checkpoint-policy"});

function checkDump(dump, profile = "installed") {
  if (typeof dump !== "string" || dump.length > 200_000) return { ok: false, code: "INVALID_DUMP" };
  if (profile !== "installed" && profile !== "bundled") return { ok: false, code: "UNKNOWN_PROFILE" };
  if (/^- id:(?! [a-z0-9-]+[ \t]*$)/m.test(dump)) return { ok: false, code: "INVALID_ROW" };
  const expected = profile === "installed" ? { ...knownPlugins, ...installedExtras } : knownPlugins;
  const rows = new Map();
  const body = dump.replace(/^# == @deepseek-ai\/dsh-sdk-minimal\r?\n/, "");
  for (const block of body.split(/(?=^- id: )/m)) {
    const match = block.match(/^- id: ([a-z0-9-]+)\s*$/m);
    if (!match) { if (block.trim()) return { ok: false, code: "INVALID_ROW" }; continue; }
    if (rows.has(match[1])) return { ok: false, code: "DUPLICATE_ID" };
    if (!Object.hasOwn(expected, match[1])) return { ok: false, code: "UNKNOWN_PLUGIN" };
    const names = [...block.matchAll(/^  name: ['"]?([^'"\r\n]+)['"]?\s*$/gm)].map(item => item[1]);
    if (names.length !== 1 || names[0] !== `@deepseek-ai/${expected[match[1]]}`) return { ok: false, code: "PLUGIN_IDENTITY_MISMATCH" };
    rows.set(match[1], block);
  }
  if (Object.keys(expected).some(id => !rows.has(id))) return { ok: false, code: "MISSING_PLUGIN" };
  for (const id of requiredDisabled) {
    const row = rows.get(id);
    if (!row || !/^  disabled: true\s*$/m.test(row) || /^  disabled: (?!true\s*$)/m.test(row)) return { ok: false, code: `NOT_DISABLED:${id}` };
  }
  const policy = rows.get("sandbox-policy");
  const modes = policy ? [...policy.matchAll(/^    mode: (.*)$/gm)].map((match) => match[1].trim()) : [];
  if (!policy || modes.length !== 1 || modes[0] !== "read-only" || /^  disabled: true\s*$/m.test(policy)) return { ok: false, code: "POLICY_NOT_READ_ONLY" };
  return { ok: true, code: "PASS_RESTRICTED_COMPOSITION_PREVIEW" };
}
module.exports = { checkDump, requiredDisabled, knownPlugins, installedExtras };
