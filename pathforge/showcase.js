// showcase.js - shows the parts listed in site-config.js -> showcase: [ ... ].
// Each entry: { img: "showcase/part1.webp", title: "...", material: "...", machine: "...", time: "...", by: "..." }
(function () {
  var cfg = window.PATHFORGE_CONFIG || {};
  var list = Array.isArray(cfg.showcase) ? cfg.showcase : [];
  var grid = document.getElementById("showcase-grid"), empty = document.getElementById("showcase-empty");
  var wa = String(cfg.whatsappNumber || "").replace(/\D/g, "");
  var btn = document.getElementById("showcase-wa");
  if (btn && wa) { btn.href = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Hi PathForge, here is a part I cut with PathForge CAM:"); btn.target = "_blank"; btn.rel = "noopener"; }
  if (!grid) return;
  list.forEach(function (p) {
    if (!p || !/^(showcase|screenshots|media)\//.test(String(p.img || ""))) return;
    var fig = document.createElement("figure");
    var img = document.createElement("img");
    img.src = p.img; img.alt = p.alt || p.title || "Part cut with PathForge CAM"; img.loading = "lazy"; img.decoding = "async";
    fig.appendChild(img);
    var cap = document.createElement("figcaption");
    var b = document.createElement("b"); b.textContent = p.title || "Part"; cap.appendChild(b);
    [["Material", p.material], ["Machine", p.machine], ["Cutting time", p.time], ["Made by", p.by]].forEach(function (r) {
      if (!r[1]) return;
      var s = document.createElement("span"); s.textContent = r[0] + ": " + r[1]; cap.appendChild(s);
    });
    fig.appendChild(cap);
    grid.appendChild(fig);
  });
  if (grid.children.length && empty) {
    empty.querySelector("h2").textContent = "Made something with PathForge?";
  }
})();
