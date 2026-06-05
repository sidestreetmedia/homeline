<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();

$listings = DB::all(
    "SELECT * FROM listings
     WHERE agent_id = :a AND deleted_at IS NULL
     ORDER BY state ASC, city ASC, address_line1 ASC",
    [':a' => $me['id']]
);
$activeCount = Billing::activeHouseCount((int) $me['id']);
$hasCard = Billing::hasPaymentMethod($me);

$flash_ok = $_GET['ok'] ?? null;

view('dashboard', [
    'me'          => $me,
    'listings'    => $listings,
    'activeCount' => $activeCount,
    'hasCard'     => $hasCard,
    'flash_ok'    => $flash_ok,
], 'Your listings — HomeLine');
