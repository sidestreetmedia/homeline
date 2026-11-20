import { afterEach, describe, expect, it, vi } from 'vitest';
import { Billing } from '../src/services/billing';

const agent = {
  id: 7,
  email: 'ann@example.com',
  full_name: 'Ann Agent',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: null,
  stripe_item_id: null,
  stripe_payment_method_id: 'pm_1',
  has_payment_method: 1,
  updated_at: '2026-11-20 13:00:00',
};

/** Just enough D1 for Billing: every SELECT returns the agent, writes are recorded. */
function fakeEnv(row: Record<string, unknown> = agent) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => (/COUNT\(\*\)/.test(sql) ? { c: 3 } : row),
        run: async () => (writes.push({ sql, params }), { meta: {} }),
        all: async () => ({ results: [] }),
      }),
    }),
  };
  return { env: { DB } as any, writes };
}

const config = {
  require: (k: string) => ({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_ID: 'price_1' })[k]!,
  priceCents: () => 500,
} as any;

interface Call {
  method: string;
  path: string;
  body: Record<string, string>;
  idempotencyKey: string | null;
}

/** Stub Stripe: routes are matched by "METHOD /path" and answered from the table. */
function stubStripe(routes: Record<string, (call: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = init.headers as Record<string, string>;
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname.replace('/v1', ''),
      body: Object.fromEntries(new URLSearchParams((init.body as string) ?? url.search)),
      idempotencyKey: headers['Idempotency-Key'] ?? null,
    };
    calls.push(call);
    expect(headers['Stripe-Version']).toBe('2024-06-20');
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) throw new Error(`Unexpected Stripe call: ${call.method} ${call.path}`);
    const [status, json] = handler(call);
    return new Response(JSON.stringify(json), { status });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('first-month charge', () => {
  it('attaches the $5 line to its own invoice and pays it on the saved card', async () => {
    const calls = stubStripe({
      'POST /invoices': () => [200, { id: 'in_1', status: 'draft' }],
      'POST /invoiceitems': () => [200, { id: 'ii_1' }],
      'POST /invoices/in_1/finalize': () => [200, { id: 'in_1', status: 'open' }],
      'POST /invoices/in_1/pay': () => [200, { id: 'in_1', status: 'paid' }],
    });
    const { env } = fakeEnv();
    const invoiceId = await new Billing(env, config).chargeFirstMonth(agent as any, 42, '12 Oak St, Spartanburg, SC');

    expect(invoiceId).toBe('in_1');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /invoices',
      'POST /invoiceitems',
      'POST /invoices/in_1/finalize',
      'POST /invoices/in_1/pay',
    ]);
    expect(calls[0].body).toMatchObject({ customer: 'cus_1', default_payment_method: 'pm_1', 'metadata[kind]': 'first_month', 'metadata[listing_id]': '42' });
    expect(calls[1].body).toMatchObject({ invoice: 'in_1', amount: '500', currency: 'usd' });
    expect(calls[3].body).toMatchObject({ payment_method: 'pm_1', off_session: 'true' });
    // Retried requests can never double-charge the same listing.
    expect(calls[0].idempotencyKey).toBe('first-month-invoice-42');
    expect(calls[1].idempotencyKey).toBe('first-month-item-42');
  });

  it('voids the invoice when the card is declined, so it can never be collected later', async () => {
    const calls = stubStripe({
      'POST /invoices': () => [200, { id: 'in_2', status: 'draft' }],
      'POST /invoiceitems': () => [200, { id: 'ii_2' }],
      'POST /invoices/in_2/finalize': () => [200, { id: 'in_2', status: 'open' }],
      'POST /invoices/in_2/pay': () => [402, { error: { message: 'Your card was declined.', code: 'card_declined' } }],
      'GET /invoices/in_2': () => [200, { id: 'in_2', status: 'open' }],
      'POST /invoices/in_2/void': () => [200, { id: 'in_2', status: 'void' }],
    });
    const { env } = fakeEnv();
    await expect(new Billing(env, config).chargeFirstMonth(agent as any, 43, 'x')).rejects.toMatchObject({ status: 402 });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/invoices/in_2/void' });
  });

  it('refuses to charge without a card on file', async () => {
    stubStripe({});
    const { env } = fakeEnv({ ...agent, has_payment_method: 0, stripe_payment_method_id: null });
    await expect(new Billing(env, config).chargeFirstMonth(agent as any, 44, 'x')).rejects.toThrow('No payment method on file.');
  });

  it('refunds a paid first month when the number cannot be provisioned', async () => {
    const calls = stubStripe({
      'GET /invoices/in_1': () => [200, { id: 'in_1', status: 'paid', payment_intent: 'pi_1' }],
      'POST /refunds': () => [200, { id: 're_1' }],
    });
    const { env } = fakeEnv();
    await new Billing(env, config).refundFirstMonth('in_1');
    expect(calls[1].body).toMatchObject({ payment_intent: 'pi_1' });
    expect(calls[1].idempotencyKey).toBe('first-month-refund-in_1');
  });
});

describe('subscription', () => {
  it('is created at quantity 0, anchored to the 1st, then synced to the billable count without proration', async () => {
    const calls = stubStripe({
      'POST /subscriptions': () => [200, { id: 'sub_1', items: { data: [{ id: 'si_1' }] } }],
      'POST /subscription_items/si_1': () => [200, { id: 'si_1' }],
    });
    const { env, writes } = fakeEnv();
    await new Billing(env, config).syncQuantity(agent as any);

    const create = calls[0].body;
    expect(create).toMatchObject({ customer: 'cus_1', 'items[0][price]': 'price_1', 'items[0][quantity]': '0', proration_behavior: 'none', default_payment_method: 'pm_1' });
    const anchor = new Date(Number(create.billing_cycle_anchor) * 1000);
    expect([anchor.getUTCDate(), anchor.getUTCHours()]).toEqual([1, 0]);
    expect(writes[0].params).toEqual(['sub_1', 'si_1', 7]);
    expect(calls[1].body).toEqual({ quantity: '3', proration_behavior: 'none' });
  });
});
