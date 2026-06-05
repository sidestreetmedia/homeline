# HomeLine

**Listings that talk.** A multi-tenant web app that lets real estate agents put a
phone number on a yard sign. A passerby calls, hears a spoken description of the
home, and can press **1** to receive the details by text message.

Built to run as a standard **LAMP** application (Apache + PHP + MySQL), packaged
as a Docker container for easy deployment on a dedicated server.

---

## What it does

- **Agent sign-up** with email/password accounts (multi-tenant — each agent only
  sees their own listings).
- **Per-listing local phone numbers**: an agent searches by area code, picks an
  available local number, and it's purchased automatically through Twilio. One
  number per listing. The number is **released the moment the listing is deleted**.
- **Call flow**: caller dials the number → hears the home's audio description →
  is prompted to **press 1** → receives the listing's custom text blurb by SMS.
- **Two audio options per listing**:
  1. **Generated narration** — the agent types a description and ElevenLabs
     text-to-speech produces a natural-sounding recording, **generated once and
     cached in Amazon S3** for fast, cheap playback.
  2. **Uploaded recording** — the agent uploads their own MP3 instead.
- **One default voice** for all generated narration (configurable).
- **Listings grouped and sorted by address** under each agent.
- **Stripe billing** at **$5/month per home** (details below).
- **Card on file required**: agents must save a credit card (via Stripe Checkout)
  before they can publish a home. The same saved card is charged automatically for
  the immediate first-month invoice and for every recurring subscription renewal.
- **God-mode admin portal** for the operator to manage agents, suspend/reactivate
  accounts, rotate API keys, and view platform-wide stats.
- **Apple "Liquid Glass" UI** — translucent, blurred glass panels with specular
  highlights and an atmospheric animated background, following Apple's Human
  Interface Guidelines aesthetic.

---

## Billing model

One Stripe **customer** and one Stripe **subscription** per agent. The
subscription carries a single recurring **$5/month** price whose **quantity =
the number of active homes**. The cycle is anchored to the **1st of the month**.

### Card on file (required)

Before an agent can publish any home, they must save a credit card. This is
collected through **Stripe Checkout in `setup` mode** — the agent is redirected to
Stripe, enters their card, and Stripe returns a saved payment method. The app
never touches the card number (PCI stays with Stripe). On completion the card is:

- **attached** to the agent's Stripe customer,
- set as the customer's **`invoice_settings.default_payment_method`** (so the
  out-of-band first-month invoices charge it), and
- set as the subscription's **`default_payment_method`** (so monthly renewals
  charge it).

Both the immediate first-month invoice and the recurring subscription charge this
**same card automatically and off-session**. The card capture happens both on the
browser redirect (`billing_return.php`) and via the `checkout.session.completed`
webhook, so it's recorded even if the agent closes the tab before returning.

Agents can replace the card anytime from the **Billing** page; the new card
becomes the default for invoices and the subscription immediately.

The rules, exactly as specified:

1. **Billed on Save.** The instant an agent saves a new home, a **$5 charge is
   collected immediately, out of band** (a one-off invoice, not prorated). This
   guarantees **at least one month is always billed** per home — even if the home
   is added and deleted the same day.
2. **Recurring on the 1st.** Each month on the 1st, the subscription renews and
   bills **$5 × (number of active homes)**.
3. **Delete mid-cycle = no refund.** Deleting a home releases its phone number
   immediately and removes it from next month's count, but the current month
   that was already paid is **not refunded**. The subscription quantity is
   decremented with proration disabled.
4. **4-day grace window.** If a home is added **within 4 days of the 1st of the
   next month**, its upfront $5 already covers that near-future period, so the
   **next recurring renewal is skipped** for that home (it's excluded from the
   renewal quantity once, then resumes normally the following month). The home
   simply stays live one extra month. This avoids double-charging a home that
   was added a day or two before a renewal.

The grace flag is cleared automatically by the cron worker on the 1st, which
then re-syncs the agent's subscription quantity so the *following* renewal
includes those homes.

---

## Architecture

```
Browser ── Apache/PHP (public/) ──┬── MySQL 8        (tenants, listings, jobs, sessions, config)
                                  ├── Twilio API     (number search/purchase/release, voice, SMS)
                                  ├── ElevenLabs API (text-to-speech)
                                  ├── Amazon S3      (cached audio)
                                  └── Stripe API     (customers, subscriptions, invoices)

cron/worker.php (every minute) ──► drains the jobs table (TTS generation),
                                   clears billing grace flags on the 1st,
                                   cleans up old sessions.
```

### Why a job queue?

Generating ElevenLabs audio takes a few seconds and shouldn't block the agent's
Save request, so it's pushed to a lightweight DB-backed **jobs** table and run by
a cron worker. On standard shared LAMP there's no daemonized worker, so the
worker is a simple, idempotent script invoked once a minute by cron — it works
identically inside the container and on bare shared hosting.

### Directory layout

```
.
├── Dockerfile                 Apache + PHP 8.2 image with baked-in cron
├── docker-compose.yml         App + MySQL for one-command local/dev bring-up
├── composer.json              Stripe, Twilio, AWS SDKs
├── .env.example               All configuration / secrets
├── sql/
│   ├── schema.sql             Full database schema
│   └── seed_god.sql           Seeds the initial God-mode account
├── src/                       Application library (PSR-style autoloaded)
│   ├── bootstrap.php           Autoload, helpers, view(), enqueue()
│   ├── Config.php              Env + DB-backed config (editable in God mode)
│   ├── DB.php                  PDO singleton + query helpers
│   ├── Http.php                cURL wrapper (used by ElevenLabs)
│   ├── Auth.php                Sign-up, login, sessions, CSRF, God gate
│   ├── DbSessionHandler.php    DB-backed PHP sessions
│   ├── Telephony.php           Twilio: search / purchase / release / SMS
│   ├── ElevenLabs.php          Text-to-speech synthesis
│   ├── Storage.php             S3 put / delete / presigned URLs
│   └── Billing.php             Stripe customer/subscription/invoice logic
├── views/                     HTML templates (Liquid Glass)
├── public/                    Web document root
│   ├── index.php login.php signup.php logout.php
│   ├── dashboard.php
│   ├── billing.php billing_return.php       (card on file via Stripe Checkout)
│   ├── listing_edit.php listing_save.php listing_delete.php
│   ├── numbers_search.php          (AJAX number search)
│   ├── audio_upload.php
│   ├── twilio_voice.php twilio_gather.php twilio_sms.php twilio_status.php
│   ├── stripe_webhook.php
│   └── admin/                      God-mode portal
│       ├── index.php config.php agent_action.php
├── cron/
│   ├── worker.php             Job queue drainer + scheduled maintenance
│   └── make_god.php           CLI to create/promote a God account
└── docker/
    ├── entrypoint.sh          Waits for DB, migrates, seeds, starts cron+Apache
    └── cron.d/homeline        Crontab entry (worker every minute)
```

---

## Tools & services used

| Concern            | Technology                                            |
|--------------------|-------------------------------------------------------|
| Web server         | Apache 2.4 (`php:8.2-apache` base image)              |
| Language           | PHP 8.2                                                |
| Database           | MySQL 8.0 (PDO)                                        |
| Telephony          | **Twilio** PHP SDK (`twilio/sdk`)                     |
| Text-to-speech     | **ElevenLabs** REST API (via cURL)                    |
| Audio storage      | **Amazon S3** (`aws/aws-sdk-php`)                     |
| Payments           | **Stripe** PHP SDK (`stripe/stripe-php`)             |
| Background jobs    | DB-backed queue drained by **cron**                   |
| UI                 | Hand-written CSS — Apple **Liquid Glass** aesthetic   |
| Packaging          | **Docker** + Docker Compose                           |

---

## System requirements

Targets **Ubuntu 24.04 LTS (Noble)** as the host. The application itself runs in
a container, so the host only needs Docker; the versions inside the image are
fixed by the `Dockerfile`.

**Host machine (recommended minimum):**

- Ubuntu 24.04 LTS, 64-bit (also fine on 22.04 LTS)
- 1 vCPU (2 recommended), 2 GB RAM (4 GB recommended), ~5 GB free disk
- Outbound HTTPS to Twilio, ElevenLabs, Stripe, and AWS
- A public DNS name and inbound 80/443 (directly or via a tunnel/reverse proxy),
  because Twilio and Stripe must reach the webhooks

**Host software:**

- Docker Engine 24+ and the Docker Compose plugin (v2)
- `openssl` (for generating the encryption key) — preinstalled on Ubuntu
- `git` if cloning rather than unzipping

**What runs inside the container (no need to install on the host):**

- PHP 8.2 (Apache `mod_php`) with extensions `pdo_mysql`, `mysqli`, `curl`,
  `simplexml`, `zip`, `fileinfo`, `openssl`
- Composer 2 (build stage only; pulls the Stripe, Twilio, and AWS SDKs)
- `cron` (runs the background worker every minute)

**External managed dependency:**

- MySQL 8.0 — provided by the `db` service in `docker-compose.yml`, or point the
  app at your own managed MySQL/MariaDB (MySQL 8.0+ / MariaDB 10.6+).

> **Bare-metal (no Docker) note:** if you run on a plain LAMP host instead of the
> container, you need Ubuntu's `apache2`, `mysql-server` (8.0+), `php` 8.2+ with
> the extensions listed above, `composer`, and `cron`. See
> *Install on bare LAMP* below.

---

## External accounts & keys

- **Twilio** — Account SID + Auth Token, with a funded balance / number purchasing
  enabled. Numbers are bought automatically when an agent picks one.
- **ElevenLabs** — API key, and a Voice ID for the default narration voice.
- **Stripe** — Secret key, a **$5/month recurring Price** (create it in the Stripe
  dashboard and copy its `price_…` ID), and a webhook signing secret.
- **AWS** — an IAM key/secret with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
  on your audio bucket, and the bucket name + region.
- A **public HTTPS URL** for the app (Twilio and Stripe must reach the webhooks).

---

## Publishing to GitHub

The repo includes a `.gitignore` that keeps secrets (`.env`,
`INITIAL_GOD_PASSWORD.txt`) and `vendor/` out of version control. Note that
`sql/seed_god.sql` contains only a **one-way bcrypt hash** of the initial
password, which is safe to commit; the plaintext lives only in the ignored
`INITIAL_GOD_PASSWORD.txt`.

To create the repo and push (run locally, so your token stays on your machine):

```bash
cd homeline
git init -b main
git add .
git commit -m "Initial commit: HomeLine"

# Option A — GitHub CLI (prompts for auth):
gh repo create homeline --private --source=. --remote=origin --push

# Option B — create an empty repo in the web UI first, then:
git remote add origin https://github.com/<owner>/homeline.git
git push -u origin main
```

Once pushed, update the `REPO_URL` default in `scripts/install.sh` (or pass
`HOMELINE_REPO=`) so the one-command installer points at your repo.

---

## Install & run (Docker — recommended)

### One-command install (fresh Ubuntu server)

On a brand-new Ubuntu 24.04 box, this installs Docker, fetches the project,
generates secrets, and starts everything:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/homeline/main/scripts/install.sh | sudo bash
```

(Replace `<owner>` with your GitHub org/user once the repo is pushed.) The script
is **idempotent** — re-running it updates the code and preserves your generated
`CONFIG_ENCRYPTION_KEY` and database password, so you won't orphan encrypted
config. It installs to `/opt/homeline`, writes a locked-down `.env`, brings the
stack up, waits for health, then prints the URL and the God-mode login.

Environment overrides (optional):

```bash
HOMELINE_REPO=https://github.com/<owner>/homeline.git \
HOMELINE_BRANCH=main \
HOMELINE_DIR=/opt/homeline \
HOMELINE_PORT=8080 \
  sudo -E bash -c "$(curl -fsSL https://raw.githubusercontent.com/<owner>/homeline/main/scripts/install.sh)"
```

After it finishes, put the app behind HTTPS and enter your API keys in the
God-mode portal (see below). The manual steps follow if you'd rather do it
yourself.

### Manual install

#### 0. Prepare a fresh Ubuntu 24.04 host

Install Docker Engine + the Compose plugin from Docker's official repository
(Ubuntu's built-in `docker.io` package also works but is older):

```bash
# System up to date
sudo apt-get update && sudo apt-get upgrade -y

# Prerequisites
sudo apt-get install -y ca-certificates curl gnupg git

# Docker's official GPG key + repo
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Engine + Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in afterward to apply)
sudo usermod -aG docker "$USER"

# Verify
docker --version && docker compose version
```

### Deploy the app

1. **Clone / unzip** the project and enter it.

2. **Create your `.env`:**

   ```bash
   cp .env.example .env
   ```

   Set `DB_PASS`, and generate an encryption key for stored API keys:

   ```bash
   openssl rand -base64 32        # paste into CONFIG_ENCRYPTION_KEY in .env
   ```

   That's all `.env` needs — the API keys themselves (Twilio, ElevenLabs, Stripe,
   AWS, `APP_BASE_URL`) are entered later in the God-mode portal, where they're
   stored encrypted.

3. **Build and start:**

   ```bash
   docker compose up -d --build
   ```

   On first boot the container waits for MySQL, applies `sql/schema.sql`, and (if
   `SEED_GOD=1`, the default) seeds the God-mode account.

4. **Open the app** at `http://localhost:8080` (or your mapped domain).

5. **Sign in to God mode** with the seeded credentials (see below), go to
   **God Mode → App keys & config**, and enter all your API keys there
   (Twilio, ElevenLabs, Stripe, AWS, and the public `APP_BASE_URL`). **The portal
   is the source of truth for these** — they're stored in the database, so you
   rotate or change keys here without touching the server or redeploying. The
   page shows which keys are still unset and lets you clear any value.

### Configuration model: portal vs environment

There are two tiers of settings:

- **Infrastructure (environment only):** the database connection (`DB_HOST`,
  `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`) plus `AUTO_MIGRATE` / `SEED_GOD`.
  These *must* be in the environment — the app can't read the database to learn
  how to connect to the database. Set once at deploy time in `.env`.
- **Application / API keys (God-mode portal):** Twilio, ElevenLabs, Stripe, AWS,
  `APP_BASE_URL`, `DISABLE_SSL`, `PRICE_CENTS`. These are managed at
  `/admin/config.php` and stored in the `app_config` table. A value set in the
  portal always wins. (If a matching environment variable happens to be present
  it's used only as a fallback before the portal value is saved — handy for an
  automated first boot — but you're expected to manage these in the portal.)

If a feature's key isn't configured yet, agent-facing pages show a clear
"this feature isn't configured" message instead of erroring, and the config
screen lists exactly which keys are missing.

### Encryption at rest

Portal-managed values are **encrypted in the database with AES-256-GCM**. The
master key lives only in the environment as `CONFIG_ENCRYPTION_KEY`, so a database
dump on its own reveals nothing — an attacker would also need the env key.

- Generate a key with `openssl rand -base64 32` (or `php cron/gen_key.php`) and
  set it as `CONFIG_ENCRYPTION_KEY`. Base64, 64-char hex, or an arbitrary
  passphrase are all accepted (a passphrase is hashed to 32 bytes).
- Stored values use the format `enc:v1:<base64(iv|tag|ciphertext)>`. Each write
  uses a fresh random IV, and the GCM auth tag detects tampering.
- **Backward compatible:** any pre-existing plaintext rows are still read
  normally and are transparently upgraded to ciphertext the next time that key is
  saved in the portal.
- The config screen shows whether encryption is active. If no key is set, values
  are stored as plaintext and the screen warns you.
- **Keep the key stable and backed up.** Changing or losing it makes existing
  encrypted values unreadable (they'll show as unset, and you'd re-enter them).
  This key is the one secret that must stay in the environment alongside the DB
  credentials.

### Putting it behind HTTPS

Apache in the container listens on port 80 (mapped to 8080). In production, put it
behind a TLS terminator — e.g. a Cloudflare Tunnel, an nginx/Caddy reverse proxy,
or a load balancer — and set `APP_BASE_URL` to the public `https://…` address.
If TLS is terminated upstream, set `DISABLE_SSL=1` so session cookies aren't
marked Secure-only behind the proxy.

### Webhook URLs to configure

The app points Twilio voice/SMS webhooks at itself automatically when it buys a
number. For Stripe, add a webhook endpoint in the Stripe dashboard pointing to:

```
https://YOUR_DOMAIN/stripe_webhook.php
```

and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

---

## Install on bare LAMP / shared hosting (no Docker)

The app is plain PHP and runs on a standard LAMP stack too. On **Ubuntu 24.04**:

```bash
# Apache, MySQL, PHP 8.x + required extensions, Composer
sudo apt-get update
sudo apt-get install -y \
  apache2 mysql-server \
  php php-cli php-mysql php-curl php-xml php-zip php-mbstring libapache2-mod-php \
  composer git

# Enable the Apache modules the app expects
sudo a2enmod rewrite headers
sudo systemctl restart apache2

# Secure MySQL and create the database + user
sudo mysql_secure_installation   # optional but recommended
sudo mysql <<'SQL'
CREATE DATABASE homeline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'homeline'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON homeline.* TO 'homeline'@'localhost';
FLUSH PRIVILEGES;
SQL
```

Then deploy the app:

1. Copy the project to the server (e.g. `/var/www/homeline`) and point your Apache
   **document root at the `public/` subdirectory**. The included `public/.htaccess`
   handles routing and protects dotfiles; make sure `AllowOverride All` is set for
   that directory.
2. Install dependencies:

   ```bash
   cd /var/www/homeline
   composer install --no-dev --optimize-autoloader
   ```

   If the host lacks Composer, run it locally and upload the resulting `vendor/`.
3. Import the schema and seed the God account:

   ```bash
   mysql -u homeline -p homeline < sql/schema.sql
   mysql -u homeline -p homeline < sql/seed_god.sql
   ```
4. Provide the **infrastructure** settings (`DB_*`, `CONFIG_ENCRYPTION_KEY`) as
   environment variables Apache passes to PHP — e.g. in the vhost with
   `SetEnv`, or in a `.htaccess`:

   ```apache
   SetEnv DB_HOST 127.0.0.1
   SetEnv DB_NAME homeline
   SetEnv DB_USER homeline
   SetEnv DB_PASS change-me
   SetEnv CONFIG_ENCRYPTION_KEY <openssl rand -base64 32 output>
   ```

   All API keys (Twilio, ElevenLabs, Stripe, AWS, `APP_BASE_URL`) are entered
   later in the God-mode portal — not here.
5. Add a **cron job** running the worker every minute (as the web user so file
   permissions match):

   ```bash
   sudo crontab -u www-data -e
   # add:
   * * * * * php /var/www/homeline/cron/worker.php >> /var/log/homeline-cron.log 2>&1
   ```
6. Confirm the PHP extensions `pdo_mysql`, `curl`, `simplexml`, `mbstring`, `zip`,
   `fileinfo`, and `openssl` are enabled (`php -m`). All ship with Ubuntu's PHP
   packages above.
7. Put Apache behind HTTPS (e.g. `sudo apt-get install -y certbot
   python3-certbot-apache && sudo certbot --apache`) so Twilio and Stripe can
   reach the webhooks, and set `APP_BASE_URL` to that `https://…` address in the
   portal.

---

## God-mode admin

The God portal lives at `/admin/`. A God account is a normal agent row with
`is_god = 1`. From there you can:

- See platform stats (agents, active homes, MRR, calls, press-1 texts).
- Suspend / reactivate agents (suspended agents can't log in).
- Edit all API keys and app configuration (`/admin/config.php`). Secret fields are
  masked; leave the dots in place to keep the current value.

### Create or promote a God account later

```bash
# inside the container
docker compose exec app php cron/make_god.php somelogin --name="Their Name"
# or with a chosen password
docker compose exec app php cron/make_god.php somelogin --password="..." --name="..."
```

It prints the login and password. If the login already exists, it's promoted to
God mode and its password reset.

---

## Initial God-mode credentials

The seeded first administrator account:

```
Login:    joshuakuhn
Password: (delivered separately — see the chat message accompanying this build)
```

> **Change this password immediately after first sign-in.** The login is a bare
> username (`joshuakuhn`); the login form accepts either a username or an email.
> You can update the account's real email later. To rotate the password from the
> CLI: `docker compose exec app php cron/make_god.php joshuakuhn --name="Joshua Kuhn"`.

---

## Operational notes & limitations

- **Twilio costs are real.** Buying a number and sending SMS bills your Twilio
  account. The app releases numbers on listing deletion to stop ongoing charges.
- **Card on file is enforced.** Agents are routed to Stripe Checkout at sign-up
  and can't reach the "Add a home" flow until a card is saved. The out-of-band $5
  charge on Save runs against that saved card off-session; if it somehow fails
  (e.g. card declined later), the listing is rolled back and any number bought
  mid-transaction is released. A declined recurring renewal suspends the agent
  (via the `invoice.payment_failed` webhook) until a successful payment.
- **3-D Secure edge case.** Off-session charges for cards that later require
  authentication can fail with `authentication_required`. The Checkout setup flow
  captures most banks' mandates up front, but for affected cards you'd surface a
  Stripe-hosted confirmation. This isn't wired into the UI yet.
- **Audio is cached, not regenerated per call.** Editing a listing's description
  re-queues generation; the old S3 object is replaced.
- **Presigned audio URLs** are short-lived (20 min) and generated fresh for each
  call, so the S3 bucket can stay private.
- **Single default voice** is set by `ELEVENLABS_VOICE_ID`.
- The cron worker is intentionally simple (one row at a time, retries up to 5×
  with backoff). For very high volume, move generation to a real queue/worker.

---

## License / ownership

Built for Sidestreet. All third-party SDKs retain their respective licenses.
