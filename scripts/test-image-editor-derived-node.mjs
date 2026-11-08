// Regression: saving an image edit must create a separate canvas node and
// must not mutate the source image or its existing downstream context.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Module, { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "starcanvas-image-editor-"));

try {
  execFileSync("npx", [
    "tsc",
    "--skipLibCheck",
    "--module", "commonjs",
    "--target", "es2022",
    "--moduleResolution", "node",
    "--esModuleInterop",
    "--outDir", outDir,
    join(root, "src/renderer/lib/resource.ts"),
    join(root, "src/renderer/lib/project-asset-binding.ts"),
    join(root, "src/renderer/lib/tianji-portrait.ts"),
    join(root, "src/renderer/lib/image-editor.ts"),
  ], { cwd: root, stdio: "inherit" });

  const imageEditor = await import(
    pathToFileURL(join(outDir, "image-editor.js")).href
  );
  const { wanjuanAppendEditedImageToCanvasNodes } = imageEditor;
  const source = {
    id: "source-image",
    type: "imageNode",
    position: { x: 100, y: 200 },
    style: { width: 224, height: 224 },
    data: {
      imageUrl: "https://cdn.example.com/original.png",
      sourceOrigin: "tianji-portrait",
      tianjiPortraitAssetId: "reviewed-source",
      tianjiPortraitBindingStatus: "ready",
      prompt: "source-only prompt must not leak into the derived image node",
      selectedModel: "source-only-model",
      onEdit() {},
    },
  };
  const existingTarget = {
    id: "target",
    data: {
      selectedContextResources: [{
        sourceNodeId: "source-image",
        url: "https://cdn.example.com/original.png",
      }],
    },
  };
  const persisted = {
    ok: true,
    assetId: "edited-asset",
    localPath: "/Users/test/project/edited.png",
    thumbnailLocalPath: "/Users/test/project/edited-thumb.png",
    projectId: "project-a",
    nodeId: "source-image-image-edit-1",
    field: "imageUrl",
    kind: "image",
  };

  const first = wanjuanAppendEditedImageToCanvasNodes(
    [source, existingTarget],
    source.id,
    {
      dataUrl: "data:image/png;base64,edited",
      persisted,
      editedAt: 1723593600000,
      editedNodeId: "source-image-image-edit-1",
    },
  );
  assert.equal(first.length, 3);
  assert.strictEqual(first[0], source, "source image node must remain untouched");
  assert.strictEqual(first[1], existingTarget, "existing context must remain untouched");
  assert.deepEqual(first[2].position, { x: 356, y: 200 });
  assert.equal(first[2].data.sourceOrigin, "image-editor");
  assert.equal(first[2].data.imageEditorSourceNodeId, source.id);
  assert.equal(first[2].data.imageEditorEditIndex, 1);
  assert.equal(first[2].data.tianjiPortraitAssetId, undefined);
  assert.equal(first[2].data.selectedContextResources, undefined);
  assert.equal(first[2].data.prompt, undefined, "generation prompt must not leak into a derived image node");
  assert.equal(first[2].data.selectedModel, undefined, "source model settings must not leak into a derived image node");
  assert.strictEqual(first[2].data.onEdit, source.data.onEdit, "image editing remains available immediately");
  assert.equal(
    first[2].data.imageUrl,
    "file:///Users/test/project/edited.png?wanjuan-edit=1723593600000",
  );

  const second = wanjuanAppendEditedImageToCanvasNodes(first, source.id, {
    dataUrl: "data:image/png;base64,edited-again",
    editedNodeId: "source-image-image-edit-2",
    editedAt: 1723593600001,
  });
  assert.equal(second.length, 4);
  assert.deepEqual(second[3].position, { x: 356, y: 456 });
  assert.equal(second[3].data.imageEditorEditIndex, 2);
  assert.strictEqual(
    wanjuanAppendEditedImageToCanvasNodes(second, source.id, {
      dataUrl: "data:image/png;base64,duplicate",
      editedNodeId: "source-image-image-edit-2",
    }),
    second,
    "duplicate edited node ids must fail closed",
  );

  const groupedSource = {
    ...source,
    id: "grouped-source-image",
    parentId: "group-a",
    extent: "parent",
    position: { x: 20, y: 30 },
  };
  const group = {
    id: "group-a",
    type: "groupNode",
    position: { x: 480, y: 570 },
    data: {},
  };
  const fromGroup = wanjuanAppendEditedImageToCanvasNodes([group, groupedSource], groupedSource.id, {
    dataUrl: "data:image/png;base64,grouped-edit",
    editedNodeId: "grouped-source-image-image-edit-1",
    editedAt: 1723593600002,
  });
  assert.equal(fromGroup.length, 3);
  assert.deepEqual(fromGroup[2].position, { x: 756, y: 600 });
  assert.equal(Object.hasOwn(fromGroup[2], "parentId"), false, "edited image must be placed on the root canvas");
  assert.equal(Object.hasOwn(fromGroup[2], "extent"), false, "edited image must not inherit group bounds");

  const afterDeletingFirstEdit = wanjuanAppendEditedImageToCanvasNodes(
    second.filter((node) => node.id !== "source-image-image-edit-1"),
    source.id,
    {
      dataUrl: "data:image/png;base64,third-edit",
      editedNodeId: "source-image-image-edit-3",
      editedAt: 1723593600003,
    },
  );
  assert.equal(afterDeletingFirstEdit.at(-1).data.imageEditorEditIndex, 3);
  assert.deepEqual(afterDeletingFirstEdit.at(-1).position, { x: 356, y: 712 }, "deleted edits must not cause a new node to overlap an existing edit");

  // Exercise the actual modal-save callback, including asynchronous persistence.
  // Only React's hook state and the desktop boundary are mocked; node creation
  // and project asset binding use the production implementation above.
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const { readFileSync } = require("node:fs");
  const hookPath = join(root, "src/renderer/hooks/useMediaEditors.ts");
  const state = [];
  let cursor = 0;
  const refs = [];
  let refCursor = 0;
  const hookModule = new Module(hookPath);
  hookModule.require = (name) => {
    if (name === "react") return {
      useCallback: (fn) => fn,
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (value) => { state[index] = value; }];
      },
      useRef(initial) {
        const index = refCursor++;
        return refs[index] ||= { current: initial };
      },
    };
    if (name === "../lib/image-editor") return imageEditor;
    throw new Error(`Unexpected hook dependency: ${name}`);
  };
  hookModule._compile(ts.transpileModule(readFileSync(hookPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, hookPath);
  let canvasNodes = [source, existingTarget];
  const notices = [];
  const persistedRequests = [];
  const renderHook = () => {
    cursor = 0;
    refCursor = 0;
    return hookModule.exports.useMediaEditors({
      setNodes: (updater) => { canvasNodes = updater(canvasNodes); },
      projectIdRef: { current: "isolated-project" },
      showToast: (message) => notices.push(message),
    });
  };
  const originalWindow = globalThis.window;
  try {
    let finishPersist;
    globalThis.window = { wanjuanDesktop: {
      persistProjectAsset: (request) => {
        persistedRequests.push(request);
        return new Promise((resolve) => { finishPersist = resolve; });
      },
    } };
    const originalImage = "data:image/png;base64,b3JpZ2luYWw=";
    await renderHook().openImageEditor(source.id, originalImage, "crop");
    const saving = renderHook().handleCropComplete("data:image/png;base64,ZWRpdGVk");
    assert.equal(canvasNodes.length, 2, "wait for the new image to be persisted before changing the canvas");
    assert.equal(persistedRequests[0].projectId, "isolated-project");
    assert.notEqual(persistedRequests[0].nodeId, source.id, "persist under the new node, not the original");
    finishPersist({ ...persisted, nodeId: persistedRequests[0].nodeId });
    await saving;
    assert.equal(canvasNodes.length, 3);
    assert.strictEqual(canvasNodes[0], source);
    assert.strictEqual(canvasNodes[1], existingTarget);
    assert.equal(canvasNodes[2].id, persistedRequests[0].nodeId);
    assert.equal(renderHook().imageEditState, null, "close the editor only after a successful save");
    assert.ok(notices.at(-1).includes("新节点"));

    window.wanjuanDesktop.persistProjectAsset = async () => ({ ok: false, error: "Synthetic storage failure" });
    await renderHook().openImageEditor(source.id, originalImage);
    const beforeFailure = canvasNodes;
    await assert.rejects(renderHook().handleCropComplete("data:image/png;base64,ZWRpdGVk"), /Synthetic storage failure/);
    assert.strictEqual(canvasNodes, beforeFailure, "failed saves must not replace or add any node");
    assert.ok(renderHook().imageEditState, "keep the editor open for retry after a failed save");

    // Browser development mode has no desktop persistence bridge.
    window.wanjuanDesktop = {};
    await renderHook().handleCropComplete("data:image/png;base64,ZWRpdGVk");
    assert.equal(canvasNodes.length, 4);
    assert.strictEqual(canvasNodes[0], source);
    assert.notEqual(canvasNodes[3].id, canvasNodes[2].id);
    assert.equal(canvasNodes[3].data.imageEditorEditIndex, 2);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }

  console.log("image editor derived-node and actual save callback regression: passed");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
