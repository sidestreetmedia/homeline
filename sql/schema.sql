-- HomeLine — multi-tenant realtor audio-listing platform
-- MySQL 8.0+ schema

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- Agents (tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email                   VARCHAR(255)    NOT NULL,
    password_hash           VARCHAR(255)    NOT NULL,
    full_name               VARCHAR(255)    NOT NULL,
    phone                   VARCHAR(32)     NULL,
    company                 VARCHAR(255)    NULL,
    stripe_customer_id      VARCHAR(64)     NULL,
    stripe_subscription_id  VARCHAR(64)     NULL,
    stripe_item_id          VARCHAR(64)     NULL,   -- the per-house subscription item
    stripe_payment_method_id VARCHAR(64)    NULL,   -- saved card set as default
    has_payment_method      TINYINT(1)      NOT NULL DEFAULT 0,
    status                  ENUM('active','suspended','pending') NOT NULL DEFAULT 'pending',
    is_god                  TINYINT(1)      NOT NULL DEFAULT 0,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_agents_email (email),
    KEY idx_agents_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Listings (one Twilio number per listing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    agent_id            BIGINT UNSIGNED NOT NULL,

    -- Address (listings are grouped/sorted by address under each agent)
    address_line1       VARCHAR(255)    NOT NULL,
    address_line2       VARCHAR(255)    NULL,
    city                VARCHAR(128)    NOT NULL,
    state               VARCHAR(32)     NOT NULL,
    postal_code         VARCHAR(16)     NOT NULL,

    -- Content
    description_text    TEXT            NULL,           -- source text for TTS
    sms_blurb           VARCHAR(320)    NOT NULL,        -- character-limited press-1 message
    audio_source        ENUM('tts','upload') NOT NULL DEFAULT 'tts',
    audio_s3_key        VARCHAR(512)    NULL,            -- cached audio in S3
    audio_status        ENUM('pending','ready','failed') NOT NULL DEFAULT 'pending',

    -- Telephony
    twilio_number       VARCHAR(32)     NULL,            -- E.164
    twilio_number_sid   VARCHAR(64)     NULL,

    -- Billing lifecycle
    billing_state       ENUM('active','cancel_pending','ended') NOT NULL DEFAULT 'active',
    first_charge_id     VARCHAR(64)     NULL,            -- out-of-band first-month invoice/PI
    skip_next_recurring TINYINT(1)      NOT NULL DEFAULT 0, -- grace: skip the first recurring renewal
    active_until        DATE            NULL,            -- paid-through; stays live until this date
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_listings_agent (agent_id),
    KEY idx_listings_number (twilio_number),
    KEY idx_listings_addr (agent_id, state, city, address_line1),
    KEY idx_listings_billing (billing_state, active_until),
    CONSTRAINT fk_listings_agent FOREIGN KEY (agent_id)
        REFERENCES agents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Call log (analytics + press-1 audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_events (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    listing_id      BIGINT UNSIGNED NULL,
    twilio_number   VARCHAR(32)     NULL,
    caller_number   VARCHAR(32)     NULL,
    event_type      ENUM('call','press1_sms') NOT NULL DEFAULT 'call',
    call_sid        VARCHAR(64)     NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_call_listing (listing_id),
    KEY idx_call_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- App configuration / secrets editable from god-mode (overrides .env)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
    config_key   VARCHAR(64)  NOT NULL,
    config_value TEXT         NULL,
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sessions (DB-backed so it works across container restarts / multiple FPM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id          VARCHAR(128) NOT NULL,
    agent_id    BIGINT UNSIGNED NULL,
    payload     MEDIUMTEXT   NOT NULL,
    last_active INT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY idx_sessions_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Job queue (cron-drained: TTS generation, number release, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    job_type      VARCHAR(48)  NOT NULL,
    payload       JSON         NOT NULL,
    status        ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
    attempts      INT UNSIGNED NOT NULL DEFAULT 0,
    last_error    TEXT         NULL,
    run_after     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_jobs_poll (status, run_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
