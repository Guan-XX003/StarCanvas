#!/usr/bin/env node
// Test the existing canvas dock in an isolated Electron profile.
// Build the renderer first, or set WANJUAN_DEV_SERVER_URL to a local source build.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 1000 }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", reject);
  });
}

async function main() {
  const port = await unusedPort();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-dock-test-"));
  const child = spawn(require("electron"), [root, `--remote-debugging-port=${port}`], {
    cwd: root,
    stdio: "ignore",
    env: {
      ...process.env,
      WANJUAN_TEST_USER_DATA_PATH: userData,
      WANJUAN_ALLOW_RANDOM_PORT: "1",
      WANJUAN_DISABLE_UPDATE_CHECK: "1",
      WANJUAN_ACCOUNT_API_URL: "http://127.0.0.1:59999",
    },
  });
  let socket;
  try {
    let target;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !target) {
      if (child.exitCode !== null) throw new Error("Electron exited before dock test");
      try {
        const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
        target = pages.find((page) => page.type === "page" && /index\.html/.test(page.url || ""));
      } catch {}
      if (!target) await sleep(250);
    }
    assert.ok(target?.webSocketDebuggerUrl, "Electron renderer not available");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.error || response.result?.exceptionDetails) throw new Error("Renderer evaluation failed");
      return response.result?.result?.value;
    };
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      ready = await evaluate("!!document.querySelector('.wanjuan-canvas-bottom-dock')");
      if (!ready) await sleep(250);
    }
    assert.ok(ready, "Canvas dock did not render");

    const result = await evaluate(`(async () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 220));
      const dock = document.querySelector('.wanjuan-canvas-bottom-dock');
      const tools = dock.querySelector('button[title="打开工具"]');
      const resources = dock.querySelector('button[title="选择素材"]');
      if (!tools || !resources) return { error: 'buttons missing' };
      tools.focus(); tools.click(); await tick();
      const panel = document.querySelector('.wanjuan-canvas-dock-tools');
      if (!panel) return { error: 'tools panel missing' };
      const tabs = panel.querySelectorAll('.wanjuan-canvas-dock-tool-tab');
      const keyboardFocus = document.activeElement === tabs[0];
      const expanded = tools.getAttribute('aria-expanded') === 'true' && tools.getAttribute('aria-controls') === panel.id;
      tabs[1].click(); await tick();
      const radiusAtLeast = (element, minimum) => parseFloat(getComputedStyle(element).borderTopLeftRadius) >= minimum;
      const roundedDock = radiusAtLeast(dock, 16) && radiusAtLeast(tools, 10) && radiusAtLeast(panel, 16) && radiusAtLeast(tabs[1], 12);
      const selectedDockFill = getComputedStyle(tools).backgroundColor === getComputedStyle(tabs[1]).backgroundColor &&
        getComputedStyle(tools).backgroundColor !== 'rgba(0, 0, 0, 0)';
      const selected = tabs[1].getAttribute('aria-pressed') === 'true' &&
        tabs[0].getAttribute('aria-pressed') === 'false' && getComputedStyle(tabs[1]).backgroundColor !== 'rgba(0, 0, 0, 0)';
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,isComposing:true}));
      const imePreserved = !!document.querySelector('.wanjuan-canvas-dock-tools');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await tick();
      const escaped = !document.querySelector('.wanjuan-canvas-dock-tools') && document.activeElement === tools && tools.getAttribute('aria-expanded') === 'false';
      resources.focus(); resources.click(); await tick();
      const picker = document.querySelector('.wanjuan-canvas-dock-resources');
      const resourceFocus = picker && picker.contains(document.activeElement) && resources.getAttribute('aria-expanded') === 'true';
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await tick();
      const resourceEscape = !document.querySelector('.wanjuan-canvas-dock-resources') && document.activeElement === resources;
      resources.click(); await tick();
      document.querySelector('.wanjuan-canvas-dock-resources button').click(); await tick();
      const resourceClose = !document.querySelector('.wanjuan-canvas-dock-resources') && document.activeElement === resources;
      const item = dock.querySelector('button[draggable="true"]'), data = new DataTransfer();
      item.dispatchEvent(new DragEvent('dragstart', {bubbles:true,dataTransfer:data}));
      const dragPreserved = !!JSON.parse(data.getData('application/x-wanjuan-node')).type;
      return { keyboardFocus, expanded, selected, roundedDock, selectedDockFill, imePreserved, escaped, resourceFocus, resourceEscape, resourceClose, dragPreserved };
    })()`);
    for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, `${name} failed`);

    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const animation = await evaluate(`(async () => {
      const button = document.querySelector('.wanjuan-canvas-bottom-dock button[title="打开工具"]');
      button.click(); await new Promise((resolve) => setTimeout(resolve, 50));
      return getComputedStyle(document.querySelector('.wanjuan-canvas-dock-tools')).animationName;
    })()`);
    assert.equal(animation, "none", "Reduced motion must disable panel animation");
    console.log(JSON.stringify({ status: "PASS_CANVAS_DOCK_INTERACTIONS", ...result, reducedMotion: true }));
  } finally {
    socket?.close();
    child.kill();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
