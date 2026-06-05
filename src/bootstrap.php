<?php
declare(strict_types=1);

// Composer autoload (SDKs: Stripe, Twilio, AWS).
$autoload = __DIR__ . '/../vendor/autoload.php';
if (is_file($autoload)) {
    require $autoload;
}

// App class autoloader.
spl_autoload_register(function (string $class): void {
    $file = __DIR__ . '/' . $class . '.php';
    if (is_file($file)) {
        require $file;
    }
});

date_default_timezone_set('UTC');

/**
 * Friendly handling for unconfigured API keys. If a portal-managed key is
 * missing, agent-facing HTML pages show a clear message instead of a white
 * screen. JSON and Twilio (XML) endpoints set their own content types, so we
 * only intervene for plain HTML responses.
 */
set_exception_handler(function (Throwable $e): void {
    if ($e instanceof ConfigMissingException) {
        error_log('Config missing: ' . $e->configKey);
        $ct = '';
        foreach (headers_list() as $h) {
            if (stripos($h, 'content-type:') === 0) { $ct = strtolower($h); }
        }
        $isHtml = ($ct === '' || str_contains($ct, 'text/html'));
        if ($isHtml && PHP_SAPI !== 'cli') {
            http_response_code(503);
            $key = htmlspecialchars($e->configKey, ENT_QUOTES, 'UTF-8');
            echo "<!doctype html><meta charset='utf-8'><title>Not configured</title>"
               . "<div style='font-family:system-ui;max-width:560px;margin:80px auto;padding:24px;"
               . "background:#111;color:#eee;border-radius:16px;line-height:1.5'>"
               . "<h2 style='margin-top:0'>This feature isn't configured yet</h2>"
               . "<p>The setting <code>{$key}</code> hasn't been set. An administrator can add it "
               . "in the God-mode portal under <strong>App keys &amp; config</strong>.</p></div>";
            exit;
        }
    }
    // Anything else: log and emit a generic 500 (no stack traces to users).
    error_log('Unhandled: ' . $e->getMessage());
    if (!headers_sent()) { http_response_code(500); }
    echo 'An unexpected error occurred.';
    exit;
});

/** Escape for HTML output. */
function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Read a POST field. */
function post(string $key, ?string $default = null): ?string
{
    $v = $_POST[$key] ?? $default;
    return is_string($v) ? trim($v) : $default;
}

/** JSON response + exit. */
function json_out(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

/** Format a listing's address into a single label. */
function address_label(array $l): string
{
    $parts = array_filter([
        $l['address_line1'] ?? null,
        $l['address_line2'] ?? null,
        trim(($l['city'] ?? '') . ', ' . ($l['state'] ?? '') . ' ' . ($l['postal_code'] ?? '')),
    ]);
    return implode(', ', $parts);
}

/** Enqueue a background job. */
function enqueue(string $type, array $payload, string $runAfter = 'now'): void
{
    DB::run(
        "INSERT INTO jobs (job_type, payload, run_after)
         VALUES (:t, :p, :r)",
        [
            ':t' => $type,
            ':p' => json_encode($payload, JSON_UNESCAPED_SLASHES),
            ':r' => (new DateTimeImmutable($runAfter))->format('Y-m-d H:i:s'),
        ]
    );
}

/** Render a view file with the shared layout. */
function view(string $template, array $vars = [], ?string $title = null): void
{
    extract($vars, EXTR_SKIP);
    $title = $title ?? 'HomeLine';
    ob_start();
    require __DIR__ . '/../views/' . $template . '.php';
    $content = ob_get_clean();
    require __DIR__ . '/../views/layout.php';
}
