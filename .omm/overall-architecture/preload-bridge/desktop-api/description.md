Exposes a hardened wanjuanDesktop API for files, downloads, uploads, project assets, tools, updates, and workspace operations.

assistantWorkspaceProgress reads bounded volatile answer previews by exact
session/request ID and revision. It shares the trusted workspace IPC guard and
does not expose a global subscription, credentials or execution authority.
assistantWorkspaceSend accepts the corresponding request ID, but the final
encrypted turn remains the authoritative result.

assistantWorkspacePreviewAttachment accepts only the owner session and opaque
asset ID. Main verifies the current/history reference and encrypted bytes before
returning one bounded media payload. It is not a filesystem-path or URL reader,
and shares the ordinary trusted IPC guard and reduced error contract.

proxyFetchStream carries response headers/base64 chunks only to its explicit
request callback until that invoke ends. It retains proxy payload normalization,
main trusted-frame checks and the existing per-request abort entry. Normal
proxyFetch stays buffered. The renderer constructs its own bounded Response
using the shared stream adapter; no arbitrary IPC subscription is exposed.
