// Hauptmenü: Wechsel zwischen Start, Handschrift und Übersetzer über die Adresse (#/…),
// dazu das gemeinsame Fenster für die KI-Einstellungen.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VIEWS = { "": "home", handschrift: "handschrift", uebersetzen: "uebersetzen", umwandeln: "umwandeln", goodnotes: "goodnotes" };
  const TITLES = {
    home: "Text-Umwandler",
    handschrift: "Handschrift – Text-Umwandler",
    uebersetzen: "Übersetzen – Text-Umwandler",
    umwandeln: "Umwandeln – Text-Umwandler",
    goodnotes: "Goodnotes-Seite gestalten – Text-Umwandler",
  };

  function currentView() {
    const route = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
    return VIEWS[route] || "home";
  }

  function show() {
    const view = currentView();
    for (const name of Object.values(VIEWS)) $("view-" + name).hidden = name !== view;
    // Der Goodnotes-Editor gehört zum Bereich „Umwandeln“
    const navView = view === "goodnotes" ? "umwandeln" : view;
    for (const a of document.querySelectorAll(".mainnav a[data-view]")) {
      const active = a.dataset.view === navView;
      a.classList.toggle("active", active);
      if (active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = TITLES[view];
    window.scrollTo(0, 0);
  }

  // ---------- KI-Einstellungen ----------

  function openSettings() {
    $("settingsDialog").hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeSettings() {
    $("settingsDialog").hidden = true;
    if ($("hwDialog").hidden) document.body.classList.remove("modal-open");
  }

  window.openSettings = openSettings;

  $("openSettings").addEventListener("click", openSettings);
  $("settingsDone").addEventListener("click", closeSettings);
  $("settingsDialog").addEventListener("click", (e) => {
    if (e.target === $("settingsDialog")) closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("settingsDialog").hidden) closeSettings();
  });

  // Hinweis zum Installieren nur im Browser zeigen (nicht in der installierten App) und bis zum Wegklicken
  const standalone = window.navigator.standalone || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  let tipHidden = false;
  try { tipHidden = localStorage.getItem("text-umwandler:installtip") === "aus"; } catch (_) { /* egal */ }
  $("installTip").hidden = standalone || tipHidden;
  $("installClose").addEventListener("click", () => {
    $("installTip").hidden = true;
    try { localStorage.setItem("text-umwandler:installtip", "aus"); } catch (_) { /* egal */ }
  });

  window.addEventListener("hashchange", show);
  show();
})();
