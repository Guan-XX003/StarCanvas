Provider-specific polling and manual refresh logic with transient network retry, progress throttling, cancellation, and terminal-state detection.

The general JSON/multipart, Tongyi and Seedance video generation loops treat
explicit failed/cancelled statuses as terminal before trusting returned URLs;
cancellation is recorded as `cancelled` rather than provider failure. Manual
generic/Seedance refresh follows the same precedence and avoids fetching or
attaching stale media on terminal failure. Tianji manual refresh recognizes
explicit cancellation and requires a successful status before attaching its
video URL. Tianji automatic polling recognizes explicit cancellation separately,
finishes the handled terminal branch without duplicating a local task, and
checks task and node identity before updating; the legacy status helper retains
its existing normalized return values. Node and task updates are guarded but
are not a cross-store transaction. Ambiguous or contradictory status fields in
other shapes need further validation.

Credentialed manual refresh of async images and generic/Seedance videos checks
the target against the selected original API origin and rejects redirects. A
mismatched saved poll, image-detail or content URL produces a fixed notice and
leaves generation state unchanged. This may block providers with legitimate
cross-origin or redirect-based endpoints; no cross-origin trust is inferred from
saved task data. It does not cover every generation or provider request path.
