<?php
declare(strict_types=1);

/**
 * Crypto — authenticated encryption for config values stored in the database.
 *
 * Uses AES-256-GCM with a 256-bit master key held in the environment
 * (CONFIG_ENCRYPTION_KEY). The key never lives in the database, so a database
 * dump alone cannot reveal the stored API keys.
 *
 * Stored format (string):  enc:v1:<base64( iv | tag | ciphertext )>
 * Anything without the "enc:v1:" prefix is treated as legacy plaintext and read
 * as-is, so existing rows keep working and are upgraded to ciphertext the next
 * time they're saved.
 */
final class Crypto
{
    private const PREFIX   = 'enc:v1:';
    private const CIPHER   = 'aes-256-gcm';
    private const IV_LEN   = 12;   // 96-bit nonce, recommended for GCM
    private const TAG_LEN  = 16;   // 128-bit auth tag

    private static ?string $key = null;

    /** Is an encryption key configured? If not, we store plaintext (with a warning). */
    public static function available(): bool
    {
        return self::loadKey() !== null;
    }

    /**
     * Resolve the 32-byte master key from CONFIG_ENCRYPTION_KEY.
     * Accepts a base64 value (preferred, e.g. `openssl rand -base64 32`) or a
     * raw 32-byte/64-hex-char string.
     */
    private static function loadKey(): ?string
    {
        if (self::$key !== null) {
            return self::$key === '' ? null : self::$key;
        }
        $raw = getenv('CONFIG_ENCRYPTION_KEY');
        if ($raw === false || trim($raw) === '') {
            self::$key = '';
            return null;
        }
        $raw = trim($raw);

        // Try base64 first.
        $decoded = base64_decode($raw, true);
        if ($decoded !== false && strlen($decoded) === 32) {
            return self::$key = $decoded;
        }
        // Try hex (64 chars).
        if (preg_match('/^[0-9a-fA-F]{64}$/', $raw)) {
            return self::$key = hex2bin($raw);
        }
        // Fall back: derive a stable 32-byte key from an arbitrary passphrase.
        return self::$key = hash('sha256', $raw, true);
    }

    /** Is this stored value an encrypted blob? */
    public static function isEncrypted(string $value): bool
    {
        return str_starts_with($value, self::PREFIX);
    }

    /** Encrypt a plaintext value. Falls back to returning plaintext if no key. */
    public static function encrypt(string $plaintext): string
    {
        $key = self::loadKey();
        if ($key === null) {
            // No key configured — store as-is (operator chose not to encrypt).
            return $plaintext;
        }
        $iv  = random_bytes(self::IV_LEN);
        $tag = '';
        $ct  = openssl_encrypt($plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag, '', self::TAG_LEN);
        if ($ct === false) {
            throw new RuntimeException('Config encryption failed.');
        }
        return self::PREFIX . base64_encode($iv . $tag . $ct);
    }

    /**
     * Decrypt a stored value. Legacy plaintext (no prefix) is returned as-is.
     * Throws if a value is encrypted but the key is missing or wrong.
     */
    public static function decrypt(string $stored): string
    {
        if (!self::isEncrypted($stored)) {
            return $stored; // legacy plaintext
        }
        $key = self::loadKey();
        if ($key === null) {
            throw new RuntimeException(
                'Encrypted config present but CONFIG_ENCRYPTION_KEY is not set.'
            );
        }
        $blob = base64_decode(substr($stored, strlen(self::PREFIX)), true);
        if ($blob === false || strlen($blob) < self::IV_LEN + self::TAG_LEN) {
            throw new RuntimeException('Corrupt encrypted config value.');
        }
        $iv  = substr($blob, 0, self::IV_LEN);
        $tag = substr($blob, self::IV_LEN, self::TAG_LEN);
        $ct  = substr($blob, self::IV_LEN + self::TAG_LEN);
        $pt  = openssl_decrypt($ct, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($pt === false) {
            throw new RuntimeException(
                'Config decryption failed (wrong CONFIG_ENCRYPTION_KEY or tampered data).'
            );
        }
        return $pt;
    }

    /** Generate a fresh base64 master key (helper for setup/CLI). */
    public static function generateKey(): string
    {
        return base64_encode(random_bytes(32));
    }
}
