// Goodnotes-Seite gestalten (#/goodnotes): Textfelder, Formen, Haftnotizen, Linien/Pfeile, Bilder,
// Stift/Textmarker/Bleistift, Papier, Lesezeichen, Inhaltsverzeichnis – Export als .goodnotes-Datei,
// in der alles bearbeitbar bleibt. Koordinaten in pt (A4 = 595,28 × 841,89).
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const STORE = "text-umwandler:goodnotes-seite";
  const A4 = [595.28, 841.89];
  const FONTS = ["Helvetica Neue", "Avenir Next", "Georgia", "Times New Roman", "Courier New", "Noteworthy", "Marker Felt", "Chalkboard SE", "Bradley Hand"];
  const STICKY_COLORS = { "#fae778": "Gelb", "#a8d8ff": "Blau", "#b8f0b0": "Grün", "#ffc4d6": "Rosa", "#ffd8a8": "Orange" };

  let doc = null;      // { title, pages: [{ paper, landscape, bookmark, outline, items: [] }], current }
  let selected = -1;   // Index des ausgewählten Elements
  let tool = "select";
  let drag = null;     // laufende Zeiger-Aktion

  const page = () => doc.pages[doc.current];
  const size = (p = page()) => (p.landscape ? [A4[1], A4[0]] : A4);

  // ---------- Speichern ----------

  function newPage() { return { paper: "lined", landscape: false, bookmark: false, outline: "", items: [] }; }

  function load() {
    try { doc = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (_) { doc = null; }
    if (!doc || !Array.isArray(doc.pages) || !doc.pages.length) doc = { title: "Meine Seite", pages: [newPage()], current: 0 };
    doc.current = Math.min(doc.current || 0, doc.pages.length - 1);
  }

  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { localStorage.setItem(STORE, JSON.stringify(doc)); } catch (_) {
      say("Hinweis: zu groß zum Zwischenspeichern (viele Bilder) – vor dem Schließen senden.", "");
    }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }
  // Beim Verlassen oder Wechseln der App sofort speichern, sonst ginge die letzte Änderung verloren
  addEventListener("pagehide", () => { if (saveTimer) saveNow(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && saveTimer) saveNow(); });

  function say(msg, kind) {
    const el = $("gdStatus");
    el.textContent = msg;
    el.className = "tr-status" + (kind ? " " + kind : "");
  }

  // ---------- Papier ----------

  const paperCache = new Map();
  // Papier als Bild (doppelte Auflösung); dasselbe Bild dient als Vorschau und als PDF-Hintergrund
  function paperCanvas(paper, landscape) {
    const key = paper + landscape;
    if (paperCache.has(key)) return paperCache.get(key);
    const [W, H] = landscape ? [A4[1], A4[0]] : A4;
    const s = 2;
    const c = document.createElement("canvas");
    c.width = Math.round(W * s);
    c.height = Math.round(H * s);
    const x = c.getContext("2d");
    x.scale(s, s);
    x.fillStyle = "#fff";
    x.fillRect(0, 0, W, H);
    const cell = 14.17; // 5 mm
    if (paper === "lined") {
      x.strokeStyle = "rgba(90,130,200,0.5)";
      x.lineWidth = 0.6;
      for (let y = 72; y < H - 30; y += 24) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
      x.strokeStyle = "rgba(220,70,70,0.55)";
      x.beginPath(); x.moveTo(60, 0); x.lineTo(60, H); x.stroke();
    } else if (paper === "grid") {
      x.strokeStyle = "rgba(90,130,200,0.35)";
      x.lineWidth = 0.5;
      for (let y = 28; y < H - 20; y += cell) { x.beginPath(); x.moveTo(20, y); x.lineTo(W - 20, y); x.stroke(); }
      for (let xx = 20; xx < W - 20; xx += cell) { x.beginPath(); x.moveTo(xx, 28); x.lineTo(xx, H - 20); x.stroke(); }
    } else if (paper === "dotted") {
      x.fillStyle = "rgba(80,90,110,0.45)";
      for (let y = 28; y < H - 20; y += cell) for (let xx = 20; xx < W - 20; xx += cell) { x.beginPath(); x.arc(xx, y, 0.8, 0, Math.PI * 2); x.fill(); }
    }
    const out = { canvas: c, url: c.toDataURL("image/png") };
    paperCache.set(key, out);
    return out;
  }

  // ---------- Darstellung ----------

  const el = (name, attrs, parent) => {
    const e = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  function textBlock(g, it, x, y, w, h, pad = 6) {
    const fo = el("foreignObject", { x, y, width: Math.max(1, w), height: Math.max(1, h) }, g);
    const div = document.createElement("div");
    div.className = "gd-text";
    div.style.cssText = `font-family:"${it.font || "Helvetica Neue"}",Helvetica,Arial,sans-serif;font-size:${it.size || 14}px;` +
      `color:${it.color || "#1e1b1b"};font-weight:${it.bold ? 700 : 400};font-style:${it.italic ? "italic" : "normal"};padding:${pad}px;` +
      (it.link ? "text-decoration:underline;" : "");
    div.textContent = it.text || "";
    fo.appendChild(div);
  }

  const dashArray = (dash, w) => (dash === "dashed" ? `${3 * w} ${4 * w}` : dash === "dotted" ? `0.1 ${2 * w}` : null);

  function arrowHead(g, tip, from, kind, color, w) {
    if (!kind || kind === "none") return;
    const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const L = 6 + w * 2.5, sp = 0.45;
    const p1 = [tip[0] - L * Math.cos(a - sp), tip[1] - L * Math.sin(a - sp)];
    const p2 = [tip[0] - L * Math.cos(a + sp), tip[1] - L * Math.sin(a + sp)];
    if (kind === "filled") el("path", { d: `M${p1}L${tip}L${p2}Z`, fill: color, stroke: color, "stroke-width": w, "stroke-linejoin": "round" }, g);
    else el("path", { d: `M${p1}L${tip}L${p2}`, fill: "none", stroke: color, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
  }

  function linePath(it) {
    const [a, b] = [it.from, it.to];
    if (it.elbow) {
      const kx = it.via ? it.via[0] : (a[0] + b[0]) / 2;
      return { d: `M${a}L${kx},${a[1]}L${kx},${b[1]}L${b}`, startDir: [kx, a[1]], endDir: [kx, b[1]] };
    }
    if (it.via) {
      // Kurve durch den Mittelpunkt via
      const c = [2 * it.via[0] - (a[0] + b[0]) / 2, 2 * it.via[1] - (a[1] + b[1]) / 2];
      return { d: `M${a}Q${c} ${b}`, startDir: c, endDir: c };
    }
    return { d: `M${a}L${b}`, startDir: b, endDir: a };
  }

  function bbox(it) {
    if ("x" in it) return [it.x, it.y, it.w, it.h];
    const pts = it.pts || [it.from, it.to, ...(it.via ? [it.via] : [])];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const pad = (it.w || 2) / 2 + 2;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];
  }

  function drawItem(it, i, layer) {
    const g = el("g", { "data-i": i, class: "gd-item" }, layer);
    switch (it.type) {
      case "text":
        el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, fill: "transparent" }, g);
        textBlock(g, it, it.x, it.y, it.w, it.h);
        break;
      case "shape": {
        const ow = it.outline ? it.outline.width : 0;
        const common = {
          fill: it.fill || "none", stroke: it.outline ? it.outline.color : "none", "stroke-width": ow,
          "stroke-dasharray": it.outline ? dashArray(it.outline.dash, ow) : null, "stroke-linecap": "round", "pointer-events": "all",
        };
        if (it.shape === "ellipse") el("ellipse", { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, ...common }, g);
        else if (it.shape === "polygon") el("polygon", { points: it.vertices.map(([u, v]) => `${it.x + u * it.w},${it.y + v * it.h}`).join(" "), ...common }, g);
        else el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.radius || 0, ...common }, g);
        if (it.text) textBlock(g, it, it.x, it.y, it.w, it.h, 8);
        break;
      }
      case "sticky":
        el("rect", { x: it.x, y: it.y, width: it.w, height: it.h, fill: it.color || "#fae778", rx: 3, class: "gd-sticky" }, g);
        textBlock(g, { ...it, color: "#1e1b1b", size: it.size || 13 }, it.x, it.y, it.w, it.h, 8);
        break;
      case "line": {
        const { d, startDir, endDir } = linePath(it);
        el("path", { d, fill: "none", stroke: "transparent", "stroke-width": Math.max(14, it.w + 10) }, g); // leichter zu treffen
        el("path", { d, fill: "none", stroke: it.color, "stroke-width": it.w, "stroke-dasharray": dashArray(it.dash, it.w), "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
        arrowHead(g, it.to, endDir, it.endArrow, it.color, it.w);
        arrowHead(g, it.from, startDir, it.startArrow, it.color, it.w);
        break;
      }
      case "image": {
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        el("image", { href: it.src, x: it.x, y: it.y, width: it.w, height: it.h, preserveAspectRatio: "none",
          transform: it.angle ? `rotate(${(it.angle * 180) / Math.PI} ${cx} ${cy})` : null }, g);
        break;
      }
      default: { // stroke, highlighter, pencil
        const d = it.pts.length === 1 ? `M${it.pts[0]}l0.01,0` : "M" + it.pts.map((p) => p.join(",")).join("L");
        el("path", { d, fill: "none", stroke: "transparent", "stroke-width": Math.max(12, it.w + 8), "stroke-linecap": "round" }, g);
        el("path", { d, fill: "none", stroke: it.color, "stroke-width": it.w, "stroke-linecap": it.type === "highlighter" ? "butt" : "round",
          "stroke-linejoin": "round", "stroke-opacity": it.type === "highlighter" ? 0.45 : it.type === "pencil" ? 0.85 : 1 }, g);
      }
    }
  }

  function render() {
    const svg = $("gdSvg");
    const [W, H] = size();
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    $("gdPaperWrap").style.aspectRatio = `${W} / ${H}`;
    svg.textContent = "";
    el("image", { href: paperCanvas(page().paper, page().landscape).url, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none", "pointer-events": "none" }, svg);
    // Wie in Goodnotes: Bilder liegen unter allem anderen
    const below = el("g", {}, svg), above = el("g", {}, svg);
    page().items.forEach((it, i) => drawItem(it, i, it.type === "image" ? below : above));
    if (live) drawItem(live, -1, above);
    const it = page().items[selected];
    if (it) {
      const [x, y, w, h] = bbox(it);
      el("rect", { x, y, width: w, height: h, class: "gd-sel" }, svg);
      const handle = (cx, cy, kind) => el("circle", { cx, cy, r: 7, class: "gd-handle", "data-handle": kind }, svg);
      if (it.type === "line") {
        handle(...it.from, "from");
        handle(...it.to, "to");
        if (it.via || it.elbow) handle(...(it.via || [(it.from[0] + it.to[0]) / 2, (it.from[1] + it.to[1]) / 2]), "via");
      } else if ("x" in it) handle(it.x + it.w, it.y + it.h, "size");
    }
  }

  let raf = 0;
  const rerender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // ---------- Zeiger: auswählen, verschieben, Größe, zeichnen, radieren ----------

  let live = null; // Strich, der gerade gezeichnet wird

  function svgPoint(e) {
    const svg = $("gdSvg");
    const m = svg.getScreenCTM().inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }

  const itemIndexAt = (target) => {
    const g = target && target.closest && target.closest("[data-i]");
    return g ? Number(g.dataset.i) : -1;
  };

  function moveItem(it, orig, dx, dy) {
    if ("x" in orig) { it.x = orig.x + dx; it.y = orig.y + dy; }
    if (orig.pts) it.pts = orig.pts.map(([x, y]) => [x + dx, y + dy]);
    if (orig.from) {
      it.from = [orig.from[0] + dx, orig.from[1] + dy];
      it.to = [orig.to[0] + dx, orig.to[1] + dy];
      if (orig.via) it.via = [orig.via[0] + dx, orig.via[1] + dy];
    }
  }

  function onDown(e) {
    if (e.button > 0) return;
    const p = svgPoint(e);
    const svg = $("gdSvg");
    if (tool === "pen" || tool === "highlighter" || tool === "pencil") {
      const w = Number($("gdPenWidth").value);
      live = {
        type: tool === "pen" ? "stroke" : tool,
        pts: [p],
        w: tool === "highlighter" ? w * 7 : tool === "pencil" ? w * 1.2 : w,
        color: tool === "highlighter" ? "#ffd60a" : $("gdPenColor").value,
      };
      if (tool === "highlighter" && $("gdPenColor").dataset.touched) live.color = $("gdPenColor").value;
      drag = { kind: "draw" };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (tool === "eraser") {
      drag = { kind: "erase" };
      eraseAt(e);
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const handle = e.target.dataset && e.target.dataset.handle;
    if (handle && selected >= 0) {
      drag = { kind: handle, start: p, orig: JSON.parse(JSON.stringify(page().items[selected])) };
    } else {
      const i = itemIndexAt(e.target);
      select(i);
      if (i >= 0) drag = { kind: "move", start: p, orig: JSON.parse(JSON.stringify(page().items[i])) };
    }
    if (drag) { svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  }

  function eraseAt(e) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const i = itemIndexAt(target);
    if (i >= 0) {
      page().items.splice(i, 1);
      if (selected === i) select(-1);
      else if (selected > i) selected--;
      rerender();
      save();
    }
  }

  function onMove(e) {
    if (!drag) return;
    const p = svgPoint(e);
    if (drag.kind === "draw") {
      const last = live.pts[live.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.2) live.pts.push(p);
      rerender();
      return;
    }
    if (drag.kind === "erase") { eraseAt(e); return; }
    const it = page().items[selected];
    if (!it) return;
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    const o = drag.orig;
    if (drag.kind === "move") moveItem(it, o, dx, dy);
    else if (drag.kind === "size") {
      it.w = Math.max(16, o.w + dx);
      it.h = Math.max(12, o.h + dy);
      if (it.type === "image" && !e.shiftKey && o.w && o.h) it.h = Math.max(12, it.w * (o.h / o.w)); // Seitenverhältnis
    } else if (drag.kind === "from") it.from = p;
    else if (drag.kind === "to") it.to = p;
    else if (drag.kind === "via") it.via = p;
    rerender();
  }

  function onUp() {
    if (!drag) return;
    if (drag.kind === "draw" && live) {
      page().items.push(live);
      live = null;
      save();
      renderPages();
    } else if (drag.kind !== "erase") {
      save();
      if (selected >= 0) showProps();
    }
    drag = null;
    rerender();
  }

  function select(i) {
    selected = i;
    showProps();
    rerender();
  }

  // ---------- Elemente hinzufügen ----------

  // Mitte des gerade sichtbaren Teils der Seite (in pt), damit neue Elemente nicht außerhalb landen
  function visibleCenter() {
    const svg = $("gdSvg");
    const r = svg.getBoundingClientRect();
    const [W, H] = size();
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, window.innerHeight);
    const cy = bottom > top ? ((top + bottom) / 2 - r.top) * (H / r.height) : H / 3;
    return [W / 2, Math.min(H - 80, Math.max(80, cy))];
  }

  function add(kind) {
    const [W] = size();
    const n = page().items.length % 5;
    const [cx, cy] = visibleCenter();
    const x = cx - 110 + n * 14, y = cy - 60 + n * 14;
    const items = {
      text: { type: "text", x, y, w: 260, h: 40, text: "Text", size: 18, font: "Helvetica Neue", color: "#1e1b1b" },
      rect: { type: "shape", shape: "rect", radius: 0, x, y, w: 160, h: 100, fill: "#dbe9ff", outline: { width: 2, color: "#1d3a8a", dash: "solid" }, text: "", size: 14, color: "#1e1b1b" },
      ellipse: { type: "shape", shape: "ellipse", x, y, w: 160, h: 100, fill: "#ffe8d6", outline: { width: 2, color: "#c0392b", dash: "solid" }, text: "", size: 14, color: "#1e1b1b" },
      triangle: { type: "shape", shape: "polygon", vertices: [[0.5, 0], [1, 1], [0, 1]], x, y, w: 120, h: 100, fill: "#fff3b0", outline: { width: 2, color: "#8a6d00", dash: "solid" }, text: "", size: 14, color: "#1e1b1b" },
      line: { type: "line", from: [x, y + 40], to: [Math.min(W - 40, x + 200), y + 40], w: 2, color: "#1e1b1b", dash: "solid", startArrow: "none", endArrow: "open", elbow: false },
      sticky: { type: "sticky", x, y, w: 160, h: 140, text: "Notiz", color: "#fae778" },
    };
    page().items.push(items[kind]);
    setTool("select");
    select(page().items.length - 1);
    save();
    renderPages();
  }

  async function addImages(files) {
    for (const f of files) {
      try {
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        const im = new Image();
        im.src = url;
        await im.decode();
        // Große Fotos verkleinern (Speicher), PNG behält Transparenz
        const max = 1600;
        const f2 = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        let src = url;
        if (f2 < 1 || !/^data:image\/(png|jpeg)/.test(url)) {
          const c = document.createElement("canvas");
          c.width = Math.round(im.naturalWidth * f2);
          c.height = Math.round(im.naturalHeight * f2);
          c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
          src = /^data:image\/png/.test(url) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
          c.width = c.height = 0;
        }
        const [W, H] = size();
        let w = Math.min(W - 80, 260), h = w * (im.naturalHeight / im.naturalWidth);
        if (h > H * 0.45) { h = H * 0.45; w = h * (im.naturalWidth / im.naturalHeight); }
        const [cx, cy] = visibleCenter();
        page().items.push({ type: "image", src, x: cx - w / 2, y: Math.max(20, Math.min(H - h - 20, cy - h / 2)), w, h, angle: 0 });
      } catch (_) {
        say(`„${f.name}“ konnte nicht gelesen werden.`, "error");
      }
    }
    setTool("select");
    select(page().items.length - 1);
    save();
    renderPages();
  }

  // ---------- Eigenschaften ----------

  function field(label, input) {
    const l = document.createElement("label");
    l.className = "field";
    const s = document.createElement("span");
    s.textContent = label;
    l.append(s, input);
    return l;
  }
  function inputEl(type, value, onInput, extra = {}) {
    const i = document.createElement(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    if (type !== "textarea" && type !== "select") i.type = type;
    if (extra.options) for (const [v, t] of extra.options) { const o = document.createElement("option"); o.value = v; o.textContent = t; i.appendChild(o); }
    for (const [k, v] of Object.entries(extra)) if (k !== "options") i[k] = v;
    if (type === "checkbox") i.checked = !!value; else i.value = value ?? "";
    if (type !== "checkbox" && type !== "select" && type !== "color") i.className = "gd-input";
    i.addEventListener(type === "checkbox" || type === "select" ? "change" : "input", () => {
      onInput(type === "checkbox" ? i.checked : type === "number" || type === "range" ? Number(i.value) : i.value);
      rerender();
      save();
    });
    return i;
  }
  function check(label, value, onInput) {
    const l = document.createElement("label");
    l.className = "check";
    const s = document.createElement("span");
    s.textContent = label;
    l.append(inputEl("checkbox", value, onInput), s);
    return l;
  }
  function row(...els) {
    const d = document.createElement("div");
    d.className = "gd-row";
    d.append(...els);
    return d;
  }
  const DASH = [["solid", "durchgezogen"], ["dashed", "gestrichelt"], ["dotted", "gepunktet"]];
  const ARROW = [["none", "kein"], ["open", "offen"], ["filled", "gefüllt"]];

  function textProps(box, it) {
    box.append(field("Text", inputEl("textarea", it.text, (v) => { it.text = v; }, { rows: 3 })));
    box.append(row(
      field("Größe", inputEl("number", it.size || 14, (v) => { it.size = Math.max(4, v); }, { min: 4, max: 200 })),
      field("Farbe", inputEl("color", it.color || "#1e1b1b", (v) => { it.color = v; })),
    ));
    box.append(field("Schrift", inputEl("select", it.font || "Helvetica Neue", (v) => { it.font = v; }, { options: FONTS.map((f) => [f, f]) })));
    box.append(row(check("fett", it.bold, (v) => { it.bold = v; }), check("kursiv", it.italic, (v) => { it.italic = v; })));
    box.append(field("Link (Adresse oder „Seite 2“)", inputEl("text", it.link || "", (v) => { it.link = v.trim(); }, { placeholder: "https://… oder Seite 2" })));
  }

  function showProps() {
    const box = $("gdProps");
    box.textContent = "";
    const it = page().items[selected];
    const title = $("gdPropsTitle");
    if (!it) {
      title.textContent = "Eigenschaften";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = tool === "select" ? "Ein Element antippen, um es zu bearbeiten." : "Mit dem Stift direkt auf die Seite schreiben.";
      box.append(p);
      return;
    }
    const names = { text: "Textfeld", shape: "Form", sticky: "Haftnotiz", line: "Linie / Pfeil", image: "Bild", stroke: "Stift", highlighter: "Textmarker", pencil: "Bleistift" };
    title.textContent = names[it.type] || "Element";
    if (it.type === "text") textProps(box, it);
    if (it.type === "shape") {
      box.append(row(
        check("gefüllt", !!it.fill, (v) => { it.fill = v ? it.lastFill || "#dbe9ff" : null; if (!v) it.lastFill = it.fill; showProps(); }),
        ...(it.fill ? [inputEl("color", it.fill, (v) => { it.fill = v; })] : []),
      ));
      box.append(row(
        check("Rand", !!it.outline, (v) => { it.outline = v ? { width: 2, color: "#1e1b1b", dash: "solid" } : null; showProps(); }),
        ...(it.outline ? [inputEl("color", it.outline.color, (v) => { it.outline.color = v; })] : []),
      ));
      if (it.outline) {
        box.append(row(
          field("Randstärke", inputEl("number", it.outline.width, (v) => { it.outline.width = Math.max(0.5, v); }, { min: 0.5, max: 20, step: 0.5 })),
          field("Art", inputEl("select", it.outline.dash || "solid", (v) => { it.outline.dash = v; }, { options: DASH })),
        ));
      }
      if (it.shape === "rect") box.append(field("Ecken abrunden", inputEl("range", it.radius || 0, (v) => { it.radius = v; }, { min: 0, max: 60 })));
      textProps(box, it);
    }
    if (it.type === "sticky") {
      box.append(field("Text", inputEl("textarea", it.text, (v) => { it.text = v; }, { rows: 4 })));
      box.append(field("Farbe", inputEl("select", it.color, (v) => { it.color = v; }, { options: Object.entries(STICKY_COLORS) })));
    }
    if (it.type === "line") {
      box.append(row(
        field("Farbe", inputEl("color", it.color, (v) => { it.color = v; })),
        field("Stärke", inputEl("number", it.w, (v) => { it.w = Math.max(0.5, v); }, { min: 0.5, max: 20, step: 0.5 })),
      ));
      box.append(field("Art", inputEl("select", it.dash || "solid", (v) => { it.dash = v; }, { options: DASH })));
      box.append(row(
        field("Pfeil Anfang", inputEl("select", it.startArrow || "none", (v) => { it.startArrow = v; }, { options: ARROW })),
        field("Pfeil Ende", inputEl("select", it.endArrow || "none", (v) => { it.endArrow = v; }, { options: ARROW })),
      ));
      box.append(row(
        check("gebogen", !!it.via && !it.elbow, (v) => { it.elbow = false; it.via = v ? [(it.from[0] + it.to[0]) / 2, (it.from[1] + it.to[1]) / 2 - 40] : null; showProps(); }),
        check("Winkel", !!it.elbow, (v) => { it.elbow = v; it.via = null; showProps(); }),
      ));
    }
    if (it.type === "image") {
      box.append(field("Drehen", inputEl("range", Math.round(((it.angle || 0) * 180) / Math.PI), (v) => { it.angle = (v * Math.PI) / 180; }, { min: -180, max: 180 })));
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Bilder liegen in Goodnotes immer unter Text, Formen und Tinte.";
      box.append(hint);
    }
    if (it.type === "stroke" || it.type === "highlighter" || it.type === "pencil") {
      box.append(row(
        field("Farbe", inputEl("color", it.color, (v) => { it.color = v; })),
        field("Stärke", inputEl("number", it.w, (v) => { it.w = Math.max(0.3, v); }, { min: 0.3, max: 60, step: 0.5 })),
      ));
    }
    // Für alle: Reihenfolge, Kopie, Löschen
    const btn = (txt, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      b.textContent = txt;
      b.title = title;
      b.addEventListener("click", () => { fn(); save(); renderPages(); rerender(); });
      return b;
    };
    const items = page().items;
    box.append(row(
      btn("⬆️", "Nach vorne", () => { if (selected < items.length - 1) { [items[selected], items[selected + 1]] = [items[selected + 1], items[selected]]; selected++; } }),
      btn("⬇️", "Nach hinten", () => { if (selected > 0) { [items[selected], items[selected - 1]] = [items[selected - 1], items[selected]]; selected--; } }),
      btn("⧉ Kopie", "Duplizieren", () => { const c = JSON.parse(JSON.stringify(items[selected])); moveItem(c, JSON.parse(JSON.stringify(c)), 16, 16); items.push(c); selected = items.length - 1; showProps(); }),
      btn("🗑️", "Löschen", () => { items.splice(selected, 1); select(-1); }),
    ));
  }

  // ---------- Seiten ----------

  function renderPages() {
    const list = $("gdPageList");
    list.textContent = "";
    doc.pages.forEach((p, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gd-pagebtn" + (i === doc.current ? " active" : "");
      b.textContent = `${p.bookmark ? "🔖 " : ""}Seite ${i + 1}` + (p.outline ? ` · ${p.outline}` : "") + ` (${p.items.length})`;
      b.addEventListener("click", () => { doc.current = i; selected = -1; syncPageFields(); renderPages(); showProps(); render(); save(); });
      li.appendChild(b);
      list.appendChild(li);
    });
    $("gdDelPage").disabled = doc.pages.length < 2;
  }

  function syncPageFields() {
    const p = page();
    $("gdPaper").value = p.paper;
    $("gdFormat").value = p.landscape ? "landscape" : "portrait";
    $("gdBookmark").checked = !!p.bookmark;
    $("gdOutline").value = p.outline || "";
  }

  function setTool(t) {
    tool = t;
    for (const b of $("gdTools").children) b.classList.toggle("active", b.dataset.tool === t);
    $("gdSvg").classList.toggle("drawing", t !== "select");
    if (t !== "select") select(-1);
  }

  // ---------- Export ----------

  function dataUrlBytes(url) {
    const bin = atob(url.split(",")[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toLink(s) {
    if (!s) return undefined;
    const m = s.match(/^seite\s*(\d+)$/i);
    if (m) return { page: Number(m[1]) - 1 };
    return /^[a-z]+:/i.test(s) ? s : "https://" + s;
  }

  function hexRgba(hex, a = 1) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
  }

  function exportItem(it) {
    const textRun = (o) => [{ text: o.text, size: o.size || 14, font: o.font, color: o.color, bold: o.bold, italic: o.italic, link: toLink(o.link) }];
    switch (it.type) {
      case "text": return { type: "text", x: it.x, y: it.y, w: it.w, h: it.h, font: it.font, size: it.size, text: textRun(it) };
      case "shape": return {
        type: "shape", shape: it.shape, vertices: it.vertices, radius: it.radius, x: it.x, y: it.y, w: it.w, h: it.h,
        fill: it.fill || null, outline: it.outline ? { ...it.outline, dash: it.outline.dash === "solid" ? null : it.outline.dash } : null,
        font: it.font, size: it.size, text: it.text ? textRun(it) : undefined,
      };
      case "sticky": return { type: "sticky", x: it.x, y: it.y, w: it.w, h: it.h, text: it.text, color: hexRgba(it.color) };
      case "line": return {
        type: "line", from: it.from, to: it.to, via: it.via || undefined, elbow: it.elbow, w: it.w, color: it.color,
        dash: it.dash === "solid" ? null : it.dash, startArrow: it.startArrow, endArrow: it.endArrow,
      };
      case "image": return { type: "image", data: dataUrlBytes(it.src), x: it.x, y: it.y, w: it.w, h: it.h, angle: it.angle || 0 };
      case "highlighter": return { type: "highlighter", pts: it.pts, w: it.w, color: hexRgba(it.color, 0.45) };
      default: return { type: it.type, pts: it.pts, w: it.w, color: it.color };
    }
  }

  async function exportDoc() {
    const G = window.GoodnotesExport;
    if (!G) { say("Goodnotes-Baustein nicht geladen – Seite neu laden.", "error"); return; }
    const btn = $("gdExport");
    btn.disabled = true;
    say("Goodnotes-Datei wird erstellt …", "busy");
    try {
      const bgs = new Map();
      const pages = [];
      for (const p of doc.pages) {
        const sizePt = p.landscape ? [A4[1], A4[0]] : A4;
        let background;
        if (p.paper !== "blank") {
          const key = p.paper + p.landscape;
          if (!bgs.has(key)) {
            const { canvas } = paperCanvas(p.paper, p.landscape);
            const jpeg = await G.canvasToJpeg(canvas, 0.92);
            bgs.set(key, G.makePdf([{ wPt: sizePt[0], hPt: sizePt[1], jpeg, imgW: canvas.width, imgH: canvas.height }]));
          }
          background = { pdf: bgs.get(key), page: 1 };
        }
        pages.push({ sizePt, background, bookmark: p.bookmark, outline: p.outline || undefined, items: p.items.map(exportItem) });
      }
      const first = paperCanvas(doc.pages[0].paper, doc.pages[0].landscape).canvas;
      const t = document.createElement("canvas");
      t.width = 300;
      t.height = Math.round((300 * first.height) / first.width);
      t.getContext("2d").drawImage(first, 0, 0, t.width, t.height);
      const thumbnail = await G.canvasToJpeg(t, 0.7);
      const title = ($("gdTitle").value || "Meine Seite").trim();
      const blob = await G.buildDocument(pages, { title, thumbnail });
      const name = title.replace(/[\\/:*?"<>|]+/g, "-") || "seite";
      const file = new File([blob], `${name}.goodnotes`, { type: "application/octet-stream" });
      say("Goodnotes-Datei ist fertig.", "ok");
      const how = await window.ShareFiles.deliver([file], {
        title: "Goodnotes-Datei ist fertig",
        shareLabel: "📤 An Goodnotes senden",
        hint: "Im Teilen-Menü „Goodnotes“ antippen (eventuell unter „Mehr“). Oder „Speichern“ und die Datei in der Dateien-App antippen.",
      });
      if (how === "shared") say("An Goodnotes gesendet – dort ist alles bearbeitbar.", "ok");
      else if (how === "downloaded") say(`„${file.name}“ gespeichert – in der Dateien-App antippen oder in Goodnotes importieren.`, "ok");
    } catch (e) {
      say("Erstellen ging nicht: " + (e && e.message ? e.message : e), "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Start ----------

  function init() {
    load();
    const svg = $("gdSvg");
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    for (const b of $("gdTools").children) b.addEventListener("click", () => setTool(b.dataset.tool));
    for (const b of $("gdAdd").querySelectorAll("[data-add]")) b.addEventListener("click", () => add(b.dataset.add));
    $("gdImage").addEventListener("change", (e) => { addImages([...e.target.files]); e.target.value = ""; });
    $("gdPenColor").addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
    $("gdAddPage").addEventListener("click", () => {
      const p = newPage();
      p.paper = page().paper;
      p.landscape = page().landscape;
      doc.pages.splice(doc.current + 1, 0, p);
      doc.current++;
      selected = -1;
      syncPageFields(); renderPages(); showProps(); render(); save();
    });
    $("gdDelPage").addEventListener("click", () => {
      if (doc.pages.length < 2) return;
      if (page().items.length && !confirm(`Seite ${doc.current + 1} mit allen Elementen löschen?`)) return;
      doc.pages.splice(doc.current, 1);
      doc.current = Math.max(0, doc.current - 1);
      selected = -1;
      syncPageFields(); renderPages(); showProps(); render(); save();
    });
    $("gdPaper").addEventListener("change", (e) => { page().paper = e.target.value; render(); save(); });
    $("gdFormat").addEventListener("change", (e) => { page().landscape = e.target.value === "landscape"; render(); save(); });
    $("gdBookmark").addEventListener("change", (e) => { page().bookmark = e.target.checked; renderPages(); save(); });
    $("gdOutline").addEventListener("input", (e) => { page().outline = e.target.value; renderPages(); save(); });
    $("gdTitle").value = doc.title || "Meine Seite";
    $("gdTitle").addEventListener("input", (e) => { doc.title = e.target.value; save(); });
    $("gdClear").addEventListener("click", () => {
      if (!confirm("Alle Seiten und Elemente löschen?")) return;
      doc = { title: $("gdTitle").value, pages: [newPage()], current: 0 };
      selected = -1;
      syncPageFields(); renderPages(); showProps(); render(); save();
    });
    $("gdExport").addEventListener("click", exportDoc);
    document.addEventListener("keydown", (e) => {
      if ($("view-goodnotes").hidden || selected < 0) return;
      if ((e.key === "Delete" || e.key === "Backspace") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        page().items.splice(selected, 1);
        select(-1);
        save();
        renderPages();
      }
    });
    syncPageFields();
    renderPages();
    showProps();
    render();
  }

  init();
})();
