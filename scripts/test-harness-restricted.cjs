const assert = require("node:assert/strict");
const { checkDump, requiredDisabled, knownPlugins, installedExtras } = require("./check-harness-restricted.cjs");

function fixture(plugins) {
  return Object.entries(plugins).map(([id, name]) => {
    const disabled = requiredDisabled.includes(id) ? "  disabled: true\n" : "";
    const policy = id === "sandbox-policy" ? "  config:\n    mode: read-only\n" : "";
    return `- id: ${id}\n  name: '@deepseek-ai/${name}'\n${disabled}${policy}`;
  }).join("");
}
const bundled = fixture(knownPlugins);
const installed = fixture({ ...knownPlugins, ...installedExtras });
assert.equal(checkDump(bundled, "bundled").ok, true);
assert.equal(checkDump(installed, "installed").ok, true);
for (const id of requiredDisabled) {
  const row = `- id: ${id}\n  name: '@deepseek-ai/${knownPlugins[id]}'\n  disabled: true`;
  assert.equal(checkDump(installed.replace(row, row.replace("true", "false"))).ok, false, id);
}
assert.equal(checkDump(installed.replace("read-only", "danger-full-access")).ok, false);
assert.equal(checkDump(installed.replace("    mode: read-only", "    mode: read-only\n    mode: danger-full-access")).ok, false);
assert.equal(checkDump(installed + fixture({ "sandbox-policy":knownPlugins["sandbox-policy"] })).ok, false);
assert.equal(checkDump(installed + "- id: mystery\n  name: '@unknown/command-tool'\n").code, "UNKNOWN_PLUGIN");
assert.equal(checkDump(installed + "- id: mystery\n  name: '@unknown/command-tool'\n  disabled: true\n").code, "UNKNOWN_PLUGIN", "unknown disabled plugins require review too");
assert.equal(checkDump(installed.replace("@deepseek-ai/dsh-tool-fs", "@attacker/execute")).code, "PLUGIN_IDENTITY_MISMATCH");
assert.equal(checkDump(installed.replace("name: '@deepseek-ai/dsh-tool-fs'", "name: '@deepseek-ai/dsh-tool-fs'\n  name: '@attacker/execute'")).code, "PLUGIN_IDENTITY_MISMATCH");
assert.equal(checkDump(installed.replace(fixture({filesystem:knownPlugins.filesystem}), "")).code, "MISSING_PLUGIN");
assert.equal(checkDump(installed + "- id: UPPERCASE\n  name: '@unknown/tool'\n").ok, false);
assert.equal(checkDump(installed, "bundled").ok, false, "installed extras are not silently accepted for bundled runtime");
assert.equal(checkDump(bundled, "installed").ok, false, "missing installed-runtime components require review");
assert.equal(checkDump(bundled, "other").ok, false);
assert.equal(checkDump("").ok, false);
assert.equal(checkDump(null).ok, false);
console.log("PASS_RESTRICTED_HARNESS_COMPOSITION_CHECKS");
