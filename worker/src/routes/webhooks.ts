import type { Agent, Listing } from '../env';
import { one, run } from '../lib/db';
import { Storage } from '../services/aws';
import { Billing } from '../services/billing';
import { enqueue } from '../services/jobs';
import { callerRequested } from '../services/notifications';
import { verifyStripeSignature } from '../services/stripe';
import { Telnyx, verifyTelnyxWebhook } from '../services/telnyx';
import { hangupResponse, listingResponse } from '../services/texml';
import type { AppContext } from '../lib/session';
import { getConfig, type App } from './helpers';

const xml = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });

/** Read the raw body once and verify the Telnyx signature over it. */
async function verifiedTelnyxBody(c: AppContext): Promise<string | null> {
  const raw = await c.req.text();
  const config = await getConfig(c);
  const ok = await verifyTelnyxWebhook(raw, c.req.raw.headers, config.get('TELNYX_PUBLIC_KEY'), c.env.ALLOW_UNSIGNED_WEBHOOKS === '1');
  return ok ? raw : null;
}

export function registerWebhookRoutes(app: App): void {
  /* Inbound call: play the listing audio, then offer "press 1". */
  app.post('/telnyx_voice', async (c) => {
    const raw = await verifiedTelnyxBody(c);
    if (raw === null) return c.body(null, 403);
    const form = new URLSearchParams(raw);
    const to = form.get('To') ?? form.get('Called') ?? '';
    const from = form.get('From') ?? '';
    const sid = form.get('CallSid') ?? form.get('CallSidLegacy') ?? '';

    const listing = to
      ? await one<Listing>(c.env.DB, 'SELECT * FROM listings WHERE phone_number = ? AND deleted_at IS NULL LIMIT 1', to)
      : null;
    if (!listing) return xml(hangupResponse('This listing is no longer available. Goodbye.'));

    c.executionCtx.waitUntil(
      run(
        c.env.DB,
        `INSERT INTO call_events (listing_id, phone_number, caller_number, event_type, call_control_id) VALUES (?, ?, ?, 'call', ?)`,
        listing.id,
        to,
        from,
        sid,
      ).catch((err) => console.error(`call log: ${(err as Error).message}`)),
    );

    const config = await getConfig(c);
    const gatherAction = `${config.baseUrl(c.req.url)}/telnyx_gather?listing=${listing.id}`;
    if (listing.audio_status === 'ready' && listing.audio_s3_key) {
      try {
        const audioUrl = await new Storage(config).presignedUrl(listing.audio_s3_key);
        return xml(listingResponse({ gatherAction, audioUrl, fallbackText: '' }));
      } catch (err) {
        console.error(`presign failed: ${(err as Error).message}`);
        return xml(listingResponse({ gatherAction, fallbackText: 'Here is information about this home.' }));
      }
    }
    return xml(
      listingResponse({ gatherAction, fallbackText: listing.description_text || 'Information about this home is being prepared.' }),
    );
  });

  /* Caller pressed a key: on 1, text them the listing blurb. */
  app.post('/telnyx_gather', async (c) => {
    const raw = await verifiedTelnyxBody(c);
    if (raw === null) return c.body(null, 403);
    const form = new URLSearchParams(raw);
    const digits = form.get('Digits') ?? '';
    const from = form.get('From') ?? '';
    const to = form.get('To') ?? form.get('Called') ?? '';
    const listingId = parseInt(c.req.query('listing') ?? '', 10) || 0;

    const listing = await one<Listing>(c.env.DB, 'SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', listingId);
    if (!listing || !listing.phone_number || digits !== '1' || !from) {
      return xml(hangupResponse('Thanks for calling. Goodbye.'));
    }
    try {
      await new Telnyx(await getConfig(c)).sendSms(from, listing.phone_number, listing.sms_blurb);
    } catch (err) {
      console.error(`press1 sms failed: ${(err as Error).message}`);
      return xml(hangupResponse('Sorry, we could not send the text right now. Goodbye.'));
    }
    c.executionCtx.waitUntil(
      (async () => {
        await run(
          c.env.DB,
          `INSERT INTO call_events (listing_id, phone_number, caller_number, event_type) VALUES (?, ?, ?, 'press1_sms')`,
          listing.id,
          to,
          from,
        );
        const agent = await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE id = ?', listing.agent_id);
        if (agent) await callerRequested(c.env, agent, listing, from);
      })().catch((err) => console.error(`press1 follow-up failed: ${(err as Error).message}`)),
    );
    return xml(hangupResponse('Sent. Check your text messages. Goodbye.'));
  });

  /* Inbound text to a listing number: reply with the blurb. */
  app.post('/telnyx_messaging', async (c) => {
    const raw = await verifiedTelnyxBody(c);
    if (raw === null) return c.body(null, 403);
    let event: any = null;
    try {
      event = JSON.parse(raw);
    } catch {
      /* ignored */
    }
    if (event?.data?.event_type !== 'message.received') return c.body(null, 204);
    const payload = event.data.payload ?? {};
    const to = String(payload.to?.[0]?.phone_number ?? '');
    const from = String(payload.from?.phone_number ?? '');
    const listing = to
      ? await one<Listing>(c.env.DB, 'SELECT * FROM listings WHERE phone_number = ? AND deleted_at IS NULL LIMIT 1', to)
      : null;
    if (listing && from) await enqueue(c.env, { type: 'send_sms', to: from, from: to, body: listing.sms_blurb });
    return c.body(null, 204);
  });

  app.post('/telnyx_status', async (c) => {
    const raw = await verifiedTelnyxBody(c);
    return c.body(null, raw === null ? 403 : 204);
  });

  app.post('/stripe_webhook', async (c) => {
    const raw = await c.req.text();
    const config = await getConfig(c);
    const secret = config.get('STRIPE_WEBHOOK_SECRET');
    if (secret) {
      if (!(await verifyStripeSignature(raw, c.req.header('stripe-signature') ?? '', secret))) {
        return c.text('Invalid signature', 400);
      }
    } else if (c.env.ALLOW_UNSIGNED_WEBHOOKS !== '1') {
      return c.text('Webhook secret not configured', 503);
    }
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return c.text('Invalid payload', 400);
    }
    const obj = event?.data?.object ?? {};
    const db = c.env.DB;
    // First-month invoices are handled inline at publish time, so they never change account standing.
    const isFirstMonth = obj?.metadata?.kind === 'first_month';

    switch (event?.type) {
      case 'checkout.session.completed':
        // Capture the card even if the browser never made it back to /billing_return.
        if (obj.mode === 'setup' && obj.id) {
          try {
            await new Billing(c.env, config).captureSavedCardFromSession(obj.id);
          } catch (err) {
            console.error(`webhook capture card: ${(err as Error).message}`);
            return c.text('retry', 500);
          }
        }
        break;
      case 'invoice.payment_failed':
        if (obj.customer && !isFirstMonth) {
          await run(db, `UPDATE agents SET billing_status = 'past_due', updated_at = datetime('now') WHERE stripe_customer_id = ? AND is_god = 0`, obj.customer);
        }
        break;
      case 'invoice.paid':
        if (obj.customer && !isFirstMonth) {
          await run(db, `UPDATE agents SET billing_status = 'ok', updated_at = datetime('now') WHERE stripe_customer_id = ? AND billing_status = 'past_due'`, obj.customer);
        }
        break;
      case 'customer.subscription.deleted':
        // Forget the dead subscription so the next publish creates a fresh one.
        if (obj.id) {
          await run(
            db,
            `UPDATE agents SET stripe_subscription_id = NULL, stripe_item_id = NULL, updated_at = datetime('now') WHERE stripe_subscription_id = ?`,
            obj.id,
          );
        }
        break;
    }
    return c.text('ok');
  });
}
