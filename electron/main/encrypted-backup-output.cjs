// Validate the renderer-produced envelope before the save IPC touches disk.
// The main process never receives the backup password or the plaintext JSON.
const FORMAT = 'starcanvas-encrypted-backup';
const MAX_CIPHERTEXT = 64 * 1024 * 1024 + 16;
const KEYS = 'cipher,ciphertext,format,iterations,iv,kdf,salt,version';

function isCanonicalBase64(value, min, max) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length >= min && decoded.length <= max && decoded.toString('base64') === value;
}

function isEncryptedBackupOutput(text) {
  if (typeof text !== 'string' || text.length > Math.ceil(MAX_CIPHERTEXT / 3) * 4 + 4096) return false;
  try {
    const item = JSON.parse(text);
    return !!item && typeof item === 'object' && !Array.isArray(item)
      && Object.keys(item).sort().join(',') === KEYS
      && item.format === FORMAT && item.version === 1 && item.kdf === 'PBKDF2-SHA256'
      && item.iterations === 600000 && item.cipher === 'AES-256-GCM'
      && isCanonicalBase64(item.salt, 16, 16) && isCanonicalBase64(item.iv, 12, 12)
      && isCanonicalBase64(item.ciphertext, 17, MAX_CIPHERTEXT);
  } catch { return false; }
}

module.exports = {isEncryptedBackupOutput};
