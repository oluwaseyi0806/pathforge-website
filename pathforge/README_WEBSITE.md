# PathForge website (Design B, v3) — START HERE

"Cut it on screen first" — with the live cutting simulation.
Plain HTML/CSS/JS for Vercel, plus one small server function for sign-ups.

**To set it up, follow `UPGRADE_GUIDE.md` from Part A to Part Q.**

| File / folder | What it is | Do you edit it? |
|---|---|---|
| `site-config.js` | WhatsApp number, Turnstile site key, naira rate, screenshots, video, statistics on/off | **Yes — public settings only** |
| `index.html` | Home page | To change text or prices |
| `about.html`, `refund.html`, `privacy.html`, `terms.html` | Other pages | Review / personalise |
| `api/signup.js` | Server function: checks for spam, saves sign-ups in Supabase | No |
| `supabase-waitlist.sql` | Creates the sign-ups table (paste once into Supabase) | No |
| `downloads/PathForge_STL_Test_Pack.zip` | The free test pack visitors download | Replace when the pack changes |
| `screenshots/` | Put your app screenshots here | Yes (guide Part F) |
| `og-image.png` | Picture shown when the link is shared | Optional |
| `styles.css`, `sim.js`, `site.js` | Look, simulation, behaviour | No |
| `vercel.json`, `robots.txt`, `favicon.svg` | Website settings, security headers, icon | No |
| `UPGRADE_GUIDE.md` | Step-by-step setup and upgrades | **Read this** |
| `UPGRADES.md` | Status of every planned upgrade | Read |

Secret keys (Supabase secret key, Turnstile secret key, later Paystack secret key)
go ONLY in **Vercel → Settings → Environment Variables** — never in these files.
