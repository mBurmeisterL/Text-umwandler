# Text-Umwandler

Eine kleine Webseite, die getippten Text in realistisch wirkende Handschrift verwandelt.

## Funktionen

- **Eigene Handschrift:** Buchstaben direkt auf der Seite mit Apple Pencil, Finger oder Maus
  zeichnen (mit Druckempfindlichkeit und mehreren Varianten pro Zeichen)
- 9 Handschrift-Schriftarten (von ordentlich bis krakelig, auch Schreibschrift)
- Papier: liniert, kariert, blanko oder „altes Papier“, optional mit roter Randlinie
- Tintenfarbe (Voreinstellungen oder eigene Farbe)
- Regler für Schriftgröße, Zeilenabstand, Buchstaben- und Wortabstand
- „Unordentlichkeit“: jeder Buchstabe wird leicht gedreht, verschoben und skaliert,
  Zeilen bekommen eine leichte Schräglage – so wirkt es wie echt geschrieben
- „Neu mischen“ erzeugt eine neue zufällige Variante
- Automatischer Seitenumbruch (A4)
- Export als PNG (pro Seite) oder PDF, oder direkt drucken
- „Teilen“ öffnet auf iPad/iPhone das Teilen-Menü, z. B. um das PDF direkt in Goodnotes zu öffnen
- Text und Einstellungen werden im Browser gespeichert

## Eigene Handschrift

Es gibt drei Wege, die eigene Handschrift einzulesen:

**A) Vorlage ausfüllen (z. B. in Goodnotes)**

1. „Eigene Handschrift zeichnen“ → **📄 Vorlage holen**. Auf dem iPad öffnet sich das Teilen-Menü
   (z. B. „In Goodnotes öffnen“), sonst wird `handschrift-vorlage.pdf` heruntergeladen.
2. In jedes Kästchen ein Zeichen schreiben – jedes Zeichen 3×, in dunkler Farbe.
3. Die Seiten als PDF oder Bild exportieren (oder das ausgedruckte Blatt fotografieren) und mit
   **📷 Ausgefüllte Seiten hochladen** einlesen. Die Seite findet die Kästchen über die schwarzen
   Ecken-Markierungen und erkennt die Seitennummer automatisch.

**B) Beliebige Seite mit KI lesen**

Eine ganz normal beschriebene Seite (Bild, PDF oder Foto) hochladen: Die Webseite zerlegt die Tinte in
einzelne Stücke, die KI (Claude) bestimmt, welches Zeichen jedes Stück ist, und in einer Kontrollansicht
lassen sich Fehler korrigieren. Funktioniert am besten mit Druckschrift; verbundene Schreibschrift lässt
sich kaum in einzelne Buchstaben zerlegen. Braucht einen API-Schlüssel für Gemini oder Claude (siehe unten).

**C) Direkt auf der Webseite zeichnen**

1. Auf **„Eigene Handschrift zeichnen“** klicken.
2. Unter **„Jedes Zeichen“** einstellen, wie oft jedes Zeichen geschrieben werden soll (z. B. 3×).
3. Jedes Zeichen in das Feld schreiben – es steht auf der dicken Grundlinie. **Weiter →** bleibt beim
   selben Zeichen, bis alle Varianten geschrieben sind, und springt dann zum nächsten.

Danach **Fertig** – die Schriftart „Meine Handschrift“ wird automatisch ausgewählt.
Im Text wird für jedes Vorkommen zufällig eine der Varianten benutzt (nie zweimal dieselbe direkt
hintereinander). Noch fehlende Zeichen werden in „Caveat“ ergänzt.

Die Buchstaben werden nur im Browser gespeichert. Über **Sichern** / **Laden** lassen sie sich
als Datei sichern und auf ein anderes Gerät übertragen.

## KI-Helfer

Im Bereich **🤖 KI-Helfer** unter dem Textfeld:

Als KI kann **Google Gemini** oder **Anthropic Claude** benutzt werden (Auswahl unter
**KI-Einstellungen**, jeder Anbieter mit eigenem Schlüssel):

- **Gemini:** kostenloser Schlüssel mit einem Google-Konto auf
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Der kostenlose Zugang hat Grenzen pro
  Minute und Tag; Google darf dabei Eingaben zur Verbesserung seiner Dienste verwenden. Die Seite wählt
  automatisch das neueste Flash-Modell, ein anderes Modell lässt sich in den Einstellungen auswählen.
- **Claude:** Schlüssel auf [console.anthropic.com](https://console.anthropic.com/settings/keys),
  Abrechnung pro Nutzung (meist wenige Cent pro Anfrage).

- **Eigener Cloudflare Worker (ohne Schlüssel):** Workers AI im eigenen kostenlosen Cloudflare-Konto
  (Tageskontingent). Kann Texte schreiben, überarbeiten und die Rechtschreibung prüfen, aber keine
  Handschrift-Seiten lesen. Einrichtung:
  1. In Cloudflare einen Worker anlegen und unter **Bindings** ein Binding vom Typ **Workers AI** mit
     dem Namen `AI` hinzufügen.
  2. Unter **Edit code** den kompletten Inhalt von [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js)
     einfügen und **Deploy** tippen.
  3. Die Worker-Adresse (`https://….workers.dev`) auf der Webseite unter **KI-Einstellungen →
     Eigener Cloudflare Worker** eintragen und **Verbindung testen**.

  Der Worker nimmt nur Anfragen von `https://mburmeisterl.github.io` an.

Funktionen:

- **✨ Text schreiben** – beschreiben, was gebraucht wird („Dankesbrief an Oma für das Geschenk“),
  der Text erscheint direkt in Handschrift
- **✏️ Text überarbeiten** – den vorhandenen Text nach Wunsch ändern lassen („kürzer und lustiger“)
- **✔️ Rechtschreibung prüfen** – korrigiert nur Fehler und listet die Änderungen auf
- **↶ Rückgängig** – stellt den Text vor der letzten KI-Änderung wieder her

Der Schlüssel wird nur im Browser gespeichert und direkt an den Anbieter geschickt – deshalb die
KI-Funktionen nur auf eigenen Geräten verwenden.

## Benutzung

Keine Installation nötig – einfach `index.html` im Browser öffnen.
Alle Schriften und Bibliotheken sind lokal eingebunden, die Seite funktioniert also auch offline.

Optional mit lokalem Server:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Über GitHub Pages (Settings → Pages → Branch auswählen) lässt sich die Seite auch online stellen.

## Lizenzen

- Schriften: Google Fonts, SIL Open Font License 1.1 (Homemade Apple: Apache License 2.0)
- [jsPDF](https://github.com/parallax/jsPDF): MIT-Lizenz (`vendor/jspdf.LICENSE`)
- [PDF.js](https://github.com/mozilla/pdf.js): Apache License 2.0 (`vendor/pdfjs/LICENSE`)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript): MIT-Lizenz, als Browser-Bundle (`vendor/anthropic/`)
