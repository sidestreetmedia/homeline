import type { Job } from './services/jobs';

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;
  /** 32-byte master key (base64 or 64 hex chars) for app_config values. Secret. */
  CONFIG_ENCRYPTION_KEY?: string;
  /** One-time token that unlocks /setup to create the first God account. Secret. */
  SETUP_TOKEN?: string;
  /** Set to "1" only for local development without webhook signing keys. */
  ALLOW_UNSIGNED_WEBHOOKS?: string;
  /** Portal keys may also be supplied as vars/secrets; database values win. */
  [key: string]: unknown;
}

export interface Agent {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  company: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_item_id: string | null;
  stripe_payment_method_id: string | null;
  has_payment_method: number;
  status: 'active' | 'suspended' | 'pending';
  billing_status: 'ok' | 'past_due';
  is_god: number;
  session_epoch: number;
  created_at: string;
  updated_at: string;
}

export interface Listing {
  id: number;
  agent_id: number;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  description_text: string | null;
  sms_blurb: string;
  audio_source: 'tts' | 'upload';
  audio_s3_key: string | null;
  audio_status: 'pending' | 'ready' | 'failed';
  phone_number: string | null;
  telnyx_number_id: string | null;
  telnyx_order_id: string | null;
  billing_state: 'provisioning' | 'active' | 'cancel_pending' | 'ended';
  first_charge_id: string | null;
  skip_next_recurring: number;
  active_until: string | null;
  deleted_at: string | null;
}
