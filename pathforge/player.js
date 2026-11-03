// player.js - plays real PathForge G-code in the browser.
// Reads the file exactly like a machine would (G0/G1/G2/G3, G81/G83 drilling,
// tool changes), then removes material from a virtual block, shown from above
// with light and shade. Files you open stay on your computer - nothing is uploaded.
(function () {
  var root = document.getElementById("gplayer");
  if (!root) return;

  var canvas = root.querySelector("canvas");
  var ctx = canvas.getContext("2d");
  var els = {
    play: root.querySelector("[data-act=play]"),
    back: root.querySelector("[data-act=back]"),
    fwd: root.querySelector("[data-act=fwd]"),
    start: root.querySelector("[data-act=start]"),
    end: root.querySelector("[data-act=end]"),
    seek: root.querySelector(".gp-seek"),
    speed: root.querySelector(".gp-speed"),
    file: root.querySelector(".gp-file"),
    lines: root.querySelector(".gp-lines"),
    tool: root.querySelector("[data-out=tool]"),
    pos: root.querySelector("[data-out=pos]"),
    line: root.querySelector("[data-out=line]"),
    time: root.querySelector("[data-out=time]"),
    name: root.querySelector("[data-out=name]"),
    status: root.querySelector(".gp-status")
  };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- G-code reader ---------------- */
  var WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  function parse(text) {
    var lines = text.split(/\r?\n/);
    var moves = [], tools = {}, stock = null, zTop = 0;
    var pos = { x: null, y: null, z: null };
    var mode = 0, units = 1, tool = 1, cycle = null, retInit = true, feed = 0;
    var m;
    for (var n = 0; n < lines.length; n++) {
      var raw = lines[n].toUpperCase();
      var c, re = /\(([^)]*)\)/g;
      while ((c = re.exec(raw))) {
        var t = c[1];
        if ((m = /^T(\d+)\s+(FLAT END MILL|BALL END MILL|BULL NOSE|DRILL)\s+D([\d.]+)MM(?:\s+R([\d.]+))?/.exec(t))) {
          tools[+m[1]] = { shape: m[2] === "BALL END MILL" ? "ball" : m[2] === "BULL NOSE" ? "bull" : m[2] === "DRILL" ? "drill" : "flat",
            r: +m[3] / 2, rc: m[4] ? +m[4] : 0 };
        } else if ((m = /^STOCK\s+([\d.]+)\s*X\s*([\d.]+)\s*X\s*([\d.]+)\s*MM/.exec(t))) {
          stock = { x: +m[1], y: +m[2], z: +m[3] };
        } else if ((m = /^TOOL\s+(\d+)\b/.exec(t))) {
          tool = +m[1];
        }
      }
      var code = raw.replace(/\([^)]*\)/g, "").split(";")[0].trim();
      if (!code || code === "%") continue;
      var w = {}, gs = [];
      WORD.lastIndex = 0;
      while ((m = WORD.exec(code))) {
        if (m[1] === "G") gs.push(parseFloat(m[2])); else w[m[1]] = parseFloat(m[2]);
      }
      if ("T" in w) tool = Math.round(w.T);
      if ("F" in w) feed = w.F * units;
      var mc = gs.indexOf(53) >= 0, arc = 0, newCycle = null;
      gs.forEach(function (g) {
        if (g === 0 || g === 1) { mode = g; cycle = null; }
        else if (g === 2 || g === 3) { mode = g; cycle = null; }
        else if (g === 20) units = 25.4;
        else if (g === 21) units = 1;
        else if (g === 80) cycle = null;
        else if (g === 98) retInit = true;
        else if (g === 99) retInit = false;
        else if (g === 81 || g === 83) newCycle = g;
      });
      if (mc) continue;                       // machine-coordinate moves (G53): tool change height
      var nx = "X" in w ? w.X * units : pos.x, ny = "Y" in w ? w.Y * units : pos.y, nz = "Z" in w ? w.Z * units : pos.z;
      if (newCycle) {
        cycle = { g: newCycle, z: w.Z * units, r: w.R * units, q: "Q" in w ? w.Q * units : 0, init: pos.z };
      }
      if (cycle && ("X" in w || "Y" in w || newCycle)) {
        // drilling: rapid to R, feed down (pecking), back up
        var x = nx, y = ny, r = cycle.r, zb = cycle.z, top = cycle.init == null ? r : Math.max(cycle.init, r);
        if (pos.x != null) moves.push({ n: n, g: 0, a: [pos.x, pos.y, pos.z == null ? top : pos.z], b: [x, y, top], t: tool, f: 0 });
        moves.push({ n: n, g: 0, a: [x, y, top], b: [x, y, r], t: tool, f: 0 });
        var step = cycle.q > 0 ? cycle.q : r - zb, d = r;
        while (d > zb + 1e-9) {
          var nd = Math.max(zb, d - step);
          moves.push({ n: n, g: 1, a: [x, y, d], b: [x, y, nd], t: tool, f: feed });
          d = nd;
        }
        var back = retInit ? top : r;
        moves.push({ n: n, g: 0, a: [x, y, zb], b: [x, y, back], t: tool, f: 0 });
        pos = { x: x, y: y, z: back };
        continue;
      }
      if (!("X" in w || "Y" in w || "Z" in w)) continue;
      if (pos.x == null || pos.y == null || pos.z == null) { pos = { x: nx, y: ny, z: nz }; continue; }
      if ((mode === 2 || mode === 3) && ("I" in w || "J" in w || "R" in w)) {
        var cx, cy, x0 = pos.x, y0 = pos.y;
        if ("R" in w) {
          var R = w.R * units, mx = (x0 + nx) / 2, my = (y0 + ny) / 2, dx = nx - x0, dy = ny - y0, L = Math.hypot(dx, dy);
          var h = Math.sqrt(Math.max(R * R - L * L / 4, 0)), s = (mode === 2) === (R > 0) ? 1 : -1;
          cx = mx - s * h * dy / L; cy = my + s * h * dx / L;
        } else { cx = x0 + (w.I || 0) * units; cy = y0 + (w.J || 0) * units; }
        var r0 = Math.hypot(x0 - cx, y0 - cy), a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(ny - cy, nx - cx);
        var sw = mode === 2 ? a0 - a1 : a1 - a0;
        if (sw <= 1e-9) sw += 2 * Math.PI;
        if (mode === 2) sw = -sw;
        var k = Math.max(2, Math.ceil(Math.abs(sw) * r0 / 0.4)), px = x0, py = y0, pz = pos.z;
        for (var i = 1; i <= k; i++) {
          var aa = a0 + sw * i / k, qx = i === k ? nx : cx + r0 * Math.cos(aa), qy = i === k ? ny : cy + r0 * Math.sin(aa), qz = pos.z + (nz - pos.z) * i / k;
          moves.push({ n: n, g: 1, a: [px, py, pz], b: [qx, qy, qz], t: tool, f: feed });
          px = qx; py = qy; pz = qz;
        }
      } else {
        moves.push({ n: n, g: mode === 0 ? 0 : 1, a: [pos.x, pos.y, pos.z], b: [nx, ny, nz], t: tool, f: mode === 0 ? 0 : feed });
      }
      pos = { x: nx, y: ny, z: nz };
    }
    return { lines: lines, moves: moves, tools: tools, stock: stock };
  }

  /* ---------------- material removal ---------------- */
  function Sim(job) {
    var cut = job.moves.filter(function (mv) { return mv.g === 1; });
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zmin = 0, rmax = 1.6;
    Object.keys(job.tools).forEach(function (k) { rmax = Math.max(rmax, job.tools[k].r); });
    if (job.stock) { x0 = 0; y0 = 0; x1 = job.stock.x; y1 = job.stock.y; zmin = -job.stock.z; }
    cut.forEach(function (mv) {
      if (!job.stock) {
        x0 = Math.min(x0, mv.a[0], mv.b[0]); x1 = Math.max(x1, mv.a[0], mv.b[0]);
        y0 = Math.min(y0, mv.a[1], mv.b[1]); y1 = Math.max(y1, mv.a[1], mv.b[1]);
      }
      zmin = Math.min(zmin, mv.b[2]);
    });
    if (!isFinite(x0)) throw new Error("No cutting moves found in this file.");
    var pad = job.stock ? 0 : rmax;
    this.x0 = x0 - pad; this.y0 = y0 - pad;
    var span = Math.max(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
    this.res = Math.max(0.12, span / 460);
    this.nx = Math.max(8, Math.ceil((x1 - x0 + 2 * pad) / this.res));
    this.ny = Math.max(8, Math.ceil((y1 - y0 + 2 * pad) / this.res));
    this.top = 0; this.bottom = Math.min(zmin, -0.5);
    this.H = new Float32Array(this.nx * this.ny);
    this.moves = job.moves; this.tools = job.tools;
    this.feet = {};
    this.snaps = [];
    this.reset();
  }
  Sim.prototype.reset = function () { this.H.fill(this.top); this.done = 0; };
  Sim.prototype.foot = function (t) {
    if (this.feet[t]) return this.feet[t];
    var tl = this.tools[t] || { shape: "flat", r: 1.5875, rc: 0 }, res = this.res;
    var n = Math.ceil(tl.r / res), di = [], dj = [], pr = [];
    for (var j = -n; j <= n; j++) for (var i = -n; i <= n; i++) {
      var d = Math.hypot(i * res, j * res);
      if (d > tl.r) continue;
      var p = 0;
      if (tl.shape === "ball") p = tl.r - Math.sqrt(Math.max(tl.r * tl.r - d * d, 0));
      else if (tl.shape === "bull") { var e = Math.max(d - (tl.r - tl.rc), 0); p = tl.rc - Math.sqrt(Math.max(tl.rc * tl.rc - e * e, 0)); }
      else if (tl.shape === "drill") p = Math.max(0, d) * 0.6;   // 118 degree point
      di.push(i); dj.push(j); pr.push(p);
    }
    return (this.feet[t] = { i: Int32Array.from(di), j: Int32Array.from(dj), p: Float32Array.from(pr) });
  };
  Sim.prototype.run = function (k) {
    k = Math.min(k, this.moves.length);
    if (k < this.done) {
      var best = null;
      for (var s = 0; s < this.snaps.length; s++) if (this.snaps[s].k <= k) best = this.snaps[s];
      if (best) { this.H.set(best.H); this.done = best.k; } else this.reset();
    }
    var H = this.H, nx = this.nx, ny = this.ny, res = this.res;
    for (var m = this.done; m < k; m++) {
      var mv = this.moves[m];
      if (mv.g === 1) {
        var f = this.foot(mv.t), a = mv.a, b = mv.b;
        var L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / (0.7 * res)));
        for (var s2 = 0; s2 <= steps; s2++) {
          var u = s2 / steps, ci = Math.round((a[0] + (b[0] - a[0]) * u - this.x0) / res), cj = Math.round((a[1] + (b[1] - a[1]) * u - this.y0) / res);
          var z = a[2] + (b[2] - a[2]) * u;
          if (z >= this.top) continue;
          for (var q = 0; q < f.i.length; q++) {
            var ii = ci + f.i[q], jj = cj + f.j[q];
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
            var idx = jj * nx + ii, zz = z + f.p[q];
            if (zz < H[idx]) H[idx] = zz;
          }
        }
      }
      if ((m + 1) % 1500 === 0 && !this.snaps.some(function (sn) { return sn.k === m + 1; })) {
        this.snaps.push({ k: m + 1, H: new Float32Array(H) });
      }
    }
    this.done = k;
  };

  /* ---------------- drawing ---------------- */
  var job = null, sim = null, img = null, off = null, offCtx = null;
  var k = 0, playing = false, last = 0, carry = 0;
  var SPEEDS = [1, 4, 16, 48, 120];

  function render() {
    if (!sim) return;
    var nx = sim.nx, ny = sim.ny, H = sim.H, d = img.data, span = sim.top - sim.bottom || 1;
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var idx = j * nx + i, h = H[idx];
        var hx = H[j * nx + Math.min(i + 1, nx - 1)] - H[j * nx + Math.max(i - 1, 0)];
        var hy = H[Math.min(j + 1, ny - 1) * nx + i] - H[Math.max(j - 1, 0) * nx + i];
        var shade = 1 + (-hx - hy) * 0.9 / sim.res;                // light from the top-left
        shade = shade < 0.45 ? 0.45 : shade > 1.35 ? 1.35 : shade;
        var t = (h - sim.bottom) / span;                            // 0 deep .. 1 top
        var uncut = h >= sim.top - 1e-4;
        // uncut stock: bright aluminium. Cut: dark steel at the bottom, lighter near the top
        var r = uncut ? 214 : 34 + 120 * t, g = uncut ? 221 : 48 + 122 * t, b = uncut ? 227 : 64 + 124 * t;
        var o = ((ny - 1 - j) * nx + i) * 4;                        // Y up on screen
        d[o] = r * shade; d[o + 1] = g * shade; d[o + 2] = b * shade; d[o + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    var W = canvas.width, Hc = canvas.height;
    ctx.fillStyle = "#0E161C";
    ctx.fillRect(0, 0, W, Hc);
    var sc = Math.min((W - 40) / nx, (Hc - 40) / ny), ox = (W - nx * sc) / 2, oy = (Hc - ny * sc) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, ox, oy, nx * sc, ny * sc);
    var toPx = function (x, y) { return [ox + (x - sim.x0) / sim.res * sc, oy + ny * sc - (y - sim.y0) / sim.res * sc]; };
    // recent path
    ctx.lineWidth = Math.max(1, sc * 0.15);
    ctx.strokeStyle = "rgba(255,138,61,.85)";
    ctx.beginPath();
    for (var m = Math.max(0, k - 160); m < k; m++) {
      var mv = sim.moves[m], p = toPx(mv.a[0], mv.a[1]), q = toPx(mv.b[0], mv.b[1]);
      if (mv.g === 1) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    }
    ctx.stroke();
    // tool
    var cur = sim.moves[Math.max(0, k - 1)];
    if (cur && k > 0) {
      var tl = sim.tools[cur.t] || { r: 1.5875 }, c = toPx(cur.b[0], cur.b[1]), rr = tl.r / sim.res * sc;
      ctx.lineWidth = 2;
      ctx.strokeStyle = cur.g === 0 ? "#FF5A4E" : "#FFFFFF";
      ctx.fillStyle = cur.g === 0 ? "rgba(255,90,78,.18)" : "rgba(255,255,255,.18)";
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(rr, 3), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // X0 Y0 marker
    var z0 = toPx(0, 0);
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(z0[0], z0[1], 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = "600 12px 'IBM Plex Mono', Consolas, monospace";
    ctx.fillText("X0 Y0", z0[0] + 6, z0[1] - 6);
    readout();
  }

  function readout() {
    var mv = sim.moves[Math.max(0, k - 1)];
    var tl = mv ? (job.tools[mv.t] || null) : null;
    var names = { flat: "flat end mill", ball: "ball nose", bull: "bull nose", drill: "drill" };
    els.tool.textContent = mv ? "T" + mv.t + (tl ? " " + names[tl.shape] + " D" + String(+(tl.r * 2).toFixed(3)) : "") : "-";
    els.pos.textContent = mv ? "X" + mv.b[0].toFixed(2) + " Y" + mv.b[1].toFixed(2) + " Z" + mv.b[2].toFixed(2) : "-";
    els.line.textContent = mv ? String(mv.n + 1) + " / " + job.lines.length : "-";
    els.time.textContent = Math.round(100 * k / sim.moves.length) + " %";
    els.seek.value = String(k);
    els.seek.setAttribute("aria-valuetext", "Move " + k + " of " + sim.moves.length);
    // listing
    var n = mv ? mv.n : 0, from = Math.max(0, n - 4), html = [];
    for (var i = from; i < Math.min(job.lines.length, from + 9); i++) {
      html.push((i === n ? "▶ " : "  ") + String(i + 1).padStart(5, " ") + "  " + job.lines[i].slice(0, 60));
    }
    els.lines.textContent = html.join("\n");
  }

  function setK(nk) {
    k = Math.max(0, Math.min(sim.moves.length, Math.round(nk)));
    sim.run(k);
    render();
  }

  function frame(ts) {
    if (!playing) return;
    var dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    carry += dt / 16 * SPEEDS[+els.speed.value];
    var add = Math.floor(carry);
    carry -= add;
    if (add) setK(k + add);
    if (k >= sim.moves.length) { pause(); return; }
    requestAnimationFrame(frame);
  }
  function play() {
    if (!sim) return;
    if (k >= sim.moves.length) setK(0);
    playing = true; last = 0;
    els.play.textContent = "Pause"; els.play.setAttribute("aria-pressed", "true");
    requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    els.play.textContent = "Play"; els.play.setAttribute("aria-pressed", "false");
  }

  function load(text, name) {
    pause();
    var j;
    try {
      j = parse(text);
      if (!j.moves.length) throw new Error("No tool moves found in this file.");
      sim = new Sim(j);
    } catch (e) {
      els.status.textContent = "Could not play " + name + ": " + e.message;
      els.status.hidden = false;
      return false;
    }
    job = j;
    els.status.hidden = true;
    off = document.createElement("canvas");
    off.width = sim.nx; off.height = sim.ny;
    offCtx = off.getContext("2d");
    img = offCtx.createImageData(sim.nx, sim.ny);
    els.seek.max = String(sim.moves.length);
    els.name.textContent = name;
    k = 0;
    sim.run(0);
    render();
    return true;
  }

  function sizeCanvas() {
    var w = canvas.clientWidth || 800;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * 0.62 * dpr);
    if (sim) render();
  }

  els.play.addEventListener("click", function () { playing ? pause() : play(); });
  els.back.addEventListener("click", function () { pause(); setK(k - 1); });
  els.fwd.addEventListener("click", function () { pause(); setK(k + 1); });
  els.start.addEventListener("click", function () { pause(); setK(0); });
  els.end.addEventListener("click", function () { pause(); setK(sim.moves.length); });
  els.seek.addEventListener("input", function () { pause(); setK(+els.seek.value); });
  els.file.addEventListener("change", function () {
    var f = els.file.files && els.file.files[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { els.status.textContent = "That file is over 25 MB - too big to play here."; els.status.hidden = false; return; }
    var rd = new FileReader();
    rd.onload = function () { if (load(String(rd.result), f.name) && !reduce) play(); };
    rd.readAsText(f);
  });
  window.addEventListener("resize", function () { clearTimeout(sizeCanvas.t); sizeCanvas.t = setTimeout(sizeCanvas, 150); });

  sizeCanvas();
  var src = root.getAttribute("data-src");
  fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
    if (!load(t, root.getAttribute("data-name") || src)) return;
    // start when it scrolls into view (not for people who prefer less motion)
    if (!reduce && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && k === 0) { play(); io.disconnect(); } });
      }, { threshold: 0.45 });
      io.observe(canvas);
    }
  }).catch(function () {
    els.status.textContent = "The demo program could not be loaded. You can still open your own G-code file.";
    els.status.hidden = false;
  });
})();
