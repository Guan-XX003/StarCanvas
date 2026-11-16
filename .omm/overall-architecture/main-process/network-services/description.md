Owns the local static server, outbound proxy queue, request cancellation, security validation, local file filtering, and upload implementations.

Harness shutdown waits for actual process exit with a bounded shutdown/kill
deadline. Concurrent close requests share the same close operation. When exit
or cleanup cannot be confirmed, the runtime and its temporary home remain
quarantined; neither chat nor analysis can start another model runtime until an
explicit reset successfully rechecks cleanup. This does not prove that remote
work or separately spawned descendants have stopped.

The local account broker and Harness child are asked to close independently
with separate deadlines, so a hung broker cannot prevent attempting process
termination. Either unconfirmed outcome retains the same quarantine and home;
rechecking does not infer that the remote provider stopped its request.

The source assistant account broker binds only to loopback, authenticates a short-lived local key and forwards streaming model requests only to a fixed DeepSeek endpoint, obtaining the account grant in the main process. It is started when an account grant exists and no manually configured assistant API Key takes precedence. Electron computes the outbound request length; the broker validates the inbound length but does not set the outgoing Content-Length. Real account authorization succeeded, but a full live-model response is still unverified. Local synthetic tests do not establish an OS-level sandbox.

On macOS and Windows x64, after verifying the pinned or signed Harness binary and patch hash,
assistant startup also inspects the effective restricted composition against the
reviewed plugin identities, disabled entries and read-only policy. This check
runs in a clean temporary home before reading credentials or starting the agent,
and failure closes startup. It is not an OS sandbox or a complete proof of
plugin behavior. The Windows pinned runtime's effective composition and the
startup rejection and synthetic conversation paths have also been checked
over SSH on the test machine; this does not establish OS-level isolation.

The restricted composition disables the Harness JSONL session persistence
plugin. Ordinary multi-turn context remains in the running process, and a new
process starts a fresh session. Synthetic tests wait for the former asynchronous
flush interval and find neither a private prompt marker nor a synthetic key in
the test home; this does not prove the absence of every possible private file.
Existing temporary directories from older versions are not deleted or migrated.

The loopback automation server now applies shared application operation classes
before dispatch. Connection authentication defaults to metadata reads only;
legacy text-only image/video/Tianji generation and task cancellation now submit
one-shot approval jobs, never raw renderer generation calls. Raw media strings
now stage ordinary source-import approvals and a separate paid-generation
approval under one parent receipt; no file/network IO occurs before each normal
grant. The coordinator observes service events, never grants/executes authority.
Direct/staged requests share outer idempotency; main-only child namespaces,
original deadline/selection and lifecycle/cancellation fences prevent replay or
late advancement. Reviewed portrait-ID compatibility remains incomplete.
Media export needs distinct authority. Status/models/tasks are reduced
to bounded metadata, with no prompt, raw error, key or media/file URL. Structured
canvas requests now use application-operation-service/host, with volatile jobs,
idempotency, per-result receipts and main-owned one-shot nonce authority. HTTP
cannot approve; only trusted App IPC can. The renderer dispatcher reuses M2
capture/preview/apply/undo/preflight and graph/project fences. Source CLI/MCP
create-confirm/undo/reject/cancel has passed real Mac App tests. Internal canvas
plans now use this same service with session-scoped actors, original-click
selection versions and late-result observation. Remaining reviewed portrait-ID
compatibility and specialized wire/media acceptance are not M3 acceptance.
Observation timeout remains unconfirmed and does not replay writes.

Paid review resolves the actual configured model, parameters, protocol and
private environment. Separate cost consent precedes the normal node factory and
existing generation hooks; the grant does not mean provider completion. Missing
video protocol is rejected locally before node creation. Shared legacy profile
resolution lives in video-request-profile.ts, with unchanged provider exceptions.
Cancellation rechecks the current node task identity before the existing local
stop hook; its historical failed+stoppedByUser records normalize to cancelled
only at the external metadata boundary, not by rewriting stored records or
claiming remote stop/refund. New CLI/MCP require automation protocol v2 for all
operations except diagnostic status and never retry uncertain writes.

The phase-two assistant workspace has a separate bounded two-slot runtime pool
(`assistant-session-pool.cjs`) and maximum 16 waiting turns. Each job owns a
conversation ID; cancellation fences only its own startup/turn. An unconfirmed
exit quarantines its slot, rejects waiting/new workspace requests, and does not
cancel another already running workspace turn. Explicit session reset can
recheck that exit. The legacy first-phase chat/analysis slots remain separate
until renderer migration; the new pool is not a total two-process app limit.
Credential changes and shutdown close all these slots.

Workspace Harness turns use independent native session IDs and replay only the
selected encrypted conversation's completed user/assistant pairs, bounded to
200,000 transcript characters. Failed/cancelled/interrupted turns are excluded;
truncation is recorded rather than presented as complete memory. No native
plaintext session logging is enabled. Actual pinned-runtime tests with a local
synthetic provider cover two simultaneous children, cancellation isolation,
bounded idle eviction, replay, key-change disposal and home cleanup. This does
not prove live provider, renderer integration or Windows behavior.

Explicit assistant streaming retains the normal outbound proxy/security owner.
Frames go only to the originating trusted WebFrameMain and revalidate its
lifecycle on delivery; duplicate request IDs are refused and streaming aborts
are frame-bound. Responses are bounded to 8 MiB and chunks to 64 KiB. Managed
credential preparation and the existing single 401 refresh are preserved;
the rejected 401 headers/body are never published. A partial transport failure
does not fall back/replay on Node. Enterprise buffered responses retain their
ordinary bounded fallback rather than fabricating incremental output.

Cancellation/timeout settles the original request once and aborts ClientRequest.
The pinned official Harness inference broker now serves API-key and account
authentication alike. Only a random per-runtime loopback key enters the child;
the real credential stays main-owned and the production upstream remains fixed.
A bounded text-only SSE tap emits actual answer previews, not SDK timestamp
replay. Volatile turn progress is exact session/request scoped and revision
gated; it cannot complete a task, write history or authorize an action. Normal
Harness terminal validation and the encrypted repository remain authoritative.
Only the explicit isolated-candidate fence remaps that fixed upstream to an
owned localhost mock; no renderer-controlled upstream has been introduced.

Electron IncomingMessage does not have Node Readable.destroy(), so that method
is optional only. The AbortSignal listener now lives until response settlement,
not ClientRequest.close (which can precede response completion). Both defects
were independently reproduced with an Electron-shaped test; final source Mac
Stop closes the actual mock HTTP response and leaves zero proxy controllers.
