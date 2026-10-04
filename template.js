// Handschrift-Vorlage: PDF mit Kästchen erzeugen und ausgefüllte Seiten (Bild/PDF/Foto) einlesen.
// Vier schwarze Eck-Markierungen erlauben das Entzerren, ein kleiner Code oben die Seitenerkennung.
(() => {
  "use strict";

  // ---------- Layout der Vorlage (mm, A4) ----------

  const MARK = 8;
  const MARKERS = [[10, 10], [192, 10], [10, 279], [192, 279]];
  const MARK_CENTERS = MARKERS.map(([x, y]) => [x + MARK / 2, y + MARK / 2]);
  const CODE = { x: 87, y: 12, size: 4, step: 9, bits: 4 };

  const SLOTS = 3;               // Varianten pro Zeichen
  const GROUPS_PER_ROW = 2;
  const GRID_X = 16, GRID_Y = 38, GRID_W = 178, GRID_BOTTOM = 276;
  const IN_GAP = 1.2, GROUP_GAP = 4, LABEL_H = 4, ROW_GAP = 2;
  const BOX_W = (GRID_W - (GROUPS_PER_ROW - 1) * GROUP_GAP - GROUPS_PER_ROW * (SLOTS - 1) * IN_GAP) / (GROUPS_PER_ROW * SLOTS);
  const BOX_H = BOX_W * 0.8;     // gleiches Seitenverhältnis wie das Zeichenfeld (2.0 × 1.6 em)
  const ROW_H = LABEL_H + BOX_H + ROW_GAP;
  const ROWS = Math.floor((GRID_BOTTOM - GRID_Y) / ROW_H);
  const PER_PAGE = ROWS * GROUPS_PER_ROW;

  const EM_PX = 80;              // Auflösung beim Ausschneiden
  const BOX_PX_W = Math.round(2.0 * EM_PX);
  const BOX_PX_H = Math.round(1.6 * EM_PX);

  const H = () => window.Handschrift;

  function pageCount() {
    return Math.ceil(H().CHARS.length / PER_PAGE);
  }

  function boxRect(index) {
    const row = Math.floor(index / (GROUPS_PER_ROW * SLOTS));
    const col = index % (GROUPS_PER_ROW * SLOTS);
    const group = Math.floor(col / SLOTS);
    const slot = col % SLOTS;
    const x = GRID_X + group * (SLOTS * BOX_W + (SLOTS - 1) * IN_GAP + GROUP_GAP) + slot * (BOX_W + IN_GAP);
    const y = GRID_Y + row * ROW_H + LABEL_H;
    return { x, y };
  }

  // Alle Kästchen einer Seite: { ch, slot, x, y }
  function pageBoxes(page) {
    const chars = H().CHARS.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    const out = [];
    chars.forEach((ch, ci) => {
      for (let slot = 0; slot < SLOTS; slot++) {
        out.push({ ch, slot, ...boxRect(ci * SLOTS + slot) });
      }
    });
    return out;
  }

  // ---------- Vorlage erzeugen ----------

  function buildTemplate() {
    const pdf = new window.jspdf.jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pad = H().PAD;
    const total = pageCount();
    const yFor = (em) => (em - pad.top) / pad.height * BOX_H;

    for (let p = 0; p < total; p++) {
      if (p > 0) pdf.addPage();

      pdf.setFillColor(0, 0, 0);
      for (const [x, y] of MARKERS) pdf.rect(x, y, MARK, MARK, "F");

      const code = p + 1;
      pdf.setLineWidth(0.2);
      pdf.setDrawColor(215, 215, 215);
      for (let i = 0; i < CODE.bits; i++) {
        const x = CODE.x + i * CODE.step;
        if ((code >> i) & 1) pdf.rect(x, CODE.y, CODE.size, CODE.size, "F");
        else pdf.rect(x, CODE.y, CODE.size, CODE.size, "S");
      }

      pdf.setTextColor(60, 60, 60);
      pdf.setFontSize(11);
      pdf.text(`Handschrift-Vorlage – Seite ${p + 1} von ${total}`, 105, 26, { align: "center" });
      pdf.setFontSize(7.5);
      pdf.setTextColor(110, 110, 110);
      pdf.text("Jedes Zeichen 3× schreiben, dunkle Farbe, auf der durchgezogenen Linie. Ecken-Markierungen frei lassen.", 105, 31, { align: "center" });

      for (const b of pageBoxes(p)) {
        if (b.slot === 0) {
          pdf.setFontSize(9);
          pdf.setTextColor(120, 120, 120);
          pdf.text(b.ch, b.x + 0.5, b.y - 1);
        }
        pdf.setLineDashPattern([], 0);
        pdf.setLineWidth(0.25);
        pdf.setDrawColor(185, 200, 228);
        pdf.rect(b.x, b.y, BOX_W, BOX_H, "S");
        for (const g of pad.guides) {
          const y = b.y + yFor(g.y);
          if (g.strong) {
            pdf.setDrawColor(170, 190, 228);
            pdf.setLineDashPattern([], 0);
            pdf.setLineWidth(0.3);
          } else {
            pdf.setDrawColor(208, 218, 240);
            pdf.setLineDashPattern([1, 1], 0);
            pdf.setLineWidth(0.2);
          }
          pdf.line(b.x, y, b.x + BOX_W, y);
        }
      }
      pdf.setLineDashPattern([], 0);
    }
    return pdf;
  }

  // ---------- Dateien laden ----------

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsPromise) {
      pdfjsPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "vendor/pdfjs/pdf.min.js";
        s.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        };
        s.onerror = () => { pdfjsPromise = null; reject(new Error("PDF-Leser konnte nicht geladen werden")); };
        document.head.appendChild(s);
      });
    }
    return pdfjsPromise;
  }

  async function fileToCanvases(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 2400 / Math.max(base.width, base.height) });
        const c = document.createElement("canvas");
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out.push({ canvas: c, label: `${file.name}, Seite ${i}` });
      }
      return out;
    }

    const url = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      const scale = Math.min(1, 2600 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * scale);
      c.height = Math.round(im.naturalHeight * scale);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0, c.width, c.height);
      return [{ canvas: c, label: file.name }];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- Bildanalyse ----------

  function luminance(canvas) {
    const { width: W, height: Hh } = canvas;
    const d = canvas.getContext("2d").getImageData(0, 0, W, Hh).data;
    const lum = new Uint8ClampedArray(W * Hh);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
      lum[i] = 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
    }
    return { lum, W, H: Hh };
  }

  // Sucht in einer Ecke das schwarze Quadrat (dunkle, kompakte, fast quadratische Fläche)
  function findMarker(img, corner, seen) {
    const { lum, W, H: Hh } = img;
    const rw = Math.round(W * 0.3), rh = Math.round(Hh * 0.3);
    const x0 = corner[0] ? W - rw : 0, y0 = corner[1] ? Hh - rh : 0;
    const cx = corner[0] ? W : 0, cy = corner[1] ? Hh : 0;
    const expected = (MARK / 210) * W;
    const minArea = Math.max(30, (expected * 0.2) ** 2);
    const maxArea = (expected * 3) ** 2;

    // Schwelle relativ zur Papierhelligkeit in der Region
    let sum = 0, n = 0;
    for (let y = y0; y < y0 + rh; y += 7) for (let x = x0; x < x0 + rw; x += 7) { sum += lum[y * W + x]; n++; }
    const thr = Math.min(110, (sum / n) * 0.5);

    let best = null;
    const stack = [];
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = x0; x < x0 + rw; x++) {
        const i = y * W + x;
        if (seen[i] || lum[i] >= thr) continue;
        let area = 0, sx = 0, sy = 0, sl = 0, minX = x, maxX = x, minY = y, maxY = y, overflow = false;
        seen[i] = 1;
        stack.push(i);
        while (stack.length) {
          const k = stack.pop();
          const kx = k % W, ky = (k - kx) / W;
          area++; sx += kx; sy += ky; sl += lum[k];
          if (kx < minX) minX = kx; if (kx > maxX) maxX = kx;
          if (ky < minY) minY = ky; if (ky > maxY) maxY = ky;
          if (area > maxArea) overflow = true;
          const nb = [k - 1, k + 1, k - W, k + W];
          for (let m = 0; m < 4; m++) {
            const q = nb[m];
            if (q < 0 || q >= lum.length) continue;
            const qx = q % W, qy = (q - qx) / W;
            if (Math.abs(qx - kx) > 1 || qx < x0 || qx >= x0 + rw || qy < y0 || qy >= y0 + rh) continue;
            if (!seen[q] && lum[q] < thr) { seen[q] = 1; stack.push(q); }
          }
        }
        if (overflow || area < minArea) continue;
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const aspect = bw / bh;
        const fill = area / (bw * bh);
        if (aspect < 0.5 || aspect > 2 || fill < 0.6) continue;
        if (!surroundedByPaper(img, minX, minY, maxX, maxY, sl / area)) continue;
        const mx = sx / area, my = sy / area;
        const dist = Math.hypot(mx - cx, my - cy);
        // große, nahe an der Ecke liegende Quadrate bevorzugen
        const score = dist / Math.sqrt(area);
        if (!best || score < best.score) best = { x: mx, y: my, score };
      }
    }
    return best;
  }

  // Echte Markierungen liegen frei auf hellem Papier (Tischkanten, Schatten etc. nicht)
  function surroundedByPaper(img, minX, minY, maxX, maxY, inner) {
    const { lum, W, H: Hh } = img;
    const d = Math.max(3, Math.round((maxX - minX + maxY - minY) * 0.25));
    const x0 = minX - d, x1 = maxX + d, y0 = minY - d, y1 = maxY + d;
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= Hh) return false;
    const pts = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / steps), y = Math.round(y0 + (y1 - y0) * i / steps);
      pts.push(lum[y0 * W + x], lum[y1 * W + x], lum[y * W + x0], lum[y * W + x1]);
    }
    const bright = pts.filter((v) => v > inner + 70).length;
    return bright / pts.length > 0.9;
  }

  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // Projektive Abbildung von Vorlagen-mm auf Bildpixel
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h && [...h, 1];
  }

  function project(Hm, x, y) {
    const w = Hm[6] * x + Hm[7] * y + Hm[8];
    return [(Hm[0] * x + Hm[1] * y + Hm[2]) / w, (Hm[3] * x + Hm[4] * y + Hm[5]) / w];
  }

  function sample(img, x, y) {
    const { lum, W, H: Hh } = img;
    if (x < 0 || y < 0 || x >= W - 1 || y >= Hh - 1) return 255;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i = y0 * W + x0;
    return (lum[i] * (1 - fx) + lum[i + 1] * fx) * (1 - fy) + (lum[i + W] * (1 - fx) + lum[i + W + 1] * fx) * fy;
  }

  function meanAround(img, Hm, cx, cy) {
    let s = 0, n = 0;
    for (let dy = -1.2; dy <= 1.2; dy += 0.6) {
      for (let dx = -1.2; dx <= 1.2; dx += 0.6) {
        const [u, v] = project(Hm, cx + dx, cy + dy);
        s += sample(img, u, v); n++;
      }
    }
    return s / n;
  }

  function readPageCode(img, Hm) {
    const cy = CODE.y + CODE.size / 2;
    // Papierhelligkeit zwischen den Code-Feldern als Vergleich
    let paper = 0;
    for (let i = 0; i < CODE.bits; i++) paper += meanAround(img, Hm, CODE.x + i * CODE.step + CODE.size + (CODE.step - CODE.size) / 2, cy);
    paper /= CODE.bits;
    let code = 0;
    for (let i = 0; i < CODE.bits; i++) {
      if (meanAround(img, Hm, CODE.x + i * CODE.step + CODE.size / 2, cy) < paper * 0.5) code |= 1 << i;
    }
    return code;
  }

  // Schneidet ein Kästchen aus und macht daraus eine Alpha-Maske
  function extractBox(img, Hm, box, page) {
    const vals = new Float32Array(BOX_PX_W * BOX_PX_H);
    const insetX = BOX_PX_W * 0.04, insetY = BOX_PX_H * 0.05;
    const sorted = [];
    for (let j = 0; j < BOX_PX_H; j++) {
      for (let i = 0; i < BOX_PX_W; i++) {
        let v = 255;
        if (i >= insetX && i < BOX_PX_W - insetX && j >= insetY && j < BOX_PX_H - insetY) {
          const [u, w] = project(Hm, box.x + ((i + 0.5) / BOX_PX_W) * BOX_W, box.y + ((j + 0.5) / BOX_PX_H) * BOX_H);
          v = sample(img, u, w);
          if ((i + j) % 3 === 0) sorted.push(v);
        }
        vals[j * BOX_PX_W + i] = v;
      }
    }
    sorted.sort((a, b) => a - b);
    const paper = sorted[Math.floor(sorted.length * 0.85)] || 255;
    const hi = paper * 0.62, lo = paper * 0.25;

    const alpha = new Uint8ClampedArray(vals.length);
    let count = 0, minX = BOX_PX_W, maxX = -1, minY = BOX_PX_H, maxY = -1;
    for (let k = 0; k < vals.length; k++) {
      const a = Math.max(0, Math.min(1, (hi - vals[k]) / (hi - lo)));
      alpha[k] = a * 255;
      if (a > 0.15) {
        const x = k % BOX_PX_W, y = (k - x) / BOX_PX_W;
        if (a > 0.5) count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (count < 25) return null; // leeres Kästchen

    const padPx = 2;
    const x0 = Math.max(0, minX - padPx), y0 = Math.max(0, minY - padPx);
    const x1 = Math.min(BOX_PX_W, maxX + padPx + 1), y1 = Math.min(BOX_PX_H, maxY + padPx + 1);
    const c = document.createElement("canvas");
    c.width = x1 - x0;
    c.height = y1 - y0;
    const ctx = c.getContext("2d");
    const out = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        out.data[(y * c.width + x) * 4 + 3] = alpha[(y + y0) * BOX_PX_W + (x + x0)];
      }
    }
    ctx.putImageData(out, 0, 0);

    const top = H().PAD.top;
    const r = (v) => Math.round(v * 1000) / 1000;
    return {
      s: [],
      img: c.toDataURL("image/png"),
      bx: r(x0 / EM_PX), by: r(y0 / EM_PX + top), bw: r(c.width / EM_PX), bh: r(c.height / EM_PX),
      l: r(minX / EM_PX), w: r(Math.max(0.05, (maxX - minX + 1) / EM_PX)),
      src: `vorlage-${page}-${box.ch}-${box.slot}`,
    };
  }

  function analyzeCanvas(canvas) {
    const img = luminance(canvas);
    const seen = new Uint8Array(img.W * img.H);
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const found = corners.map((c) => findMarker(img, c, seen));
    if (found.some((f) => !f)) {
      throw new Error("Die vier schwarzen Ecken-Markierungen wurden nicht gefunden. Bitte die ganze Seite exportieren bzw. fotografieren.");
    }
    const Hm = homography(MARK_CENTERS, found.map((f) => [f.x, f.y]));
    if (!Hm) throw new Error("Seite konnte nicht entzerrt werden.");
    const page = readPageCode(img, Hm) - 1;
    if (page < 0 || page >= pageCount()) throw new Error("Seitennummer nicht erkannt – ist das eine Vorlage von dieser Webseite?");

    const glyphs = [];
    for (const box of pageBoxes(page)) {
      const g = extractBox(img, Hm, box, page);
      if (g) glyphs.push({ ch: box.ch, glyph: g });
    }
    return { page, glyphs };
  }

  // ---------- Oberfläche ----------

  async function sendTemplate() {
    if (!window.jspdf) { H().setStatus("PDF-Bibliothek fehlt."); return; }
    const pdf = buildTemplate();
    const file = new File([pdf.output("blob")], "handschrift-vorlage.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Handschrift-Vorlage" });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    pdf.save("handschrift-vorlage.pdf");
  }

  async function importFiles(files) {
    const status = H().setStatus;
    const report = [];
    let total = 0;
    try {
      for (const file of files) {
        status(`Lese ${file.name} …`);
        let pages;
        try {
          pages = await fileToCanvases(file);
        } catch (_) {
          report.push(`${file.name}: Datei konnte nicht geöffnet werden.`);
          continue;
        }
        for (const { canvas, label } of pages) {
          status(`Analysiere ${label} …`);
          await new Promise((r) => setTimeout(r, 30));
          try {
            const { page, glyphs } = analyzeCanvas(canvas);
            if (glyphs.length && !H().importGlyphs(glyphs)) {
              report.push("Speicher voll – bitte „Sichern“ benutzen und alte Varianten löschen.");
            }
            total += glyphs.length;
            report.push(`Vorlagen-Seite ${page + 1}: ${glyphs.length} Buchstaben übernommen.`);
          } catch (e) {
            report.push(`${label}: ${e.message}`);
          }
        }
      }
    } finally {
      status(report.join(" ") || "Keine Seiten gefunden.");
    }
    return total;
  }

  function init() {
    document.getElementById("hwTemplate").addEventListener("click", sendTemplate);
    document.getElementById("hwScan").addEventListener("change", (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (files.length) importFiles(files);
    });
  }

  window.HandschriftVorlage = {
    init, buildTemplate, analyzeCanvas, importFiles,
    layout: { pageBoxes, pageCount, BOX_W, BOX_H },
  };
})();
