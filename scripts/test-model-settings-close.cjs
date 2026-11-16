// Real hook and input handlers; only React scheduling and local storage are
// controlled. No Electron, credentials, model requests or user profile reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const oldTs = require.extensions['.ts'], oldTsx = require.extensions['.tsx'];
const compile = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: f,
}).outputText, f);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
let active;
const load = Module._load;
Module._load = function (name, parent, ...args) {
  if (parent?.filename.endsWith('use_saveApiModelCloudSettings.ts')) {
    if (name === 'react') return {
      useRef: value => { const i = active.index++; return active.hooks[i] ||= { current: value }; },
      useLayoutEffect: fn => { active.index++; active.layouts.push(fn); },
      useEffect: fn => { const i = active.index++; if (!active.hooks[i]) { active.hooks[i] = true; active.effects.push(fn); } },
    };
    if (name === '../lib/desktop-close') return { registerDesktopCloseParticipant: (name, fn) => {
      assert.equal(name, 'settings'); active.prepare = fn; const state = active; return () => { state.removed = true; };
    } };
    if (name === '../lib/jixin-catalog') return { WANJUAN_JIXIN_BUILTIN_TIANJI_SEEDANCE_MODELS: [], wanjuanMergeModelText: () => '' };
    if (name === '../lib/global-config') return { isCurrentSettingsSave: (a, b) => a === b };
  }
  if (parent?.filename.endsWith('settings-api-config-section.tsx')) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'lucide-react') return { Trash2: () => null };
  }
  return load.call(this, name, parent, ...args);
};
const { use_saveApiModelCloudSettings } = require('../src/renderer/hooks/use_saveApiModelCloudSettings.ts');
const { WanJuanSettingsApiConfigSection } = require('../src/renderer/components/settings-api-config-section.tsx');
Module._load = load;
require.extensions['.ts'] = oldTs;
require.extensions['.tsx'] = oldTsx;
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));
const until = async fn => { for (let n = 0; n < 30; n++) { if (fn()) return; await tick(); } assert.fail('local save did not reach expected state'); };
function fixture(t, overrides = {}) {
  const original = { setTimeout, clearTimeout, chrome: global.chrome, warn: console.warn };
  const timers = new Map(), writes = [], logs = [];
  let timerId = 0;
  global.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
  global.clearTimeout = id => timers.delete(id);
  console.warn = (...args) => logs.push(args);
  global.chrome = { storage: { local: {
    set: async patch => writes.push(structuredClone(patch)),
    getWithStatus: async () => ({ values: writes.at(-1) || {}, reliable: true }),
  } } };
  t.after(() => { global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout; console.warn = original.warn; if (original.chrome === undefined) delete global.chrome; else global.chrome = original.chrome; });
  const state = { hooks: [], index: 0, layouts: [], effects: [], prepare: null };
  let deps = {
    apiConfigs: [{ id: 'synthetic-manual', name: 'SYNTHETIC_NEW', url: 'https://example.invalid', key: 'SYNTHETIC_KEY' }],
    apiModelCloudSettingsSaveTimerRef: { current: 0 }, settingsHydratedRef: { current: true },
    videoModelRequestProfilesText: '{}', syncTianjiConfigFromJixinApi: async () => null,
    ...overrides,
  };
  const render = patch => {
    deps = { ...deps, ...patch }; state.index = 0; active = state;
    const result = use_saveApiModelCloudSettings(deps);
    for (const fn of state.layouts.splice(0)) fn();
    for (const fn of state.effects.splice(0)) state.cleanup = fn();
    return result;
  };
  const runTimer = () => { const id = deps.apiModelCloudSettingsSaveTimerRef.current; const fn = timers.get(id); assert(fn); timers.delete(id); fn(); };
  return { render, runTimer, timers, writes, logs, get deps() { return deps; }, prepare: () => state.prepare(), unmount: () => state.cleanup(), get removed() { return state.removed; } };
}
test('quick normal close drains the debounce and waits for the actual API commit', async t => {
  const f = fixture(t), commit = gate(); let writing = false;
  global.chrome.storage.local.set = async patch => { writing = true; await commit.promise; f.writes.push(structuredClone(patch)); };
  f.render().saveApiModelCloudSettings(); assert.equal(f.timers.size, 1);
  let settled = false; const p = f.prepare().then(v => { settled = true; return v; });
  await until(() => writing); assert.equal(f.timers.size, 0); assert(!settled);
  commit.resolve(); assert.equal((await p).ok, true);
  assert.equal(f.writes[0].apiConfigs[0].name, 'SYNTHETIC_NEW'); assert.equal(f.writes[0].apiConfigs[0].key, 'SYNTHETIC_KEY');
});
test('close invalidates and drains a slow older autosave before saving the latest state', async t => {
  const slow = gate(); let calls = 0;
  const f = fixture(t, { syncTianjiConfigFromJixinApi: async () => { if (++calls === 1) await slow.promise; return null; } });
  f.render().saveApiModelCloudSettings(); f.runTimer();
  f.render({ apiConfigs: [{ id: 'synthetic-manual', name: 'SYNTHETIC_LATEST', key: 'SYNTHETIC_LATEST_KEY' }] }).saveApiModelCloudSettings();
  const p = f.prepare(); await tick(); assert.equal(f.writes.length, 0);
  slow.resolve(); assert.equal((await p).ok, true);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].apiConfigs[0].name, 'SYNTHETIC_LATEST');
});
test('an already-committing older write completes before the close snapshot, never afterwards', async t => {
  const f = fixture(t), first = gate(); let calls = 0;
  global.chrome.storage.local.set = async patch => { if (++calls === 1) await first.promise; f.writes.push(structuredClone(patch)); };
  f.render().saveApiModelCloudSettings(); f.runTimer(); await until(() => calls === 1);
  f.render({ textModels: 'SYNTHETIC_LATEST_MODEL' }).saveApiModelCloudSettings(); const p = f.prepare(); await tick();
  assert.equal(calls, 1); first.resolve(); assert.equal((await p).ok, true);
  assert.equal(f.writes.length, 2); assert.equal(f.writes.at(-1).textModel, 'SYNTHETIC_LATEST_MODEL');
});
test('failed storage retains the window receipt and permits a later retry without leaking values', async t => {
  const f = fixture(t); f.render().saveApiModelCloudSettings();
  global.chrome.storage.local.set = async () => { throw Error('PRIVATE_KEY_AND_PATH'); };
  assert.equal((await f.prepare()).ok, false); assert.equal(f.writes.length, 0);
  assert(!JSON.stringify(f.logs).includes('PRIVATE_KEY'));
  global.chrome.storage.local.set = async patch => f.writes.push(patch);
  f.render().saveApiModelCloudSettings(); assert.equal(f.timers.size, 1);
  assert.equal((await f.prepare()).ok, true);
});
test('unreadable settings are not replaced by defaults on close', async t => {
  const f = fixture(t, { settingsHydratedRef: { current: false } });
  f.render().saveApiModelCloudSettings(); assert.equal(f.timers.size, 0);
  assert.equal((await f.prepare()).ok, true); assert.equal(f.writes.length, 0);
});
test('explicit preset cancellation prevents an older asynchronous save committing', async t => {
  const f = fixture(t), slow = gate(); f.render({ syncTianjiConfigFromJixinApi: () => slow.promise }).saveApiModelCloudSettings();
  f.runTimer(); f.deps.apiModelCloudSettingsSaveTimerRef.current = 0; slow.resolve(null); await tick(); await tick();
  assert.equal(f.writes.length, 0);
});
test('the normal autosave snapshots mutable data before asynchronous projection', async t => {
  const f = fixture(t), slow = gate(); f.render({ syncTianjiConfigFromJixinApi: () => slow.promise }).saveApiModelCloudSettings();
  f.runTimer(); f.deps.apiConfigs[0].name = 'SYNTHETIC_MUTATION'; slow.resolve(null);
  await until(() => f.writes.length === 1); assert.equal(f.writes[0].apiConfigs[0].name, 'SYNTHETIC_NEW');
});
test('a settings change during close cannot be acknowledged as the latest state', async t => {
  const f = fixture(t), commit = gate(); let writing = false;
  global.chrome.storage.local.set = async () => { writing = true; await commit.promise; };
  f.render(); const p = f.prepare(); await until(() => writing);
  f.render({ textModels: 'SYNTHETIC_CHANGED_DURING_CLOSE' }).saveApiModelCloudSettings(); assert.equal(f.timers.size, 0);
  commit.resolve(); assert.equal((await p).ok, false);
});
test('a swallowed storage failure or unreliable fallback cannot acknowledge a close', async t => {
  const f = fixture(t); f.render(); global.chrome.storage.local.set = async () => {};
  assert.equal((await f.prepare()).ok, false);
  global.chrome.storage.local.set = async patch => f.writes.push(patch);
  global.chrome.storage.local.getWithStatus = async () => ({ values: f.writes.at(-1), reliable: false });
  assert.equal((await f.prepare()).ok, false);
});
test('unmount removes only this settings participant', t => {
  const f = fixture(t); f.render(); assert.equal(typeof active.prepare, 'function'); f.unmount(); assert.equal(f.removed, true);
});
test('API input handlers update current state immutably, preserving concurrent rows', () => {
  const original = Object.freeze({ id: 'api-1', name: 'original', url: '', key: '', protocolFormat: 'auto' });
  let current = [original];
  const tree = WanJuanSettingsApiConfigSection({ apiConfigs: current, resetJixinDefaultConfiguration() {}, setApiConfigs: update => { current = typeof update === 'function' ? update(current) : update; } });
  const all = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; all.push(node); walk(node.props.children); }; walk(tree);
  current = [...current, { id: 'concurrent', name: 'keep' }];
  for (const [placeholder, value] of [['配置名称 (例: API Studio)', 'new-name'], ['Base URL', 'https://example.invalid'], ['密钥 (sk-...)', 'SYNTHETIC_KEY']]) all.find(n => n.props.placeholder === placeholder).props.onChange({ target: { value } });
  all.find(n => n.type === 'select').props.onChange({ target: { value: 'openai-video' } });
  assert.equal(current.length, 2); assert.equal(current[0].name, 'new-name'); assert.equal(current[0].protocolFormat, 'openai-video'); assert.equal(original.name, 'original'); assert.equal(original.key, '');
  all.find(n => n.props.title === '删除配置').props.onClick(); assert.deepEqual(current.map(n => n.id), ['concurrent']);
  all.find(n => n.props.children === '+ 添加统一配置').props.onClick(); assert.equal(current[0].id, 'concurrent'); assert.equal(current.length, 2);
});
