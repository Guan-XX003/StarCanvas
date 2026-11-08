The storage architecture combines renderer preferences, desktop storage mirrors, IndexedDB canvas state, safety snapshots, content-addressed media, project asset bindings, migration transactions, cleanup trash, and portable backup modules.

The renderer write barrier serializes startup journal inspection and backup restore with autosaves. Startup with no recovery journal releases deferred saves in original order without advancing the storage generation; a real recovery or committed import invalidates deferred pre-recovery writes. A committed import continues holding ordinary writes until reload, and failed rollback remains fail-closed.

Account credential storage reports unchecked, pending, system or unavailable
without probing native storage on status reads. Availability checks share one
pending promise; encrypt/decrypt have a separate single in-flight slot that is
released only when the underlying native promise settles, not at the caller's
8-second deadline. Overlapping/reentered operations fail with a neutral busy
code rather than invoking native storage again, queuing, or reusing another
credential's result. Timeout/failure does not overwrite an existing session or
switch new credentials to local encryption. Legacy local ciphertext remains
read-only compatible. These constraints do not prove OS storage acceptance.
