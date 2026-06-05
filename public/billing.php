<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();

// POST = start Checkout to add/replace the card.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Auth::checkCsrf(post('csrf'));
    try {
        $url = Billing::createSetupCheckout($me);
        header('Location: ' . $url);
        exit;
    } catch (Throwable $e) {
        error_log('createSetupCheckout: ' . $e->getMessage());
        header('Location: /billing.php?err=' . rawurlencode('Could not start card setup. Check billing configuration.'));
        exit;
    }
}

$hasCard = Billing::hasPaymentMethod($me);
$err = $_GET['err'] ?? null;

// Try to show a card summary (last4/brand) if we have one.
$cardLabel = null;
if ($hasCard) {
    try {
        $pm = (new \Stripe\StripeClient(Config::require('STRIPE_SECRET_KEY')))
            ->paymentMethods->retrieve($me['stripe_payment_method_id'], []);
        if (!empty($pm->card)) {
            $cardLabel = ucfirst($pm->card->brand) . ' •••• ' . $pm->card->last4
                . '  (exp ' . str_pad((string)$pm->card->exp_month, 2, '0', STR_PAD_LEFT) . '/' . $pm->card->exp_year . ')';
        }
    } catch (Throwable $e) { /* non-fatal */ }
}

ob_start();
?>
<div class="card glass" style="max-width:560px;margin:0 auto">
    <h2>Payment method</h2>
    <p class="sub">A card on file is required before you can publish a home. Your
       card is charged $5 the moment you save a home, and $5 per active home on the
       1st of each month.</p>

    <?php if ($err): ?><div class="flash err"><?= e($err) ?></div><?php endif; ?>

    <?php if ($hasCard): ?>
        <div class="listing" style="margin-bottom:18px">
            <div>
                <div class="addr">Card on file</div>
                <div class="meta"><?= e($cardLabel ?? 'Saved card') ?></div>
            </div>
            <span class="pill ready">Active</span>
        </div>
        <form method="post" action="/billing.php">
            <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
            <button class="btn" type="submit">Replace card</button>
            <a class="btn btn-primary" href="/listing_edit.php">Add a home</a>
        </form>
    <?php else: ?>
        <div class="flash err">No card on file yet.</div>
        <form method="post" action="/billing.php">
            <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
            <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">
                Add a card
            </button>
        </form>
        <p class="muted" style="margin-top:12px;text-align:center">You're securely redirected to Stripe to enter your card. We never see the number.</p>
    <?php endif; ?>
</div>
<?php
$content = ob_get_clean();
$title = 'Billing — HomeLine';
require __DIR__ . '/../views/layout.php';
