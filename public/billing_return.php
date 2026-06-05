<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();

$status    = $_GET['status'] ?? '';
$sessionId = $_GET['session_id'] ?? '';

if ($status === 'success' && $sessionId !== '') {
    try {
        $pmId = Billing::captureSavedCardFromSession($sessionId);
        if ($pmId) {
            // Ensure a subscription exists now that we have a card, so future
            // renewals are ready to charge it.
            try { Billing::ensureSubscription($me); } catch (Throwable $e) { error_log('ensureSub after card: '.$e->getMessage()); }
            header('Location: /dashboard.php?ok=' . rawurlencode('Card saved. You can now add homes.'));
            exit;
        }
        // Fall through to a soft error if the session didn't yield a card.
        header('Location: /billing.php?err=' . rawurlencode('We could not confirm your card. Please try again.'));
        exit;
    } catch (Throwable $e) {
        error_log('billing_return capture failed: ' . $e->getMessage());
        header('Location: /billing.php?err=' . rawurlencode('Something went wrong saving your card.'));
        exit;
    }
}

// Cancelled or unknown.
header('Location: /billing.php?err=' . rawurlencode('Card setup was cancelled.'));
