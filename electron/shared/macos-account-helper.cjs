// This signed executable's identity is a compatibility boundary. Do not rebuild
// it during packaging: Keychain items are tied to its exact code identity.
module.exports = Object.freeze({
  sha256: "499a5a9c3f125489fc6e8a6fb33efc72b12ccd3a244de0bc6fa0286c47cadba6",
  resourceDirectory: "starcanvas-account-keychain",
  executable: "macos-account-keychain",
  ciphertextPrefix: "wanjuan-keychain-v2.",
});
