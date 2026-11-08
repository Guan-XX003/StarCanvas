Preserves the required preload installation order so fetch interception, theme bootstrap, storage recovery, shims, and DOM patches initialize consistently.

The initial opaque Electron document can reject access to localStorage. Legacy
confirmation returns false for that document and the bootstrap defers desktop
recovery until the real application origin runs preload. No migration marker,
database scan or user-data write occurs in that unavailable-storage context;
Chrome shims and bridge installation remain available. A previously confirmed
valid origin retains the original recovery order.

Development/candidate launchers and npm App build entrypoints run
`scripts/verify-electron-runtime.cjs` first. The pinned package and lock versions,
installed Electron package and executable-reported version must agree before
creating development userData or launching the App. Executable verification uses
Electron Node mode only, with inherited Node injection options cleared; it does
not initialize app, safeStorage or the OS credential store. This prevents a stale
Electron 39 development installation from silently missing the Electron 42 async
account-storage API. It is a runtime identity check, not native-storage acceptance.

Main and preload install the pure shared `diagnostic-policy.cjs` console guard
before loading application modules. Renderer entry imports its diagnostic
bootstrap before the application bundle. Disk diagnostics and tool-install logs
accept only fixed event/enum names, bounded counts, booleans and scheme/error
classes; arbitrary fields, URLs, paths, request/response bodies and error stacks
are omitted. The fatal main handler writes only classified diagnostics and throws
a constant fatal marker, not the original error. Native Chromium/OS diagnostics
and user-visible provider errors are outside these application logging sinks.
Trace/assert are emitted through a plain structured console writer without native
stacks; timer/counter labels are retained only in bounded in-memory maps and never
printed. Group labels, table/dir output and profile/timestamp markers are also
summarized. This does not rewrite errors returned to the renderer for user action.
