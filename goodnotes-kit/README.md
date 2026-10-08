# goodnotes-kit

Erzeugt **echte Goodnotes-Dateien (`.goodnotes`) direkt im Browser**. Es braucht keinen Server und keine weiteren
Bibliotheken: eine einzige Datei, `goodnotes.js`.

Der Unterschied zu einem PDF: Striche aus diesem Baustein sind in Goodnotes **echte Tinte**. Man kann sie
radieren, mit dem Lasso markieren, verschieben, vergrößern und umfärben. Ein PDF dagegen wird von Goodnotes
nur als unveränderlicher Hintergrund importiert.

Getestet im Oktober 2026 mit Goodnotes auf dem iPad: Die Dateien öffnen sich, die Schrift ist radierbar und
verschiebbar, auch bei mehreren Seiten.

## In ein neues Projekt übernehmen

1. Den Ordner `goodnotes-kit/` (oder nur `goodnotes.js`) ins Projekt kopieren.
2. Einbinden:
   ```html
   <script src="goodnotes-kit/goodnotes.js"></script>
   ```
3. Alles hängt danach an `window.GoodnotesExport`.

`demo.html` in diesem Ordner zeigt alles in Aktion. Einfach im Browser öffnen.

## Beispiele

### Bilder → Goodnotes

```js
const G = window.GoodnotesExport;
// images: Canvas- oder <img>-Elemente
const blob = await G.fromImages(images, { title: "Meine Notizen" });
// editable: true = dunkle Schrift auf den Bildern wird zu bearbeitbaren Strichen
const blob2 = await G.fromImages(images, { editable: true, contrast: 0.28 });
```

### PDF → Goodnotes (PDF bleibt scharf als Hintergrund)

```js
// pdfBytes: Uint8Array; pageSizes: [[breitePt, höhePt], ...], z. B. mit PDF.js ermittelt
const blob = await G.fromPdf(pdfBytes, pageSizes, { title: "Arbeitsblatt" });
```

### Eigene Striche (z. B. aus einer Zeichen-App)

```js
const blob = await G.buildDocument([
  {
    sizePt: [595.28, 841.89],        // A4 in pt
    sizePx: [1240, 1754],            // Koordinatensystem der Striche (hier Pixel)
    strokes: [
      { pts: [[100, 100], [300, 120], [500, 100]], w: 4, color: "#1d3a8a" },
      { pts: [[100, 200], [500, 260]], w: 2, color: [1, 0, 0, 1] },   // RGBA 0..1 geht auch
    ],
    // background: { pdf: pdfBytes, page: 1 }   // optional, sonst weiß
  },
], { title: "Skizze" });
```

### Alle Goodnotes-Elemente

Neben `strokes` kann jede Seite eine Liste `items` haben. Sie werden in dieser Reihenfolge übereinander gelegt.
Koordinaten und Größen sind, wie bei den Strichen, im Koordinatensystem `sizePx` der Seite.

```js
await G.buildDocument([{
  sizePt: [595.28, 841.89],             // A4; ohne sizePx sind die Koordinaten in pt
  bookmark: true,                       // Lesezeichen
  rotation: 90,                         // Seite drehen (90, 180, 270)
  outline: "Kapitel 1",                 // Eintrag im Inhaltsverzeichnis
  items: [
    { type: "text", x: 40, y: 30, w: 500, h: 40, text: "Hallo", size: 20, font: "Helvetica Neue", color: "#1d3a8a", bold: true },
    { type: "text", x: 40, y: 80, w: 500, h: 30, text: [                         // mehrere Formatierungen
        { text: "fett ", bold: true }, { text: "kursiv ", italic: true },
        { text: "Link", link: "https://example.com", color: "#1565c0" },
        { text: " → Seite 2", link: { page: 1 } } ] },                              // Link auf eine Seite (Index)
    { type: "shape", shape: "rect", x: 40, y: 130, w: 120, h: 80, radius: 12,          // rect | ellipse | polygon
      fill: "#dbe9ff", outline: { width: 2, color: "#1d3a8a", dash: "dashed" }, text: "Form mit Text" },
    { type: "shape", shape: "polygon", vertices: [[0.5, 0], [1, 1], [0, 1]], x: 200, y: 130, w: 80, h: 80, fill: "#fff3b0" },
    { type: "stroke", pts: [[40, 250], [200, 260]], w: 2, color: "#000" },               // Kugelschreiber
    { type: "highlighter", pts: [[40, 280], [300, 280]], w: 16, color: [1, 0.85, 0, 0.45] },
    { type: "pencil", pts: [[40, 310], [300, 330]], w: 2.5 },                            // Bleistift
    { type: "shapeStroke", shape: "rect", center: [100, 380], size: [120, 60] },         // Form-Werkzeug
    { type: "shapeStroke", shape: "ellipse", center: [260, 380], radii: [60, 30] },
    { type: "shapeStroke", shape: "polyline", points: [[340, 410], [380, 350], [420, 410]] },
    { type: "line", from: [40, 460], to: [250, 460], endArrow: "open" },                  // Linie mit Pfeil
    { type: "line", from: [280, 480], via: [360, 430], to: [440, 480], startArrow: "filled", endArrow: "filled", dash: "dotted" },
    { type: "line", from: [460, 440], to: [550, 500], elbow: true },                      // Winkelverbinder
    { type: "sticky", x: 40, y: 520, w: 160, h: 120, text: "Haftnotiz", color: [0.98, 0.906, 0.471, 1] },
    { type: "image", data: pngOderJpegBytes, x: 260, y: 530, w: 100, h: 100, angle: 0.4 },
  ],
}]);
```

Geprüft wurde Folgendes:
- **Aufbau:** Jede Elementart wurde Feld für Feld mit der Referenz-Bibliothek goodnotes-codec verglichen. Die Abweichungen sind nur gewollt (laufende Nummern, Zähler wie in echten Dateien, ausdrückliche Schriftgröße).
- **Bereits in Goodnotes geprüft:** Laut goodnotes-codec sind das Kugelschreiber, Textmarker, Formen, Textfelder, Haftnotizen, Linien und Bilder.
- **Noch nicht in Goodnotes geprüft:** Bleistift, Form-Werkzeug, gestrichelte Linien, gefüllte Pfeile, Links, Lesezeichen, Drehung und Inhaltsverzeichnis.
- **Nicht eingebaut:** Füller und Pinsel mit variabler Breite, weil Goodnotes beim Import abstürzt. Klebeband, Audioaufnahmen und Mathe-Umwandlung fehlen ebenfalls.

### Canvas-Text in Striche umwandeln

```js
const rec = G.createRecorder();         // tut so, als wäre es ein CanvasRenderingContext2D
rec.font = '48px "Caveat"';
rec.fillText("Hallo", 100, 200);        // auch save/restore/translate/rotate/scale/drawImage
const strokes = G.strokesFromOps(rec.ops);
const blob = await G.buildDocument([{ strokes, sizePx: [1240, 1754] }], { ink: "#1d3a8a" });
```

### Datei an den Nutzer geben

**Wichtig für iPad/iPhone:** Safari erlaubt `navigator.share()` nur etwa 1 Sekunde nach dem Antippen.
Dauert das Erstellen der Datei länger, wird das Teilen blockiert und es passiert scheinbar nichts. Deshalb:
Datei erst erstellen, dann einen Knopf „An Goodnotes senden“ zeigen, der beim Antippen **sofort** (ohne
`await` davor) `navigator.share()` aufruft. Fertige Lösung: `share.js` im Text-Umwandler
(`ShareFiles.deliver(files, { title, hint, shareLabel })`). Kurz gefasst:

```js
const file = new File([blob], "notizen.goodnotes", { type: "application/octet-stream" });
if (navigator.canShare && navigator.canShare({ files: [file] })) {
  await navigator.share({ files: [file] });      // iPad: Teilen-Menü → Goodnotes
} else {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
}
```

## Alle Funktionen

| Funktion | Zweck |
|---|---|
| `buildDocument(pages, opts)` | Baut die `.goodnotes`-Datei (Blob). `pages[i]`: `{ strokes, items, sizePt, sizePx, background, bookmark, rotation, outline }`. `opts`: `{ title, ink, thumbnail, language, pagePt, pagePx, background }` |
| `fromImages(images, opts)` | Bilder → Blob; `opts.editable` macht Schrift zu Strichen |
| `fromImagesPages(images, opts)` | wie `fromImages`, liefert aber nur die Seiten (zum Mischen mit PDF-Seiten) |
| `fromPdf(pdfBytes, pageSizes, opts, renderPage?)` | PDF → Blob (mit `opts.editable` und `renderPage(i) → Canvas` auch mit Strichen) |
| `strokesFromCanvas(canvas, opts)` | Tinte im Bild finden → `{ strokes, cleaned }`. `cleaned` ist das Bild ohne Tinte: Papierfarbe und Papierlinien (liniert, kariert, Randlinie) werden passend zur Schräglage des Fotos durchgezogen, damit nach dem Radieren keine Spuren bleiben |
| `createRecorder()` / `strokesFromOps(ops)` | Canvas-Zeichenbefehle aufzeichnen → Striche |
| `vectorize(alpha, w, h)` | Alpha-Maske → Mittellinien-Striche |
| `makePdf(pages)` | kleines PDF aus JPEGs (`{ wPt, hPt, jpeg, imgW, imgH }`) oder leeren Seiten |
| `canvasToJpeg(canvas, q)` | Canvas → JPEG-Bytes |

Ein Strich ist `{ pts: [[x, y], ...], w, color? }`: Punkte im Koordinatensystem `sizePx` der Seite, `w` ist die
volle Strichbreite in denselben Einheiten. `color` ist `"#rrggbb"` oder `[r, g, b, a]` mit Werten 0..1.

## Wissenswertes zum Format

- Eine `.goodnotes`-Datei ist ein ZIP mit Protobuf-Datensätzen. Die Geometrie liegt LZ4-verpackt in
  „bv41“-Blöcken. Aufbau nach [goodnotes-codec](https://github.com/Taylor-Nilsen/goodnotes-codec)
  (`docs/FORMAT.md`) und dem Vergleich mit echten Goodnotes-Dateien.
- Einheiten: 1 pt = 11/6 Goodnotes-Einheiten (A4 = 1091,35 × 1543,46).
- Es werden nur **Kugelschreiber-Striche** geschrieben, also mit einheitlicher Breite pro Strich.
  Füller/Pinsel mit variabler Breite lassen Goodnotes laut goodnotes-codec abstürzen.
- Hintergründe sind immer PDF-Seiten. Bilder werden dafür in ein einseitiges PDF verpackt.
- Das Format ist nicht offiziell. Falls eine künftige Goodnotes-Version die Dateien nicht mehr öffnet, kann
  man mit dem Python-Paket goodnotes-codec eine aktuelle Goodnotes-Datei untersuchen und vergleichen.

## Prüfen ohne iPad

Die Testwerkzeuge, mit denen dieser Baustein entwickelt wurde:

```bash
git clone https://github.com/Taylor-Nilsen/goodnotes-codec
cd goodnotes-codec
python -m goodnotes.svg export datei.goodnotes 0 seite1.svg   # Seite als SVG ansehen
```

Gelingt der Export als SVG und sieht das Bild richtig aus, war bisher auch der Import in Goodnotes erfolgreich.
