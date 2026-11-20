import { hexEncode, timingSafeEqual } from '../lib/bytes';

/**
 * Minimal Stripe REST client. The API version is pinned to the one the PHP SDK
 * (stripe-php 15.x) used, so objects keep the same shape the app was built on.
 */
const API_BASE = 'https://api.stripe.com/v1';
const API_VERSION = '2024-06-20';

export class StripeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Encode nested params the way Stripe expects: a[b][0][c]=v */
export function encodeForm(params: Params, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encodeForm(item as Params, `${name}[${i}]`));
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === 'object') {
      out.push(...encodeForm(value as Params, name));
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

export class Stripe {
  constructor(private readonly secretKey: string) {}

  async request<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Stripe-Version': API_VERSION,
    };
    let url = API_BASE + path;
    let body: string | undefined;
    const encoded = params ? encodeForm(params).join('&') : '';
    if (method !== 'POST') {
      if (encoded) url += `?${encoded}`;
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = encoded;
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(url, { method, headers, body });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new StripeError(json?.error?.message ?? `Stripe request failed (HTTP ${res.status})`, res.status, json?.error?.code);
    }
    return json as T;
  }

  get<T = any>(path: string, params?: Params) {
    return this.request<T>('GET', path, params);
  }

  del<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }

  post<T = any>(path: string, params?: Params, idempotencyKey?: string) {
    return this.request<T>('POST', path, params ?? {}, idempotencyKey);
  }
}

/** Verify a Stripe-Signature header (t=...,v1=...) over the raw body. */
export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 't') timestamp = v ?? '';
    if (k === 'v1' && v) signatures.push(v);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = hexEncode(new Uint8Array(mac));
  return signatures.some((sig) => timingSafeEqual(sig, expected));
}
