Compacts duplicate task records, indexes active and historical tasks, refreshes remote status, applies retry rules, and selects the newest valid output.

The assistant/CLI/MCP metadata read path is separate from provider refresh:
one application-task-records snapshot and application-task-data interpretation
serve all entry points. Node aliases select a record only with a unique,
comparable creation order, not an arbitrary numeric sort of mixed timestamp
units. Contradictory completion/stop evidence stays unknown. A new transient
submission is not discarded merely because older same-node history exists.
Reads and explicit coarse diagnostics perform no refresh/retry or media IO.
