# PathForge website — upgrade guide, A to Z (no domain yet)

Do the parts **in order**. Each part says how long it takes and how to check it worked.
You need: your computer, internet, VS Code, and your phone.
Your website folder: `D:\PathForge\website` (Part A puts it there).

> **Golden rule about keys:** a *public* key (site key, WhatsApp number) goes in
> `site-config.js`. A *secret* key goes ONLY in Vercel's **Environment Variables**.
> Never paste a secret key into any file, chat or screenshot.

---

## A. Get the files ready (5 min)

1. Download **PathForge_Website_v3.zip** from our chat.
2. In File Explorer open `D:\PathForge` → right-click empty space → **New → Folder** → name it `website`.
3. Right-click the zip → **Extract All…** → choose `D:\PathForge\website` → **Extract**.
4. In VS Code: **File → Open Folder…** → choose the folder that contains `index.html`.
5. Look at it: in File Explorer, double-click `index.html`. The site opens in your browser.
   (Forms only fully work once it's online — that's normal.)

✅ Check: you see "Cut it on screen first." and the simulation cutting the block.

---

## B. Put the website online (20 min)

### B1. GitHub (stores your files + a free backup)
1. Go to **github.com** → **Sign up** (or sign in).
2. Top-right **+** → **New repository**.
3. Name: `pathforge-website` · choose **Private** · click **Create repository**.
4. On the next page click the link **uploading an existing file**.
5. Open `D:\PathForge\website\...` (the folder with `index.html`), press **Ctrl + A**
   to select everything (including the `api`, `downloads`, `screenshots` folders), and
   drag it all onto the GitHub page.
6. Wait until every file is listed → click **Commit changes**.

✅ Check: the repository shows `index.html`, `api`, `downloads`… in the list.

### B2. Vercel (puts it on the internet, free)
1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**.
2. **Add New… → Project** → find `pathforge-website` → **Import**.
3. *Framework Preset*: **Other**. Don't change anything else → **Deploy**.
4. After about 30 seconds you get a link such as `pathforge-website.vercel.app`.
   **Write this link down** — it's your website address until you buy a domain.

✅ Check: open the link on your phone. Tap **Menu** — the menu slides in.

> If you still have the OLD PathForge site on Vercel: keep it until the new one works,
> then Vercel → old project → **Settings** → bottom → **Delete Project**.

---

## C. Save sign-ups in a database (15 min)

### C1. Create the database
1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project** → Name `pathforge` → make a strong **Database Password**
   (save it in a safe place) → Region: the one closest to most buyers
   (e.g. *West EU (London)*) → **Create new project**. Wait ~2 minutes.
3. Left menu → **SQL Editor** → **New query**.
4. In VS Code open `supabase-waitlist.sql` → **Ctrl + A**, **Ctrl + C** → paste into Supabase → **Run**.
   It must say **Success**.

### C2. Give the website's server the secret key
1. Supabase → **Project Settings** (gear icon) → **API Keys** (or **API**).
2. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`).
   You may find it under **Data API** or at the top of the API page.
3. Copy the **secret** key: it's called **service_role** (starts with `eyJ…`)
   or a **secret key** (starts with `sb_secret_…`). Click **Reveal** / **Copy**.
4. Go to **Vercel** → your project → **Settings → Environment Variables**. Add two:

   | Key (type exactly) | Value |
   |---|---|
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | the secret key |

   Tick **Production**, **Preview** and **Development** → **Save**.
5. Vercel → **Deployments** → on the newest one click **⋯ → Redeploy** → **Redeploy**.
   (Settings only take effect after a redeploy.)

✅ Check: on your live site, join the waitlist with your own email → you see
"You're on the waitlist". In Supabase → **Table Editor → waitlist** your row is there.
Do the same with the **Free STL test pack** form → you see the **Download** button,
and a row with source `testpack` appears.

To download your list later: Table Editor → waitlist → **Export → CSV** (opens in Excel).

---

## D. Spam protection with Cloudflare Turnstile (10 min)

1. Go to **dash.cloudflare.com** → sign up (free) → left menu **Turnstile** → **Add widget**.
2. Widget name: `PathForge` · **Hostname**: your Vercel address without `https://`,
   e.g. `pathforge-website.vercel.app` → Widget mode **Managed** → **Create**.
3. You get two keys:
   - **Site Key** (public) → paste into `site-config.js`:
     ```js
     turnstileSiteKey: "0x4AAAA...your site key...",
     ```
   - **Secret Key** → Vercel → **Settings → Environment Variables** → add
     `TURNSTILE_SECRET_KEY` = the secret key.
4. Upload the changed `site-config.js` to GitHub (Part P) — this also redeploys.

✅ Check: a small "Verify you are human" box appears above both form buttons, and
signing up still works. (When you buy your domain later, add it to the widget's hostnames.)

There is also a hidden "spam trap" field and a speed check built in — robots that
fill every field or submit in under 1.5 seconds are quietly ignored.

---

## E. WhatsApp number and naira prices (5 min)

Open `site-config.js` in VS Code:
```js
whatsappNumber: "2348031234567",   // your number: drop the first 0, put 234 in front
ngnPerUsd: 1550,                   // today's naira per dollar; update now and then
```
Save → upload to GitHub (Part P).

✅ Check: the footer shows your WhatsApp number; under $299 and $800 you see "About ₦…".

---

## F. Screenshots of the app (20 min)

1. Run PathForge CAM (`.\run_windows.bat`). Load a nice part (e.g. `05_dome_R20.stl`).
2. Take 3 screenshots with **Windows + Shift + S** → *Window snip* → click the window:
   1. the main window with the part loaded,
   2. the JOB SETTINGS panel,
   3. the green **PASSED** preview window.
3. Each screenshot is copied; open **Paint** → **Ctrl + V** → **File → Save as → PNG**
   into the website's `screenshots` folder, named `main-window.png`, `settings.png`, `passed.png`.
4. In `site-config.js`:
   ```js
   screenshots: [
     { src: "screenshots/main-window.png", caption: "Import an STL and see it in 3D" },
     { src: "screenshots/settings.png",    caption: "Set your tool, feeds and zero point" },
     { src: "screenshots/passed.png",      caption: "Every program is checked before you save it" },
   ],
   ```
5. Upload the 3 images **and** `site-config.js` to GitHub.

✅ Check: a new section **"See it work"** appears with your pictures, and "See it work" appears in the phone menu.

---

## G. A 60–90 second demo video (1 hour)

1. Record the screen with the free **Xbox Game Bar** (press **Windows + Alt + R** to start/stop,
   videos go to `Videos\Captures`) or the free **OBS Studio** (obsproject.com).
2. What to show (practise once first):
   1. Import STL (5 s) · 2. change tool diameter (10 s) · 3. choose Full Job + machine (10 s)
   4. Generate (cut the waiting) · 5. the PASSED window — point at "0.000 mm into the part" (15 s)
   6. Save G-code, open it in ncviewer.com showing the toolpath (20 s).
3. Upload to **YouTube** → **Create → Upload video** → visibility **Public** or **Unlisted**.
4. Copy the video link → `site-config.js`:
   ```js
   demoVideoUrl: "https://www.youtube.com/watch?v=XXXXXXXX",
   ```
5. Upload `site-config.js` to GitHub.

✅ Check: the "See it work" section has a **Watch the demo video** button.

---

## H. Visitor statistics (5 min)

1. Vercel → your project → **Analytics** tab → **Enable** (free plan).
2. `site-config.js` → `vercelAnalytics: true,` → upload to GitHub.

✅ Check: after a few visits, Vercel → Analytics shows page views. Sign-ups also appear
as an event named `signup`. (The privacy notice already mentions this.)

---

## I. The share picture (5 min)

When someone shares your link on WhatsApp/Facebook/X, they see `og-image.png`.
Most apps need the **full** address:

1. Open `index.html` in VS Code → **Ctrl + F** → search `og:image`.
2. Change `content="og-image.png"` to your full address, e.g.
   `content="https://pathforge-website.vercel.app/og-image.png"`.
3. Upload `index.html` to GitHub.

✅ Check: send your link to yourself on WhatsApp — a preview card with the picture appears
(it can take a few minutes the first time).

---

## J. Make the About page yours (15 min)

Open `about.html`. Near the top there is a note. Add, in your own words: your name,
why you built PathForge, and (optional) a photo (save it in `screenshots/` and add
`<img src="screenshots/me.jpg" alt="Your name">`). Upload to GitHub.

---

## K. Check the legal pages (30 min + lawyer later)

- `refund.html`: I wrote a **14-day full refund** if it doesn't work for the buyer's
  machine. If you want different terms, change the number of days in the page **and** in
  the "Can I get a refund?" answer in `index.html`.
- Read `terms.html` and `privacy.html`. They are plain-language starting points, **not
  legal advice**. Before you take payments, have a lawyer review all three pages.

---

## L. Test everything (15 min) — on your phone AND computer

- [ ] Simulation runs in the hero
- [ ] **Menu** opens and every link goes to the right place (phone)
- [ ] Waitlist: your test sign-up appears in Supabase
- [ ] Test pack: download works and the zip opens
- [ ] Footer links: About, Refunds, Privacy, Terms all open
- [ ] WhatsApp number in footer is correct
- [ ] Dark mode: switch your phone to dark mode and reload — still readable

Then delete your own test rows in Supabase (Table Editor → tick → Delete).

---

## M. Speed check (10 min)

Go to **pagespeed.web.dev** → paste your link → **Analyze**. Aim for 90+ in each score
on **Mobile**. Send me a screenshot of anything below 90.

## N. Know when the site is down (5 min)

**uptimerobot.com** → free account → **Add New Monitor** → type **HTTPS** → your link →
interval 5 min → your email. You get an email if the site ever goes down.

## O. Google (optional now, 15 min)

**search.google.com/search-console** → **Add property** → **URL prefix** → your Vercel link →
verify with **HTML tag** (send me the tag; I'll add it). When you buy the domain we add it
again with a sitemap.

---

## P. How to update the site any time (2 min)

1. Change the file in VS Code and save.
2. GitHub → your repository → **Add file → Upload files** → drag in the changed file(s)
   (keep the same names and folders) → **Commit changes**.
3. Vercel updates the live site by itself in ~30 seconds.

Files inside a folder (e.g. `screenshots/passed.png`): open that folder on GitHub first, then upload.

---

## Q. Getting ready for payments (do while waiting)

These need you, not code. When they're done, tell me **"build checkout"**:

1. **Paystack**: finish business verification (CAC registration, business bank account,
   ID). Ask Paystack to enable **USD** payments. Get your **test** keys (Settings → API Keys).
2. **Licensing files**: find `pathforge-licensing.zip` and send it to me — the checkout
   must create licence keys your app accepts.
3. **Business email** (free Zoho Mail; can wait for the domain).
4. **Code-signing certificate** for the Windows installer (budget item, needed before the
   download page).

Then I'll build: Paystack checkout → payment verified on our server → licence key on the
thank-you page + by email → "My licences" page → download page.

---

## What I already built into this version (nothing to do)

- Phone **menu** (slides in; closes with tap outside, Close or Escape)
- **Secure sign-ups** through our own server (`api/signup.js`): the database key stays secret
- **Spam protection**: Turnstile (once you add keys) + hidden spam trap + speed check
- **Free STL test pack** download that collects emails (`downloads/`)
- **"See it work"** section that appears when you add screenshots / video
- **Naira estimate** under the prices
- **About** and **Refund policy** pages, updated **Privacy** notice
- **Share picture** (`og-image.png`) and **Google product info** (prices, Windows) built into the page
- **Security headers** (in `vercel.json`) that block injected scripts
