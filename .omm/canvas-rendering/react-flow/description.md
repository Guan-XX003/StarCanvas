The interactive graph viewport responsible for pan, zoom, selection, connection rendering, node positioning, and visible-element mounting.

Automatic project-load fit is owned by the visibility-aware `useLateEffect1076`
and `canvas-load-fit` scheduler, not duplicate ReactFlow auto-fit. It waits for a
positive finite wrapper rectangle, cancels on hide/unmount, and uses a single
immediate fit once loaded/visible. ResizeObserver resumes a deferred zero-size
case without polling. Ordinary tab return preserves the user's manual viewport;
explicit plan focus/layout retains its own animations. The previous delayed
fit could interpolate with a hidden 0x0 canvas and produce NaN SVG geometry;
the exact source-window timing now passes with actual media and zero NaN writes.

Editable canvas nodes mount only after reactive modelConfigurationReady from
the real settings owner. Project-read readiness is a separate signal and cannot
instantiate nodes against default model lists while settings hydrate. Failed
settings loads keep the graph unmounted with a localized explanation; other
views stay available. The explicit-configuration-switch selection policy is
unchanged. Source-native restart now preserves the selected custom video model,
duration, quality, exact dimensions and ratio without model requests.
