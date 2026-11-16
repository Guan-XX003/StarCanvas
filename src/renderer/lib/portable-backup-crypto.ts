/** Password-encrypted JSON envelope for portable backups. External media and
 * filenames are not covered by this envelope and must be disclosed as such. */
const FORMAT = "starcanvas-encrypted-backup";
const VERSION = 1;
const ITERATIONS = 600_000;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_PASSWORD_BYTES = 1024;
const AAD = new TextEncoder().encode(`${FORMAT}:v${VERSION}:PBKDF2-SHA256:${ITERATIONS}:AES-256-GCM`);
const failure = (code:string) => Object.assign(new Error(code), {code});

export type PortableBackupEnvelope = {
  format: typeof FORMAT;
  version: typeof VERSION;
  kdf: "PBKDF2-SHA256";
  iterations: typeof ITERATIONS;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes:Uint8Array):string {
  const pieces:string[] = [];
  for (let i=0; i<bytes.length; i+=0x8000) pieces.push(String.fromCharCode(...bytes.subarray(i,i+0x8000)));
  return btoa(pieces.join(""));
}
function fromBase64(value:unknown, minBytes:number, maxBytes:number):Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 !== 0
    || /[^A-Za-z0-9+/=]/.test(value) || value.slice(0,-2).includes("=") || /={3,}$/.test(value)) throw failure("BACKUP_ENVELOPE_INVALID");
  let binary:string;
  try { binary = atob(value); } catch { throw failure("BACKUP_ENVELOPE_INVALID"); }
  if (binary.length < minBytes || binary.length > maxBytes || btoa(binary) !== value) throw failure("BACKUP_ENVELOPE_INVALID");
  const bytes = new Uint8Array(binary.length);
  for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function passwordBytes(password:unknown, creating:boolean):Uint8Array<ArrayBuffer> {
  if (typeof password !== "string" || !password || (creating && password.trim().length < 12)) throw failure("BACKUP_PASSWORD_INVALID");
  const bytes = new TextEncoder().encode(password);
  if (bytes.length > MAX_PASSWORD_BYTES) throw failure("BACKUP_PASSWORD_INVALID");
  return bytes;
}
async function deriveKey(password:Uint8Array<ArrayBuffer>, salt:Uint8Array<ArrayBuffer>, usage:KeyUsage):Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS}, material, {name:"AES-GCM",length:256}, false, [usage]);
}
function record(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
/** Detect an envelope without attempting decryption. This is not validation. */
export function isEncryptedPortableBackup(value:unknown):boolean {
  return record(value) && value.format === FORMAT;
}
/** No plaintext fallback; failures return fixed codes rather than user content. */
export async function encryptPortableBackup(value:unknown, password:unknown):Promise<PortableBackupEnvelope> {
  if (!record(value)) throw failure("BACKUP_CONTENT_INVALID");
  const pass = passwordBytes(password,true);
  let plaintext:Uint8Array<ArrayBuffer>|undefined;
  try {
    let serialized:string;
    try { serialized = JSON.stringify(value); } catch { throw failure("BACKUP_CONTENT_INVALID"); }
    if (typeof serialized !== "string") throw failure("BACKUP_CONTENT_INVALID");
    if (serialized.length > MAX_JSON_BYTES) throw failure("BACKUP_CONTENT_TOO_LARGE");
    try { if (!record(JSON.parse(serialized))) throw failure("BACKUP_CONTENT_INVALID"); } catch { throw failure("BACKUP_CONTENT_INVALID"); }
    plaintext = new TextEncoder().encode(serialized);
    if (!plaintext.length || plaintext.length > MAX_JSON_BYTES) throw failure("BACKUP_CONTENT_TOO_LARGE");
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(pass,salt,"encrypt");
      const ciphertext = await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:AAD,tagLength:128},key,plaintext);
      return {format:FORMAT,version:VERSION,kdf:"PBKDF2-SHA256",iterations:ITERATIONS,cipher:"AES-256-GCM",salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))};
    } catch { throw failure("BACKUP_ENCRYPT_FAILED"); }
  } finally { pass.fill(0); plaintext?.fill(0); }
}
/** Validate all resource limits before the expensive password derivation. */
export async function decryptPortableBackup(value:unknown, password:unknown):Promise<Record<string,unknown>> {
  if (!record(value) || Object.keys(value).sort().join(",") !== "cipher,ciphertext,format,iterations,iv,kdf,salt,version"
    || value.format !== FORMAT || value.version !== VERSION || value.kdf !== "PBKDF2-SHA256" || value.iterations !== ITERATIONS || value.cipher !== "AES-256-GCM") throw failure("BACKUP_ENVELOPE_INVALID");
  const salt=fromBase64(value.salt,16,16), iv=fromBase64(value.iv,12,12), ciphertext=fromBase64(value.ciphertext,17,MAX_JSON_BYTES+16);
  const pass = passwordBytes(password,false);
  let plaintext:Uint8Array<ArrayBuffer>|undefined;
  try {
    const key = await deriveKey(pass,salt,"decrypt");
    plaintext = new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:AAD,tagLength:128},key,ciphertext));
    const decoded = new TextDecoder("utf-8",{fatal:true}).decode(plaintext);
    const result = JSON.parse(decoded);
    if (!record(result)) throw failure("BACKUP_DECRYPT_FAILED");
    return result;
  } catch { throw failure("BACKUP_DECRYPT_FAILED"); }
  finally { pass.fill(0); plaintext?.fill(0); }
}
