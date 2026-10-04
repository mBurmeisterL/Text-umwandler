// Eigene Handschrift: Buchstaben selbst zeichnen (Apple Pencil, Finger oder Maus),
// im Browser speichern und beim Rendern statt einer Schriftart verwenden.
(() => {
  "use strict";

  const STORE_KEY = "text-umwandler:glyphs:v1";

  // Zeichenfeld in em-Einheiten, Ursprung auf der Grundlinie
  const PAD_TOP = -1.1;
  const PAD_BOTTOM = 0.5;
  const PAD_HEIGHT = PAD_BOTTOM - PAD_TOP;
  const PAD_WIDTH = 2.0;
  const GUIDES = [
    { y: -0.75, label: "Großbuchstaben" },
    { y: -0.42, label: "Kleinbuchstaben" },
    { y: 0, label: "Grundlinie", strong: true },
    { y: 0.3, label: "Unterlänge" },
  ];

  const GROUPS = [
    ["Kleinbuchstaben", "abcdefghijklmnopqrstuvwxyzäöüß"],
    ["Großbuchstaben", "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ"],
    ["Zahlen", "0123456789"],
    ["Satzzeichen", ".,!?-–:;()\"'„“/&@€%+="],
  ];
  const ALL_CHARS = GROUPS.flatMap(([, chars]) => [...chars]);

  const GAP = 0.1;          // Abstand nach jedem Zeichen (em)
  const MAX_VARIANTS = 8;
  const TARGET_KEY = "text-umwandler:hwtarget";
  const PAD_INK = "#1d3a8a";

  let glyphs = {};
  let target = 3;           // gewünschte Varianten pro Zeichen
  const listeners = [];

  // ---------- Speicher ----------

  function isValidGlyphs(obj) {
    if (!obj || typeof obj !== "object") return false;
    return Object.values(obj).every((vs) =>
      Array.isArray(vs) && vs.every((v) => v && (Array.isArray(v.s) || typeof v.img === "string") && typeof v.w === "number" && typeof v.l === "number")
    );
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (data && isValidGlyphs(data.glyphs)) glyphs = data.glyphs;
    } catch (_) { glyphs = {}; }
    try {
      const t = Number(localStorage.getItem(TARGET_KEY));
      if (t >= 1 && t <= 5) target = t;
    } catch (_) { /* egal */ }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, glyphs }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function changed() {
    const ok = persist();
    listeners.forEach((fn) => fn());
    return ok;
  }

  // ---------- Glyphen ----------

  function makeGlyph(strokes) {
    let minX = Infinity, maxX = -Infinity;
    for (const st of strokes) for (const [x] of st) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    return { s: strokes, l: minX, w: Math.max(0.05, maxX - minX) };
  }

  function avgWidth(ch) {
    const vs = glyphs[ch];
    return vs.reduce((a, v) => a + v.w, 0) / vs.length;
  }

  function strokeWidth(penWidth, p) {
    return penWidth * (0.55 + 0.9 * p);
  }

  // Zeichnet Striche (Koordinaten in em) mit druckabhängiger Linienstärke
  function drawStrokes(ctx, strokes, em, penWidth, ox, oy) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const st of strokes) {
      if (!st.length) continue;
      if (st.length === 1) {
        const [x, y, p] = st[0];
        ctx.beginPath();
        ctx.arc(ox + x * em, oy + y * em, strokeWidth(penWidth, p) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      let mx = st[0][0], my = st[0][1];
      for (let i = 1; i < st.length; i++) {
        const [x0, y0, p0] = st[i - 1];
        const [x1, y1, p1] = st[i];
        const nx = (x0 + x1) / 2, ny = (y0 + y1) / 2;
        ctx.beginPath();
        ctx.lineWidth = strokeWidth(penWidth, (p0 + p1) / 2);
        ctx.moveTo(ox + mx * em, oy + my * em);
        ctx.quadraticCurveTo(ox + x0 * em, oy + y0 * em, ox + nx * em, oy + ny * em);
        ctx.stroke();
        mx = nx; my = ny;
      }
      const [lx, ly, lp] = st[st.length - 1];
      ctx.beginPath();
      ctx.lineWidth = strokeWidth(penWidth, lp);
      ctx.moveTo(ox + mx * em, oy + my * em);
      ctx.lineTo(ox + lx * em, oy + ly * em);
      ctx.stroke();
    }
  }

  // Aus einer Vorlage eingelesene Zeichen sind Bilder (Alpha-Maske), die in Tintenfarbe eingefärbt werden
  const imageCache = new Map();
  const tintCache = new Map();

  function imageFor(v) {
    let im = imageCache.get(v.img);
    if (!im) {
      im = new Image();
      im.src = v.img;
      imageCache.set(v.img, im);
    }
    return im;
  }

  function tinted(v, color) {
    const key = color + "|" + v.img;
    let c = tintCache.get(key);
    if (c) return c;
    const im = imageFor(v);
    if (!im.complete || !im.naturalWidth) return null;
    c = document.createElement("canvas");
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(im, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    if (tintCache.size > 3000) tintCache.clear();
    tintCache.set(key, c);
    return c;
  }

  // Wartet, bis alle Bild-Zeichen geladen sind
  function ready() {
    const waits = [];
    for (const vs of Object.values(glyphs)) {
      for (const v of vs) {
        if (!v.img) continue;
        const im = imageFor(v);
        if (!im.complete) waits.push(new Promise((res) => { im.onload = im.onerror = res; }));
      }
    }
    return Promise.all(waits);
  }

  // Zeichnet eine Variante; (ox, oy) ist der Ursprung des Zeichenfelds auf der Grundlinie
  function drawVariantAt(ctx, v, em, penWidth, ox, oy) {
    if (v.img) {
      const t = tinted(v, ctx.fillStyle);
      if (t) ctx.drawImage(t, ox + v.bx * em, oy + v.by * em, v.bw * em, v.bh * em);
      return;
    }
    ctx.strokeStyle = ctx.fillStyle;
    drawStrokes(ctx, v.s, em, penWidth, ox, oy);
  }

  // Zeichnet eine Variante mit linker Kante bei x = offsetX, Grundlinie bei y = 0
  function drawGlyph(ctx, variant, em, penWidth, offsetX = 0) {
    drawVariantAt(ctx, variant, em, penWidth, offsetX - variant.l * em, 0);
  }

  function renderPreview(canvas, variant) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const em = h / PAD_HEIGHT;
    const scale = Math.min(1, (w * 0.85) / (variant.w * em));
    const e = em * scale;
    ctx.fillStyle = PAD_INK;
    if (variant.img) {
      const im = imageFor(variant);
      if (!im.complete) { im.addEventListener("load", () => renderPreview(canvas, variant), { once: true }); return; }
    }
    drawVariantAt(ctx, variant, e, e * 0.06, (w - variant.w * e) / 2 - variant.l * e, h / 2 + (-PAD_TOP - PAD_HEIGHT / 2) * e);
  }

  // ---------- Editor ----------

  const $ = (id) => document.getElementById(id);
  let overlay, pad, padCtx;
  const closeListeners = [];
  let current = ALL_CHARS[0];
  let drafts = [];
  let activeStroke = null;
  let penSeen = false;
  let tiles = {};

  function padEm() {
    return pad.width / PAD_WIDTH;
  }

  function resizePad() {
    const rect = pad.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    pad.width = Math.round(rect.width * dpr);
    pad.height = Math.round(rect.width * (PAD_HEIGHT / PAD_WIDTH) * dpr);
    redrawPad();
  }

  function redrawPad() {
    const ctx = padCtx;
    const em = padEm();
    const oy = -PAD_TOP * em;
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.fillStyle = "#fffefa";
    ctx.fillRect(0, 0, pad.width, pad.height);

    // Hilfsbuchstabe
    ctx.save();
    ctx.font = `${em * 1.05}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    const gw = ctx.measureText(current).width;
    ctx.fillText(current, (pad.width - gw) / 2, oy);
    ctx.restore();

    // Hilfslinien
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    for (const g of GUIDES) {
      const y = Math.round(oy + g.y * em) + 0.5;
      ctx.strokeStyle = g.strong ? "rgba(40,80,160,0.55)" : "rgba(40,80,160,0.25)";
      ctx.lineWidth = (g.strong ? 2 : 1) * dpr;
      ctx.setLineDash(g.strong ? [] : [6 * dpr, 6 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(pad.width, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(40,80,160,0.45)";
      ctx.fillText(g.label, 8 * dpr, y - 4 * dpr);
    }
    ctx.restore();

    ctx.fillStyle = ctx.strokeStyle = PAD_INK;
    drawStrokes(ctx, drafts, em, em * 0.05, 0, oy);
  }

  function pointFromEvent(e) {
    const rect = pad.getBoundingClientRect();
    const emCss = rect.width / PAD_WIDTH;
    const x = (e.clientX - rect.left) / emCss;
    const y = (e.clientY - rect.top) / emCss + PAD_TOP;
    const p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    const r = (v) => Math.round(v * 1000) / 1000;
    return [r(x), r(y), r(p)];
  }

  function onPointerDown(e) {
    if (e.pointerType === "pen") penSeen = true;
    if (e.pointerType === "touch" && penSeen) return; // Handballen ignorieren
    if (e.button > 0) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    activeStroke = [pointFromEvent(e)];
    drafts.push(activeStroke);
    redrawPad();
  }

  function onPointerMove(e) {
    if (!activeStroke) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const pt = pointFromEvent(ev);
      const last = activeStroke[activeStroke.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.006) continue;
      activeStroke.push(pt);
    }
    redrawPad();
  }

  function onPointerUp() {
    activeStroke = null;
  }

  function setStatus(msg) {
    $("hwStatus").textContent = msg || "";
  }

  // Gezeichnetes wird immer übernommen, sobald man weitergeht
  function commitDraft() {
    if (!drafts.length) return;
    const list = glyphs[current] || (glyphs[current] = []);
    list.push(makeGlyph(drafts));
    if (list.length > MAX_VARIANTS) list.shift();
    drafts = [];
    if (!changed()) setStatus("Speicher voll – bitte über „Sichern“ eine Datei herunterladen.");
    updateTile(current);
    updateProgress();
  }

  function select(ch) {
    commitDraft();
    current = ch;
    drafts = [];
    $("hwChar").textContent = ch;
    for (const [c, t] of Object.entries(tiles)) t.classList.toggle("current", c === ch);
    if (tiles[ch]) tiles[ch].scrollIntoView({ block: "nearest" });
    renderVariants();
    redrawPad();
    setStatus("");
  }

  // Weiter: beim selben Zeichen bleiben, bis genug Varianten geschrieben sind
  function next() {
    const drew = drafts.length > 0;
    commitDraft();
    const n = (glyphs[current] || []).length;
    if (drew && n < target) {
      renderVariants();
      redrawPad();
      setStatus(`Gut! Jetzt „${current}“ noch einmal schreiben (${n + 1} von ${target}).`);
      return;
    }
    step(1);
  }

  function step(dir) {
    const i = ALL_CHARS.indexOf(current);
    select(ALL_CHARS[(i + dir + ALL_CHARS.length) % ALL_CHARS.length]);
  }

  function renderVariants() {
    const box = $("hwVariants");
    box.innerHTML = "";
    const vs = glyphs[current] || [];
    $("hwVarCount").textContent = `${Math.min(vs.length, 99)} von ${target} Varianten`;
    $("hwVarCount").classList.toggle("ok", vs.length >= target);
    vs.forEach((v, i) => {
      const wrap = document.createElement("div");
      wrap.className = "hw-variant";
      const c = document.createElement("canvas");
      c.width = 96; c.height = 76;
      renderPreview(c, v);
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.title = "Variante löschen";
      del.addEventListener("click", () => {
        vs.splice(i, 1);
        if (!vs.length) delete glyphs[current];
        changed();
        updateTile(current);
        updateProgress();
        renderVariants();
      });
      wrap.append(c, del);
      box.appendChild(wrap);
    });
  }

  function updateTile(ch) {
    const t = tiles[ch];
    if (!t) return;
    const vs = glyphs[ch];
    t.classList.toggle("done", !!vs);
    t.classList.toggle("partial", !!vs && vs.length < target);
    t.querySelectorAll("canvas, .badge").forEach((el) => el.remove());
    if (vs) {
      const c = document.createElement("canvas");
      c.width = 80; c.height = 64;
      renderPreview(c, vs[0]);
      t.appendChild(c);
      if (vs.length > 1) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = vs.length;
        t.appendChild(b);
      }
    }
  }

  function updateProgress() {
    const done = ALL_CHARS.filter((c) => glyphs[c]).length;
    $("hwProgress").textContent = `${done} / ${ALL_CHARS.length} Zeichen`;
  }

  function buildTiles() {
    const box = $("hwChars");
    box.innerHTML = "";
    tiles = {};
    for (const [title, chars] of GROUPS) {
      const h = document.createElement("h3");
      h.textContent = title;
      const grid = document.createElement("div");
      grid.className = "hw-grid";
      for (const ch of chars) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hw-tile";
        b.innerHTML = `<span class="lbl"></span>`;
        b.querySelector(".lbl").textContent = ch;
        b.setAttribute("aria-label", `Zeichen ${ch}`);
        b.addEventListener("click", () => select(ch));
        tiles[ch] = b;
        grid.appendChild(b);
        updateTile(ch);
      }
      box.append(h, grid);
    }
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify({ app: "text-umwandler", version: 1, glyphs })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meine-handschrift.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!isValidGlyphs(data.glyphs)) throw new Error("ungültig");
      if (Object.keys(glyphs).length && !confirm("Vorhandene Buchstaben durch die Datei ersetzen?")) return;
      glyphs = data.glyphs;
      drafts = [];
      changed();
      buildTiles();
      select(current);
      updateProgress();
      setStatus("Handschrift geladen.");
    } catch (_) {
      setStatus("Die Datei konnte nicht gelesen werden.");
    }
  }

  // Eigenes Overlay statt <dialog>, damit es auch in älteren Safari-Versionen funktioniert
  function isOpen() {
    return !overlay.hidden;
  }

  // Meldung direkt unter einem Upload-Button; kind: "busy" | "error" | "ok"
  function sectionStatus(statusId, buttonId) {
    return (msg, kind) => {
      const el = $(statusId);
      el.textContent = msg || "";
      el.hidden = !msg;
      el.className = "scan-status" + (kind ? " " + kind : "");
      const btn = buttonId && $(buttonId);
      if (btn) {
        btn.classList.toggle("disabled", kind === "busy");
        const input = btn.querySelector("input");
        if (input) input.disabled = kind === "busy";
      }
      if (msg) el.scrollIntoView({ block: "nearest" });
    };
  }

  // Übernimmt Zeichen aus einer eingelesenen Vorlage; gleiche Kästchen ersetzen frühere Importe
  function importGlyphs(list) {
    commitDraft();
    for (const { ch, glyph } of list) {
      const vs = (glyphs[ch] || []).filter((v) => !glyph.src || v.src !== glyph.src);
      vs.push(glyph);
      while (vs.length > MAX_VARIANTS) vs.shift();
      glyphs[ch] = vs;
    }
    const ok = changed();
    ALL_CHARS.forEach(updateTile);
    renderVariants();
    updateProgress();
    redrawPad();
    return ok;
  }

  function open() {
    overlay.hidden = false;
    document.body.classList.add("modal-open");
    resizePad();
    select(current);
  }

  function close() {
    if (!isOpen()) return;
    commitDraft();
    activeStroke = null;
    overlay.hidden = true;
    document.body.classList.remove("modal-open");
    closeListeners.forEach((fn) => fn());
  }

  function init() {
    load();
    overlay = $("hwDialog");
    pad = $("hwPad");
    padCtx = pad.getContext("2d");

    pad.addEventListener("pointerdown", onPointerDown);
    pad.addEventListener("pointermove", onPointerMove);
    pad.addEventListener("pointerup", onPointerUp);
    pad.addEventListener("pointercancel", onPointerUp);
    pad.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    window.addEventListener("resize", () => { if (isOpen()) resizePad(); });

    $("hwUndo").addEventListener("click", () => { drafts.pop(); redrawPad(); });
    $("hwClear").addEventListener("click", () => { drafts = []; redrawPad(); });
    $("hwPrev").addEventListener("click", () => step(-1));
    $("hwNext").addEventListener("click", next);
    const targetSel = $("hwTarget");
    targetSel.value = String(target);
    targetSel.addEventListener("change", () => {
      target = Number(targetSel.value);
      try { localStorage.setItem(TARGET_KEY, String(target)); } catch (_) { /* egal */ }
      ALL_CHARS.forEach(updateTile);
      renderVariants();
    });
    $("hwAgain").addEventListener("click", () => {
      if (!drafts.length) { setStatus("Erst etwas zeichnen."); return; }
      commitDraft();
      renderVariants();
      redrawPad();
      setStatus("Gespeichert – jetzt die nächste Variante schreiben.");
    });
    $("hwExport").addEventListener("click", () => { commitDraft(); exportFile(); });
    $("hwImport").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) importFile(f);
      e.target.value = "";
    });
    $("hwReset").addEventListener("click", () => {
      if (!confirm("Wirklich alle gezeichneten Buchstaben löschen?")) return;
      glyphs = {};
      drafts = [];
      changed();
      buildTiles();
      select(ALL_CHARS[0]);
      updateProgress();
    });
    $("hwDone").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); drafts.pop(); redrawPad(); }
      else if (e.key === "Enter" && e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") { e.preventDefault(); next(); }
    });

    buildTiles();
    updateProgress();
  }

  window.Handschrift = {
    GAP,
    CHARS: ALL_CHARS,
    PAD: { top: PAD_TOP, height: PAD_HEIGHT, width: PAD_WIDTH, guides: GUIDES },
    init,
    ready,
    importGlyphs,
    setStatus: (msg) => setStatus(msg),
    sectionStatus,
    open,
    onClose: (fn) => closeListeners.push(fn),
    has: (ch) => !!glyphs[ch],
    variants: (ch) => glyphs[ch] || [],
    avgWidth,
    count: () => Object.keys(glyphs).length,
    drawGlyph,
    onChange: (fn) => listeners.push(fn),
  };
})();
