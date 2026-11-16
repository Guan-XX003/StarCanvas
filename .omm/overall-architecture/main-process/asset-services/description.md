Owns content storage, project asset persistence, manifests, diagnostics, relinking, transactional migration, and storage optimization.

application-media-broker finalizes explicit media.export operations around the
same operation service for internal and external actors. Its private renderer
source descriptor never becomes a public job result. Approval/one-shot nonce,
captured project/task/type and lifecycle/expiry are checked before main IO.
application-media-output snapshots only an approved completed result, streams
bounded public downloads with pinned DNS/no auth and validated redirects, and
reuses persistProjectAsset's content-addressed archive path. Local source roots
come from the existing main migration registry, not request-supplied roots.
It rehashes the actual published file before returning its local path, refusing
corrupt or symlinked existing blobs without overwriting them. Staging is private
and cleaned; uncertain publication stays on its original job without retry.
No account, server, generation or general filesystem tool is introduced.

application-media-input adds approval-only media.import around this same owner.
Its main-injected exact-file resolver is not reachable from ordinary exports or
caller arguments. Before App nonce consumption no file/network IO occurs.
Verified imported media remains in the existing CAS; only volatile actor/project
bound reference metadata returns to the caller. Private resolution rehashes
stored bytes, release revokes without deletion, and epoch/restart clears all
capabilities. Generation consumption/staged legacy reference compatibility is
still incomplete; this is an input foundation, not full M3 acceptance.

Scoped generation consumption is now connected for the configured sender paths:
the same broker reviews metadata, waits for consumed generation authority, then
rehashes each private file and completes through a main-owned volatile key.
Window invalidation, actor/project and import expiry still apply. Sources/keys
never become public operation results. This does not complete legacy raw-source
staging compatibility, all specialized wire review or real provider acceptance.
