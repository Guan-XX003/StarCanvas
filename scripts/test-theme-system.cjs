#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cssPath = path.join(root, "electron/main/ui-overrides.css");
const css = fs.readFileSync(cssPath, "utf8");
const themes = [
  "dark", "graphite", "light", "warm-light", "mist-blue",
  "chrome-blue", "chrome-rose", "chrome-sand", "chrome-teal", "sage-green",
];

function declarationsForTheme(theme) {
  const declarations = {};
  const selector = `html.theme-${theme}`;
  let offset = 0;
  while ((offset = css.indexOf(selector, offset)) !== -1) {
    const brace = css.indexOf("{", offset + selector.length);
    if (brace === -1) break;
    const selectorText = css.slice(css.lastIndexOf("}", offset) + 1, brace);
    if (!selectorText.includes(selector)) {
      offset += selector.length;
      continue;
    }
    const end = css.indexOf("}", brace + 1);
    if (end === -1) break;
    const body = css.slice(brace + 1, end);
    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) {
      declarations[match[1]] = match[2].toLowerCase();
    }
    offset = end + 1;
  }
  return declarations;
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const theme of themes) {
  const values = declarationsForTheme(theme);
  const surfaces = [
    "--wanjuan-theme-bg", "--wanjuan-theme-surface",
    "--wanjuan-theme-surface-2", "--wanjuan-theme-surface-3",
  ];
  for (const token of [...surfaces, "--wanjuan-theme-text", "--wanjuan-theme-muted", "--wanjuan-theme-accent", "--wanjuan-theme-accent-contrast", "--wanjuan-theme-action-contrast", "--wj-action-bg"]) {
    assert.match(values[token] || "", /^#[0-9a-f]{6}$/, `${theme} is missing ${token}`);
  }
  for (const surface of surfaces) {
    assert.ok(contrast(values["--wanjuan-theme-text"], values[surface]) >= 4.5, `${theme} text contrast fails on ${surface}`);
    assert.ok(contrast(values["--wanjuan-theme-muted"], values[surface]) >= 4.5, `${theme} muted contrast fails on ${surface}`);
  }
  assert.ok(contrast(values["--wanjuan-theme-accent"], values["--wanjuan-theme-accent-contrast"]) >= 4.5, `${theme} accent contrast fails`);
  assert.ok(contrast(values["--wj-action-bg"], values["--wanjuan-theme-action-contrast"]) >= 4.5, `${theme} action contrast fails`);
}

const semanticSurfaces = ["#22272f", "#3a4250", "#20252c", "#2b313a", "#343b46", "#111827", "#333b46"];
for (const relativePath of [
  "src/renderer/components/resource-picker.tsx",
  "src/renderer/components/prompt-node.tsx",
  "src/renderer/components/text-node.tsx",
  "src/renderer/components/video-node.tsx",
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8").toLowerCase();
  for (const literal of semanticSurfaces) {
    assert.ok(!source.includes(literal), `${relativePath} still contains legacy surface ${literal}`);
  }
}

const paletteSource = fs.readFileSync(path.join(root, "src/renderer/lib/agent-theme-palettes.ts"), "utf8");
assert.ok(paletteSource.includes("var(--wj-bg)"), "agent palette must use semantic app tokens");
assert.ok(!paletteSource.includes("pageBg: `#") && !paletteSource.includes("pageBg: '#"), "agent palette must not embed a theme background");
const themeControls = fs.readFileSync(path.join(root, "src/renderer/styles/theme-controls-final.css"), "utf8");
const stellarEditor = fs.readFileSync(path.join(root, "src/renderer/styles/stellar-editor.css"), "utf8");
const resourceTabs = fs.readFileSync(path.join(root, "src/renderer/lib/resource-tabs.tsx"), "utf8");
assert.match(themeControls, /--wj-action-text:\s*var\(--wanjuan-theme-action-contrast/);
assert.match(stellarEditor, /--wj-action-text:\s*#181513/);
assert.ok(contrast("#d95f34", "#181513") >= 4.5, "Stellar action contrast must meet WCAG AA");
assert.match(stellarEditor, /html\.theme-graphite\s*\{[\s\S]*?--wj-accent:\s*#d8dde3/);
assert.match(stellarEditor, /html\.theme-graphite\s*\{[\s\S]*?--wj-control-selected-bg:\s*#d8dde3/);
assert.ok(contrast("#d8dde3", "#151515") >= 4.5, "Graphite selected-state contrast must meet WCAG AA");
assert.match(themeControls, /\.wanjuan-resource-favorite-filter\s*\{[\s\S]*?border:\s*0\s*!important/);
assert.match(themeControls, /\.wanjuan-resource-favorite-filter\s*\{[\s\S]*?background:\s*transparent\s*!important/);
assert.match(
  resourceTabs,
  /className: `wanjuan-resource-favorite-filter w-8 h-8 inline-flex items-center justify-center transition-colors/,
  "favorite filter must render as a container-free icon",
);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-theme-test-"));
try {
  execFileSync("npx", ["tsc", "--skipLibCheck", "--module", "commonjs", "--target", "es2022", "--outDir", outDir, path.join(root, "src/renderer/lib/theme-transition.ts")], { cwd: root, stdio: "inherit" });
  const transition = require(path.join(outDir, "theme-transition.js"));
  const timelines = [];
  const timers = new Map();
  let timerId = 0;
  let capture = null;
  const classes = new Set();
  const gsap = {
    killTweensOf() {},
    set() {},
    timeline(options) {
      const timeline = { options, killed: false, kill() { this.killed = true; }, to() { return this; } };
      timelines.push(timeline);
      return timeline;
    },
  };
  global.window = {
    gsap,
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({ matches: false }),
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  global.document = {
    documentElement: { clientWidth: 1200, clientHeight: 800, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } },
    body: { appendChild: (element) => { capture = element; }, backgroundColor: "#111111" },
    getElementById: () => capture,
    createElement: () => ({
      id: "",
      style: { setProperty() {} },
      remove() { if (capture === this) capture = null; },
      querySelectorAll: () => [],
      querySelector: () => ({}),
      set innerHTML(value) { this._html = value; },
    }),
  };
  global.getComputedStyle = () => ({ getPropertyValue: () => "#111111", backgroundColor: "#111111" });

  assert.equal(transition.wanjuanRunThemeTransition("light", () => {}), true);
  const firstTimeline = timelines[0];
  const firstTimer = [...timers.values()][0];
  assert.equal(transition.wanjuanRunThemeTransition("dark", () => {}), true);
  assert.equal(firstTimeline.killed, true, "new transition must kill the previous timeline");
  firstTimeline.options.onComplete();
  firstTimer();
  assert.equal(window.__wanjuanThemeTransitionActive, true, "stale completion must not clear the active transition");
  assert.equal(classes.has("wanjuan-theme-transitioning"), true, "stale completion must not remove the transition class");
  timelines[1].options.onComplete();
  assert.equal(window.__wanjuanThemeTransitionActive, false, "current completion must clear the active transition");
  assert.equal(classes.has("wanjuan-theme-transitioning"), false, "current completion must remove the transition class");
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}

const shortcuts = fs.readFileSync(path.join(root, "src/renderer/hooks/useSafeEffect18.ts"), "utf8");
for (const key of ["z", "y", "c", "g", "l"]) {
  assert.ok(shortcuts.includes(`shortcutKey === \`${key}\``), `shortcut ${key} must use normalized key input`);
}

for (const relativePath of [
  "src/renderer/components/image-node.tsx",
  "src/renderer/components/prompt-node.tsx",
  "src/renderer/components/video-extract-node.tsx",
  "src/renderer/components/video-node.tsx",
  "src/renderer/components/render-mode.tsx",
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.ok(!source.includes("selected ? `#3b82f6`") && !source.includes("color: `#3b82f6`"), `${relativePath} must not hard-code blue selection`);
}

console.log(`Theme system checks passed for ${themes.length} themes.`);
