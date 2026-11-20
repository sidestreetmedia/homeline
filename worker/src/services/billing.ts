import type { Agent, Env } from '../env';
import type { Config } from '../lib/config';
import { firstOfNextMonth } from '../lib/dates';
import { one, run } from '../lib/db';
import { Stripe, StripeError } from './stripe';

/**
 * Billing model (unchanged from the PHP app):
 *  - One Stripe customer + one subscription per agent, renewing on the 1st.
 *  - Subscription quantity = number of billable homes at $5/month.
 *  - Adding a home charges the first month immediately, out of band, not prorated.
 *  - Deleting a home decrements the quantity with no refund and no proration.
 */
export class Billing {
  private readonly stripe: Stripe;

  constructor(
    private readonly env: Env,
    private readonly config: Config,
  ) {
    this.stripe = new Stripe(config.require('STRIPE_SECRET_KEY'));
  }

  private get db() {
    return this.env.DB;
  }

  private fresh(agentId: number): Promise<Agent | null> {
    return one<Agent>(this.db, 'SELECT * FROM agents WHERE id = ?', agentId);
  }

  static hasPaymentMethod(agent: Agent): boolean {
    return !!agent.has_payment_method && !!agent.stripe_payment_method_id;
  }

  async ensureCustomer(agent: Agent): Promise<string> {
    if (agent.stripe_customer_id) return agent.stripe_customer_id;
    const customer = await this.stripe.post(
      '/customers',
      { email: agent.email, name: agent.full_name, metadata: { agent_id: String(agent.id) } },
      `customer-agent-${agent.id}`,
    );
    await run(this.db, `UPDATE agents SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?`, customer.id, agent.id);
    agent.stripe_customer_id = customer.id;
    return customer.id;
  }

  /** Stripe Checkout in setup mode: collects and saves a card without charging it. */
  async createSetupCheckout(agent: Agent, baseUrl: string): Promise<string> {
    const customerId = await this.ensureCustomer(agent);
    const session = await this.stripe.post('/checkout/sessions', {
      mode: 'setup',
      customer: customerId,
      currency: 'usd',
      payment_method_types: ['card'],
      success_url: `${baseUrl}/billing_return?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing_return?status=cancel`,
      metadata: { agent_id: String(agent.id) },
    });
    return session.url;
  }

  /**
   * Capture the saved card from a completed setup Checkout session and make it
   * the default for one-off invoices and the subscription. Idempotent.
   * When expectedAgentId is given (browser return), the session must belong to that agent.
   */
  async captureSavedCardFromSession(sessionId: string, expectedAgentId?: number): Promise<string | null> {
    const session = await this.stripe.get(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (session.mode !== 'setup' || !session.setup_intent) return null;
    const setupIntent = await this.stripe.get(`/setup_intents/${encodeURIComponent(session.setup_intent)}`);
    const pmId: string | null = setupIntent.payment_method ?? null;
    const customerId = String(session.customer ?? '');
    const agentId = parseInt(session.metadata?.agent_id ?? '0', 10) || 0;
    if (!pmId || !customerId || !agentId) return null;
    if (expectedAgentId !== undefined && agentId !== expectedAgentId) return null;
    const agent = await this.fresh(agentId);
    if (!agent || agent.stripe_customer_id !== customerId) return null;
    return this.setDefaultPaymentMethod(agent, customerId, pmId);
  }

  async setDefaultPaymentMethod(agent: Agent, customerId: string, pmId: string): Promise<string> {
    try {
      await this.stripe.post(`/payment_methods/${encodeURIComponent(pmId)}/attach`, { customer: customerId });
    } catch (err) {
      if (!(err instanceof StripeError) || err.status !== 400) throw err; // already attached
    }
    await this.stripe.post(`/customers/${encodeURIComponent(customerId)}`, {
      invoice_settings: { default_payment_method: pmId },
    });
    if (agent.stripe_subscription_id) {
      try {
        await this.stripe.post(`/subscriptions/${encodeURIComponent(agent.stripe_subscription_id)}`, {
          default_payment_method: pmId,
        });
      } catch (err) {
        console.error(`set sub default pm: ${(err as Error).message}`);
      }
    }
    await run(
      this.db,
      `UPDATE agents SET stripe_payment_method_id = ?, has_payment_method = 1, updated_at = datetime('now') WHERE id = ?`,
      pmId,
      agent.id,
    );
    return pmId;
  }

  async cardLabel(agent: Agent): Promise<string | null> {
    if (!agent.stripe_payment_method_id) return null;
    try {
      const pm = await this.stripe.get(`/payment_methods/${encodeURIComponent(agent.stripe_payment_method_id)}`);
      if (!pm.card) return null;
      const brand = String(pm.card.brand ?? '');
      const exp = `${String(pm.card.exp_month).padStart(2, '0')}/${pm.card.exp_year}`;
      return `${brand.charAt(0).toUpperCase()}${brand.slice(1)} •••• ${pm.card.last4}  (exp ${exp})`;
    } catch {
      return null;
    }
  }

  /** One subscription per agent, quantity starting at 0, anchored to the 1st of next month. */
  async ensureSubscription(agentRef: Agent): Promise<{ subscriptionId: string; itemId: string }> {
    const agent = (await this.fresh(agentRef.id)) ?? agentRef;
    if (agent.stripe_subscription_id && agent.stripe_item_id) {
      return { subscriptionId: agent.stripe_subscription_id, itemId: agent.stripe_item_id };
    }
    const customerId = await this.ensureCustomer(agent);
    const params: Record<string, unknown> = {
      customer: customerId,
      items: [{ price: this.config.require('STRIPE_PRICE_ID'), quantity: 0 }],
      billing_cycle_anchor: Math.floor(firstOfNextMonth(new Date()).getTime() / 1000),
      proration_behavior: 'none',
      collection_method: 'charge_automatically',
      payment_behavior: 'allow_incomplete',
      off_session: true,
      metadata: { agent_id: String(agent.id) },
    };
    if (agent.stripe_payment_method_id) params.default_payment_method = agent.stripe_payment_method_id;
    // The idempotency key stops two concurrent requests from creating two subscriptions.
    const sub = await this.stripe.post('/subscriptions', params, `subscription-agent-${agent.id}-${agent.updated_at}`);
    const itemId: string = sub.items.data[0].id;
    await run(
      this.db,
      `UPDATE agents SET stripe_subscription_id = ?, stripe_item_id = ?, updated_at = datetime('now') WHERE id = ?`,
      sub.id,
      itemId,
      agent.id,
    );
    return { subscriptionId: sub.id, itemId };
  }

  /** Published, non-deleted homes. */
  static async activeHouseCount(db: D1Database, agentId: number): Promise<number> {
    const row = await one<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM listings WHERE agent_id = ? AND deleted_at IS NULL AND billing_state NOT IN ('ended','provisioning')`,
      agentId,
    );
    return row?.c ?? 0;
  }

  /** Homes billed at the NEXT renewal: excludes ones inside the grace window. */
  static async billableHouseCount(db: D1Database, agentId: number): Promise<number> {
    const row = await one<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM listings
       WHERE agent_id = ? AND deleted_at IS NULL AND billing_state NOT IN ('ended','provisioning') AND skip_next_recurring = 0`,
      agentId,
    );
    return row?.c ?? 0;
  }

  async syncQuantity(agent: Agent): Promise<void> {
    const ref = await this.ensureSubscription(agent);
    const quantity = await Billing.billableHouseCount(this.db, agent.id);
    await this.stripe.post(`/subscription_items/${encodeURIComponent(ref.itemId)}`, {
      quantity,
      proration_behavior: 'none',
    });
  }

  /**
   * Charge one home's first month now against the saved card. Returns the paid invoice id.
   * The invoice is created first and the line item attached to it explicitly, so the
   * charge never depends on Stripe's default handling of pending invoice items.
   */
  async chargeFirstMonth(agentRef: Agent, listingId: number, addressLabel: string): Promise<string> {
    const agent = await this.fresh(agentRef.id);
    if (!agent || !Billing.hasPaymentMethod(agent)) throw new Error('No payment method on file.');
    const customerId = await this.ensureCustomer(agent);
    const pmId = agent.stripe_payment_method_id!;
    const metadata = { listing_id: String(listingId), kind: 'first_month' };

    let invoice = await this.stripe.post(
      '/invoices',
      {
        customer: customerId,
        collection_method: 'charge_automatically',
        default_payment_method: pmId,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        metadata,
      },
      `first-month-invoice-${listingId}`,
    );
    try {
      await this.stripe.post(
        '/invoiceitems',
        {
          customer: customerId,
          invoice: invoice.id,
          amount: this.config.priceCents(),
          currency: 'usd',
          description: `First month — ${addressLabel}`,
          metadata,
        },
        `first-month-item-${listingId}`,
      );
      invoice = await this.stripe.post(`/invoices/${invoice.id}/finalize`, { auto_advance: false });
      if (invoice.status !== 'paid') {
        invoice = await this.stripe.post(`/invoices/${invoice.id}/pay`, { payment_method: pmId, off_session: true });
      }
      if (invoice.status !== 'paid') throw new Error(`First-month charge not paid (status ${invoice.status}).`);
      return invoice.id;
    } catch (err) {
      await this.abandonInvoice(invoice.id);
      throw err;
    }
  }

  /** Make sure a failed first-month invoice can't be collected later. */
  private async abandonInvoice(invoiceId: string): Promise<void> {
    try {
      const invoice = await this.stripe.get(`/invoices/${invoiceId}`);
      if (invoice.status === 'draft') await this.stripe.del(`/invoices/${invoiceId}`);
      else if (invoice.status === 'open') await this.stripe.post(`/invoices/${invoiceId}/void`);
    } catch (err) {
      console.error(`abandon invoice ${invoiceId}: ${(err as Error).message}`);
    }
  }

  /** After a past-due agent saves a new card, retry whatever is still open. */
  async retryOpenInvoices(agentId: number): Promise<void> {
    const agent = await this.fresh(agentId);
    if (!agent?.stripe_customer_id || !agent.stripe_payment_method_id) return;
    const open = await this.stripe.get('/invoices', { customer: agent.stripe_customer_id, status: 'open', limit: 10 });
    for (const invoice of open.data ?? []) {
      try {
        await this.stripe.post(`/invoices/${invoice.id}/pay`, { payment_method: agent.stripe_payment_method_id, off_session: true });
      } catch (err) {
        console.error(`retry invoice ${invoice.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Refund a paid first-month invoice when provisioning fails after the charge. */
  async refundFirstMonth(invoiceId: string): Promise<void> {
    const invoice = await this.stripe.get(`/invoices/${invoiceId}`);
    if (invoice.status !== 'paid' || !invoice.payment_intent) return;
    await this.stripe.post(
      '/refunds',
      { payment_intent: invoice.payment_intent, reason: 'requested_by_customer', metadata: { kind: 'provisioning_failed' } },
      `first-month-refund-${invoiceId}`,
    );
  }
}
