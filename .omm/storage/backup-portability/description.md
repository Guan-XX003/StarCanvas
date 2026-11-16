Builds modular JSON backups, optionally exports external media bundles, sanitizes canvas state, and restores selected modules without resetting unrelated data.

New external-media manifests omit original absolute source paths on disk; IDs,
filenames, sizes and hashes remain available for portable matching and restore.
The local export result retains source paths in memory for missing-file
diagnostics. Existing manifests are unchanged, and file names, media contents,
other metadata and legacy plaintext backups are not encrypted by this change.

Users may select password encryption for new backup JSON files. The renderer
creates an authenticated envelope and sends only ciphertext to the save IPC;
the main process checks envelope structure and writes to a newly created folder
with no overwrite. The matching media folder and manifest remain plaintext and
are discoverable for import by the deterministic filename. Existing plain
backups remain supported. If a media-folder conflict is detected, the JSON is
not written and the user is warned that media may remain in the new folder.
This does not encrypt media. For password-encrypted JSON, selected canvas
device-local custom-config references are resolved in memory immediately
before encryption; an inaccessible reference or a reference elsewhere aborts
the export before the save IPC. Plain exports continue to reject these
references and raw custom-node configurations. Selected imported configs are
protected in the target-device vault before destination reads or a restore
journal; failure leaves existing projects intact. Normal canvas saves use the
same local references and loads hydrate values only in memory. Legacy existing
destination rollback snapshots are unchanged. Source macOS native service and
normal canvas persistence have their own QA tests; packaged, Windows native
storage and other project writers remain separate checks, not implied by them.

No-journal startup inspection does not supersede queued autosaves. Real recovery and backup import preserve write fencing and invalidate writes derived from pre-recovery state; successful imports retain the reload hold. The startup/no-op and real-recovery races are covered separately by the transaction regression suite.

Windows uninstall removes application binaries but preserves the custom
`wanjuan-ai-canvas-desktop-test` userData directory. NSIS default app-data
deletion is disabled and the custom uninstaller contains no recursive data
removal. Users must invoke the existing explicit data-cleanup workflow separately
if they intend to remove projects/configuration; uninstall is not consent to
delete creative work. `test:windows-uninstall-data` guards this packaging policy.

The encrypted assistant workspace has its own explicit Workbench backup flow,
not a hidden addition to the old settings/projects/agents JSON. The old dialog
now discloses that boundary. Selected/all workbench logical snapshots include
roles, conversations and referenced encrypted-store media resolved in memory;
they exclude device-wrapped keys/main-assistant login credentials and remote
memory data. Password-only export reuses the existing authenticated envelope
and exclusive-folder save IPC. The 64 MiB content cap includes media encoding;
oversize/missing/corrupt/active cases fail without silently dropping data.

Import decrypts transiently, displays an explicit copy-only confirmation, then
main validates the complete format/reference/media graph. It creates new
encrypted destination IDs and publishes the catalog last, never overwriting
existing conversations/roles/media. Duplicate imports preserve later edits and
current selection; a lost UI refresh after commit is reported as committed.
New owner IDs also isolate memory scope. Project bindings are explicitly cleared,
unfinished tasks are interrupted, and historical receipt text becomes an
unverified quote. Plain imports/executable proposal fields are rejected. Real
source Mac acceptance covers export file, wrong password, cancelled confirmation,
restart, duplicate import and a restored PNG sent through the original provider
builder to a fake service. Other platforms/large-data combinations remain bounded
by docs/ASSISTANT_WORKSPACE.md, not implied by this evidence.

Current-device generation pointers are allowed only in confirmed non-model
assistant presentation and contain strictly project/node/submission observation
identity. Backup export can carry this metadata, but copy import strips the
pointer together with local execution proof and treats historical text as an
unverified quote. Imported history cannot watch unrelated current-device tasks
or restore a plan, approval, nonce, operation receipt or media path.

Incomplete streamed text is a presentation-only, non-executable model quote.
The optional incomplete flag is accepted only on assistant/model text without
execution proof. Completed-pair model context never includes this partial text;
password backup/copy import preserves its incomplete label rather than silently
turning it into a completed reply. Live token state itself is not serialized.
