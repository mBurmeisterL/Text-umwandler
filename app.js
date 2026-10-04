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
    if (typeof s.margin === "boolean") els.margin.checked = s.margin;
    if (typeof s.ink === "string") state.ink = s.ink;
  }

  function updateOutputs() {
    $("sizeOut").textContent = els.size.value + " px";
    $("lineOut").textContent = els.line.value + " px";
    $("messOut").textContent = els.mess.value;
    $("spacingOut").textContent = els.spacing.value;
    $("wordOut").textContent = els.word.value;
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

  function wordWidth(ctx, word, s) {
    return ctx.measureText(word).width + s.spacing * word.length;
  }

  function wrap(ctx, s) {
    const maxW = TEXT_RIGHT - TEXT_LEFT;
    const spaceW = ctx.measureText(" ").width + s.word;
    const lines = [];
    const paragraphs = s.text.replace(/\r/g, "").replace(/\t/g, "    ").split("\n");

    for (const para of paragraphs) {
      const words = para.split(/ +/).filter(Boolean);
      if (!words.length) { lines.push([]); continue; }

      let cur = [];
      let curW = 0;
      for (let w of words) {
        // Überlange Wörter zerlegen
        while (wordWidth(ctx, w, s) > maxW) {
          let cut = w.length - 1;
          while (cut > 1 && wordWidth(ctx, w.slice(0, cut) + "-", s) > maxW) cut--;
          if (cur.length) { lines.push(cur); cur = []; curW = 0; }
          lines.push([w.slice(0, cut) + "-"]);
          w = w.slice(cut);
        }
        const ww = wordWidth(ctx, w, s);
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
    }
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

  function fontString(s, size) {
    return `${size}px "${s.font}", cursive`;
  }

  function drawLine(ctx, words, baseY, s, rnd) {
    const m = s.mess / 10; // 0..1
    const scale = s.size / 46;
    const slope = (rnd() - 0.5) * 0.012 * m;            // leichte Schräglage der Zeile
    const waveAmp = rnd() * 3 * m * scale;               // sanfte Wellenbewegung
    const wavePhase = rnd() * Math.PI * 2;
    const waveLen = 300 + rnd() * 400;
    let x = TEXT_LEFT + (rnd() - 0.3) * 14 * m;
    const spaceW = ctx.measureText(" ").width + s.word;

    for (const word of words) {
      const wordScale = 1 + (rnd() - 0.5) * 0.06 * m;
      const chars = [...word];
      let prefix = "";
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        // Position über das Präfix messen, damit Kerning der Schrift erhalten bleibt
        const cx = x + ctx.measureText(prefix).width + i * s.spacing;
        prefix += ch;
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
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
      x += wordWidth(ctx, word, s) + spaceW + (rnd() - 0.5) * 8 * m * scale;
    }
  }

  // ---------- Rendern ----------

  let renderToken = 0;

  async function render() {
    const token = ++renderToken;
    const s = settings();
    try {
      await document.fonts.load(fontString(s, s.size), "AaÄäÖöÜüß");
    } catch (_) { /* Fallback-Schrift wird verwendet */ }
    if (token !== renderToken) return;

    const measure = document.createElement("canvas").getContext("2d");
    measure.font = fontString(s, s.size);
    const lines = wrap(measure, s);

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

      ctx.font = fontString(s, s.size);
      ctx.fillStyle = s.ink;
      ctx.textBaseline = "alphabetic";

      const pageLines = lines.slice(p * linesPerPage, (p + 1) * linesPerPage);
      pageLines.forEach((words, i) => {
        const baseY = MARGIN_TOP + s.line * (i + 1) - Math.max(2, s.size * 0.06);
        drawLine(ctx, words, baseY, s, rngFor(state.seed, p, i));
      });
    }

    els.status.textContent = pageCount === 1 ? "1 Seite" : `${pageCount} Seiten`;
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

  function exportPdf() {
    if (!window.jspdf) {
      els.status.textContent = "PDF-Bibliothek konnte nicht geladen werden – bitte „Drucken“ → „Als PDF speichern“ nutzen.";
      return;
    }
    const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    canvases().forEach((c, i) => {
      if (i > 0) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    });
    pdf.save("handschrift.pdf");
  }

  // ---------- Events ----------

  function init() {
    load();
    updateOutputs();

    for (const el of [els.text, els.font, els.paper, els.size, els.line, els.mess, els.spacing, els.word, els.margin]) {
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
    $("pdf").addEventListener("click", exportPdf);
    $("print").addEventListener("click", () => window.print());

    render();
    // Falls Webfonts erst später fertig sind, nochmal zeichnen
    document.fonts.ready.then(render);
  }

  init();
})();
