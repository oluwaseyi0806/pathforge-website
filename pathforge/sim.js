// Live cutting simulation in the hero (pure JavaScript, no libraries).
/* ===== live cutting simulation =====
   A height map of the stock is cut by a flat end mill following a real
   layered roughing path, then a finishing path. The tool never goes below
   the "safe height" (part surface grown by the tool radius), so the
   "Cut into part" readout is measured, not faked. */
(function () {
  var cv = document.getElementById("sim");
  var ctx = cv.getContext("2d");
  var W = 120, H = 90, MM = 60 / W;              // grid cells, mm per cell
  var TOP = 18, R = 6;                          // stock top (mm), tool radius in cells (6 mm tool)
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");

  function partH(i, j) {                        // the part, in mm
    var h = 0;
    if (i >= 8 && i <= 111 && j >= 8 && j <= 81) h = 4;
    var d = Math.hypot(i - 37, j - 45);
    if (d < 25) h = Math.max(h, 4 + 12 * Math.sqrt(1 - (d / 25) * (d / 25)));
    if (i >= 72 && i <= 104 && j >= 20 && j <= 70) {
      h = Math.max(h, 12);
      if (Math.hypot(i - 88, j - 45) < 9) h = 6;
    }
    return h;
  }
  var part = new Float32Array(W * H), safe = new Float32Array(W * H), stock = new Float32Array(W * H);
  for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) part[j * W + i] = partH(i, j);
  // safe height = highest part point under the tool circle (the "drop cutter")
  var disk = [];
  for (var dj = -R; dj <= R; dj++) for (var di = -R; di <= R; di++) if (di * di + dj * dj <= R * R) disk.push([di, dj]);
  for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
    var m = 0;
    for (var k = 0; k < disk.length; k++) {
      var x = i + disk[k][0], y = j + disk[k][1];
      if (x >= 0 && y >= 0 && x < W && y < H) m = Math.max(m, part[y * W + x]);
    }
    safe[j * W + i] = m;
  }
  // build the path: layered roughing (leave 0.6 mm), then finishing
  var path = [];
  var levels = [15, 12, 9, 6, 3, 0];
  levels.forEach(function (zl, li) {
    for (var row = -2, n = 0; row <= H + 1; row += 5, n++) {
      var jj = Math.max(0, Math.min(H - 1, row));
      for (var c = -R; c <= W - 1 + R; c++) {
        var ii = n % 2 ? (W - 1 - c) : c, ci = Math.max(0, Math.min(W - 1, ii));
        var s = safe[jj * W + ci];
        path.push([ii, row, Math.max(zl, s > 0.01 ? s + 0.6 : 0), 0, zl]);
      }
    }
  });
  for (var row2 = -1, n2 = 0; row2 <= H; row2 += 2, n2++) {
    var jr = Math.max(0, Math.min(H - 1, Math.round(row2)));
    for (var c2 = -R; c2 <= W - 1 + R; c2++) {
      var i2 = n2 % 2 ? (W - 1 - c2) : c2, ci2 = Math.max(0, Math.min(W - 1, i2));
      path.push([i2, row2, safe[jr * W + ci2], 1, 0]);
    }
  }

  var colors = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ["--metal-top", "--metal-cut", "--metal-side", "--metal-dark", "--sim-bg", "--signal", "--ink"].forEach(function (k) {
      colors[k] = cs.getPropertyValue(k).trim();
    });
    colors.top = hexToRgb(colors["--metal-top"]); colors.cut = hexToRgb(colors["--metal-cut"]);
    colors.side = hexToRgb(colors["--metal-side"]); colors.dark = hexToRgb(colors["--metal-dark"]);
  }
  function hexToRgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function mix(a, b, t) { return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")"; }
  function shadeRGB(c, f) { return "rgb(" + Math.round(c[0] * f) + "," + Math.round(c[1] * f) + "," + Math.round(c[2] * f) + ")"; }

  // isometric projection
  var A, B, Zs, OX, OY;
  function layout() {
    var w = cv.width, h = cv.height;
    A = w / (W + H) * 0.97; B = A * 0.5; Zs = A * 1.35;
    OX = w / 2 - (W - H) * A / 2; OY = h / 2 - ((W + H) * B - TOP * Zs) / 2;
  }
  function P(i, j, z) { return [OX + (i - j) * A, OY + (i + j) * B - z * Zs]; }

  var idx = 0, done = false, pauseUntil = 0, worst = 0, line = 0;
  function resetStock() { for (var q = 0; q < W * H; q++) stock[q] = TOP; idx = 0; done = false; worst = 0; line = 0; }
  function carve(pi, pj, z) {
    for (var k = 0; k < disk.length; k++) {
      var x = Math.round(pi) + disk[k][0], y = Math.round(pj) + disk[k][1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      var q = y * W + x;
      if (stock[q] > z) { stock[q] = z; var g = part[q] - z; if (g > worst) worst = g; }
    }
  }
  function draw() {
    var w = cv.width, h = cv.height;
    ctx.fillStyle = colors["--sim-bg"]; ctx.fillRect(0, 0, w, h);
    for (var s = 0; s < W + H - 1; s++) {
      for (var i = Math.max(0, s - H + 1); i <= Math.min(W - 1, s); i++) {
        var j = s - i, q = j * W + i, z = stock[q];
        var zr = i + 1 < W ? stock[q + 1] : 0, zd = j + 1 < H ? stock[q + W] : 0;
        var p0 = P(i, j, z), p1 = P(i + 1, j, z), p2 = P(i + 1, j + 1, z), p3 = P(i, j + 1, z);
        // top face: cut surfaces are brighter than raw stock; slope shading
        var gx = (i > 0 ? stock[q - 1] : z) - zr, gy = (j > 0 ? stock[q - W] : z) - zd;
        var lit = Math.max(0.55, Math.min(1.15, 0.92 + 0.06 * gx - 0.05 * gy));
        var base = z < TOP - 0.01 ? colors.cut : colors.top;
        ctx.fillStyle = shadeRGB(base, lit);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath(); ctx.fill();
        if (z > zr + 0.01) {                       // right wall
          var a = P(i + 1, j, zr), b = P(i + 1, j + 1, zr);
          ctx.fillStyle = mix(colors.side, colors.dark, 0.15);
          ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(a[0], a[1]); ctx.closePath(); ctx.fill();
        }
        if (z > zd + 0.01) {                       // front wall
          var c = P(i, j + 1, zd), d = P(i + 1, j + 1, zd);
          ctx.fillStyle = colors["--metal-dark"];
          ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.fill();
        }
      }
    }
    if (!done && idx < path.length) {              // the tool
      var t = path[idx], tp = P(t[0] + 0.5, t[1] + 0.5, t[2]), tt = P(t[0] + 0.5, t[1] + 0.5, t[2] + 22);
      var rw = R * A * 1.0, rh = R * B * 1.0;
      ctx.fillStyle = colors["--signal"]; ctx.globalAlpha = 0.92;
      ctx.fillRect(tp[0] - rw, tt[1], rw * 2, tp[1] - tt[1]);
      ctx.beginPath(); ctx.ellipse(tp[0], tp[1], rw, rh, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = colors["--ink"];
      ctx.beginPath(); ctx.ellipse(tt[0], tt[1], rw, rh, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  var rPass = document.getElementById("r-pass"), rZ = document.getElementById("r-z"),
      rLine = document.getElementById("r-line"), rG = document.getElementById("r-gouge");
  function readout() {
    var t = path[Math.min(idx, path.length - 1)];
    rPass.textContent = done ? "Check passed" : (t[3] ? "Finishing" : "Roughing");
    rZ.textContent = "Z " + (t[2] - TOP).toFixed(1) + " mm";
    rLine.textContent = line.toLocaleString("en-US");
    rG.textContent = Math.max(0, worst).toFixed(3) + " mm";
  }
  function step(n) {
    for (var k = 0; k < n && idx < path.length; k++, idx++) {
      var t = path[idx];
      carve(t[0], t[1], t[2]);
      if (k % 3 === 0) line++;
    }
    if (idx >= path.length) { done = true; pauseUntil = performance.now() + 3500; }
  }
  var visible = true, raf = 0, last = 0;
  var RATE = path.length / 12000;               // whole job in about 12 seconds on any device
  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(now - last, 100) : 16; last = now;
    if (done) { if (now > pauseUntil) resetStock(); }
    else step(Math.max(1, Math.round(dt * RATE)));
    draw(); readout();
    if (visible && !reduce.matches) raf = requestAnimationFrame(frame);
  }
  function finishedStill() { resetStock(); while (!done) step(5000); draw(); readout(); }
  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), wpx = cv.clientWidth || 600;
    cv.width = Math.round(wpx * dpr); cv.height = Math.round(wpx * 11 / 16 * dpr); layout();
  }
  readColors(); size(); resetStock();
  if (reduce.matches) { finishedStill(); }
  else { step(0); draw(); readout(); raf = requestAnimationFrame(frame); }
  new IntersectionObserver(function (es) {
    visible = es[0].isIntersecting;
    if (visible && !raf && !reduce.matches) { last = 0; raf = requestAnimationFrame(frame); }
  }).observe(cv);
  addEventListener("resize", function () { size(); draw(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { readColors(); draw(); });
  new MutationObserver(function () { readColors(); draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  reduce.addEventListener("change", function () { if (reduce.matches) finishedStill(); else if (!raf) raf = requestAnimationFrame(frame); });
})();
