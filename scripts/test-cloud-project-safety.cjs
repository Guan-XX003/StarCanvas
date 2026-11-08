const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/renderer/lib/cloud-project-safety.ts");
const js = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = new Module(filename, module);
moduleUnderTest.filename = filename;
moduleUnderTest.paths = module.paths;
moduleUnderTest._compile(js, filename);
const { prepareCloudProjectState } = moduleUnderTest.exports;
const rejects = (value, code) => assert.throws(() => prepareCloudProjectState(value), (error) => error.code === code);

test("known secrets are removed recursively without mutating the project", () => {
  const original = { nodes: [{ id: "node-a", data: { prompt: "描绘山川", audioApiKey: "sample-private",
    nested: { textApiKey: "another-private", apiConfigs: [{ key: "private" }], headers: { Authorization: "private" } },
    seed: 123, onGenerate() {} } }], edges: [{ source: "node-a", target: "node-b" }] };
  const { state, removedSecretFields } = prepareCloudProjectState(original);
  assert.equal(removedSecretFields, 4);
  assert.equal(state.nodes[0].data.prompt, "描绘山川");
  assert.equal(state.nodes[0].data.seed, 123);
  assert.equal(state.edges[0].target, "node-b");
  assert.equal(JSON.stringify(state).includes("private"), false);
  assert.equal(original.nodes[0].data.audioApiKey, "sample-private");
});

test("ambiguous sensitive fields block rather than silently delete content", () => {
  rejects({ nodes: [{ data: { key: "meaning-not-known" } }] }, "AMBIGUOUS_SENSITIVE_FIELD");
  rejects({ nodes: [{ data: { signature: "not-classified" } }] }, "AMBIGUOUS_SENSITIVE_FIELD");
});

test("secret-bearing text, URLs, and unprepared local media are rejected", () => {
  rejects({ prompt: "example sk-abcdefghijklmnopq" }, "POTENTIAL_SECRET_IN_CONTENT");
  rejects({ prompt: "Bearer abcdefghijklmnop" }, "POTENTIAL_SECRET_IN_CONTENT");
  rejects({ imageUrl: "https://example.com/a.png?X-Amz-Signature=private" }, "POTENTIAL_SECRET_IN_CONTENT");
  rejects({ imageUrl: "https://example.com/a.png?auth_key=private" }, "POTENTIAL_SECRET_IN_CONTENT");
  rejects({ imageUrl: "https://user:pass@example.com/a" }, "POTENTIAL_SECRET_IN_CONTENT");
  rejects({ imageUrl: "file:///tmp/private-image.png" }, "MEDIA_NOT_PREPARED");
  rejects({ imageUrl: "blob:https://example.com/local" }, "MEDIA_NOT_PREPARED");
  rejects({ imageUrl: "assets/example.png" }, "MEDIA_NOT_PREPARED");
  rejects({ videoUrl: "data:video/mp4;base64,AAAA" }, "MEDIA_NOT_PREPARED");
  rejects({ projectAssetBindings: { imageUrl: { localPath: "/tmp/image.png" } } }, "MEDIA_NOT_PREPARED");
  assert.equal(prepareCloudProjectState({ imageUrl: "https://example.com/a.png?v=2" }).state.imageUrl,
    "https://example.com/a.png?v=2");
});

test("unsafe and lossy object values fail closed without invoking getters", () => {
  let touched = false;
  const object = {};
  Object.defineProperty(object, "prompt", { enumerable: true, get() { touched = true; return "x"; } });
  rejects(object, "INVALID_PROJECT_VALUE");
  assert.equal(touched, false);
  const cycle = {}; cycle.self = cycle;
  rejects(cycle, "CYCLIC_PROJECT");
  rejects({ x: Infinity }, "INVALID_PROJECT_VALUE");
  rejects({ x: undefined }, "INVALID_PROJECT_VALUE");
  rejects({ x: new Date() }, "INVALID_PROJECT_VALUE");
  rejects({ x: [, "gap"] }, "INVALID_PROJECT_VALUE");
});
