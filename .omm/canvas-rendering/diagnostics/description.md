Development-only metrics and automated fixtures that measure FPS, event-loop lag, heap, DOM, media mounts, broken images, and update frequency.

The existing debug-gated graph fixture now obtains its WebM and silent PCM WAV
from canvas-perf-media.mjs. These are bounded synthetic data URLs, not external
MDN requests. JPEG thumbnails, node counts, media budgets and interaction
thresholds are unchanged; the fixture no longer confounds blocked external
network/decode failures with large-canvas performance.
