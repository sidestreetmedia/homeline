import type { Agent, Listing } from '../env';
import { randomHex } from '../lib/bytes';
import { firstOfNextMonth, graceFor, shortDate } from '../lib/dates';
import { all, one, run } from '../lib/db';
import { Storage } from '../services/aws';
import { Billing } from '../services/billing';
import { enqueue } from '../services/jobs';
import { homeAdded, homeDeleted } from '../services/notifications';
import { StripeError } from '../services/stripe';
import { Telnyx } from '../services/telnyx';
import { billingView, dashboardView, listingEditView } from '../views/app';
import { csrfFailed, field, getConfig, readForm, redirectWith, render, requireAgent, type App } from './helpers';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** MP3 files start with an ID3 tag or an MPEG audio frame sync. */
function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0;
}

export function registerAppRoutes(app: App): void {
  app.get('/dashboard', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const config = await getConfig(c);
    const listings = await all<Listing>(
      c.env.DB,
      `SELECT * FROM listings WHERE agent_id = ? AND deleted_at IS NULL AND billing_state <> 'provisioning'
       ORDER BY state ASC, city ASC, address_line1 ASC`,
      me.id,
    );
    return render(
      c,
      'Your listings — HomeLine',
      dashboardView({
        listings,
        activeCount: await Billing.activeHouseCount(c.env.DB, me.id),
        priceCents: config.priceCents(),
        nextBill: shortDate(firstOfNextMonth(new Date())),
        hasCard: Billing.hasPaymentMethod(me),
        pastDue: me.billing_status === 'past_due',
        csrf: c.get('session').csrfToken(),
        flashOk: c.req.query('ok'),
      }),
    );
  });

  /* ------------------------------ Billing ------------------------------ */

  app.get('/billing', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const hasCard = Billing.hasPaymentMethod(me);
    let cardLabel: string | null = null;
    if (hasCard) {
      try {
        cardLabel = await new Billing(c.env, await getConfig(c)).cardLabel(me);
      } catch {
        /* non-fatal */
      }
    }
    return render(
      c,
      'Billing — HomeLine',
      billingView({
        hasCard,
        pastDue: me.billing_status === 'past_due',
        cardLabel,
        csrf: c.get('session').csrfToken(),
        error: c.req.query('err'),
      }),
    );
  });

  app.post('/billing', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    if (!c.get('session').csrfValid(form.csrf)) return csrfFailed(c);
    try {
      const config = await getConfig(c);
      const url = await new Billing(c.env, config).createSetupCheckout(me, config.baseUrl(c.req.url));
      return c.redirect(url);
    } catch (err) {
      console.error(`createSetupCheckout: ${(err as Error).message}`);
      return redirectWith(c, '/billing', 'err', 'Could not start card setup. Check billing configuration.');
    }
  });

  app.get('/billing_return', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const sessionId = c.req.query('session_id') ?? '';
    if (c.req.query('status') !== 'success' || !sessionId) {
      return redirectWith(c, '/billing', 'err', 'Card setup was cancelled.');
    }
    try {
      const billing = new Billing(c.env, await getConfig(c));
      const pmId = await billing.captureSavedCardFromSession(sessionId, me.id);
      if (!pmId) return redirectWith(c, '/billing', 'err', 'We could not confirm your card. Please try again.');
      try {
        await billing.ensureSubscription(me);
        if (me.billing_status === 'past_due') await billing.retryOpenInvoices(me.id);
      } catch (err) {
        console.error(`post-card billing setup: ${(err as Error).message}`);
      }
      return redirectWith(c, '/dashboard', 'ok', 'Card saved. You can now add homes.');
    } catch (err) {
      console.error(`billing_return capture failed: ${(err as Error).message}`);
      return redirectWith(c, '/billing', 'err', 'Something went wrong saving your card.');
    }
  });

  /* ------------------------------ Listings ----------------------------- */

  const ownListing = (db: D1Database, id: number, agentId: number) =>
    one<Listing>(
      db,
      `SELECT * FROM listings WHERE id = ? AND agent_id = ? AND deleted_at IS NULL AND billing_state <> 'provisioning'`,
      id,
      agentId,
    );

  const publishGate = (me: Agent): string | null => {
    if (!Billing.hasPaymentMethod(me)) return 'Add a card before publishing a home.';
    if (me.billing_status === 'past_due') return 'Update your card before publishing another home.';
    return null;
  };

  app.get('/listing_edit', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const id = parseInt(c.req.query('id') ?? '', 10);
    let listing: Listing | null = null;
    if (id) {
      listing = await ownListing(c.env.DB, id, me.id);
      if (!listing) return c.text('Not found', 404);
    } else {
      const blocked = publishGate(me);
      if (blocked) return redirectWith(c, '/billing', 'err', blocked);
    }
    const uploadErr = { size: 'That file is larger than 15 MB.', type: 'Please upload an MP3 file.', upload: 'The upload failed. Please try again.' }[
      c.req.query('err') ?? ''
    ];
    return render(
      c,
      `${listing ? 'Edit home' : 'Add a home'} — HomeLine`,
      listingEditView({ listing, isNew: !listing, csrf: c.get('session').csrfToken(), error: uploadErr }),
    );
  });

  app.post('/listing_save', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    const session = c.get('session');
    if (!session.csrfValid(form.csrf)) return csrfFailed(c);
    const db = c.env.DB;

    const id = parseInt(field(form, 'id'), 10) || null;
    const input = {
      address_line1: field(form, 'address_line1'),
      address_line2: field(form, 'address_line2') || null,
      city: field(form, 'city'),
      state: field(form, 'state').toUpperCase().slice(0, 2),
      postal_code: field(form, 'postal_code'),
      audio_source: (field(form, 'audio_source') === 'upload' ? 'upload' : 'tts') as 'tts' | 'upload',
      description_text: field(form, 'description_text'),
      sms_blurb: field(form, 'sms_blurb'),
    };
    const errBack = (message: string) =>
      render(
        c,
        `${id ? 'Edit home' : 'Add a home'} — HomeLine`,
        listingEditView({ listing: id ? { ...input, id } : input, isNew: !id, csrf: session.csrfToken(), error: message }),
      );

    if (!input.address_line1 || !input.city || !input.state || !input.postal_code || !input.sms_blurb) {
      return errBack('Please complete all required fields.');
    }
    if (input.audio_source === 'tts' && !input.description_text) {
      return errBack('Add a spoken description, or switch to uploading a recording.');
    }
    if ([...input.sms_blurb].length > 280) return errBack('The press-1 message is too long.');

    /* ----------------------------- Update ----------------------------- */
    if (id) {
      const listing = await ownListing(db, id, me.id);
      if (!listing) return c.text('Not found', 404);
      const descChanged = input.audio_source === 'tts' && input.description_text !== (listing.description_text ?? '').trim();
      const sourceChanged = input.audio_source !== listing.audio_source;
      const regenerate = input.audio_source === 'tts' && (descChanged || sourceChanged);
      await run(
        db,
        `UPDATE listings SET address_line1 = ?, address_line2 = ?, city = ?, state = ?, postal_code = ?,
            audio_source = ?, description_text = ?, sms_blurb = ?,
            audio_status = CASE WHEN ? = 1 THEN 'pending' ELSE audio_status END,
            updated_at = datetime('now')
         WHERE id = ?`,
        input.address_line1,
        input.address_line2,
        input.city,
        input.state,
        input.postal_code,
        input.audio_source,
        input.description_text,
        input.sms_blurb,
        regenerate ? 1 : 0,
        id,
      );
      if (regenerate) await enqueue(c.env, { type: 'generate_tts', listing_id: id });
      return redirectWith(c, '/dashboard', 'ok', 'Listing updated.');
    }

    /* ----------------------------- Create ----------------------------- */
    // D1 can't hold a transaction open across the Stripe and Telnyx calls, so this
    // runs as explicit steps, each undone if a later one fails.
    const blocked = publishGate(me);
    if (blocked) return redirectWith(c, '/billing', 'err', blocked);

    const chosen = field(form, 'chosen_number');
    if (!/^\+1\d{10}$/.test(chosen)) return errBack('Choose a phone number for this home.');

    const config = await getConfig(c);
    const billing = new Billing(c.env, config);
    const telnyx = new Telnyx(config);
    try {
      await billing.ensureSubscription(me);
    } catch (err) {
      console.error(`ensureSubscription: ${(err as Error).message}`);
      return errBack('We could not set up billing. Please add a payment method and try again.');
    }

    // Step 1: reserve the listing row (hidden until it is fully provisioned).
    const inserted = await run(
      db,
      `INSERT INTO listings (agent_id, address_line1, address_line2, city, state, postal_code,
                             description_text, sms_blurb, audio_source, audio_status, billing_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'provisioning')`,
      me.id,
      input.address_line1,
      input.address_line2,
      input.city,
      input.state,
      input.postal_code,
      input.description_text,
      input.sms_blurb,
      input.audio_source,
    );
    const newId = Number(inserted.meta.last_row_id);
    const discard = () => run(db, `DELETE FROM listings WHERE id = ? AND billing_state = 'provisioning'`, newId).catch(() => {});

    // Step 2: charge the first month. Must succeed before any number is bought.
    let invoiceId: string;
    try {
      invoiceId = await billing.chargeFirstMonth(me, newId, `${input.address_line1}, ${input.city}, ${input.state}`);
    } catch (err) {
      await discard();
      console.error(`Listing create: first-month charge failed: ${(err as Error).message}`);
      const declined = err instanceof StripeError && err.status === 402;
      return errBack(
        declined
          ? 'Your card was declined, so the home was not published. Update your card under Billing and try again.'
          : 'We could not publish this home. Please try again or contact support.',
      );
    }

    // Step 3: buy the number. If that fails, refund the charge from step 2.
    let bought: Awaited<ReturnType<Telnyx['purchase']>>;
    try {
      bought = await telnyx.purchase(chosen);
    } catch (err) {
      console.error(`Listing create: number purchase failed: ${(err as Error).message}`);
      await billing.refundFirstMonth(invoiceId).catch((e) => console.error(`REFUND FAILED for invoice ${invoiceId}: ${(e as Error).message}`));
      await discard();
      return errBack('That number could not be provisioned, so your card was refunded. Please pick another number.');
    }

    // Step 4: publish.
    const grace = graceFor(new Date());
    try {
      await run(
        db,
        `UPDATE listings SET phone_number = ?, telnyx_number_id = ?, telnyx_order_id = ?, first_charge_id = ?,
                             active_until = ?, skip_next_recurring = ?, billing_state = 'active', updated_at = datetime('now')
         WHERE id = ?`,
        bought.phone,
        bought.numberId,
        bought.orderId,
        invoiceId,
        grace.activeUntil,
        grace.withinGrace ? 1 : 0,
        newId,
      );
    } catch (err) {
      console.error(`Listing create: publish failed: ${(err as Error).message}`);
      await telnyx.release(bought.numberId, bought.phone).catch(() => {});
      await billing.refundFirstMonth(invoiceId).catch((e) => console.error(`REFUND FAILED for invoice ${invoiceId}: ${(e as Error).message}`));
      await discard();
      return errBack('We could not publish this home. Please try again or contact support.');
    }

    // Follow-ups never block the publish.
    try {
      await billing.syncQuantity(me);
    } catch (err) {
      console.error(`syncQuantity: ${(err as Error).message}`);
    }
    try {
      if (input.audio_source === 'tts') await enqueue(c.env, { type: 'generate_tts', listing_id: newId });
      const published = await one<Listing>(db, 'SELECT * FROM listings WHERE id = ?', newId);
      if (published) await homeAdded(c.env, config, me, published);
    } catch (err) {
      console.error(`Post-publish queueing failed: ${(err as Error).message}`);
    }
    return redirectWith(c, '/dashboard', 'ok', `Home published. Number ${bought.phone} is live.`);
  });

  app.post('/listing_delete', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    if (!c.get('session').csrfValid(form.csrf)) return csrfFailed(c);
    const listing = await ownListing(c.env.DB, parseInt(field(form, 'id'), 10) || 0, me.id);
    if (!listing) return c.redirect('/dashboard');
    const config = await getConfig(c);

    // Released the moment the listing is deleted.
    if (listing.phone_number) {
      try {
        await new Telnyx(config).release(listing.telnyx_number_id, listing.phone_number);
      } catch (err) {
        console.error(`Number release failed for ${listing.phone_number}: ${(err as Error).message}`);
      }
    }
    if (listing.audio_s3_key) {
      try {
        await new Storage(config).delete(listing.audio_s3_key);
      } catch (err) {
        console.error(`S3 delete failed: ${(err as Error).message}`);
      }
    }
    // Soft delete. The current month is already paid (no refund); the home drops out of the next count.
    await run(
      c.env.DB,
      `UPDATE listings SET deleted_at = datetime('now'), billing_state = 'ended', phone_number = NULL,
                           telnyx_number_id = NULL, telnyx_order_id = NULL, updated_at = datetime('now')
       WHERE id = ?`,
      listing.id,
    );
    try {
      await new Billing(c.env, config).syncQuantity(me);
    } catch (err) {
      console.error(`syncQuantity on delete: ${(err as Error).message}`);
    }
    try {
      await homeDeleted(c.env, config, me, listing);
    } catch (err) {
      console.error(`Home-deleted notification queue failed: ${(err as Error).message}`);
    }
    return redirectWith(c, '/dashboard', 'ok', 'Home deleted and number released. You are billed through this month.');
  });

  app.get('/numbers_search', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return c.json({ ok: false, error: 'Please sign in again.' }, 401);
    const area = (c.req.query('area') ?? '').replace(/\D/g, '');
    if (area.length !== 3) return c.json({ ok: false, error: 'Enter a 3-digit area code.' }, 400);
    try {
      const numbers = await new Telnyx(await getConfig(c)).searchLocal(area, 10);
      if (numbers.length === 0) return c.json({ ok: false, error: 'No numbers available in that area code.' });
      return c.json({ ok: true, numbers });
    } catch (err) {
      console.error(`Number search failed: ${(err as Error).message}`);
      return c.json({ ok: false, error: 'Search failed. Try another area code.' }, 500);
    }
  });

  app.post('/audio_upload', async (c) => {
    const me = await requireAgent(c);
    if (me instanceof Response) return me;
    const declared = parseInt(c.req.header('content-length') ?? '0', 10);
    if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) return c.text('File too large.', 413);
    const form = await readForm(c);
    if (!c.get('session').csrfValid(form.csrf)) return csrfFailed(c);
    const id = parseInt(field(form, 'id'), 10) || 0;
    const listing = await ownListing(c.env.DB, id, me.id);
    if (!listing) return c.text('Not found', 404);

    const back = (err?: string) => c.redirect(`/listing_edit?id=${id}${err ? `&err=${err}` : ''}`);
    const file = form.audio;
    if (!(file instanceof File)) return back();
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return back('size');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeMp3(bytes)) return back('type');

    const key = `listings/${id}/audio-${randomHex(6)}.mp3`;
    try {
      const storage = new Storage(await getConfig(c));
      await storage.putAudio(key, bytes);
      await run(
        c.env.DB,
        `UPDATE listings SET audio_source = 'upload', audio_s3_key = ?, audio_status = 'ready', updated_at = datetime('now') WHERE id = ?`,
        key,
        id,
      );
      if (listing.audio_s3_key) await storage.delete(listing.audio_s3_key).catch(() => {});
    } catch (err) {
      console.error(`Audio upload failed: ${(err as Error).message}`);
      return back('upload');
    }
    return redirectWith(c, '/dashboard', 'ok', 'Recording uploaded.');
  });
}
