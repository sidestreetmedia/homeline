import type { Config } from '../lib/config';
import { b64decode } from '../lib/bytes';

/** Telnyx Numbers, Messaging and TeXML support over the documented v2 REST API. */
const API_BASE = 'https://api.telnyx.com/v2';

export interface AvailableNumber {
  phone: string;
  friendly: string;
  locality: string | null;
  region: string | null;
}

/** PHP http_build_query-compatible encoding (RFC 3986), e.g. filter[features][0]=voice */
export function phpQuery(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') out.push(...phpQuery(value as Record<string, unknown>, name));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Telnyx {
  constructor(private readonly config: Config) {}

  private async api(method: string, path: string, query?: Record<string, unknown>, payload?: unknown): Promise<any> {
    let url = API_BASE + path;
    if (query) url += `?${phpQuery(query).join('&')}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.require('TELNYX_API_KEY')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const detail = json?.errors?.[0]?.detail ?? json?.errors?.[0]?.title ?? 'Telnyx request failed';
      throw new Error(`${detail} (HTTP ${res.status})`);
    }
    return json;
  }

  /** Search US local inventory by area code, requiring both voice and SMS. */
  async searchLocal(areaCode: string, limit = 10): Promise<AvailableNumber[]> {
    const result = await this.api('GET', '/available_phone_numbers', {
      filter: {
        country_code: 'US',
        national_destination_code: areaCode,
        phone_number_type: 'local',
        features: ['voice', 'sms'],
        limit: Math.max(1, Math.min(limit, 50)),
        best_effort: 'false',
      },
    });
    const out: AvailableNumber[] = [];
    for (const number of result.data ?? []) {
      const phone = String(number.phone_number ?? '');
      if (!phone) continue;
      let locality: string | null = null;
      let region: string | null = null;
      for (const info of number.region_information ?? []) {
        const type = String(info.region_type ?? '');
        const name = String(info.region_name ?? '');
        if (!name) continue;
        if (['rate_center', 'locality', 'city'].includes(type)) locality = locality || name;
        if (['state', 'administrative_area'].includes(type)) region = region || name;
      }
      out.push({ phone, friendly: formatPhone(phone), locality, region });
    }
    return out;
  }

  /** Order a number attached to the configured TeXML application and messaging profile. */
  async purchase(phoneE164: string): Promise<{ numberId: string | null; orderId: string; phone: string }> {
    const result = await this.api('POST', '/number_orders', undefined, {
      phone_numbers: [{ phone_number: phoneE164 }],
      connection_id: this.config.require('TELNYX_TEXML_APP_ID'),
      messaging_profile_id: this.config.require('TELNYX_MESSAGING_PROFILE_ID'),
      customer_reference: `homeline:${phoneE164}`,
    });
    const orderId = String(result?.data?.id ?? '');
    if (!orderId) throw new Error('Telnyx accepted the request but did not return an order ID.');

    // US numbers normally appear immediately. If activation is still pending,
    // deletion resolves the resource ID from E.164 later.
    let numberId: string | null = null;
    for (let attempt = 0; attempt < 4 && numberId === null; attempt++) {
      if (attempt > 0) await sleep(350);
      numberId = await this.ownedNumberId(phoneE164).catch(() => null);
    }
    return { numberId, orderId, phone: phoneE164 };
  }

  async release(numberId: string | null, phoneE164: string): Promise<void> {
    const id = numberId || (await this.ownedNumberId(phoneE164));
    if (!id) throw new Error(`Could not resolve Telnyx number ${phoneE164} for release.`);
    await this.api('DELETE', `/phone_numbers/${encodeURIComponent(id)}`);
  }

  async sendSms(to: string, from: string, body: string): Promise<string> {
    const result = await this.api('POST', '/messages', undefined, { to, from, text: body, type: 'SMS' });
    const id = String(result?.data?.id ?? '');
    if (!id) throw new Error('Telnyx did not return a message ID.');
    return id;
  }

  private async ownedNumberId(phoneE164: string): Promise<string | null> {
    const result = await this.api('GET', '/phone_numbers', { filter: { phone_number: phoneE164 }, page: { size: 1 } });
    const first = result?.data?.[0];
    return first?.id ? String(first.id) : null;
  }
}

/** Accepts a base64 raw key or a PEM/DER SubjectPublicKeyInfo; returns the 32 raw bytes. */
export function decodeEd25519PublicKey(value: string): Uint8Array | null {
  let v = value.trim();
  if (v.includes('BEGIN PUBLIC KEY')) {
    v = v.replace(/-----[^-]+-----|\s+/g, '');
    const der = b64decode(v);
    return der && der.length >= 32 ? der.slice(der.length - 32) : null;
  }
  const decoded = b64decode(v);
  return decoded && decoded.length === 32 ? decoded : null;
}

/**
 * Verify a Telnyx webhook: Ed25519 over "<timestamp>|<raw body>".
 * Fails closed when no public key is configured unless allowUnsigned is set (local dev).
 */
export async function verifyTelnyxWebhook(
  rawBody: string,
  headers: Headers,
  publicKey: string,
  allowUnsigned = false,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (publicKey.trim() === '') return allowUnsigned;
  const signature = headers.get('telnyx-signature-ed25519') ?? '';
  const timestamp = headers.get('telnyx-timestamp') ?? '';
  if (!signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - parseInt(timestamp, 10)) > 300) return false;
  const keyBytes = decodeEd25519PublicKey(publicKey);
  const sig = b64decode(signature);
  if (!keyBytes || !sig) return false;
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(`${timestamp}|${rawBody}`));
  } catch {
    return false;
  }
}
