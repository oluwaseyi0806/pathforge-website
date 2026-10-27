# Website upgrades — status (Design B, v3)

For HOW to do each one, see `UPGRADE_GUIDE.md`.

As your senior developer, in the order that matters most for SALES.
"I can build" = send me the word and I'll do it in one session.

## A. Before you share the link with anyone (must-do)

| # | Upgrade | Why it matters | Who |
|---|---|---|---|
| 1 | Add your WhatsApp number in `site-config.js` | Nobody can contact you or join the waitlist without it | You (2 min) |
| 2 | Connect Supabase (README Part 3) | Every sign-up saved in one list you can export | You (10 min) |
| 3 | Deploy to Vercel via GitHub (README Part 4) | Puts the site online | You (20 min) |
| 4 | **Spam protection on the waitlist** (Cloudflare Turnstile, free) | Bots will flood an open form with fake sign-ups | ✅ built (add keys: guide D) |
| 5 | **Phone menu** (a small slide-out menu) | On phones the How it works / Pricing / FAQ links are hidden today | ✅ built |
| 6 | Read `terms.html` + `privacy.html`; lawyer review before taking money | Legal protection | You |

## B. Trust — makes a stranger believe the software is real

| # | Upgrade | Why | Who |
|---|---|---|---|
| 7 | **Real screenshots of the app** (main window, green PASSED report) | Visitors want to see the actual program | ✅ slot built (add pictures: guide F) |
| 8 | **60–90 s demo video** under the hero (YouTube embed or link) | The #1 thing that sells software | ✅ slot built (add link: guide G) |
| 9 | **Free "STL test pack" download for email** | Turns visitors into contacts, proves quality | ✅ built |
| 10 | Photos/video of a real test cut (wax, wood or foam) | Proof it works on a real machine | You + a workshop |
| 11 | About page: who builds PathForge and why | People buy from people | ✅ drafted (personalise: guide J) |
| 12 | Testimonials from beta testers (real, with permission) | Social proof | Later |

## C. Get found on Google and look good when shared

| # | Upgrade | Why | Who |
|---|---|---|---|
| 13 | Your own domain + business email (`support@yourdomain`) | Trust; email looks professional | You (buy), I guide |
| 14 | Share image (og:image 1200×630) from a simulation frame | Nice preview on WhatsApp, X, LinkedIn | ✅ built (full URL: guide I) |
| 15 | `sitemap.xml` + Google Search Console | Google finds and ranks the pages | I can build (needs the domain) |
| 16 | Software "structured data" (name, price, OS) | Google can show price/rating in results | ✅ built |
| 17 | Help pages / tutorials ("STL to GRBL G-code", "How to set zero") | Free visitors from Google every month | I write drafts |

## D. Selling — turn the waitlist into payments

| # | Upgrade | Why | Who |
|---|---|---|---|
| 18 | **Paystack checkout** with server-side payment check (Vercel functions) | Card, bank transfer, USSD — paid safely | I can build (needs your Paystack keys) |
| 19 | **Automatic licence key** on the thank-you page + by email | Instant delivery, no waiting for you | I can build (uses your licensing system) |
| 20 | Download page: Windows installer (code-signed), system requirements | Professional, no "unknown publisher" warning | I build installer; you buy the certificate |
| 21 | "My licences" page (email login): re-download, resend key | Fewer support messages | I can build |
| 22 | Crypto checkout (stablecoins via a processor) | Buyers outside Africa | I can build |
| 23 | Refund policy page | Required by payment providers; lowers buyer risk | ✅ drafted 14-day (decide: guide K) |
| 24 | Prices shown in USD with a naira estimate | Clear for local buyers | ✅ built (set rate: guide E) |

## E. Keep it fast, safe and measurable

| # | Upgrade | Why | Who |
|---|---|---|---|
| 25 | Vercel Web Analytics (+ one line in privacy notice) | See visitors → pricing → sign-ups | ✅ built (switch on: guide H) |
| 26 | Lighthouse audit (speed, accessibility, SEO ≥ 90) and test on a cheap Android phone on slow data | Many buyers browse on mobile data | I can do |
| 27 | Security headers (Content Security Policy) | Blocks injected scripts | ✅ built |
| 28 | Free uptime monitor (UptimeRobot) | Know when the site is down | You (5 min) |

## Recommended order of the next sessions

1. You: steps 1–3 (site online).  →  2. Me: 4, 5, 14 (spam guard, phone menu, share image).
3. You: screenshots + video.  →  4. Me: 7–9 (add them, test-pack download).
5. Domain + email.  →  6. Me: 15–17.
7. Paystack verified  →  Me: 18, 19, 21, 23, 24.  →  8. Installer + 20.
