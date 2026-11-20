import type { Env, Listing } from '../env';
import { Config } from '../lib/config';
import { hexEncode } from '../lib/bytes';
import { one, run } from '../lib/db';
import { sendEmail, Storage } from './aws';
import { synthesize } from './elevenlabs';
import { Telnyx } from './telnyx';

/** Background work, formerly the MySQL jobs table drained by cron/worker.php. */
export type Job =
  | { type: 'generate_tts'; listing_id: number }
  | { type: 'send_sms'; to: string; from: string; body: string }
  | { type: 'send_email'; to: string; subject: string; body: string };

export async function enqueue(env: Env, job: Job): Promise<void> {
  await env.JOBS.send(job);
}

export async function handleJob(env: Env, config: Config, job: Job): Promise<void> {
  switch (job.type) {
    case 'generate_tts': {
      const listing = await one<Listing>(env.DB, 'SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', job.listing_id);
      if (!listing || listing.audio_source !== 'tts') return;
      const text = (listing.description_text ?? '').trim();
      if (!text) return;
      const audio = await synthesize(config, text);
      const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
      const key = `listings/${listing.id}/tts-${hexEncode(new Uint8Array(digest)).slice(0, 10)}.mp3`;
      const storage = new Storage(config);
      await storage.putAudio(key, audio);
      if (listing.audio_s3_key && listing.audio_s3_key !== key) {
        await storage.delete(listing.audio_s3_key).catch(() => {});
      }
      // Only mark ready if the description hasn't changed while we were generating.
      await run(
        env.DB,
        `UPDATE listings SET audio_s3_key = ?, audio_status = 'ready', updated_at = datetime('now')
         WHERE id = ? AND audio_source = 'tts' AND TRIM(COALESCE(description_text, '')) = ?`,
        key,
        listing.id,
        text,
      );
      return;
    }
    case 'send_sms':
      if (!job.to || !job.from || !job.body) throw new Error('Incomplete send_sms job payload.');
      await new Telnyx(config).sendSms(job.to, job.from, job.body);
      return;
    case 'send_email':
      if (!job.to || !job.subject || !job.body) throw new Error('Incomplete send_email job payload.');
      await sendEmail(config, job.to, job.subject, job.body);
      return;
    default:
      throw new Error(`Unknown job type: ${(job as { type: string }).type}`);
  }
}

/** Queue consumer: failures retry (5 attempts, 2 minutes apart) and then land in the dead-letter queue. */
export async function consumeBatch(batch: MessageBatch<Job>, env: Env): Promise<void> {
  const config = await Config.load(env);
  for (const message of batch.messages) {
    try {
      await handleJob(env, config, message.body);
      message.ack();
    } catch (err) {
      const job = message.body;
      console.error(`Job ${job?.type} failed (attempt ${message.attempts}): ${(err as Error).message}`);
      if (job?.type === 'generate_tts' && message.attempts >= 5) {
        await run(env.DB, `UPDATE listings SET audio_status = 'failed' WHERE id = ? AND audio_status = 'pending'`, job.listing_id).catch(() => {});
      }
      message.retry();
    }
  }
}
