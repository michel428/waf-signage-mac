/*
 * Ambiance lumineuse calculée en continu — port JavaScript de DmxProgram.java
 * (appli Android). Valeurs fixes + mouvements des lyres + animation des
 * couleurs / de l'intensité. Aucun effet stroboscopique : tout est fondu.
 */
(function (root) {
  'use strict';
  const TAU = 2 * Math.PI;
  const FIRE = [[255, 30, 0, 0], [255, 80, 0, 0], [255, 130, 0, 0], [255, 60, 0, 0]];
  const clamp = v => Math.max(0, Math.min(255, v));
  const trunc = Math.trunc;
  const smooth = f => f * f * (3 - 2 * f);
  const mod = (a, n) => ((a % n) + n) % n;

  // Bruit doux identique à la version Java (arithmétique 64 bits via BigInt)
  function hash(i) {
    let v = BigInt.asIntN(64, BigInt(i) * 374761393n + 668265263n);
    v = BigInt.asIntN(64, (v ^ (BigInt.asUintN(64, v) >> 13n)) * 1274126177n);
    return Number((v ^ (BigInt.asUintN(64, v) >> 16n)) & 0xffffffn) / 16777216;
  }
  function noise(x) {
    const fl = Math.floor(x), i = fl, f = smooth(x - fl);
    const a = hash(i), b = hash(i + 1);
    return a + (b - a) * f;
  }
  function hsv(h) {
    let r, g, b; const k = trunc(h * 6), f = h * 6 - k;
    switch (k % 6) {
      case 0: r = 1; g = f; b = 0; break;
      case 1: r = 1 - f; g = 1; b = 0; break;
      case 2: r = 0; g = 1; b = f; break;
      case 3: r = 0; g = 1 - f; b = 1; break;
      case 4: r = f; g = 0; b = 1; break;
      default: r = 1; g = 0; b = 1 - f;
    }
    return [r * 255, g * 255, b * 255, 0];
  }
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  function palAt(p, x, ease) {
    const pl = p.length, fl = Math.floor(x), k = mod(fl, pl), f = x - fl;
    return lerp(p[k], p[(k + 1) % pl], ease ? smooth(f) : f);
  }
  const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? -1 + 4 * f : 3 - 4 * f; };
  const TRI = [0, -1, 0.87, 0.5, -0.87, 0.5];
  const STAR = (() => { const p = []; for (let k = 0; k < 10; k++) { const r = k % 2 === 0 ? 1 : 0.4, a = -Math.PI / 2 + k * Math.PI / 5; p.push(r * Math.cos(a), r * Math.sin(a)); } return p; })();
  function poly(p, u) {
    const n = p.length / 2, v = u * n, k = trunc(Math.floor(v)) % n, f = v - Math.floor(v), j = (k + 1) % n;
    return [p[2 * k] + (p[2 * j] - p[2 * k]) * f, p[2 * k + 1] + (p[2 * j + 1] - p[2 * k + 1]) * f];
  }

  function shape(s, t, a) {
    const sn = Math.sin(t), cs = Math.cos(t);
    const u = mod(t / TAU, 1);
    switch (s) {
      case 'eight': return [sn, Math.sin(2 * t)];
      case 'line': return [cs, cs];
      case 'line2': return [cs, 0];
      case 'tilt': return [0, sn];
      case 'diamond': return [Math.pow(sn, 3), Math.pow(cs, 3)];
      case 'square': { const v = u * 4, k = trunc(v), f = v - k;
        if (k === 0) return [-1 + 2 * f, -1]; if (k === 1) return [1, -1 + 2 * f]; if (k === 2) return [1 - 2 * f, 1]; return [-1, 1 - 2 * f]; }
      case 'squarechoppy': { const k = trunc(u * 4); return [k === 1 || k === 2 ? 1 : -1, k >= 2 ? 1 : -1]; }
      case 'leaf': return [Math.pow(sn, 5), cs * Math.abs(cs)];
      case 'lissajous': return [Math.sin(2 * t + Math.PI / 2), Math.sin(3 * t)];
      case 'pendulum': return [sn, 0.7 * sn * sn - 0.35];
      case 'triangle': return poly(TRI, u);
      case 'star': return poly(STAR, u);
      case 'spiral': { const r = 0.5 - 0.5 * Math.cos(t); return [r * Math.cos(4 * t), r * Math.sin(4 * t)]; }
      case 'flower': { const r = Math.cos(3 * t); return [r * cs, r * sn]; }
      case 'clover': { const r = Math.cos(2 * t); return [r * cs, r * sn]; }
      case 'orbit': return [0.7 * cs + 0.3 * Math.cos(5 * t), 0.7 * sn + 0.3 * Math.sin(5 * t)];
      case 'zigzag': return [tri(u * 5), tri(u)];
      case 'bounce': return [cs, 1 - 2 * Math.abs(Math.sin(3 * t))];
      case 'cross': { const v = Math.sin(4 * Math.PI * u); return u < 0.5 ? [v, 0] : [0, v]; }
      case 'scan': return [tri(u), 0.15 * Math.sin(6 * t)];
      case 'ballyhoo': return [0.6 * Math.sin(a) + 0.4 * Math.sin(2.31 * a + 1.3), 0.6 * Math.cos(1.37 * a) + 0.4 * Math.sin(3.1 * a + 0.4)];
      case 'random': return [2 * noise(a * 0.6) - 1, 2 * noise(a * 0.6 + 71.3) - 1];
      default: return [cs, sn];
    }
  }

  class DmxProgram {
    constructor(o) {
      this.base = new Float32Array(513);
      this.curve = new Uint8Array(513);
      this.out = new Float32Array(513);
      this.fx = []; this.shapes = null; this.period = 20000; this.every = 30000;
      this.size = 127; this.cx = 127; this.cy = 127; this.fan = 0; this.offs = []; this.flip = [];
      this.cmode = null; this.palette = []; this.step = 10000; this.spread = true;
      if (!o || typeof o !== 'object') return;
      const b = o.base && typeof o.base === 'object' ? o.base : (o.base === undefined ? o : null);
      if (b) for (const k of Object.keys(b)) { const ch = parseInt(k, 10); if (ch >= 1 && ch <= 512 && String(ch) === k) this.base[ch] = clamp(+b[k] || 0); }
      if (o.curves && typeof o.curves === 'object') for (const k of Object.keys(o.curves)) { const ch = parseInt(k, 10); if (ch >= 1 && ch <= 512) this.curve[ch] = (+o.curves[k] || 0) & 0xff; }
      if (Array.isArray(o.fixtures)) this.fx = o.fixtures.map(x => { x = x || {}; return [x.pan | 0, x.tilt | 0, x.dim | 0, x.r | 0, x.g | 0, x.b | 0, x.w | 0]; });
      const m = o.motion;
      if (m && typeof m === 'object') {
        if (Array.isArray(m.shapes) && m.shapes.length) this.shapes = m.shapes.map(s => String(s || 'circle'));
        this.period = Math.max(1000, +m.period || 20000);
        this.every = Math.max(2000, +m.every || 30000);
        this.size = m.size != null ? +m.size : 127; this.cx = m.cx != null ? +m.cx : 127; this.cy = m.cy != null ? +m.cy : 127;
        this.fan = +m.fan || 0;
        if (Array.isArray(m.offsets)) this.offs = m.offsets.map(v => (+v || 0) * Math.PI / 180);
        if (Array.isArray(m.flip)) this.flip = m.flip.map(v => (+v < 0 ? -1 : 1));
      }
      const c = o.color;
      if (c && typeof c === 'object') {
        this.cmode = String(c.mode || 'static');
        this.step = Math.max(300, +c.step || 10000);
        this.spread = c.spread !== undefined ? !!c.spread : true;
        if (Array.isArray(c.palette)) this.palette = c.palette.map(q => Array.isArray(q) ? [q[0] | 0, q[1] | 0, q[2] | 0, q[3] | 0] : [0, 0, 0, 0]);
      }
    }

    set(ch, v) { if (ch >= 1 && ch <= 512) this.out[ch] = clamp(v); }

    compute(now) {
      this.out.set(this.base);
      const n = this.fx.length;
      if (this.shapes && n > 0) {
        const sh = this.shapes[trunc(now / this.every) % this.shapes.length];
        const t0 = TAU * (now % this.period) / this.period;
        const a0 = TAU * ((now % (this.period * 1000)) / this.period);
        for (let i = 0; i < n; i++) {
          const o = i < this.offs.length ? this.offs[i] : 0;
          const xy = shape(sh, t0 + o, a0 + o * 3.7);
          const sx = i < this.flip.length ? this.flip[i] : 1;
          const fo = this.fan * (i - (n - 1) / 2);
          this.set(this.fx[i][0], this.cx + fo + this.size * xy[0] * sx);
          this.set(this.fx[i][1], this.cy + this.size * xy[1]);
        }
      }
      if (this.cmode && n > 0) {
        for (let i = 0; i < n; i++) {
          const c = this.color(now, i, n);
          if (!c) continue;
          let k = 1;
          if (c.length > 4) { if (this.fx[i][2] > 0) this.set(this.fx[i][2], c[4]); else k = c[4] / 255; }
          this.set(this.fx[i][3], c[0] * k); this.set(this.fx[i][4], c[1] * k); this.set(this.fx[i][5], c[2] * k); this.set(this.fx[i][6], c[3] * k);
        }
      }
      return this.out;
    }

    color(now, i, n) {
      if (this.cmode !== 'mix') return this.colorOf(this.cmode, now, i, n);
      const seq = ['rainbow', 'fade', 'comet', 'wave', 'gradient', 'breathe', 'chase', 'bounce', 'drift'];
      const len = this.step * 2, k = trunc(now / len);
      let cur = this.colorOf(seq[k % seq.length], now, i, n);
      const into = now % len;
      if (cur && cur.length === 4) cur = [cur[0], cur[1], cur[2], cur[3], 255];
      if (into >= 1500 || k === 0 || !cur) return cur;
      const prev = this.colorOf(seq[(k - 1) % seq.length], now, i, n);
      if (!prev) return cur;
      const f = smooth(into / 1500), r = [];
      for (let j = 0; j < 5; j++) { const a = j < prev.length ? prev[j] : 255, b = j < cur.length ? cur[j] : 255; r.push(a + (b - a) * f); }
      return r;
    }

    colorOf(mode, now, i, n) {
      const P = this.palette, pl = P.length, step = this.step, spread = this.spread;
      const ts = (now % (step * 100000)) / step;
      switch (mode) {
        case 'rainbow': { const h = ((now % (step * 2)) / (step * 2)) + (spread ? i / n : 0); return hsv(h % 1); }
        case 'wave': { if (!pl) return null; const c = P[trunc(now / step) % pl]; const ph = TAU * ((now % 2000) / 2000) - (spread ? i * Math.PI / 2 : 0); return [c[0], c[1], c[2], c[3], 127.5 + 127.5 * Math.sin(ph)]; }
        case 'random': {
          const per = Math.max(1500, step / 2), k = trunc(now / per) + (spread ? i * 7919 : 0);
          const f = smooth(Math.min(1, (now % per) / 800));
          const lo = x => ((x % 65536) * 31153) % 65536;   // (k × 2654435761) & 0xffff
          const a = hsv(lo(k) / 65536), b = hsv(lo(k + 1) / 65536);
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 0];
        }
        case 'pulse': { if (!pl) return null; const c = P[0]; return [c[0], c[1], c[2], c[3], 127.5 + 127.5 * Math.sin(TAU * (now % step) / step - (spread ? i * 0.6 : 0))]; }
        case 'chase': { if (!pl) return null; const k = trunc(now / step) + (spread ? i : 0); const f = smooth(Math.min(1, (now % step) / 400)); return lerp(P[(k - 1 + pl) % pl], P[k % pl], f); }
        case 'fade': { if (!pl) return null; return palAt(P, ts + (spread ? i : 0), true); }
        case 'gradient': { if (!pl) return null; return palAt(P, ts + i * pl / n, false); }
        case 'split': { if (!pl) return null; const k = Math.floor(ts), f = ts - k; const sw = smooth(Math.min(1, f * step / 1200)); const g = i % 2; return lerp(P[(k + g) % pl], P[(k + 1 + g) % pl], sw); }
        case 'alternate': { if (!pl) return null; const on = 0.5 + 0.5 * Math.cos(Math.PI * ts + (i % 2) * Math.PI); const c = P[trunc(ts / 2) % pl]; return [c[0], c[1], c[2], c[3], 25 + 230 * on]; }
        case 'comet': {
          if (!pl) return null;
          const pos = (ts - Math.floor(ts)) * n, dd = mod(pos - i, n);
          let v = dd > n - 0.6 ? 1 - (n - dd) / 0.6 : Math.max(0, 1 - dd / 1.6);
          if (n < 3) v = 0.5 + 0.5 * Math.cos(TAU * dd / n);
          const c = P[trunc(ts) % pl]; return [c[0], c[1], c[2], c[3], 10 + 245 * v * v];
        }
        case 'bounce': { if (!pl) return null; const pos = n > 1 ? (tri(ts / 2) + 1) / 2 * (n - 1) : 0; const v = Math.max(0, 1 - Math.abs(pos - i) / 1.2); const c = P[trunc(ts / 2) % pl]; return [c[0], c[1], c[2], c[3], 10 + 245 * v]; }
        case 'breathe': { if (!pl) return null; const ph = ts + (spread ? i * 0.25 : 0); const v = 0.5 - 0.5 * Math.cos(TAU * ph); const c = P[mod(Math.floor(ph + 0.5), pl)]; return [c[0], c[1], c[2], c[3], 30 + 225 * v]; }
        case 'heartbeat': {
          if (!pl) return null; const st = Math.max(800, step); const ph = ((now + (spread ? i * 90 : 0)) % st) / st;
          const e = Math.exp(-Math.pow((ph - 0.12) / 0.06, 2)) + 0.7 * Math.exp(-Math.pow((ph - 0.34) / 0.06, 2));
          const c = P[0]; return [c[0], c[1], c[2], c[3], 60 + 195 * Math.min(1, e)];
        }
        case 'fire': {
          const p = pl >= 2 ? P : FIRE; const sp = Math.max(260, step / 25);
          const h = noise(now / sp + i * 17.3), d = noise(now / (sp * 0.6) + i * 31.7 + 5);
          const c = palAt(p, h * (p.length - 1), false); return [c[0], c[1], c[2], c[3], 140 + 115 * d];
        }
        case 'drift': { if (!pl) return null; const h = noise(ts * 0.8 + (spread ? i * 3.1 : 0)), d = noise(ts * 1.3 + i * 7.7 + 11); const c = palAt(P, h * pl * 1.5, true); return [c[0], c[1], c[2], c[3], 120 + 135 * d]; }
        case 'twinkle': { if (!pl) return null; const v = Math.pow(noise(ts * 3 + i * 13.7), 2.2); const c = P[(trunc(ts) + i) % pl]; return [c[0], c[1], c[2], c[3], 20 + 235 * v]; }
        default: { if (!pl) return null; const c = P[spread ? i % pl : 0]; return [c[0], c[1], c[2], c[3]]; }
      }
    }
  }

  /** Protections anti-stroboscope à la sortie (identiques à DmxOutput.safe). */
  function safe(curve, v) {
    switch (curve) {
      case 1: return v <= 0 ? 0 : (v >= 250 ? 255 : 8 + Math.round((v - 1) * 126 / 248));
      case 2: return Math.min(v, 231);
      case 3: return 0;
      case 5: return Math.min(v, 239);
      case 7: return 128;
      default: return v;
    }
  }

  const api = { DmxProgram, safe, shape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WafDmx = api;
})(typeof window !== 'undefined' ? window : globalThis);
