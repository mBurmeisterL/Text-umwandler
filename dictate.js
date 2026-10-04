// Diktieren: Sprache per Mikrofon in ein Textfeld schreiben (Web Speech API, z. B. Safari auf dem iPad).
(() => {
  "use strict";

  const LANG_KEY = "text-umwandler:dictlang";
  const LANGS = [
    ["de-DE", "Deutsch"], ["en-US", "Englisch"], ["fr-FR", "Französisch"], ["es-ES", "Spanisch"],
    ["it-IT", "Italienisch"], ["pt-PT", "Portugiesisch"], ["nl-NL", "Niederländisch"], ["pl-PL", "Polnisch"],
    ["cs-CZ", "Tschechisch"], ["hr-HR", "Kroatisch"], ["ro-RO", "Rumänisch"], ["hu-HU", "Ungarisch"],
    ["el-GR", "Griechisch"], ["tr-TR", "Türkisch"], ["ru-RU", "Russisch"], ["uk-UA", "Ukrainisch"],
    ["ar-SA", "Arabisch"], ["zh-CN", "Chinesisch"], ["ja-JP", "Japanisch"], ["ko-KR", "Koreanisch"],
  ];

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function savedLang() {
    try {
      const l = localStorage.getItem(LANG_KEY);
      if (l && LANGS.some(([c]) => c === l)) return l;
    } catch (_) { /* egal */ }
    return "de-DE";
  }

  function fillLanguages(select) {
    for (const [code, name] of LANGS) select.add(new Option(name, code));
    select.value = savedLang();
    select.addEventListener("change", () => {
      try { localStorage.setItem(LANG_KEY, select.value); } catch (_) { /* egal */ }
      for (const s of document.querySelectorAll("select.dict-lang")) s.value = select.value;
    });
  }

  // button: Start/Stopp, textarea: Ziel, select: Sprache, say(text, art): Meldungen
  function attach({ button, textarea, select, say }) {
    fillLanguages(select);
    if (!Recognition) {
      button.addEventListener("click", () => {
        say("Dieser Browser kann nicht diktieren. Tipp: Auf dem iPad geht es auch über die Mikrofon-Taste der Tastatur.", "error");
      });
      return;
    }

    let rec = null;
    let base = "";
    let finalText = "";

    const label = button.innerHTML;
    const setActive = (on) => {
      button.classList.toggle("recording", on);
      button.innerHTML = on ? "⏹ <span>Stopp</span>" : label;
    };

    function stop() {
      if (rec) rec.stop();
    }

    function start() {
      rec = new Recognition();
      rec.lang = select.value;
      rec.continuous = true;
      rec.interimResults = true;
      base = textarea.value;
      if (base && !/\s$/.test(base)) base += " ";
      finalText = "";

      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        textarea.value = base + finalText + interim;
        textarea.dispatchEvent(new Event("input"));
      };
      rec.onerror = (e) => {
        const msg = {
          "not-allowed": "Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben (Safari → Mikrofon).",
          "service-not-allowed": "Diktieren ist auf diesem Gerät nicht erlaubt (Einstellungen → Allgemein → Tastatur → Diktieren).",
          "no-speech": "Es wurde nichts gehört – bitte nochmal versuchen.",
          "network": "Für das Diktieren wird eine Internetverbindung gebraucht.",
        }[e.error];
        if (msg) say(msg, "error");
      };
      rec.onend = () => {
        setActive(false);
        rec = null;
        textarea.value = (base + finalText).replace(/\s+$/, "");
        textarea.dispatchEvent(new Event("input"));
      };
      try {
        rec.start();
        setActive(true);
        say("🎤 Sprich jetzt … zum Beenden auf „Stopp“ tippen.");
      } catch (_) {
        say("Diktieren konnte nicht gestartet werden.", "error");
        rec = null;
      }
    }

    button.addEventListener("click", () => (rec ? stop() : start()));
  }

  window.Diktat = { attach, supported: !!Recognition };
})();
