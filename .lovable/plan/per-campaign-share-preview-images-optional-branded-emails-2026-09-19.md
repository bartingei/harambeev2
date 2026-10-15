# Per-campaign share preview images (+ optional branded emails)

## What happens today

- Sign-up confirmation emails are sent from Lovable's default sender address. Replies to it go nowhere — there is no inbox behind it.
- Campaign links shared on WhatsApp/social carry no image tag, so the preview falls back to a generic screenshot of the app.

## Changes

### 1. Per-campaign link preview image

- **Campaign page (`/campaign/$id`)**: make the page metadata use the loaded campaign's data —
  - `og:title` / `twitter:title`: the campaign title (e.g. "Help Mama Wanjiku Get Surgery — Harambee")
  - `og:description`: a short snippet of the story plus progress ("KES 61,500 raised of KES 150,000")
  - `og:image` / `twitter:image`: the campaign's cover photo as a full https URL
  - `og:type: website`, `twitter:card: summary_large_image`
- **Fallback**: if a campaign has no cover photo (or it fails to load), no image tag is set — WhatsApp then falls back to the generic Harambee page capture, exactly as requested.
- **Share page (`/share/$id`)**: same treatment so its preview also matches the campaign.
- Campaign photos live in private storage; the page already generates a secure temporary https link for the photo — that same link is what goes into the preview tag (valid 7 days, which is fine for shared links).

### 2. Branded auth emails (optional — needs a domain you own)

To send sign-up/password emails from your own address (e.g. `noreply@yourdomain.com`) so replies reach a real inbox:
- You complete the email domain setup (needs a domain you own + DNS records)
- I then brand the six auth email templates (sign-up confirmation, password reset, etc.) with the Harambee look

If you don't have a domain, this step is skipped — emails keep working from the default sender, replies just aren't monitored.

## Technical details

- TanStack `head()` on `campaign.$id.tsx` and `share.$id.tsx` switches from static tags to loader-data-driven tags (`head: ({ loaderData }) => ...`); loaders already fetch the campaign with its signed cover URL.
- No database or storage changes required for part 1.
- Part 2 uses the email setup dialog + branded auth email templates; DNS verification happens in the background and emails activate automatically once verified.
