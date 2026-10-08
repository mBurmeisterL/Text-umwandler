// Fertige Dateien an den Nutzer geben: Teilen-Menü (iPad/iPhone) oder Download.
//
// Safari erlaubt das Teilen-Menü nur kurz nach einem Antippen. Dauert das Erstellen der Datei länger,
// würde navigator.share() blockiert. Dann erscheint ein kleines Fenster „Fertig“ mit einem Knopf,
// der direkt beim Antippen teilt.
(() => {
  "use strict";

  let sheet = null;

  const sizeText = (n) => (n > 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB");

  function download(files) {
    files.forEach((f, i) => {
      setTimeout(() => {
        const url = URL.createObjectURL(f);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }, i * 350);
    });
  }

  function canShare(files) {
    try {
      return !!(navigator.canShare && navigator.canShare({ files }));
    } catch (_) {
      return false;
    }
  }

  // Wird der Klick noch als „gerade eben angetippt“ gezählt?
  function gestureActive() {
    return !!(navigator.userActivation && navigator.userActivation.isActive);
  }

  function close() {
    if (sheet) sheet.hidden = true;
  }

  function showSheet(files, opts, resolve) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "share-overlay";
      sheet.innerHTML = `
        <div class="share-sheet" role="dialog" aria-modal="true" aria-labelledby="shareTitle">
          <p class="share-check" aria-hidden="true">✓</p>
          <h2 id="shareTitle"></h2>
          <p class="share-files"></p>
          <p class="share-hint"></p>
          <div class="share-actions">
            <button type="button" class="btn primary share-go">📤 Teilen</button>
            <button type="button" class="btn ghost share-save">⬇️ Speichern</button>
          </div>
          <button type="button" class="share-close" aria-label="Schließen">✕</button>
        </div>`;
      document.body.appendChild(sheet);
      sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.querySelector(".share-close").click(); });
    }
    const files_ = sheet.querySelector(".share-files");
    sheet.querySelector("#shareTitle").textContent = opts.title || "Fertig!";
    files_.textContent = files.length === 1
      ? `„${files[0].name}“ (${sizeText(files[0].size)})`
      : `${files.length} Dateien (${sizeText(files.reduce((a, f) => a + f.size, 0))})`;
    sheet.querySelector(".share-hint").textContent = opts.hint || "";
    const go = sheet.querySelector(".share-go");
    const save = sheet.querySelector(".share-save");
    const x = sheet.querySelector(".share-close");
    go.hidden = !canShare(files);
    go.textContent = opts.shareLabel || "📤 Teilen";
    // Neue Handler (alte ersetzen)
    go.onclick = () => {
      // Direkt im Klick teilen – kein await davor
      navigator.share({ files }).then(
        () => { close(); resolve("shared"); },
        (e) => {
          if (e && e.name === "AbortError") return; // abgebrochen: Fenster bleibt offen
          close();
          download(files);
          resolve("downloaded");
        },
      );
    };
    save.onclick = () => { close(); download(files); resolve("downloaded"); };
    x.onclick = () => { close(); resolve("closed"); };
    sheet.hidden = false;
    (go.hidden ? save : go).focus();
  }

  /**
   * Gibt fertige Dateien aus. opts: { title, hint, shareLabel }
   * Ergebnis: "shared" | "downloaded" | "closed"
   */
  function deliver(files, opts = {}) {
    return new Promise((resolve) => {
      if (canShare(files)) {
        if (gestureActive()) {
          navigator.share({ files }).then(
            () => resolve("shared"),
            (e) => {
              if (e && e.name === "AbortError") { resolve("closed"); return; }
              showSheet(files, opts, resolve); // z. B. NotAllowedError: Antippen war zu lange her
            },
          );
          return;
        }
        showSheet(files, opts, resolve);
        return;
      }
      // Ohne Teilen-Funktion (z. B. Computer): direkt herunterladen
      download(files);
      resolve("downloaded");
    });
  }

  window.ShareFiles = { deliver, download };
})();
