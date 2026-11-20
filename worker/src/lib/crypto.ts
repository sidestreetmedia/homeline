import { b64decode, b64encode, hexDecode } from './bytes';

/**
 * AES-256-GCM for app_config values, byte-compatible with the PHP Crypto class.
 * Stored format: enc:v1:<base64( iv[12] | tag[16] | ciphertext )>
 * Values without the prefix are legacy plaintext and are returned as-is.
 */
const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Accepts base64 (32 bytes), 64 hex chars, or falls back to SHA-256 of a passphrase. */
export async function loadKey(raw: string | undefined): Promise<CryptoKey | null> {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  let bytes: Uint8Array | null = null;
  const decoded = /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? b64decode(value) : null;
  if (decoded && decoded.length === 32) {
    bytes = decoded;
  } else if (/^[0-9a-fA-F]{64}$/.test(value)) {
    bytes = hexDecode(value);
  } else {
    bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey | null, plaintext: string): Promise<string> {
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 }, key, new TextEncoder().encode(plaintext)),
  );
  // WebCrypto returns ciphertext|tag; the stored layout is iv|tag|ciphertext.
  const ct = sealed.subarray(0, sealed.length - TAG_LEN);
  const tag = sealed.subarray(sealed.length - TAG_LEN);
  const blob = new Uint8Array(IV_LEN + TAG_LEN + ct.length);
  blob.set(iv, 0);
  blob.set(tag, IV_LEN);
  blob.set(ct, IV_LEN + TAG_LEN);
  return PREFIX + b64encode(blob);
}

export async function decrypt(key: CryptoKey | null, stored: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  if (!key) throw new Error('Encrypted config present but CONFIG_ENCRYPTION_KEY is not set.');
  const blob = b64decode(stored.slice(PREFIX.length));
  if (!blob || blob.length < IV_LEN + TAG_LEN) throw new Error('Corrupt encrypted config value.');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const sealed = new Uint8Array(ct.length + TAG_LEN);
  sealed.set(ct, 0);
  sealed.set(tag, ct.length);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_LEN * 8 }, key, sealed);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Config decryption failed (wrong CONFIG_ENCRYPTION_KEY or tampered data).');
  }
}
