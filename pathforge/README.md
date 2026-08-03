# PathForge CAM — Website

This is the cleaned-up, corrected version of the storefront. It's a static
site (plain HTML/CSS/JS) so it deploys straight to Vercel with no build step.

## What changed from your original zip

- **Rewrote all the copy.** "Deployment Gate," "Identity Vector," and similar
  jargon are gone. Customers now see plain language: Sign Up, Log In, Pay.
  Confusing checkout copy is one of the fastest ways to lose a sale.
- **Deleted `payment.html`.** It wasn't linked from anywhere, listed a
  different price ($149) than your real pricing, and had fake crypto wallet
  addresses that weren't yours. It was a liability, not a feature — checkout
  now lives entirely on `index.html`.
- **Moved `script.js` into `js/script.js`** so the project has a real folder
  structure as it grows (this is standard practice, not just tidiness).
- **Labeled every fake part clearly.** Sign-up and checkout still work as a
  clickable demo, but now say so on-screen and in code comments, so nobody
  (including future-you) mistakes them for the real thing.
- **Fixed the pricing summary bug** where selecting the Academic (free) tier
  didn't actually hide the card-payment form.

## Project structure

```
pathforge/
├── index.html      <- the whole site: hero, pricing, account, checkout
├── js/
│   └── script.js    <- all interactivity; every TODO marks a future phase
└── README.md        <- this file
```

## What's still fake (on purpose, for now)

Both `handleAuthSubmit()` and `handleCheckoutSubmit()` in `script.js` are
clearly marked `DEMO ONLY`. Nothing is saved to a database, and no money
moves. We're wiring these up for real in later phases:

- **Phase 3** — Supabase real accounts (replaces the fake sign-up)
- **Phase 4/5** — Signed per-tier license keys + your desktop app checking them
- **Phase 6** — Real Paystack + Bitcoin checkout (replaces the fake payment)

## New sections added (this round)

- **Features** — a 4-card strip under the hero
- **How It Works** — 3-step process (Import → Configure → Export)
- **About** — search the file for `[FILL IN]` and swap in your own words
- **Support / FAQ** — answers common pre-sale questions; one `[FILL IN]` for
  your real refund policy
- **Contact** — a `mailto:` link. Search for `[FILL IN]` and swap
  `support@pathforgecam.com` for your real support email once you have one

Search the whole project for `[FILL IN]` before you launch — that's every
spot that needs your real information instead of a placeholder.

## Roadmap phases (for reference)

1. Foundation — domain + hosting
2. Finish payment account setup (Paystack + a Bitcoin processor)
3. Build a real backend (Supabase)
4. Build the license key system
5. Add license checking into the Python app
6. Rebuild checkout to talk to the real backend
7. Legal basics + soft launch

We are working phase 1 first (get this site live on Vercel), then coming
back for the rest in order.
