<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();

$area = preg_replace('/\D/', '', (string) ($_GET['area'] ?? ''));
if (strlen($area) !== 3) {
    json_out(['ok' => false, 'error' => 'Enter a 3-digit area code.'], 400);
}

try {
    $numbers = Telephony::searchLocal($area, 10);
    if (empty($numbers)) {
        json_out(['ok' => false, 'error' => 'No numbers available in that area code.']);
    }
    json_out(['ok' => true, 'numbers' => $numbers]);
} catch (Throwable $e) {
    error_log('Number search failed: ' . $e->getMessage());
    json_out(['ok' => false, 'error' => 'Search failed. Try another area code.'], 500);
}
