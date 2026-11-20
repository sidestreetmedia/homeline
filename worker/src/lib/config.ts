import type { Env } from '../env';
import { decrypt, encrypt, loadKey } from './crypto';

/**
 * Two tiers, as before:
 *  - Infrastructure (CONFIG_ENCRYPTION_KEY, SETUP_TOKEN, bindings) comes from the Worker environment only.
 *  - Application keys are managed in God Mode and stored encrypted in app_config.
 * Resolution order: app_config (D1) -> Worker var/secret -> default.
 */
export const REQUIRED_KEYS = [
  'APP_BASE_URL',
  'TELNYX_API_KEY',
  'TELNYX_TEXML_APP_ID',
  'TELNYX_MESSAGING_PROFILE_ID',
  'TELNYX_PUBLIC_KEY',
  'ELEVENLABS_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'AWS_SES_ACCESS_KEY_ID',
  'AWS_SES_SECRET_ACCESS_KEY',
  'AWS_SES_FROM_EMAIL',
] as const;

const ENV_ONLY_KEYS = new Set(['CONFIG_ENCRYPTION_KEY', 'SETUP_TOKEN', 'ALLOW_UNSIGNED_WEBHOOKS']);

export class ConfigMissingError extends Error {
  constructor(public readonly configKey: string) {
    super(`Missing required configuration: ${configKey}. Set it in God Mode under App keys & config.`);
  }
}

export class Config {
  private constructor(
    private readonly env: Env,
    private readonly key: CryptoKey | null,
    private readonly values: Map<string, string>,
  ) {}

  static async load(env: Env): Promise<Config> {
    const key = await loadKey(env.CONFIG_ENCRYPTION_KEY);
    const values = new Map<string, string>();
    try {
      const rows = await env.DB.prepare('SELECT config_key, config_value FROM app_config').all<{
        config_key: string;
        config_value: string | null;
      }>();
      for (const row of rows.results ?? []) {
        if (!row.config_value) continue;
        try {
          values.set(row.config_key, await decrypt(key, row.config_value));
        } catch (err) {
          // One undecryptable value must not break the app; it reads as unset.
          console.error(`Config decrypt failed for ${row.config_key}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      console.error(`Config load failed: ${(err as Error).message}`);
    }
    return new Config(env, key, values);
  }

  get encryptionAvailable(): boolean {
    return this.key !== null;
  }

  get(name: string, fallback = ''): string {
    if (!ENV_ONLY_KEYS.has(name)) {
      const stored = this.values.get(name);
      if (stored !== undefined && stored !== '') return stored;
    }
    const fromEnv = this.env[name];
    if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv;
    return fallback;
  }

  require(name: string): string {
    const value = this.get(name);
    if (value === '') throw new ConfigMissingError(name);
    return value;
  }

  isSet(name: string): boolean {
    return this.get(name) !== '';
  }

  missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.isSet(k));
  }

  async set(name: string, value: string): Promise<void> {
    const stored = await encrypt(this.key, value);
    await this.env.DB.prepare(
      `INSERT INTO app_config (config_key, config_value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = excluded.updated_at`,
    )
      .bind(name, stored)
      .run();
    this.values.set(name, value);
  }

  async clear(name: string): Promise<void> {
    await this.env.DB.prepare('DELETE FROM app_config WHERE config_key = ?').bind(name).run();
    this.values.delete(name);
  }

  baseUrl(requestUrl?: string): string {
    const configured = this.get('APP_BASE_URL').replace(/\/+$/, '');
    if (configured) return configured;
    return requestUrl ? new URL(requestUrl).origin : '';
  }

  priceCents(): number {
    const n = parseInt(this.get('PRICE_CENTS', '500'), 10);
    return Number.isFinite(n) && n > 0 ? n : 500;
  }
}
