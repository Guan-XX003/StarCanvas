The built-in unified API catalog and endpoint configuration used by text, image, video, audio, and music models without an additional application-side forwarding layer.

The September 2026 catalog adds explicit bindings for Claude Opus 5, Gemini 3.8
Flash and Gemini Flash Lite Image. These are configuration-level integrations,
not evidence of successful paid production calls. `MiniMax-H3-720p` has a
supplier-confirmed profile in `jixin-h3.ts`: text-to-video submits JSON to
`POST /v1/videos` with integer `duration` (4–15), fixed `resolution: 720p`, and
`ratio`, then polls `GET /v1/videos/{task_id}`. It is not MiniMax's native H3
V2 endpoint. Closed-network hook tests cover submit, polling, root result URLs,
terminal failures, persistence, and legacy `file_id` retrieval. Reference
images, first/last frames, video, and audio stay fail-closed before any upload
or request until the production New API media adapter is deployed and verified.

All real H3 submissions remain blocked by a separate billing gate: the current
production expression reads raw `seconds`, not the new `duration` field. The
custom production task billing entry point and final charge must be verified
before clearing `blockedReason`. UI shows "计费待确认". Closed-network tests
override this gate only in memory and assert shipping defaults make zero network
calls while preserving existing results. No generated test config is deployed.

Managed-account activation is asynchronous. Electron main treats a successful
HTTP response with pending/retrying state as unfinished and retries credential
synchronization at an exponential backoff capped at 30 seconds until activation.
The global renderer account state independently refreshes sanitized relay metadata,
even when account settings are closed, then refreshes the wallet on activation;
it never receives the managed credential. Activation, logout, account-lifecycle
changes or a disabled managed-config capability stop the relevant loop, and stale
responses cannot update another account. This is source-tested behavior, not
acceptance of an older packaged artifact or production deployment.

Account credentials are owned by main-process `account-secret-storage.cjs`.
Anonymous status reads are pure and never probe macOS Keychain. Sensitive
operations use Electron 42 asynchronous OS encryption with an eight-second
deadline; failures do not create a plaintext/local-key fallback or discard an
existing session. Legacy local ciphertext remains read-only compatible when
its original key exists. Account and enterprise lifecycle epochs are rechecked
after native awaits so logout or workspace changes cannot revive stale secrets.
Renderer receives only sanitized status, never refresh tokens or managed keys.
Enterprise gateway host storage remains on its existing separate provider.

Packaging runs `scripts/after-pack.cjs` after the platform-tool copy hook. It
extracts the actual app.asar into a fresh temporary directory and loads the
main-process dependencies selfsigned and yaml, including transitive imports.
Resolution must remain inside the extracted archive; missing dependencies fail
the build before signing or publishing. This does not launch Electron, probe
native credential storage, or prove packaged GUI/provider readiness.
