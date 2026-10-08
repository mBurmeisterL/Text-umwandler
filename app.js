(() => {
  "use strict";

  // A4 bei ca. 150 dpi
  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN_TOP = 150;
  const MARGIN_BOTTOM = 110;
  const MARGIN_LINE_X = 140;
  const TEXT_LEFT = 165;
  const TEXT_RIGHT = PAGE_W - 90;

  const STORAGE_KEY = "text-umwandler:v1";
  const CUSTOM = "__custom__";
  const FALLBACK_FONT = "Caveat";

  const DEFAULT_TEXT =
    "Liebe Oma,\n\n" +
    "vielen Dank für das tolle Geschenk! Ich habe mich riesig gefreut. " +
    "Hier ist alles bestens – die Schule läuft gut und am Wochenende waren wir am See. " +
    "Das Wetter war herrlich und wir haben sogar Eis gegessen.\n\n" +
    "Ich hoffe, es geht dir gut und wir sehen uns bald wieder.\n\n" +
    "Viele liebe Grüße\n" +
    "deine Lena";

  const $ = (id) => document.getElementById(id);
  const els = {
    text: $("text"),
    font: $("font"),
    paper: $("paper"),
    color: $("color"),
    size: $("size"),
    line: $("line"),
    mess: $("mess"),
    spacing: $("spacing"),
    word: $("word"),
    pen: $("pen"),
    synth: $("synth"),
    synthBase: $("synthBase"),
    margin: $("margin"),
    pages: $("pages"),
    status: $("status"),
    swatches: $("swatches"),
  };

  const state = {
    ink: "#1d3a8a",
    seed: Math.floor(Math.random() * 1e9),
  };

  // ---------- Hilfsfunktionen ----------

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Eigener Zufallsstrom pro Zeile, damit Änderungen am Text nicht die ganze Seite neu "verwackeln"
  function rngFor(...parts) {
    let h = 2166136261;
    for (const p of parts) {
      h ^= p;
      h = Math.imul(h, 16777619);
    }
    return mulberry32(h >>> 0);
  }

  function settings() {
    return {
      text: els.text.value,
      font: els.font.value,
      paper: els.paper.value,
      ink: state.ink,
      size: Number(els.size.value),
      line: Number(els.line.value),
      mess: Number(els.mess.value),
      spacing: Number(els.spacing.value),
      word: Number(els.word.value),
      pen: Number(els.pen.value),
      synth: els.synth.checked,
      synthBase: els.synthBase.value,
      margin: els.margin.checked,
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings()));
    } catch (_) { /* Speicher nicht verfügbar – egal */ }
  }

  function load() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch (_) { s = null; }
    els.text.value = s && typeof s.text === "string" ? s.text : DEFAULT_TEXT;
    if (!s) return;
    const setVal = (el, v) => { if (v !== undefined && v !== null) el.value = v; };
    setVal(els.font, s.font);
    setVal(els.paper, s.paper);
    setVal(els.size, s.size);
    setVal(els.line, s.line);
    setVal(els.mess, s.mess);
    setVal(els.spacing, s.spacing);
    setVal(els.word, s.word);
    setVal(els.pen, s.pen);
    setVal(els.synthBase, s.synthBase);
    if (typeof s.synth === "boolean") els.synth.checked = s.synth;
    if (typeof s.margin === "boolean") els.margin.checked = s.margin;
    if (typeof s.ink === "string") state.ink = s.ink;
  }

  // Kacheln statt Auswahllisten: zeigen jede Schrift bzw. jedes Papier als kleine Vorschau
  function buildTiles() {
    const fontGrid = $("fontGrid");
    for (const opt of els.font.options) {
      const custom = opt.value === CUSTOM;
      const m = opt.textContent.match(/^(.*?)\s*\((.*)\)$/);
      const name = custom ? "Meine Handschrift" : (m ? m[1] : opt.textContent);
      const desc = custom ? "selbst geschrieben" : (m ? m[2] : "");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile" + (custom ? " custom" : "");
      b.dataset.value = opt.value;
      b.setAttribute("aria-label", `${name} (${desc})`);
      const sample = document.createElement("span");
      sample.className = "font-sample";
      sample.textContent = custom ? "✍️ Meine" : "Handschrift";
      if (!custom) sample.style.fontFamily = `"${opt.value}", cursive`;
      const n = document.createElement("span");
      n.className = "tile-name";
      n.textContent = name;
      const d = document.createElement("span");
      d.className = "tile-desc";
      d.textContent = desc;
      b.append(sample, n, d);
      b.addEventListener("click", () => {
        if (custom && !(window.Handschrift && window.Handschrift.count())) {
          window.Handschrift.open();
          return;
        }
        els.font.value = opt.value;
        els.font.dispatchEvent(new Event("change"));
      });
      fontGrid.appendChild(b);
    }

    const paperGrid = $("paperGrid");
    for (const opt of els.paper.options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile paper-tile";
      b.dataset.value = opt.value;
      b.innerHTML = `<span class="paper-swatch ${opt.value}"></span><span class="tile-name"></span>`;
      b.querySelector(".tile-name").textContent = opt.textContent;
      b.addEventListener("click", () => {
        els.paper.value = opt.value;
        els.paper.dispatchEvent(new Event("change"));
      });
      paperGrid.appendChild(b);
    }
  }

  function updateOutputs() {
    for (const t of $("fontGrid").children) t.classList.toggle("active", t.dataset.value === els.font.value);
    for (const t of $("paperGrid").children) t.classList.toggle("active", t.dataset.value === els.paper.value);
    $("sizeOut").textContent = els.size.value + " px";
    $("lineOut").textContent = els.line.value + " px";
    $("messOut").textContent = els.mess.value;
    $("spacingOut").textContent = els.spacing.value;
    $("wordOut").textContent = els.word.value;
    $("penOut").textContent = els.pen.value;
    $("penField").hidden = els.font.value !== CUSTOM;
    $("synthField").hidden = els.font.value !== CUSTOM;
    const H = window.Handschrift;
    $("profileField").hidden = els.font.value !== CUSTOM || !H || H.profiles().length < 2;
    const tileName = document.querySelector('#fontGrid .tile.custom .tile-name');
    if (tileName && H) tileName.textContent = H.activeProfile().name;
    els.synthBase.disabled = !els.synth.checked;
    for (const b of els.swatches.querySelectorAll("button")) {
      b.classList.toggle("active", b.dataset.color.toLowerCase() === state.ink.toLowerCase());
    }
    const preset = [...els.swatches.querySelectorAll("button")].some(
      (b) => b.dataset.color.toLowerCase() === state.ink.toLowerCase()
    );
    els.color.parentElement.classList.toggle("active", !preset);
    if (!preset) els.color.value = state.ink;
  }

  // ---------- Textumbruch ----------

  // Kapselt, wie Zeichen gemessen und gezeichnet werden: Schriftart oder eigene Handschrift
  function makeProvider(measureCtx, s) {
    const H = window.Handschrift;
    const custom = s.font === CUSTOM && H;
    measureCtx.font = fontString(custom ? FALLBACK_FONT : s.font, s.size);

    if (!custom) {
      return {
        space: measureCtx.measureText(" ").width + s.word,
        width: (word) => measureCtx.measureText(word).width + s.spacing * [...word].length,
        // Position über das Präfix messen, damit Kerning der Schrift erhalten bleibt
        positions(word) {
          let prefix = "";
          return [...word].map((ch, i) => {
            const x = measureCtx.measureText(prefix).width + i * s.spacing;
            prefix += ch;
            return x;
          });
        },
        draw: (ctx, ch) => ctx.fillText(ch, 0, 0),
      };
    }

    // Eigene Varianten, sonst (falls eingeschaltet) im eigenen Stil erzeugte, sonst Ersatzschrift
    const S = s.synth && window.HandschriftSynth;
    const variantsOf = (ch) => (H.has(ch) ? H.variants(ch) : S ? S.variantsFor(ch, { pen: s.pen, base: s.synthBase }) : null);
    const widthCache = new Map();
    const avgWidth = (ch) => {
      if (!widthCache.has(ch)) {
        const vs = variantsOf(ch);
        widthCache.set(ch, vs ? vs.reduce((a, v) => a + v.w, 0) / vs.length : null);
      }
      return widthCache.get(ch);
    };
    const synthesized = new Set();
    const advance = (ch) => {
      const w = avgWidth(ch);
      return w != null ? (w + H.GAP) * s.size : measureCtx.measureText(ch).width;
    };
    const penWidth = s.size * 0.01 * s.pen;
    const lastVariant = {};
    return {
      space: 0.32 * s.size + s.word,
      width: (word) => [...word].reduce((a, ch) => a + advance(ch) + s.spacing, 0),
      positions(word) {
        let x = 0;
        return [...word].map((ch) => { const p = x; x += advance(ch) + s.spacing; return p; });
      },
      synthesized,
      draw(ctx, ch, rnd) {
        const vs = variantsOf(ch);
        if (!vs) { ctx.fillText(ch, 0, 0); return; }
        if (!H.has(ch)) synthesized.add(ch);
        // Zufällige Variante, aber nie zweimal dieselbe direkt hintereinander
        const n = vs.length;
        let idx = Math.floor(rnd() * n) % n;
        if (n > 1 && idx === lastVariant[ch]) idx = (idx + 1 + Math.floor(rnd() * (n - 1))) % n;
        lastVariant[ch] = idx;
        const v = vs[idx];
        H.drawGlyph(ctx, v, s.size, penWidth, ((avgWidth(ch) - v.w) / 2) * s.size);
      },
    };
  }

  function wrap(pv, s) {
    const maxW = TEXT_RIGHT - TEXT_LEFT;
    const spaceW = pv.space;
    const lines = [];
    const paragraphs = s.text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");

    paragraphs.forEach((para, pi) => {
      const start = lines.length;
      const words = para.split(/ +/).filter(Boolean);
      if (!words.length) { lines.push([]); lines[start].para = pi; return; }

      let cur = [];
      let curW = 0;
      for (let w of words) {
        // Überlange Wörter zerlegen
        while (pv.width(w) > maxW) {
          let cut = w.length - 1;
          while (cut > 1 && pv.width(w.slice(0, cut) + "-") > maxW) cut--;
          if (cur.length) { lines.push(cur); cur = []; curW = 0; }
          lines.push([w.slice(0, cut) + "-"]);
          w = w.slice(cut);
        }
        const ww = pv.width(w);
        const needed = cur.length ? curW + spaceW + ww : ww;
        if (needed > maxW && cur.length) {
          lines.push(cur);
          cur = [w];
          curW = ww;
        } else {
          cur.push(w);
          curW = needed;
        }
      }
      if (cur.length) lines.push(cur);
      // Absatznummer merken (für den Export einzelner Absätze)
      for (let k = start; k < lines.length; k++) lines[k].para = pi;
    });
    return lines;
  }

  // ---------- Papier ----------

  let noiseTile = null;
  function getNoiseTile() {
    if (noiseTile) return noiseTile;
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const x = c.getContext("2d");
    const img = x.createImageData(160, 160);
    const r = mulberry32(42);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + r() * 135;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 10;
    }
    x.putImageData(img, 0, 0);
    noiseTile = c;
    return c;
  }

  function drawPaper(ctx, s, lineCount) {
    const old = s.paper === "old";
    ctx.fillStyle = old ? "#f3e6c8" : "#fdfdfb";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    ctx.fillStyle = ctx.createPattern(getNoiseTile(), "repeat");
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    if (old) {
      const g = ctx.createRadialGradient(PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.3, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.75);
      g.addColorStop(0, "rgba(120,80,20,0)");
      g.addColorStop(1, "rgba(120,80,20,0.22)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    }

    const firstBase = MARGIN_TOP + s.line;
    const lastBase = firstBase + (lineCount - 1) * s.line;

    if (s.paper === "lined") {
      ctx.strokeStyle = "rgba(90,130,200,0.45)";
      ctx.lineWidth = 2;
      for (let i = 0; i < lineCount; i++) {
        const y = Math.round(firstBase + i * s.line) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(PAGE_W, y);
        ctx.stroke();
      }
    } else if (s.paper === "grid") {
      const cell = s.line / 2;
      ctx.strokeStyle = "rgba(90,130,200,0.30)";
      ctx.lineWidth = 1.5;
      const startY = firstBase - Math.floor((firstBase - 40) / cell) * cell;
      for (let y = startY; y <= PAGE_H - 40; y += cell) {
        ctx.beginPath();
        ctx.moveTo(40, Math.round(y) + 0.5);
        ctx.lineTo(PAGE_W - 40, Math.round(y) + 0.5);
        ctx.stroke();
      }
      const startX = TEXT_LEFT - Math.floor((TEXT_LEFT - 40) / cell) * cell;
      for (let x = startX; x <= PAGE_W - 40; x += cell) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, startY);
        ctx.lineTo(Math.round(x) + 0.5, PAGE_H - 40);
        ctx.stroke();
      }
    }

    if (s.margin) {
      ctx.strokeStyle = old ? "rgba(170,60,50,0.45)" : "rgba(220,70,70,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN_LINE_X + 0.5, 0);
      ctx.lineTo(MARGIN_LINE_X + 0.5, PAGE_H);
      ctx.stroke();
    }
    return lastBase;
  }

  // ---------- Schrift ----------

  function fontString(font, size) {
    return `${size}px "${font}", cursive`;
  }

  function drawLine(ctx, pv, words, baseY, s, rnd) {
    const m = s.mess / 10; // 0..1
    const scale = s.size / 46;
    const slope = (rnd() - 0.5) * 0.012 * m;            // leichte Schräglage der Zeile
    const waveAmp = rnd() * 3 * m * scale;               // sanfte Wellenbewegung
    const wavePhase = rnd() * Math.PI * 2;
    const waveLen = 300 + rnd() * 400;
    let x = TEXT_LEFT + (rnd() - 0.3) * 14 * m;
    for (const word of words) {
      const wordScale = 1 + (rnd() - 0.5) * 0.06 * m;
      const chars = [...word];
      const pos = pv.positions(word);
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cx = x + pos[i];
        if (ch === " ") continue;

        const dx = (rnd() - 0.5) * 1.6 * m * scale;
        const dy = (rnd() - 0.5) * 4 * m * scale
          + Math.sin(cx / waveLen * Math.PI * 2 + wavePhase) * waveAmp
          + (cx - TEXT_LEFT) * slope;
        const rot = (rnd() - 0.5) * 0.12 * m;
        const sc = wordScale * (1 + (rnd() - 0.5) * 0.08 * m);

        ctx.save();
        ctx.globalAlpha = 0.8 + rnd() * 0.2;
        ctx.translate(cx + dx, baseY + dy);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        pv.draw(ctx, ch, rnd);
        ctx.restore();
      }
      x += pv.width(word) + pv.space + (rnd() - 0.5) * 8 * m * scale;
    }
  }

  // ---------- Rendern ----------

  let renderToken = 0;
  let lastRender = null;

  async function render() {
    const token = ++renderToken;
    const s = settings();
    const fontName = s.font === CUSTOM ? FALLBACK_FONT : s.font;
    try {
      await document.fonts.load(fontString(fontName, s.size), "AaÄäÖöÜüß");
    } catch (_) { /* Fallback-Schrift wird verwendet */ }
    if (window.Handschrift) await window.Handschrift.ready();
    if (s.font === CUSTOM && s.synth && window.HandschriftSynth) await window.HandschriftSynth.prepare();
    if (token !== renderToken) return;

    const measure = document.createElement("canvas").getContext("2d");
    const pv = makeProvider(measure, s);
    const lines = wrap(pv, s);

    const linesPerPage = Math.max(1, Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / s.line));
    const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));

    // Vorhandene Canvas wiederverwenden, um Flackern zu vermeiden
    while (els.pages.children.length > pageCount) els.pages.lastChild.remove();
    while (els.pages.children.length < pageCount) {
      const c = document.createElement("canvas");
      c.width = PAGE_W;
      c.height = PAGE_H;
      els.pages.appendChild(c);
    }

    for (let p = 0; p < pageCount; p++) {
      const canvas = els.pages.children[p];
      canvas.setAttribute("aria-label", `Seite ${p + 1} von ${pageCount}`);
      const ctx = canvas.getContext("2d");
      drawPaper(ctx, s, linesPerPage);

      ctx.font = measure.font;
      ctx.fillStyle = s.ink;
      ctx.textBaseline = "alphabetic";

      const pageLines = lines.slice(p * linesPerPage, (p + 1) * linesPerPage);
      pageLines.forEach((words, i) => {
        const baseY = MARGIN_TOP + s.line * (i + 1) - Math.max(2, s.size * 0.06);
        drawLine(ctx, pv, words, baseY, s, rngFor(state.seed, p, i));
      });
    }

    lastRender = { s, pv, lines, linesPerPage, font: measure.font };

    let msg = pageCount === 1 ? "1 Seite" : `${pageCount} Seiten`;
    if (s.font === CUSTOM && !(window.Handschrift && window.Handschrift.count())) {
      msg = "Noch keine eigenen Buchstaben – klicke auf „Eigene Handschrift zeichnen“.";
    } else if (pv.synthesized && pv.synthesized.size) {
      const list = [...pv.synthesized].sort().join(" ");
      msg += ` · ${pv.synthesized.size} Zeichen im Stil deiner Handschrift ergänzt: ${list}`;
    }
    els.status.textContent = msg;
    const S = window.HandschriftSynth;
    $("synthInfo").textContent = s.font === CUSTOM && s.synth && S && S.style()
      ? "Ä, Ö, Ü und gleich geformte Groß-/Kleinbuchstaben (c, o, s, v, w, x, z) werden aus deinen eigenen Buchstaben gebaut, " +
        `alles andere aus „${s.synthBase || S.chosenFont()}“ – angepasst an Größe, Strichdicke und Neigung deiner Schrift.`
      : "";
  }

  let timer = null;
  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(() => { render(); save(); }, 120);
  }

  // ---------- Export ----------

  function canvases() {
    return [...els.pages.querySelectorAll("canvas")];
  }

  function download(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Transparenter Export (nur Schrift, ohne Papier) ----------

  // Zeichnet die angegebenen Zeilen ohne Papier, mit derselben Zufallsvariation wie die Vorschau,
  // und schneidet das Bild auf die Schrift zu
  function transparentCanvas(indices) {
    const { s, pv, linesPerPage, lines, font } = lastRender;
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = PAGE_W * scale;
    c.height = Math.ceil((indices.length + 1.5) * s.line * scale);
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);
    ctx.font = font;
    ctx.fillStyle = s.ink;
    ctx.textBaseline = "alphabetic";
    indices.forEach((li, k) => {
      const baseY = s.line * (k + 1) - Math.max(2, s.size * 0.06);
      drawLine(ctx, pv, lines[li], baseY, s, rngFor(state.seed, Math.floor(li / linesPerPage), li % linesPerPage));
    });
    return cropToInk(c);
  }

  function cropToInk(c) {
    const ctx = c.getContext("2d");
    const { width: w, height: h } = c;
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 16;
    const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad);
    const out = document.createElement("canvas");
    out.width = Math.min(w, maxX + pad) - x0;
    out.height = Math.min(h, maxY + pad) - y0;
    out.getContext("2d").drawImage(c, -x0, -y0);
    return out;
  }

  // Alle Zeilen mit Inhalt, wahlweise nach Absätzen gruppiert
  function transparentParts(perParagraph) {
    if (!lastRender) return [];
    const groups = new Map();
    lastRender.lines.forEach((ln, i) => {
      if (!ln.length && !perParagraph) { groups.set("all", (groups.get("all") || []).concat(i)); return; }
      if (!ln.length) return;
      const key = perParagraph ? ln.para : "all";
      groups.set(key, (groups.get(key) || []).concat(i));
    });
    return [...groups.values()].map(transparentCanvas).filter(Boolean);
  }

  const toBlob = (c) => new Promise((res) => c.toBlob(res, "image/png"));

  async function shareOrDownload(files) {
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: "Handschrift" });
        return true;
      } catch (e) {
        if (e.name === "AbortError") return true;
      }
    }
    for (const f of files) {
      const url = URL.createObjectURL(f);
      download(url, f.name);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }

  async function exportTransparent(mode) {
    closeTransparentMenu();
    if (!lastRender || !els.text.value.trim()) { els.status.textContent = "Es gibt noch keinen Text."; return; }
    if (mode === "copy") {
      const parts = transparentParts(false);
      if (!parts.length) return;
      // Safari braucht das Versprechen direkt im Klick, deshalb ClipboardItem mit Promise
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(parts[0]) })]);
        els.status.textContent = "📋 Schrift als Bild kopiert – in Goodnotes lange auf die Seite tippen und „Einsetzen“ wählen.";
      } catch (_) {
        els.status.textContent = "Kopieren ging nicht – nutze „Als Bild teilen/sichern“.";
      }
      return;
    }
    const parts = transparentParts(mode === "paragraphs");
    const files = await Promise.all(parts.map(async (c, i) =>
      new File([await toBlob(c)], parts.length > 1 ? `handschrift-absatz-${i + 1}.png` : "handschrift-transparent.png", { type: "image/png" })));
    const shared = await shareOrDownload(files);
    els.status.textContent = shared
      ? "Tipp: „Bild sichern“ wählen und in Goodnotes über das Bild-Werkzeug einfügen."
      : `${files.length} Bild${files.length > 1 ? "er" : ""} heruntergeladen – in Goodnotes über das Bild-Werkzeug einfügen.`;
  }

  function closeTransparentMenu() {
    $("transparentMenu").hidden = true;
    $("transparentBtn").setAttribute("aria-expanded", "false");
  }

  async function exportPng() {
    const list = canvases();
    for (let i = 0; i < list.length; i++) {
      const blob = await new Promise((res) => list[i].toBlob(res, "image/png"));
      const url = URL.createObjectURL(blob);
      download(url, list.length > 1 ? `handschrift-seite-${i + 1}.png` : "handschrift.png");
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  function buildPdf() {
    if (!window.jspdf) {
      els.status.textContent = "PDF-Bibliothek konnte nicht geladen werden – bitte „Drucken“ → „Als PDF speichern“ nutzen.";
      return null;
    }
    const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    canvases().forEach((c, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    });
    return pdf;
  }

  function exportPdf() {
    const pdf = buildPdf();
    if (pdf) pdf.save("handschrift.pdf");
  }

  // Öffnet auf iPad/iPhone das Teilen-Menü (z. B. „In Goodnotes öffnen“)
  async function sharePdf() {
    const pdf = buildPdf();
    if (!pdf) return;
    const file = new File([pdf.output("blob")], "handschrift.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Handschrift" });
      } catch (e) {
        if (e.name !== "AbortError") pdf.save("handschrift.pdf");
      }
      return;
    }
    pdf.save("handschrift.pdf");
    els.status.textContent = "Dieser Browser kann nicht direkt teilen – das PDF wurde heruntergeladen. In Goodnotes über „Importieren“ öffnen.";
  }

  // ---------- Goodnotes-Datei (bearbeitbare Striche) ----------

  async function buildGoodnotes() {
    const G = window.GoodnotesExport;
    if (!lastRender || !G) return null;
    const { s, lines, linesPerPage } = lastRender;
    // Neuer Zeichen-Lieferant, damit dieselben Buchstaben-Varianten wie in der Vorschau gewählt werden
    const pv = makeProvider(document.createElement("canvas").getContext("2d"), s);
    const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
    const pages = [];
    for (let p = 0; p < pageCount; p++) {
      const rec = G.createRecorder();
      rec.font = lastRender.font;
      rec.fillStyle = s.ink;
      lines.slice(p * linesPerPage, (p + 1) * linesPerPage).forEach((words, i) => {
        const baseY = MARGIN_TOP + s.line * (i + 1) - Math.max(2, s.size * 0.06);
        drawLine(rec, pv, words, baseY, s, rngFor(state.seed, p, i));
      });
      pages.push({ strokes: G.strokesFromOps(rec.ops) });
      // Dem Browser zwischendurch Luft lassen
      await new Promise((r) => setTimeout(r, 0));
    }
    // Papier ohne Schrift als PDF-Hintergrund
    const paper = document.createElement("canvas");
    paper.width = PAGE_W;
    paper.height = PAGE_H;
    drawPaper(paper.getContext("2d"), s, linesPerPage);
    const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    pdf.addImage(paper.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 595.28, 841.89);
    const background = new Uint8Array(pdf.output("arraybuffer"));
    // Vorschaubild der ersten Seite
    const first = canvases()[0];
    const t = document.createElement("canvas");
    t.width = 300;
    t.height = Math.round(300 * PAGE_H / PAGE_W);
    t.getContext("2d").drawImage(first, 0, 0, t.width, t.height);
    const thumbnail = new Uint8Array(await (await new Promise((r) => t.toBlob(r, "image/jpeg", 0.8))).arrayBuffer());
    return G.buildDocument(pages, {
      pagePx: [PAGE_W, PAGE_H],
      pagePt: [595.28, 841.89],
      ink: s.ink,
      background,
      thumbnail,
      title: "Handschrift",
    });
  }

  async function exportGoodnotes() {
    if (!lastRender || !els.text.value.trim()) { els.status.textContent = "Es gibt noch keinen Text."; return; }
    if (!window.jspdf || !window.GoodnotesExport) {
      els.status.textContent = "Goodnotes-Export konnte nicht geladen werden – bitte Seite neu laden.";
      return;
    }
    els.status.textContent = "Goodnotes-Datei wird erstellt …";
    let blob;
    try {
      blob = await buildGoodnotes();
    } catch (e) {
      els.status.textContent = "Goodnotes-Datei konnte nicht erstellt werden: " + (e && e.message ? e.message : e);
      return;
    }
    const file = new File([blob], "handschrift.goodnotes", { type: "application/octet-stream" });
    const shared = await shareOrDownload([file]);
    els.status.textContent = shared
      ? "In Goodnotes öffnen – die Schrift ist dort radierbar und mit dem Lasso verschiebbar."
      : "„handschrift.goodnotes“ heruntergeladen – in Goodnotes über „Importieren“ öffnen.";
  }

  // ---------- KI-Helfer ----------

  function initAi() {
    const KI = window.HandschriftKI;
    const status = $("aiStatus");
    const buttons = ["aiWrite", "aiRewrite", "aiCorrect"].map($);
    const keyInput = $("aiKey");
    let undoText = null;

    const setText = (t) => {
      els.text.value = t;
      updateOutputs();
      scheduleRender();
    };
    const busy = (on) => buttons.forEach((b) => { b.disabled = on; });
    const remember = () => {
      undoText = els.text.value;
      $("aiUndo").hidden = false;
    };

    async function run(label, fn) {
      if (!KI.hasKey()) {
        status.textContent = "Bitte zuerst oben rechts unter „⚙️ KI-Einstellungen“ die KI einrichten.";
        window.openSettings && window.openSettings();
        keyInput.focus();
        return;
      }
      busy(true);
      status.textContent = label;
      try {
        await fn();
      } catch (e) {
        status.textContent = KI.friendlyError(e);
        if (undoText !== null && !els.text.value.trim()) setText(undoText);
      } finally {
        busy(false);
      }
    }

    $("aiWrite").addEventListener("click", () => {
      const prompt = $("aiPrompt").value.trim();
      if (!prompt) { status.textContent = "Schreib oben hinein, was für einen Text du brauchst."; return; }
      run("Die KI schreibt …", async () => {
        remember();
        await KI.writeText(prompt, "", setText);
        status.textContent = "Fertig. Gefällt dir etwas nicht? Schreib oben, was anders sein soll, und tippe auf „Text überarbeiten“.";
      });
    });

    $("aiRewrite").addEventListener("click", () => {
      const prompt = $("aiPrompt").value.trim();
      const current = els.text.value.trim();
      if (!current) { status.textContent = "Es gibt noch keinen Text zum Überarbeiten."; return; }
      if (!prompt) { status.textContent = "Schreib oben hinein, was an deinem Text geändert werden soll (z. B. „kürzer und lustiger“)."; return; }
      run("Die KI überarbeitet deinen Text …", async () => {
        remember();
        await KI.writeText(prompt, current, setText);
        status.textContent = "Text überarbeitet.";
      });
    });

    $("aiCorrect").addEventListener("click", () => {
      const current = els.text.value;
      if (!current.trim()) { status.textContent = "Es gibt noch keinen Text zum Prüfen."; return; }
      run("Prüfe Rechtschreibung …", async () => {
        const res = await KI.correctText(current);
        if (!res.changes.length || res.corrected === current) {
          status.textContent = "Keine Fehler gefunden. 👍";
          return;
        }
        remember();
        setText(res.corrected);
        const list = res.changes.slice(0, 8).map((c) => `${c.original} → ${c.korrektur}`).join(", ");
        status.textContent = `${res.changes.length} Korrektur${res.changes.length > 1 ? "en" : ""}: ${list}${res.changes.length > 8 ? " …" : ""}`;
      });
    });

    // Handschrift abtippen: Foto/PDF einer handgeschriebenen Seite → getippter Text
    const ocrInput = $("aiOcr");
    ocrInput.addEventListener("click", (e) => {
      if (!KI.hasKey()) {
        e.preventDefault();
        status.textContent = "Bitte zuerst oben rechts unter „⚙️ KI-Einstellungen“ einen Schlüssel bzw. die Worker-Adresse eintragen.";
        window.openSettings && window.openSettings();
      }
    });
    ocrInput.addEventListener("change", async () => {
      const file = ocrInput.files[0];
      ocrInput.value = "";
      if (!file) return;
      busy(true);
      $("aiOcrBtn").classList.add("disabled");
      status.textContent = "Die KI liest die Handschrift … das kann bis zu einer Minute dauern.";
      try {
        const pages = await window.HandschriftVorlage.fileToCanvases(file);
        const src = pages[0].canvas;
        const s = Math.min(1, 1600 / Math.max(src.width, src.height));
        const c = document.createElement("canvas");
        c.width = Math.round(src.width * s);
        c.height = Math.round(src.height * s);
        const cx = c.getContext("2d");
        cx.fillStyle = "#fff";
        cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(src, 0, 0, c.width, c.height);
        const text = await KI.readText(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
        if (!text) throw new Error("Auf dem Bild wurde kein Text erkannt.");
        remember();
        const current = els.text.value.trim();
        setText(current ? current + "\n\n" + text : text);
        status.textContent = (current ? "Abgetippter Text wurde unten angehängt." : "Text abgetippt.") +
          " Bitte kurz prüfen – [?] markiert unleserliche Wörter." + (pages.length > 1 ? " Bei PDFs wird nur die erste Seite gelesen." : "");
      } catch (e) {
        status.textContent = KI.friendlyError(e);
      } finally {
        busy(false);
        $("aiOcrBtn").classList.remove("disabled");
      }
    });

    $("aiUndo").addEventListener("click", () => {
      if (undoText === null) return;
      setText(undoText);
      undoText = null;
      $("aiUndo").hidden = true;
      status.textContent = "Rückgängig gemacht.";
    });

    // Meldungen der KI-Einstellungen erscheinen im Einstellungs-Fenster
    const setMsg = $("aiSetStatus");
    const MASK = "••••••••••••";
    const providerSel = $("aiProvider");
    const modelSel = $("aiModel");
    const HINTS = {
      gemini:
        'Einen kostenlosen Schlüssel bekommst du mit einem Google-Konto auf ' +
        '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. ' +
        "Der kostenlose Zugang hat Grenzen pro Minute und Tag; Google darf dabei Eingaben zur Verbesserung seiner Dienste verwenden. ",
      claude:
        'Einen Schlüssel bekommst du auf <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. ' +
        "Die Nutzung wird pro Anfrage abgerechnet (meist ein paar Cent). ",
      cloudflare:
        "Trage die Adresse deines Cloudflare Workers ein (z. B. https://umwandeln.dein-name.workers.dev). " +
        "Der Worker braucht das Binding „AI“ (Workers AI) und den Code aus cloudflare-worker/worker.js im Repository. " +
        "Kostenlos im Tageskontingent von Cloudflare. Alle Funktionen gehen damit; beim Lesen von " +
        "Handschrift sind Gemini und Claude aber genauer.",
    };
    const COMMON_KEY = "Der Schlüssel wird nur in diesem Browser gespeichert und direkt an den Anbieter geschickt – benutze die KI-Funktionen nur auf deinen eigenen Geräten.";

    async function loadModels() {
      if (KI.getProvider() !== "gemini" || !KI.getKey("gemini")) return;
      try {
        const models = await KI.listGeminiModels();
        const chosen = KI.getGeminiModel();
        const auto = KI.getWorkingGeminiModel() || KI.pickGeminiModel(models);
        modelSel.innerHTML = "";
        modelSel.add(new Option(`Automatisch (${auto})`, ""));
        for (const m of models) modelSel.add(new Option(`${m.label} (${m.id})`, m.id));
        modelSel.value = models.some((m) => m.id === chosen) ? chosen : "";
      } catch (e) {
        setMsg.textContent = KI.friendlyError(e);
      }
    }

    function showProvider() {
      const p = KI.getProvider();
      providerSel.value = p;
      const isWorker = p === "cloudflare";
      $("aiKeyLabel").textContent = { gemini: "Gemini-API-Schlüssel", claude: "Claude-API-Schlüssel (Anthropic)", cloudflare: "Adresse deines Workers" }[p];
      keyInput.placeholder = { gemini: "AIza…", claude: "sk-ant-…", cloudflare: "https://umwandeln.….workers.dev" }[p];
      // Die Worker-Adresse ist kein Geheimnis und wird lesbar angezeigt
      keyInput.type = isWorker ? "url" : "password";
      keyInput.value = isWorker ? KI.getKey(p) : (KI.getKey(p) ? MASK : "");
      $("aiModelField").hidden = p !== "gemini";
      $("aiKeyHint").innerHTML = HINTS[p] + (isWorker ? "" : COMMON_KEY);
      loadModels();
    }

    providerSel.addEventListener("change", () => {
      KI.setProvider(providerSel.value);
      setMsg.textContent = "";
      showProvider();
    });
    modelSel.addEventListener("change", () => KI.setGeminiModel(modelSel.value));
    function saveKey(quiet) {
      let key = keyInput.value.trim().replace(/\s+/g, "");
      if (!key || key === MASK) {
        if (!quiet) setMsg.textContent = "Bitte einen Schlüssel einfügen.";
        return false;
      }
      if (KI.getProvider() === "cloudflare") {
        if (!/^https?:\/\//i.test(key)) key = "https://" + key;
        KI.setKey("cloudflare", key);
        keyInput.value = key;
        setMsg.textContent = "Adresse gespeichert. Tippe auf „Verbindung testen“, um den Worker zu prüfen.";
        return true;
      }
      KI.setKey(KI.getProvider(), key);
      keyInput.value = MASK;
      setMsg.textContent = "Schlüssel gespeichert. Tippe auf „Verbindung testen“, um ihn zu prüfen.";
      loadModels();
      return true;
    }
    $("aiKeySave").addEventListener("click", () => saveKey(false));
    // Eingefügter Schlüssel wird auch ohne „Speichern“ übernommen
    keyInput.addEventListener("change", () => saveKey(true));

    $("aiTest").addEventListener("click", async () => {
      if (keyInput.value.trim() && keyInput.value !== MASK && keyInput.value.trim() !== KI.getKey()) saveKey(true);
      if (!KI.hasKey()) { setMsg.textContent = "Bitte zuerst einen Schlüssel einfügen."; return; }
      const btn = $("aiTest");
      btn.disabled = true;
      setMsg.textContent = "Teste Verbindung …";
      try {
        const { model, reply } = await KI.test();
        setMsg.textContent = `✅ Verbindung klappt (Modell: ${model}, Antwort: „${reply.slice(0, 40)}“).`;
        if (KI.getProvider() === "gemini") loadModels();
      } catch (e) {
        setMsg.textContent = "❌ " + KI.friendlyError(e);
      } finally {
        btn.disabled = false;
      }
    });
    $("aiKeyDelete").addEventListener("click", () => {
      KI.setKey(KI.getProvider(), "");
      keyInput.value = "";
      setMsg.textContent = "Schlüssel gelöscht.";
    });
    showProvider();
    keyInput.addEventListener("focus", () => { if (keyInput.value === MASK) keyInput.value = ""; });
  }

  // ---------- Events ----------

  function init() {
    buildTiles();
    load();
    updateOutputs();

    window.Handschrift.init();
    window.Handschrift.onChange(() => {
      if (window.HandschriftSynth) window.HandschriftSynth.invalidate();
      scheduleRender();
    });
    // Schnellwechsel der Handschrift im Hauptbereich
    const profileSelect = $("profileSelect");
    const refreshProfiles = () => {
      window.Handschrift.fillProfileSelect(profileSelect);
      updateOutputs();
    };
    window.Handschrift.onProfiles(refreshProfiles);
    refreshProfiles();
    profileSelect.addEventListener("change", () => window.Handschrift.switchProfile(profileSelect.value));

    window.HandschriftVorlage.init();
    window.HandschriftScan.init();
    initAi();
    window.Diktat.attach({
      button: $("textDictate"),
      textarea: els.text,
      select: $("textDictLang"),
      say: (msg, kind) => {
        const h = $("textHint");
        h.textContent = msg || "";
        h.classList.toggle("error", kind === "error");
      },
    });

    for (const el of [els.text, els.font, els.paper, els.size, els.line, els.mess, els.spacing, els.word, els.pen, els.margin, els.synth, els.synthBase]) {
      el.addEventListener("input", () => { updateOutputs(); scheduleRender(); });
      el.addEventListener("change", () => { updateOutputs(); scheduleRender(); });
    }

    els.swatches.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-color]");
      if (!b) return;
      state.ink = b.dataset.color;
      updateOutputs();
      scheduleRender();
    });
    els.color.addEventListener("input", () => {
      state.ink = els.color.value;
      updateOutputs();
      scheduleRender();
    });

    $("shuffle").addEventListener("click", () => {
      state.seed = Math.floor(Math.random() * 1e9);
      render();
    });
    $("png").addEventListener("click", exportPng);
    $("transparentBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = $("transparentMenu");
      menu.hidden = !menu.hidden;
      $("transparentBtn").setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!$("transparentMenu").hidden && !e.target.closest(".menu-wrap")) closeTransparentMenu();
    });
    for (const b of document.querySelectorAll("#transparentMenu [data-mode]")) {
      b.addEventListener("click", () => exportTransparent(b.dataset.mode));
    }
    $("pdf").addEventListener("click", exportPdf);
    $("print").addEventListener("click", () => window.print());
    $("share").addEventListener("click", sharePdf);
    $("goodnotes").addEventListener("click", exportGoodnotes);
    $("openEditor").addEventListener("click", () => window.Handschrift.open());
    window.Handschrift.onClose(() => {
      if (window.Handschrift.count() && els.font.value !== CUSTOM) {
        els.font.value = CUSTOM;
        updateOutputs();
      }
      scheduleRender();
    });

    render();
    // Falls Webfonts erst später fertig sind, nochmal zeichnen
    document.fonts.ready.then(render);
  }

  init();

  // Für andere Bereiche, z. B. den Übersetzer: Text in den Handschrift-Umwandler übernehmen
  window.TextUmwandler = {
    setText(t) {
      els.text.value = t;
      updateOutputs();
      scheduleRender();
    },
  };
})();
