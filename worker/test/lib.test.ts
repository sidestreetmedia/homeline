import { createCipheriv, createDecipheriv, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, loadKey } from '../src/lib/crypto';
import { firstOfNextMonth, graceFor, longDateTime } from '../src/lib/dates';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { encodeForm, verifyStripeSignature } from '../src/services/stripe';
import { decodeEd25519PublicKey, formatPhone, phpQuery, verifyTelnyxWebhook } from '../src/services/telnyx';
import { hangupResponse, listingResponse } from '../src/services/texml';

describe('config encryption (PHP Crypto compatibility)', () => {
  const rawKey = randomBytes(32);

  // Mirrors PHP: 'enc:v1:' . base64(iv . tag . openssl_encrypt(..., 'aes-256-gcm'))
  function phpEncrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', rawKey, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return 'enc:v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }
  function phpDecrypt(stored: string): string {
    const blob = Buffer.from(stored.slice(7), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', rawKey, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
  }

  it('reads values written in the PHP layout', async () => {
    const key = await loadKey(rawKey.toString('base64'));
    expect(await decrypt(key, phpEncrypt('sk_live_abc123 – ünïcode'))).toBe('sk_live_abc123 – ünïcode');
  });

  it('writes values the PHP layout can read', async () => {
    const key = await loadKey(rawKey.toString('hex'));
    const stored = await encrypt(key, 'whsec_secret');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(phpDecrypt(stored)).toBe('whsec_secret');
  });

  it('passes legacy plaintext through and rejects tampering', async () => {
    const key = await loadKey(rawKey.toString('base64'));
    expect(await decrypt(key, 'plain-value')).toBe('plain-value');
    const stored = await encrypt(key, 'value');
    const tampered = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decrypt(key, tampered)).rejects.toThrow();
    await expect(decrypt(null, stored)).rejects.toThrow(/CONFIG_ENCRYPTION_KEY/);
  });

  it('stores plaintext when no key is configured', async () => {
    expect(await encrypt(await loadKey(''), 'value')).toBe('value');
  });
});

describe('billing dates', () => {
  it('anchors to the 1st of next month in UTC', () => {
    expect(firstOfNextMonth(new Date('2026-11-20T13:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(firstOfNextMonth(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('mid-month: no grace, paid through the next 1st', () => {
    expect(graceFor(new Date('2026-11-20T13:00:00Z'))).toEqual({ withinGrace: false, activeUntil: '2026-12-01' });
  });

  it('within 4 days of the 1st: grace, paid through the following 1st', () => {
    expect(graceFor(new Date('2026-11-27T00:00:00Z'))).toEqual({ withinGrace: true, activeUntil: '2027-01-01' });
    expect(graceFor(new Date('2026-11-30T23:00:00Z'))).toEqual({ withinGrace: true, activeUntil: '2027-01-01' });
    expect(graceFor(new Date('2026-12-29T12:00:00Z'))).toEqual({ withinGrace: true, activeUntil: '2027-02-01' });
  });

  it('just outside the window: no grace', () => {
    expect(graceFor(new Date('2026-11-25T23:59:59Z')).withinGrace).toBe(false);
  });

  it('formats notification timestamps', () => {
    expect(longDateTime(new Date('2026-11-20T13:05:00Z'))).toBe('November 20, 2026 at 1:05 PM');
    expect(longDateTime(new Date('2026-01-02T00:09:00Z'))).toBe('January 2, 2026 at 12:09 AM');
  });
});

describe('passwords', () => {
  it('round-trips and rejects wrong or malformed input', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(false);
  });
});

describe('stripe', () => {
  it('encodes nested params', () => {
    const encoded = encodeForm({
      customer: 'cus_1',
      items: [{ price: 'price_1', quantity: 0 }],
      payment_method_types: ['card'],
      metadata: { agent_id: '7' },
      off_session: true,
      skip: undefined,
    }).map(decodeURIComponent);
    expect(encoded).toEqual([
      'customer=cus_1',
      'items[0][price]=price_1',
      'items[0][quantity]=0',
      'payment_method_types[0]=card',
      'metadata[agent_id]=7',
      'off_session=true',
    ]);
  });

  it('verifies webhook signatures', async () => {
    const secret = 'whsec_test';
    const body = '{"type":"invoice.paid"}';
    const t = 1_800_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(await verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 10)).toBe(true);
    expect(await verifyStripeSignature(body + ' ', `t=${t},v1=${v1}`, secret, t + 10)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${t},v1=${v1}`, 'whsec_other', t + 10)).toBe(false);
    expect(await verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 1000)).toBe(false);
    expect(await verifyStripeSignature(body, 'garbage', secret, t)).toBe(false);
  });
});

describe('telnyx', () => {
  it('builds queries like PHP http_build_query', () => {
    const q = phpQuery({ filter: { country_code: 'US', features: ['voice', 'sms'], limit: 10 }, page: { size: 1 } }).map(decodeURIComponent);
    expect(q).toEqual(['filter[country_code]=US', 'filter[features][0]=voice', 'filter[features][1]=sms', 'filter[limit]=10', 'page[size]=1']);
  });

  it('formats US numbers', () => {
    expect(formatPhone('+18645551234')).toBe('(864) 555-1234');
    expect(formatPhone('+442071234567')).toBe('+442071234567');
  });

  it('verifies Ed25519 webhook signatures and fails closed', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const rawB64 = Buffer.from(decodeEd25519PublicKey(pem)!).toString('base64');
    const body = 'To=%2B18645551234&From=%2B18645550000&CallSid=abc';
    const t = 1_800_000_000;
    const signature = sign(null, Buffer.from(`${t}|${body}`), privateKey).toString('base64');
    const headers = new Headers({ 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': String(t) });

    expect(await verifyTelnyxWebhook(body, headers, rawB64, false, t + 5)).toBe(true);
    expect(await verifyTelnyxWebhook(body, headers, pem, false, t + 5)).toBe(true);
    expect(await verifyTelnyxWebhook(body + 'x', headers, rawB64, false, t + 5)).toBe(false);
    expect(await verifyTelnyxWebhook(body, headers, rawB64, false, t + 900)).toBe(false);
    expect(await verifyTelnyxWebhook(body, new Headers(), rawB64, false, t)).toBe(false);
    expect(await verifyTelnyxWebhook(body, new Headers(), '', false, t)).toBe(false);
    expect(await verifyTelnyxWebhook(body, new Headers(), '', true, t)).toBe(true);
  });
});

describe('texml', () => {
  it('escapes presigned URLs and spoken text exactly once', () => {
    const out = listingResponse({ gatherAction: 'https://h.example/telnyx_gather?listing=5', audioUrl: 'https://s3.example/a.mp3?X-Amz-A=1&X-Amz-B=2', fallbackText: '' });
    expect(out).toContain('<Play>https://s3.example/a.mp3?X-Amz-A=1&amp;X-Amz-B=2</Play>');
    expect(out).toContain('action="https://h.example/telnyx_gather?listing=5"');
    expect(out).not.toContain('&amp;amp;');
    const spoken = listingResponse({ gatherAction: 'https://h.example/g', fallbackText: '3 beds & <2> baths' });
    expect(spoken).toContain('<Say voice="Polly.Joanna-Neural">3 beds &amp; &lt;2&gt; baths</Say>');
    expect(hangupResponse('Goodbye.')).toContain('<Say>Goodbye.</Say><Hangup/>');
  });
});
