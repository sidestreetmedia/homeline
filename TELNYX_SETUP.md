# Telnyx setup for HomeLine

HomeLine uses the Telnyx v2 Numbers and Messaging APIs plus a TeXML application
for the call flow. Configure these resources once before publishing listings.

## 1. Create a TeXML application

In the Telnyx Mission Control Portal, create a TeXML application with:

- Friendly name: `HomeLine`
- Voice URL: `https://YOUR_DOMAIN/telnyx_voice.php`
- Voice method: `POST`
- Status callback: `https://YOUR_DOMAIN/telnyx_status.php`
- Status callback method: `POST`

Copy the application ID. HomeLine supplies it as `connection_id` when ordering a
number so incoming calls are routed into the listing lookup and press-1 flow.

## 2. Create a messaging profile

Create a Messaging Profile with its inbound webhook set to:

```
https://YOUR_DOMAIN/telnyx_messaging.php
```

Copy the profile ID. HomeLine assigns every ordered number to this profile.
Outbound US SMS may require 10DLC or toll-free verification, depending on the
number type and use case.

## 3. Add HomeLine configuration

In **God Mode → App keys & config**, set:

- `APP_BASE_URL` — public HTTPS origin, without a trailing slash
- `TELNYX_API_KEY` — Telnyx API v2 key
- `TELNYX_TEXML_APP_ID` — ID from step 1
- `TELNYX_MESSAGING_PROFILE_ID` — ID from step 2
- `TELNYX_PUBLIC_KEY` — webhook public key from Keys & Credentials

The public key enables Ed25519 verification on TeXML and Messaging callbacks.
HomeLine also rejects signed callbacks more than five minutes old.

## 4. Existing installations

The Docker entrypoint runs `sql/migrate_telnyx.sql` automatically when
`AUTO_MIGRATE=1`. For a bare LAMP install, run:

```bash
mysql -u homeline -p homeline < sql/migrate_telnyx.sql
```

The migration renames the old provider-specific columns without deleting
listings. Existing Twilio numbers are identifiers only and are **not** ported or
released automatically; move or release those numbers with the providers before
putting the migrated app into production.

## 5. Smoke test

1. Search an area code and publish one test listing.
2. Confirm the number appears under Telnyx **My Numbers** and is assigned to both
   the HomeLine TeXML application and messaging profile.
3. Call it and press 1 during playback.
4. Confirm the SMS arrives and the dashboard/admin call totals increment.
5. Delete the test listing and verify the number is released in Telnyx.
