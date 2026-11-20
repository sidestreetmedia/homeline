-- HomeLine on Cloudflare D1 (SQLite). Idempotent: safe to re-run.
-- Sessions live in KV and background jobs in Queues, so the MySQL `sessions`
-- and `jobs` tables have no equivalent here.

CREATE TABLE IF NOT EXISTS agents (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    email                    TEXT NOT NULL UNIQUE,
    password_hash            TEXT NOT NULL,
    full_name                TEXT NOT NULL,
    phone                    TEXT,
    company                  TEXT,
    stripe_customer_id       TEXT,
    stripe_subscription_id   TEXT,
    stripe_item_id           TEXT,
    stripe_payment_method_id TEXT,
    has_payment_method       INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active','suspended','pending')),
    billing_status           TEXT NOT NULL DEFAULT 'ok' CHECK (billing_status IN ('ok','past_due')),
    is_god                   INTEGER NOT NULL DEFAULT 0,
    session_epoch            INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_customer ON agents (stripe_customer_id);

CREATE TABLE IF NOT EXISTS listings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id            INTEGER NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    address_line1       TEXT NOT NULL,
    address_line2       TEXT,
    city                TEXT NOT NULL,
    state               TEXT NOT NULL,
    postal_code         TEXT NOT NULL,
    description_text    TEXT,
    sms_blurb           TEXT NOT NULL,
    audio_source        TEXT NOT NULL DEFAULT 'tts' CHECK (audio_source IN ('tts','upload')),
    audio_s3_key        TEXT,
    audio_status        TEXT NOT NULL DEFAULT 'pending' CHECK (audio_status IN ('pending','ready','failed')),
    phone_number        TEXT,
    telnyx_number_id    TEXT,
    telnyx_order_id     TEXT,
    billing_state       TEXT NOT NULL DEFAULT 'active' CHECK (billing_state IN ('provisioning','active','cancel_pending','ended')),
    first_charge_id     TEXT,
    skip_next_recurring INTEGER NOT NULL DEFAULT 0,
    active_until        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings (agent_id);
CREATE INDEX IF NOT EXISTS idx_listings_number ON listings (phone_number);
CREATE INDEX IF NOT EXISTS idx_listings_addr ON listings (agent_id, state, city, address_line1);
CREATE INDEX IF NOT EXISTS idx_listings_billing ON listings (billing_state, active_until);

CREATE TABLE IF NOT EXISTS call_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id      INTEGER,
    phone_number    TEXT,
    caller_number   TEXT,
    event_type      TEXT NOT NULL DEFAULT 'call' CHECK (event_type IN ('call','press1_sms')),
    call_control_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_listing ON call_events (listing_id);
CREATE INDEX IF NOT EXISTS idx_call_created ON call_events (created_at);

CREATE TABLE IF NOT EXISTS app_config (
    config_key   TEXT PRIMARY KEY,
    config_value TEXT,
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
