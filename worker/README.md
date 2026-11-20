# HomeLine on Cloudflare Workers

The same HomeLine — agent sign-up, per-listing Telnyx numbers, spoken tours,
press-1 texts, $5/home Stripe billing, God Mode — running as one Cloudflare
Worker instead of Apache + PHP + MySQL in Docker.

The original LAMP app is still in this repo, untouched, for reference
(`public/`, `src/`, `views/`, `cron/`, `sql/`, `docker/`, the installers).
Nothing under `worker/` depends on it.

## What runs where

| Concern | Before | Now |
|---|---|---|
| Web app | Apache + PHP (`public/`, `views/`) | Hono Worker (`worker/src`) |
| Database | MySQL 8 | D1 `homeline-db` (`worker/schema.sql`) |
| Sessions | `sessions` table | KV `homeline-SESSIONS`, 7-day expiry |
| Background jobs | `jobs` table + every-minute cron | Queue `homeline-jobs` (+ `homeline-jobs-dlq`) |
| Monthly grace-flag sweep | cron on the 1st | Cron Trigger, 06:00 UTC on the 1st |
| Static assets | `public/assets` | Workers Assets (`worker/public`) |

Unchanged outside services: **Telnyx** (numbers, TeXML voice, SMS),
**ElevenLabs** (narration), **AWS S3** (audio, same `listings/<id>/…` keys),
**AWS SES** (notification email), **Stripe** (customers, subscription, invoices).

## Deploy

The D1 database and KV namespace already exist and are wired into
`wrangler.jsonc`; the schema has been applied.

1. Create the two queues (once):
   ```bash
   npx wrangler queues create homeline-jobs
   npx wrangler queues create homeline-jobs-dlq
   ```
2. Set the two secrets (once):
   ```bash
   openssl rand -base64 32 | npx wrangler secret put CONFIG_ENCRYPTION_KEY
   openssl rand -hex 24    | npx wrangler secret put SETUP_TOKEN   # keep a copy for step 4
   ```
   Keep `CONFIG_ENCRYPTION_KEY` somewhere safe: it encrypts every API key saved in God Mode.
3. Deploy: `npm install && npx wrangler deploy` — or connect the repo to Workers
   Builds (root directory `/`, deploy command `npx wrangler deploy`). The custom
   domain `homeline.hellosidestreet.io` is declared in `wrangler.jsonc`.
4. Open `https://homeline.hellosidestreet.io/setup`, enter the setup token, and
   create the God Mode account. The page disappears once a God account exists.
5. In **God Mode → App keys & config**, enter the Telnyx, ElevenLabs, Stripe,
   S3 and SES values (same keys as the PHP portal).
6. Point the outside services at the Worker:
   - **Telnyx TeXML app** — voice URL `…/telnyx_voice`, status callback `…/telnyx_status` (POST).
   - **Telnyx messaging profile** — inbound webhook `…/telnyx_messaging`.
   - **Stripe webhook** — `…/stripe_webhook`, events `checkout.session.completed`,
     `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.

   The old `.php` paths (`/telnyx_voice.php`, `/stripe_webhook.php`, `/login.php`, …)
   are still answered, so existing dashboard settings only need the new hostname.

## Local development

```bash
npm install
printf 'CONFIG_ENCRYPTION_KEY=%s\nSETUP_TOKEN=dev\nALLOW_UNSIGNED_WEBHOOKS=1\n' "$(openssl rand -base64 32)" > .dev.vars
npm run db:init:local
npx wrangler dev --var APP_BASE_URL:http://localhost:8787
npm test            # unit tests
npm run typecheck
```

`ALLOW_UNSIGNED_WEBHOOKS=1` is for local use only. In production, Telnyx and
Stripe webhooks are rejected unless `TELNYX_PUBLIC_KEY` and
`STRIPE_WEBHOOK_SECRET` are configured (the PHP app accepted unsigned webhooks
when those were blank).

## Behaviour changes from the PHP app

- **Failed payments.** The PHP webhook had a duplicated `case`, so
  `invoice.payment_failed` never did anything. It now marks the agent
  **past due** (`agents.billing_status`): they can still sign in and replace
  their card, but can't publish new homes until an invoice is paid. Saving a new
  card retries open invoices. God Mode suspension is separate and still blocks sign-in.
- **Publishing a home** runs as explicit steps instead of one MySQL transaction:
  reserve row → charge first month → buy number → publish. A failed charge buys
  nothing; a failed number purchase **refunds the charge**; a declined card
  voids the invoice so it can't be collected later.
- **First-month invoice.** The $5 line is attached to its own invoice explicitly
  rather than relying on Stripe's default handling of pending invoice items.
- **Passwords** are PBKDF2-SHA256 (WebCrypto). bcrypt hashes from a PHP install
  are not accepted; there was no data to migrate.
- **Password reset / suspension** sign the agent out everywhere immediately.
- **Cancelled subscriptions** are forgotten on `customer.subscription.deleted`,
  so the next publish creates a fresh one.
- **God account** is created at `/setup` instead of `sql/seed_god.sql` / `cron/make_god.php`.
- `DISABLE_SSL`, `AUTO_MIGRATE`, `SEED_GOD` and the `DB_*` variables are gone.

## Layout

```
wrangler.jsonc, package.json, tsconfig.json   Worker project config (repo root)
worker/
├── schema.sql            D1 schema (idempotent)
├── public/assets/        CSS + wordmark
├── src/
│   ├── index.ts          fetch + queue + scheduled handlers
│   ├── lib/              config, crypto (PHP-compatible AES-GCM), sessions, passwords, dates
│   ├── services/         telnyx, stripe, billing, aws (S3 + SES), elevenlabs, jobs, texml, notifications
│   ├── routes/           site, app (dashboard/listings/billing), admin, webhooks
│   └── views/            server-rendered templates
└── test/                 vitest unit tests
```
