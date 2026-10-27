// api/signup.js - runs on Vercel's servers, never in the visitor's browser.
//
// Receives a sign-up (waitlist or free test pack), checks it is a real
// person (Cloudflare Turnstile + spam trap), then saves it in Supabase
// using the SECRET service key. The secret keys live only in
// Vercel -> Settings -> Environment Variables:
//   SUPABASE_URL                e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   Supabase secret key: "service_role" (eyJ...) or sb_secret_... (secret!)
//   TURNSTILE_SECRET_KEY        Cloudflare Turnstile secret key (optional)

const PLANS = ["Personal", "Business", "Academic", "Not sure yet", ""];
const SOURCES = ["waitlist", "testpack"];

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Use POST." });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(503).json({ error: "not_configured", message: "Sign-ups are not connected yet." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // spam trap + "too fast to be human" check: quietly accept, save nothing
  if (clean(body.company, 200) || Number(body.elapsed) < 1500) {
    return res.status(200).json({ ok: true });
  }

  const row = {
    source: SOURCES.includes(body.source) ? body.source : "waitlist",
    name: clean(body.name, 120),
    email: clean(body.email, 200).toLowerCase(),
    country: clean(body.country, 80) || null,
    plan: PLANS.includes(body.plan) ? (body.plan || null) : null,
    machine: clean(body.machine, 120) || null,
  };
  if (!row.name) return res.status(400).json({ message: "Enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    return res.status(400).json({ message: "Enter a valid email address, like name@example.com." });
  }

  // Cloudflare Turnstile: is this a real person?
  const tsSecret = process.env.TURNSTILE_SECRET_KEY;
  if (tsSecret) {
    try {
      const form = new URLSearchParams();
      form.append("secret", tsSecret);
      form.append("response", clean(body.token, 4096));
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
      if (ip) form.append("remoteip", ip);
      const v = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
      const out = await v.json();
      if (!out.success) {
        return res.status(400).json({ message: "The security check didn't pass. Please complete it again and resend." });
      }
    } catch (e) {
      return res.status(502).json({ message: "The security check couldn't be reached. Please try again in a minute." });
    }
  }

  try {
    const r = await fetch(url.replace(/\/$/, "") + "/rest/v1/waitlist", {
      method: "POST",
      headers: Object.assign(
        { apikey: key, "Content-Type": "application/json", Prefer: "return=minimal" },
        // older "service_role" keys (they start with eyJ) also go in Authorization;
        // newer secret keys (sb_secret_...) only go in apikey
        key.startsWith("eyJ") ? { Authorization: "Bearer " + key } : {}
      ),
      body: JSON.stringify(row),
    });
    if (r.ok || r.status === 409) return res.status(200).json({ ok: true });   // 409 = already signed up
    return res.status(502).json({ message: "Your details weren't saved. Please try again in a minute." });
  } catch (e) {
    return res.status(502).json({ message: "Your details weren't saved. Please try again in a minute." });
  }
};
