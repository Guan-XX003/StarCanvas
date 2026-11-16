Maps stable saved node type names to image, video, text, audio, music, generation, and utility components.

`use_createNodeAt` now exposes side-effect-free `prepareNodeAt` as well as the
unchanged normal creation path. Plan preflight prepares textNode, promptNode,
videoNode and existing-media imageNode references using this same runtime
factory. `canvas-plan-capabilities.ts` derives choices from configured lists and
the existing media protocol contract; image ratios/resolution defaults and
video size presets are shared with the rendered node controls. No node type or
persisted project format was replaced.
