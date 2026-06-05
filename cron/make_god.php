<?php
declare(strict_types=1);

/**
 * CLI: create or promote a God-mode account, and (re)set its password.
 *
 *   php cron/make_god.php <login> [--name="Full Name"] [--password=secret]
 *
 * If --password is omitted, a strong temp password is generated and printed.
 * Run inside the container, e.g.:
 *   docker compose exec app php cron/make_god.php joshuakuhn --name="Joshua Kuhn"
 */
require __DIR__ . '/../src/bootstrap.php';

if (PHP_SAPI !== 'cli') { http_response_code(403); echo 'CLI only'; exit; }

$login = $argv[1] ?? null;
if (!$login) {
    fwrite(STDERR, "Usage: php cron/make_god.php <login> [--name=...] [--password=...]\n");
    exit(1);
}
$login = strtolower(trim($login));

$name = 'Administrator';
$password = null;
foreach (array_slice($argv, 2) as $arg) {
    if (str_starts_with($arg, '--name='))     { $name = substr($arg, 7); }
    if (str_starts_with($arg, '--password=')) { $password = substr($arg, 11); }
}

if ($password === null) {
    $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    $digit = '23456789';
    $sym   = '!@#$%^&*';
    $pick = fn(string $s, int $n): string => implode('', array_map(fn() => $s[random_int(0, strlen($s)-1)], range(1, $n)));
    $password = $pick($alpha,4).'-'.$pick($digit,3).$pick($alpha,4).'-'.$pick($sym,1).$pick($alpha,4);
}

$hash = password_hash($password, PASSWORD_DEFAULT);

$existing = DB::one("SELECT id FROM agents WHERE email = :e", [':e' => $login]);
if ($existing) {
    DB::run("UPDATE agents SET password_hash=:p, is_god=1, status='active' WHERE id=:id",
        [':p'=>$hash, ':id'=>$existing['id']]);
    echo "Updated existing account '{$login}' -> God mode.\n";
} else {
    DB::run("INSERT INTO agents (email, password_hash, full_name, status, is_god)
             VALUES (:e,:p,:n,'active',1)",
        [':e'=>$login, ':p'=>$hash, ':n'=>$name]);
    echo "Created God account '{$login}'.\n";
}
echo "Login:    {$login}\n";
echo "Password: {$password}\n";
