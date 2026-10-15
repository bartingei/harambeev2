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

Donors pay with an M-Pesa prompt on their phone. The money goes **straight to the organizer's own Till or Paybill** — Harambee never holds funds. It only records payments Safaricom confirms, so the "raised" counter is real money.

### How it works

1. Organizers connect M-Pesa once, under **Dashboard → M-Pesa payments**: Till (Buy Goods) or Paybill, the name donors see, and their Daraja consumer key, consumer secret and passkey. The keys are checked against Safaricom on save, then encrypted with AES-256-GCM. Only the server can read them.
2. Campaigns whose organizer hasn't connected M-Pesa show **"Donations open soon"**.
3. A donor enters an amount and phone number. `startDonation` sends an STK push and saves a `payment_requests` row.
4. Safaricom posts the result to `/api/public/mpesa/callback/<MPESA_CALLBACK_SECRET>`. `complete_payment_request` settles the request exactly once: it records the donation with its M-Pesa receipt and bumps the campaign total.
5. The donor's screen polls `getDonationStatus`. If the callback is late or lost, it falls back to Daraja's STK status query.

### Server environment variables

| Variable | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Already used by the app (Lovable Cloud sets it) |
| `MPESA_ENV` | `sandbox` (default) or `production` |
| `MPESA_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32`. Don't change it once organizers have saved keys. |
| `MPESA_CALLBACK_SECRET` | Long random URL-safe string: `openssl rand -hex 24` |
| `PUBLIC_APP_URL` | Public HTTPS origin Safaricom can reach, e.g. `https://harambeeyetu.lovable.app` |

Apply `supabase/migrations/20261015120000_mpesa_stk_payments.sql` to the database.

### Testing in the sandbox

1. Create an app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) with **M-Pesa Express** and copy its consumer key and secret.
2. In the dashboard choose **Paybill** and enter shortcode `174379`, any account number, and the sandbox passkey from the Daraja M-Pesa Express simulator page.
3. Donate to one of your campaigns using the sandbox test number shown on the Daraja portal. Then check three cases: success, cancelling the prompt, and ignoring it until it times out. The total should go up only on success.

Going live means `MPESA_ENV=production`, plus each organizer's production Daraja app for their own shortcode.
