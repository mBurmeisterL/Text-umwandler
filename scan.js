// Beliebige Handschrift-Seite einlesen: Tinte in einzelne Stücke zerlegen, die KI benennt die Zeichen,
// in einer Kontrollansicht kann man die Ergebnisse prüfen und übernehmen.
(() => {
  "use strict";

  const WORK_MAX = 1800;       // Arbeitsauflösung (längste Seite in px)
  const MAX_ITEMS = 360;
  const CELL = 80, SHEET_COLS = 12, SHEET_MAX = 120;
  const X_HEIGHT_EM = 0.42;    // wie im Zeichenfeld
  const SHORT_LOWER = "acemnorsuvwxz";
  const DESCENDERS = "gjpqyß,;";

  const H = () => window.Handschrift;
  const $ = (id) => document.getElementById(id);

  // ---------- Zerlegen ----------

  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function segment(source) {
    const scale = Math.min(1, WORK_MAX / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const W = canvas.width, Hh = canvas.height;
    const d = ctx.getImageData(0, 0, W, Hh).data;
    const lum = new Float32Array(W * Hh);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];

    // Papierhelligkeit blockweise schätzen (gleicht ungleichmäßiges Licht auf Fotos aus)
    const B = 48;
    const bw = Math.ceil(W / B), bh = Math.ceil(Hh / B);
    const paperBlocks = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const vals = [];
        for (let y = by * B; y < Math.min(Hh, (by + 1) * B); y += 3) {
          for (let x = bx * B; x < Math.min(W, (bx + 1) * B); x += 3) vals.push(lum[y * W + x]);
        }
        vals.sort((a, b) => a - b);
        paperBlocks[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] || 255;
      }
    }

    const alpha = new Float32Array(W * Hh);
    const ink = new Uint8Array(W * Hh);
    for (let y = 0; y < Hh; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const paper = Math.max(90, paperBlocks[Math.floor(y / B) * bw + Math.floor(x / B)]);
        const hi = paper * 0.62, lo = paper * 0.25;
        const a = Math.max(0, Math.min(1, (hi - lum[i]) / (hi - lo)));
        alpha[i] = a;
        ink[i] = a > 0.35 ? 1 : 0;
      }
    }

    // Zusammenhängende Tintenflächen (8er-Nachbarschaft)
    const label = new Int32Array(W * Hh);
    const comps = [];
    const stack = [];
    for (let start = 0; start < ink.length; start++) {
      if (!ink[start] || label[start]) continue;
      const id = comps.length + 1;
      const c = { id, minX: W, maxX: 0, minY: Hh, maxY: 0, area: 0 };
      label[start] = id;
      stack.push(start);
      while (stack.length) {
        const k = stack.pop();
        const kx = k % W, ky = (k - kx) / W;
        c.area++;
        if (kx < c.minX) c.minX = kx; if (kx > c.maxX) c.maxX = kx;
        if (ky < c.minY) c.minY = ky; if (ky > c.maxY) c.maxY = ky;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = ky + dy;
          if (ny < 0 || ny >= Hh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = kx + dx;
            if (nx < 0 || nx >= W) continue;
            const q = ny * W + nx;
            if (ink[q] && !label[q]) { label[q] = id; stack.push(q); }
          }
        }
      }
      comps.push(c);
    }

    // Rauschen, Linien, Ränder und große Flächen aussortieren
    const minArea = Math.max(6, (W * Hh) / 400000);
    let parts = comps.filter((c) => {
      const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
      return c.area >= minArea && w < W * 0.3 && h < Hh * 0.25 && !(w > 12 * h && w > 60);
    });
    const medH = median(parts.filter((c) => c.area >= minArea * 4).map((c) => c.maxY - c.minY + 1)) || 20;

    // Teile zu Zeichen zusammenfassen (i-Punkte, Umlaute, unterbrochene Striche)
    let groups = parts.map((c) => ({ ids: [c.id], minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY }));
    const width = (g) => g.maxX - g.minX + 1;
    const height = (g) => g.maxY - g.minY + 1;
    let merged = true;
    while (merged) {
      merged = false;
      outer:
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          const A = groups[a], Bg = groups[b];
          const overlap = Math.min(A.maxX, Bg.maxX) - Math.max(A.minX, Bg.minX) + 1;
          if (overlap <= 0) continue;
          const gap = Math.max(A.minY, Bg.minY) - Math.min(A.maxY, Bg.maxY);
          if (gap > medH * 0.7) continue;
          const small = height(A) < medH * 0.45 || height(Bg) < medH * 0.45;
          if (overlap > 0.5 * Math.min(width(A), width(Bg)) || (small && overlap > 0)) {
            groups[a] = {
              ids: A.ids.concat(Bg.ids),
              minX: Math.min(A.minX, Bg.minX), maxX: Math.max(A.maxX, Bg.maxX),
              minY: Math.min(A.minY, Bg.minY), maxY: Math.max(A.maxY, Bg.maxY),
            };
            groups.splice(b, 1);
            merged = true;
            break outer;
          }
        }
      }
    }

    // Zeilen bilden und in Lesereihenfolge bringen
    groups.sort((a, b) => (a.minY + a.maxY) - (b.minY + b.maxY));
    const lines = [];
    for (const g of groups) {
      const cy = (g.minY + g.maxY) / 2;
      const line = lines.find((l) => Math.abs(l.cy - cy) < medH * 0.6);
      if (line) {
        line.items.push(g);
        line.cy = line.items.reduce((s, x) => s + (x.minY + x.maxY) / 2, 0) / line.items.length;
      } else {
        lines.push({ cy, items: [g] });
      }
    }
    lines.sort((a, b) => a.cy - b.cy);
    const items = [];
    lines.forEach((l, li) => {
      l.items.sort((a, b) => a.minX - b.minX);
      for (const g of l.items) {
        if (items.length >= MAX_ITEMS) return;
        g.line = li;
        g.id = items.length + 1;
        items.push(g);
      }
    });

    return { canvas, W, H: Hh, alpha, label, items, lineCount: lines.length, medH, truncated: groups.length > items.length };
  }

  // ---------- Bilder für die KI ----------

  function jpegBase64(canvas, quality = 0.82) {
    return canvas.toDataURL("image/jpeg", quality).split(",")[1];
  }

  function pageImage(seg) {
    const s = Math.min(1, 1568 / Math.max(seg.W, seg.H));
    const c = document.createElement("canvas");
    c.width = Math.round(seg.W * s);
    c.height = Math.round(seg.H * s);
    c.getContext("2d").drawImage(seg.canvas, 0, 0, c.width, c.height);
    return jpegBase64(c);
  }

  function contactSheets(seg) {
    const sheets = [];
    for (let start = 0; start < seg.items.length; start += SHEET_MAX) {
      const chunk = seg.items.slice(start, start + SHEET_MAX);
      const rows = Math.ceil(chunk.length / SHEET_COLS);
      const c = document.createElement("canvas");
      c.width = SHEET_COLS * CELL;
      c.height = rows * CELL;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      chunk.forEach((g, i) => {
        const cx = (i % SHEET_COLS) * CELL, cy = Math.floor(i / SHEET_COLS) * CELL;
        const pad = 4, top = 16;
        const w = g.maxX - g.minX + 1, h = g.maxY - g.minY + 1;
        const s = Math.min((CELL - 2 * pad) / w, (CELL - top - pad) / h, 3);
        ctx.drawImage(seg.canvas, g.minX, g.minY, w, h,
          cx + (CELL - w * s) / 2, cy + top + (CELL - top - pad - h * s) / 2, w * s, h * s);
        ctx.strokeStyle = "#ddd";
        ctx.strokeRect(cx + 0.5, cy + 0.5, CELL - 1, CELL - 1);
        ctx.fillStyle = "#d00";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(String(g.id), cx + 3, cy + 13);
      });
      sheets.push(jpegBase64(c, 0.85));
    }
    return sheets;
  }

  function lineSummary(seg) {
    const byLine = [];
    for (const g of seg.items) (byLine[g.line] = byLine[g.line] || []).push(g.id);
    return byLine.filter(Boolean).map((ids, i) => `Zeile ${i + 1}: Nr. ${ids[0]} bis ${ids[ids.length - 1]}`).join("\n");
  }

  // ---------- Zeichen erzeugen ----------

  function buildGlyphs(seg, labels) {
    const byId = new Map(labels.map((l) => [l.id, typeof l.char === "string" ? l.char : ""]));
    for (const g of seg.items) g.char = [...(byId.get(g.id) || "")].length === 1 ? byId.get(g.id) : "";

    // Maßstab aus der Höhe kurzer Kleinbuchstaben, Grundlinie pro Zeile
    const short = seg.items.filter((g) => g.char && SHORT_LOWER.includes(g.char));
    const xh = median(short.map((g) => g.maxY - g.minY + 1)) || seg.medH * 0.6;
    const em = xh / X_HEIGHT_EM;
    const baselines = [];
    for (let li = 0; li < seg.lineCount; li++) {
      const inLine = seg.items.filter((g) => g.line === li);
      const ref = inLine.filter((g) => g.char && SHORT_LOWER.includes(g.char));
      const base = ref.length ? ref : inLine.filter((g) => !DESCENDERS.includes(g.char));
      baselines[li] = median((base.length ? base : inLine).map((g) => g.maxY + 1));
    }

    const stamp = Date.now();
    return seg.items.map((g) => {
      const pad = 2;
      const x0 = Math.max(0, g.minX - pad), y0 = Math.max(0, g.minY - pad);
      const x1 = Math.min(seg.W, g.maxX + pad + 1), y1 = Math.min(seg.H, g.maxY + pad + 1);
      const c = document.createElement("canvas");
      c.width = x1 - x0;
      c.height = y1 - y0;
      const ctx = c.getContext("2d");
      const out = ctx.createImageData(c.width, c.height);
      const ids = new Set(g.ids);
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y + y0) * seg.W + (x + x0);
          // nur Tinte dieses Zeichens (plus weiche Kanten direkt daneben)
          const own = ids.has(seg.label[i]) || (!seg.label[i] && near(seg, ids, x + x0, y + y0));
          if (own) out.data[(y * c.width + x) * 4 + 3] = seg.alpha[i] * 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      const r = (v) => Math.round(v * 1000) / 1000;
      return {
        id: g.id,
        char: g.char,
        glyph: {
          s: [],
          img: c.toDataURL("image/png"),
          bx: 0, by: r((y0 - baselines[g.line]) / em), bw: r(c.width / em), bh: r(c.height / em),
          l: r((g.minX - x0) / em), w: r(Math.max(0.05, (g.maxX - g.minX + 1) / em)),
          src: `ki-${stamp}-${g.id}`,
        },
      };
    });
  }

  function near(seg, ids, x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= seg.W || ny >= seg.H) continue;
        if (ids.has(seg.label[ny * seg.W + nx])) return true;
      }
    }
    return false;
  }

  // ---------- Kontrollansicht ----------

  let pending = [];

  function card(r) {
    const el = document.createElement("label");
    el.className = "ai-card" + (r.char ? "" : " unknown");
    const img = document.createElement("img");
    img.src = r.glyph.img;
    img.alt = "";
    const row = document.createElement("span");
    row.className = "ai-card-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!r.char;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 2;
    input.value = r.char;
    input.setAttribute("aria-label", "Zeichen");
    const sync = () => { r.use = cb.checked && !!r.char; };
    input.addEventListener("input", () => {
      r.char = [...input.value.trim()][0] || "";
      cb.checked = !!r.char;
      el.classList.toggle("unknown", !r.char);
      sync();
    });
    cb.addEventListener("change", sync);
    sync();
    row.append(cb, input);
    el.append(img, row);
    return el;
  }

  function showReview(results, info) {
    pending = results;
    const known = results.filter((r) => r.char).sort((a, b) => a.char.localeCompare(b.char, "de") || a.id - b.id);
    const unknown = results.filter((r) => !r.char);
    const grid = $("aiReviewGrid");
    const rest = $("aiReviewRest");
    grid.innerHTML = "";
    rest.innerHTML = "";
    known.forEach((r) => grid.appendChild(card(r)));
    unknown.forEach((r) => rest.appendChild(card(r)));
    $("aiReviewRestBox").hidden = !unknown.length;
    $("aiReviewRestCount").textContent = unknown.length;
    $("aiReviewInfo").textContent = info;
    $("aiReview").hidden = false;
  }

  function closeReview() {
    $("aiReview").hidden = true;
    pending = [];
  }

  function acceptReview() {
    const list = pending
      .filter((r) => r.use && r.char)
      .map((r) => ({ ch: r.char, glyph: r.glyph }));
    closeReview();
    if (!list.length) { H().setStatus("Keine Zeichen übernommen."); return; }
    const ok = H().importGlyphs(list);
    const chars = new Set(list.map((x) => x.ch)).size;
    H().setStatus(ok
      ? `${list.length} Zeichen (${chars} verschiedene) aus deiner Handschrift übernommen.`
      : "Speicher voll – bitte „Sichern“ benutzen und alte Varianten löschen.");
  }

  // ---------- Ablauf ----------

  async function scanFile(file) {
    const KI = window.HandschriftKI;
    const status = H().setStatus;
    if (!KI.hasKey()) {
      status("Für das Lesen beliebiger Seiten bitte zuerst im Hauptfenster unter „KI-Helfer → KI-Einstellungen“ einen API-Schlüssel eintragen.");
      return;
    }
    try {
      status("Lese Seite …");
      const pages = await window.HandschriftVorlage.fileToCanvases(file);
      const { canvas } = pages[0];
      status("Suche Buchstaben auf der Seite …");
      await new Promise((r) => setTimeout(r, 30));
      const seg = segment(canvas);
      if (!seg.items.length) { status("Auf der Seite wurde keine Schrift gefunden."); return; }
      status(`${seg.items.length} Schriftstücke gefunden – die KI liest jetzt die Seite (das dauert etwas) …`);
      const labels = await KI.labelGlyphs(pageImage(seg), contactSheets(seg), lineSummary(seg), seg.items.length);
      const results = buildGlyphs(seg, labels);
      const recognized = results.filter((r) => r.char).length;
      let info = `${recognized} von ${results.length} Stücken als einzelnes Zeichen erkannt.`;
      if (recognized < results.length / 2) info += " Zusammenhängende Schreibschrift lässt sich schlecht in Buchstaben zerlegen – Druckschrift funktioniert besser.";
      if (seg.truncated) info += ` Es wurden nur die ersten ${MAX_ITEMS} Stücke ausgewertet.`;
      if (pages.length > 1) info += " Bei PDFs wird nur die erste Seite gelesen.";
      status("");
      showReview(results, info);
    } catch (e) {
      status(KI.friendlyError(e));
    }
  }

  function init() {
    $("aiScan").addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) scanFile(f);
    });
    $("aiReviewOk").addEventListener("click", acceptReview);
    $("aiReviewCancel").addEventListener("click", closeReview);
  }

  window.HandschriftScan = { init, segment, scanFile };
})();
