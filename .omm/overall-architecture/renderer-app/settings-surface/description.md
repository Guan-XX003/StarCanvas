Model and API configuration, upload settings, data management, extension tools, generation preferences, themes, and application behavior.

Unified API inputs update their current row by stable id using immutable
functional state updates. The model-settings autosave owner participates in
normal desktop close, drains older local writes, commits the latest snapshot,
and verifies reliable keyed readback before acknowledging. Failure retains the
window through the existing close registry; no model network call is made.
