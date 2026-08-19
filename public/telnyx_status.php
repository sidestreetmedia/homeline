<?php
require __DIR__ . '/../src/bootstrap.php';

$rawBody = file_get_contents('php://input') ?: '';
if (!Telephony::verifyWebhook($rawBody)) {
    http_response_code(403);
    exit;
}
http_response_code(204);
