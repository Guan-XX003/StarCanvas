const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "starcanvas-storage-barrier-electron-"));
app.setPath("userData", path.join(temp, "user-data"));
execFileSync("npx", ["tsc", "--skipLibCheck", "--module", "es2022", "--target", "es2022", "--moduleResolution", "bundler", "--outDir", temp, path.join(root, "src/renderer/lib/storage-write-barrier.ts")], { cwd: root, stdio: "inherit" });

const preloadPath = path.join(temp, "preload.cjs");
const htmlPath = path.join(temp, "index.html");
fs.writeFileSync(preloadPath, `
const { contextBridge } = require("electron");
const runtime = Object.freeze({ id: "desktop-test", lastError: null });
const values = {};
const local = Object.freeze({
  get(keys, callback) { callback({ ...values }); },
  set(items, callback) { Object.assign(values, items || {}); queueMicrotask(() => callback?.()); },
  remove(keys, callback) { for (const key of [].concat(keys || [])) delete values[key]; queueMicrotask(() => callback?.()); },
  clear(callback) { for (const key of Object.keys(values)) delete values[key]; queueMicrotask(() => callback?.()); },
});
contextBridge.exposeInMainWorld("wanjuanChrome", Object.freeze({ runtime, storage: Object.freeze({ local }) }));
`);
const moduleUrl = pathToFileURL(path.join(temp, "storage-write-barrier.js")).href;
fs.writeFileSync(htmlPath, `<!doctype html><script type="module">
import { installStorageWriteBarrier } from ${JSON.stringify(moduleUrl)};
const chromeDescriptorBefore = Object.getOwnPropertyDescriptor(window, "chrome");
const chromiumChromeBefore = window.chrome;
if (window.wanjuanChrome) {
  const existingChrome = window.chrome && typeof window.chrome === "object" ? window.chrome : {};
  Object.assign(existingChrome, window.wanjuanChrome);
  window.chrome = existingChrome;
}
const frozenShimRuntime = window.wanjuanChrome.runtime;
const values = new Map();
const localforage = {
  async keys() { return [...values.keys()]; },
  async getItem(key) { return values.get(key); },
  async setItem(key, value) { values.set(key, value); },
  async removeItem(key) { values.delete(key); },
  async clear() { values.clear(); },
};
const controller = installStorageWriteBarrier({
  localforage,
  chromeStorage: window.chrome.storage.local,
  chromeRuntime: window.chrome.runtime,
  chromeObject: window.chrome,
  installChromeFacade: true,
});
await controller.exclusive(async () => ({ ok: true }), () => false, false, true);
const callbackError = await new Promise((resolve) => {
  window.chrome.storage.local.set({ stale: true }, () => resolve(window.chrome.runtime.lastError?.message || ""));
});
let promiseError = "";
try { await window.chrome.storage.local.set({ stalePromise: true }); } catch (error) { promiseError = error?.message || String(error); }
window.testResult = {
  callbackError,
  promiseError,
  originalLastError: frozenShimRuntime.lastError,
  runtimeCleared: window.chrome.runtime.lastError === null,
  facadeInstalled: controller.getState().chromeInterception,
  chromeWasNativeObject: Boolean(chromiumChromeBefore),
  chromeDescriptorBefore: {
    configurable: chromeDescriptorBefore?.configurable,
    writable: chromeDescriptorBefore?.writable,
    hasSetter: typeof chromeDescriptorBefore?.set === "function",
  },
};
</script>`);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.webContents.on("console-message", (event, ...args) => console.error("renderer:", event?.message || args.map((item) => item?.message || item).join(" ")));
  win.webContents.on("did-fail-load", (_event, code, description) => console.error("renderer load failed:", code, description));
  await win.loadFile(htmlPath);
  const deadline = Date.now() + 5000;
  let result;
  while (Date.now() < deadline) {
    result = await win.webContents.executeJavaScript("window.testResult || null");
    if (result) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(result, "renderer barrier test timed out");
  assert.equal(result.facadeInstalled, true);
  assert.equal(result.chromeWasNativeObject, true, "test must start from Chromium's real window.chrome object");
  assert.equal(result.callbackError, "STORAGE_WRITE_SUPERSEDED_BY_RESTORE");
  assert.equal(result.promiseError, "STORAGE_WRITE_SUPERSEDED_BY_RESTORE");
  assert.equal(result.originalLastError, null, "frozen Electron shim runtime must remain untouched");
  assert.equal(result.runtimeCleared, true, "facade lastError must only exist during callback");
  console.log("storage write barrier Electron callback integration passed");
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
}).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
