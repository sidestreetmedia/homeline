<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();
Auth::checkCsrf(post('csrf'));

$id = (int) post('id');
$listing = DB::one("SELECT * FROM listings WHERE id=:i AND agent_id=:a AND deleted_at IS NULL",
    [':i' => $id, ':a' => $me['id']]);
if (!$listing) { header('Location: /dashboard.php'); exit; }

// Release the Twilio number immediately (per spec: released on delete).
if (!empty($listing['twilio_number_sid'])) {
    try { Telephony::release($listing['twilio_number_sid']); }
    catch (Throwable $e) { error_log('Number release failed: ' . $e->getMessage()); }
}

// Delete cached audio from S3.
if (!empty($listing['audio_s3_key'])) {
    try { Storage::delete($listing['audio_s3_key']); }
    catch (Throwable $e) { error_log('S3 delete failed: ' . $e->getMessage()); }
}

// Soft-delete. They've already paid the current month (no refund); the house
// simply stops counting toward next cycle. Mark ended so it leaves the active
// count, and decrement the subscription quantity now (proration disabled).
DB::run(
    "UPDATE listings
       SET deleted_at = NOW(), billing_state = 'ended',
           twilio_number = NULL, twilio_number_sid = NULL
     WHERE id = :id",
    [':id' => $id]
);

try { Billing::syncQuantity($me); }
catch (Throwable $e) { error_log('syncQuantity on delete: ' . $e->getMessage()); }

header('Location: /dashboard.php?ok=' . rawurlencode('Home deleted and number released. You are billed through this month.'));
