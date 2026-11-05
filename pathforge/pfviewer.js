// pfviewer.js - PathForge 3D G-code viewer (WebGL2, no libraries).
//
// Reads G-code the way a machine does and cuts a virtual block in 3D:
//   moves      G0 G1 G2 G3 (XY, XZ and YZ planes: G17 G18 G19), helix
//   modes      G90 absolute / G91 incremental, G20 inch / G21 mm
//   offsets    G54-G59 work offsets (positions from G10 L2 / L20 when the file sets them)
//   cycles     G73 G81 G82 G83 G84 G85 G89 (G98 / G99 retract)
//   tools      T.. M6, spindle M3/M4/M5, dwell G4
// It also: estimates time with acceleration and corner slow-downs (same maths
// as the app's timing.py), shows tool load, draws the table and clamp zones,
// lists what to check at the machine, and checks the program for rapids
// through material, shank/holder hits, clamp hits, cutting too deep, and
// cutting with the spindle off.
//
// Use:  <div class="pfv" data-src="file.nc" data-name="title"></div>
//       or PFViewer.mount(element, {text, name, tools, report, autoplay})
// Files opened by the visitor are read by their own browser, never uploaded.
(function () {
  "use strict";

  /* ======================= machines (for time and travel) ======================= */
  var PROFILES = [
    { key: "tormach", name: "Tormach 770", re: /TORMACH/, rapid: 3429, accel: 1000, jdev: 0.01, travel: [356, 191, 337] },
    { key: "haas", name: "Haas VF-2", re: /HAAS/, rapid: 25400, accel: 4900, jdev: 0.02, travel: [762, 406, 508] },
    { key: "grbl", name: "GRBL router / hobby mill", re: /GRBL/, rapid: 3000, accel: 500, jdev: 0.01, travel: null },
    { key: "mach", name: "Mach3 / Mach4 mill", re: /MACH ?[34]/, rapid: 5000, accel: 600, jdev: 0.01, travel: null },
    { key: "generic", name: "Typical hobby mill", re: null, rapid: 3000, accel: 600, jdev: 0.01, travel: null }
  ];
  function profileFor(name) {
    for (var i = 0; i < PROFILES.length; i++) if (PROFILES[i].re && PROFILES[i].re.test(name || "")) return PROFILES[i];
    return PROFILES[PROFILES.length - 1];
  }

  /* ======================= G-code reader ======================= */
  var WORD = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;
  var SHAPES = { "FLAT END MILL": "flat", "BALL END MILL": "ball", "BULL NOSE": "bull", "DRILL": "drill" };
  var NICE = { flat: "Flat end mill", ball: "Ball nose", bull: "Bull nose", drill: "Drill" };

  function parse(text) {
    var lines = text.split(/\r?\n/), moves = [], tools = {}, ops = [], notes = {}, m;
    var info = { machine: "", xy: "", z: "", zonesRaw: [], reach: {}, check: null, gouge: null, wcsUsed: {}, wcsSet: false, fileUnits: null };
    var stock = null;
    var hasM6 = /M0*6(?![0-9])/.test(text.toUpperCase().replace(/\([^)\n]*\)/g, ""));
    var pos = [null, null, null], mode = 0, units = 1, abs = true, plane = 17, wcs = 0;
    var off = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    var tool = 1, pend = null, spin = false, feed = 0, rpm = 0, cycle = null, retInit = true, maxZ = -Infinity;
    function addOp(name, n) {
      if (ops.length && ops[ops.length - 1].move === moves.length && /^Tool /.test(ops[ops.length - 1].name) && /^Tool /.test(name)) return;
      ops.push({ name: name, move: moves.length, line: n });
    }
    function push(g, a, b, f, kind, n) {
      moves.push({ n: n, g: g, a: a, b: b, t: tool, f: f, s: rpm, sp: spin, kind: kind, dw: 0, w: wcs });
    }
    function note(k, t) { notes[k] = t; }

    for (var n = 0; n < lines.length; n++) {
      var raw = lines[n].toUpperCase(), re = /\(([^)]*)\)/g, c;
      while ((c = re.exec(raw))) {
        var t = c[1].trim();
        if ((m = /^T(\d+)\s+(FLAT END MILL|BALL END MILL|BULL NOSE|DRILL)\s+D([\d.]+)MM(?:\s+R([\d.]+))?/.exec(t))) {
          tools[+m[1]] = { shape: SHAPES[m[2]], r: +m[3] / 2, rc: m[4] ? +m[4] : 0 };
        } else if ((m = /^T(\d+) REACH FLUTE ([\d.]+) STICKOUT ([\d.]+) HOLDER D([\d.]+)MM/.exec(t))) {
          info.reach[+m[1]] = { flute: +m[2], stick: +m[3], holdR: +m[4] / 2 };
        } else if ((m = /^CLAMP ZONE X([-\d.]+)\/([-\d.]+) Y([-\d.]+)\/([-\d.]+) TOP Z([-\d.]+)/.exec(t))) {
          info.zonesRaw.push([+m[1], +m[3], +m[2], +m[4], +m[5]]);
        } else if ((m = /^STOCK\s+([\d.]+)\s*X\s*([\d.]+)\s*X\s*([\d.]+)\s*(MM|IN)/.exec(t))) {
          var sk = m[4] === "IN" ? 25.4 : 1;
          stock = { x: +m[1] * sk, y: +m[2] * sk, z: +m[3] * sk };
        } else if ((m = /^MACHINE\s+(.+)/.exec(t))) { info.machine = m[1];
        } else if ((m = /^X0 Y0 = (.+)/.exec(t))) { info.xy = m[1];
        } else if ((m = /^Z0 = (.+)/.exec(t))) { info.z = m[1];
        } else if ((m = /^SAFETY CHECK (PASSED|FAILED)/.exec(t))) { info.check = m[1] === "PASSED";
        } else if ((m = /^MAX GOUGE ([\d.]+)MM/.exec(t))) { info.gouge = +m[1];
        } else if ((m = /^EXACT CHECK PASSED, MAX ([\d.]+)MM/.exec(t))) { info.exact = +m[1];
        } else if ((m = /^TOOL\s+(\d+)\b/.exec(t))) {
          if (!hasM6) tool = +m[1];
          addOp("Tool " + m[1], n);
        } else if (/^(ROUGH CLEAR|REST ROUGHING|WATERLINE|PARALLEL|FLOOR FINISH|DRILL|ADAPTIVE|POCKET)/.test(t)) {
          ops.push({ name: t.split(" - ")[0].toLowerCase().replace(/(^|\s)(\w)/g, function (a, s, l) { return s + l.toUpperCase(); }), move: moves.length, line: n });
        }
      }
      var code = raw.replace(/\([^)]*\)/g, "").split(";")[0].trim();
      if (!code || code === "%") continue;
      if (/#|\bG65\b|\bM98\b|\bM99\b|\bIF\b|\bWHILE\b/.test(code)) note("macro", "Macros and sub-programs (#, G65, M98) are not run here.");
      var w = {}, gs = [], ms = [];
      WORD.lastIndex = 0;
      while ((m = WORD.exec(code))) {
        if (m[1] === "G") gs.push(parseFloat(m[2]));
        else if (m[1] === "M") ms.push(Math.round(parseFloat(m[2])));
        else w[m[1]] = parseFloat(m[2]);
      }
      if ("S" in w) rpm = w.S;
      if (ms.indexOf(3) >= 0 || ms.indexOf(4) >= 0) spin = true;
      if (ms.indexOf(5) >= 0 || ms.indexOf(30) >= 0 || ms.indexOf(2) >= 0) spin = false;
      if ("T" in w && gs.indexOf(10) < 0 && gs.indexOf(43) < 0) {
        if (ms.indexOf(6) >= 0 || !hasM6) { if (tool !== Math.round(w.T) || !ops.length) addOp("Tool " + Math.round(w.T), n); tool = Math.round(w.T); pend = null; }
        else pend = Math.round(w.T);
      } else if (ms.indexOf(6) >= 0 && pend != null) { if (tool !== pend) addOp("Tool " + pend, n); tool = pend; pend = null; }
      if ("A" in w || "B" in w || "C" in w) note("axis4", "Rotary axis moves (A, B, C) are not shown: the view is 3-axis only.");

      var newCycle = null, skip = false;
      for (var gi = 0; gi < gs.length; gi++) {
        var g = gs[gi];
        if (g === 0 || g === 1 || g === 2 || g === 3) { mode = g; cycle = null; }
        else if (g === 17 || g === 18 || g === 19) plane = g;
        else if (g === 20) { units = 25.4; if (info.fileUnits == null) info.fileUnits = 25.4; }
        else if (g === 21) { units = 1; if (info.fileUnits == null) info.fileUnits = 1; }
        else if (g === 90) abs = true; else if (g === 91) abs = false;
        else if (g === 80) cycle = null; else if (g === 98) retInit = true; else if (g === 99) retInit = false;
        else if (g >= 54 && g <= 59 && g === Math.round(g)) { wcs = g - 54; info.wcsUsed[wcs] = true; }
        else if (g === 54.1) { wcs = 0; info.wcsUsed[0] = true; note("g541", "Extra work offsets (G54.1 P..) are shown at the G54 position."); }
        else if ([73, 81, 82, 83, 84, 85, 86, 89].indexOf(g) >= 0) newCycle = g;
        else if (g === 41 || g === 42) note("comp", "Cutter radius compensation (G41/G42) is not applied: the path shown is the programmed line.");
        else if (g === 68 || g === 68.2 || g === 51) note("rot", "Rotation and scaling (G68, G51) are not applied.");
        else if (g === 52 || g === 92) note("g92", "Temporary offsets (G52, G92) are not applied.");
        else if (g === 93 || g === 95) note("feedmode", "Inverse-time or per-rev feed (G93/G95): the time estimate may be wrong.");
        else if (g === 53 || g === 28 || g === 30) skip = true;
        else if (g === 10) {
          var pnum = Math.round(w.P || 1) - 1, L = Math.round(w.L || 2);
          if (pnum >= 0 && pnum < 6) {
            ["X", "Y", "Z"].forEach(function (k, i) {
              if (!(k in w)) return;
              if (L === 20 && pos[i] != null) off[pnum][i] = pos[i] + off[0][i] - w[k] * units;
              else if (L === 2) off[pnum][i] = w[k] * units;
            });
            info.wcsSet = true;
          }
          skip = true;
        }
      }
      if ("F" in w) feed = w.F * units;
      if (gs.indexOf(4) >= 0) {
        var p = w.P || ("X" in w ? w.X : 0), sec = p >= 100 ? p / 1000 : p;
        if (moves.length) moves[moves.length - 1].dw += sec; else info.startDwell = (info.startDwell || 0) + sec;
        continue;
      }
      if (skip) {   // G53 / G28 / G30: the machine goes up to its home - keep the tool high
        if (("Z" in w || gs.indexOf(28) >= 0 || gs.indexOf(30) >= 0) && pos[2] != null && isFinite(maxZ)) pos[2] = Math.max(pos[2], maxZ);
        continue;
      }

      var tgt = function (k, i) {
        if (!(k in w)) return pos[i];
        var v = w[k] * units;
        if (abs) return v + off[wcs][i] - off[0][i];
        return (pos[i] == null ? 0 : pos[i]) + v;
      };
      var nx = tgt("X", 0), ny = tgt("Y", 1), nz = newCycle ? pos[2] : tgt("Z", 2);
      if (nz != null && nz > maxZ) maxZ = nz;

      if (newCycle) {
        var init = pos[2], R0 = (w.R || 0) * units, Z0 = (w.Z || 0) * units, r, zb;
        if (abs) { r = R0 + off[wcs][2] - off[0][2]; zb = Z0 + off[wcs][2] - off[0][2]; }
        else { r = (init == null ? 0 : init) + R0; zb = r + Z0; }
        cycle = { g: newCycle, r: r, z: zb, q: "Q" in w ? Math.abs(w.Q) * units : 0, p: w.P || 0, init: init };
      } else if (cycle && "Z" in w) {
        cycle.z = abs ? w.Z * units + off[wcs][2] - off[0][2] : cycle.r + w.Z * units;
      }
      if (cycle && ("X" in w || "Y" in w || newCycle)) {
        var cr = cycle.r, cz = cycle.z, top = cycle.init == null ? cr : Math.max(cycle.init, cr), cg = cycle.g;
        var kind = cg === 84 ? "tap" : (cg === 85 || cg === 86 || cg === 89) ? "bore" : "drill";
        if (pos[0] != null) push(0, [pos[0], pos[1], pos[2] == null ? top : pos[2]], [nx, ny, top], 0, "rapid", n);
        push(0, [nx, ny, top], [nx, ny, cr], 0, "rapid", n);
        if ((cg === 73 || cg === 83) && cycle.q > 0) {
          var start = cr, d = cr;
          while (d > cz + 1e-9) {
            var nd = Math.max(cz, d - cycle.q);
            push(1, [nx, ny, start], [nx, ny, nd], feed, kind, n);
            if (nd > cz + 1e-9) {
              var up = cg === 83 ? cr : nd + 0.5;
              push(0, [nx, ny, nd], [nx, ny, up], 0, "rapid", n);
              if (cg === 83) push(0, [nx, ny, up], [nx, ny, nd + 0.5], 0, "rapid", n);
              start = nd + 0.5;
            }
            d = nd;
          }
        } else push(1, [nx, ny, cr], [nx, ny, cz], feed, kind, n);
        if (cg === 82 || cg === 89) moves[moves.length - 1].dw += cycle.p >= 100 ? cycle.p / 1000 : cycle.p;
        var back = retInit ? top : cr;
        if (cg === 84 || cg === 85 || cg === 89) { push(1, [nx, ny, cz], [nx, ny, cr], feed, kind, n); if (back > cr) push(0, [nx, ny, cr], [nx, ny, back], 0, "rapid", n); }
        else push(0, [nx, ny, cz], [nx, ny, back], 0, "rapid", n);
        pos = [nx, ny, back];
        continue;
      }
      if (!("X" in w || "Y" in w || "Z" in w)) continue;
      if (pos[0] == null || pos[1] == null || pos[2] == null) { pos = [nx, ny, nz]; continue; }   // start point not known yet
      var P1 = [nx, ny, nz];
      if ((mode === 2 || mode === 3) && ("I" in w || "J" in w || "K" in w || "R" in w)) {
        var ax = plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
        var ol = plane === 17 ? ["I", "J"] : plane === 18 ? ["K", "I"] : ["J", "K"];
        var u0 = pos[ax[0]], v0 = pos[ax[1]], u1 = P1[ax[0]], v1 = P1[ax[1]], cu, cv;
        if ("R" in w) {
          var Rr = w.R * units, mu = (u0 + u1) / 2, mvv = (v0 + v1) / 2, du = u1 - u0, dv = v1 - v0, Lc = Math.hypot(du, dv) || 1e-9;
          var hh = Math.sqrt(Math.max(Rr * Rr - Lc * Lc / 4, 0)), sg = (mode === 2) === (Rr > 0) ? 1 : -1;
          cu = mu - sg * hh * dv / Lc; cv = mvv + sg * hh * du / Lc;
        } else { cu = u0 + (w[ol[0]] || 0) * units; cv = v0 + (w[ol[1]] || 0) * units; }
        var r0 = Math.hypot(u0 - cu, v0 - cv), a0 = Math.atan2(v0 - cv, u0 - cu), a1 = Math.atan2(v1 - cv, u1 - cu);
        var sw = mode === 2 ? a0 - a1 : a1 - a0;
        if (sw <= 1e-9) sw += 2 * Math.PI;
        if (mode === 2) sw = -sw;
        var k = Math.max(2, Math.ceil(Math.abs(sw) * r0 / 0.4)), prev = pos.slice();
        for (var i = 1; i <= k; i++) {
          var aa = a0 + sw * i / k, q = [0, 0, 0];
          if (i === k) q = P1.slice();
          else { q[ax[0]] = cu + r0 * Math.cos(aa); q[ax[1]] = cv + r0 * Math.sin(aa); q[ax[2]] = pos[ax[2]] + (P1[ax[2]] - pos[ax[2]]) * i / k; }
          push(1, prev, q, feed, "cut", n); prev = q;
        }
      } else push(mode === 0 ? 0 : 1, pos.slice(), P1, mode === 0 ? 0 : feed, mode === 0 ? "rapid" : "cut", n);
      pos = P1;
    }
    var zu = info.fileUnits || 1;
    info.zones = info.zonesRaw.map(function (z) { return [z[0] * zu, z[1] * zu, z[2] * zu, z[3] * zu, z[4] * zu]; });
    Object.keys(info.reach).forEach(function (k) { if (tools[k]) { var r = info.reach[k]; tools[k].flute = r.flute; tools[k].stick = r.stick; tools[k].holdR = r.holdR; } });
    if (!ops.length || ops[0].move > 0) ops.unshift({ name: "Program start", move: 0, line: 0 });
    var used = Object.keys(info.wcsUsed).map(Number);
    if (used.some(function (x) { return x > 0; }) && !info.wcsSet)
      note("wcs", "This file uses " + used.map(function (x) { return "G" + (54 + x); }).join(", ") + ". Where those offsets are is set on your machine, not in the file, so they are drawn at the same place as G54.");
    return { lines: lines, moves: moves, tools: tools, ops: ops, stock: stock, inch: zu !== 1, info: info, notes: notes };
  }

  /* ======================= time with acceleration ======================= */
  // Same planner as timing.py: speed limits at corners (junction deviation),
  // can-we-stop-in-time backward pass, can-we-get-up-to-speed forward pass.
  function planTimes(moves, prof, startDwell) {
    var A = prof.accel, rapid = prof.rapid / 60, jd = prof.jdev, n = moves.length, dur = new Float64Array(n);
    var i = 0;
    while (i < n) {
      var idx = [];
      while (i < n) {
        var mv = moves[i], L = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1], mv.b[2] - mv.a[2]);
        if (L > 1e-9) idx.push(i);
        i++;
        if (mv.dw > 0) break;
      }
      var cnt = idx.length;
      if (cnt) {
        var Ls = new Float64Array(cnt), U = [], V = new Float64Array(cnt), vj = new Float64Array(cnt + 1);
        for (var s = 0; s < cnt; s++) {
          var q = moves[idx[s]], d = [q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]], l = Math.hypot(d[0], d[1], d[2]);
          Ls[s] = l; U.push([d[0] / l, d[1] / l, d[2] / l]);
          V[s] = q.g === 0 ? rapid : Math.max(q.f, 1) / 60;
        }
        for (s = 1; s < cnt; s++) {
          var c = -(U[s - 1][0] * U[s][0] + U[s - 1][1] * U[s][1] + U[s - 1][2] * U[s][2]), v;
          if (c > 0.999999) v = 0; else if (c < -0.999999) v = 1e9;
          else { var sh = Math.sqrt(Math.max(0.5 * (1 - c), 0)); v = Math.sqrt(A * jd * sh / Math.max(1 - sh, 1e-9)); }
          vj[s] = Math.min(v, V[s - 1], V[s]);
        }
        vj[0] = 0; vj[cnt] = 0;
        for (s = cnt - 1; s >= 0; s--) vj[s] = Math.min(vj[s], Math.sqrt(vj[s + 1] * vj[s + 1] + 2 * A * Ls[s]));
        for (s = 0; s < cnt; s++) vj[s + 1] = Math.min(vj[s + 1], Math.sqrt(vj[s] * vj[s] + 2 * A * Ls[s]));
        for (s = 0; s < cnt; s++) {
          var v0 = vj[s], v1 = vj[s + 1], vm = V[s], ll = Ls[s], da = (vm * vm - v0 * v0) / (2 * A), dd = (vm * vm - v1 * v1) / (2 * A), t;
          if (da + dd <= ll) t = (vm - v0) / A + (vm - v1) / A + (ll - da - dd) / vm;
          else { var vp = Math.sqrt(Math.max((2 * A * ll + v0 * v0 + v1 * v1) / 2, 0)); t = Math.max(vp - v0, 0) / A + Math.max(vp - v1, 0) / A; }
          dur[idx[s]] = t;
        }
      }
    }
    var cum = new Float64Array(n), tot = startDwell || 0, simple = tot;
    for (var k = 0; k < n; k++) {
      var mk = moves[k], LL = Math.hypot(mk.b[0] - mk.a[0], mk.b[1] - mk.a[1], mk.b[2] - mk.a[2]);
      tot += dur[k] + mk.dw; cum[k] = tot;
      simple += (mk.g === 0 ? LL / rapid : LL / (Math.max(mk.f, 1) / 60)) + mk.dw;
    }
    return { cum: cum, total: tot, simple: simple };
  }

  /* ======================= stock and material removal ======================= */
  function frameOf(job) {
    var bx = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity }, rmax = 1.6;
    Object.keys(job.tools).forEach(function (k) { rmax = Math.max(rmax, job.tools[k].r); });
    job.moves.forEach(function (mv) {
      if (mv.g !== 1) return;
      bx.x0 = Math.min(bx.x0, mv.a[0], mv.b[0]); bx.x1 = Math.max(bx.x1, mv.a[0], mv.b[0]);
      bx.y0 = Math.min(bx.y0, mv.a[1], mv.b[1]); bx.y1 = Math.max(bx.y1, mv.a[1], mv.b[1]);
      bx.z0 = Math.min(bx.z0, mv.b[2], mv.a[2]);
    });
    if (!isFinite(bx.x0)) throw new Error("No cutting moves found in this file.");
    var st = job.stock, xy = job.info.xy, zz = job.info.z, f = { known: !!st };
    if (st) {
      if (/CENTRE|CENTER/.test(xy)) { f.x0 = -st.x / 2; f.y0 = -st.y / 2; }
      else if (/FRONT-LEFT|FRONT LEFT|LEFT CORNER/.test(xy)) { f.x0 = 0; f.y0 = 0; }
      else { f.x0 = (bx.x0 + bx.x1) / 2 - st.x / 2; f.y0 = (bx.y0 + bx.y1) / 2 - st.y / 2; f.guessXY = true; }
      f.x1 = f.x0 + st.x; f.y1 = f.y0 + st.y;
      if (/BOTTOM/.test(zz)) { f.bottom = 0; f.top = st.z; } else { f.top = 0; f.bottom = -st.z; }
    } else {
      f.x0 = bx.x0 - rmax; f.y0 = bx.y0 - rmax; f.x1 = bx.x1 + rmax; f.y1 = bx.y1 + rmax;
      f.top = 0; f.bottom = Math.min(bx.z0, -0.5) - 0.5;
    }
    return f;
  }

  function Sim(job, fr) {
    this.fr = fr; this.x0 = fr.x0; this.y0 = fr.y0;
    var span = Math.max(fr.x1 - fr.x0, fr.y1 - fr.y0);
    this.res = Math.max(0.1, span / 420);
    this.nx = Math.max(8, Math.ceil((fr.x1 - fr.x0) / this.res));
    this.ny = Math.max(8, Math.ceil((fr.y1 - fr.y0) / this.res));
    this.top = fr.top; this.bottom = fr.bottom;
    this.H = new Float32Array(this.nx * this.ny);
    this.kb = Math.max(1, Math.round(1.0 / this.res));
    this.cnx = Math.ceil(this.nx / this.kb); this.cny = Math.ceil(this.ny / this.kb);
    this.C = null;
    this.moves = job.moves; this.tools = job.tools; this.feet = {}; this.snaps = [];
    this.reset();
  }
  Sim.prototype.reset = function () { this.H.fill(this.top); if (this.C) this.C.fill(this.top); this.done = 0; };
  Sim.prototype.tool = function (t) { return this.tools[t] || { shape: "flat", r: 1.5875, rc: 0 }; };
  Sim.prototype.foot = function (t) {
    if (this.feet[t]) return this.feet[t];
    var tl = this.tool(t), res = this.res, n = Math.ceil(tl.r / res), di = [], dj = [], pr = [];
    for (var j = -n; j <= n; j++) for (var i = -n; i <= n; i++) {
      var d = Math.hypot(i * res, j * res);
      if (d > tl.r) continue;
      var p = 0;
      if (tl.shape === "ball") p = tl.r - Math.sqrt(Math.max(tl.r * tl.r - d * d, 0));
      else if (tl.shape === "bull") { var e = Math.max(d - (tl.r - tl.rc), 0); p = tl.rc - Math.sqrt(Math.max(tl.rc * tl.rc - e * e, 0)); }
      else if (tl.shape === "drill") p = d * 0.6;
      di.push(i); dj.push(j); pr.push(p);
    }
    return (this.feet[t] = { i: Int32Array.from(di), j: Int32Array.from(dj), p: Float32Array.from(pr), n: n });
  };
  Sim.prototype.cell = function (x, y) { return [Math.round((x - this.x0) / this.res - 0.5), Math.round((y - this.y0) / this.res - 0.5)]; };
  // apply one move; returns the volume removed (mm^3)
  Sim.prototype.step = function (m) {
    var mv = this.moves[m], vol = 0;
    if (mv.g === 1) {
      var f = this.foot(mv.t), a = mv.a, b = mv.b, H = this.H, nx = this.nx, ny = this.ny, res = this.res, bot = this.bottom;
      var L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / (0.7 * res)));
      var i0 = 1e9, i1 = -1e9, j0 = 1e9, j1 = -1e9;
      for (var s = 0; s <= steps; s++) {
        var u = s / steps, z = a[2] + (b[2] - a[2]) * u;
        if (z >= this.top) continue;
        var ci = Math.round((a[0] + (b[0] - a[0]) * u - this.x0) / res - 0.5), cj = Math.round((a[1] + (b[1] - a[1]) * u - this.y0) / res - 0.5);
        if (ci < i0) i0 = ci; if (ci > i1) i1 = ci; if (cj < j0) j0 = cj; if (cj > j1) j1 = cj;
        for (var q = 0; q < f.i.length; q++) {
          var ii = ci + f.i[q], jj = cj + f.j[q];
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          var idx = jj * nx + ii, zz = Math.max(z + f.p[q], bot);
          if (zz < H[idx]) { vol += H[idx] - zz; H[idx] = zz; }
        }
      }
      if (this.C && i1 >= i0) this.updC(i0 - f.n, i1 + f.n, j0 - f.n, j1 + f.n);
      vol *= res * res;
    }
    if ((m + 1) % 1200 === 0) {
      var have = false;
      for (var t = 0; t < this.snaps.length; t++) if (this.snaps[t].k === m + 1) have = true;
      if (!have) this.snaps.push({ k: m + 1, H: new Float32Array(this.H) });
    }
    return vol;
  };
  Sim.prototype.run = function (k) {
    k = Math.min(k, this.moves.length);
    if (k < this.done) {
      var best = null;
      for (var s = 0; s < this.snaps.length; s++) if (this.snaps[s].k <= k && (!best || this.snaps[s].k > best.k)) best = this.snaps[s];
      if (best) { this.H.set(best.H); this.done = best.k; } else this.reset();
    }
    for (var m = this.done; m < k; m++) this.step(m);
    this.done = k;
  };
  // coarse 1 mm "highest material" grid, used to check the holder
  Sim.prototype.updC = function (i0, i1, j0, j1) {
    var kb = this.kb, H = this.H, nx = this.nx, ny = this.ny, C = this.C;
    var b0 = Math.max(0, Math.floor(i0 / kb)), b1 = Math.min(this.cnx - 1, Math.floor(i1 / kb));
    var c0 = Math.max(0, Math.floor(j0 / kb)), c1 = Math.min(this.cny - 1, Math.floor(j1 / kb));
    for (var bj = c0; bj <= c1; bj++) for (var bi = b0; bi <= b1; bi++) {
      var mx = -1e9;
      for (var j = bj * kb; j < Math.min(ny, bj * kb + kb); j++) for (var i = bi * kb; i < Math.min(nx, bi * kb + kb); i++) { var h = H[j * nx + i]; if (h > mx) mx = h; }
      C[bj * this.cnx + bi] = mx;
    }
  };
  // highest material inside a circle (exact grid) - for the shank
  Sim.prototype.maxIn = function (x, y, t) {
    var f = this.foot(t), c = this.cell(x, y), H = this.H, mx = -1e9;
    for (var q = 0; q < f.i.length; q++) {
      var ii = c[0] + f.i[q], jj = c[1] + f.j[q];
      if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
      var h = H[jj * this.nx + ii]; if (h > mx) mx = h;
    }
    return mx;
  };
  // highest material inside a big circle (coarse grid) - for the holder
  Sim.prototype.maxInBig = function (x, y, R) {
    var kb = this.kb * this.res, C = this.C, bi = (x - this.x0) / kb, bj = (y - this.y0) / kb, rb = R / kb + 1, mx = -1e9;
    for (var j = Math.max(0, Math.floor(bj - rb)); j <= Math.min(this.cny - 1, Math.floor(bj + rb)); j++)
      for (var i = Math.max(0, Math.floor(bi - rb)); i <= Math.min(this.cnx - 1, Math.floor(bi + rb)); i++) {
        var dx = Math.max(0, Math.abs(i + 0.5 - bi) - 0.5), dy = Math.max(0, Math.abs(j + 0.5 - bj) - 0.5);
        if (Math.hypot(dx, dy) * kb > R) continue;
        if (C[j * this.cnx + i] > mx) mx = C[j * this.cnx + i];
      }
    return mx;
  };
  // how far the tool tip would be below the material, along a move (for rapids)
  Sim.prototype.buried = function (mv) {
    var f = this.foot(mv.t), a = mv.a, b = mv.b, res = this.res, H = this.H, worst = 0, at = null;
    var L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / (0.7 * res)));
    for (var s = 0; s <= steps; s++) {
      var u = s / steps, z = a[2] + (b[2] - a[2]) * u;
      if (z >= this.top) continue;
      var x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, c = this.cell(x, y);
      for (var q = 0; q < f.i.length; q++) {
        var ii = c[0] + f.i[q], jj = c[1] + f.j[q];
        if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
        var e = H[jj * this.nx + ii] - (z + f.p[q]);
        if (e > worst) { worst = e; at = [x, y, z]; }
      }
    }
    return { d: worst, at: at };
  };

  /* ======================= small maths ======================= */
  function persp(fov, asp, n, f) {
    var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
  }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
    return o;
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function distRect(x, y, z) { return Math.hypot(Math.max(z[0] - x, 0, x - z[2]), Math.max(z[1] - y, 0, y - z[3])); }

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
  var VS_BOX = "#version 300 es\nin vec3 aP;in vec3 aN;uniform mat4 uM;out vec3 vN;void main(){vN=aN;gl_Position=uM*vec4(aP,1.0);}";
  var FS_BOX = "#version 300 es\nprecision mediump float;in vec3 vN;uniform vec4 uC;out vec4 o;" +
    "void main(){float d=max(dot(normalize(vN),normalize(vec3(-0.45,-0.65,0.9))),0.0);o=vec4(uC.rgb*(0.45+0.6*d),uC.a);}";

  function prog(gl, vs, fs) {
    function sh(t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    return { p: p, u: u };
  }

  // a tool as a lathe: flutes (gold), shank (steel), holder (dark, see-through) - real sizes when known
  function toolMesh(tl) {
    var R = tl.r, pts = [], k = 0;
    var flute = tl.flute || Math.max(3 * 2 * R, 6), stick = tl.stick || flute + Math.max(10, 4 * R), hold = tl.holdR || Math.max(14, 2.2 * R);
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
  function boxGeo(list) {
    var P = [], N = [];
    var F = [[[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]],
      [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]];
    var FN = [[0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]];
    list.forEach(function (b) {
      F.forEach(function (f, fi) {
        [0, 1, 2, 0, 2, 3].forEach(function (vi) {
          var c = f[vi]; P.push(c[0] ? b[3] : b[0], c[1] ? b[4] : b[1], c[2] ? b[5] : b[2]); N.push(FN[fi][0], FN[fi][1], FN[fi][2]);
        });
      });
    });
    return { P: new Float32Array(P), N: new Float32Array(N), count: P.length / 3 };
  }

  /* ======================= the viewer ======================= */
  var SPEEDS = [1, 3, 10, 30, 90, 250];
  var RAPID_COL = [0.92, 0.27, 0.22, 0.55], DRILL_COL = [0.95, 0.75, 0.10, 1];
  var TOOLCOL = [[0.05, 0.46, 0.86, 1], [0.60, 0.20, 0.80, 1], [0.05, 0.62, 0.45, 1], [0.85, 0.42, 0.05, 1]];
  var uid = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtT(sec) {
    var s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
  }
  function loadCol(p) { return p < 35 ? [0.10, 0.62, 0.35, 1] : p < 70 ? [0.93, 0.62, 0.05, 1] : [0.86, 0.16, 0.12, 1]; }

  function Viewer(root, opts) {
    this.root = root; this.opts = opts || {}; this.id = "pfv" + (++uid);
    root.classList.add("pfv");
    root.innerHTML = "";
    var self = this, id = this.id;
    var stage = el("div", "pfv-stage"), canvas = el("canvas"), hud = el("div", "pfv-hud"), views = el("div", "pfv-views");
    var drop = el("div", "pfv-drop", "Drop a G-code file here"), msg = el("p", "pfv-msg"), origin = el("span", "pfv-origin", "X0 Y0 Z0");
    msg.hidden = true; origin.hidden = true;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "3D view of the block being cut by the G-code program");
    [canvas, origin, hud, views, drop, msg].forEach(function (x) { stage.appendChild(x); });

    var side = el("div", "pfv-side"), title = el("p", "pfv-title", "Loading..."), tabs = el("div", "pfv-tabs");
    tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Program details");
    side.appendChild(title); side.appendChild(tabs);
    this.panes = {}; this.tabBtns = {};
    [["job", "Job"], ["check", "Check"], ["setup", "Setup"], ["code", "G-code"]].forEach(function (t, i) {
      var b = el("button", "pfv-tab", t[1]); b.type = "button"; b.id = id + "-tab-" + t[0];
      b.setAttribute("role", "tab"); b.setAttribute("aria-controls", id + "-pane-" + t[0]); b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("click", function () { self.tab(t[0]); });
      b.addEventListener("keydown", function (e) {
        var keys = ["job", "check", "setup", "code"], j = keys.indexOf(t[0]);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); var nk = keys[(j + (e.key === "ArrowRight" ? 1 : 3)) % 4]; self.tab(nk); self.tabBtns[nk].focus(); }
      });
      var p = el("div", "pfv-pane"); p.id = id + "-pane-" + t[0]; p.setAttribute("role", "tabpanel"); p.setAttribute("aria-labelledby", b.id);
      p.hidden = i !== 0;
      tabs.appendChild(b); side.appendChild(p); self.panes[t[0]] = p; self.tabBtns[t[0]] = b;
    });
    var stats = el("dl", "pfv-stats"), opsBox = el("div", "pfv-ops"), list = el("pre", "pfv-list");
    list.setAttribute("aria-label", "G-code lines around the current move");
    this.panes.job.appendChild(stats); this.panes.job.appendChild(el("h3", "pfv-h", "Operations")); this.panes.job.appendChild(opsBox);
    this.panes.code.appendChild(list);

    var bar = el("div", "pfv-bar"), line = el("div", "pfv-timeline"), seek = el("input", "pfv-seek"), marks = el("div", "pfv-marks");
    seek.type = "range"; seek.min = "0"; seek.max = "1"; seek.value = "0"; seek.setAttribute("aria-label", "Position in the program");
    line.appendChild(marks); line.appendChild(seek);
    var ctr = el("div", "pfv-ctr");
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
    this.el = { canvas: canvas, hud: hud, views: views, title: title, stats: stats, ops: opsBox, list: list, seek: seek, marks: marks,
      speed: sp, msg: msg, drop: drop, stage: stage, origin: origin };

    function toggle(label, key, on, after) {
      var b = el("button", on ? "on" : "", label); b.type = "button"; b.setAttribute("aria-pressed", String(on)); self[key] = on;
      b.addEventListener("click", function () { self[key] = !self[key]; b.classList.toggle("on", self[key]); b.setAttribute("aria-pressed", String(self[key])); if (after) after(); self.draw(); });
      views.appendChild(b); return b;
    }
    [["Iso", [-0.65, -0.95, 0.75]], ["Top", [0, -0.0001, 1]], ["Front", [0, -1, 0.18]], ["Side", [1, 0, 0.18]]].forEach(function (v) {
      var b = el("button", "", v[0]); b.type = "button"; b.addEventListener("click", function () { self.viewDir(v[1]); }); views.appendChild(b);
    });
    var fit = el("button", "", "Fit"); fit.type = "button"; fit.addEventListener("click", function () { self.fit(); }); views.appendChild(fit);
    toggle("Path", "showPath", true);
    toggle("Whole path", "showFuture", false);
    toggle("Load colours", "loadMode", false, function () { self.legend(); });
    this.el.legendBox = el("div", "pfv-legend"); this.el.legendBox.hidden = true; stage.appendChild(this.el.legendBox);

    var gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) { this.fail("Your browser can't show 3D (WebGL 2). Try Chrome, Edge or Firefox."); return; }
    this.gl = gl;
    try {
      this.pS = prog(gl, VS_STOCK, FS_STOCK); this.pL = prog(gl, VS_LINE, FS_LINE); this.pT = prog(gl, VS_TOOL, FS_TOOL); this.pB = prog(gl, VS_BOX, FS_BOX);
    } catch (e) { this.fail("3D setup failed: " + e.message); return; }
    this.cam = { yaw: -0.6, pitch: 0.62, dist: 200, tx: 0, ty: 0, tz: 0 };
    this.k = 0; this.playing = false;
    this.bindInput(); this.bindFile(file);
    window.addEventListener("resize", function () { self.resize(); });
    this.resize();
  }

  Viewer.prototype.fail = function (text) { this.el.msg.textContent = text; this.el.msg.hidden = false; };
  Viewer.prototype.tab = function (key) {
    var self = this;
    Object.keys(this.panes).forEach(function (k) {
      var on = k === key; self.panes[k].hidden = !on;
      self.tabBtns[k].setAttribute("aria-selected", String(on)); self.tabBtns[k].tabIndex = on ? 0 : -1; self.tabBtns[k].classList.toggle("on", on);
    });
    if (key === "code") this.readout();
  };
  Viewer.prototype.legend = function () {
    var b = this.el.legendBox; b.innerHTML = ""; b.hidden = !this.loadMode;
    [["pfv-l1", "Light"], ["pfv-l2", "Medium"], ["pfv-l3", "Heavy"]].forEach(function (x) { var s = el("span", null, x[1]); var i = el("i", x[0]); s.insertBefore(i, s.firstChild); b.appendChild(s); });
  };

  Viewer.prototype.vao = function (prog, attrs) {
    var gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    attrs.forEach(function (a) {
      var b = a.buf || gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); if (!a.buf) gl.bufferData(gl.ARRAY_BUFFER, a.data, gl.STATIC_DRAW);
      var l = gl.getAttribLocation(prog.p, a.name); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, a.size, gl.FLOAT, false, 0, 0);
      a.buf = b;
    });
    gl.bindVertexArray(null); return vao;
  };

  Viewer.prototype.load = function (text, name) {
    this.pause();
    var job;
    try {
      job = parse(text);
      var extra = this.opts.tools || {};
      Object.keys(extra).forEach(function (k) {
        if (!job.tools[k]) job.tools[k] = extra[k];
        else ["flute", "stick", "holdR"].forEach(function (q) { if (extra[k][q] && !job.tools[k][q]) job.tools[k][q] = extra[k][q]; });
      });
      if (!job.moves.length) throw new Error("No tool moves found in this file.");
      this.frame = frameOf(job);
      this.sim = new Sim(job, this.frame);
    } catch (e) { this.fail("Could not open " + name + ": " + e.message); return false; }
    this.el.msg.hidden = true;
    this.job = job; this.name = name;
    this.prof = this.opts.machine ? profileFor(this.opts.machine) : profileFor(job.info.machine);
    this.times = planTimes(job.moves, this.prof, job.info.startDwell);
    this.precheck();
    var gl = this.gl, sim = this.sim;
    // stock surface grid (with a one-cell skirt so the block has sides)
    var NX = sim.nx + 2, NY = sim.ny + 2, cells = new Float32Array(NX * NY * 2), p = 0;
    for (var j = -1; j <= sim.ny; j++) for (var i = -1; i <= sim.nx; i++) { cells[p++] = i; cells[p++] = j; }
    var idx = new Uint32Array((NX - 1) * (NY - 1) * 6); p = 0;
    for (var y = 0; y < NY - 1; y++) for (var x = 0; x < NX - 1; x++) {
      var a = y * NX + x; idx[p++] = a; idx[p++] = a + 1; idx[p++] = a + NX; idx[p++] = a + 1; idx[p++] = a + NX + 1; idx[p++] = a + NX;
    }
    this.vaoS = this.vao(this.pS, [{ name: "aC", data: cells, size: 2 }]);
    gl.bindVertexArray(this.vaoS);
    var b2 = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b2); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.nIdx = idx.length;
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim.nx, sim.ny, 0, gl.RED, gl.FLOAT, sim.H);
    // toolpath lines: colour by tool, and by load
    var tnums = Object.keys(job.tools).map(Number).sort(function (a, b) { return a - b; });
    var N = job.moves.length, LP = new Float32Array(N * 6), LK = new Float32Array(N * 8), LL = new Float32Array(N * 8), self = this;
    job.moves.forEach(function (mv, i) {
      LP.set([mv.a[0], mv.a[1], mv.a[2], mv.b[0], mv.b[1], mv.b[2]], i * 6);
      var tl = job.tools[mv.t], ti = Math.max(0, tnums.indexOf(mv.t));
      var c = mv.g === 0 ? RAPID_COL : (mv.kind !== "cut" || (tl && tl.shape === "drill")) ? DRILL_COL : TOOLCOL[ti % TOOLCOL.length];
      LK.set(c, i * 8); LK.set(c, i * 8 + 4);
      var cl = mv.g === 0 ? [0.55, 0.6, 0.65, 0.35] : mv.kind !== "cut" ? DRILL_COL : (self.vol[i] > 1e-6 ? loadCol(self.loadPct[i]) : [0.55, 0.62, 0.70, 0.5]);
      LL.set(cl, i * 8); LL.set(cl, i * 8 + 4);
    });
    var posAttr = { name: "aP", data: LP, size: 3 };
    this.vaoL = this.vao(this.pL, [posAttr, { name: "aK", data: LK, size: 4 }]);
    this.vaoLL = this.vao(this.pL, [{ name: "aP", buf: posAttr.buf, size: 3 }, { name: "aK", data: LL, size: 4 }]);
    // table, clamp zones, problem markers, zero triad
    var fr = this.frame, span = Math.max(fr.x1 - fr.x0, fr.y1 - fr.y0), mg = span * 0.18;
    this.span = span;
    var tb = boxGeo([[fr.x0 - mg, fr.y0 - mg, fr.bottom - Math.max(3, span * 0.04), fr.x1 + mg, fr.y1 + mg, fr.bottom - 0.02]]);
    this.table = { vao: this.vao(this.pB, [{ name: "aP", data: tb.P, size: 3 }, { name: "aN", data: tb.N, size: 3 }]), count: tb.count };
    this.clamps = null;
    if (job.info.zones.length) {
      var cg = boxGeo(job.info.zones.map(function (z) { return [z[0], z[1], fr.bottom, z[2], z[3], z[4]]; }));
      this.clamps = { vao: this.vao(this.pB, [{ name: "aP", data: cg.P, size: 3 }, { name: "aN", data: cg.N, size: 3 }]), count: cg.count };
    }
    var ms = Math.max(0.6, span / 70), mk = this.problems.filter(function (q) { return q.at; }).map(function (q) { var a = q.at; return [a[0] - ms, a[1] - ms, a[2] - ms, a[0] + ms, a[1] + ms, a[2] + ms]; });
    this.markers = null;
    if (mk.length) { var mg2 = boxGeo(mk); this.markers = { vao: this.vao(this.pB, [{ name: "aP", data: mg2.P, size: 3 }, { name: "aN", data: mg2.N, size: 3 }]), count: mg2.count }; }
    var tl3 = span * 0.14;
    this.triad = this.vao(this.pL, [{ name: "aP", data: new Float32Array([0, 0, 0, tl3, 0, 0, 0, 0, 0, 0, tl3, 0, 0, 0, 0, 0, 0, tl3]), size: 3 },
      { name: "aK", data: new Float32Array([0.85, 0.15, 0.1, 1, 0.85, 0.15, 0.1, 1, 0.1, 0.6, 0.2, 1, 0.1, 0.6, 0.2, 1, 0.1, 0.35, 0.9, 1, 0.1, 0.35, 0.9, 1]), size: 4 }]);
    this.toolVaos = {};
    this.texDirty = true;
    this.buildSide();
    this.lastOp = -1; this.k = 0;
    this.fit(); this.setK(0);
    return true;
  };

  // run the whole program once: tool load, and the viewer's own safety check
  Viewer.prototype.precheck = function () {
    var job = this.job, sim = this.sim, fr = this.frame, N = job.moves.length, zones = job.info.zones;
    this.vol = new Float32Array(N); this.loadPct = new Float32Array(N);
    var probs = [], hasSpin = job.moves.some(function (m) { return m.sp; }), anyHolder = false;
    Object.keys(job.tools).forEach(function (k) { if (job.tools[k].stick && job.tools[k].holdR) anyHolder = true; });
    if (anyHolder) { sim.C = new Float32Array(sim.cnx * sim.cny); }
    sim.reset();
    function add(type, sev, k, val, at, text) {
      var last = probs.length ? probs[probs.length - 1] : null;
      if (last && last.type === type && k - last.end < 60) { last.end = k; last.count++; if (val > last.val) { last.val = val; last.at = at || last.at; } return; }
      if (probs.length < 300) probs.push({ type: type, sev: sev, k: k, end: k, count: 1, val: val, at: at, text: text });
    }
    for (var m = 0; m < N; m++) {
      var mv = job.moves[m], tl = sim.tool(mv.t), zlo = Math.min(mv.a[2], mv.b[2]);
      if (zlo < sim.top) {
        if (mv.g === 0) {
          var bu = sim.buried(mv);
          if (bu.d > 0.05) add("rapid", "error", m, bu.d, bu.at, "Rapid (G0) move through uncut material");
        } else {
          if (tl.flute && tl.shape !== "drill") {
            var o1 = Math.max(sim.maxIn(mv.a[0], mv.a[1], mv.t) - mv.a[2], sim.maxIn(mv.b[0], mv.b[1], mv.t) - mv.b[2]) - tl.flute;
            if (o1 > 0.05) add("shank", "error", m, o1, mv.b, "Shank rubs: material is higher than the flutes");
          }
          if (!mv.f) add("feed", "error", m, 0, mv.b, "Cutting move with no feed rate (F)");
        }
        if (sim.C && tl.stick && tl.holdR && zlo + tl.stick < sim.top) {
          var L = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1]), ns = Math.max(1, Math.ceil(L / Math.max(1, tl.holdR / 2))), worst = 0, wat = null;
          for (var s = 0; s <= ns; s++) {
            var u = s / ns, x = mv.a[0] + (mv.b[0] - mv.a[0]) * u, y = mv.a[1] + (mv.b[1] - mv.a[1]) * u, z = mv.a[2] + (mv.b[2] - mv.a[2]) * u;
            var o2 = sim.maxInBig(x, y, tl.holdR) - (z + tl.stick);
            if (o2 > worst) { worst = o2; wat = [x, y, z + tl.stick]; }
          }
          if (worst > 0.05) add("holder", "error", m, worst, wat, "Holder or collet nut hits the material");
        }
        if (fr.known && zlo < fr.bottom - 0.01) add("deep", "error", m, fr.bottom - zlo, mv.b, "Goes below the bottom of the stock (into the vise or table)");
      }
      for (var zi = 0; zi < zones.length; zi++) {
        var zn = zones[zi], L2 = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1]), n2 = Math.max(1, Math.ceil(L2 / 1.0));
        for (var s2 = 0; s2 <= n2; s2++) {
          var u2 = s2 / n2, px = mv.a[0] + (mv.b[0] - mv.a[0]) * u2, py = mv.a[1] + (mv.b[1] - mv.a[1]) * u2, pz = mv.a[2] + (mv.b[2] - mv.a[2]) * u2;
          var dr = distRect(px, py, zn), hitTool = pz < zn[4] && dr < tl.r, hitHold = tl.stick && tl.holdR && pz + tl.stick < zn[4] && dr < tl.holdR;
          if (hitTool || hitHold) { add("clamp", "error", m, zn[4] - pz, [px, py, pz], hitTool ? "Tool goes into a clamp zone" : "Holder hits a clamp zone"); break; }
        }
      }
      var v = sim.step(m);
      this.vol[m] = v;
      if (mv.g === 1 && v > 0) {
        var L3 = Math.hypot(mv.b[0] - mv.a[0], mv.b[1] - mv.a[1], mv.b[2] - mv.a[2]) || 1e-9, D = 2 * tl.r;
        var pct = (v / L3) / (D * D) * 100;
        this.loadPct[m] = pct;
        if (mv.kind === "cut" && tl.shape !== "drill" && pct > 110 && L3 > 0.2) add("load", "warn", m, pct, mv.b, "Very heavy cut (more than a full-width slot 1×D deep)");
        if (hasSpin && !mv.sp) add("spindle", "error", m, 0, mv.b, "Cutting with the spindle off");
      }
    }
    sim.C = null;
    probs.sort(function (a, b) { return (a.sev === b.sev ? 0 : a.sev === "error" ? -1 : 1) || a.k - b.k; });
    this.problems = probs;
    this.travel = null;
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    job.moves.forEach(function (q) { for (var i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q.a[i], q.b[i]); hi[i] = Math.max(hi[i], q.a[i], q.b[i]); } });
    this.range = { lo: lo, hi: hi };
  };

  Viewer.prototype.toolVao = function (tn) {
    if (this.toolVaos[tn]) return this.toolVaos[tn];
    var m = toolMesh(this.sim.tool(tn));
    return (this.toolVaos[tn] = { vao: this.vao(this.pT, [{ name: "aP", data: m.P, size: 3 }, { name: "aN", data: m.N, size: 3 }, { name: "aK", data: m.K, size: 1 }]), count: m.count });
  };

  function toolName(t, tl) { return "T" + t + (tl ? " " + NICE[tl.shape].toLowerCase() + " Ø" + (+(tl.r * 2).toFixed(3)) : ""); }

  Viewer.prototype.buildSide = function () {
    var job = this.job, self = this, e = this.el, u = job.inch ? 1 / 25.4 : 1, U = job.inch ? " in" : " mm", dec = job.inch ? 4 : 3;
    e.title.textContent = this.name;
    ops(job);
    function ops(job) {
      job.ops.forEach(function (o) { var q = /^Tool (\d+)$/.exec(o.name), tl = q && job.tools[+q[1]]; if (tl) o.name = "Tool " + q[1] + " · " + NICE[tl.shape] + " Ø" + (+(tl.r * 2).toFixed(3)); });
    }
    function rows(box, list) {
      box.innerHTML = "";
      list.forEach(function (r) { var d = el("div", r[2] || ""); d.appendChild(el("dt", null, r[0])); d.appendChild(el("dd", null, r[1])); box.appendChild(d); });
    }
    var cut = 0; job.moves.forEach(function (q) { if (q.g === 1) cut += Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]); });
    this.statRows = function () {
      var r = [["Time on this machine", fmtT(self.times.total), "wide2"], ["At full feed, no slowing", fmtT(self.times.simple)],
        ["Cutting length", (cut / 1000).toFixed(2) + " m"]];
      if (job.stock) r.push(["Stock", (+(job.stock.x * u).toFixed(3)) + " × " + (+(job.stock.y * u).toFixed(3)) + " × " + (+(job.stock.z * u).toFixed(3)) + U]);
      r.push(["Moves", job.moves.length.toLocaleString()]);
      r.push(["Tools", Object.keys(job.tools).map(function (k) { return toolName(k, job.tools[k]); }).join(", ") || "-", "wide2"]);
      rows(e.stats, r);
    };
    this.statRows();
    e.ops.innerHTML = ""; e.marks.innerHTML = "";
    var N = Math.max(1, job.moves.length);
    job.ops.forEach(function (op) {
      var b = el("button", "pfv-op", op.name); b.type = "button";
      b.addEventListener("click", function () { self.pause(); self.setK(op.move); });
      op.btn = b; e.ops.appendChild(b);
      var mk = el("span", "pfv-mark" + (/^Tool/.test(op.name) ? " tool" : "")); mk.style.left = (100 * op.move / N) + "%"; mk.title = op.name; e.marks.appendChild(mk);
    });
    this.problems.forEach(function (q) { var mk = el("span", "pfv-mark bad"); mk.style.left = (100 * q.k / N) + "%"; e.marks.appendChild(mk); });
    e.seek.max = String(job.moves.length);

    // ---- Check tab ----
    var cp = this.panes.check; cp.innerHTML = "";
    var errs = this.problems.filter(function (q) { return q.sev === "error"; }).length, warns = this.problems.length - errs;
    var badge = el("p", "pfv-badge " + (errs ? "bad" : warns ? "warn" : "ok"),
      errs ? errs + " problem" + (errs > 1 ? "s" : "") + " found" + (warns ? ", " + warns + " warning" + (warns > 1 ? "s" : "") : "")
        : warns ? "No crashes found, " + warns + " warning" + (warns > 1 ? "s" : "") : "No problems found by the viewer check");
    cp.appendChild(badge);
    this.tabBtns.check.textContent = errs ? "Check (" + errs + ")" : "Check";
    this.tabBtns.check.classList.toggle("bad", !!errs);
    var pl = el("div", "pfv-probs");
    this.problems.forEach(function (q) {
      var mv = job.moves[q.k], b = el("button", "pfv-prob " + q.sev); b.type = "button";
      var val = q.type === "load" ? Math.round(q.val) + " % load" : q.val ? (q.val * u).toFixed(dec) + U : "";
      b.appendChild(el("strong", null, q.text));
      b.appendChild(el("span", null, "Line " + (mv.n + 1) + (q.count > 1 ? " (+" + (q.count - 1) + " more moves)" : "") + (val ? " · " + val : "")));
      b.addEventListener("click", function () { self.pause(); self.setK(q.k + 1); self.flash = q; self.draw(); });
      pl.appendChild(b);
    });
    cp.appendChild(pl);
    var pf = this.opts.report || (job.info.check != null ? { ok: job.info.check, gouge: job.info.gouge, exact: job.info.exact } : null);
    if (pf && pf.exact == null && job.info.exact != null) pf.exact = job.info.exact;
    var sec = el("div", "pfv-note");
    if (pf) {
      sec.appendChild(el("strong", null, "PathForge part check: " + (pf.ok ? "PASSED" : "FAILED - do not run")));
      sec.appendChild(el("span", null, pf.ok ? "Checked against your part model" + (pf.gouge != null ? ", deepest cut into the part " + (+pf.gouge).toFixed(3) + " mm" : "") +
        (pf.exact != null ? ". Exact check (real tool against the real part, no grid): " + (+pf.exact).toFixed(4) + " mm." : ".")
        : "Open the job in PathForge CAM and fix every error first."));
      if (pf.errors && pf.errors.length) { var ul = el("ul"); pf.errors.slice(0, 12).forEach(function (t) { ul.appendChild(el("li", null, t)); }); sec.appendChild(ul); }
      sec.classList.add(pf.ok ? "ok" : "bad");
    } else {
      sec.appendChild(el("strong", null, "No part check in this file"));
      sec.appendChild(el("span", null, "This viewer cannot see your part model, so it cannot find gouges (cuts into the part). PathForge CAM checks that before you save."));
    }
    cp.appendChild(sec);
    var what = el("div", "pfv-note");
    what.appendChild(el("strong", null, "What the viewer checks"));
    what.appendChild(el("span", null, "Rapids through material, shank and holder hits" + (Object.keys(job.tools).some(function (k) { return job.tools[k].stick; }) ? "" : " (needs tool reach in the file)") +
      ", clamp zones, cutting below the stock, cutting with the spindle off, missing feed, very heavy cuts. Not checked: tool bending, chatter, your vise if no clamp zones are set."));
    cp.appendChild(what);
    var nk = Object.keys(job.notes);
    if (nk.length) {
      var nn = el("div", "pfv-note warn"); nn.appendChild(el("strong", null, "Not shown in this view"));
      var ul2 = el("ul"); nk.forEach(function (k) { ul2.appendChild(el("li", null, job.notes[k])); }); nn.appendChild(ul2); cp.appendChild(nn);
    }

    // ---- Setup tab ----
    var spn = this.panes.setup; spn.innerHTML = "";
    var info = job.info, fr = this.frame, R = this.range;
    var sd = el("dl", "pfv-stats");
    var zeroXY = info.xy ? info.xy.toLowerCase() : "not stated in the file", zeroZ = info.z ? info.z.toLowerCase() : "not stated in the file";
    var wl = Object.keys(info.wcsUsed).map(function (x) { return "G" + (54 + +x); }).join(", ") || "G54 (default)";
    var first = job.moves[0];
    var srow = [["X0 Y0 (your zero)", zeroXY, "wide2"], ["Z0", zeroZ, "wide2"], ["Work offset", wl],
      ["Units", job.inch ? "inch (G20)" : "mm (G21)"],
      ["X travel used", (R.lo[0] * u).toFixed(dec) + " to " + (R.hi[0] * u).toFixed(dec), "wide2"],
      ["Y travel used", (R.lo[1] * u).toFixed(dec) + " to " + (R.hi[1] * u).toFixed(dec), "wide2"],
      ["Z travel used", (R.lo[2] * u).toFixed(dec) + " to " + (R.hi[2] * u).toFixed(dec), "wide2"],
      ["First move", "X" + (first.a[0] * u).toFixed(dec) + " Y" + (first.a[1] * u).toFixed(dec) + " Z" + (first.a[2] * u).toFixed(dec), "wide2"]];
    rows(sd, srow);
    spn.appendChild(sd);
    var tv = this.prof.travel;
    if (tv) {
      var need = [R.hi[0] - R.lo[0], R.hi[1] - R.lo[1], R.hi[2] - R.lo[2]], over = [];
      ["X", "Y", "Z"].forEach(function (a, i) { if (need[i] > tv[i]) over.push(a + " needs " + Math.round(need[i]) + " mm, machine has " + tv[i]); });
      if (over.length) { var ov = el("p", "pfv-note bad"); ov.textContent = "Bigger than the " + this.prof.name + " travel: " + over.join("; ") + "."; spn.appendChild(ov); }
    }
    if (!fr.known || fr.guessXY) { var g = el("p", "pfv-note warn"); g.textContent = !fr.known ? "Stock size is not in the file: the block is drawn around the cutting area, top at Z0." : "The zero is 'same as STL file', so the block position is a best guess."; spn.appendChild(g); }
    var tl = el("div", "pfv-tools");
    Object.keys(job.tools).forEach(function (k) {
      var t = job.tools[k], d = el("p");
      d.appendChild(el("strong", null, toolName(k, t)));
      var txt = t.stick ? "Stickout " + t.stick + " mm, flutes " + t.flute + " mm, holder Ø" + (t.holdR * 2) + " mm" + (t.stick / (2 * t.r) > 4 ? " - long and thin (" + (t.stick / (2 * t.r)).toFixed(1) + "×D): it can bend and chatter, use lighter cuts." : ".")
        : "Reach not in the file (set flute length, stickout and holder in PathForge to check it).";
      d.appendChild(el("span", null, txt)); tl.appendChild(d);
    });
    spn.appendChild(el("h3", "pfv-h", "Tools")); spn.appendChild(tl);
    var ml = el("label", "pfv-mach", "Machine for the time "), msel = el("select");
    PROFILES.forEach(function (p) { var o = el("option", null, p.name); o.value = p.key; msel.appendChild(o); });
    msel.value = this.prof.key;
    msel.addEventListener("change", function () {
      self.prof = PROFILES.filter(function (p) { return p.key === msel.value; })[0];
      self.times = planTimes(job.moves, self.prof, job.info.startDwell); self.statRows(); self.readout();
    });
    ml.appendChild(msel); spn.appendChild(ml);
    spn.appendChild(el("h3", "pfv-h", "Before you press Cycle Start"));
    var ol = el("ol", "pfv-list2");
    ["Zero X and Y where the file says (" + zeroXY + ").", "Zero Z at " + zeroZ + ", with tool 1 in the spindle.",
      "Measure every tool length and check the offset numbers (H) match the tools.",
      "Check the stock is the size above and the clamps are clear of the path.",
      "Dry run first: raise Z or run in the air, at low feed, one block at a time."].forEach(function (t) { ol.appendChild(el("li", null, t)); });
    spn.appendChild(ol);
    if (this.legend) this.legend();
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
    var job = this.job, e = this.el, i0 = Math.max(0, this.k - 1), mv = job.moves[i0], tl = mv && this.sim.tool(mv.t);
    var u = job.inch ? 1 / 25.4 : 1, dec = job.inch ? 4 : 3, opi = this.opAt(this.k);
    e.hud.innerHTML = "";
    var load = null;
    if (mv && mv.g === 1 && mv.kind === "cut" && tl.shape !== "drill" && this.k > 0) {
      var tt = this.times.cum[i0] - (i0 ? this.times.cum[i0 - 1] : 0), mrr = tt > 0 ? this.vol[i0] / 1000 / (tt / 60) : 0;
      load = [Math.round(this.loadPct[i0]), mrr];
    }
    var rows = [["", job.ops[opi].name], ["Tool", mv ? toolName(mv.t, job.tools[mv.t]) : "-"],
      ["X", mv ? (mv.b[0] * u).toFixed(dec) : "-"], ["Y", mv ? (mv.b[1] * u).toFixed(dec) : "-"], ["Z", mv ? (mv.b[2] * u).toFixed(dec) : "-"],
      ["Feed", mv ? (mv.g === 0 ? "RAPID" : Math.round(mv.f * u * 10) / 10 + (job.inch ? " in/min" : " mm/min")) : "-"],
      ["Spindle", mv && mv.s ? Math.round(mv.s) + " rpm" + (mv.sp ? "" : " (off)") : "-"]];
    if (load) rows.push(["Load", load[0] + " % · " + load[1].toFixed(1) + " cm³/min"]);
    if (mv && Object.keys(job.info.wcsUsed).length > 1) rows.push(["Offset", "G" + (54 + mv.w)]);
    rows.push(["Time", fmtT(this.k ? this.times.cum[this.k - 1] : 0) + " / " + fmtT(this.times.total)]);
    rows.forEach(function (r, i) {
      var cls = i === 0 ? "pfv-hop" : r[0] === "Feed" && mv && mv.g === 0 ? "rapid" : r[0] === "Load" ? "ld" + (load[0] < 35 ? 1 : load[0] < 70 ? 2 : 3) : "";
      var d = el("div", cls);
      if (r[0]) d.appendChild(el("span", "k", r[0]));
      d.appendChild(el("span", "v", r[1])); e.hud.appendChild(d);
    });
    e.seek.value = String(this.k);
    e.seek.setAttribute("aria-valuetext", "Move " + this.k + " of " + job.moves.length + ", " + job.ops[opi].name);
    job.ops.forEach(function (op, i) { op.btn.classList.toggle("on", i === opi); });
    if (this.lastOp !== opi && !this.panes.job.hidden) {
      this.lastOp = opi;
      var ob = job.ops[opi].btn, box = e.ops;
      if (ob.offsetTop < box.scrollTop || ob.offsetTop + ob.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = ob.offsetTop - box.clientHeight / 2;
    }
    if (!this.panes.code.hidden) {
      var n = mv ? mv.n : 0, from = Math.max(0, n - 9), out = [];
      for (var i = from; i < Math.min(job.lines.length, from + 19); i++) out.push((i === n ? "▶" : " ") + String(i + 1).padStart(6, " ") + "  " + job.lines[i].slice(0, 64));
      e.list.textContent = out.join("\n");
    }
  };

  /* ---------- camera ---------- */
  Viewer.prototype.bounds = function () {
    var f = this.frame;
    return { cx: (f.x0 + f.x1) / 2, cy: (f.y0 + f.y1) / 2, cz: (f.top + f.bottom) / 2, r: Math.hypot(f.x1 - f.x0, f.y1 - f.y0, f.top - f.bottom) / 2 };
  };
  Viewer.prototype.fit = function () {
    if (!this.sim) return;
    var b = this.bounds(); this.cam.tx = b.cx; this.cam.ty = b.cy; this.cam.tz = b.cz;
    var cv = this.el.canvas, asp = (cv.clientWidth || 4) / (cv.clientHeight || 3);
    this.cam.dist = b.r * 2.6 / Math.min(1, asp / 1.5); this.draw();
  };
  Viewer.prototype.viewDir = function (d) { var v = norm(d); this.cam.pitch = Math.asin(v[2]); this.cam.yaw = Math.atan2(v[0], -v[1]); this.fit(); };
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
      } else { self.cam.yaw -= dx * 0.008; self.cam.pitch = Math.max(-0.2, Math.min(1.5707, self.cam.pitch + dy * 0.008)); }
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
      rd.onload = function () { self.opts.report = null; if (self.load(String(rd.result), f.name) && !self.reduce) self.play(); };
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
    if (!this.gl || !this.sim || this.drawPending) return;
    var self = this; this.drawPending = true;
    requestAnimationFrame(function () { self.drawPending = false; self.render(); });
  };
  Viewer.prototype.render = function () {
    var gl = this.gl, sim = this.sim, cv = this.el.canvas;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.86, 0.89, 0.92, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (this.texDirty) { gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.nx, sim.ny, gl.RED, gl.FLOAT, sim.H); this.texDirty = false; }
    var b = this.bounds(), eye = this.eye();
    var P = persp(0.75, cv.width / Math.max(1, cv.height), Math.max(0.05, this.cam.dist / 200), this.cam.dist * 20 + b.r * 10);
    var M = mul(P, lookAt(eye, [this.cam.tx, this.cam.ty, this.cam.tz], [0, 0, 1]));
    var B = this.pB; gl.useProgram(B.p); gl.uniformMatrix4fv(B.u.uM, false, M);
    gl.uniform4f(B.u.uC, 0.60, 0.65, 0.70, 1); gl.bindVertexArray(this.table.vao); gl.drawArrays(gl.TRIANGLES, 0, this.table.count);
    var s = this.pS; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uM, false, M); gl.uniform2i(s.u.uN, sim.nx, sim.ny); gl.uniform2f(s.u.uO, sim.x0, sim.y0);
    gl.uniform1f(s.u.uRes, sim.res); gl.uniform1f(s.u.uBot, sim.bottom); gl.uniform1f(s.u.uTop, sim.top);
    gl.uniform3f(s.u.uEye, eye[0], eye[1], eye[2]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(s.u.uH, 0);
    gl.bindVertexArray(this.vaoS); gl.drawElements(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_INT, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.showPath) {
      var l = this.pL; gl.useProgram(l.p); gl.uniformMatrix4fv(l.u.uM, false, M); gl.bindVertexArray(this.loadMode ? this.vaoLL : this.vaoL);
      var from = this.loadMode ? 0 : Math.max(0, this.k - 2500);
      if (this.showFuture) { gl.uniform1f(l.u.uA, 0.18); gl.drawArrays(gl.LINES, 0, this.job.moves.length * 2); }
      gl.uniform1f(l.u.uA, 0.9); gl.drawArrays(gl.LINES, from * 2, (this.k - from) * 2);
    }
    var mv = this.job.moves[Math.max(0, this.k - 1)];
    if (mv && this.k > 0) {
      var tv = this.toolVao(mv.t), t = this.pT; gl.useProgram(t.p); gl.uniformMatrix4fv(t.u.uM, false, M);
      gl.uniform3f(t.u.uT, mv.b[0], mv.b[1], mv.b[2]);
      gl.uniform3f(t.u.uC, mv.g === 0 ? 0.95 : 0.93, mv.g === 0 ? 0.35 : 0.68, mv.g === 0 ? 0.28 : 0.20);
      gl.bindVertexArray(tv.vao); gl.drawArrays(gl.TRIANGLES, 0, tv.count);
    }
    gl.useProgram(B.p);
    if (this.clamps) { gl.depthMask(false); gl.uniform4f(B.u.uC, 0.96, 0.55, 0.12, 0.55); gl.bindVertexArray(this.clamps.vao); gl.drawArrays(gl.TRIANGLES, 0, this.clamps.count); gl.depthMask(true); }
    gl.disable(gl.DEPTH_TEST);
    if (this.markers) { gl.uniform4f(B.u.uC, 0.90, 0.12, 0.10, 0.9); gl.bindVertexArray(this.markers.vao); gl.drawArrays(gl.TRIANGLES, 0, this.markers.count); }
    var L2 = this.pL; gl.useProgram(L2.p); gl.uniformMatrix4fv(L2.u.uM, false, M); gl.uniform1f(L2.u.uA, 1); gl.bindVertexArray(this.triad); gl.drawArrays(gl.LINES, 0, 6);
    gl.disable(gl.BLEND); gl.bindVertexArray(null);
    // "X0 Y0 Z0" label at the zero
    var cx = M[12], cy = M[13], cw = M[15], o = this.el.origin;
    if (cw > 0) { o.hidden = false; o.style.left = ((cx / cw * 0.5 + 0.5) * cv.clientWidth) + "px"; o.style.top = ((-cy / cw * 0.5 + 0.5) * cv.clientHeight) + "px"; }
    else o.hidden = true;
  };

  /* ---------- mount ---------- */
  function mount(node, o) {
    o = o || {};
    var v = new Viewer(node, o);
    v.reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!v.gl) return v;
    if ("IntersectionObserver" in window) {     // pause while off screen (saves battery)
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
  window.PFViewer = { mount: mount, parse: parse, planTimes: planTimes, profileFor: profileFor };
  function auto() {      // start each viewer only when it comes near the screen
    document.querySelectorAll(".pfv[data-src]").forEach(function (n) {
      if (n._pfv) return; n._pfv = true;
      if (!("IntersectionObserver" in window)) { mount(n); return; }
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); mount(n); } }, { rootMargin: "300px 0px" });
      io.observe(n);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto();
})();
