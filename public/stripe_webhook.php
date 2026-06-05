<?php
require __DIR__ . '/../src/bootstrap.php';

use Stripe\Webhook;

$payload = file_get_contents('php://input');
$sig     = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
$secret  = Config::get('STRIPE_WEBHOOK_SECRET', '');

try {
    if ($secret) {
        $event = Webhook::constructEvent($payload, $sig, $secret);
    } else {
        // No secret configured (dev) — parse without verification.
        $event = json_decode($payload, false);
    }
} catch (Throwable $e) {
    http_response_code(400);
    echo 'Invalid signature';
    exit;
}

$type = $event->type ?? '';
$obj  = $event->data->object ?? null;

switch ($type) {
    case 'invoice.payment_failed':
    case 'checkout.session.completed':
        // A setup-mode Checkout finished — capture and set the default card even
        // if the browser never made it back to billing_return.php.
        if ($obj && ($obj->mode ?? '') === 'setup' && !empty($obj->id)) {
            try { Billing::captureSavedCardFromSession($obj->id); }
            catch (Throwable $e) { error_log('webhook capture card: ' . $e->getMessage()); }
        }
        break;

    case 'invoice.payment_failed':
        // Mark agent past-due; god mode can see this.
        if ($obj && !empty($obj->customer)) {
            DB::run("UPDATE agents SET status='suspended'
                     WHERE stripe_customer_id=:c AND is_god=0",
                [':c' => $obj->customer]);
        }
        break;

    case 'invoice.paid':
        if ($obj && !empty($obj->customer)) {
            DB::run("UPDATE agents SET status='active'
                     WHERE stripe_customer_id=:c AND status='suspended'",
                [':c' => $obj->customer]);
        }
        break;

    case 'customer.subscription.deleted':
        // Subscription gone — nothing to bill; leave listings as-is for audit.
        break;
}

http_response_code(200);
echo 'ok';
