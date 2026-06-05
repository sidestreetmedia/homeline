<?php
declare(strict_types=1);

/**
 * Config — two tiers:
 *
 *   1. INFRASTRUCTURE keys (DB connection, AUTO_MIGRATE, SEED_GOD) come from the
 *      environment ONLY. They must, because we can't read the database to learn
 *      how to connect to the database. These are set once at deploy time.
 *
 *   2. APPLICATION keys (Twilio, ElevenLabs, Stripe, AWS, APP_BASE_URL, etc.)
 *      are managed in the God-mode portal and stored in the `app_config` table.
 *      The portal is the authoritative source. Environment values for these are
 *      treated only as an optional one-time seed/fallback so a fresh deploy can
 *      boot, but operators are expected to manage them in the portal.
 *
 * Resolution order for any key: in-memory cache -> app_config (DB) -> environment
 * -> provided default. So a value set in the portal always wins over env.
 */
final class Config
{
    /** Keys that are managed in the God-mode portal (DB-backed, authoritative). */
    public const PORTAL_KEYS = [
        'APP_BASE_URL',
        'DISABLE_SSL',
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'ELEVENLABS_API_KEY',
        'ELEVENLABS_VOICE_ID',
        'ELEVENLABS_MODEL',
        'STRIPE_SECRET_KEY',
        'STRIPE_PRICE_ID',
        'STRIPE_WEBHOOK_SECRET',
        'PRICE_CENTS',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_REGION',
        'S3_BUCKET',
    ];

    /** Infrastructure keys that come from the environment ONLY (never the DB). */
    public const ENV_ONLY_KEYS = [
        'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS',
        'AUTO_MIGRATE', 'SEED_GOD', 'CONFIG_ENCRYPTION_KEY',
    ];

    private static array $cache = [];
    private static bool $loadedDb = false;

    public static function get(string $key, ?string $default = null): ?string
    {
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }

        // Infra keys: env only, never touch the DB.
        if (in_array($key, self::ENV_ONLY_KEYS, true)) {
            $env = getenv($key);
            return self::$cache[$key] = ($env === false ? $default : $env);
        }

        // App keys: DB (portal) first, then env as a fallback seed.
        if (!self::$loadedDb) {
            self::loadDbOverrides();
        }
        if (array_key_exists($key, self::$cache)) {
            return self::$cache[$key];
        }

        $env = getenv($key);
        return self::$cache[$key] = ($env === false ? $default : $env);
    }

    public static function require(string $key): string
    {
        $v = self::get($key);
        if ($v === null || $v === '') {
            throw new ConfigMissingException($key);
        }
        return $v;
    }

    /** True if a key currently has a non-empty value anywhere. */
    public static function isSet(string $key): bool
    {
        $v = self::get($key);
        return $v !== null && $v !== '';
    }

    /** Which portal keys are still missing a value. */
    public static function missingPortalKeys(): array
    {
        $missing = [];
        foreach (self::PORTAL_KEYS as $k) {
            if (!self::isSet($k)) {
                $missing[] = $k;
            }
        }
        return $missing;
    }

    private static function loadDbOverrides(): void
    {
        self::$loadedDb = true;
        try {
            $pdo = DB::pdo();
            $rows = $pdo->query("SELECT config_key, config_value FROM app_config")->fetchAll();
            foreach ($rows as $r) {
                if ($r['config_value'] === null || $r['config_value'] === '') {
                    continue;
                }
                try {
                    self::$cache[$r['config_key']] = Crypto::decrypt($r['config_value']);
                } catch (Throwable $e) {
                    // Don't let one undecryptable value break the whole app; skip
                    // it (the key will read as unset and surface in the portal).
                    error_log("Config decrypt failed for {$r['config_key']}: " . $e->getMessage());
                }
            }
        } catch (Throwable $e) {
            // DB not ready (e.g. during install) — fall back to env only.
        }
    }

    public static function set(string $key, string $value): void
    {
        $stored = Crypto::encrypt($value); // ciphertext when a key is configured
        $pdo = DB::pdo();
        $stmt = $pdo->prepare(
            "INSERT INTO app_config (config_key, config_value) VALUES (:k, :v)
             ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)"
        );
        $stmt->execute([':k' => $key, ':v' => $stored]);
        // Cache the plaintext for the rest of this request.
        self::$cache[$key] = $value;
    }

    /** Remove a portal key (revert to env/default). */
    public static function clear(string $key): void
    {
        DB::run("DELETE FROM app_config WHERE config_key = :k", [':k' => $key]);
        unset(self::$cache[$key]);
        self::$loadedDb = false; // force reload next get()
    }
}

/** Thrown when a required portal key hasn't been configured yet. */
final class ConfigMissingException extends RuntimeException
{
    public string $configKey;

    public function __construct(string $configKey)
    {
        $this->configKey = $configKey;
        parent::__construct("Missing required configuration: {$configKey}. "
            . "Set it in the God-mode portal under App keys & config.");
    }
}
