<?php
declare(strict_types=1);

use Stripe\StripeClient;

/**
 * Billing model (confirmed with the customer):
 *
 *  - One Stripe customer + one subscription per agent.
 *  - The subscription has a single recurring item priced at $5/month, with
 *    quantity = number of active houses. It renews on the 1st of each month
 *    (we anchor the billing cycle to the 1st).
 *  - When a house is added: we immediately charge $5 out-of-band for that
 *    house's first month (a one-off invoice billed now, NOT prorated), and we
 *    bump the subscription quantity by 1 with proration disabled so the
 *    recurring meter reflects the new house starting next cycle.
 *  - When a house is deleted mid-cycle: we decrement the quantity (no refund,
 *    no proration). The listing stays live until active_until, then ends.
 *  - "At least one month billed" is guaranteed by the upfront out-of-band
 *    charge: even add-then-delete-same-day has already paid one month.
 */
final class Billing
{
    private static ?StripeClient $client = null;

    private static function stripe(): StripeClient
    {
        if (self::$client instanceof StripeClient) {
            return self::$client;
        }
        self::$client = new StripeClient(Config::require('STRIPE_SECRET_KEY'));
        return self::$client;
    }

    private static function priceId(): string
    {
        return Config::require('STRIPE_PRICE_ID'); // $5/month recurring price
    }

    /** Ensure the agent has a Stripe customer. Returns customer id. */
    public static function ensureCustomer(array $agent): string
    {
        if (!empty($agent['stripe_customer_id'])) {
            return $agent['stripe_customer_id'];
        }
        $cust = self::stripe()->customers->create([
            'email' => $agent['email'],
            'name'  => $agent['full_name'],
            'metadata' => ['agent_id' => (string) $agent['id']],
        ]);
        DB::run("UPDATE agents SET stripe_customer_id = :c WHERE id = :id", [
            ':c' => $cust->id, ':id' => $agent['id'],
        ]);
        return $cust->id;
    }

    /* --------------------------------------------------------------------- */
    /* Payment method capture (Stripe Checkout, setup mode)                  */
    /* --------------------------------------------------------------------- */

    /**
     * Create a Stripe Checkout session that collects and saves a card without
     * charging it. On completion Stripe attaches the card to the customer and
     * we mark it as the customer's default in handleCheckoutCompleted().
     */
    public static function createSetupCheckout(array $agent): string
    {
        $customerId = self::ensureCustomer($agent);
        $base = rtrim(Config::require('APP_BASE_URL'), '/');

        $session = self::stripe()->checkout->sessions->create([
            'mode'        => 'setup',
            'customer'    => $customerId,
            'currency'    => 'usd',
            'payment_method_types' => ['card'],
            'success_url' => $base . '/billing_return.php?status=success&session_id={CHECKOUT_SESSION_ID}',
            'cancel_url'  => $base . '/billing_return.php?status=cancel',
            'metadata'    => ['agent_id' => (string) $agent['id']],
        ]);
        return $session->url;
    }

    /**
     * Given a completed setup Checkout session, capture the saved card, attach
     * it to the customer, and make it the default for BOTH one-off invoices and
     * the subscription. Idempotent. Returns the payment method id.
     */
    public static function captureSavedCardFromSession(string $sessionId): ?string
    {
        $session = self::stripe()->checkout->sessions->retrieve($sessionId, []);
        if (($session->mode ?? '') !== 'setup' || empty($session->setup_intent)) {
            return null;
        }
        $setupIntent = self::stripe()->setupIntents->retrieve($session->setup_intent, []);
        $pmId = $setupIntent->payment_method ?? null;
        if (!$pmId) {
            return null;
        }
        $customerId = (string) ($session->customer ?? '');
        $agentId    = (int) ($session->metadata->agent_id ?? 0);
        if ($customerId === '' || $agentId === 0) {
            return null;
        }
        return self::setDefaultPaymentMethod($agentId, $customerId, (string) $pmId);
    }

    /**
     * Attach a payment method to a customer and set it as the default for
     * invoices and any existing subscription. Persists locally.
     */
    public static function setDefaultPaymentMethod(int $agentId, string $customerId, string $pmId): string
    {
        // Attach (no-op if already attached).
        try {
            self::stripe()->paymentMethods->attach($pmId, ['customer' => $customerId]);
        } catch (\Stripe\Exception\InvalidRequestException $e) {
            // Already attached to this customer — ignore.
        }

        // Default for one-off invoices.
        self::stripe()->customers->update($customerId, [
            'invoice_settings' => ['default_payment_method' => $pmId],
        ]);

        // Default for the subscription too, if one exists.
        $agent = DB::one("SELECT * FROM agents WHERE id = :id", [':id' => $agentId]);
        if ($agent && !empty($agent['stripe_subscription_id'])) {
            try {
                self::stripe()->subscriptions->update($agent['stripe_subscription_id'], [
                    'default_payment_method' => $pmId,
                ]);
            } catch (Throwable $e) {
                error_log('set sub default pm: ' . $e->getMessage());
            }
        }

        DB::run(
            "UPDATE agents SET stripe_payment_method_id = :pm, has_payment_method = 1 WHERE id = :id",
            [':pm' => $pmId, ':id' => $agentId]
        );
        return $pmId;
    }

    /** Does the agent have a usable card on file? */
    public static function hasPaymentMethod(array $agent): bool
    {
        return !empty($agent['has_payment_method']) && !empty($agent['stripe_payment_method_id']);
    }

    /**
     * Ensure the agent has an active subscription with the per-house item.
     * Quantity starts at 0; we raise it as houses are added.
     * Billing cycle is anchored to the 1st of next month.
     * The saved card (if any) is set as the subscription's default so renewals
     * charge it automatically and off-session.
     */
    public static function ensureSubscription(array $agent): array
    {
        $agent = DB::one("SELECT * FROM agents WHERE id = :id", [':id' => $agent['id']]);
        if (!empty($agent['stripe_subscription_id']) && !empty($agent['stripe_item_id'])) {
            return [
                'subscription_id' => $agent['stripe_subscription_id'],
                'item_id'         => $agent['stripe_item_id'],
            ];
        }
        $customerId = self::ensureCustomer($agent);

        // Anchor to the 1st of next month so recurring charges land on the 1st.
        $firstOfNextMonth = (new DateTimeImmutable('first day of next month', new DateTimeZone('UTC')))
            ->setTime(0, 0, 0)
            ->getTimestamp();

        $params = [
            'customer' => $customerId,
            'items'    => [[ 'price' => self::priceId(), 'quantity' => 0 ]],
            'billing_cycle_anchor' => $firstOfNextMonth,
            'proration_behavior'   => 'none',
            'collection_method'    => 'charge_automatically',
            'payment_behavior'     => 'allow_incomplete',
            'off_session'          => true,
            'metadata' => ['agent_id' => (string) $agent['id']],
        ];
        // Pin the saved card as the subscription default when present.
        if (!empty($agent['stripe_payment_method_id'])) {
            $params['default_payment_method'] = $agent['stripe_payment_method_id'];
        }

        $sub = self::stripe()->subscriptions->create($params);
        $itemId = $sub->items->data[0]->id;

        DB::run(
            "UPDATE agents SET stripe_subscription_id = :s, stripe_item_id = :i WHERE id = :id",
            [':s' => $sub->id, ':i' => $itemId, ':id' => $agent['id']]
        );
        return ['subscription_id' => $sub->id, 'item_id' => $itemId];
    }

    /** Count active (non-deleted, not ended) houses for an agent. */
    public static function activeHouseCount(int $agentId): int
    {
        $row = DB::one(
            "SELECT COUNT(*) AS c FROM listings
             WHERE agent_id = :a AND deleted_at IS NULL AND billing_state <> 'ended'",
            [':a' => $agentId]
        );
        return (int) ($row['c'] ?? 0);
    }

    /**
     * Count houses that should be billed at the NEXT recurring renewal.
     * Houses added within the grace window (skip_next_recurring=1) already paid
     * an out-of-band first month very close to the renewal, so they are excluded
     * from this one upcoming renewal's quantity.
     */
    public static function billableHouseCount(int $agentId): int
    {
        $row = DB::one(
            "SELECT COUNT(*) AS c FROM listings
             WHERE agent_id = :a AND deleted_at IS NULL AND billing_state <> 'ended'
                   AND skip_next_recurring = 0",
            [':a' => $agentId]
        );
        return (int) ($row['c'] ?? 0);
    }

    /** Sync the subscription quantity to the current billable house count. */
    public static function syncQuantity(array $agent): void
    {
        $ref = self::ensureSubscription($agent);
        $qty = self::billableHouseCount((int) $agent['id']);
        self::stripe()->subscriptionItems->update($ref['item_id'], [
            'quantity'           => $qty,
            'proration_behavior' => 'none',
        ]);
    }

    /**
     * Charge the immediate first month for one house, out of band, against the
     * agent's saved card (off-session). Returns the invoice id. Throws if no
     * card is on file or the charge can't be collected.
     */
    public static function chargeFirstMonth(array $agent, int $listingId, string $addressLabel): string
    {
        $agent = DB::one("SELECT * FROM agents WHERE id = :id", [':id' => $agent['id']]);
        if (!self::hasPaymentMethod($agent)) {
            throw new RuntimeException('No payment method on file.');
        }
        $customerId = self::ensureCustomer($agent);
        $pmId   = $agent['stripe_payment_method_id'];
        $amount = (int) Config::get('PRICE_CENTS', '500'); // $5.00

        // One-off invoice item, then invoice + pay immediately on the saved card.
        self::stripe()->invoiceItems->create([
            'customer'    => $customerId,
            'amount'      => $amount,
            'currency'    => 'usd',
            'description' => "First month — {$addressLabel}",
            'metadata'    => ['listing_id' => (string) $listingId, 'kind' => 'first_month'],
        ]);

        $invoice = self::stripe()->invoices->create([
            'customer'              => $customerId,
            'collection_method'     => 'charge_automatically',
            'default_payment_method'=> $pmId,
            'auto_advance'          => true,
            'metadata'              => ['listing_id' => (string) $listingId, 'kind' => 'first_month'],
        ]);
        $invoice = self::stripe()->invoices->finalizeInvoice($invoice->id);
        if ($invoice->status !== 'paid') {
            // Pay off-session against the saved card.
            $invoice = self::stripe()->invoices->pay($invoice->id, [
                'payment_method' => $pmId,
                'off_session'    => true,
            ]);
        }
        if ($invoice->status !== 'paid') {
            throw new RuntimeException("First-month charge not paid (status {$invoice->status}).");
        }
        return $invoice->id;
    }
}
