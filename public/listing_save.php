<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();
Auth::checkCsrf(post('csrf'));

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: /dashboard.php'); exit;
}

$id          = post('id') ? (int) post('id') : null;
$addr1       = (string) post('address_line1');
$addr2       = post('address_line2');
$city        = (string) post('city');
$state       = strtoupper(substr((string) post('state'), 0, 2));
$zip         = (string) post('postal_code');
$audioSource = post('audio_source') === 'upload' ? 'upload' : 'tts';
$descText    = (string) post('description_text');
$smsBlurb    = (string) post('sms_blurb');

$errBack = function (string $msg) use ($me, $id) {
    $listing = $id ? DB::one("SELECT * FROM listings WHERE id=:i AND agent_id=:a", [':i'=>$id, ':a'=>$me['id']]) : null;
    view('listing_edit', ['listing' => $listing, 'me' => $me, 'error' => $msg], 'Add a home — HomeLine');
    exit;
};

if ($addr1 === '' || $city === '' || $state === '' || $zip === '' || $smsBlurb === '') {
    $errBack('Please complete all required fields.');
}
if ($audioSource === 'tts' && trim($descText) === '') {
    $errBack('Add a spoken description, or switch to uploading a recording.');
}
if (mb_strlen($smsBlurb) > 280) {
    $errBack('The press-1 message is too long.');
}

$pdo = DB::pdo();

/* ----------------------------- UPDATE PATH ----------------------------- */
if ($id) {
    $listing = DB::one("SELECT * FROM listings WHERE id=:i AND agent_id=:a AND deleted_at IS NULL",
        [':i' => $id, ':a' => $me['id']]);
    if (!$listing) { http_response_code(404); echo 'Not found'; exit; }

    $descChanged = ($audioSource === 'tts' && trim($descText) !== trim((string) $listing['description_text']));
    $sourceChanged = ($audioSource !== $listing['audio_source']);

    DB::run(
        "UPDATE listings SET address_line1=:a1, address_line2=:a2, city=:c, state=:s,
            postal_code=:z, audio_source=:src, description_text=:d, sms_blurb=:b,
            audio_status = CASE WHEN :regen = 1 THEN 'pending' ELSE audio_status END
         WHERE id=:id",
        [
            ':a1'=>$addr1, ':a2'=>$addr2 ?: null, ':c'=>$city, ':s'=>$state, ':z'=>$zip,
            ':src'=>$audioSource, ':d'=>$descText, ':b'=>$smsBlurb,
            ':regen'=> ($descChanged || ($sourceChanged && $audioSource==='tts')) ? 1 : 0,
            ':id'=>$id,
        ]
    );
    if ($audioSource === 'tts' && ($descChanged || $sourceChanged)) {
        enqueue('generate_tts', ['listing_id' => $id]);
    }
    header('Location: /dashboard.php?ok=' . rawurlencode('Listing updated.'));
    exit;
}

/* ------------------------------ CREATE PATH ----------------------------- */
// Require a saved card before doing anything that costs money.
if (!Billing::hasPaymentMethod($me)) {
    header('Location: /billing.php?err=' . rawurlencode('Add a card before publishing a home.'));
    exit;
}

$chosen = (string) post('chosen_number');
if ($chosen === '') {
    $errBack('Choose a phone number for this home.');
}

// Make sure the agent has a billable Stripe subscription/customer before we
// spend money buying a number.
try {
    Billing::ensureSubscription($me);
} catch (Throwable $e) {
    $errBack('We could not set up billing. Please add a payment method and try again.');
}

$numberId = null; $numberOrderId = null; $purchased = null; $newId = null; $firstChargeId = null;

try {
    $pdo->beginTransaction();

    // Insert the listing first (pending audio, no number yet).
    DB::run(
        "INSERT INTO listings
            (agent_id, address_line1, address_line2, city, state, postal_code,
             description_text, sms_blurb, audio_source, audio_status, billing_state)
         VALUES (:a,:a1,:a2,:c,:s,:z,:d,:b,:src,'pending','active')",
        [
            ':a'=>$me['id'], ':a1'=>$addr1, ':a2'=>$addr2 ?: null, ':c'=>$city,
            ':s'=>$state, ':z'=>$zip, ':d'=>$descText, ':b'=>$smsBlurb, ':src'=>$audioSource,
        ]
    );
    $newId = (int) DB::lastId();
    $label = "{$addr1}, {$city}, {$state}";

    // Charge the first month immediately, out of band. Must succeed.
    $firstChargeId = Billing::chargeFirstMonth($me, $newId, $label);

    // Purchase the number and wire webhooks.
    $bought = Telephony::purchase($chosen);
    $numberId = $bought['number_id'];
    $numberOrderId = $bought['order_id'];
    $purchased = $bought['phone'];

    // Grace rule: if the home is added within 4 days of the 1st of next month,
    // skip the next recurring renewal (the upfront charge already covers that
    // near-future period). The home then stays live an extra month.
    $now            = new DateTimeImmutable('now');
    $firstNextMonth = new DateTimeImmutable('first day of next month 00:00');
    $daysToRenewal  = (int) $now->diff($firstNextMonth)->format('%a');
    $withinGrace    = ($daysToRenewal <= 4);

    if ($withinGrace) {
        // Prepaid month covers through end of next month; skip one renewal.
        $activeUntil = (new DateTimeImmutable('first day of next month'))
            ->modify('+1 month')->format('Y-m-d');
    } else {
        // Prepaid first month; the 1st-of-next-month renewal covers onward.
        $activeUntil = (new DateTimeImmutable('first day of next month'))->format('Y-m-d');
    }

    DB::run(
        "UPDATE listings
           SET phone_number=:n, telnyx_number_id=:nid, telnyx_order_id=:oid, first_charge_id=:fc,
               active_until=:au, skip_next_recurring=:skip
         WHERE id=:id",
        [
            ':n'=>$purchased, ':nid'=>$numberId, ':oid'=>$numberOrderId, ':fc'=>$firstChargeId,
            ':au'=>$activeUntil, ':skip'=>$withinGrace ? 1 : 0, ':id'=>$newId,
        ]
    );

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    // Best-effort cleanup: release a number if it was bought before failure.
    if ($purchased) { try { Telephony::release($numberId, $purchased); } catch (Throwable $x) {} }
    error_log('Listing create failed: ' . $e->getMessage());
    $errBack('Could not complete: ' . $e->getMessage());
}

// Bump subscription quantity to match the new active count (next-cycle billing).
try { Billing::syncQuantity($me); } catch (Throwable $e) { error_log('syncQuantity: '.$e->getMessage()); }

// Generate + cache the narration if using TTS.
if ($audioSource === 'tts') {
    enqueue('generate_tts', ['listing_id' => $newId]);
}

header('Location: /dashboard.php?ok=' . rawurlencode('Home published. Number ' . $purchased . ' is live.'));
