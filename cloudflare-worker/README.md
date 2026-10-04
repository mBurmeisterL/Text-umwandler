# KI-Worker für Cloudflare

`worker.js` ist der KI-Worker der Webseite (Texte schreiben, Rechtschreibung, Übersetzen,
Text aus Bildern lesen, Buchstaben erkennen) mit **Workers AI** – ohne API-Schlüssel.

## Automatisch aktualisieren (empfohlen)

Einmal einrichten, danach aktualisiert Cloudflare den Worker bei jeder Änderung auf GitHub selbst:

1. Cloudflare-Dashboard → **Workers & Pages** → Worker **umwandeln** → **Settings** → **Build**
2. Bei **Git repository** auf **Connect** tippen, GitHub verbinden und das Repository
   **mBurmeisterL/Text-umwandler** auswählen
3. Einstellungen:
   - **Branch:** `main`
   - **Root directory / Pfad:** `cloudflare-worker`
   - **Build command:** leer lassen
   - **Deploy command:** `npx wrangler deploy`
4. Speichern. Der erste Build startet automatisch (unter **Deployments** zu sehen).

Die Einstellungen (Name `umwandeln`, Binding `AI`) stehen in `wrangler.jsonc`.

## Von Hand

Unter **Edit code** den kompletten Inhalt von `worker.js` einfügen und **Deploy** tippen.
In Zeile 1 steht die Version; der Verbindungstest auf der Webseite zeigt, welche Version läuft.
