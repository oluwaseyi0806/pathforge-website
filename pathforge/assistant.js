// assistant.js - the floating "Ask" button and chat panel on every page.
//
// 1. Tries the AI mode (/api/ask) - only works once ANTHROPIC_API_KEY is set in Vercel.
// 2. Otherwise answers from assistant-kb.js (free mode, works offline from the page).
// Answers are inserted as plain text (never as HTML), so nothing typed can run as code.
(function () {
  var KB = window.PF_KB || [];
  var cfg = window.PATHFORGE_CONFIG || {};
  var wa = String(cfg.whatsappNumber || "").replace(/\D/g, "");
  var aiOff = false;
  var history = [];      // [{role, text}] for the AI mode
  var busy = false;

  var STOP = " a an the is are am do does did i me my we you your it its to of in on for and or can how what which where when why who will would should could be with this that there their they them there's it's i'm don't doesn't not any some get have has please tell about ";
  function words(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9.+\- ]+/g, " ").split(/\s+/)
      .filter(function (w) { return w && STOP.indexOf(" " + w + " ") === -1; });
  }
  var index = KB.map(function (e) { return words(e.q + " " + e.k); });

  function bestMatches(question) {
    var qw = words(question);
    if (!qw.length) return [];
    var scored = KB.map(function (e, i) {
      var bag = index[i], score = 0;
      qw.forEach(function (w) {
        for (var j = 0; j < bag.length; j++) {
          var b = bag[j];
          if (b === w) { score += 2; return; }
          if (w.length >= 4 && b.length >= 4 && (b.indexOf(w) === 0 || w.indexOf(b) === 0)) { score += 1; return; }
        }
      });
      return { i: i, score: score / Math.sqrt(qw.length) };
    }).filter(function (s) { return s.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  /* ---------- build the button + panel ---------- */
  var fab = document.createElement("button");
  fab.type = "button"; fab.className = "ask-fab"; fab.id = "ask-fab";
  fab.setAttribute("aria-label", "Ask a question about PathForge CAM");
  fab.setAttribute("aria-expanded", "false"); fab.setAttribute("aria-controls", "ask-panel");
  fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Ask</span>';

  var panel = document.createElement("div");
  panel.className = "ask-panel"; panel.id = "ask-panel"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-labelledby", "ask-title");
  panel.innerHTML =
    '<div class="ask-head"><div><h2 id="ask-title">Ask PathForge</h2><p>Ask anything: the program, CNC, or more</p></div>' +
    '<button type="button" class="ask-close" aria-label="Close chat">&times;</button></div>' +
    '<div class="ask-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
    '<p class="ask-sr" id="ask-status" role="status"></p>' +
    '<div class="ask-chips"></div>' +
    '<form class="ask-form" autocomplete="off"><label class="ask-sr" for="ask-input">Your question</label>' +
    '<input id="ask-input" type="text" maxlength="500" placeholder="Type your question..." enterkeyhint="send">' +
    '<button type="submit" class="ask-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form>' +
    '<p class="ask-foot">Answers can be wrong. Always dry run a new program first.</p>';
  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var log = panel.querySelector(".ask-log"), chips = panel.querySelector(".ask-chips");
  var form = panel.querySelector(".ask-form"), input = panel.querySelector("#ask-input");

  function bubble(who, text, extra) {
    var el = document.createElement("div");
    el.className = "ask-msg " + who;
    String(text).split(/\n+/).forEach(function (para) {
      var p = document.createElement("p"); p.textContent = para; el.appendChild(p);
    });
    if (extra) el.appendChild(extra);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function typing() {
    var el = document.createElement("div");
    el.className = "ask-msg bot typing"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = '<span class="ask-dots"><span></span><span></span><span></span></span>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    var status = panel.querySelector("#ask-status");
    status.textContent = "PathForge is typing an answer...";
    return { remove: function () { el.remove(); status.textContent = ""; } };
  }
  function links(list) {
    var box = document.createElement("p"); box.className = "ask-links";
    list.forEach(function (l) {
      var a = document.createElement("a"); a.href = l.href; a.textContent = l.text;
      if (/^https?:/.test(l.href)) { a.target = "_blank"; a.rel = "noopener"; }
      a.addEventListener("click", function () { if (l.href.charAt(0) === "#" || l.href.indexOf("index.html#") === 0) close(false); });
      box.appendChild(a);
    });
    return box;
  }
  function helpLinks() {
    var onHome = !!document.getElementById("updates");
    var list = [];
    if (wa) list.push({ href: "https://wa.me/" + wa, text: "Ask on WhatsApp" });
    list.push({ href: (onHome ? "" : "index.html") + "#updates", text: "Leave your email" });
    return links(list);
  }
  function setChips(questions) {
    chips.innerHTML = "";
    questions.forEach(function (q) {
      var b = document.createElement("button"); b.type = "button"; b.className = "ask-chip"; b.textContent = q;
      b.addEventListener("click", function () { ask(q); });
      chips.appendChild(b);
    });
    chips.hidden = !questions.length;
  }

  function freeAnswer(question) {
    var m = bestMatches(question);
    if (!m.length || m[0].score < 0.9) {
      bubble("bot", "Sorry, I can't answer that right now. Our team can help:", helpLinks());
      setChips(["How do I download it?", "Which machines does it work with?", "Is it safe to run on my machine?"]);
      return;
    }
    bubble("bot", KB[m[0].i].a);
    setChips(m.slice(1, 3).filter(function (s) { return s.score >= 0.9; }).map(function (s) { return KB[s.i].q; }));
  }

  function ask(question) {
    question = String(question || "").trim();
    if (!question || busy) return;
    bubble("me", question);
    input.value = "";
    setChips([]);
    if (aiOff) { freeAnswer(question); return; }
    busy = true;
    var wait = typing();
    fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question, history: history }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { s: r.status, b: b }; }); })
      .then(function (r) {
        wait.remove();
        if (r.s === 200 && r.b.answer) {
          var tag = document.createElement("span"); tag.className = "ask-tag"; tag.textContent = "AI answer";
          bubble("bot", r.b.answer, tag);
          history.push({ role: "user", text: question }, { role: "assistant", text: r.b.answer });
          history = history.slice(-6);
        } else if (r.s === 429 || r.s === 400) {
          bubble("bot", r.b.message || "Please try again in a moment.");
        } else {
          aiOff = true; freeAnswer(question);       // AI not set up (or down): use the built-in answers
        }
      })
      .catch(function () { wait.remove(); aiOff = true; freeAnswer(question); })
      .then(function () { busy = false; });
  }

  /* ---------- open / close ---------- */
  var greeted = false;
  function open() {
    panel.hidden = false;
    requestAnimationFrame(function () { panel.classList.add("open"); });
    fab.setAttribute("aria-expanded", "true");
    fab.classList.add("on");
    if (!greeted) {
      greeted = true;
      bubble("bot", "Hi! Ask me anything: PathForge CAM, your machine, CNC, or anything else.");
      setChips(["Is it free?", "How do I download and install it?", "Which machines does it work with?", "Windows says it protected my PC"]);
    }
    setTimeout(function () { input.focus(); }, 60);
    document.addEventListener("keydown", onKey);
  }
  function close(returnFocus) {
    panel.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    fab.classList.remove("on");
    document.removeEventListener("keydown", onKey);
    setTimeout(function () { panel.hidden = true; }, 200);
    if (returnFocus !== false) fab.focus();
  }
  function onKey(e) { if (e.key === "Escape") close(); }

  fab.addEventListener("click", function () { if (panel.hidden || !panel.classList.contains("open")) open(); else close(); });
  panel.querySelector(".ask-close").addEventListener("click", function () { close(); });
  form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
})();
