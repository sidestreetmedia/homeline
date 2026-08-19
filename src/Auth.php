<?php
declare(strict_types=1);

final class Auth
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        // DB-backed sessions so the app scales across FPM workers/containers.
        session_set_save_handler(new DbSessionHandler(), true);
        $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        $requestIsHttps = ((!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
            || $forwardedProto === 'https'
            || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443');
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => (Config::get('DISABLE_SSL', '0') !== '1') && $requestIsHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }

    public static function attempt(string $email, string $password): ?array
    {
        $agent = DB::one("SELECT * FROM agents WHERE email = :e", [':e' => strtolower(trim($email))]);
        if (!$agent || !password_verify($password, $agent['password_hash'])) {
            return null;
        }
        if ($agent['status'] === 'suspended') {
            return null;
        }
        $_SESSION['agent_id'] = (int) $agent['id'];
        $_SESSION['is_god']   = (int) $agent['is_god'];
        session_regenerate_id(true);
        return $agent;
    }

    public static function register(string $email, string $password, string $name, ?string $company): array
    {
        $email = strtolower(trim($email));
        if (DB::one("SELECT id FROM agents WHERE email = :e", [':e' => $email])) {
            throw new RuntimeException('An account with that email already exists.');
        }
        DB::run(
            "INSERT INTO agents (email, password_hash, full_name, company, status)
             VALUES (:e, :p, :n, :c, 'active')",
            [
                ':e' => $email,
                ':p' => password_hash($password, PASSWORD_DEFAULT),
                ':n' => trim($name),
                ':c' => $company ? trim($company) : null,
            ]
        );
        $id = (int) DB::lastId();
        return DB::one("SELECT * FROM agents WHERE id = :id", [':id' => $id]);
    }

    public static function current(): ?array
    {
        self::start();
        if (empty($_SESSION['agent_id'])) {
            return null;
        }
        return DB::one("SELECT * FROM agents WHERE id = :id", [':id' => $_SESSION['agent_id']]);
    }

    public static function requireAgent(): array
    {
        $a = self::current();
        if (!$a) {
            header('Location: /login.php');
            exit;
        }
        return $a;
    }

    public static function requireGod(): array
    {
        $a = self::requireAgent();
        if ((int) $a['is_god'] !== 1) {
            http_response_code(403);
            echo 'Forbidden';
            exit;
        }
        return $a;
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
    }

    public static function csrfToken(): string
    {
        self::start();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf'];
    }

    public static function checkCsrf(?string $token): void
    {
        self::start();
        if (!self::csrfIsValid($token)) {
            http_response_code(419);
            echo 'CSRF token mismatch.';
            exit;
        }
    }

    public static function csrfIsValid(?string $token): bool
    {
        self::start();
        return $token !== null
            && $token !== ''
            && !empty($_SESSION['csrf'])
            && hash_equals((string) $_SESSION['csrf'], $token);
    }
}
