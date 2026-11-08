# macOS account keychain helper

`macos-account-keychain` is a frozen, ad-hoc-signed universal executable. Its
exact bytes are part of the login-storage compatibility contract: macOS may
deny an updated executable access to an item created by another code identity.
Reuse the same file for later releases; do not recompile or re-sign it as an
ordinary packaging step. The packaging hook verifies both its pinned digest and
the associated Swift source digest and fails closed if either has changed.

The helper and source also have a verified backup in
`../backups/macos-account-keychain-20261030-v1` relative to the App repository.
If the helper must intentionally change, treat that as a storage migration,
keep the prior helper and Keychain item intact, and validate the re-login and
upgrade flow before release. Never include credentials in build outputs.
