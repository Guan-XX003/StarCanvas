#!/usr/bin/env node
// Exercise card targets with synthetic agents only; no Electron profile or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadHook(name) {
  const file = path.join(root, "src/renderer/hooks", `${name}.ts`);
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const mockRequire = (id) => id === "../lib/backup" ? { cloneBackupValue: (value) => structuredClone(value) } : require(id);
  new Function("require", "module", "exports", js)(mockRequire, module, module.exports);
  return module.exports[name];
}

const useDuplicate = loadHook("use_duplicateSelectedAgent");
const useDelete = loadHook("use_deleteSelectedAgent");
const useClear = loadHook("use_clearSelectedAgentConversation");
const first = { id: "a", name: "First" };
const second = { id: "b", name: "Second" };
const state = { agents: [first, second], selected: "a", conversations: { a: [{ id: "one", content: "A" }], b: [{ id: "two", content: "B" }] }, toasts: [] };
const update = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
const common = {
  selectedAgent: first,
  setAgentItems: update("agents"),
  setSelectedAgentId: update("selected"),
  setAgentConversations: update("conversations"),
  showToast2: (message) => state.toasts.push(message),
};

useDuplicate(common).duplicateSelectedAgent(second);
const copy = state.agents.at(-1);
assert.equal(copy.name, "Second 副本");
assert.equal(state.selected, copy.id);
assert.equal(state.conversations[copy.id][0].content, "B");
assert.equal(state.conversations.a[0].content, "A");

let prompt = "";
global.confirm = (text) => { prompt = text; return false; };
const clear = useClear({ ...common, agentConversations: state.conversations }).clearSelectedAgentConversation;
clear(second);
assert.match(prompt, /Second/);
assert.equal(state.conversations.b.length, 1, "cancelling must preserve the target chat");
global.confirm = (text) => { prompt = text; return true; };
clear(second);
assert.equal(state.conversations.b.length, 0);
assert.equal(state.conversations.a.length, 1, "clearing B must not touch A");

state.selected = "a";
const remove = useDelete({ ...common, agentItems: state.agents }).deleteSelectedAgent;
global.confirm = (text) => { prompt = text; return false; };
remove(second);
assert.match(prompt, /Second/);
assert.ok(state.agents.some((agent) => agent.id === "b"));
global.confirm = () => true;
remove(second);
assert.ok(!state.agents.some((agent) => agent.id === "b"));
assert.equal(state.selected, "a", "deleting an unselected card must not change selection");
assert.ok(state.conversations.a);
assert.equal(state.conversations.b, undefined);
delete global.confirm;
console.log("PASS_AGENT_CARD_ACTION_TARGETS");
