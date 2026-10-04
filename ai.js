// KI-Funktionen über die Claude API (Anthropic SDK, im Browser gebündelt).
// Der API-Schlüssel wird nur im Browser dieses Geräts gespeichert.
(() => {
  "use strict";

  const KEY_STORE = "text-umwandler:apikey";
  const MODEL = "claude-opus-5-5";
  // Lehnt das Modell eine Anfrage ab, beantwortet sie der Server automatisch mit einem Ersatzmodell
  const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

  class AiError extends Error {}

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (_) { return ""; }
  }

  function setKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORE, key);
      else localStorage.removeItem(KEY_STORE);
    } catch (_) { /* Speicher nicht verfügbar */ }
  }

  function client() {
    const apiKey = getKey();
    if (!apiKey) throw new AiError("Bitte zuerst unter „KI-Einstellungen“ einen API-Schlüssel eintragen.");
    if (!window.Anthropic) throw new AiError("Die KI-Bibliothek konnte nicht geladen werden.");
    return new window.Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  function friendlyError(e) {
    const A = window.Anthropic;
    if (e instanceof AiError || !A) return e.message || String(e);
    if (e instanceof A.AuthenticationError) return "Der API-Schlüssel ist ungültig.";
    if (e instanceof A.PermissionDeniedError) return "Der API-Schlüssel hat keine Berechtigung dafür.";
    if (e instanceof A.RateLimitError) return "Zu viele Anfragen – bitte kurz warten und nochmal versuchen.";
    if (e instanceof A.BadRequestError) return "Anfrage abgelehnt: " + e.message;
    if (e instanceof A.APIConnectionError) return "Keine Verbindung zur KI – bitte Internet prüfen.";
    if (e instanceof A.APIError) return `KI-Fehler (${e.status}): ${e.message}`;
    return e.message || String(e);
  }

  // Text der Antwort; nach einem Modellwechsel (fallback-Block) zählt nur der Text danach
  function responseText(message) {
    if (message.stop_reason === "refusal") {
      throw new AiError("Die KI hat diese Anfrage abgelehnt.");
    }
    let blocks = message.content;
    const lastFallback = blocks.map((b) => b.type).lastIndexOf("fallback");
    if (lastFallback >= 0) blocks = blocks.slice(lastFallback + 1);
    return blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  function parseJson(message) {
    const text = responseText(message);
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new AiError(message.stop_reason === "max_tokens"
        ? "Die Antwort der KI war zu lang und wurde abgeschnitten."
        : "Die Antwort der KI konnte nicht gelesen werden.");
    }
  }

  // ---------- Text schreiben / überarbeiten ----------

  const WRITE_SYSTEM =
    "Du schreibst Texte, die anschließend in Handschrift umgewandelt werden – zum Beispiel Briefe, " +
    "Karten, Einladungen oder Notizen. Schreibe auf Deutsch, außer es wird eine andere Sprache gewünscht. " +
    "Gib ausschließlich den fertigen Text aus: keine Überschrift wie „Hier ist dein Text“, kein Markdown, " +
    "keine Sternchen, keine Aufzählungszeichen-Formatierung, keine Anführungszeichen um den ganzen Text, " +
    "keine Erklärungen danach. Trenne Absätze mit einer Leerzeile. Ohne Längenangabe soll der Text auf " +
    "eine handgeschriebene Seite passen (etwa 80 bis 200 Wörter). Schreibe natürlich und persönlich, " +
    "so wie ein Mensch es von Hand schreiben würde.";

  // onText(gesamterTextBisher) wird während des Schreibens laufend aufgerufen
  async function writeText(instruction, currentText, onText) {
    const c = client();
    const content = currentText
      ? `Hier ist mein bisheriger Text:\n\n<text>\n${currentText}\n</text>\n\nÜberarbeite ihn so: ${instruction}`
      : instruction;
    const stream = c.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: WRITE_SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
      ...FALLBACK,
    });
    let acc = "";
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "fallback") acc = "";
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        acc += event.delta.text;
        onText(acc);
      }
    }
    const text = responseText(await stream.finalMessage()).trim();
    onText(text);
    return text;
  }

  // ---------- Rechtschreibung ----------

  const CORRECT_SCHEMA = {
    type: "object",
    properties: {
      corrected: { type: "string" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: { original: { type: "string" }, korrektur: { type: "string" } },
          required: ["original", "korrektur"],
          additionalProperties: false,
        },
      },
    },
    required: ["corrected", "changes"],
    additionalProperties: false,
  };

  async function correctText(text) {
    const c = client();
    const message = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system:
        "Du bist ein sorgfältiges Lektorat. Korrigiere nur Rechtschreibung, Grammatik und Zeichensetzung " +
        "des Textes. Formuliere nichts um, ändere weder Stil noch Wortwahl, und behalte alle Zeilenumbrüche " +
        "und Leerzeilen exakt bei. Liste in „changes“ jede einzelne Korrektur (Originalwort → korrigiertes Wort). " +
        "Ist der Text fehlerfrei, gib ihn unverändert zurück und lass „changes“ leer.",
      output_config: { effort: "low", format: { type: "json_schema", schema: CORRECT_SCHEMA } },
      messages: [{ role: "user", content: `<text>\n${text}\n</text>` }],
      ...FALLBACK,
    });
    return parseJson(message);
  }

  // ---------- Buchstaben auf einer Handschrift-Seite erkennen ----------

  const LABEL_SCHEMA = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "integer" }, char: { type: "string" } },
          required: ["id", "char"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };

  // page: JPEG (base64) der ganzen Seite; sheets: JPEGs mit nummerierten Ausschnitten; lines: Text zur Lesereihenfolge
  async function labelGlyphs(page, sheets, lines, count) {
    const c = client();
    const content = [
      { type: "text", text: "Bild 1 – die ganze handgeschriebene Seite:" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: page } },
      { type: "text", text: "Die folgenden Bilder zeigen ausgeschnittene Tintenstücke dieser Seite, jedes mit einer roten Nummer:" },
      ...sheets.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
      {
        type: "text",
        text:
          `Es gibt ${count} nummerierte Ausschnitte. So sind sie auf der Seite angeordnet (Lesereihenfolge):\n${lines}\n\n` +
          "Lies zuerst den Text der ganzen Seite. Bestimme dann für jeden Ausschnitt, welches einzelne Zeichen " +
          "er zeigt (Buchstabe, Ziffer oder Satzzeichen, Groß-/Kleinschreibung beachten, auch ä ö ü ß). " +
          "Nutze die Wörter auf der Seite als Kontext, um ähnliche Formen zu unterscheiden (l, I, 1 usw.). " +
          "Gib als „char“ genau ein Zeichen zurück. Gib einen leeren String zurück, wenn der Ausschnitt mehrere " +
          "zusammenhängende Buchstaben, nur einen Teil eines Buchstabens, eine Linie, ein Bild oder Schmutz zeigt, " +
          "oder wenn du dir unsicher bist. Antworte für jede Nummer.",
      },
    ];
    const message = await c.beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: LABEL_SCHEMA } },
      messages: [{ role: "user", content }],
      ...FALLBACK,
    });
    return parseJson(message).items;
  }

  window.HandschriftKI = { getKey, setKey, hasKey: () => !!getKey(), writeText, correctText, labelGlyphs, friendlyError };
})();
