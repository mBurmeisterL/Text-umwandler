// Datei-Umwandler: Bilder ↔ PDF, Bildformate und Goodnotes (#/umwandeln)
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MAX_PIXELS = 16e6; // Grenze von Safari für ein Canvas
  const RENDER_LONG_SIDE = 2400; // PDF-Seiten als Bild: Länge der langen Seite in Pixeln

  const TARGETS = {
    pdf: { label: "PDF", desc: "alles in eine PDF-Datei", icon: "📄" },
    jpg: { label: "JPG", desc: "Bilder, klein", icon: "🖼️" },
    png: { label: "PNG", desc: "Bilder, verlustfrei", icon: "🖼️" },
    webp: { label: "WebP", desc: "Bilder, sehr klein", icon: "🖼️" },
    goodnotes: { label: "Goodnotes", desc: "als Goodnotes-Datei", icon: "✏️" },
  };

  // Eingelesene Dateien: { name, kind: "image"|"pdf", file, bytes?, pdf?, pages, thumb }
  let items = [];
  let target = "pdf";

  // ---------- PDF.js ----------

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

  // noText: getippten Text weglassen (er wird als Goodnotes-Textfeld darübergelegt)
  async function renderPdfPage(item, index, longSide = RENDER_LONG_SIDE, noText = false) {
    const page = await item.pdf.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    let scale = longSide / Math.max(base.width, base.height);
    if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (noText) ctx.fillText = ctx.strokeText = () => {};
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }

  /**
   * Getippter Text einer PDF-Seite als Zeilen (pt, oben links). Die Farbe wird aus der normal gezeichneten Seite
   * gelesen (dunkelster Punkt im Bereich des Texts). Leere Liste bei eingescannten PDFs ohne Textebene.
   */
  async function pdfPageText(item, index, normalCanvas, sizePt) {
    const page = await item.pdf.getPage(index + 1);
    const tc = await page.getTextContent();
    if (!tc.items.some((t) => t.str && t.str.trim())) return [];
    const k = normalCanvas.width / sizePt[0];
    const data = normalCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, normalCanvas.width, normalCanvas.height).data;
    const W = normalCanvas.width, H = normalCanvas.height;
    const colorAt = (x, y, w, h) => {
      let best = 1e9, col = [30, 27, 27];
      const x0 = Math.max(0, Math.floor(x * k)), y0 = Math.max(0, Math.floor(y * k));
      const x1 = Math.min(W - 1, Math.ceil((x + w) * k)), y1 = Math.min(H - 1, Math.ceil((y + h) * k));
      const step = Math.max(1, Math.floor((x1 - x0) / 200));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx += step) {
          const o = (yy * W + xx) * 4;
          const l = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
          if (l < best) { best = l; col = [data[o], data[o + 1], data[o + 2]]; }
        }
      }
      return "#" + col.map((v) => v.toString(16).padStart(2, "0")).join("");
    };
    const fontOf = (name) => {
      try {
        const f = page.commonObjs.get(name);
        return f ? { name: f.name, bold: !!(f.bold || f.black), italic: !!f.italic } : null;
      } catch (_) {
        return null;
      }
    };
    return window.GoodnotesExport.pdfTextLines(tc, sizePt[1], fontOf, colorAt);
  }

  async function pdfPageSizes(item) {
    const out = [];
    for (let i = 0; i < item.pages; i++) {
      const vp = (await item.pdf.getPage(i + 1)).getViewport({ scale: 1 });
      out.push([vp.width, vp.height]);
    }
    return out;
  }

  // ---------- Bilder ----------

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      return im;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function imageCanvas(im, background) {
    let w = im.naturalWidth, h = im.naturalHeight;
    if (w * h > MAX_PIXELS) {
      const f = Math.sqrt(MAX_PIXELS / (w * h));
      w = Math.round(w * f);
      h = Math.round(h * f);
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(im, 0, 0, w, h);
    return c;
  }

  // Canvas-Speicher sofort freigeben (Safari hat ein festes Limit)
  const free = (c) => { c.width = c.height = 0; };
  const baseName = (name) => name.replace(/\.[^.]+$/, "") || "datei";
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

  // Alle Seiten aller Dateien nacheinander als Canvas
  async function* allCanvases(background) {
    for (const it of items) {
      if (it.kind === "image") {
        yield { canvas: imageCanvas(await loadImage(it.file), background), name: baseName(it.name) };
      } else {
        for (let i = 0; i < it.pages; i++) {
          yield { canvas: await renderPdfPage(it, i), name: `${baseName(it.name)}-seite-${i + 1}` };
        }
      }
    }
  }

  // ---------- Dateien einlesen ----------

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    say(`${files.length} Datei${files.length > 1 ? "en werden" : " wird"} geladen …`, "busy");
    let failed = 0;
    for (const file of files) {
      try {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (isPdf) {
          const pdfjs = await loadPdfJs();
          const bytes = new Uint8Array(await file.arrayBuffer());
          // PDF.js bekommt eine Kopie, die Original-Bytes brauchen wir für Goodnotes
          const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
          const item = { name: file.name, kind: "pdf", file, bytes, pdf, pages: pdf.numPages };
          const t = await renderPdfPage(item, 0, 240);
          item.thumb = t.toDataURL("image/jpeg", 0.7);
          free(t);
          items.push(item);
        } else {
          const im = await loadImage(file);
          const t = document.createElement("canvas");
          const f = 240 / Math.max(im.naturalWidth, im.naturalHeight);
          t.width = Math.max(1, Math.round(im.naturalWidth * f));
          t.height = Math.max(1, Math.round(im.naturalHeight * f));
          t.getContext("2d").drawImage(im, 0, 0, t.width, t.height);
          items.push({ name: file.name, kind: "image", file, pages: 1, thumb: t.toDataURL("image/png") });
          free(t);
        }
      } catch (_) {
        failed++;
      }
    }
    renderList();
    if (failed) say(`${failed} Datei${failed > 1 ? "en konnten" : " konnte"} nicht gelesen werden (nur Bilder und PDFs).`, "error");
    else say(summary(), "");
  }

  function summary() {
    const pages = items.reduce((a, it) => a + it.pages, 0);
    if (!items.length) return "";
    return `${items.length} Datei${items.length > 1 ? "en" : ""}, ${pages} Seite${pages > 1 ? "n" : ""}/Bild${pages > 1 ? "er" : ""}.`;
  }

  function renderList() {
    const list = $("cvList");
    list.innerHTML = "";
    items.forEach((it, i) => {
      const li = document.createElement("li");
      li.className = "cv-item";
      const img = document.createElement("img");
      img.src = it.thumb;
      img.alt = "";
      const info = document.createElement("div");
      info.className = "cv-info";
      const n = document.createElement("strong");
      n.textContent = it.name;
      const d = document.createElement("span");
      d.textContent = it.kind === "pdf" ? `PDF, ${it.pages} Seite${it.pages > 1 ? "n" : ""}` : "Bild";
      info.append(n, d);
      const moves = document.createElement("div");
      moves.className = "cv-moves";
      const mk = (txt, label, fn, disabled) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn ghost";
        b.textContent = txt;
        b.setAttribute("aria-label", label);
        b.disabled = disabled;
        b.addEventListener("click", fn);
        return b;
      };
      moves.append(
        mk("↑", "Nach oben", () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; renderList(); }, i === 0),
        mk("↓", "Nach unten", () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; renderList(); }, i === items.length - 1),
        mk("✕", "Entfernen", () => { items.splice(i, 1); renderList(); say(summary(), ""); }, false),
      );
      li.append(img, info, moves);
      list.appendChild(li);
    });
    $("cvEmpty").hidden = items.length > 0;
    $("cvClear").hidden = !items.length;
    $("cvGo").disabled = !items.length;
    $("cvToEditor").disabled = !items.length;
  }

  // ---------- Umwandeln ----------

  async function convertPdf() {
    const pages = [];
    const a4 = $("cvPageSize").value === "a4";
    for await (const { canvas } of allCanvases("#fff")) {
      say(`Seite ${pages.length + 1} wird eingefügt …`, "busy");
      const jpeg = await window.GoodnotesExport.canvasToJpeg(canvas, 0.9);
      const imgW = canvas.width, imgH = canvas.height;
      free(canvas);
      let wPt, hPt;
      if (a4) {
        [wPt, hPt] = imgW > imgH ? [841.89, 595.28] : [595.28, 841.89];
      } else {
        // 150 dpi: Bildgröße in pt
        wPt = (imgW / 150) * 72;
        hPt = (imgH / 150) * 72;
      }
      pages.push({ wPt, hPt, jpeg, imgW, imgH });
    }
    const bytes = a4 ? fittedPdf(pages) : window.GoodnotesExport.makePdf(pages);
    const name = items.length === 1 ? baseName(items[0].name) : "umgewandelt";
    return [new File([bytes], `${name}.pdf`, { type: "application/pdf" })];
  }

  // A4-Seiten mit eingepasstem Bild (mit jsPDF, das ist auf der Seite ohnehin geladen)
  function fittedPdf(pages) {
    if (!window.jspdf) return window.GoodnotesExport.makePdf(pages);
    let pdf = null;
    for (const p of pages) {
      const land = p.wPt > p.hPt;
      if (!pdf) pdf = new window.jspdf.jsPDF({ orientation: land ? "l" : "p", unit: "pt", format: "a4" });
      else pdf.addPage("a4", land ? "l" : "p");
      const margin = 18;
      const f = Math.min((p.wPt - 2 * margin) / p.imgW, (p.hPt - 2 * margin) / p.imgH);
      const w = p.imgW * f, h = p.imgH * f;
      pdf.addImage(p.jpeg, "JPEG", (p.wPt - w) / 2, (p.hPt - h) / 2, w, h);
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  }

  async function convertImages(type, ext) {
    const files = [];
    const keepAlpha = type !== "image/jpeg";
    for await (const { canvas, name } of allCanvases(keepAlpha ? null : "#fff")) {
      say(`Bild ${files.length + 1} wird umgewandelt …`, "busy");
      const blob = await toBlob(canvas, type, 0.9);
      free(canvas);
      if (!blob || blob.type !== type) throw new Error(`Dieser Browser kann kein ${ext.toUpperCase()} speichern.`);
      files.push(new File([blob], `${name}.${ext}`, { type }));
    }
    return files;
  }

  async function convertGoodnotes() {
    const G = window.GoodnotesExport;
    const editable = $("cvEditable").checked;
    const typed = $("cvPdfText").checked;
    const pages = [];
    let thumbnail = null;
    let n = 0;
    const total = items.reduce((a, it) => a + it.pages, 0);
    for (const it of items) {
      if (it.kind === "pdf" && !editable && !typed) {
        // PDF bleibt unverändert und scharf als Hintergrund
        const sizes = await pdfPageSizes(it);
        sizes.forEach((sizePt, i) => pages.push({ strokes: [], sizePt, background: { pdf: it.bytes, page: i + 1 } }));
        n += it.pages;
        if (!thumbnail) {
          const t = await renderPdfPage(it, 0, 400);
          thumbnail = await smallJpeg(t);
          free(t);
        }
        continue;
      }
      const count = it.kind === "pdf" ? it.pages : 1;
      for (let i = 0; i < count; i++) {
        n++;
        say(editable ? `Seite ${n} von ${total}: Schrift wird in Striche umgewandelt …` : `Seite ${n} von ${total} …`, "busy");
        await new Promise((r) => setTimeout(r, 30));
        // PDF-Seiten behalten ihre echte Größe, Bilder werden auf A4-Breite gesetzt
        const sizesPt = it.kind === "pdf" ? [(it.sizes || (it.sizes = await pdfPageSizes(it)))[i]] : null;
        let canvas, textBoxes = [];
        if (it.kind === "pdf" && typed) {
          // Getippter Text → Textfelder; der Hintergrund wird ohne diesen Text gezeichnet
          const normal = await renderPdfPage(it, i);
          const lines = await pdfPageText(it, i, normal, sizesPt[0]);
          if (lines.length) {
            textBoxes = G.textBoxesFromLines(lines);
            free(normal);
            canvas = await renderPdfPage(it, i, RENDER_LONG_SIDE, true);
          } else {
            canvas = normal; // eingescannt: kein Text zum Übernehmen
          }
        } else {
          canvas = it.kind === "pdf" ? await renderPdfPage(it, i) : imageCanvas(await loadImage(it.file), "#fff");
        }
        if (!thumbnail) thumbnail = await smallJpeg(canvas);
        const [page] = await G.fromImagesPages([canvas], { editable, contrast: contrastValue(), sizesPt, quality: 0.9 });
        free(canvas);
        // Textfelder sind in pt, die Seite rechnet in Bildpixeln (sizePx)
        if (textBoxes.length) {
          const f = page.sizePx[0] / page.sizePt[0];
          page.items = textBoxes.map((b) => ({
            ...b, x: b.x * f, y: b.y * f, w: b.w * f, h: b.h * f, size: b.size * f,
            text: b.text.map((r) => ({ ...r, size: r.size * f })),
          }));
        }
        pages.push(page);
      }
    }
    say("Goodnotes-Datei wird zusammengebaut …", "busy");
    const blob = await G.buildDocument(pages, { title: items.length === 1 ? baseName(items[0].name) : "Umgewandelt", thumbnail });
    const name = items.length === 1 ? baseName(items[0].name) : "umgewandelt";
    return [new File([blob], `${name}.goodnotes`, { type: "application/octet-stream" })];
  }

  // Vorschaubild für Goodnotes (300 px breit)
  async function smallJpeg(c) {
    const t = document.createElement("canvas");
    t.width = 300;
    t.height = Math.max(1, Math.round((300 * c.height) / c.width));
    t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
    const out = await window.GoodnotesExport.canvasToJpeg(t, 0.7);
    free(t);
    return out;
  }

  const contrastValue = () => [0.4, 0.28, 0.18][Number($("cvContrast").value)];

  async function convert() {
    if (!items.length) return;
    const btn = $("cvGo");
    btn.disabled = true;
    try {
      let files;
      if (target === "pdf") files = await convertPdf();
      else if (target === "jpg") files = await convertImages("image/jpeg", "jpg");
      else if (target === "png") files = await convertImages("image/png", "png");
      else if (target === "webp") files = await convertImages("image/webp", "webp");
      else files = await convertGoodnotes();
      const what = files.length === 1 ? `„${files[0].name}“` : `${files.length} Dateien`;
      say(`✓ ${what} fertig.`, "ok");
      const gn = target === "goodnotes";
      const how = await window.ShareFiles.deliver(files, {
        title: gn ? "Goodnotes-Datei ist fertig" : "Fertig umgewandelt",
        shareLabel: gn ? "📤 An Goodnotes senden" : "📤 Teilen",
        hint: gn
          ? "Im Teilen-Menü „Goodnotes“ antippen (eventuell unter „Mehr“). Oder „Speichern“ und die Datei in der Dateien-App antippen."
          : "Im Teilen-Menü z. B. „Bild sichern“, „In Dateien sichern“ oder eine App wählen.",
      });
      if (how === "shared") say(`✓ ${what} geteilt.`, "ok");
      else if (how === "downloaded") say(`✓ ${what} gespeichert.` + (gn ? " In der Dateien-App antippen oder in Goodnotes über „Importieren“ öffnen." : ""), "ok");
    } catch (e) {
      say("Umwandeln ging nicht: " + (e && e.message ? e.message : e), "error");
    } finally {
      btn.disabled = !items.length;
    }
  }

  // ---------- In den Goodnotes-Editor übernehmen ----------

  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");

  // Textzeilen → Textfelder des Editors: ein Feld je Zeile, gemischte Formatierung als runs
  function editorTextItems(lines) {
    return window.GoodnotesExport.textBoxesFromLines(lines).map((b) => {
      const r0 = b.text[0];
      return {
        type: "text", x: b.x, y: b.y, w: b.w, h: b.h,
        text: b.text.map((r) => r.text).join(""), runs: b.text.length > 1 ? b.text : undefined,
        size: Math.round(r0.size * 10) / 10, font: r0.font, color: r0.color || "#1e1b1b", bold: r0.bold, italic: r0.italic,
      };
    });
  }

  // Jede Seite/jedes Bild wird eine Editor-Seite mit dem Bild als Hintergrund; mit „Schrift bearbeitbar
  // machen“ wird die Tinte zu Strichen und der Hintergrund von ihr befreit
  async function toEditor() {
    const D = window.GoodnotesDesigner, G = window.GoodnotesExport;
    if (!items.length || !D || !G) return;
    const btn = $("cvToEditor");
    btn.disabled = true;
    const editable = $("cvEditable").checked;
    const total = items.reduce((a, it) => a + it.pages, 0);
    const pages = [];
    try {
      let n = 0;
      for (const it of items) {
        const sizes = it.kind === "pdf" ? (it.sizes || (it.sizes = await pdfPageSizes(it))) : null;
        for (let i = 0; i < it.pages; i++) {
          n++;
          say(`Seite ${n} von ${total} wird übernommen …`, "busy");
          await new Promise((r) => setTimeout(r, 30));
          // Getippter Text aus PDFs → Textfelder im Editor; der Hintergrund dann ohne diesen Text
          let textItems = [];
          let canvas;
          if (it.kind === "pdf" && $("cvPdfText").checked) {
            const normal = await renderPdfPage(it, i, 1800);
            const lines = await pdfPageText(it, i, normal, sizes[i]);
            if (lines.length) {
              textItems = editorTextItems(lines);
              free(normal);
              canvas = await renderPdfPage(it, i, 1800, true);
            } else canvas = normal;
          } else {
            canvas = it.kind === "pdf" ? await renderPdfPage(it, i, 1800) : imageCanvas(await loadImage(it.file), "#fff");
          }
          // Hintergrund nicht größer als nötig (Speicher im Browser)
          const f = Math.min(1, 1800 / Math.max(canvas.width, canvas.height));
          if (f < 1) {
            const c = document.createElement("canvas");
            c.width = Math.round(canvas.width * f);
            c.height = Math.round(canvas.height * f);
            c.getContext("2d").drawImage(canvas, 0, 0, c.width, c.height);
            free(canvas);
            canvas = c;
          }
          const sizePt = sizes ? sizes[i] : (canvas.height >= canvas.width
            ? [595.28, (595.28 * canvas.height) / canvas.width]
            : [841.89, (841.89 * canvas.height) / canvas.width]);
          const k = sizePt[0] / canvas.width;
          let bgCanvas = canvas, strokes = [];
          if (editable) {
            const r = G.strokesFromCanvas(canvas, { contrast: contrastValue() });
            bgCanvas = r.cleaned;
            strokes = r.strokes.map((st) => ({ type: "stroke", pts: st.pts.map(([x, y]) => [x * k, y * k]), w: st.w * k, color: hex(st.color) }));
          }
          pages.push({ sizePt, bg: bgCanvas.toDataURL("image/jpeg", 0.85), bgW: bgCanvas.width, bgH: bgCanvas.height, items: [...strokes, ...textItems] });
          if (bgCanvas !== canvas) free(bgCanvas);
          free(canvas);
        }
      }
      D.importPages(pages, items.length === 1 ? baseName(items[0].name) : "Umgewandelt");
      say(`✓ ${pages.length} Seite${pages.length > 1 ? "n" : ""} im Goodnotes-Editor.`, "ok");
      location.hash = "#/goodnotes";
    } catch (e) {
      say("Übernehmen ging nicht: " + (e && e.message ? e.message : e), "error");
    } finally {
      btn.disabled = !items.length;
    }
  }

  // ---------- Oberfläche ----------

  function say(msg, kind) {
    const el = $("cvStatus");
    el.textContent = msg;
    el.className = "tr-status" + (kind ? " " + kind : "");
  }

  function selectTarget(t) {
    target = t;
    for (const b of $("cvTargets").children) {
      const on = b.dataset.target === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    }
    $("cvPdfOptions").hidden = t !== "pdf";
    $("cvGnOptions").hidden = t !== "goodnotes";
    $("cvToEditor").hidden = t !== "goodnotes";
    $("cvGo").textContent = `In ${TARGETS[t].label} umwandeln`;
    $("cvContrastField").hidden = !$("cvEditable").checked;
  }

  function init() {
    const grid = $("cvTargets");
    for (const [key, t] of Object.entries(TARGETS)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile cv-target";
      b.dataset.target = key;
      b.setAttribute("role", "radio");
      b.innerHTML = `<span class="cv-icon" aria-hidden="true"></span><span class="tile-name"></span><span class="tile-desc"></span>`;
      b.querySelector(".cv-icon").textContent = t.icon;
      b.querySelector(".tile-name").textContent = t.label;
      b.querySelector(".tile-desc").textContent = t.desc;
      b.addEventListener("click", () => selectTarget(key));
      grid.appendChild(b);
    }
    $("cvFiles").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
    const drop = $("cvDrop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
    $("cvClear").addEventListener("click", () => { items = []; renderList(); say("", ""); });
    $("cvGo").addEventListener("click", convert);
    $("cvToEditor").addEventListener("click", toEditor);
    $("cvEditable").addEventListener("change", () => selectTarget(target));
    selectTarget("pdf");
    renderList();
  }

  init();
})();
