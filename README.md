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
