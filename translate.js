// Übersetzer: Text eintippen oder ein Bild hochladen, die KI liest den Text und übersetzt ihn.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const KI = () => window.HandschriftKI;
  const TARGET_KEY = "text-umwandler:trtarget";

  const els = {
    source: $("trSource"),
    result: $("trResult"),
    target: $("trTarget"),
    image: $("trImage"),
    imageBtn: $("trImageBtn"),
    preview: $("trPreview"),
    go: $("trGo"),
    status: $("trStatus"),
  };

  let busyNow = false;

  function say(msg, kind) {
    els.status.textContent = msg || "";
    els.status.className = "tr-status" + (kind ? " " + kind : "");
  }

  function busy(on) {
    busyNow = on;
    els.go.disabled = on;
    els.imageBtn.classList.toggle("disabled", on);
    els.image.disabled = on;
    els.status.classList.toggle("busy", on);
  }

  function needsSetup() {
    if (KI().hasKey()) return false;
    say("Für den Übersetzer braucht die Seite die KI. Tippe oben rechts auf „⚙️ KI-Einstellungen“ und richte Gemini, Claude oder deinen Cloudflare Worker ein.", "error");
    window.openSettings();
    return true;
  }

  async function translate() {
    const text = els.source.value.trim();
    if (!text) { say("Gib zuerst einen Text ein oder lade ein Bild hoch.", "error"); return; }
    if (needsSetup() || busyNow) return;
    const label = els.target.value; // z. B. „Englische“ → „ins Englische“
    busy(true);
    say(`Übersetze ins ${label} …`);
    try {
      const out = await KI().translate(text, els.target.value);
      if (!out) throw new Error("Die KI hat keine Übersetzung geliefert – bitte nochmal versuchen.");
      els.result.value = out;
      say(`✅ Ins ${label} übersetzt.`, "ok");
    } catch (e) {
      say("❌ " + KI().friendlyError(e), "error");
    } finally {
      busy(false);
    }
  }

  async function readImage(file) {
    if (needsSetup() || busyNow) return;
    busy(true);
    say("Lese den Text aus dem Bild … das kann etwas dauern.");
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
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      els.preview.src = dataUrl;
      els.preview.hidden = false;
      const text = await KI().readText(dataUrl.split(",")[1], "any");
      if (!text) throw new Error("Auf dem Bild wurde kein Text gefunden.");
      els.source.value = text;
      els.result.value = "";
    } catch (e) {
      busy(false);
      say("❌ " + KI().friendlyError(e), "error");
      return;
    }
    busy(false);
    await translate();
  }

  function init() {
    window.Diktat.attach({ button: $("trDictate"), textarea: els.source, select: $("trDictLang"), say });

    try {
      const t = localStorage.getItem(TARGET_KEY);
      if (t && [...els.target.options].some((o) => o.value === t)) els.target.value = t;
    } catch (_) { /* egal */ }

    els.target.addEventListener("change", () => {
      try { localStorage.setItem(TARGET_KEY, els.target.value); } catch (_) { /* egal */ }
      if (els.source.value.trim() && els.result.value.trim()) translate();
    });
    els.go.addEventListener("click", translate);
    els.source.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); translate(); }
    });

    els.image.addEventListener("click", (e) => {
      if (!KI().hasKey()) { e.preventDefault(); needsSetup(); }
    });
    els.image.addEventListener("change", () => {
      const f = els.image.files[0];
      els.image.value = "";
      if (f) readImage(f);
    });

    $("trClear").addEventListener("click", () => {
      els.source.value = "";
      els.result.value = "";
      els.preview.hidden = true;
      els.preview.removeAttribute("src");
      say("");
      els.source.focus();
    });

    $("trCopy").addEventListener("click", async () => {
      const t = els.result.value.trim();
      if (!t) { say("Es gibt noch keine Übersetzung zum Kopieren.", "error"); return; }
      try {
        await navigator.clipboard.writeText(t);
        say("📋 Übersetzung kopiert.", "ok");
      } catch (_) {
        els.result.select();
        say("Text ist markiert – jetzt über „Kopieren“ im Menü kopieren.");
      }
    });

    $("trToHand").addEventListener("click", () => {
      const t = els.result.value.trim();
      if (!t) { say("Es gibt noch keine Übersetzung.", "error"); return; }
      window.TextUmwandler.setText(t);
      location.hash = "#/handschrift";
    });
  }

  init();
})();
