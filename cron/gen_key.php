<?php
declare(strict_types=1);
/**
 * CLI: print a fresh base64 master key for CONFIG_ENCRYPTION_KEY.
 *   php cron/gen_key.php
 */
require __DIR__ . '/../src/bootstrap.php';
if (PHP_SAPI !== 'cli') { http_response_code(403); echo 'CLI only'; exit; }
echo Crypto::generateKey() . "\n";
