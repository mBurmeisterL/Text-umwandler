// Text-Umwandler – KI-Worker für Cloudflare Workers AI
//
// Einrichtung im Cloudflare-Dashboard:
//   1. Worker anlegen, unter „Bindings“ ein Binding vom Typ „Workers AI“ mit dem Namen  AI  hinzufügen
//   2. Unter „Edit code“ den kompletten Inhalt dieser Datei einfügen und „Deploy“ tippen
//   3. Die Worker-Adresse (…workers.dev) auf der Webseite unter KI-Einstellungen eintragen
//
// Es wird kein API-Schlüssel gebraucht. Nur die eigene GitHub-Pages-Seite darf den Worker benutzen.

const ALLOWED_ORIGINS = ["https://mburmeisterl.github.io"];

// Werden der Reihe nach probiert; das erste funktionierende Modell wird gemerkt
const TEXT_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];

const MAX_INPUT = 8000; // Zeichen

const WRITE_SYSTEM =
  "Du schreibst Texte, die anschließend in Handschrift umgewandelt werden – zum Beispiel Briefe, " +
  "Karten, Einladungen oder Notizen. Schreibe auf Deutsch, außer es wird eine andere Sprache gewünscht. " +
  "Gib ausschließlich den fertigen Text aus: keine Einleitung wie „Hier ist dein Text“, kein Markdown, " +
  "keine Sternchen, keine Anführungszeichen um den ganzen Text, keine Erklärungen danach. " +
  "Trenne Absätze mit einer Leerzeile. Ohne Längenangabe soll der Text auf eine handgeschriebene Seite " +
  "passen (etwa 80 bis 200 Wörter). Schreibe natürlich und persönlich.";

const CORRECT_SYSTEM =
  "Du bist ein sorgfältiges Lektorat für deutsche Texte. Korrigiere nur Rechtschreibung, Grammatik und " +
  "Zeichensetzung. Formuliere nichts um und behalte alle Zeilenumbrüche exakt bei. Antworte ausschließlich " +
  'mit gültigem JSON in genau dieser Form: {"corrected": "der korrigierte Text", "changes": ' +
  '[{"original": "falsches Wort", "korrektur": "richtiges Wort"}]}. Ist der Text fehlerfrei, gib ihn ' +
  'unverändert zurück und setze "changes" auf eine leere Liste.';

let workingModel = null;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function runText(env, messages, maxTokens) {
  const models = workingModel ? [workingModel, ...TEXT_MODELS.filter((m) => m !== workingModel)] : TEXT_MODELS;
  let lastError;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: maxTokens });
      const r = out && out.response;
      const text = typeof r === "string" ? r : r == null ? "" : JSON.stringify(r);
      workingModel = model;
      return { model, text };
    } catch (e) {
      lastError = e;
      // Tageslimit gilt für alle Modelle – dann nicht weiter probieren
      if (/allocation|limit|quota|4006/i.test(String(e && e.message))) break;
    }
  }
  throw lastError;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Die KI hat kein JSON geliefert.");
  return JSON.parse(text.slice(start, end + 1));
}

function friendly(e) {
  const msg = String((e && e.message) || e);
  if (/allocation|4006|daily/i.test(msg)) return "Das kostenlose Tageskontingent von Workers AI ist aufgebraucht – morgen geht es wieder.";
  return "Workers AI: " + msg;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET") return json({ ok: true, info: "Text-Umwandler KI-Worker läuft." });
    if (request.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "Diese Seite darf den Worker nicht benutzen." }, 403);
    if (!env.AI) return json({ error: "Im Worker fehlt das Workers-AI-Binding mit dem Namen „AI“." }, 500);

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: "Ungültige Anfrage." }, 400);
    }
    const str = (v) => (typeof v === "string" ? v.slice(0, MAX_INPUT) : "");
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    try {
      if (path === "/test") {
        const r = await runText(env, [{ role: "user", content: "Antworte nur mit dem Wort OK." }], 10);
        return json({ model: r.model, reply: r.text.trim() });
      }

      if (path === "/write") {
        const instruction = str(body.instruction).trim();
        const current = str(body.currentText).trim();
        if (!instruction) return json({ error: "Es fehlt eine Beschreibung, was geschrieben werden soll." }, 400);
        const content = current
          ? `Hier ist mein bisheriger Text:\n\n${current}\n\nÜberarbeite ihn so: ${instruction}`
          : instruction;
        const r = await runText(env, [{ role: "system", content: WRITE_SYSTEM }, { role: "user", content }], 1500);
        return json({ model: r.model, text: r.text.trim() });
      }

      if (path === "/correct") {
        const text = str(body.text);
        if (!text.trim()) return json({ error: "Es fehlt der Text." }, 400);
        const r = await runText(env, [{ role: "system", content: CORRECT_SYSTEM }, { role: "user", content: text }], 3000);
        let data;
        try {
          data = extractJson(r.text);
        } catch (_) {
          return json({ error: "Die Antwort der KI konnte nicht gelesen werden – bitte nochmal versuchen." }, 502);
        }
        const changes = Array.isArray(data.changes)
          ? data.changes.filter((c) => c && typeof c.original === "string" && typeof c.korrektur === "string")
          : [];
        return json({ model: r.model, corrected: typeof data.corrected === "string" ? data.corrected : text, changes });
      }

      return json({ error: "Unbekannte Funktion." }, 404);
    } catch (e) {
      return json({ error: friendly(e) }, 502);
    }
  },
};
