<?php
require __DIR__ . '/../src/bootstrap.php';

header('Content-Type: text/xml; charset=utf-8');
$rawBody = file_get_contents('php://input') ?: '';
if (!Telephony::verifyWebhook($rawBody)) {
    http_response_code(403);
    exit;
}

$listingId = (int) ($_GET['listing'] ?? 0);
$digits = $_POST['Digits'] ?? '';
$from = $_POST['From'] ?? '';
$to = $_POST['To'] ?? $_POST['Called'] ?? '';

$xml = new SimpleXMLElement('<Response/>');
$listing = DB::one("SELECT * FROM listings WHERE id=:id AND deleted_at IS NULL", [':id'=>$listingId]);

if ($listing && $digits === '1' && $from !== '') {
    try {
        Telephony::sendSms($from, $listing['phone_number'], $listing['sms_blurb']);
        DB::run("INSERT INTO call_events (listing_id, phone_number, caller_number, event_type)
                 VALUES (:l,:n,:c,'press1_sms')",
            [':l'=>$listing['id'], ':n'=>$to, ':c'=>$from]);
        try {
            $agent = DB::one("SELECT * FROM agents WHERE id=:id", [':id' => $listing['agent_id']]);
            if ($agent) {
                Notifications::callerRequested($agent, $listing, $from);
            }
        } catch (Throwable $e) {
            error_log('Caller-request notification queue failed: ' . $e->getMessage());
        }
        $xml->addChild('Say', 'Sent. Check your text messages. Goodbye.');
    } catch (Throwable $e) {
        error_log('press1 sms failed: ' . $e->getMessage());
        $xml->addChild('Say', 'Sorry, we could not send the text right now. Goodbye.');
    }
} else {
    $xml->addChild('Say', 'Thanks for calling. Goodbye.');
}
$xml->addChild('Hangup');
echo $xml->asXML();
