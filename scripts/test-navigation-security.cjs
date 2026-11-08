"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { classifyAppNavigation, createAppNavigationGuard } = require("../electron/main/net/security.cjs");
const base = "http://127.0.0.1:1234";

for (const suffix of ["/index.html", "/settings?tab=account#key", "/", "/../index.html"]) {
  test(`same-origin navigation allowed: ${suffix}`, () => assert.equal(classifyAppNavigation(base + suffix, base), "allow"));
}
for (const url of [
  "http://127.0.0.1:12345/index.html",
  "https://127.0.0.1:1234/index.html",
  "http://localhost:1234/index.html",
  "https://example.invalid/",
  "mailto:help@example.invalid",
]) {
  test(`different origin uses system browser: ${url}`, () => assert.equal(classifyAppNavigation(url, base), "external"));
}
for (const url of [
  base + "@example.invalid/",
  "http://user:secret@127.0.0.1:1234/",
  "https://user:secret@example.invalid/",
  "javascript:alert(1)",
  "data:text/html,blocked",
  "file:///tmp/blocked.html",
  "about:blank",
  "http://[invalid/",
  "not-a-url",
  "//example.invalid/",
  null,
  {},
]) {
  test(`unsafe navigation denied: ${typeof url === "string" ? url.split(":")[0] : typeof url}`, () => assert.equal(classifyAppNavigation(url, base), "deny"));
}
test("malformed or credential-bearing trusted base fails closed", () => {
  for (const badBase of ["bad", "file:///tmp/index.html", "http://user:secret@127.0.0.1:1234", null]) {
    assert.equal(classifyAppNavigation(base + "/index.html", badBase), "deny");
  }
});
test("URL origin normalization is supported without textual-prefix trust", () => {
  assert.equal(classifyAppNavigation("http://127.1:1234/index.html", base), "allow");
  assert.equal(classifyAppNavigation("http://[::1]:1234/index.html", "http://[0:0:0:0:0:0:0:1]:1234"), "allow");
  assert.equal(classifyAppNavigation("https://EXAMPLE.invalid:443/index.html", "https://example.invalid"), "allow");
});
test("guard leaves local navigation unmodified", () => {
  let prevented = 0;
  let opened = 0;
  createAppNavigationGuard(base, () => { opened++; })({ preventDefault() { prevented++; } }, base + "/index.html");
  assert.equal(prevented, 0);
  assert.equal(opened, 0);
});
test("guard cancels before opening a different origin", () => {
  const events = [];
  const target = "https://example.invalid/";
  createAppNavigationGuard(base, (url) => { events.push(["open", url]); })({ preventDefault() { events.push(["prevent"]); } }, target);
  assert.deepEqual(events, [["prevent"], ["open", target]]);
});
test("credential-prefix bypass is blocked without opening another application", () => {
  let prevented = 0;
  let opened = 0;
  createAppNavigationGuard(base, () => { opened++; })({ preventDefault() { prevented++; } }, base + "@example.invalid/");
  assert.equal(prevented, 1);
  assert.equal(opened, 0);
});
test("external shell sync/async failures cannot reenable navigation", async () => {
  for (const open of [() => { throw new Error("synthetic failure"); }, () => Promise.reject(new Error("synthetic failure"))]) {
    let prevented = 0;
    createAppNavigationGuard(base, open)({ preventDefault() { prevented++; } }, "https://example.invalid/");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prevented, 1);
  }
});
test("window binds both initial navigation and redirect to the same guard", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main/window.cjs"), "utf8");
  assert.match(source, /on\("will-navigate", guardAppNavigation\)/);
  assert.match(source, /on\("will-redirect", guardAppNavigation\)/);
  assert.doesNotMatch(source, /url\.startsWith\(baseUrl\)/);
});
