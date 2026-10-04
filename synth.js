// Fehlende Zeichen im Stil der eigenen Handschrift ergänzen.
// 1. Aus eigenen Zeichen ableiten: Umlaute (a + Punkte) und Groß/Klein bei gleicher Form (c/C, o/O …)
// 2. Sonst aus der ähnlichsten Handschrift-Schrift erzeugen und an Größe, Strichdicke und Neigung anpassen
(() => {
  "use strict";

  const H = () => window.Handschrift;
  const EM = 80;                    // Pixel pro em für erzeugte Zeichen
  const SHORT_LOWER = "acemnorsuvwxz";
  const CAPS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const SAME_SHAPE = "cosvwxz";     // Klein- und Großbuchstabe sehen gleich aus
  const UMLAUTS = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U" };
  const VARIANTS = 3;
  const FONTS = ["Caveat", "Kalam", "Indie Flower", "Shadows Into Light", "Gloria Hallelujah",
    "Reenie Beanie", "Nothing You Could Do", "Dancing Script", "Homemade Apple"];

  let style = null;       // analysierter Stil der eigenen Handschrift
  let dirty = true;
  const cache = new Map();
  const fontMetrics = new Map();

  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isLower = (ch) => ch !== ch.toUpperCase();
  const isUpper = (ch) => ch !== ch.toLowerCase();

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Pixel-Hilfen ----------

  function alphaOf(source) {
    const c = document.createElement("canvas");
    c.width = source.naturalWidth || source.width;
    c.height = source.naturalHeight || source.height;
    const x = c.getContext("2d");
    x.drawImage(source, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const a = new Uint8ClampedArray(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return { a, w: c.width, h: c.height };
  }

  // Strichdicke ≈ 2 · Fläche / Umfang; Neigung aus der Regression x über y
  function inkStats({ a, w, h }) {
    let n = 0, border = 0, sx = 0, sy = 0;
    const ink = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] > 127;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink(x, y)) continue;
        n++; sx += x; sy += y;
        if (!ink(x - 1, y) || !ink(x + 1, y) || !ink(x, y - 1) || !ink(x, y + 1)) border++;
      }
    }
    if (!n) return null;
    const mx = sx / n, my = sy / n;
    let cxy = 0, cyy = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!ink(x, y)) continue;
        cxy += (x - mx) * (y - my); cyy += (y - my) * (y - my);
      }
    }
    return { stroke: border ? (2 * n) / border : 1, slant: cyy ? -cxy / cyy : 0 };
  }

  function morph(mask, r) {
    const { w, h } = mask;
    let a = mask.a;
    const grow = r > 0;
    for (let k = 0; k < Math.abs(r); k++) {
      const b = new Uint8ClampedArray(a.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = a[y * w + x];
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) { if (!grow) v = 0; continue; }
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) { if (!grow) v = 0; continue; }
              const q = a[yy * w + xx];
              v = grow ? Math.max(v, q) : Math.min(v, q);
            }
          }
          b[y * w + x] = v;
        }
      }
      a = b;
    }
    return { a, w, h };
  }

  // Alpha-Maske → zugeschnittenes Canvas plus Lage relativ zur Grundlinie (y0) in em
  function toGlyph(mask, y0, extra) {
    const { a, w, h } = mask;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a[y * w + x] > 10) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 2;
    const x0 = Math.max(0, minX - pad), y1 = Math.max(0, minY - pad);
    const cw = Math.min(w, maxX + pad + 1) - x0, ch = Math.min(h, maxY + pad + 1) - y1;
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) img.data[(y * cw + x) * 4 + 3] = a[(y + y1) * w + (x + x0)];
    }
    ctx.putImageData(img, 0, 0);
    return Object.assign({
      canvas: c,
      bx: 0, by: (y1 - y0) / EM, bw: cw / EM, bh: ch / EM,
      l: (minX - x0) / EM, w: Math.max(0.05, (maxX - minX + 1) / EM),
      synth: true,
    }, extra || {});
  }

  // ---------- Stil der eigenen Handschrift ----------

  function extentOf(v) {
    if (!v.img && v.s && v.s.length) {
      let top = Infinity, bottom = -Infinity;
      for (const st of v.s) for (const [, y] of st) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return { top, bottom };
    }
    const im = v.img && H().imageFor(v);
    const padEm = im && im.naturalHeight ? (2 / im.naturalHeight) * v.bh : 0;
    return { top: v.by + padEm, bottom: v.by + v.bh - padEm };
  }

  function analyze() {
    const glyphs = H().allGlyphs();
    const xs = [], caps = [], digits = [], strokes = [], slants = [], widths = [], pressures = [];
    let bitmaps = 0, total = 0;
    for (const [ch, vs] of Object.entries(glyphs)) {
      for (const v of vs) {
        total++;
        const e = extentOf(v);
        if (SHORT_LOWER.includes(ch)) { xs.push(-e.top); widths.push({ ch, w: v.w }); }
        else if (CAPS.includes(ch)) caps.push(-e.top);
        else if (/[0-9]/.test(ch)) digits.push(-e.top);
        if (v.img) {
          bitmaps++;
          const im = H().imageFor(v);
          if (!im.complete || !im.naturalWidth) continue;
          const st = inkStats(alphaOf(im));
          if (!st) continue;
          const emPx = im.naturalHeight / v.bh;
          strokes.push(st.stroke / emPx);
          if (e.bottom - e.top > 0.3) slants.push(st.slant);
        } else if (v.s) {
          for (const s of v.s) for (const p of s) pressures.push(p[2]);
          const pts = v.s.flat();
          if (pts.length > 4 && e.bottom - e.top > 0.3) {
            const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
            const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
            let cxy = 0, cyy = 0;
            for (const [x, y] of pts) { cxy += (x - mx) * (y - my); cyy += (y - my) * (y - my); }
            if (cyy) slants.push(-cxy / cyy);
          }
        }
      }
    }
    if (!total) return null;
    let xH = median(xs), capH = median(caps);
    if (capH == null) capH = median(digits);
    if (xH == null && capH == null) return null;
    if (xH == null) xH = capH * 0.6;
    if (capH == null) capH = xH * 1.7;
    return {
      xH, capH,
      strokeEm: bitmaps * 2 >= total ? median(strokes) : null, // bei gezeichneten Zeichen: Stiftstärke-Regler
      pressure: median(pressures) == null ? 0.5 : median(pressures),
      slant: clamp(median(slants) || 0, -0.5, 0.5),
      widths,
    };
  }

  // ---------- Schriften vermessen und die ähnlichste wählen ----------

  function metricsOf(font) {
    if (fontMetrics.has(font)) return fontMetrics.get(font);
    const size = 100;
    const c = document.createElement("canvas");
    c.width = 260; c.height = 260;
    const ctx = c.getContext("2d");
    ctx.font = `${size}px "${font}"`;
    const asc = (t) => ctx.measureText(t).actualBoundingBoxAscent || 0;
    const width = (t) => {
      const m = ctx.measureText(t);
      return (m.actualBoundingBoxRight || 0) + (m.actualBoundingBoxLeft || 0) || m.width;
    };
    ctx.fillStyle = "#000";
    ctx.fillText("l", 80, 200);
    const st = inkStats(alphaOf(c)) || { stroke: 8, slant: 0 };
    const m = {
      xH: asc("x") / size || 0.5,
      capH: asc("H") / size || 0.7,
      width: (ch) => width(ch) / size,
      stroke: st.stroke / size,
      slant: st.slant,
    };
    fontMetrics.set(font, m);
    return m;
  }

  function pickFont(st) {
    let best = "Kalam", bestScore = Infinity;
    for (const font of FONTS) {
      const m = metricsOf(font);
      let diff = 0, n = 0;
      for (const { ch, w } of st.widths) {
        const fw = m.width(ch) / m.xH;
        const uw = w / st.xH;
        if (fw > 0 && uw > 0) { diff += Math.abs(Math.log(fw / uw)); n++; }
      }
      const score = (n ? diff / n : 0) + 1.5 * Math.abs(m.slant - st.slant) + 0.4 * Math.abs(Math.log((m.capH / m.xH) / (st.capH / st.xH)));
      if (score < bestScore) { bestScore = score; best = font; }
    }
    return best;
  }

  // ---------- Erzeugen ----------

  function fromFont(ch, i, font, strokeEm) {
    const m = metricsOf(font);
    const lower = isLower(ch);
    const ref = lower || !(isUpper(ch) || /[0-9]/.test(ch)) ? style.xH / m.xH : style.capH / m.capH;
    const rnd = mulberry32(ch.codePointAt(0) * 7919 + i * 104729);
    const size = ref * EM * (1 + (rnd() - 0.5) * 0.06);
    const w = Math.ceil(size * 2.2 + 40), h = Math.ceil(size * 2.2 + 40);
    const y0 = Math.round(h * 0.68);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.font = `${size}px "${font}"`;
    ctx.fillStyle = "#000";
    const shear = clamp(style.slant - m.slant, -0.45, 0.45) + (rnd() - 0.5) * 0.06;
    ctx.translate(20 + size * 0.3, y0);
    ctx.rotate((rnd() - 0.5) * 0.05);
    ctx.transform(1, 0, -shear, 1, 0, 0);
    ctx.fillText(ch, 0, 0);
    let mask = alphaOf(c);
    const st = inkStats(mask);
    if (st) {
      const target = strokeEm * EM;
      const r = Math.round((target - st.stroke) / 2);
      mask = morph(mask, clamp(r, -Math.floor(st.stroke * 0.3), 6));
    }
    return toGlyph(mask, y0);
  }

  // Groß/Klein aus der anderen Variante skalieren, Strichdicke bleibt erhalten
  function scaled(v, f) {
    if (!v.img) {
      return { s: v.s.map((st) => st.map(([x, y, p]) => [x * f, y * f, p])), l: v.l * f, w: v.w * f, synth: true };
    }
    const im = H().imageFor(v);
    if (!im.complete || !im.naturalWidth) return null;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(im.naturalWidth * f));
    c.height = Math.max(1, Math.round(im.naturalHeight * f));
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    let mask = alphaOf(c);
    const st = inkStats(alphaOf(im));
    if (st) mask = morph(mask, clamp(Math.round((st.stroke - st.stroke * f) / 2), -6, 6));
    const emPx = (im.naturalHeight / v.bh) * f;
    const g = toGlyph(mask, 0);
    if (!g) return null;
    // toGlyph rechnet mit EM; auf die tatsächliche Auflösung umrechnen
    const k = EM / emPx;
    // Waagerecht zählt nur die Lage relativ zum Ausschnitt (bx = 0), senkrecht die zur Grundlinie
    return Object.assign(g, { bx: 0, by: v.by * f + g.by * k, bw: g.bw * k, bh: g.bh * k, l: g.l * k, w: g.w * k });
  }

  // Umlaut: Grundbuchstabe plus zwei Punkte in eigener Strichdicke
  function withDots(v, strokeEm) {
    const e = extentOf(v);
    const dotY = e.top - 0.14;
    const x1 = v.l + v.w * 0.3, x2 = v.l + v.w * 0.72;
    if (!v.img) return { s: v.s.concat([[[x1, dotY, 0.8]], [[x2, dotY, 0.8]]]), l: v.l, w: v.w, synth: true };
    const im = H().imageFor(v);
    if (!im.complete || !im.naturalWidth) return null;
    const emPx = im.naturalHeight / v.bh;
    const extra = Math.round(0.28 * emPx);
    const c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight + extra;
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, extra);
    ctx.fillStyle = "#000";
    const r = Math.max(1.2, (strokeEm * emPx) * 0.62);
    for (const x of [x1, x2]) {
      ctx.beginPath();
      ctx.arc((x - v.bx) * emPx, (dotY - v.by) * emPx + extra, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return { canvas: c, bx: v.bx, by: v.by - extra / emPx, bw: v.bw, bh: c.height / emPx, l: v.l, w: v.w, synth: true };
  }

  function generate(ch, opts) {
    const g = H();
    const strokeEm = style.strokeEm || 0.01 * opts.pen * (0.55 + 0.9 * style.pressure);
    const out = [];
    const base = UMLAUTS[ch];
    if (base && g.has(base)) {
      for (const v of g.variants(base).slice(0, VARIANTS)) { const d = withDots(v, strokeEm); if (d) out.push(d); }
    }
    const lower = ch.toLowerCase(), upper = ch.toUpperCase();
    if (!out.length && SAME_SHAPE.includes(lower)) {
      const src = isLower(ch) ? upper : lower;
      if (g.has(src)) {
        const f = isLower(ch) ? style.xH / style.capH : style.capH / style.xH;
        for (const v of g.variants(src).slice(0, VARIANTS)) { const d = scaled(v, f); if (d) out.push(d); }
      }
    }
    if (!out.length) {
      const font = opts.base && FONTS.includes(opts.base) ? opts.base : pickFont(style);
      for (let i = 0; i < VARIANTS; i++) { const d = fromFont(ch, i, font, strokeEm); if (d) out.push(d); }
    }
    return out.length ? out : null;
  }

  // ---------- Schnittstelle ----------

  async function prepare() {
    if (!dirty) return;
    await Promise.all(FONTS.map((f) => document.fonts.load(`100px "${f}"`, "aHx").catch(() => {})));
    if (H().ready) await H().ready();
    style = analyze();
    cache.clear();
    dirty = false;
  }

  function variantsFor(ch, opts) {
    if (!style || /\s/.test(ch)) return null;
    const key = `${ch}|${opts.pen}|${opts.base || "auto"}`;
    if (!cache.has(key)) cache.set(key, generate(ch, opts));
    return cache.get(key);
  }

  function invalidate() {
    dirty = true;
  }

  window.HandschriftSynth = {
    prepare,
    variantsFor,
    invalidate,
    chosenFont: () => (style ? pickFont(style) : null),
    style: () => style,
    FONTS,
  };
})();
