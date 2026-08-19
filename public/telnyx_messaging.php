<?php
require __DIR__ . '/../src/bootstrap.php';

$rawBody = file_get_contents('php://input') ?: '';
if (!Telephony::verifyWebhook($rawBody)) {
    http_response_code(403);
    exit;
}
$event = json_decode($rawBody, true);
if (!is_array($event) || ($event['data']['event_type'] ?? '') !== 'message.received') {
    http_response_code(204);
    exit;
}

$payload = $event['data']['payload'] ?? [];
$to = (string) ($payload['to'][0]['phone_number'] ?? '');
$from = (string) ($payload['from']['phone_number'] ?? '');
$listing = $to === '' ? null : DB::one(
    "SELECT * FROM listings WHERE phone_number=:n AND deleted_at IS NULL LIMIT 1",
    [':n'=>$to]
);
if ($listing && $from !== '') {
    enqueue('send_sms', ['to'=>$from, 'from'=>$to, 'body'=>$listing['sms_blurb']]);
}
http_response_code(204);
