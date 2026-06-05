<?php
require __DIR__ . '/../src/bootstrap.php';

header('Content-Type: text/xml; charset=utf-8');

$to     = $_POST['To']   ?? $_POST['Called'] ?? '';
$from   = $_POST['From'] ?? '';
$sid    = $_POST['CallSid'] ?? '';

$listing = DB::one(
    "SELECT * FROM listings WHERE twilio_number = :n AND deleted_at IS NULL LIMIT 1",
    [':n' => $to]
);

$xml = new SimpleXMLElement('<Response/>');

if (!$listing) {
    $xml->addChild('Say', 'This listing is no longer available. Goodbye.');
    $xml->addChild('Hangup');
    echo $xml->asXML();
    exit;
}

// Log the call.
try {
    DB::run("INSERT INTO call_events (listing_id, twilio_number, caller_number, event_type, call_sid)
             VALUES (:l,:n,:c,'call',:s)",
        [':l'=>$listing['id'], ':n'=>$to, ':c'=>$from, ':s'=>$sid]);
} catch (Throwable $e) { error_log('call log: '.$e->getMessage()); }

// Gather digits during playback so the caller can press 1 at any time.
$base   = rtrim(Config::get('APP_BASE_URL', ''), '/');
$gather = $xml->addChild('Gather');
$gather->addAttribute('numDigits', '1');
$gather->addAttribute('action', $base . '/twilio_gather.php?listing=' . (int)$listing['id']);
$gather->addAttribute('method', 'POST');
$gather->addAttribute('actionOnEmptyResult', 'true');

if ($listing['audio_status'] === 'ready' && !empty($listing['audio_s3_key'])) {
    try {
        $url = Storage::presignedUrl($listing['audio_s3_key']);
        $gather->addChild('Play', htmlspecialchars($url, ENT_XML1));
    } catch (Throwable $e) {
        $gather->addChild('Say', 'Here is information about this home.');
    }
} else {
    // Audio not ready yet — fall back to reading the text directly.
    $say = $gather->addChild('Say', htmlspecialchars(
        $listing['description_text'] ?: 'Information about this home is being prepared.',
        ENT_XML1
    ));
    $say->addAttribute('voice', 'Polly.Joanna');
}

// Prompt for press-1, repeated inside the gather window.
$gather->addChild('Say', 'To receive details by text message, press 1 now.');

echo $xml->asXML();
