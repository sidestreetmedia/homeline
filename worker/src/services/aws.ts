import { AwsClient } from 'aws4fetch';
import type { Config } from '../lib/config';

function s3Url(bucket: string, region: string, key: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/');
  // Dotted bucket names break virtual-host TLS, so those use path-style.
  return bucket.includes('.')
    ? `https://s3.${region}.amazonaws.com/${bucket}/${path}`
    : `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
}

/** Same S3 bucket and key layout as before: listings/<id>/... */
export class Storage {
  private readonly client: AwsClient;
  private readonly region: string;
  private readonly bucket: string;

  constructor(config: Config) {
    this.region = config.get('AWS_REGION', 'us-east-1');
    this.bucket = config.require('S3_BUCKET');
    this.client = new AwsClient({
      accessKeyId: config.require('AWS_ACCESS_KEY_ID'),
      secretAccessKey: config.require('AWS_SECRET_ACCESS_KEY'),
      service: 's3',
      region: this.region,
    });
  }

  async putAudio(key: string, bytes: ArrayBuffer | Uint8Array): Promise<string> {
    const res = await this.client.fetch(s3Url(this.bucket, this.region, key), {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: bytes,
    });
    if (!res.ok) throw new Error(`S3 put failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
    return key;
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(s3Url(this.bucket, this.region, key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed (HTTP ${res.status})`);
  }

  /** Presigned GET URL Telnyx fetches during a call. */
  async presignedUrl(key: string, ttlSeconds = 1200): Promise<string> {
    const url = new URL(s3Url(this.bucket, this.region, key));
    url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
    const signed = await this.client.sign(new Request(url, { method: 'GET' }), { aws: { signQuery: true } });
    return signed.url;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL_RE.test(value);

/** Plain-text notification email through Amazon SES (v2 API, same ses:SendEmail permission). */
export async function sendEmail(config: Config, to: string, subject: string, body: string): Promise<void> {
  if (!isEmail(to)) throw new Error('Notification recipient is not a valid email address.');
  const fromEmail = config.require('AWS_SES_FROM_EMAIL');
  if (!isEmail(fromEmail)) throw new Error('Configured notification sender is not a valid email address.');
  const fromName = config.get('AWS_SES_FROM_NAME', 'HomeLine').replace(/[\r\n"]+/g, ' ').trim();
  const region = config.require('AWS_SES_REGION');

  const payload: Record<string, unknown> = {
    FromEmailAddress: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Text: { Data: body, Charset: 'UTF-8' } },
      },
    },
  };
  const replyTo = config.get('AWS_SES_REPLY_TO_EMAIL').trim();
  if (replyTo) {
    if (!isEmail(replyTo)) throw new Error('Configured reply-to address is not a valid email address.');
    payload.ReplyToAddresses = [replyTo];
  }
  const configurationSet = config.get('AWS_SES_CONFIGURATION_SET').trim();
  if (configurationSet) payload.ConfigurationSetName = configurationSet;

  const client = new AwsClient({
    accessKeyId: config.require('AWS_SES_ACCESS_KEY_ID'),
    secretAccessKey: config.require('AWS_SES_SECRET_ACCESS_KEY'),
    sessionToken: config.get('AWS_SES_SESSION_TOKEN').trim() || undefined,
    service: 'ses',
    region,
  });
  const res = await client.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`SES send failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
}
