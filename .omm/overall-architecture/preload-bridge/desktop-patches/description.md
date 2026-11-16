Adds desktop-only integration behavior and compatibility fixes after DOMContentLoaded; these patches must remain idempotent to avoid mutation loops.

The merged project switcher uses stable renderer control markers instead of
translated titles. Its normal patch observer also tracks backing select/options
and rename-text mutations, including React character-data changes. The combo's
own label/menu writes and high-frequency canvas mutations are excluded. This
keeps English project creation/switch labels and options synchronized without
a self-refresh loop; it does not change project persistence or plan authority.

The auto-download listener publishes a non-sensitive DOM acknowledgement only
after applying its observer state. A revision/pending-value guard prevents stale
asynchronous storage reads from undoing a newer user-selected setting while its
normal persistence catches up. The acknowledgement is not a security boundary
and does not prove durable storage or a successful media download.
Observer installation is recorded only after `observe` succeeds. A constructor
or installation failure disconnects any partial observer, retains a retryable
uninstalled state and publishes an unknown listener acknowledgement instead of
allowing a later hydration to confirm a non-existent observer.
If the observed canvas is detached while the switch remains enabled, the
existing document mutation observer detects the detached root, marks the
listener unconfirmed, reconnects to the new canvas or a body fallback, marks
currently generating nodes synchronously, and queues a scan without resetting
the seen-result baseline. The acknowledgement
requires the observed root to remain connected. A rebind failure stays
unconfirmed and logs only a fixed warning; a failure while marking nodes also
disconnects the listener and stays unconfirmed. This does not prove a media save.
The renderer exposes a temporary `data-wanjuan-generating` marker on rendered
node wrappers from their boolean `data.loading` state; it is not written back
to project data. The observer uses this marker, never arbitrary node text, to
mark in-progress nodes before the debounced media scan. An observed marker's
old value preserves a short transition within one mutation batch. It does not
rescan the whole canvas for each mutation, and a state that never reaches the
DOM cannot be guaranteed detectable. The long-lived per-node marker and media
identity heuristic remain limitations for later unrelated media in that node.
An inactive node's previous generation marker is cleared before a local file
input change, drop, or paste can replace its media. Media seen while the node
is idle is baselined immediately; on a subsequent generation start, changed or
newly inserted media in that mutation batch is not mistaken for the baseline.
The audio-input and video-frame-extraction nodes notify the preload before
applying connected or selected media; the image node does so for selected media.
An image selected in the current component session also carries its manual
identity through data-URL-to-project-file conversion, including a separate
thumbnail. Audio-input conversions to blob URLs similarly notify before the
node update. Generated data-URL conversions do not receive the manual hint.
The local notification carries the node ID and a sampled non-cryptographic
fingerprint, not a complete URL or file. For a uniquely identified active node,
the observer baselines matching known manual inputs without disarming the run;
distinct observed generated results remain eligible. Hints are held only in a
node-keyed weak map and cleared when observed or when the setting is disabled.
The sampled identity can collide, is not secret or a security boundary, and a
manual input not observed before a later run may suppress a matching result.
Other replacement paths, DOM timing, and events without hints remain outside
this guard; it is not full result provenance.
Pending downloads use the live listener state rather than a potentially stale
persisted flag, and check the revision again after asynchronous preparation so
an intervening setting change cancels work before the save IPC is invoked.
When an independently persisted disabled state is accepted during hydration,
the observer is disconnected; an outdated read cannot disconnect a newly
enabled listener.
Accepted storage-driven changes also advance the revision, so an off/on cycle
cannot revive an in-flight save prepared under an older setting.
The seen-result set retains all currently mounted media keys even when the
canvas exceeds 2,000 results; when its size exceeds the current media element
count plus 2,000, detached keys are pruned without clearing the visible
baseline. The set can still grow with currently mounted elements; removed and
later remounted results are not guaranteed to retain their previous key.
Concurrent hydration reads have independent sequence tickets: once a newer
read has been accepted, a later-arriving older read cannot replace it.
Auto-download save and hydration failures log fixed coarse warning labels,
never the raw error object, which may contain media URLs, paths or credentials.
This guarantee applies to these two warning sites, not all application logs.
