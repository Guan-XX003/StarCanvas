/** Incremental decoding for legacy IndexedDB data URLs. Not yet wired to IPC.
 * Callers must abort their private staging handle if decoding or upload fails.
 */
import { CloudProjectSafetyError } from "./cloud-project-safety";
import { sha256 as incrementalSha256 } from "@noble/hashes/sha256";

const PREFIX = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i;
const CHUNK_BASE64 = 4 * Math.floor((1024 * 1024) / 3);
// The legacy representation is one JavaScript data-URL string. V8's string
// ceiling is near 512 MiB of characters, so cap raw bytes below 384 MiB;
// file-backed media uses its separate streaming path and is not subject to it.
export const MAX_PORTABLE_DATA_BYTES = 384 * 1024 ** 2 - 4096;
const MAX_BYTES = MAX_PORTABLE_DATA_BYTES;
function fail(): never { throw new CloudProjectSafetyError("MEDIA_NOT_PREPARED"); }

export async function decodePortableDataChunks(value: unknown,
  write: (bytes: Uint8Array, offset: number) => Promise<void>,
  maxBytes = MAX_BYTES): Promise<{ mime: string; size: number }> {
  if (typeof value !== "string" || typeof write !== "function" || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) return fail();
  const match = PREFIX.exec(value);
  if (!match || match[1].length > 150 || typeof globalThis.atob !== "function" || typeof globalThis.btoa !== "function") return fail();
  const start = match[0].length, length = value.length - start;
  if (length < 4 || length % 4 !== 0) return fail();
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = length / 4 * 3 - padding;
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) return fail();
  let offset = 0, processedChunks = 0;
  for (let cursor = start; cursor < value.length; cursor += CHUNK_BASE64) {
    const piece = value.slice(cursor, Math.min(cursor + CHUNK_BASE64, value.length));
    const last = cursor + piece.length === value.length;
    if (!/^[a-z0-9+/]*={0,2}$/i.test(piece) || (!last && piece.includes("="))) return fail();
    let binary: string;
    try { binary = globalThis.atob(piece); } catch { return fail(); }
    if (globalThis.btoa(binary) !== piece) return fail();
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!bytes.length || offset + bytes.length > size) return fail();
    await write(bytes, offset);
    offset += bytes.length;
    if (++processedChunks % 2 === 0 && offset < size) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (offset !== size) return fail();
  return { mime: match[1].toLowerCase(), size };
}

/** Rebuild the legacy IndexedDB representation from independently verified
 * bounded chunks. Byte groups remain aligned across IPC chunk boundaries. */
export async function encodePortableDataChunks(size: number, mime: string, expectedSha256: string,
  read: (offset: number) => Promise<{ bytes: Uint8Array; offset: number }>): Promise<string> {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || typeof mime !== "string" || mime.length > 150 ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) || !/^[a-f0-9]{64}$/.test(expectedSha256) ||
      typeof read !== "function" || typeof globalThis.btoa !== "function") return fail();
  const hash = incrementalSha256.create(), parts: string[] = [];
  let offset = 0, processedChunks = 0, carry = new Uint8Array(0);
  while (offset < size) {
    const next = await read(offset);
    if (!(next?.bytes instanceof Uint8Array) || next.bytes.length < 1 || next.bytes.length > 1024 * 1024 ||
        next.offset !== offset + next.bytes.length || next.offset > size) return fail();
    hash.update(next.bytes);
    const joined = new Uint8Array(carry.length + next.bytes.length);
    joined.set(carry); joined.set(next.bytes, carry.length);
    const aligned = joined.length - joined.length % 3;
    for (let index = 0; index < aligned; index += 24576) {
      const slice = joined.subarray(index, Math.min(index + 24576, aligned));
      parts.push(globalThis.btoa(Array.from(slice, byte => String.fromCharCode(byte)).join("")));
    }
    carry = joined.slice(aligned);
    offset = next.offset;
    if (++processedChunks % 2 === 0 && offset < size) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (carry.length) parts.push(globalThis.btoa(Array.from(carry, byte => String.fromCharCode(byte)).join("")));
  const actual = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) return fail();
  return `data:${mime.toLowerCase()};base64,${parts.join("")}`;
}
