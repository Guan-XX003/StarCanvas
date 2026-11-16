A preload storage abstraction backed by IndexedDB with localStorage recovery and a Chrome-storage-compatible interface.

The desktop shim additionally offers a per-read `getWithStatus` result for
consumers that must distinguish a completed IndexedDB keyed read from the
legacy fallback. A caught migration failure, inaccessible/malformed legacy
mirror, or keyed-read fallback is marked
unreliable; regular `get` retains its previous values and fallback behavior.
Invalid non-object legacy mirrors are retained and never migrated as keys.
Keyed reads resolve only after the IndexedDB transaction completes, so a
successful individual request followed by a transaction abort is a failure.
The startup user-list read also uses this reliability signal. An error,
unreliable fallback or malformed list is not treated as a missing account
list and does not write default users; other startup reads continue separately.
Storage fallback warnings use fixed labels rather than exception objects.
All-key reads and write, remove and clear transactions also settle as failures
on IndexedDB abort, including aborts without a transaction error; the existing
callers retain their fallback behavior rather than waiting indefinitely.
The all-keys legacy reader remains conservatively marked unreliable. This is
not a general guarantee about disk durability or storage integrity, and a
failed migration remains uncertain for that preload session.

Desktop set operations from this preload are serialized. A new localStorage
fallback invalidates the cached migration result, so the pending mirror must
be recovered before a later IndexedDB write; if recovery fails, the newer write
remains in the mirror instead of leaving an older value to replay on restart.
A migration removes the mirror only when its original snapshot is unchanged,
and an unreadable or malformed mirror is retained instead of being replaced.
This is a per-preload ordering guarantee, not a cross-window transaction or a
new guarantee for the separate legacy remove/clear fallback paths.

Account session secrets are owned by the Electron main process. Packaged macOS
uses a separately signed, byte-pinned native helper and a Keychain-held AES-GCM
key; helper input/output is limited to private process pipes. A missing key or
unreadable prior Electron-Keychain ciphertext requires re-login, never a new
plaintext fallback. Existing local project storage and non-macOS secret storage
are unchanged. Native packaged-login acceptance is still required before release.

An explicitly enabled unpackaged macOS QA session may use the same pinned
helper only with a real temporary userData directory and a synthetic Keychain
service; it does not use the production Keychain service. Normal development
and packaged production retain their existing paths.

The assistant has a separate main-process credential vault using the same
account OS-backed encryption. Its file contains only ciphertext and a format
version; replacement uses an atomic rename. The renderer may submit a key but
cannot retrieve it. The main-process Harness service passes the decrypted key
to the verified child process environment; same-user process inspection and
native storage acceptance remain security/release considerations. Synthetic
vault tests do not establish real Keychain/DPAPI or release readiness.

The renderer strips the globally injected top-level `audioApiKey` from new
canvas saves and unload mirrors. Export sanitization also removes known
top-level runtime fields, including upload credentials, without changing the
live node. Audio node synchronization reinjects the active global audio key in
memory. Historical backups are not scrubbed and may still contain credentials.

A custom-node config vault and service encrypt a JSON snapshot to
an immutable locally referenced record using the existing async system
encryption adapter. The trusted renderer has narrow protect/restore IPC calls;
restoring returns the configuration to that renderer. Normal canvas saves
prepare references before media preparation and project-store writes; loads
restore values only in memory. A missing record leaves the load/save gate
closed instead of overwriting the project with empty config. Live manual values
are unchanged. This covers these wired paths, not every template, migration,
task-result writer or historical record. Encrypted backup resolves references
as described below.
Synthetic tests do not establish native Keychain/DPAPI support, unload safety
or portability.

The in-memory config cache returns an immutable protected snapshot to
each asynchronous preparation caller, even when a later preparation evicts its
entries from the synchronous-close cache. Explicit clearing fences pending
preparations; it never revives evicted entries or substitutes a previous config.
Synthetic concurrency and encrypted-file round-trip tests cover this contract.
Autosave primes this cache after a short debounce. Unload mirroring accepts
custom configs only when their exact references have also completed the normal
primary save. Encryption preparation alone is not a commit receipt, because
normal load prefers a populated primary store over an unload mirror. A pending
beforeunload cancels closing, warns and schedules normal save; pagehide skips
unsafe writes. Receipts are bounded per project and contain only reference
signatures; ReactFlow layout-only array replacement does not invalidate them.
This does not upgrade other canvas fields' existing best-effort unload behavior.
A ready
snapshot retains the best-effort mirror's quota behavior. Cleanup-only preload
observers disconnect on pagehide so a canceled close does not disable them.
Source macOS native encryption and two independent Electron service lifetimes
passed with a unique QA Keychain item in the observed screen-locked session.
The QA profile must be under the system temporary directory; a /tmp profile is
rejected by the unchanged development helper guard on this machine. A real
trusted-renderer IPC, early-close cancellation, completed close and restart
also passed with the native adapter. Packaged and Windows native acceptance
remain separate;
this is not a durability guarantee against crashes or forced termination.

If the normal canvas load throws, the renderer leaves the canvas save gate
closed and warns the user, rather than enabling autosave for an empty fallback.
Late completion from a previous project cannot change the current gate. This
guard covers the normal autosave and unload mirror paths; it is not proof that
all other project writers or existing backups are protected.

Normal canvas saves in one renderer assign per-project sequence numbers and
serialize final commits across canvas remounts. A superseded preparation is
discarded, and a stale quota error cannot write its old state as a mirror.
This does not serialize other renderer processes, backup restore, or every
project writer, and does not make media preparation transactional.

Canvas save/load hooks log fixed failure and lock messages rather than raw
exceptions, safety-check objects or project identifiers. This prevents those
specific diagnostic messages from carrying user content; it does not redact
logs elsewhere, historical logs, or manual API configurations stored in a
project. The save-block prompt still receives the original safety result so
that the existing recovery behavior remains intact.

Media preparation, externalization, cleanup, migration recovery, automation
result persistence and backup-import diagnostics in the app assembly now log
only fixed labels, without raw exceptions, references, node IDs or restore
reports. The storage write barrier also logs only a fixed label while retaining
its callback error semantics. The media externalizer has an isolated oversized-payload regression;
this does not establish that unrelated logs or historical logs are private.

Plain project export refuses any custom-node config, whether live, legacy or
device-local. Selected-project import refuses device-local references.
Password-encrypted export resolves selected canvas references only
in memory before encryption, and aborts if a reference is unavailable or
appears outside the supported canvas path. Import checks only selected
canvas states and rejects before reading or writing destination storage. Selected
imported raw configs are protected on the target before destination reads or
journal creation; failure preserves the existing projects. Existing destination
rollback snapshots and historical records are not retroactively sanitized.
Other selected-free modules retain their existing behavior.
If a project's local canvas read throws and no valid
canvas-shaped mirror is available, project backup stops rather than silently
omitting that canvas. These guards do not sanitize older manual configs or
prove that every referenced external asset is present.

Import additionally stops before destination reads/writes if a selected
project retains an explicit unresolved external-asset marker. Resolved or
inline assets and unselected projects are not blocked. This does not detect
missing assets that have no marker, nor does it encrypt external media.

A portable-backup JSON envelope uses WebCrypto PBKDF2-SHA256 and
AES-256-GCM with random salt/IV, authenticated fixed format parameters, and a
64 MiB plaintext limit. It validates envelope shape and length before key
derivation and returns fixed errors; the password is not serialized. Import can
recognize and decrypt this format using a masked desktop password dialog, then
opens the usual explicit import confirmation. Incorrect passwords, cancellation
and invalid envelopes do not start a restore. A user-selected password option
now exports the JSON envelope after two masked password entries; the save IPC
validates the envelope and creates a new folder without overwriting an existing
backup. The chooser can locate the matching external-media manifest before
decryption, and restore remains explicitly confirmed. External assets, their
filenames and existing backups remain unencrypted; the UI states this limit.
Decrypted selected canvas configs are re-encrypted into the target-device vault;
external media and non-canvas backup modules are not covered by that step.
Large-backup compatibility, Windows testing and independent review remain open.

The source DeepSeek account-login path has its own distinct encrypted grant
record and non-secret installation identifier. It does not overwrite the API
key vault; malformed grant or device records are retained and rejected rather
than silently reset. Its OS-encryption adapter is connected to the source login;
only synthetic account-grant tests have been run, not live login or full
system-Keychain/DPAPI account-grant acceptance.

Phase 2 adds `assistant-workspace-v1/` beneath userData, owned only by the main
process. A random AES-256-GCM document key is wrapped with the existing async
OS-backed adapter in `key.json`. Catalog, role definitions and individual
conversation documents contain authenticated ciphertext; document ID, format
and revision are authenticated as AAD. Atomic private-file replacement and
single-main-process serialization provide optimistic revision checks, not a
cross-process lock or power-loss transaction guarantee. Missing/damaged keys,
unsafe paths or failed native storage stop writes without plaintext fallback.

The encrypted catalog references separately encrypted role/session documents.
Create publishes the document before its catalog entry; an interrupted catalog
write can leave an unreferenced encrypted file, retained for recovery. Session
draft edits use revision checks; late model completion merges into the latest
document, preserving newer drafts. First workspace initialization marks prior
queued/running tasks interrupted and never replays their requests automatically.

Synthetic tests cover tampering, swapped records, stale revisions, snapshots,
lost keys, symlinks, independent drafts and interruption. Separate real macOS
Electron lifetimes also passed OS-backed key wrapping, large encrypted history,
role round-trip and interruption recovery, with cleanup of the test's own QA
Keychain item. Windows native remains a separate check. Source macOS legacy
import and workbench backup/restore now have their own acceptance below;
formal user data were not migrated or deleted by these tests.

Default assistant UI now uses the encrypted store for per-session drafts and
bounded presentation history; no browser plaintext chat mirror is added. Live
confirmation controls do not survive persistence. Async setters keep their
owner ID, and a task-only revision change may be rebased but foreign draft or
presentation edits are refused. Unsaved writes gate selection and normal close.
Actual macOS source process restart preserved selected ID, independent drafts,
histories and cancelled/completed task states. Custom roles/media have subsequent
source acceptance below; crash/power-loss durability is still not claimed.

Custom-role definitions and legacy import now also live in this encrypted
store. Import IDs are deterministic, repeat import never overwrites an edited
role, and source agent/history JSON remains unchanged. Custom turn leases
snapshot role revisions and cannot settle a Harness or cancelled task.

Assistant media uses immutable binary AES-GCM envelopes beside the encrypted
documents, sharing the existing OS-wrapped workspace key. Owner session and
asset ID are authenticated; names/digests and opaque references live only in
encrypted session documents. Main accepts bounded selected File bytes, not
paths/URLs. Six draft files, 32 MiB each, 96 MiB total; main checks container
signatures, byte lengths and SHA. Only the corresponding live custom-turn
lease can resolve bytes. Success clears unchanged draft media, while failures
retain it and history provides explicit reattachment; old media is not
implicitly resent. Publication failures retain ciphertext orphans. No orphan
GC or crash/power-loss guarantee is claimed.

Workbench backup now exports logical roles/session/reference data and verified
media, never the device wrapping key or main-assistant login credential. The
existing 64 MiB password envelope encrypts all of it, including names/media,
before the validated save IPC. Import rejects plain files, validates the
decrypted logical snapshot and stages new encrypted role/session/media IDs.
One final catalog publication exposes those copies; existing records are never
replaced. Snapshot hashes and deterministic staged identities support idempotent
retry, including orphan recovery after catalog failure. Later edits to imported
copies survive duplicate import. Imported project bindings are cleared and
old unfinished tasks become interrupted without replay. Imported assistant
text is an unverified quote, not a current-device execution receipt. Normal
restart/copy restore used real QA OS wrapping in a source Mac window; native
Windows and unbounded backup size are not established by those tests.

Phase-three normal-close preparation now receives an explicit commit receipt
from useSaveCanvasState. The existing primary write is followed by acknowledged
reference sync and awaited desktop mirror; errors/refusals/locks/superseded
saves cannot be reported as a successful close. The canvas snapshot/project is
checked again after preparation. Failed/not-loaded projects are not overwritten.
The old synchronous unload mirror remains only best effort, not the close
commit authority. Main keeps the window/services alive on an unconfirmed save.
Assistant close flush uses all-settled local writes, preserving unsaved drafts
on failure, and never waits for or replays a paid model turn. This does not claim
crash/power-loss durability or broaden the ordinary storage/file scope.

History paging and search are presentation-only. The existing full encrypted
workspace record/optimistic revisions remain unchanged; no truncated history,
new plaintext search index or second persistence layer is introduced. Archive
preview uses the same trusted read route and does not modify archive state,
selection, grants or media files merely by being viewed.

Attachment preview reuses the original immutable encrypted media owner. It
accepts only a session ID plus opaque asset ID still referenced by that session,
including history; unrelated sessions, orphan guesses and paths are refused.
Reads are single-flight, bounded to the existing 32 MiB media limit and verify
size, SHA256 and identified type/MIME. No send lease, extraction, file mutation
or reset is performed. Renderer Blob URLs are transient and revoked on close,
replacement and decode failure; they never enter workspace/backup documents.
