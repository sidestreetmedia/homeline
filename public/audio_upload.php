<?php
require __DIR__ . '/../src/bootstrap.php';
$me = Auth::requireAgent();
Auth::checkCsrf(post('csrf'));

$id = (int) post('id');
$listing = DB::one("SELECT * FROM listings WHERE id=:i AND agent_id=:a AND deleted_at IS NULL",
    [':i'=>$id, ':a'=>$me['id']]);
if (!$listing) { http_response_code(404); echo 'Not found'; exit; }

if (empty($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK) {
    header('Location: /listing_edit.php?id='.$id); exit;
}

$tmp  = $_FILES['audio']['tmp_name'];
$size = (int) $_FILES['audio']['size'];
if ($size <= 0 || $size > 15 * 1024 * 1024) { // 15 MB cap
    header('Location: /listing_edit.php?id='.$id.'&err=size'); exit;
}

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime  = finfo_file($finfo, $tmp);
finfo_close($finfo);
$allowed = ['audio/mpeg' => 'mp3', 'audio/mp3' => 'mp3'];
if (!isset($allowed[$mime])) {
    header('Location: /listing_edit.php?id='.$id.'&err=type'); exit;
}

$bytes = file_get_contents($tmp);
$key   = "listings/{$id}/audio-" . bin2hex(random_bytes(6)) . ".mp3";

try {
    // Remove old object if present.
    if (!empty($listing['audio_s3_key'])) {
        try { Storage::delete($listing['audio_s3_key']); } catch (Throwable $e) {}
    }
    Storage::putAudio($key, $bytes);
    DB::run("UPDATE listings SET audio_source='upload', audio_s3_key=:k, audio_status='ready' WHERE id=:id",
        [':k'=>$key, ':id'=>$id]);
} catch (Throwable $e) {
    error_log('Audio upload failed: '.$e->getMessage());
    header('Location: /listing_edit.php?id='.$id.'&err=upload'); exit;
}

header('Location: /dashboard.php?ok=' . rawurlencode('Recording uploaded.'));
