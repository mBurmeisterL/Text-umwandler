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

1. Auf **„Eigene Handschrift zeichnen“** klicken.
2. Jedes Zeichen in das Feld schreiben – es steht auf der dicken Grundlinie.
   **Weiter →** speichert und springt zum nächsten Zeichen, **＋ Variante** speichert eine weitere Version.
3. **Fertig** – die Schriftart „Meine Handschrift“ wird automatisch ausgewählt.
   Noch nicht gezeichnete Zeichen werden in „Caveat“ ergänzt.

Die Buchstaben werden nur im Browser gespeichert. Über **Sichern** / **Laden** lassen sie sich
als Datei sichern und auf ein anderes Gerät übertragen.

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
