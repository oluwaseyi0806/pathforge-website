// PathForge website behaviour (no libraries).
// - header shadow, phone menu, WhatsApp number in the footer
// - prices in naira (if a rate is set), screenshots + demo video (if set)
// - sign-up forms (waitlist + free test pack): sent to our own server
//   function /api/signup, protected by Cloudflare Turnstile + a spam trap.
//   If the server isn't set up yet, the waitlist falls back to WhatsApp.
(function () {
  var cfg = window.PATHFORGE_CONFIG || {};
  var wa = String(cfg.whatsappNumber || "").replace(/\D/g, "");
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- header shadow ---------- */
  var head = $("head");
  if (head) {
    var upd = function () { head.classList.toggle("scrolled", window.scrollY > 4); };
    window.addEventListener("scroll", upd, { passive: true }); upd();
  }

  /* ---------- phone menu ---------- */
  var drawer = $("drawer"), backdrop = $("drawer-backdrop"), menuBtn = $("menu-btn");
  function openMenu() {
    drawer.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add("open"); backdrop.classList.add("open"); });
    menuBtn.setAttribute("aria-expanded", "true");
    var first = drawer.querySelector("button, a"); if (first) first.focus();
    document.addEventListener("keydown", onKey);
  }
  function closeMenu(returnFocus) {
    drawer.classList.remove("open"); backdrop.classList.remove("open");
    menuBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey);
    setTimeout(function () { drawer.hidden = true; backdrop.hidden = true; }, 230);
    if (returnFocus) menuBtn.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") closeMenu(true);
    if (e.key === "Tab") {                                   // keep keyboard focus inside the menu
      var items = drawer.querySelectorAll("button, a:not([hidden])");
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  if (drawer && menuBtn) {
    menuBtn.addEventListener("click", openMenu);
    $("drawer-close").addEventListener("click", function () { closeMenu(true); });
    backdrop.addEventListener("click", function () { closeMenu(true); });
    drawer.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { closeMenu(false); }); });
  }

  /* ---------- WhatsApp number in the footer ---------- */
  var waLine = $("wa-line"), waNum = $("wa");
  if (waLine && waNum) { if (wa) waNum.textContent = "+" + wa; else waLine.hidden = true; }

  /* ---------- prices in naira ---------- */
  var rate = Number(cfg.ngnPerUsd || 0);
  if (rate > 0) {
    document.querySelectorAll(".ngn[data-usd]").forEach(function (el) {
      var ngn = Math.round(Number(el.getAttribute("data-usd")) * rate / 1000) * 1000;
      el.textContent = "About ₦" + ngn.toLocaleString("en-NG") + " at today's rate";
      el.hidden = false;
    });
  }

  /* ---------- screenshots and demo video ---------- */
  var shots = Array.isArray(cfg.screenshots) ? cfg.screenshots : [];
  var video = String(cfg.demoVideoUrl || "");
  if ((shots.length || video) && $("demo")) {
    $("demo").hidden = false;
    document.querySelectorAll("[data-needs-demo]").forEach(function (a) { a.hidden = false; });
    if (/^https:\/\//.test(video)) { $("demo-video").hidden = false; $("demo-video-link").href = video; }
    shots.forEach(function (s) {
      var fig = document.createElement("figure");
      var img = document.createElement("img");
      img.src = s.src; img.alt = s.caption || "PathForge CAM screenshot"; img.loading = "lazy";
      fig.appendChild(img);
      if (s.caption) { var cap = document.createElement("figcaption"); cap.textContent = s.caption; fig.appendChild(cap); }
      $("demo-shots").appendChild(fig);
    });
  }

  /* ---------- free download ---------- */
  (function () {
    var ready = !!cfg.downloadReady && /^https:\/\//.test(String(cfg.downloadUrl || ""));
    document.querySelectorAll(".dl-ready").forEach(function (el) { el.hidden = !ready; });
    document.querySelectorAll(".dl-soon").forEach(function (el) { el.hidden = ready; });
    if (cfg.downloadVersion && $("dl-ver")) $("dl-ver").textContent = cfg.downloadVersion;
    if (ready && $("dl-btn")) {
      $("dl-btn").href = cfg.downloadUrl;
      var mb = Number(cfg.downloadSizeMb || 0);
      $("dl-btn").textContent = "Download for Windows" + (mb > 0 ? " (" + mb + " MB)" : "");
      $("dl-btn").addEventListener("click", function () { if (window.va) window.va("event", { name: "download" }); });
    }
    var hash = String(cfg.downloadSha256 || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (ready && hash.length === 64 && $("dl-hash")) { $("dl-hash").textContent = hash; $("dl-hash-li").hidden = false; }
  })();

  /* ---------- plan buttons choose the plan ---------- */
  document.querySelectorAll("[data-plan]").forEach(function (a) {
    a.addEventListener("click", function () { var sel = $("wl-plan"); if (sel) sel.value = a.getAttribute("data-plan"); });
  });

  /* ---------- toasts ---------- */
  function toast(text) {
    var box = $("toasts"); if (!box) return;
    var el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = text;
    box.appendChild(el); setTimeout(function () { el.remove(); }, 5000);
  }

  /* ---------- visitor statistics (Vercel Web Analytics) ---------- */
  if (cfg.vercelAnalytics) {
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    var sa = document.createElement("script"); sa.defer = true; sa.src = "/_vercel/insights/script.js";
    document.head.appendChild(sa);
  }

  /* ---------- Cloudflare Turnstile (spam protection) ---------- */
  var forms = Array.prototype.slice.call(document.querySelectorAll("form.js-signup"));
  var siteKey = String(cfg.turnstileSiteKey || "");
  if (siteKey && forms.length) {
    window.pfTurnstileReady = function () {
      forms.forEach(function (f) {
        var slot = f.querySelector(".turnstile-slot");
        if (!slot || !window.turnstile) return;
        f._tsId = window.turnstile.render(slot, {
          sitekey: siteKey,
          callback: function (token) { f._tsToken = token; },
          "expired-callback": function () { f._tsToken = ""; }
        });
      });
    };
    var ts = document.createElement("script");
    ts.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=pfTurnstileReady";
    ts.async = true; ts.defer = true; document.head.appendChild(ts);
  }

  /* ---------- sign-up forms ---------- */
  forms.forEach(function (form) {
    var loadedAt = Date.now();
    var source = form.getAttribute("data-source");
    var msg = form.querySelector(".notice");
    var btn = form.querySelector("button[type=submit]");
    var btnText = btn.textContent;
    var dl = form.querySelector(".download");

    function show(text, isError) {
      msg.textContent = text; msg.classList.toggle("err", !!isError); msg.hidden = false;
      if (!isError) toast(text);
    }
    function success(email) {
      form.reset();
      if (form._tsId !== undefined && window.turnstile) window.turnstile.reset(form._tsId);
      if (source === "testpack") {
        if (dl) dl.hidden = false;
        show("Thanks! Your download is ready below.");
      } else {
        show("Thanks! We'll email " + email + " when there's a new version.");
      }
      if (window.va) window.va("event", { name: "signup", source: source });
    }
    function fallback(data) {
      // the server isn't set up yet (or you opened the file from your computer)
      if (source === "testpack") {
        if (dl) dl.hidden = false;
        show("Your download is ready below.");
        return;
      }
      if (wa) {
        var text = "Hello PathForge, please add me to the update emails.\nName: " + data.name + "\nEmail: " + data.email +
          (data.country ? "\nCountry: " + data.country : "") +
          (data.machine ? "\nMachine: " + data.machine : "");
        show("WhatsApp is opening with your details. Press send in WhatsApp to finish signing up. If it didn't open, message +" + wa + ".");
        window.location.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
        return;
      }
      show("Sign-ups aren't connected yet. Site owner: follow UPGRADE_GUIDE.md, part C.", true);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var get = function (n) { return form.elements[n] ? String(form.elements[n].value || "").trim() : ""; };
      var data = {
        source: source, name: get("name"), email: get("email"), country: get("country"),
        plan: get("plan"), machine: get("machine"), company: get("company"),
        token: form._tsToken || "", elapsed: Date.now() - loadedAt
      };
      if (!data.name) { show("Enter your name.", true); form.elements.name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { show("Enter a valid email address, like name@example.com.", true); form.elements.email.focus(); return; }
      if (!form.elements.consent.checked) { show("Tick the box to agree.", true); return; }
      if (siteKey && !data.token) { show("Please complete the security check above the button, then try again.", true); return; }
      if (data.company) { success(data.email); return; }        // spam trap filled: a bot. Pretend it worked.

      btn.disabled = true; btn.textContent = "Sending...";
      fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
        })
        .then(function (r) {
          if (r.status === 200) { success(data.email); return; }
          if (r.status === 503 || r.status === 404 || r.status === 405) { fallback(data); return; }
          show((r.body && r.body.message) || "Something went wrong. Please try again in a minute.", true);
          if (form._tsId !== undefined && window.turnstile) window.turnstile.reset(form._tsId);
        })
        .catch(function () { fallback(data); })
        .finally(function () { btn.disabled = false; btn.textContent = btnText; });
    });
  });
})();
