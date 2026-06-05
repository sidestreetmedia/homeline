<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();

$listing = null;
if (!empty($_GET['id'])) {
    $listing = DB::one(
        "SELECT * FROM listings WHERE id = :id AND agent_id = :a AND deleted_at IS NULL",
        [':id' => (int) $_GET['id'], ':a' => $me['id']]
    );
    if (!$listing) { http_response_code(404); echo 'Not found'; exit; }
} else {
    // New listing — require a card on file first.
    if (!Billing::hasPaymentMethod($me)) {
        header('Location: /billing.php?err=' . rawurlencode('Add a card before publishing a home.'));
        exit;
    }
}

view('listing_edit', ['listing' => $listing, 'me' => $me],
     ($listing ? 'Edit home' : 'Add a home') . ' — HomeLine');
