Packaged Node.js CLI and stdio MCP entry points that discover the running desktop app through a per-launch credential file, reject stale endpoints, and call only the loopback automation task API.

The MCP implementation version now comes from the same portable VERSION.txt as
the CLI. It explicitly negotiates only tested stdio 2025-06-18, requires the
initialized notification before tools, rejects malformed frames and mismatched
per-request version metadata without contacting App, and returns Method not found
for unimplemented modern discovery. This is separate from App automation protocol
2. It does not claim 2026 discovery support or widen any operation authority.

Internal assistant client, trusted IPC, actual main host/HTTP, CLI process and
stdio MCP process now have a joint controller-level parity fixture covering the
same confirmed text/image/video/reference graph batch, idempotent replay, undo,
metadata, content consent, stale/foreign scope and forged authority. The two
external clients intentionally share one external actor namespace, not separate
per-process logins. This is portable transport/controller evidence; native UI,
OS storage and provider fixtures are separate.

`bin/application-operation-protocol.mjs` is the dependency-free owner of public
permission/result-code constants. App shared policy/contract modules re-export
it, and the portable client imports the same registry. Unknown codes and raw
backend diagnostics remain redacted. App build.files includes this exact file
inside ASAR; both extraResources CLI copies and the standalone CLI archive also
include it. The portability tests load bin-only and isolated App module layouts
and exercise direct errors through real CLI/MCP children. No source-repository
fallback is needed. Existing command names/wanjuan aliases remain; writes now
return scoped approval receipts and task reads no longer implicitly export.

Source-macOS phase-two acceptance and the full requirement/command matrix are in
docs/ASSISTANT_STAGE_TWO_ACCEPTANCE.md. This is not packaged/Windows-native,
live-provider or release acceptance; connection alone is never write authority.

Phase-three `canvas.plan.generate` accepts only an applied plan ID and its
affected image/video node ID through this same contract/service. The renderer
keeps a private generation closure; main owns the usual one-shot approval. The
trusted internal read can expose only its own pending review; public operation
reads still omit it. CLI/MCP see the same operation and need App confirmation,
not model-supplied send/fee flags. Scope/configuration and exact canvas inputs
are rechecked before upload and the first submit. First execution reuses its
plan node; a retained result creates a normal-factory result branch.
