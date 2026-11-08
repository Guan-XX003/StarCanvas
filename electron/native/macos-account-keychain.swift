// Standalone macOS account-secret helper. It must be shipped as the same signed
// executable across updates: the Keychain trusts this executable, not the app's
// changing ad-hoc signature. Requests and responses travel only over stdio.
import Foundation
import CryptoKit
import Security
import LocalAuthentication

private let maxInput = 131_072
private let maxSecret = 65_536
private let productionService = "org.starcanvas.account-secret.v2"
private let account = "account-encryption-key"

private func respond(_ object: [String: Any], code: Int32) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
    exit(code)
}
private func fail(_ code: String) -> Never { respond(["ok": false, "code": code], code: 1) }

var input = Data()
while true {
    let chunk: Data
    do {
        guard let next = try FileHandle.standardInput.read(upToCount: 8192) else { break }
        chunk = next
    } catch { fail("INVALID_REQUEST") }
    if chunk.isEmpty { break }
    input.append(chunk)
    guard input.count <= maxInput else { fail("INVALID_REQUEST") }
}
guard !input.isEmpty,
      let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
      let operation = request["operation"] as? String,
      let value = request["value"] as? String else { fail("INVALID_REQUEST") }

var service = productionService
var syntheticScope = false
if let qaService = request["qaService"] as? String {
    // The application may select this only for a disposable test profile.
    guard ProcessInfo.processInfo.environment["STARCANVAS_KEYCHAIN_QA"] == "1",
          qaService.range(of: "^org[.]starcanvas[.]account-secret[.]qa[.][A-F0-9-]{36}$", options: .regularExpression) != nil
    else { fail("INVALID_TEST_SCOPE") }
    service = qaService
    syntheticScope = true
}
let auth = LAContext()
auth.interactionNotAllowed = true
let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword,
    kSecAttrService: service, kSecAttrAccount: account, kSecAttrSynchronizable: false,
    kSecUseAuthenticationContext: auth]

private func lookup(_ base: [CFString: Any]) -> (OSStatus, Data?) {
    var q = base
    q[kSecReturnData] = true
    q[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    return (status, result as? Data)
}
private func key(_ base: [CFString: Any], create: Bool) -> Data {
    let (status, existing) = lookup(base)
    if status == errSecSuccess {
        guard let existing = existing, existing.count == 32 else { fail("KEY_INVALID") }
        return existing
    }
    guard status == errSecItemNotFound else { fail("KEYCHAIN_UNAVAILABLE") }
    guard create else { fail("KEY_MISSING") }
    let generated = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    var q = base
    q[kSecValueData] = generated
    let inserted = SecItemAdd(q as CFDictionary, nil)
    if inserted == errSecSuccess { return generated }
    // Simultaneous first logins may race. Never replace an already-created key.
    if inserted == errSecDuplicateItem {
        let (retryStatus, retryKey) = lookup(base)
        guard retryStatus == errSecSuccess, let retryKey = retryKey, retryKey.count == 32
        else { fail("KEYCHAIN_UNAVAILABLE") }
        return retryKey
    }
    fail("KEYCHAIN_UNAVAILABLE")
}

switch operation {
case "qa-delete":
    guard syntheticScope else { fail("INVALID_TEST_SCOPE") }
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail("KEYCHAIN_UNAVAILABLE") }
    respond(["ok": true, "value": "deleted"], code: 0)
case "encrypt":
    let plain = Data(value.utf8)
    guard !plain.isEmpty && plain.count <= maxSecret else { fail("INVALID_VALUE") }
    let storageKey = key(query, create: true)
    do {
        guard let combined = try AES.GCM.seal(plain, using: SymmetricKey(data: storageKey)).combined else { fail("ENCRYPT_FAILED") }
        respond(["ok": true, "value": combined.base64EncodedString()], code: 0)
    } catch { fail("ENCRYPT_FAILED") }
case "decrypt":
    guard value.utf8.count <= maxInput, let combined = Data(base64Encoded: value), combined.count >= 29 else { fail("INVALID_VALUE") }
    let storageKey = key(query, create: false)
    do {
        let sealed = try AES.GCM.SealedBox(combined: combined)
        let plain = try AES.GCM.open(sealed, using: SymmetricKey(data: storageKey))
        guard !plain.isEmpty && plain.count <= maxSecret, let result = String(data: plain, encoding: .utf8) else { fail("DECRYPT_FAILED") }
        respond(["ok": true, "value": result], code: 0)
    } catch { fail("DECRYPT_FAILED") }
default: fail("INVALID_REQUEST")
}
