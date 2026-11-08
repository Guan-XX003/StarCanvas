/** Locate legacy IndexedDB-backed media before converting it to cloud blobs.
 * This module never opens files, uploads, or modifies the user's project.
 */
import { CloudProjectSafetyError } from "./cloud-project-safety";
import { decodePortableDataChunks } from "./cloud-portable-chunks";
import { sha256 as incrementalSha256 } from "@noble/hashes/sha256";

const IDB_KEY = /^project-asset-v2-[A-Za-z0-9_-]{1,480}$/;
const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i;
const MAX_BYTES = 128 * 1024 * 1024;
const CLOUD_REF = /^starcanvas-cloud-portable:([a-f0-9]{64}):([a-z0-9.+-]+\/[a-z0-9.+-]+)$/;
const BINDING_FIELD = /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const BINDING_FIELDS = new Set(["kind", "mime", "filename", "originalName", "sourceOrigin"]);
function validBindingAttribute(name: string, value: unknown): value is string {
  return typeof value === "string" && value.length <= 255 && !/[\x00-\x1f]/.test(value) &&
    (!(["filename", "originalName"].includes(name)) || !/[\\/]/.test(value));
}
type Storage = { getItem(key: string): Promise<unknown> };
export type PortableAsset = { ref: string; mime: string; sha256: string; size: number } &
  ({ bytes: Uint8Array; dataUrl?: never } | { bytes?: never; dataUrl: string });
const fail = (code: string): never => { throw new CloudProjectSafetyError(code); };

/** Only standard legacy `*Ref` fields are discovered; binding metadata stays
 * with the established file-binding verifier. Other unprepared local media is
 * still rejected by the existing safety guard. */
export async function collectCloudPortableAssets(input: unknown, storage: Storage): Promise<PortableAsset[]> {
  if (!storage || typeof storage.getItem !== "function") fail("MEDIA_NOT_PREPARED");
  const refs = new Map<string, string[]>(), ancestors = new Set<object>();
  let count = 0;
  function add(ref: string, current: unknown): void {
    if (!IDB_KEY.test(ref)) fail("MEDIA_NOT_PREPARED");
    if (current != null && (typeof current !== "string" || !current.startsWith("data:"))) fail("STALE_MEDIA_BINDING");
    const values = refs.get(ref) || [];
    if (current) values.push(current as string);
    refs.set(ref, values);
  }
  function visit(value: unknown, depth: number): void {
    if (++count > 250000 || depth > 80) fail("PROJECT_TOO_COMPLEX");
    if (!value || typeof value !== "object") return;
    if (ancestors.has(value)) fail("CYCLIC_PROJECT");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail("INVALID_PROJECT_VALUE");
    ancestors.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const bindingDescriptor = descriptors.projectAssetBindings;
      if (bindingDescriptor && !("value" in bindingDescriptor)) fail("INVALID_PROJECT_VALUE");
      const bindings = bindingDescriptor?.value;
      if (bindings != null) {
        if (typeof bindings !== "object" || Array.isArray(bindings) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(bindings))) fail("INVALID_PROJECT_VALUE");
        for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(bindings))) {
          if (!descriptor.enumerable) continue;
          if (!("value" in descriptor) || !BINDING_FIELD.test(field) || ["constructor", "prototype", "__proto__"].includes(field)) fail("INVALID_MEDIA_FIELD");
          const binding = descriptor.value;
          if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
              ![Object.prototype, null].includes(Object.getPrototypeOf(binding))) fail("INVALID_PROJECT_VALUE");
          const b = Object.getOwnPropertyDescriptors(binding);
          for (const entry of Object.values(b)) if (entry.enumerable && !("value" in entry)) fail("INVALID_PROJECT_VALUE");
          if ((b.localPath && !("value" in b.localPath)) || (b.portableDataRef && !("value" in b.portableDataRef))) fail("INVALID_PROJECT_VALUE");
          if (typeof b.localPath?.value === "string" && b.localPath.value) continue;
          const ref = b.portableDataRef?.value;
          if (typeof ref !== "string" || !IDB_KEY.test(ref)) fail("MEDIA_NOT_PREPARED");
          const pair = descriptors[`${field}Ref`];
          if (pair && (!("value" in pair) || (pair.value != null && pair.value !== ref))) fail("STALE_MEDIA_BINDING");
          const original = descriptors[field];
          if (original && !("value" in original)) fail("INVALID_PROJECT_VALUE");
          add(ref, original?.value);
        }
      }
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable) continue;
        if (!("value" in descriptor)) fail("INVALID_PROJECT_VALUE");
        const item = descriptor.value;
        if (key !== "portableDataRef" && key.endsWith("Ref") && typeof item === "string" && item.startsWith("project-asset-v2-")) {
          if (!IDB_KEY.test(item) || key.length <= 3) fail("MEDIA_NOT_PREPARED");
          const bindingEntry = bindings && Object.getOwnPropertyDescriptor(bindings, key.slice(0, -3));
          if (bindingEntry && !("value" in bindingEntry)) fail("INVALID_PROJECT_VALUE");
          const binding = bindingEntry?.value;
          const pathEntry = binding && typeof binding === "object" && Object.getOwnPropertyDescriptor(binding, "localPath");
          if (pathEntry && !("value" in pathEntry)) fail("INVALID_PROJECT_VALUE");
          if (pathEntry && typeof pathEntry.value === "string" && pathEntry.value) continue;
          const original = descriptors[key.slice(0, -3)];
          if (original && !("value" in original)) fail("INVALID_PROJECT_VALUE");
          add(item, original?.value);
        } else visit(item, depth + 1);
      }
    } finally { ancestors.delete(value); }
  }
  visit(input, 0);
  if (refs.size > 10000) fail("PROJECT_TOO_COMPLEX");
  if (!globalThis.crypto?.subtle || typeof globalThis.atob !== "function") fail("CLOUD_RANDOM_UNAVAILABLE");
  const result: PortableAsset[] = [];
  for (const [ref, currentValues] of refs) {
    const value = await storage.getItem(ref);
    if (typeof value !== "string") return fail("MEDIA_NOT_PREPARED");
    if (currentValues.some((current) => current !== value)) fail("STALE_MEDIA_BINDING");
    if (value.length > Math.ceil(MAX_BYTES / 3) * 4) {
      const hash = incrementalSha256.create();
      const info = await decodePortableDataChunks(value, async bytes => { hash.update(bytes); });
      const digest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
      result.push({ ref, mime: info.mime, size: info.size, dataUrl: value, sha256: digest });
      continue;
    }
    const match = DATA_URL.exec(value);
    if (!match || match[2].length % 4 !== 0 || match[2].length > Math.ceil(MAX_BYTES / 3) * 4) fail("MEDIA_NOT_PREPARED");
    let binary: string;
    try { binary = globalThis.atob(match[2]); } catch { return fail("MEDIA_NOT_PREPARED"); }
    if (!binary.length || binary.length > MAX_BYTES || globalThis.btoa(binary) !== match[2]) fail("MEDIA_NOT_PREPARED");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const sha256 = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
    result.push({ ref, mime: match[1].toLowerCase(), bytes, size: bytes.length, sha256 });
  }
  return result;
}

/** Convert references only after their bytes have been collected and checked. */
export function preparePortableReferences(input: unknown, assets: PortableAsset[]): unknown {
  const copy: any = structuredClone(input);
  const byRef = new Map(assets.map(asset => [asset.ref, asset]));
  const used = new Set<string>();
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "cloudPortableBindings")) fail("CLOUD_MEDIA_FIELD_CONFLICT");
    const bindings = value.projectAssetBindings;
    if (bindings && typeof bindings === "object" && !Array.isArray(bindings)) {
      const metadata: Record<string, Record<string, string>> = Object.create(null);
      for (const [field, binding] of Object.entries(bindings) as [string, any][]) {
        if (binding?.localPath) continue;
        if (!BINDING_FIELD.test(field) || ["constructor", "prototype", "__proto__"].includes(field)) fail("INVALID_MEDIA_FIELD");
        const asset = byRef.get(binding?.portableDataRef);
        if (!asset) fail("MEDIA_NOT_PREPARED");
        const refKey = `${field}Ref`;
        if (value[refKey] != null && value[refKey] !== asset.ref) fail("STALE_MEDIA_BINDING");
        const attributes: Record<string, string> = Object.create(null);
        for (const name of BINDING_FIELDS) {
          const attribute = binding[name];
          if (attribute == null) continue;
          if (!validBindingAttribute(name, attribute)) fail("INVALID_MEDIA_METADATA");
          attributes[name] = attribute;
        }
        metadata[field] = attributes;
        value[refKey] = `starcanvas-cloud-portable:${asset.sha256}:${asset.mime}`;
        delete value[field];
        delete bindings[field];
        used.add(asset.ref);
      }
      if (Object.keys(metadata).length) value.cloudPortableBindings = metadata;
      if (!Object.keys(bindings).length) delete value.projectAssetBindings;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith("Ref") && typeof item === "string") {
        if (item.startsWith("starcanvas-cloud-portable:")) {
          const field = key.slice(0, -3);
          if (!Object.hasOwn(value.cloudPortableBindings || {}, field)) fail("CLOUD_MEDIA_FIELD_CONFLICT");
          continue;
        }
        const binding = value.projectAssetBindings?.[key.slice(0, -3)];
        if (binding && typeof binding.localPath === "string" && binding.localPath) continue;
        const asset = byRef.get(item);
        if (asset) {
          value[key] = `starcanvas-cloud-portable:${asset.sha256}:${asset.mime}`;
          delete value[key.slice(0, -3)];
          used.add(item);
          continue;
        }
      }
      visit(item);
    }
  }
  visit(copy);
  if (used.size !== byRef.size) fail("MEDIA_NOT_PREPARED");
  return copy;
}

export function cloudPortableReferences(input: unknown): { sha256: string; mime: string }[] {
  const refs = new Map<string, { sha256: string; mime: string }>();
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith("Ref") && typeof item === "string" && item.startsWith("starcanvas-cloud-portable:")) {
        const match = CLOUD_REF.exec(item);
        if (!match || match[2].length > 150 || key.length <= 3 || Object.hasOwn(value, key.slice(0, -3))) fail("INVALID_MEDIA_REFERENCE");
        refs.set(item, { sha256: match[1], mime: match[2] });
      } else visit(item);
    }
  }
  visit(input);
  return [...refs.values()];
}

/** Replace verified cloud references with fresh keys within the destination project. */
export function restorePortableReferences(input: unknown, newProjectId: string,
  values: Map<string, string>): { state: unknown; stored: Map<string, string> } {
  const copy: any = structuredClone(input), refs = cloudPortableReferences(copy);
  const replacement = new Map<string, string>(), stored = new Map<string, string>();
  for (const [index, ref] of refs.entries()) {
    const marker = `starcanvas-cloud-portable:${ref.sha256}:${ref.mime}`;
    const value = values.get(marker);
    if (typeof value !== "string" || !value.startsWith(`data:${ref.mime};base64,`)) fail("MEDIA_NOT_DOWNLOADED");
    const key = `project-asset-v2-${newProjectId}-${index}-${ref.sha256}`;
    replacement.set(marker, key); stored.set(key, value);
  }
  function visit(value: any) {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "cloudPortableBindings")) {
      const cloud = value.cloudPortableBindings;
      if (!cloud || typeof cloud !== "object" || Array.isArray(cloud)) fail("INVALID_MEDIA_REFERENCE");
      const bindings = value.projectAssetBindings || Object.create(null);
      if (typeof bindings !== "object" || Array.isArray(bindings)) fail("INVALID_MEDIA_REFERENCE");
      for (const [field, metadata] of Object.entries(cloud) as [string, any][]) {
        if (!BINDING_FIELD.test(field) || ["constructor", "prototype", "__proto__"].includes(field) ||
            Object.hasOwn(bindings, field) || !metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
            Object.keys(metadata).some(name => !BINDING_FIELDS.has(name)) ||
            Object.entries(metadata).some(([name, attribute]) => !validBindingAttribute(name, attribute))) fail("INVALID_MEDIA_REFERENCE");
        const marker = value[`${field}Ref`], ref = replacement.get(marker);
        if (!ref || Object.hasOwn(value, field)) fail("INVALID_MEDIA_REFERENCE");
        bindings[field] = { ...metadata, field, portableDataRef: ref, valueFormat: "data-url" };
      }
      value.projectAssetBindings = bindings;
      delete value.cloudPortableBindings;
    }
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith("Ref") && typeof item === "string" && replacement.has(item)) value[key] = replacement.get(item);
      else visit(item);
    }
  }
  visit(copy);
  return { state: copy, stored };
}
