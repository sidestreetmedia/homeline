import { b64decode, b64encode, timingSafeEqual } from './bytes';

/**
 * PBKDF2-SHA256 via WebCrypto (native, so it stays inside Worker CPU limits).
 * Format: pbkdf2$<iterations>$<salt b64>$<hash b64>
 */
const ITERATIONS = 100_000; // the Workers runtime caps PBKDF2 at 100k iterations

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = b64decode(parts[2]);
  if (!salt || !Number.isFinite(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  const hash = await derive(password, salt, iterations);
  return timingSafeEqual(b64encode(hash), parts[3]);
}
