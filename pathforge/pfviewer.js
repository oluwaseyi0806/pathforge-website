// pfviewer.js - PathForge 3D G-code viewer (WebGL2, no libraries).
//
// Reads G-code the way a machine does (G0/G1/G2/G3, G81/G83, tool changes,
// inch/mm), removes material from a virtual block and shows it in 3D with
// light and shade, the toolpath, and the real tool shape.
//
// Use:  <div class="pfv" data-src="file.nc" data-name="title"></div>
//       or PFViewer.mount(element, {text: "...gcode...", name: "title"})
// Files opened by the visitor are read by their own browser, never uploaded.
(function () {
  "use strict";

  /* ======================= G-code reader ======================= */
  var WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  function parse(text) {
    var lines = text.split(/\r?\n/), moves = [], tools = {}, ops = [], stock = null;
    var pos = { x: null, y: null, z: null }, mode = 0, units = 1, tool = 1, cycle = null, retInit = true;
    var feed = 0, rpm = 0, op = "Program start", m;
    function addOp(name, n) { ops.push({ name: name, move: moves.length, line: n }); op = name; }
    for (var n = 0; n < lines.length; n++) {
      var raw = lines[n].toUpperCase(), re = /\(([^)]*)\)/g, c;
      while ((c = re.exec(raw))) {
        var t = c[1].trim();
        if ((m = /^T(\d+)\s+(FLAT END MILL|BALL END MILL|BULL NOSE|DRILL)\s+D([\d.]+)MM(?:\s+R([\d.]+))?/.exec(t))) {
          tools[+m[1]] = { shape: m[2] === "BALL END MILL" ? "ball" : m[2] === "BULL NOSE" ? "bull" : m[2] === "DRILL" ? "drill" : "flat",
            r: +m[3] / 2, rc: m[4] ? +m[4] : 0 };
        } else if ((m = /^STOCK\s+([\d.]+)\s*X\s*([\d.]+)\s*X\s*([\d.]+)\s*(MM|IN)/.exec(t))) {
          stock = { x: +m[1], y: +m[2], z: +m[3] };
        } else if ((m = /^TOOL\s+(\d+)\b(.*)/.exec(t))) {
          tool = +m[1]; addOp("Tool " + m[1] + " -" + m[2].replace(/MM\b/g, " mm").toLowerCase(), n);
        } else if (/^(ROUGH CLEAR|REST ROUGHING|WATERLINE|PARALLEL|FLOOR FINISH|DRILL)/.test(t)) {
          addOp(t.split(" - ")[0].replace(/\b(\w)(\w*)/g, function (a, b, r) { return b + r.toLowerCase(); }), n);
        }
      }
      var code = raw.replace(/\([^)]*\)/g, "").split(";")[0].trim();
      if (!code || code === "%") continue;
      var w = {}, gs = [];
      WORD.lastIndex = 0;
      while ((m = WORD.exec(code))) { if (m[1] === "G") gs.push(parseFloat(m[2])); else w[m[1]] = parseFloat(m[2]); }
      if ("T" in w) tool = Math.round(w.T);
      if ("S" in w) rpm = w.S;
      var newCycle = null, mc = gs.indexOf(53) >= 0;
      gs.forEach(function (g) {
        if (g === 0 || g === 1 || g === 2 || g === 3) { mode = g; cycle = null; }
        else if (g === 20) units = 25.4; else if (g === 21) units = 1;
        else if (g === 80) cycle = null; else if (g === 98) retInit = true; else if (g === 99) retInit = false;
        else if (g === 81 || g === 83) newCycle = g;
      });
      if ("F" in w) feed = w.F * units;
      if (mc) continue;
      var nx = "X" in w ? w.X * units : pos.x, ny = "Y" in w ? w.Y * units : pos.y, nz = "Z" in w ? w.Z * units : pos.z;
      function push(g, a, b, f) { moves.push({ n: n, g: g, a: a, b: b, t: tool, f: f, s: rpm }); }
      if (newCycle) cycle = { z: w.Z * units, r: w.R * units, q: "Q" in w ? w.Q * units : 0, init: pos.z };
      if (cycle && ("X" in w || "Y" in w || newCycle)) {
        var r = cycle.r, zb = cycle.z, top = cycle.init == null ? r : Math.max(cycle.init, r);
        if (pos.x != null) push(0, [pos.x, pos.y, pos.z == null ? top : pos.z], [nx, ny, top], 0);
        push(0, [nx, ny, top], [nx, ny, r], 0);
        var step = cycle.q > 0 ? cycle.q : r - zb, d = r;
        while (d > zb + 1e-9) { var nd = Math.max(zb, d - step); push(1, [nx, ny, d], [nx, ny, nd], feed); d = nd; }
        var back = retInit ? top : r;
        push(0, [nx, ny, zb], [nx, ny, back], 0);
        pos = { x: nx, y: ny, z: back };
        continue;
      }
      if (!("X" in w || "Y" in w || "Z" in w)) continue;
      if (pos.x == null || pos.y == null || pos.z == null) { pos = { x: nx, y: ny, z: nz }; continue; }
      if ((mode === 2 || mode === 3) && ("I" in w || "J" in w || "R" in w)) {
        var cx, cy, x0 = pos.x, y0 = pos.y;
        if ("R" in w) {
          var R = w.R * units, mx = (x0 + nx) / 2, my = (y0 + ny) / 2, dx = nx - x0, dy = ny - y0, L = Math.hypot(dx, dy);
          var hh = Math.sqrt(Math.max(R * R - L * L / 4, 0)), sg = (mode === 2) === (R > 0) ? 1 : -1;
          cx = mx - sg * hh * dy / L; cy = my + sg * hh * dx / L;
        } else { cx = x0 + (w.I || 0) * units; cy = y0 + (w.J || 0) * units; }
        var r0 = Math.hypot(x0 - cx, y0 - cy), a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(ny - cy, nx - cx);
        var sw = mode === 2 ? a0 - a1 : a1 - a0;
        if (sw <= 1e-9) sw += 2 * Math.PI;
        if (mode === 2) sw = -sw;
        var k = Math.max(2, Math.ceil(Math.abs(sw) * r0 / 0.4)), px = x0, py = y0, pz = pos.z;
        for (var i = 1; i <= k; i++) {
          var aa = a0 + sw * i / k, qx = i === k ? nx : cx + r0 * Math.cos(aa), qy = i === k ? ny : cy + r0 * Math.sin(aa);
          var qz = pos.z + (nz - pos.z) * i / k;
          push(1, [px, py, pz], [qx, qy, qz], feed); px = qx; py = qy; pz = qz;
        }
      } else push(mode === 0 ? 0 : 1, [pos.x, pos.y, pos.z], [nx, ny, nz], mode === 0 ? 0 : feed);
      pos = { x: nx, y: ny, z: nz };
    }
    if (!ops.length || ops[0].move > 0) ops.unshift({ name: "Program start", move: 0, line: 0 });
    var nice = { flat: "Flat end mill", ball: "Ball nose", bull: "Bull nose", drill: "Drill" };
    ops.forEach(function (o) {
      var q = /^Tool (\d+)/.exec(o.name), tl = q && tools[+q[1]];
      if (tl) o.name = "Tool " + q[1] + " \u00B7 " + nice[tl.shape] + " \u00D8" + (+(tl.r * 2).toFixed(3));
    });
    return { lines: lines, moves: moves, tools: tools, ops: ops, stock: stock, inch: units !== 1 };
  }

  /* ======================= material removal ======================= */
  function Sim(job) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zmin = 0, rmax = 1.6;
    Object.keys(job.tools).forEach(function (k) { rmax = Math.max(rmax, job.tools[k].r); });
    job.moves.forEach(function (mv) {
      if (mv.g !== 1) return;
      x0 = Math.min(x0, mv.a[0], mv.b[0]); x1 = Math.max(x1, mv.a[0], mv.b[0]);
      y0 = Math.min(y0, mv.a[1], mv.b[1]); y1 = Math.max(y1, mv.a[1], mv.b[1]);
      zmin = Math.min(zmin, mv.b[2]);
    });
    if (!isFinite(x0)) throw new Error("No cutting moves found in this file.");
    if (job.stock) { x0 = 0; y0 = 0; x1 = job.stock.x; y1 = job.stock.y; zmin = Math.min(zmin, -job.stock.z); }
    else { x0 -= rmax; y0 -= rmax; x1 += rmax; y1 += rmax; }
    this.x0 = x0; this.y0 = y0;
    var span = Math.max(x1 - x0, y1 - y0);
    this.res = Math.max(0.1, span / 420);
    this.nx = Math.max(8, Math.ceil((x1 - x0) / this.res));
    this.ny = Math.max(8, Math.ceil((y1 - y0) / this.res));
    this.top = 0; this.bottom = Math.min(zmin, -0.5);
    if (job.stock) this.bottom = Math.min(this.bottom, -job.stock.z);
    this.H = new Float32Array(this.nx * this.ny);
    this.moves = job.moves; this.tools = job.tools; this.feet = {}; this.snaps = [];
    this.reset();
  }
  Sim.prototype.reset = function () { this.H.fill(this.top); this.done = 0; };
  Sim.prototype.foot = function (t) {
    if (this.feet[t]) return this.feet[t];
    var tl = this.tools[t] || { shape: "flat", r: 1.5875, rc: 0 }, res = this.res, n = Math.ceil(tl.r / res), di = [], dj = [], pr = [];
    for (var j = -n; j <= n; j++) for (var i = -n; i <= n; i++) {
      var d = Math.hypot(i * res, j * res);
      if (d > tl.r) continue;
      var p = 0;
      if (tl.shape === "ball") p = tl.r - Math.sqrt(Math.max(tl.r * tl.r - d * d, 0));
      else if (tl.shape === "bull") { var e = Math.max(d - (tl.r - tl.rc), 0); p = tl.rc - Math.sqrt(Math.max(tl.rc * tl.rc - e * e, 0)); }
      else if (tl.shape === "drill") p = d * 0.6;
      di.push(i); dj.push(j); pr.push(p);
    }
    return (this.feet[t] = { i: Int32Array.from(di), j: Int32Array.from(dj), p: Float32Array.from(pr) });
  };
  Sim.prototype.run = function (k) {
    k = Math.min(k, this.moves.length);
    if (k < this.done) {
      var best = null;
      for (var s = 0; s < this.snaps.length; s++) if (this.snaps[s].k <= k && (!best || this.snaps[s].k > best.k)) best = this.snaps[s];
      if (best) { this.H.set(best.H); this.done = best.k; } else this.reset();
    }
    var H = this.H, nx = this.nx, ny = this.ny, res = this.res;
    for (var m = this.done; m < k; m++) {
      var mv = this.moves[m];
      if (mv.g === 1) {
        var f = this.foot(mv.t), a = mv.a, b = mv.b;
        var L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / (0.7 * res)));
        for (var s2 = 0; s2 <= steps; s2++) {
          var u = s2 / steps, z = a[2] + (b[2] - a[2]) * u;
          if (z >= this.top) continue;
          var ci = Math.round((a[0] + (b[0] - a[0]) * u - this.x0) / res - 0.5), cj = Math.round((a[1] + (b[1] - a[1]) * u - this.y0) / res - 0.5);
          for (var q = 0; q < f.i.length; q++) {
            var ii = ci + f.i[q], jj = cj + f.j[q];
            if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
            var idx = jj * nx + ii, zz = z + f.p[q];
            if (zz < H[idx]) H[idx] = zz;
          }
        }
      }
      if ((m + 1) % 1200 === 0) {
        var have = false;
        for (var t = 0; t < this.snaps.length; t++) if (this.snaps[t].k === m + 1) have = true;
        if (!have) this.snaps.push({ k: m + 1, H: new Float32Array(H) });
      }
    }
    this.done = k;
  };

  /* ======================= small maths ======================= */
  function persp(fov, asp, n, f) {
    var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s;
    }
    return o;
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  /* ======================= shaders ======================= */
  var VS_STOCK = "#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 aC;uniform sampler2D uH;uniform ivec2 uN;" +
    "uniform vec2 uO;uniform float uRes;uniform float uBot;uniform mat4 uM;out vec3 vN;out float vH;out vec3 vP;" +
    "float h(ivec2 c){if(c.x<0||c.y<0||c.x>=uN.x||c.y>=uN.y)return uBot;return texelFetch(uH,c,0).r;}" +
    "void main(){ivec2 c=ivec2(aC);float z=h(c);float hx=h(c+ivec2(1,0))-h(c-ivec2(1,0));float hy=h(c+ivec2(0,1))-h(c-ivec2(0,1));" +
    "vN=normalize(vec3(-hx,-hy,2.0*uRes));vH=z;vec2 q=uO+(vec2(clamp(c,ivec2(0),uN-1))+0.5)*uRes;vP=vec3(q,z);gl_Position=uM*vec4(vP,1.0);}";
  var FS_STOCK = "#version 300 es\nprecision highp float;in vec3 vN;in float vH;in vec3 vP;uniform float uTop;uniform float uBot;uniform vec3 uEye;out vec4 o;" +
    "void main(){vec3 n=normalize(vN);vec3 L=normalize(vec3(-0.45,-0.65,0.9));vec3 V=normalize(uEye-vP);" +
    "float t=clamp((vH-uBot)/max(uTop-uBot,1e-3),0.0,1.0);bool uncut=vH>=uTop-1e-4;" +
    "vec3 base=uncut?vec3(0.80,0.83,0.86):mix(vec3(0.30,0.40,0.52),vec3(0.66,0.74,0.82),t);" +
    "float d=max(dot(n,L),0.0);float s=pow(max(dot(reflect(-L,n),V),0.0),uncut?18.0:40.0)*(uncut?0.12:0.35);" +
    "float rim=0.12*pow(1.0-max(dot(n,V),0.0),2.0);o=vec4(base*(0.38+0.70*d)+vec3(s+rim),1.0);}";
  var VS_LINE = "#version 300 es\nin vec3 aP;in vec4 aK;uniform mat4 uM;out vec4 vK;void main(){vK=aK;gl_Position=uM*vec4(aP,1.0);gl_Position.z-=0.0004*gl_Position.w;}";
  var FS_LINE = "#version 300 es\nprecision mediump float;in vec4 vK;uniform float uA;out vec4 o;void main(){o=vec4(vK.rgb,vK.a*uA);}";
  var VS_TOOL = "#version 300 es\nin vec3 aP;in vec3 aN;in float aK;uniform mat4 uM;uniform vec3 uT;out vec3 vN;out float vK;" +
    "void main(){vN=aN;vK=aK;gl_Position=uM*vec4(aP+uT,1.0);}";
  var FS_TOOL = "#version 300 es\nprecision mediump float;in vec3 vN;in float vK;uniform vec3 uC;out vec4 o;" +
    "void main(){vec3 n=normalize(vN);float d=max(dot(n,normalize(vec3(-0.45,-0.65,0.9))),0.0);" +
    "vec3 c=vK<0.5?uC:(vK<1.5?vec3(0.72,0.75,0.78):vec3(0.22,0.25,0.29));o=vec4(c*(0.35+0.75*d),vK<1.5?1.0:0.55);}";

  function prog(gl, vs, fs) {
    function sh(t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p: p, u: u };
  }

  // a tool as a lathe: flutes (gold), shank (steel), holder (dark, see-through)
  function toolMesh(tl) {
    var R = tl.r, pts = [], k = 0;
    var flute = Math.max(3 * 2 * R, 6), stick = flute + Math.max(10, 4 * R), hold = Math.max(14, 2.2 * R);
    if (tl.shape === "ball") { for (k = 0; k <= 8; k++) { var a = k / 8 * Math.PI / 2; pts.push([R * Math.sin(a), R - R * Math.cos(a), 0]); } }
    else if (tl.shape === "bull") { var rc = tl.rc || 0.2 * R; pts.push([0, 0, 0]); for (k = 0; k <= 6; k++) { var b = k / 6 * Math.PI / 2; pts.push([R - rc + rc * Math.sin(b), rc - rc * Math.cos(b), 0]); } }
    else if (tl.shape === "drill") { pts.push([0, 0, 0]); pts.push([R, R * 0.6, 0]); }
    else { pts.push([0, 0, 0]); pts.push([R, 0, 0]); }
    pts.push([R, flute, 0]); pts.push([R, flute, 1]); pts.push([R, stick, 1]); pts.push([R, stick, 2]);
    pts.push([hold, stick + 0.01, 2]); pts.push([hold, stick + 30, 2]); pts.push([0, stick + 30, 2]);
    var P = [], N = [], K = [], seg = 36;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i], p1 = pts[i + 1], dr = p1[0] - p0[0], dz = p1[1] - p0[1], nl = Math.hypot(dr, dz) || 1, nr = dz / nl, nzv = -dr / nl;
      for (var s = 0; s < seg; s++) {
        var t0 = s / seg * 2 * Math.PI, t1 = (s + 1) / seg * 2 * Math.PI, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        var quad = [[p0[0] * c0, p0[0] * s0, p0[1], c0, s0], [p1[0] * c0, p1[0] * s0, p1[1], c0, s0], [p1[0] * c1, p1[0] * s1, p1[1], c1, s1],
          [p0[0] * c0, p0[0] * s0, p0[1], c0, s0], [p1[0] * c1, p1[0] * s1, p1[1], c1, s1], [p0[0] * c1, p0[0] * s1, p0[1], c1, s1]];
        quad.forEach(function (v) { P.push(v[0], v[1], v[2]); N.push(nr * v[3], nr * v[4], nzv); K.push(p1[2]); });
      }
    }
    return { P: new Float32Array(P), N: new Float32Array(N), K: new Float32Array(K), count: P.length / 3 };
  }

  /* ======================= the viewer ======================= */
  var SPEEDS = [1, 3, 10, 30, 90, 250];
  var OPCOL = { rapid: [0.92, 0.27, 0.22, 0.55], drill: [0.95, 0.75, 0.10, 1] };
  var TOOLCOL = [[0.05, 0.46, 0.86, 1], [0.60, 0.20, 0.80, 1], [0.05, 0.62, 0.45, 1], [0.85, 0.42, 0.05, 1]];

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function Viewer(root, opts) {
    this.root = root; this.opts = opts || {};
    root.classList.add("pfv");
    root.innerHTML = "";
    var stage = el("div", "pfv-stage"), canvas = el("canvas"), hud = el("div", "pfv-hud"), views = el("div", "pfv-views");
    var drop = el("div", "pfv-drop", "Drop a G-code file here"), msg = el("p", "pfv-msg");
    msg.hidden = true;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "3D view of the block being cut by the G-code program");
    stage.appendChild(canvas); stage.appendChild(hud); stage.appendChild(views); stage.appendChild(drop); stage.appendChild(msg);
    var side = el("div", "pfv-side"), title = el("p", "pfv-title", "Loading..."), stats = el("dl", "pfv-stats");
    var opsBox = el("div", "pfv-ops"), list = el("pre", "pfv-list");
    list.setAttribute("aria-label", "G-code lines around the current move");
    side.appendChild(title); side.appendChild(stats); side.appendChild(el("h3", "pfv-h", "Operations")); side.appendChild(opsBox);
    side.appendChild(el("h3", "pfv-h", "G-code")); side.appendChild(list);
    var bar = el("div", "pfv-bar"), line = el("div", "pfv-timeline"), seek = el("input", "pfv-seek"), marks = el("div", "pfv-marks");
    seek.type = "range"; seek.min = "0"; seek.max = "1"; seek.value = "0"; seek.setAttribute("aria-label", "Position in the program");
    line.appendChild(marks); line.appendChild(seek);
    var ctr = el("div", "pfv-ctr");
    var self = this;
    function btn(label, aria, fn, cls) { var b = el("button", cls || "", label); b.type = "button"; if (aria) b.setAttribute("aria-label", aria); b.addEventListener("click", fn); ctr.appendChild(b); return b; }
    btn("⏮", "Previous operation", function () { self.jumpOp(-1); });
    btn("◀", "One move back", function () { self.pause(); self.setK(self.k - 1); });
    this.playBtn = btn("Play", null, function () { self.resumeLater = false; self.playing ? self.pause() : self.play(); }, "pfv-play");
    btn("▶", "One move forward", function () { self.pause(); self.setK(self.k + 1); });
    btn("⏭", "Next operation", function () { self.jumpOp(1); });
    var spl = el("label", "pfv-speed", "Speed "), sp = el("select");
    ["Slow", "Normal", "Fast", "Faster", "Very fast", "Fastest"].forEach(function (t, i) { var o = el("option", null, t); o.value = String(i); sp.appendChild(o); });
    sp.value = "2"; spl.appendChild(sp); ctr.appendChild(spl);
    var fileLab = el("label", "pfv-file", "Open G-code"), file = el("input");
    file.type = "file"; file.accept = ".nc,.gcode,.ngc,.tap,.txt,.cnc"; fileLab.appendChild(file); ctr.appendChild(fileLab);
    bar.appendChild(line); bar.appendChild(ctr);
    root.appendChild(stage); root.appendChild(side); root.appendChild(bar);
    this.el = { canvas: canvas, hud: hud, views: views, title: title, stats: stats, ops: opsBox, list: list, seek: seek, marks: marks, speed: sp, msg: msg, drop: drop, stage: stage };
    [["Iso", [-0.65, -0.95, 0.75]], ["Top", [0, -0.0001, 1]], ["Front", [0, -1, 0.18]], ["Side", [1, 0, 0.18]]].forEach(function (v) {
      var b = el("button", "", v[0]); b.type = "button"; b.addEventListener("click", function () { self.viewDir(v[1]); }); views.appendChild(b);
    });
    var fit = el("button", "", "Fit"); fit.type = "button"; fit.addEventListener("click", function () { self.fit(); }); views.appendChild(fit);
    this.showPath = true;
    var pt = el("button", "on", "Path"); pt.type = "button"; pt.setAttribute("aria-pressed", "true");
    pt.addEventListener("click", function () { self.showPath = !self.showPath; pt.classList.toggle("on", self.showPath); pt.setAttribute("aria-pressed", String(self.showPath)); self.draw(); });
    views.appendChild(pt);
    this.showFuture = false;
    var ft = el("button", "", "Whole path"); ft.type = "button"; ft.setAttribute("aria-pressed", "false");
    ft.addEventListener("click", function () { self.showFuture = !self.showFuture; ft.classList.toggle("on", self.showFuture); ft.setAttribute("aria-pressed", String(self.showFuture)); self.draw(); });
    views.appendChild(ft);

    var gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) { this.fail("Your browser can't show 3D (WebGL 2). Try Chrome, Edge or Firefox."); return; }
    this.gl = gl;
    try {
      this.pS = prog(gl, VS_STOCK, FS_STOCK); this.pL = prog(gl, VS_LINE, FS_LINE); this.pT = prog(gl, VS_TOOL, FS_TOOL);
    } catch (e) { this.fail("3D setup failed: " + e.message); return; }
    this.cam = { yaw: -0.6, pitch: 0.62, dist: 200, tx: 0, ty: 0, tz: 0 };
    this.k = 0; this.playing = false;
    this.bindInput(); this.bindFile(file);
    var r = function () { self.resize(); };
    window.addEventListener("resize", r);
    this.resize();
  }

  Viewer.prototype.fail = function (text) { this.el.msg.textContent = text; this.el.msg.hidden = false; };

  Viewer.prototype.load = function (text, name) {
    this.pause();
    var job;
    try { job = parse(text); if (!job.moves.length) throw new Error("No tool moves found in this file."); this.sim = new Sim(job); }
    catch (e) { this.fail("Could not open " + name + ": " + e.message); return false; }
    this.el.msg.hidden = true;
    this.job = job; this.name = name;
    var gl = this.gl, sim = this.sim;
    // timing: cumulative minutes at the end of each move
    var t = 0, cum = new Float64Array(job.moves.length), cut = 0;
    job.moves.forEach(function (mv, i) {
      var L = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1], mv.b[2] - mv.a[2]);
      t += mv.g === 1 && mv.f > 0 ? L / mv.f : L / 5000; if (mv.g === 1) cut += L; cum[i] = t;
    });
    this.cum = cum;
    // stock surface grid (with a one-cell skirt so the block has sides)
    var NX = sim.nx + 2, NY = sim.ny + 2, cells = new Float32Array(NX * NY * 2), p = 0;
    for (var j = -1; j <= sim.ny; j++) for (var i = -1; i <= sim.nx; i++) { cells[p++] = i; cells[p++] = j; }
    var idx = new Uint32Array((NX - 1) * (NY - 1) * 6); p = 0;
    for (var y = 0; y < NY - 1; y++) for (var x = 0; x < NX - 1; x++) {
      var a = y * NX + x; idx[p++] = a; idx[p++] = a + 1; idx[p++] = a + NX; idx[p++] = a + 1; idx[p++] = a + NX + 1; idx[p++] = a + NX;
    }
    this.vaoS = gl.createVertexArray(); gl.bindVertexArray(this.vaoS);
    var b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(this.pS.p, "aC"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var b2 = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b2); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.nIdx = idx.length;
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim.nx, sim.ny, 0, gl.RED, gl.FLOAT, sim.H);
    // toolpath lines (one segment per move), coloured by type and tool
    var tnums = Object.keys(job.tools).map(Number).sort(function (a, b) { return a - b; });
    var LP = new Float32Array(job.moves.length * 6), LK = new Float32Array(job.moves.length * 8);
    job.moves.forEach(function (mv, i) {
      LP.set([mv.a[0], mv.a[1], mv.a[2], mv.b[0], mv.b[1], mv.b[2]], i * 6);
      var tl = job.tools[mv.t], ti = Math.max(0, tnums.indexOf(mv.t));
      var c = mv.g === 0 ? OPCOL.rapid : (tl && tl.shape === "drill" ? OPCOL.drill : TOOLCOL[ti % TOOLCOL.length]);
      LK.set(c, i * 8); LK.set(c, i * 8 + 4);
    });
    this.vaoL = gl.createVertexArray(); gl.bindVertexArray(this.vaoL);
    var lb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, lb); gl.bufferData(gl.ARRAY_BUFFER, LP, gl.STATIC_DRAW);
    loc = gl.getAttribLocation(this.pL.p, "aP"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    var kb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, kb); gl.bufferData(gl.ARRAY_BUFFER, LK, gl.STATIC_DRAW);
    loc = gl.getAttribLocation(this.pL.p, "aK"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.toolVaos = {};
    this.texDirty = true;
    this.buildSide(cut, t);
    this.lastOp = -1; this.k = 0;
    this.fit(); this.setK(0);
    return true;
  };

  Viewer.prototype.toolVao = function (tn) {
    if (this.toolVaos[tn]) return this.toolVaos[tn];
    var gl = this.gl, m = toolMesh(this.job.tools[tn] || { shape: "flat", r: 1.5875 }), vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    [["aP", m.P, 3], ["aN", m.N, 3], ["aK", m.K, 1]].forEach(function (a) {
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a[1], gl.STATIC_DRAW);
      var l = gl.getAttribLocation(this.pT.p, a[0]); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, a[2], gl.FLOAT, false, 0, 0);
    }, this);
    gl.bindVertexArray(null);
    return (this.toolVaos[tn] = { vao: vao, count: m.count });
  };

  function fmtMin(m) { var s = Math.round(m * 60); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  Viewer.prototype.buildSide = function (cut, total) {
    var job = this.job, self = this, e = this.el;
    e.title.textContent = this.name;
    var names = { flat: "flat end mill", ball: "ball nose", bull: "bull nose", drill: "drill" };
    var tl = Object.keys(job.tools).map(function (k) { var t = job.tools[k]; return "T" + k + " " + names[t.shape] + " D" + (+(t.r * 2).toFixed(3)); });
    var rows = [["Moves", job.moves.length.toLocaleString()], ["Lines", job.lines.length.toLocaleString()],
      ["Cutting length", (cut / 1000).toFixed(2) + " m"], ["Estimated time", fmtMin(total) + " min"],
      ["Tools", tl.join(", ") || "-"]];
    if (job.stock) rows.splice(2, 0, ["Stock", job.stock.x + " x " + job.stock.y + " x " + job.stock.z + (job.inch ? " in" : " mm")]);
    e.stats.innerHTML = "";
    rows.forEach(function (r) { var d = el("div"); d.appendChild(el("dt", null, r[0])); d.appendChild(el("dd", null, r[1])); e.stats.appendChild(d); });
    e.ops.innerHTML = ""; e.marks.innerHTML = "";
    var N = Math.max(1, job.moves.length);
    job.ops.forEach(function (op, i) {
      var b = el("button", "pfv-op", op.name); b.type = "button";
      b.addEventListener("click", function () { self.pause(); self.setK(op.move); });
      op.btn = b; e.ops.appendChild(b);
      var mk = el("span", "pfv-mark"); mk.style.left = (100 * op.move / N) + "%"; mk.title = op.name; e.marks.appendChild(mk);
      if (/^Tool/.test(op.name)) mk.classList.add("tool");
    });
    e.seek.max = String(job.moves.length);
  };

  Viewer.prototype.opAt = function (k) {
    var ops = this.job.ops, cur = 0;
    for (var i = 0; i < ops.length; i++) if (ops[i].move <= Math.max(0, k - 1)) cur = i;
    return cur;
  };
  Viewer.prototype.jumpOp = function (d) {
    this.pause();
    var ops = this.job.ops, i = this.opAt(this.k);
    if (d < 0 && this.k > ops[i].move + 1) { this.setK(ops[i].move); return; }
    i = Math.max(0, Math.min(ops.length - 1, i + d));
    this.setK(d > 0 && i === this.opAt(this.k) ? this.job.moves.length : ops[i].move);
  };

  Viewer.prototype.setK = function (k) {
    if (!this.sim) return;
    this.k = Math.max(0, Math.min(this.job.moves.length, Math.round(k)));
    this.sim.run(this.k); this.texDirty = true;
    this.readout(); this.draw();
  };

  Viewer.prototype.readout = function () {
    var job = this.job, e = this.el, mv = job.moves[Math.max(0, this.k - 1)];
    var tl = mv && job.tools[mv.t], names = { flat: "flat end mill", ball: "ball nose", bull: "bull nose", drill: "drill" };
    var u = job.inch ? 1 / 25.4 : 1, dec = job.inch ? 4 : 3;
    var opi = this.opAt(this.k);
    e.hud.innerHTML = "";
    var rows = [["", job.ops[opi].name],
      ["Tool", mv ? "T" + mv.t + (tl ? "  " + names[tl.shape] + " D" + (+(tl.r * 2).toFixed(3)) : "") : "-"],
      ["X", mv ? (mv.b[0] * u).toFixed(dec) : "-"], ["Y", mv ? (mv.b[1] * u).toFixed(dec) : "-"], ["Z", mv ? (mv.b[2] * u).toFixed(dec) : "-"],
      ["Feed", mv ? (mv.g === 0 ? "RAPID" : Math.round(mv.f * u * 10) / 10 + (job.inch ? " in/min" : " mm/min")) : "-"],
      ["Spindle", mv && mv.s ? Math.round(mv.s) + " rpm" : "-"],
      ["Time", fmtMin(this.k ? this.cum[this.k - 1] : 0) + " / " + fmtMin(this.cum[this.cum.length - 1])]];
    rows.forEach(function (r, i) {
      var d = el("div", i === 0 ? "pfv-hop" : (r[0] === "Feed" && mv && mv.g === 0 ? "rapid" : ""));
      if (r[0]) d.appendChild(el("span", "k", r[0]));
      d.appendChild(el("span", "v", r[1])); e.hud.appendChild(d);
    });
    e.seek.value = String(this.k);
    e.seek.setAttribute("aria-valuetext", "Move " + this.k + " of " + job.moves.length + ", " + job.ops[opi].name);
    job.ops.forEach(function (op, i) { op.btn.classList.toggle("on", i === opi); });
    if (this.lastOp !== opi) {
      this.lastOp = opi;
      var ob = job.ops[opi].btn, box = e.ops;
      if (ob.offsetTop < box.scrollTop || ob.offsetTop + ob.offsetHeight > box.scrollTop + box.clientHeight)
        box.scrollTop = ob.offsetTop - box.clientHeight / 2;
    }
    var n = mv ? mv.n : 0, from = Math.max(0, n - 5), out = [];
    for (var i = from; i < Math.min(job.lines.length, from + 11); i++) out.push((i === n ? "▶" : " ") + String(i + 1).padStart(6, " ") + "  " + job.lines[i].slice(0, 64));
    e.list.textContent = out.join("\n");
  };

  /* ---------- camera ---------- */
  Viewer.prototype.bounds = function () {
    var s = this.sim, x1 = s.x0 + s.nx * s.res, y1 = s.y0 + s.ny * s.res;
    return { cx: (s.x0 + x1) / 2, cy: (s.y0 + y1) / 2, cz: (s.top + s.bottom) / 2, r: Math.hypot(x1 - s.x0, y1 - s.y0, s.top - s.bottom) / 2 };
  };
  Viewer.prototype.fit = function () {
    if (!this.sim) return;
    var b = this.bounds(); this.cam.tx = b.cx; this.cam.ty = b.cy; this.cam.tz = b.cz;
    var cv = this.el.canvas, asp = (cv.clientWidth || 4) / (cv.clientHeight || 3);
    this.cam.dist = b.r * 2.6 / Math.min(1, asp / 1.5); this.draw();
  };
  Viewer.prototype.viewDir = function (d) {
    var v = norm(d); this.cam.pitch = Math.asin(v[2]); this.cam.yaw = Math.atan2(v[0], -v[1]); this.fit();
  };
  Viewer.prototype.eye = function () {
    var c = this.cam, cp = Math.cos(c.pitch);
    return [c.tx + c.dist * cp * Math.sin(c.yaw), c.ty - c.dist * cp * Math.cos(c.yaw), c.tz + c.dist * Math.sin(c.pitch)];
  };
  Viewer.prototype.bindInput = function () {
    var self = this, cv = this.el.canvas, drag = null, pts = {};
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY];
      drag = { pan: e.button === 2 || e.shiftKey || Object.keys(pts).length > 1, x: e.clientX, y: e.clientY };
    });
    cv.addEventListener("pointermove", function (e) {
      if (!drag || !pts[e.pointerId]) return;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var o = pts[ids[0] === String(e.pointerId) ? ids[1] : ids[0]], p0 = pts[e.pointerId];
        var d0 = Math.hypot(p0[0] - o[0], p0[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
        if (d0 > 0 && d1 > 0) self.cam.dist *= d0 / d1;
        pts[e.pointerId] = [e.clientX, e.clientY]; self.draw(); return;
      }
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      pts[e.pointerId] = [e.clientX, e.clientY];
      if (drag.pan) {
        var c = self.cam, s = c.dist / cv.clientHeight * 0.9, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), sp = Math.sin(c.pitch);
        c.tx -= (dx * cy - dy * sy * sp) * s; c.ty -= (dx * sy + dy * cy * sp) * s; c.tz += dy * Math.cos(c.pitch) * s;
      } else {
        self.cam.yaw -= dx * 0.008; self.cam.pitch = Math.max(-0.2, Math.min(1.5707, self.cam.pitch + dy * 0.008));
      }
      self.draw();
    });
    function up(e) { delete pts[e.pointerId]; if (!Object.keys(pts).length) drag = null; }
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); self.cam.dist *= Math.exp(e.deltaY * 0.0012); self.draw(); }, { passive: false });
    cv.tabIndex = 0;
    cv.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === " ") { e.preventDefault(); self.playing ? self.pause() : self.play(); }
      else if (k === "ArrowRight") { e.preventDefault(); self.pause(); self.setK(self.k + (e.shiftKey ? 50 : 1)); }
      else if (k === "ArrowLeft") { e.preventDefault(); self.pause(); self.setK(self.k - (e.shiftKey ? 50 : 1)); }
      else if (k === "Home") { self.pause(); self.setK(0); } else if (k === "End") { self.pause(); self.setK(self.job.moves.length); }
    });
    this.el.seek.addEventListener("input", function () { self.pause(); self.setK(+self.el.seek.value); });
  };
  Viewer.prototype.bindFile = function (input) {
    var self = this, st = this.el.stage;
    function read(f) {
      if (!f) return;
      if (f.size > 40 * 1024 * 1024) { self.fail("That file is over 40 MB - too big to show here."); return; }
      var rd = new FileReader();
      rd.onload = function () { if (self.load(String(rd.result), f.name) && !self.reduce) self.play(); };
      rd.readAsText(f);
    }
    input.addEventListener("change", function () { read(input.files && input.files[0]); });
    st.addEventListener("dragover", function (e) { e.preventDefault(); st.classList.add("drag"); });
    st.addEventListener("dragleave", function () { st.classList.remove("drag"); });
    st.addEventListener("drop", function (e) { e.preventDefault(); st.classList.remove("drag"); read(e.dataTransfer.files && e.dataTransfer.files[0]); });
  };

  /* ---------- play ---------- */
  Viewer.prototype.play = function () {
    if (!this.sim) return;
    if (this.k >= this.job.moves.length) this.setK(0);
    this.playing = true; this.last = 0; this.carry = 0;
    this.playBtn.textContent = "Pause"; this.playBtn.setAttribute("aria-pressed", "true");
    var self = this;
    requestAnimationFrame(function f(ts) {
      if (!self.playing) return;
      var dt = self.last ? Math.min(100, ts - self.last) : 16; self.last = ts;
      self.carry += dt / 16 * SPEEDS[+self.el.speed.value];
      var add = Math.floor(self.carry); self.carry -= add;
      if (add) self.setK(self.k + add);
      if (self.k >= self.job.moves.length) { self.pause(); return; }
      requestAnimationFrame(f);
    });
  };
  Viewer.prototype.pause = function () {
    this.playing = false;
    if (this.playBtn) { this.playBtn.textContent = "Play"; this.playBtn.setAttribute("aria-pressed", "false"); }
  };

  /* ---------- draw ---------- */
  Viewer.prototype.resize = function () {
    var cv = this.el.canvas, w = cv.clientWidth || 800, h = cv.clientHeight || 500, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); this.draw();
  };
  Viewer.prototype.draw = function () {
    var gl = this.gl, sim = this.sim;
    if (!gl || !sim || this.drawPending) return;
    var self = this; this.drawPending = true;
    requestAnimationFrame(function () { self.drawPending = false; self.render(); });
  };
  Viewer.prototype.render = function () {
    var gl = this.gl, sim = this.sim, cv = this.el.canvas;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.86, 0.89, 0.92, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (this.texDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.nx, sim.ny, gl.RED, gl.FLOAT, sim.H); this.texDirty = false;
    }
    var b = this.bounds(), eye = this.eye();
    var P = persp(0.75, cv.width / Math.max(1, cv.height), Math.max(0.05, this.cam.dist / 200), this.cam.dist * 20 + b.r * 10);
    var M = mul(P, lookAt(eye, [this.cam.tx, this.cam.ty, this.cam.tz], [0, 0, 1]));
    // stock
    var s = this.pS; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uM, false, M); gl.uniform2i(s.u.uN, sim.nx, sim.ny); gl.uniform2f(s.u.uO, sim.x0, sim.y0);
    gl.uniform1f(s.u.uRes, sim.res); gl.uniform1f(s.u.uBot, sim.bottom); gl.uniform1f(s.u.uTop, sim.top);
    gl.uniform3f(s.u.uEye, eye[0], eye[1], eye[2]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(s.u.uH, 0);
    gl.bindVertexArray(this.vaoS); gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_INT, 0);
    // toolpath
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.showPath) {
      var l = this.pL; gl.useProgram(l.p); gl.uniformMatrix4fv(l.u.uM, false, M); gl.bindVertexArray(this.vaoL);
      var from = Math.max(0, this.k - 2500);
      if (this.showFuture) { gl.uniform1f(l.u.uA, 0.18); gl.drawArrays(gl.LINES, 0, this.job.moves.length * 2); }
      gl.uniform1f(l.u.uA, 0.9); gl.drawArrays(gl.LINES, from * 2, (this.k - from) * 2);
    }
    // tool
    var mv = this.job.moves[Math.max(0, this.k - 1)];
    if (mv && this.k > 0) {
      var tv = this.toolVao(mv.t), t = this.pT; gl.useProgram(t.p); gl.uniformMatrix4fv(t.u.uM, false, M);
      gl.uniform3f(t.u.uT, mv.b[0], mv.b[1], mv.b[2]);
      gl.uniform3f(t.u.uC, mv.g === 0 ? 0.95 : 0.93, mv.g === 0 ? 0.35 : 0.68, mv.g === 0 ? 0.28 : 0.20);
      gl.bindVertexArray(tv.vao); gl.drawArrays(gl.TRIANGLES, 0, tv.count);
    }
    gl.disable(gl.BLEND); gl.bindVertexArray(null);
  };

  /* ---------- mount ---------- */
  function mount(node, o) {
    o = o || {};
    var v = new Viewer(node, o);
    v.reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!v.gl) return v;
    // pause while off screen (saves battery), carry on when it comes back
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          v.visible = e.isIntersecting;
          if (!e.isIntersecting && v.playing) { v.pause(); v.resumeLater = true; }
          else if (e.isIntersecting && v.resumeLater) { v.resumeLater = false; v.play(); }
        });
      }).observe(node);
    }
    var name = o.name || node.getAttribute("data-name") || "G-code";
    var start = function () {
      if (v.reduce || o.autoplay === false) return;
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting && v.k === 0) { v.play(); io.disconnect(); } }); }, { threshold: 0.4 });
        io.observe(node);
      } else v.play();
    };
    if (o.text != null) { if (v.load(o.text, name)) start(); }
    else if (node.getAttribute("data-src")) {
      fetch(node.getAttribute("data-src")).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (t) { if (v.load(t, name)) start(); })
        .catch(function () { v.fail("The demo program could not be loaded. You can still open your own G-code file."); });
    }
    return v;
  }
  window.PFViewer = { mount: mount, parse: parse };
  // start each viewer only when it comes near the screen (keeps page load light)
  function auto() {
    document.querySelectorAll(".pfv[data-src]").forEach(function (n) {
      if (n._pfv) return; n._pfv = true;
      if (!("IntersectionObserver" in window)) { mount(n); return; }
      var io = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); mount(n); }
      }, { rootMargin: "300px 0px" });
      io.observe(n);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();
})();
