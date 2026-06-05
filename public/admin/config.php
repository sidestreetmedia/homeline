<?php
require __DIR__ . '/../../src/bootstrap.php';
$me = Auth::requireGod();

// Portal-managed keys, grouped for the UI. These are the authoritative source;
// the app reads them from the database, not the environment.
$groups = [
    'Twilio' => [
        'TWILIO_ACCOUNT_SID'    => 'Account SID',
        'TWILIO_AUTH_TOKEN'     => 'Auth Token',
    ],
    'ElevenLabs' => [
        'ELEVENLABS_API_KEY'    => 'API Key',
        'ELEVENLABS_VOICE_ID'   => 'Default Voice ID',
        'ELEVENLABS_MODEL'      => 'Model (e.g. eleven_turbo_v2_5)',
    ],
    'Stripe' => [
        'STRIPE_SECRET_KEY'     => 'Secret Key',
        'STRIPE_PRICE_ID'       => 'Price ID ($5/mo recurring)',
        'STRIPE_WEBHOOK_SECRET' => 'Webhook Secret',
        'PRICE_CENTS'           => 'Price in cents (default 500)',
    ],
    'AWS S3' => [
        'AWS_ACCESS_KEY_ID'     => 'Access Key ID',
        'AWS_SECRET_ACCESS_KEY' => 'Secret Access Key',
        'AWS_REGION'            => 'Region (e.g. us-east-1)',
        'S3_BUCKET'             => 'Bucket name',
    ],
    'Application' => [
        'APP_BASE_URL'          => 'Public base URL (https://…)',
        'DISABLE_SSL'           => 'Disable Secure cookies behind TLS proxy (0/1)',
    ],
];

$isSecret = fn(string $k): bool => (bool) preg_match('/(KEY|TOKEN|SECRET)$/', $k);
$MASK = '••••••••';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Auth::checkCsrf(post('csrf'));
    foreach ($groups as $keys) {
        foreach ($keys as $k => $_label) {
            // Optional clear checkbox per key.
            if (post('clear_' . $k) === '1') {
                Config::clear($k);
                continue;
            }
            $v = post($k);
            if ($v === null) { continue; }
            $v = trim($v);
            if ($v === '' ) { continue; }              // blank = leave unchanged
            if ($v === $MASK) { continue; }            // masked = keep current
            Config::set($k, $v);
        }
    }
    header('Location: /admin/config.php?ok=1');
    exit;
}

$display = function (string $k) use ($isSecret, $MASK): string {
    $v = Config::get($k, '');
    if ($v === '' || $v === null) { return ''; }
    return $isSecret($k) ? $MASK : (string) $v;
};

$missing = Config::missingPortalKeys();

ob_start();
?>
<div class="card glass" style="max-width:720px;margin:0 auto">
    <h2>App keys &amp; configuration</h2>
    <p class="sub">These are stored in the database and are the source of truth for
       the whole app. Secrets are masked — leave the dots to keep the current
       value, type a new value to replace it, or tick “clear”.</p>

    <?php if (!empty($_GET['ok'])): ?><div class="flash ok">Configuration saved.</div><?php endif; ?>

    <?php if (Crypto::available()): ?>
        <div class="flash ok">Stored values are encrypted at rest (AES-256-GCM). The master key lives in the environment, not the database.</div>
    <?php else: ?>
        <div class="flash err">No <code>CONFIG_ENCRYPTION_KEY</code> is set, so values are stored as <strong>plaintext</strong>. Set one in the environment (<code>openssl rand -base64 32</code>) and re-save each key to encrypt it.</div>
    <?php endif; ?>

    <?php if (!empty($missing)): ?>
        <div class="flash err">
            Not yet configured: <?= e(implode(', ', $missing)) ?>.
            The app can't use the related features until these are set.
        </div>
    <?php else: ?>
        <div class="flash ok">All required keys are configured.</div>
    <?php endif; ?>

    <form method="post" action="/admin/config.php">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <?php foreach ($groups as $section => $keys): ?>
            <h2 style="font-size:16px;margin:22px 0 10px"><?= e($section) ?></h2>
            <?php foreach ($keys as $k => $label):
                $val = $display($k);
                $set = Config::isSet($k);
            ?>
                <div class="field">
                    <label>
                        <?= e($label) ?> <span class="muted">(<?= e($k) ?>)</span>
                        <?php if ($set): ?><span class="pill ready" style="margin-left:6px">set</span>
                        <?php else: ?><span class="pill pending" style="margin-left:6px">unset</span><?php endif; ?>
                    </label>
                    <input class="input" name="<?= e($k) ?>" value="<?= e($val) ?>"
                           autocomplete="off" spellcheck="false"
                           placeholder="<?= $set ? '' : 'not configured' ?>">
                    <?php if ($set): ?>
                        <label class="muted" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px">
                            <input type="checkbox" name="clear_<?= e($k) ?>" value="1"> clear this value
                        </label>
                    <?php endif; ?>
                </div>
            <?php endforeach; ?>
        <?php endforeach; ?>
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" type="submit">Save configuration</button>
    </form>
    <p class="muted" style="margin-top:16px"><a class="link" href="/admin/index.php">← Back to agents</a></p>
</div>
<?php
$content = ob_get_clean();
$title = 'Config — God Mode';
require __DIR__ . '/../../views/layout.php';
