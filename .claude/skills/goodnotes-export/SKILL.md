---
name: goodnotes-export
description: Erzeugt .goodnotes-Dateien (Goodnotes) im Browser mit bearbeitbaren Strichen, PDF-/Bild-Seiten oder aus Fotos erkannter Schrift. Verwenden, wenn ein Projekt etwas nach Goodnotes exportieren soll, das dort radierbar/verschiebbar sein muss.
---

# Goodnotes-Export (goodnotes-kit)

Der fertige, getestete Baustein liegt in `goodnotes-kit/` dieses Repos
(github.com/mBurmeisterL/Text-umwandler). Er besteht aus einer einzigen Datei ohne Abhängigkeiten:
`goodnotes-kit/goodnotes.js`, dazu kommen `README.md` (API mit Beispielen) und `demo.html`.

## Vorgehen in einem anderen Projekt

1. `goodnotes-kit/` aus diesem Repo ins Zielprojekt kopieren.
2. `<script src="goodnotes-kit/goodnotes.js"></script>` einbinden; die API liegt an `window.GoodnotesExport`.
3. Für den Anwendungsfall die passende Funktion nehmen (Details in `goodnotes-kit/README.md`):
   - eigene Striche → `buildDocument(pages, opts)`
   - Bilder → `fromImages(images, { editable })`
   - PDF → `fromPdf(pdfBytes, pageSizes)`
   - Canvas-Text/-Zeichnung → `createRecorder()` + `strokesFromOps(rec.ops)`
4. Die Datei als `File` mit Endung `.goodnotes` über `navigator.share` (iPad → Goodnotes) oder als Download ausgeben.

## Wichtige Regeln

- Nur Kugelschreiber-Striche schreiben (Schema `vuA(v)A(S(uu))A(S(uuuu))vA(f)`, Stift 0).
  Füller/Pinsel lassen Goodnotes abstürzen.
- Die Strichdicke ist die volle Breite in Goodnotes-Einheiten; 1 pt = 11/6 Einheiten.
- Seitenhintergründe sind immer PDF-Seiten (Bilder per `makePdf` einpacken).
- Ohne iPad prüfen: mit `goodnotes-codec` (github.com/Taylor-Nilsen/goodnotes-codec)
  `python -m goodnotes.svg export datei.goodnotes 0 seite.svg` und das SVG ansehen.
