/**
 * Convert local node media bindings into portable cloud references and back.
 * No file is opened or transmitted here. File hashes and destination paths must
 * come from a trusted main-process file verifier, not from renderer assertions.
 * Unsupported portableDataRef / unbound media fails instead of being dropped.
 */
import { CloudProjectSafetyError, prepareCloudProjectState } from "./cloud-project-safety";
import { buildProjectMediaFileUrl } from "./resource";

export type VerifiedLocalAsset = { localPath: string; sha256: string; size: number };
export type CloudAssetReference = { assetId: string; blob: { sha256: string; size: number } };
const HASH = /^[a-f0-9]{64}$/;
const FIELD = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const FORBIDDEN_FIELD = new Set(["constructor", "prototype", "__proto__", "projectAssetBindings", "cloudAssetBindings"]);
const REFERENCE_PREFIX = "starcanvas-cloud:";
const LOCAL_ASSET_REFERENCE = /^(?:project-asset-v2-|external-asset-file:)/i;

function fail(code: string): never { throw new CloudProjectSafetyError(code); }
function objectCopy(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return fail("INVALID_PROJECT_VALUE");
  }
  const out = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!("value" in descriptor)) fail("INVALID_PROJECT_VALUE");
    out[key] = descriptor.value;
  }
  return out;
}
function localAsset(value: VerifiedLocalAsset): VerifiedLocalAsset {
  const input = objectCopy(value);
  if (typeof input.localPath !== "string" || !input.localPath || input.localPath.includes("\0") ||
      typeof input.sha256 !== "string" || !HASH.test(input.sha256) || !Number.isSafeInteger(input.size) || input.size < 0) {
    return fail("INVALID_VERIFIED_ASSET");
  }
  return { localPath: input.localPath, sha256: input.sha256, size: input.size };
}
function cleanMetadata(binding: Record<string, any>) {
  const mime = binding.mime == null ? "" : binding.mime;
  const kind = binding.kind == null ? "binary" : binding.kind;
  const filename = binding.filename == null ? "" : binding.filename;
  if (typeof mime !== "string" || mime.length > 150 || (mime && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) ||
      typeof kind !== "string" || !["image", "video", "audio", "text", "binary"].includes(kind) ||
      typeof filename !== "string" || filename.length > 255 || /[\\/\x00-\x1f]/.test(filename)) {
    fail("INVALID_MEDIA_METADATA");
  }
  return { mime, kind, filename };
}

export function prepareCloudProjectMedia(input: unknown, verifiedFiles: VerifiedLocalAsset[]): {
  state: unknown; assets: CloudAssetReference[]; removedSecretFields: number;
} {
  if (!Array.isArray(verifiedFiles) || verifiedFiles.length > 10000) fail("INVALID_VERIFIED_ASSET");
  const files = new Map<string, VerifiedLocalAsset>();
  for (const entry of verifiedFiles) {
    const asset = localAsset(entry);
    const old = files.get(asset.localPath);
    if (old && (old.sha256 !== asset.sha256 || old.size !== asset.size)) fail("ASSET_METADATA_CONFLICT");
    files.set(asset.localPath, asset);
  }
  const root = objectCopy(input);
  if (!Array.isArray(root.nodes)) fail("INVALID_PROJECT_VALUE");
  const assets = new Map<string, CloudAssetReference>();
  root.nodes = root.nodes.map((node: unknown) => {
    const copy = objectCopy(node);
    if (!copy.data || typeof copy.data !== "object") return copy;
    const data = objectCopy(copy.data);
    if (data.cloudAssetBindings != null) fail("CLOUD_MEDIA_FIELD_CONFLICT");
    const bindings = data.projectAssetBindings == null ? Object.create(null) : objectCopy(data.projectAssetBindings);
    const cloudBindings: Record<string, unknown> = Object.create(null);
    for (const [field, item] of Object.entries(bindings)) {
      if (!FIELD.test(field) || FORBIDDEN_FIELD.has(field)) fail("INVALID_MEDIA_FIELD");
      const binding = objectCopy(item);
      if (typeof binding.localPath !== "string" || !binding.localPath) fail("MEDIA_NOT_PREPARED");
      const asset = files.get(binding.localPath);
      if (!asset) fail("MEDIA_NOT_PREPARED");
      if ((binding.sha256 && binding.sha256 !== asset.sha256) ||
          (binding.size != null && binding.size !== 0 && binding.size !== asset.size)) fail("ASSET_METADATA_CONFLICT");
      if (!Object.prototype.hasOwnProperty.call(data, field)) fail("INVALID_MEDIA_FIELD");
      const current = data[field];
      if (typeof current !== "string" || !current) fail("INVALID_MEDIA_FIELD");
      if (binding.sourceSignature ? binding.sourceSignature !== current :
          current !== binding.localPath && current !== buildProjectMediaFileUrl(binding.localPath)) {
        fail("STALE_MEDIA_BINDING");
      }
      const refKey = `${field}Ref`;
      const localRef = data[refKey];
      if (typeof localRef === "string" && LOCAL_ASSET_REFERENCE.test(localRef)) {
        if (binding.portableDataRef && binding.portableDataRef !== localRef) fail("STALE_MEDIA_BINDING");
        // The verified file is the portable source; retaining its old local
        // IndexedDB key could rehydrate unrelated bytes on another device.
        delete data[refKey];
      }
      const metadata = cleanMetadata(binding);
      cloudBindings[field] = { assetId: asset.sha256, sha256: asset.sha256, size: asset.size, ...metadata };
      data[field] = REFERENCE_PREFIX + asset.sha256;
      assets.set(asset.sha256, { assetId: asset.sha256, blob: { sha256: asset.sha256, size: asset.size } });
    }
    delete data.projectAssetBindings;
    if (Object.keys(cloudBindings).length) data.cloudAssetBindings = cloudBindings;
    copy.data = data;
    return copy;
  });
  const result = prepareCloudProjectState(root);
  return { ...result, assets: [...assets.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)) };
}

export function restoreCloudProjectMedia(input: unknown, verifiedFiles: VerifiedLocalAsset[]): unknown {
  if (!Array.isArray(verifiedFiles) || verifiedFiles.length > 10000) fail("INVALID_VERIFIED_ASSET");
  const files = new Map<string, VerifiedLocalAsset>();
  for (const entry of verifiedFiles) {
    const asset = localAsset(entry);
    if (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(asset.localPath)) fail("INVALID_VERIFIED_ASSET");
    const old = files.get(asset.sha256);
    if (old && (old.localPath !== asset.localPath || old.size !== asset.size)) fail("ASSET_METADATA_CONFLICT");
    files.set(asset.sha256, asset);
  }
  const checked = prepareCloudProjectState(input);
  if (checked.removedSecretFields) fail("POTENTIAL_SECRET_IN_CONTENT");
  const root = objectCopy(checked.state);
  if (!Array.isArray(root.nodes)) fail("INVALID_PROJECT_VALUE");
  root.nodes = root.nodes.map((node: unknown) => {
    const copy = objectCopy(node);
    if (!copy.data || typeof copy.data !== "object") return copy;
    const data = objectCopy(copy.data);
    if (data.projectAssetBindings != null) fail("CLOUD_MEDIA_FIELD_CONFLICT");
    const cloud = data.cloudAssetBindings == null ? Object.create(null) : objectCopy(data.cloudAssetBindings);
    const bindings: Record<string, unknown> = Object.create(null);
    for (const [field, value] of Object.entries(cloud)) {
      if (!FIELD.test(field) || FORBIDDEN_FIELD.has(field)) fail("INVALID_MEDIA_FIELD");
      const binding = objectCopy(value);
      if (Object.keys(binding).sort().join(",") !== "assetId,filename,kind,mime,sha256,size" ||
          typeof binding.assetId !== "string" || !HASH.test(binding.assetId) || binding.sha256 !== binding.assetId ||
          !Number.isSafeInteger(binding.size) || binding.size < 0 || data[field] !== REFERENCE_PREFIX + binding.assetId) {
        fail("INVALID_MEDIA_REFERENCE");
      }
      const asset = files.get(binding.sha256);
      if (!asset || asset.size !== binding.size) fail("MEDIA_NOT_DOWNLOADED");
      const metadata = cleanMetadata(binding);
      const localUrl = buildProjectMediaFileUrl(asset.localPath);
      bindings[field] = { ok: true, assetId: binding.assetId, sha256: binding.sha256, size: binding.size,
                          localPath: asset.localPath, field, ...metadata, valueFormat: "file-url", sourceSignature: localUrl };
      data[field] = localUrl;
    }
    delete data.cloudAssetBindings;
    if (Object.keys(bindings).length) data.projectAssetBindings = bindings;
    copy.data = data;
    return copy;
  });
  return root;
}
