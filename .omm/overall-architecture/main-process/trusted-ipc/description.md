Registers every wanjuan:* privileged operation and rejects callers whose frame URL is outside the trusted local renderer origin.

application-operation-ipc exposes only fixed list/approve/reject/dismiss/consume
calls behind this same sender guard. Scoped internal submit/read/approve/cancel
calls derive an internal session actor outside model request arguments; another
owner cannot read/approve that request. Mutation selection-version context is
private trusted IPC data and is checked again by the renderer at commit. The
external HTTP transport cannot approve or supply this internal context.
The main service binds a single consumed nonce to actor/operation/project/expiry;
the renderer checks that grant against its private reservation before invoking
the established canvas owner. Change notifications contain no request content,
nonce, result or receipt. This is source-Mac accepted for external canvas plans,
not yet complete authorization migration of old assistant actions/paid/media
paths. Internal canvas plans now use the same service, including scope sharing,
preview, confirmation, undo, local preflight and resource release.

Explicit media.export also uses this operation/nonce service for internal owner
IPC and external CLI/MCP, with distinct one-time App confirmation. The main
broker privately resolves only the approved completed task's output after
renderer target revalidation, then performs bounded scoped IO and verifies the
stored result before disclosing its local file path. No additional raw file or
network IPC, header/cookie authority, broad directory grant or default media
materialization is exposed. Input-media authorization remains incomplete.

media.import now uses the same actor/project/selection/nonce IPC and service,
with distinct media.input confirmation for exactly one source. CLI/MCP only
submit/read/cancel, never approve. The main input owner receives no caller roots
or headers, and returns temporary reference metadata rather than a raw file
reader or content. media.reference.release is same-owner revocation without IO
or deletion. Import authority expires/restarts; it is not generation authority.
Generation now uses those references through the private verified completion
path below. Specialized wire acceptance is still required.

Later scoped-generation integration uses a main-to-renderer private completion
callback after original nonce consumption and main byte verification. Its
one-shot key and file descriptors are never accepted in operation arguments or
returned to an Agent. No external complete/approve or arbitrary-file IPC was
added. Legacy raw-source generation now stages normal import children and a
separate paid child through application-operation-workflow.cjs. It holds no
grant and adds no privileged IPC. All stages retain original deadline/selection;
outer idempotency spans direct/staged requests, child identities are main-only
namespaces. Invalidation checks actual child state before classifying outcome
and fences advancement. App leaf cards show localized steps. Portrait IDs now
use the same paid nonce and trusted renderer's bounded post-consent provider
lookup, with no new public lookup/approval IPC. Caller status/binding metadata
is never accepted as proof. Specialized coverage remains open, not M3 acceptance.

The existing trusted assistant-workspace-send IPC now accepts an explicitly
selected canvas-planning context branch. A shared pure MJS allowlist validates
its bounded structural snapshot and credentials before the real Harness call;
ordinary assistant chat still accepts only coarse location hints. No execution
ticket, media URL, private config, model-granted tool authority or new public
HTTP route crosses this branch. The original user message, not the derived
planning scaffold, is the encrypted transcript user record.

The custom-node configuration vault exposes protect/restore calls to
the trusted renderer only. Protection returns a local reference; restoration
returns the original configuration to the renderer and failures return fixed
codes. Normal canvas save/load, unload preparation and selected backup import
use this service. Password-encrypted backups resolve references only in memory
before encryption. Plain project export rejects custom configs. Source macOS
native-service tests use an independent QA Keychain item and two Electron
lifetimes; they do not establish packaged or Windows native acceptance.

Assistant configuration analysis checks prompt length and common credential
patterns in the main process before any runtime or provider request starts.
The check is conservative and incomplete, not a comprehensive secret scanner.

The assistant chat-stop IPC uses the chat-only cancellation entry point. It
invalidates an active or queued chat without interrupting a separate in-flight
configuration analysis; the service-level all-runtime cancellation remains a
separate internal operation.

Blocked IPC events never pass the untrusted sender URL to logging. The disk
logger retains a channel only if it is one of the fixed assistant IPC names;
other channel values are omitted. The previous disk logger already reduced
sender URLs to a scheme, even when the caller passed the full string.

The source assistant UI invokes restricted account start, cancel, status and
local-disconnect IPC calls. PKCE callback validation, fixed-origin transport,
separate encrypted grant storage and a scoped account inference broker run in
the main process; no grant is returned over IPC. A saved manual API Key takes
priority and is never overwritten by account sign-in. The complete source flow
has only been exercised with synthetic authentication, encryption and upstream;
live DeepSeek authorization and OS-backed account-grant storage are unverified.
Authorization progress uses a separate non-queued status IPC, so a pending
credential write or model task cannot conceal the committing phase. Status
reads recheck the authorization's wall-clock deadline after sleep; an in-flight
credential commit remains non-cancellable and is never reported as expired.
