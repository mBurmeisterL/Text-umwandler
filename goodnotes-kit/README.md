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

### Canvas-Text in Striche umwandeln

```js
const rec = G.createRecorder();         // tut so, als wäre es ein CanvasRenderingContext2D
rec.font = '48px "Caveat"';
rec.fillText("Hallo", 100, 200);        // auch save/restore/translate/rotate/scale/drawImage
const strokes = G.strokesFromOps(rec.ops);
const blob = await G.buildDocument([{ strokes, sizePx: [1240, 1754] }], { ink: "#1d3a8a" });
```

### Datei an den Nutzer geben

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
| `buildDocument(pages, opts)` | Baut die `.goodnotes`-Datei (Blob). `pages[i]`: `{ strokes, sizePt, sizePx, background }`. `opts`: `{ title, ink, thumbnail, language, pagePt, pagePx, background }` |
| `fromImages(images, opts)` | Bilder → Blob; `opts.editable` macht Schrift zu Strichen |
| `fromImagesPages(images, opts)` | wie `fromImages`, liefert aber nur die Seiten (zum Mischen mit PDF-Seiten) |
| `fromPdf(pdfBytes, pageSizes, opts, renderPage?)` | PDF → Blob (mit `opts.editable` und `renderPage(i) → Canvas` auch mit Strichen) |
| `strokesFromCanvas(canvas, opts)` | Tinte im Bild finden → `{ strokes, cleaned }` (`cleaned` = Bild ohne Tinte) |
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
