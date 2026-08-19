<?php
require __DIR__ . '/../src/bootstrap.php';

header('Content-Type: text/xml; charset=utf-8');
$rawBody = file_get_contents('php://input') ?: '';
if (!Telephony::verifyWebhook($rawBody)) {
    http_response_code(403);
    exit;
}

$to   = $_POST['To'] ?? $_POST['Called'] ?? '';
$from = $_POST['From'] ?? '';
$sid  = $_POST['CallSid'] ?? $_POST['CallSidLegacy'] ?? '';

$listing = DB::one(
    "SELECT * FROM listings WHERE phone_number = :n AND deleted_at IS NULL LIMIT 1",
    [':n' => $to]
);
$xml = new SimpleXMLElement('<Response/>');

if (!$listing) {
    $xml->addChild('Say', 'This listing is no longer available. Goodbye.');
    $xml->addChild('Hangup');
    echo $xml->asXML();
    exit;
}

try {
    DB::run("INSERT INTO call_events (listing_id, phone_number, caller_number, event_type, call_control_id)
             VALUES (:l,:n,:c,'call',:s)",
        [':l'=>$listing['id'], ':n'=>$to, ':c'=>$from, ':s'=>$sid]);
} catch (Throwable $e) {
    error_log('call log: ' . $e->getMessage());
}

$base = rtrim(Config::get('APP_BASE_URL', ''), '/');
$gather = $xml->addChild('Gather');
$gather->addAttribute('input', 'dtmf');
$gather->addAttribute('numDigits', '1');
$gather->addAttribute('validDigits', '1');
$gather->addAttribute('timeout', '8');
$gather->addAttribute('action', $base . '/telnyx_gather.php?listing=' . (int)$listing['id']);
$gather->addAttribute('method', 'POST');

if ($listing['audio_status'] === 'ready' && !empty($listing['audio_s3_key'])) {
    try {
        $url = Storage::presignedUrl($listing['audio_s3_key']);
        $gather->addChild('Play', htmlspecialchars($url, ENT_XML1));
    } catch (Throwable $e) {
        $gather->addChild('Say', 'Here is information about this home.');
    }
} else {
    $say = $gather->addChild('Say', htmlspecialchars(
        $listing['description_text'] ?: 'Information about this home is being prepared.',
        ENT_XML1
    ));
    $say->addAttribute('voice', 'Polly.Joanna-Neural');
}
$prompt = $gather->addChild('Say', 'To receive details by text message, press 1 now.');
$prompt->addAttribute('voice', 'Polly.Joanna-Neural');

echo $xml->asXML();
