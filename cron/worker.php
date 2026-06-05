<?php
declare(strict_types=1);
require __DIR__ . '/../src/bootstrap.php';

/**
 * Run every minute from cron. Two responsibilities:
 *   1. Drain the jobs table (TTS generation, etc.).
 *   2. Lightweight scheduled maintenance (session GC, lifecycle sweeps).
 *
 * Because shared LAMP has no real worker daemon, this is intentionally simple
 * and idempotent. Recurring monthly billing itself is handled by Stripe
 * (subscription renews on the 1st); we only keep quantities in sync and end
 * listings whose paid period has lapsed after deletion.
 */

$startedAt = time();
$maxRun    = 50; // seconds; stay under the 1-minute cron cadence

// --- 1. Drain jobs -----------------------------------------------------------
while ((time() - $startedAt) < $maxRun) {
    $pdo = DB::pdo();
    $pdo->beginTransaction();
    $job = DB::one(
        "SELECT * FROM jobs
          WHERE status='queued' AND run_after <= NOW()
          ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED"
    );
    if (!$job) { $pdo->commit(); break; }

    DB::run("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=:id", [':id'=>$job['id']]);
    $pdo->commit();

    $payload = json_decode($job['payload'], true) ?: [];
    try {
        handle_job($job['job_type'], $payload);
        DB::run("UPDATE jobs SET status='done' WHERE id=:id", [':id'=>$job['id']]);
    } catch (Throwable $e) {
        $failed = ((int)$job['attempts'] >= 5);
        DB::run("UPDATE jobs SET status=:s, last_error=:e, run_after=:r WHERE id=:id", [
            ':s' => $failed ? 'failed' : 'queued',
            ':e' => substr($e->getMessage(), 0, 1000),
            ':r' => (new DateTimeImmutable('+2 minutes'))->format('Y-m-d H:i:s'),
            ':id'=> $job['id'],
        ]);
        error_log("Job {$job['id']} ({$job['job_type']}) error: ".$e->getMessage());
    }
}

// --- 2. Maintenance ----------------------------------------------------------
// Session GC (older than 7 days).
DB::run("DELETE FROM sessions WHERE last_active < :c", [':c' => time() - 7*86400]);

// Grace-flag clearing: once the 1st of the month has passed, any house that
// skipped its first renewal should resume normal billing on the FOLLOWING
// renewal. We clear the flag on the 1st (day-of-month = 1) and re-sync each
// affected agent's subscription quantity so the next renewal includes them.
$today = new DateTimeImmutable('now');
if ((int) $today->format('j') === 1) {
    $agentsToSync = DB::all(
        "SELECT DISTINCT agent_id FROM listings
          WHERE skip_next_recurring = 1 AND deleted_at IS NULL"
    );
    DB::run("UPDATE listings SET skip_next_recurring = 0
              WHERE skip_next_recurring = 1 AND deleted_at IS NULL");
    foreach ($agentsToSync as $row) {
        $agent = DB::one("SELECT * FROM agents WHERE id=:id", [':id'=>$row['agent_id']]);
        if ($agent) {
            try { Billing::syncQuantity($agent); }
            catch (Throwable $e) { error_log('grace re-sync: '.$e->getMessage()); }
        }
    }
}

fwrite(STDOUT, "[cron] tick complete @ ".date('c')."\n");

// -----------------------------------------------------------------------------
function handle_job(string $type, array $p): void
{
    switch ($type) {
        case 'generate_tts':
            $listingId = (int) ($p['listing_id'] ?? 0);
            $listing = DB::one("SELECT * FROM listings WHERE id=:id AND deleted_at IS NULL", [':id'=>$listingId]);
            if (!$listing) { return; }
            if ($listing['audio_source'] !== 'tts') { return; }
            $text = trim((string) $listing['description_text']);
            if ($text === '') { return; }

            $audio = ElevenLabs::synthesize($text);
            $key   = "listings/{$listingId}/tts-" . substr(sha1($text), 0, 10) . ".mp3";
            Storage::putAudio($key, $audio);

            // Remove previous cached object if different.
            if (!empty($listing['audio_s3_key']) && $listing['audio_s3_key'] !== $key) {
                try { Storage::delete($listing['audio_s3_key']); } catch (Throwable $e) {}
            }
            DB::run("UPDATE listings SET audio_s3_key=:k, audio_status='ready' WHERE id=:id",
                [':k'=>$key, ':id'=>$listingId]);
            break;

        default:
            throw new RuntimeException("Unknown job type: {$type}");
    }
}
