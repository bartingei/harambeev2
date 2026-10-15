# Harambee Together

Build a mobile-first crowdfunding app called Harambee. The design should be inspired by the Kenyan flag colors — deep forest green, bold black, rich red — but elevated and aesthetic. Think warm, modern, community-feel. Not corporate. Use these as accent colors against clean off-white or warm cream backgrounds. Typography should feel bold but approachable.

Screens to build:

Home/Discovery feed — shows active campaigns as cards. Each card has a campaign photo, title, organizer name, progress bar showing amount raised vs goal, and a donate button.

Campaign detail page — full campaign story, photo header, progress bar, goal amount, days left, donor list showing names and amounts, and a "Donate Now" button that triggers a payment modal (fake the modal, just show M-Pesa number input and confirm button, no real payment).

Create a Campaign page — form with fields for campaign title, story, goal amount, category (medical, education, community, other), and photo upload. Submit button at the bottom.

Share mechanic — after creating a campaign, show a share screen with a campaign link and WhatsApp share button.

No auth screens needed. Keep it clean, warm, and culturally grounded. Make it feel like something Kenyans would actually trust with their money.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://harambeeyetu.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1d690356-a5ec-4d75-839d-d243a4089b32).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## M-Pesa payments (Daraja STK Push)

Donors pay with an M-Pesa prompt on their phone. **Organizers only enter their Buy Goods till number** (Dashboard → Where donations go).

### How it works

1. Harambee collects every donation with its own Daraja account (credentials in server env). An STK push can't target an arbitrary till, only ones under the collecting business's own credentials.
2. A donor enters an amount and phone number. `startDonation` sends the prompt and saves a `payment_requests` row.
3. Safaricom posts the result to `/api/public/mpesa/callback/<MPESA_CALLBACK_SECRET>`. `complete_payment_request` settles it exactly once: it records the donation with its M-Pesa receipt and raises the campaign total. If the callback is late or lost, polling falls back to Daraja's STK status query.
4. Each confirmed payment is owed to the organizer's till (`payment_requests.payout_status = 'pending'`). The dashboard shows what's waiting, on its way, and paid out.
5. Campaigns whose organizer hasn't added a till show "Donations open soon".

### Paying out to organizers (B2B Buy Goods)

Confirmed donations are owed to the organizer's till and paid out automatically in batches:

1. `claim_payout` reserves everything an organizer is owed (once it reaches `MPESA_PAYOUT_MIN`, default KES 100) as one `payouts` row. The database allows only one in-flight payout per organizer.
2. `payouts.server.ts` sends a Daraja **B2B BusinessBuyGoods** transfer from Harambee's shortcode to the till.
3. Safaricom posts the result to `/api/public/mpesa/b2b-result/<secret>`. Success marks the payments `paid` with the M-Pesa receipt. Failure returns them to the owed pool for the next run.
4. A transfer Safaricom *explicitly refused* is released and retried next run. If the outcome is **unknown** (timeout, network error, 5xx) the payout is held as `unknown` and blocks further payouts to that organizer, so nobody is paid twice. Check the transaction in the M-Pesa portal, then set the payout to `success` (and call `complete_payout`) or `failed` (and call `release_unsent_payout`).
5. Triggers: call `POST /api/public/cron/run-payouts` on a schedule (e.g. daily) with `Authorization: Bearer $LOVABLE_CRON_SECRET`, or organizers can press **Pay me now** on their dashboard.

Setup: tick **M-Pesa Sandbox** (B2B) on your Daraja app as well, get an initiator name and password for your shortcode, then generate the credential once:

```
INITIATOR_PASSWORD='...' node scripts/mpesa-security-credential.mjs path/to/safaricom-cert.cer
```

Use the sandbox certificate for sandbox and the production certificate for production, and put the output in `MPESA_SECURITY_CREDENTIAL`. Safaricom charges for B2B transfers, which is why payouts are batched.

### Server environment variables

| Variable | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Already used by the app |
| `MPESA_ENV` | `sandbox` (default) or `production` |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | From your Daraja app |
| `MPESA_SHORTCODE` | Harambee's collection shortcode (the one the passkey belongs to) |
| `MPESA_SHORTCODE_TYPE` | `paybill` (default) or `till` |
| `MPESA_TILL_NUMBER` | Only if type is `till` and differs from the shortcode |
| `MPESA_PASSKEY` | Lipa Na M-Pesa passkey for that shortcode |
| `MPESA_INITIATOR_NAME` | B2B initiator (API operator) username for your shortcode |
| `MPESA_SECURITY_CREDENTIAL` | Output of `scripts/mpesa-security-credential.mjs` |
| `MPESA_PAYOUT_MIN` | Minimum batch to pay out, in KES (default `100`) |
| `LOVABLE_CRON_SECRET` | Set by Lovable; authenticates the payout scheduler |
| `MPESA_CALLBACK_SECRET` | Long random URL-safe string: `openssl rand -hex 24` |
| `PUBLIC_APP_URL` | Public HTTPS origin Safaricom can reach, e.g. `https://harambeeyetu.lovable.app` |

Apply all three `supabase/migrations/20261015*` files to the database, in order.

### Testing in the sandbox

Use shortcode `174379` with the sandbox passkey from the Daraja M-Pesa Express simulator, `MPESA_ENV=sandbox`, and Safaricom's test number. Check success, a cancelled prompt and a timeout: the total should rise only on success.
