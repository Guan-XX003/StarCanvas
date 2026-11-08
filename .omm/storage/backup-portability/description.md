Builds modular JSON backups, optionally exports external media bundles, sanitizes canvas state, and restores selected modules without resetting unrelated data.

No-journal startup inspection does not supersede queued autosaves. Real recovery and backup import preserve write fencing and invalidate writes derived from pre-recovery state; successful imports retain the reload hold. The startup/no-op and real-recovery races are covered separately by the transaction regression suite.

Windows uninstall removes application binaries but preserves the custom
`wanjuan-ai-canvas-desktop-test` userData directory. NSIS default app-data
deletion is disabled and the custom uninstaller contains no recursive data
removal. Users must invoke the existing explicit data-cleanup workflow separately
if they intend to remove projects/configuration; uninstall is not consent to
delete creative work. `test:windows-uninstall-data` guards this packaging policy.
