# Text-Umwandler

Eine kleine Webseite, die getippten Text in realistisch wirkende Handschrift verwandelt.

## Funktionen

- 9 Handschrift-Schriftarten (von ordentlich bis krakelig, auch Schreibschrift)
- Papier: liniert, kariert, blanko oder „altes Papier“, optional mit roter Randlinie
- Tintenfarbe (Voreinstellungen oder eigene Farbe)
- Regler für Schriftgröße, Zeilenabstand, Buchstaben- und Wortabstand
- „Unordentlichkeit“: jeder Buchstabe wird leicht gedreht, verschoben und skaliert,
  Zeilen bekommen eine leichte Schräglage – so wirkt es wie echt geschrieben
- „Neu mischen“ erzeugt eine neue zufällige Variante
- Automatischer Seitenumbruch (A4)
- Export als PNG (pro Seite) oder PDF, oder direkt drucken
- Text und Einstellungen werden im Browser gespeichert

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
