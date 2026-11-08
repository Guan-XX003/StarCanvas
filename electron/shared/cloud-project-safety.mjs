/**
 * Preparing a cloud-project payload is separate from local backup/export.
 * The caller must first replace all local media bindings with the cloud media
 * contract, then call this guard on the exact object it serializes. It is
 * defense in depth, not a guarantee
 * that user-authored free text cannot contain a secret.
 */
export class CloudProjectSafetyError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "CloudProjectSafetyError";
  }
}

const DROP_FIELDS = new Set([
  "apiconfigs", "modelprotocolregistry", "authorization", "proxyauthorization",
  "cookie", "setcookie", "password", "credential", "credentials", "clientsecret",
  "secret", "secretkey", "secretaccesskey", "accesskey", "accesskeyid", "privatekey",
  "sessiontoken", "accesstoken", "refreshtoken", "authtoken", "token", "apikey",
  "headers", "customheaders", "requestheaders",
]);
const AMBIGUOUS_FIELDS = new Set(["key", "signature"]);
const SECRET_TEXT = /(?:\bbearer\s+[a-z0-9._~+\/-]{12,}|\bsk-[a-z0-9_-]{12,}|\baklt[a-z0-9_-]{8,}|\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})/i;
const SENSITIVE_QUERY = /^(?:access[_-]?token|api[_-]?key|auth[_-]?key|key|token|secret|password|signature|sig|credential|x-amz-.+|x-goog-.+|x-oss-.+)$/i;
const MEDIA_FIELD = /(?:url|uri|path|file|src|source)$/i;
const LOCAL_ASSET_REFERENCE = /^(?:project-asset-v2-|external-asset-file:)/i;

function isSignedUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    return Array.from(url.searchParams.keys()).some((key) => SENSITIVE_QUERY.test(key));
  } catch {
    throw new CloudProjectSafetyError("INVALID_MEDIA_URL");
  }
}

export function prepareCloudProjectState(input) {
  let count = 0;
  let removedSecretFields = 0;
  const ancestors = new Set();

  function copy(value, field, depth) {
    if (++count > 250000 || depth > 80) throw new CloudProjectSafetyError("PROJECT_TOO_COMPLEX");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new CloudProjectSafetyError("INVALID_PROJECT_VALUE");
      return value;
    }
    if (typeof value === "string") {
      if (SECRET_TEXT.test(value) || isSignedUrl(value)) throw new CloudProjectSafetyError("POTENTIAL_SECRET_IN_CONTENT");
      // IndexedDB asset keys are local to this installation; serializing the
      // key without its bytes would create an apparently successful but
      // unrecoverable cloud project on another device.
      if ((/portableDataRef$/i.test(field) && value !== "") ||
          (/Ref$/i.test(field) && LOCAL_ASSET_REFERENCE.test(value))) {
        throw new CloudProjectSafetyError("MEDIA_NOT_PREPARED");
      }
      if (MEDIA_FIELD.test(field) && !/^https?:\/\//i.test(value) &&
          /^(?:file:|blob:|data:|[a-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|[^\s?#]+[\\/])|\.(?:png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a)(?:[?#].*)?$/i.test(value)) {
        throw new CloudProjectSafetyError("MEDIA_NOT_PREPARED");
      }
      return value;
    }
    if (typeof value !== "object") throw new CloudProjectSafetyError("INVALID_PROJECT_VALUE");
    if (ancestors.has(value)) throw new CloudProjectSafetyError("CYCLIC_PROJECT");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new CloudProjectSafetyError("INVALID_PROJECT_VALUE");
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const output = [];
        for (let i = 0; i < value.length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor || !("value" in descriptor)) throw new CloudProjectSafetyError("INVALID_PROJECT_VALUE");
          output.push(copy(descriptor.value, field, depth + 1));
        }
        return output;
      }
      const output = Object.create(null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!descriptor.enumerable) continue;
        if (!("value" in descriptor)) throw new CloudProjectSafetyError("INVALID_PROJECT_VALUE");
        const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (DROP_FIELDS.has(normalized) || normalized.endsWith("apikey") || normalized.endsWith("token")) {
          removedSecretFields++;
          continue;
        }
        if (AMBIGUOUS_FIELDS.has(normalized) && descriptor.value !== "" && descriptor.value != null) {
          throw new CloudProjectSafetyError("AMBIGUOUS_SENSITIVE_FIELD");
        }
        if (normalized === "projectassetbindings" && descriptor.value &&
            typeof descriptor.value === "object" && Object.keys(descriptor.value).length) {
          throw new CloudProjectSafetyError("MEDIA_NOT_PREPARED");
        }
        if (typeof descriptor.value === "function" && /^on[A-Z]|^updateGlobalTasks$/.test(key)) continue;
        output[key] = copy(descriptor.value, key, depth + 1);
      }
      return output;
    } finally {
      ancestors.delete(value);
    }
  }
  return { state: copy(input, "", 0), removedSecretFields };
}
