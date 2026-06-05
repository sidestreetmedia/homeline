<?php
require __DIR__ . '/../src/bootstrap.php';

header('Content-Type: text/xml; charset=utf-8');

$listingId = (int) ($_GET['listing'] ?? 0);
$digits    = $_POST['Digits'] ?? '';
$from      = $_POST['From'] ?? '';   // the caller
$to        = $_POST['To'] ?? $_POST['Called'] ?? '';

$xml = new SimpleXMLElement('<Response/>');
$listing = DB::one("SELECT * FROM listings WHERE id=:id AND deleted_at IS NULL", [':id'=>$listingId]);

if ($listing && $digits === '1' && $from !== '') {
    try {
        Telephony::sendSms($from, $listing['twilio_number'], $listing['sms_blurb']);
        DB::run("INSERT INTO call_events (listing_id, twilio_number, caller_number, event_type)
                 VALUES (:l,:n,:c,'press1_sms')",
            [':l'=>$listing['id'], ':n'=>$to, ':c'=>$from]);
        $xml->addChild('Say', 'Sent. Check your text messages. Goodbye.');
    } catch (Throwable $e) {
        error_log('press1 sms failed: '.$e->getMessage());
        $xml->addChild('Say', 'Sorry, we could not send the text right now. Goodbye.');
    }
    $xml->addChild('Hangup');
} else {
    // No digit pressed (or invalid). Thank and hang up.
    $xml->addChild('Say', 'Thanks for calling. Goodbye.');
    $xml->addChild('Hangup');
}

echo $xml->asXML();
