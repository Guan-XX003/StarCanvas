Creates and reveals the BrowserWindow, injects desktop CSS, manages webviews and navigation restrictions, records renderer crashes, and supports recovery.

Startup is released after renderer readiness is confirmed. The preload watchdog may clear a stale splash only when this document already carries a confirmed readiness state; it must preserve the recovery prompt for failed or still-pending starts. This guards against a delayed watchdog overwriting an already successful startup.

Phase-three candidate QA uses scripts/candidate-launch-plan.cjs: a packaged .app
or .exe launches its own executable from a detached working directory, without
loading development Electron or silently falling back to source. Source mode
retains the pinned-runtime check. Profiles are fresh or explicitly reused under
the real OS temporary root; Mac QA identities remain stable for that profile.
Packaged mode strips inherited development-server selection. This is test-launch
tooling, not a new production storage format. With the explicit candidate QA flag
and a validated own OS-temp profile, candidate-qa-startup runs before importing
storage/IPC owners: app media/safety/log roots stay in that profile; Node HTTP/
fetch, the combined Electron network/file filter and existing proxy guard allow
only the own static origin and declared synthetic ports. This does not claim an
OS sandbox for arbitrary native plugins. Without the flag production behavior
is unchanged. No Chromium security/certificate checks are disabled for QA.

The installed v3 Mac baseline completed two native lifetimes using its own binary,
ASAR, encrypted vault and bundled Harness against one loopback model request;
packaged CLI/MCP connected only to its explicit descriptor. This is baseline
evidence, not final phase-three, upgrade, Windows or public-release acceptance.

Windows ZIP baseline is independently installed with matching ASAR/hash and
native DPAPI/Harness/CLI/MCP evidence. Its full restart acceptance is FAILED:
a newly edited text node was absent after a rapid normal quit/restart. The
asynchronous project save versus best-effort unload mirror/unguarded main quit
is the next ownership boundary to investigate, not an accepted durability claim.
Do not resolve this by disabling unload safety or merely slowing the test.

Normal close now goes through desktop-close-coordinator.cjs. Main intercepts
window close/App before-quit, asks only its registered same-origin index document
for the local-save registry's versioned receipt, and permits the original close
only after every local owner settles successfully. Pending requests coalesce;
timeout never cancels an unknown save, spawns a second prepare, or grants close
when a late result arrives. Existing beforeunload protection is not overridden.
The static server stops at will-quit, not a cancelled before-quit. Failures retain
the window and show a localized, theme-token-based notice without user content.

The renderer desktop-close registry freezes user input while preparing local
writes. Canvas preparation commits via the existing encrypted/media/reference/
primary/mirror owner, checks the current project/snapshot after commit, and
assistant preparation drains only local imports/drafts/history, not model turns.
No new HTTP/MCP close approval, arbitrary script tool or file authority is added.
Installed Mac arm64 and Windows x64 candidates with the same ASAR have now each
passed three native lifetimes, immediate edits followed by App/window close,
and two correct project recoveries. Input-to-close-request was 0ms, not a test
sleep for the 2800ms autosave. Mac's close-window/keep-App-running behavior was
checked separately. Exact receipts/settled screenshots/cleanup are tracked in
ASSISTANT_STAGE_THREE.md; this is a targeted fix, not full phase-three acceptance.

The build now preserves the pinned account-helper/Harness/tool resource scopes
during signing, then uses scripts/after-sign.cjs to verify helper identity and
official assistant bytes AFTER signing as well. App code/frameworks are not
excluded. This closes the pre-sign-only validation gap; no runtime identity or
credential ACL is relaxed. The ad-hoc baseline is not a native-login acceptance.

Phase-three delivery packaging now explicitly selects local ad-hoc identity
instead of accidentally leaving Electron's linker placeholder when certificate
auto-discovery is disabled. Hardened Runtime remains enabled and the existing
Electron entitlement preset is unchanged. afterSign additionally verifies the
entire App with codesign --verify --deep --strict, after the fixed helper and
Harness identity checks. This proves resource sealing, not Apple notarization,
Gatekeeper distribution trust or native login acceptance.
