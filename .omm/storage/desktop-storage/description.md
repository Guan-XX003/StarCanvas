A preload storage abstraction backed by IndexedDB with localStorage recovery and a Chrome-storage-compatible interface.

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
