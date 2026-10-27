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

const VERSION = "signup v3";

// What kind of Supabase key is this? (never prints the key itself)
function keyKind(key) {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("eyJ")) {
    try {
      const p = JSON.parse(Buffer.from(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
      if (p.role === "service_role") return "secret";
      if (p.role === "anon") return "publishable";
    } catch (e) { /* fall through */ }
    return "unknown";
  }
  return "unknown";
}

function supaHeaders(key, extra) {
  return Object.assign(
    { apikey: key },
    // older "service_role" keys (eyJ...) also go in Authorization; sb_secret_ keys only in apikey
    key.startsWith("eyJ") ? { Authorization: "Bearer " + key } : {},
    extra || {}
  );
}

// Open  https://YOUR-SITE.vercel.app/api/signup?check=1  in a browser to test the setup.
// It shows only yes/no answers - never the key.
async function selfCheck(url, key, res) {
  const lines = ["PathForge sign-up check (" + VERSION + ")", ""];
  let allOk = true;
  const say = (ok, text) => { lines.push((ok ? "OK      " : "PROBLEM ") + text); if (!ok) allOk = false; };

  say(!!url, url ? "SUPABASE_URL is set" : "SUPABASE_URL is missing in Vercel -> Settings -> Environment Variables (then Redeploy)");
  const urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
  if (url) say(urlOk, urlOk ? "SUPABASE_URL looks right" :
    "SUPABASE_URL looks wrong. It must look exactly like https://abcdefgh.supabase.co (it starts with: " + url.slice(0, 30) + ")");

  const kind = keyKind(key);
  const keyMsg = {
    missing: "SUPABASE_SERVICE_ROLE_KEY is missing in Vercel -> Settings -> Environment Variables (then Redeploy)",
    secret: "SUPABASE_SERVICE_ROLE_KEY is a secret key (correct type)",
    publishable: "SUPABASE_SERVICE_ROLE_KEY is the PUBLIC (anon/publishable) key. Use the SECRET key (service_role or sb_secret_...) instead",
    unknown: "SUPABASE_SERVICE_ROLE_KEY doesn't look like a Supabase key. Copy it again (no spaces, no quotes)",
  }[kind];
  say(kind === "secret", keyMsg);

  if (url && key && urlOk) {
    try {
      const r = await fetch(url + "/rest/v1/waitlist?select=id,source,name,email&limit=1", { headers: supaHeaders(key) });
      let detail = ""; try { detail = (await r.text()).slice(0, 200); } catch (e) { /* ignore */ }
      if (r.ok) say(true, "Database reached, table 'waitlist' found with all its columns");
      else if (r.status === 401 || r.status === 403) say(false, "Supabase refused the key (" + r.status + "). Copy the SECRET key again from Supabase -> Project Settings -> API Keys");
      else if (r.status === 404 || /does not exist|not find the table|relation/i.test(detail) && !/column/i.test(detail))
        say(false, "Table 'waitlist' not found (" + r.status + "). Supabase -> SQL Editor -> paste ALL of supabase-waitlist.sql -> Run");
      else if (/column/i.test(detail)) say(false, "The table is an old version (a column is missing). Run supabase-waitlist.sql again in Supabase -> SQL Editor");
      else say(false, "Supabase answered " + r.status + ": " + detail);
    } catch (e) {
      say(false, "Could not reach Supabase at that URL (" + (e && e.message) + "). Check SUPABASE_URL, and that the Supabase project is not paused");
    }
  }
  say(true, "Turnstile spam check: " + (process.env.TURNSTILE_SECRET_KEY ? "on" : "off (optional, part D)"));
  lines.push("", allOk ? "ALL GOOD - sign-ups should save." :
    "Fix the PROBLEM lines, then Vercel -> Deployments -> newest -> ... -> Redeploy, then open this page again.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(lines.join("\n"));
}

module.exports = async function handler(req, res) {
  // tidy common copy/paste mistakes: spaces, quotes, a trailing "/" or "/rest/v1"
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "");

  if (req.method === "GET") return selfCheck(url, key, res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Use POST." });
  }
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

  // Explain database problems in Vercel's logs (Deployments -> Logs), without
  // ever showing the secret key. Visitors only see a short message.
  const HINTS = {
    401: "The Supabase key is wrong. Copy the SECRET key (service_role / sb_secret_) again into SUPABASE_SERVICE_ROLE_KEY.",
    403: "The Supabase key is not the secret one. Use the service_role or sb_secret_ key, not the anon/publishable key.",
    404: "The table 'waitlist' was not found, or SUPABASE_URL is wrong. Run supabase-waitlist.sql again and check the URL looks like https://xxxx.supabase.co",
    400: "Supabase rejected the data. Run the latest supabase-waitlist.sql again (it adds the 'source' column).",
  };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    console.error("[signup] SUPABASE_URL looks wrong. It should look like https://xxxx.supabase.co - got: " + url.slice(0, 60));
  }
  try {
    const r = await fetch(url + "/rest/v1/waitlist", {
      method: "POST",
      headers: supaHeaders(key, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
    if (r.ok || r.status === 409) return res.status(200).json({ ok: true });   // 409 = already signed up
    let detail = "";
    try { detail = (await r.text()).slice(0, 300); } catch (e) { /* ignore */ }
    console.error("[signup] Supabase said " + r.status + ". " + (HINTS[r.status] || "") + " Details: " + detail);
    return res.status(502).json({ message: "Your details weren't saved (error db_" + r.status + "). Please try again in a minute.", code: "db_" + r.status });
  } catch (e) {
    console.error("[signup] Could not reach Supabase at " + url.slice(0, 60) + " - " + (e && e.message));
    return res.status(502).json({ message: "Your details weren't saved (error db_unreachable). Please try again in a minute.", code: "db_unreachable" });
  }
};