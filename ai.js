// KI-Funktionen über Google Gemini oder Anthropic Claude (Auswahl in den KI-Einstellungen).
// API-Schlüssel werden nur im Browser dieses Geräts gespeichert.
(() => {
  "use strict";

  const STORE = {
    provider: "text-umwandler:aiprovider",
    claude: "text-umwandler:apikey",
    gemini: "text-umwandler:apikey:gemini",
    geminiModel: "text-umwandler:geminimodel",
  };

  class AiError extends Error {}

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (_) { return ""; }
  }

  function write(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) { /* Speicher nicht verfügbar */ }
  }

  function getProvider() {
    const p = read(STORE.provider);
    if (p === "claude" || p === "gemini") return p;
    return read(STORE.claude) && !read(STORE.gemini) ? "claude" : "gemini";
  }

  const getKey = (provider = getProvider()) => read(STORE[provider]);
  const setKey = (provider, key) => write(STORE[provider], key);

  // ---------- Gemeinsame Anweisungen ----------

  const WRITE_SYSTEM =
    "Du schreibst Texte, die anschließend in Handschrift umgewandelt werden – zum Beispiel Briefe, " +
    "Karten, Einladungen oder Notizen. Schreibe auf Deutsch, außer es wird eine andere Sprache gewünscht. " +
    "Gib ausschließlich den fertigen Text aus: keine Überschrift wie „Hier ist dein Text“, kein Markdown, " +
    "keine Sternchen, keine Aufzählungszeichen-Formatierung, keine Anführungszeichen um den ganzen Text, " +
    "keine Erklärungen danach. Trenne Absätze mit einer Leerzeile. Ohne Längenangabe soll der Text auf " +
    "eine handgeschriebene Seite passen (etwa 80 bis 200 Wörter). Schreibe natürlich und persönlich, " +
    "so wie ein Mensch es von Hand schreiben würde.";

  const CORRECT_SYSTEM =
    "Du bist ein sorgfältiges Lektorat. Korrigiere nur Rechtschreibung, Grammatik und Zeichensetzung " +
    "des Textes. Formuliere nichts um, ändere weder Stil noch Wortwahl, und behalte alle Zeilenumbrüche " +
    "und Leerzeilen exakt bei. Liste in „changes“ jede einzelne Korrektur (Originalwort → korrigiertes Wort). " +
    "Ist der Text fehlerfrei, gib ihn unverändert zurück und lass „changes“ leer.";

  function writePrompt(instruction, currentText) {
    return currentText
      ? `Hier ist mein bisheriger Text:\n\n<text>\n${currentText}\n</text>\n\nÜberarbeite ihn so: ${instruction}`
      : instruction;
  }

  function labelPrompt(lines, count) {
    return (
      `Es gibt ${count} nummerierte Ausschnitte. So sind sie auf der Seite angeordnet (Lesereihenfolge):\n${lines}\n\n` +
      "Lies zuerst den Text der ganzen Seite. Bestimme dann für jeden Ausschnitt, welches einzelne Zeichen " +
      "er zeigt (Buchstabe, Ziffer oder Satzzeichen, Groß-/Kleinschreibung beachten, auch ä ö ü ß). " +
      "Nutze die Wörter auf der Seite als Kontext, um ähnliche Formen zu unterscheiden (l, I, 1 usw.). " +
      "Gib als „char“ genau ein Zeichen zurück. Gib einen leeren String zurück, wenn der Ausschnitt mehrere " +
      "zusammenhängende Buchstaben, nur einen Teil eines Buchstabens, eine Linie, ein Bild oder Schmutz zeigt, " +
      "oder wenn du dir unsicher bist. Antworte für jede Nummer."
    );
  }

  const PAGE_INTRO = "Bild 1 – die ganze handgeschriebene Seite:";
  const SHEETS_INTRO = "Die folgenden Bilder zeigen ausgeschnittene Tintenstücke dieser Seite, jedes mit einer roten Nummer:";

  function parseJsonText(text, truncated) {
    const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    try {
      return JSON.parse(clean);
    } catch (_) {
      throw new AiError(truncated
        ? "Die Antwort der KI war zu lang und wurde abgeschnitten."
        : "Die Antwort der KI konnte nicht gelesen werden.");
    }
  }

  // =====================================================================
  // Anthropic Claude (offizielles SDK, im Browser gebündelt)
  // =====================================================================

  const CLAUDE_MODEL = "claude-opus-5-5";
  // Lehnt das Modell eine Anfrage ab, beantwortet sie der Server automatisch mit einem Ersatzmodell
  const CLAUDE_FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

  function claudeClient() {
    const apiKey = getKey("claude");
    if (!apiKey) throw new AiError("Bitte zuerst unter „KI-Einstellungen“ einen Claude-API-Schlüssel eintragen.");
    if (!window.Anthropic) throw new AiError("Die Claude-Bibliothek konnte nicht geladen werden.");
    return new window.Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }

  // Text der Antwort; nach einem Modellwechsel (fallback-Block) zählt nur der Text danach
  function claudeText(message) {
    if (message.stop_reason === "refusal") throw new AiError("Die KI hat diese Anfrage abgelehnt.");
    let blocks = message.content;
    const lastFallback = blocks.map((b) => b.type).lastIndexOf("fallback");
    if (lastFallback >= 0) blocks = blocks.slice(lastFallback + 1);
    return blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
  }

  const claudeJson = (message) => parseJsonText(claudeText(message), message.stop_reason === "max_tokens");

  const claude = {
    async writeText(instruction, currentText, onText) {
      const stream = claudeClient().beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: WRITE_SYSTEM,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: writePrompt(instruction, currentText) }],
        ...CLAUDE_FALLBACK,
      });
      let acc = "";
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "fallback") acc = "";
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          acc += event.delta.text;
          onText(acc);
        }
      }
      const text = claudeText(await stream.finalMessage()).trim();
      onText(text);
      return text;
    },

    async test() {
      const message = await claudeClient().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1000,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Antworte nur mit dem Wort OK." }],
        ...CLAUDE_FALLBACK,
      });
      return { model: CLAUDE_MODEL, reply: claudeText(message).trim() };
    },

    async correctText(text) {
      const message = await claudeClient().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        system: CORRECT_SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: CORRECT_SCHEMA } },
        messages: [{ role: "user", content: `<text>\n${text}\n</text>` }],
        ...CLAUDE_FALLBACK,
      });
      return claudeJson(message);
    },

    async labelGlyphs(page, sheets, lines, count) {
      const image = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
      const message = await claudeClient().beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 32000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: LABEL_SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: PAGE_INTRO }, image(page),
            { type: "text", text: SHEETS_INTRO }, ...sheets.map(image),
            { type: "text", text: labelPrompt(lines, count) },
          ],
        }],
        ...CLAUDE_FALLBACK,
      });
      return claudeJson(message).items;
    },
  };

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

  // =====================================================================
  // Google Gemini (REST-Schnittstelle)
  // =====================================================================

  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
  const GEMINI_FALLBACK_MODEL = "gemini-flash-latest";

  // Gemini erwartet das OpenAPI-Schemaformat
  const GEMINI_CORRECT_SCHEMA = {
    type: "OBJECT",
    properties: {
      corrected: { type: "STRING" },
      changes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { original: { type: "STRING" }, korrektur: { type: "STRING" } },
          required: ["original", "korrektur"],
        },
      },
    },
    required: ["corrected", "changes"],
  };

  const GEMINI_LABEL_SCHEMA = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { id: { type: "INTEGER" }, char: { type: "STRING" } },
          required: ["id", "char"],
        },
      },
    },
    required: ["items"],
  };

  // Fehler mit Status und Originalmeldung von Google (hilft bei der Fehlersuche)
  function geminiError(status, msg) {
    const detail = msg ? ` (Google: ${msg.length > 180 ? msg.slice(0, 180) + "…" : msg})` : "";
    let text;
    if ((status === 400 || status === 401) && /api key|api_key/i.test(msg)) text = "Der Gemini-API-Schlüssel ist ungültig. Bitte den Schlüssel von aistudio.google.com/apikey neu kopieren.";
    else if (status === 400 && /location|region|country/i.test(msg)) text = "Gemini ist in deinem Land bzw. deiner Region nicht verfügbar.";
    else if (status === 403) text = "Der Gemini-Schlüssel hat dafür keine Berechtigung.";
    else if (status === 404) text = "Dieses Gemini-Modell gibt es nicht (mehr).";
    else if (status === 429 && /limit:\s*0\b/i.test(msg)) text = "Dieses Gemini-Modell ist im kostenlosen Zugang nicht freigeschaltet.";
    else if (status === 429) text = "Gemini-Limit erreicht (der kostenlose Zugang erlaubt nur eine bestimmte Zahl Anfragen pro Minute und Tag).";
    else if (status >= 500) text = "Gemini ist gerade überlastet – bitte gleich nochmal versuchen.";
    else text = `Gemini-Fehler ${status}.`;
    const err = new AiError(text + detail);
    err.status = status;
    err.keyProblem = /Schlüssel/.test(text);
    return err;
  }

  async function geminiFetch(path, body) {
    const key = getKey("gemini");
    if (!key) {
      const err = new AiError("Bitte zuerst unter „KI-Einstellungen“ einen Gemini-API-Schlüssel eintragen.");
      err.keyProblem = true;
      throw err;
    }
    let res;
    try {
      res = await fetch(`${GEMINI_BASE}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new AiError("Keine Verbindung zu Gemini – bitte Internet prüfen.");
    }
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json()).error.message || ""; } catch (_) { /* keine Details */ }
      throw geminiError(res.status, msg);
    }
    return res;
  }

  async function listGeminiModels() {
    const res = await geminiFetch("models?pageSize=1000");
    const data = await res.json();
    return (data.models || [])
      .filter((m) => /^models\/gemini-/.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }));
  }

  // Reihenfolge, in der Modelle automatisch probiert werden:
  // erst Googles Alias auf das aktuelle Flash-Modell, dann stabile Flash-Versionen (neueste zuerst), dann Flash-Lite
  function geminiCandidates(models) {
    const ids = models.map((m) => m.id);
    const version = (id, kind) => {
      const m = id.match(new RegExp(`^gemini-(\\d+(?:\\.\\d+)?)-${kind}$`));
      return m ? parseFloat(m[1]) : -1;
    };
    const byVersion = (kind) => ids.filter((id) => version(id, kind) >= 0).sort((a, b) => version(b, kind) - version(a, kind));
    const out = [];
    if (ids.includes("gemini-flash-latest")) out.push("gemini-flash-latest");
    out.push(...byVersion("flash"));
    if (ids.includes("gemini-flash-lite-latest")) out.push("gemini-flash-lite-latest");
    out.push(...byVersion("flash-lite"));
    if (!out.length) out.push(GEMINI_FALLBACK_MODEL, "gemini-2.5-flash");
    return [...new Set(out)];
  }

  const pickGeminiModel = (models) => geminiCandidates(models)[0];

  // Diese Fehler hängen am Modell – dann lohnt es sich, ein anderes zu probieren
  const modelProblem = (e) => !e.keyProblem && [403, 404, 429].includes(e.status) || (e.status === 400 && !e.keyProblem);

  let workingModel = null;

  // Führt fn(modell) aus; im Automatik-Modus werden bei Modellproblemen weitere Modelle probiert
  async function withGeminiModel(fn) {
    const chosen = read(STORE.geminiModel);
    if (chosen) {
      try {
        return { result: await fn(chosen), model: chosen };
      } catch (e) {
        if (modelProblem(e)) e.message += " Tipp: In den KI-Einstellungen bei „Gemini-Modell“ auf „Automatisch“ stellen.";
        throw e;
      }
    }
    if (workingModel) {
      try {
        return { result: await fn(workingModel), model: workingModel };
      } catch (e) {
        if (!modelProblem(e)) throw e;
        workingModel = null;
      }
    }
    let list;
    try {
      list = geminiCandidates(await listGeminiModels());
    } catch (e) {
      if (e.keyProblem) throw e;
      list = [GEMINI_FALLBACK_MODEL, "gemini-2.5-flash"];
    }
    let lastError = null;
    for (const model of list.slice(0, 5)) {
      try {
        const result = await fn(model);
        workingModel = model;
        return { result, model };
      } catch (e) {
        if (!modelProblem(e)) throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  function checkBlocked(data) {
    const reason = data.promptFeedback && data.promptFeedback.blockReason;
    const finish = data.candidates && data.candidates[0] && data.candidates[0].finishReason;
    if (reason || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(finish)) {
      throw new AiError("Die KI hat diese Anfrage abgelehnt.");
    }
  }

  function geminiParts(data) {
    const c = data.candidates && data.candidates[0];
    const parts = (c && c.content && c.content.parts) || [];
    return parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  }

  async function geminiGenerate(body) {
    const { result } = await withGeminiModel(async (model) => {
      const data = await (await geminiFetch(`models/${encodeURIComponent(model)}:generateContent`, body)).json();
      checkBlocked(data);
      const truncated = data.candidates && data.candidates[0] && data.candidates[0].finishReason === "MAX_TOKENS";
      return { text: geminiParts(data), truncated };
    });
    return result;
  }

  const gemini = {
    async writeText(instruction, currentText, onText) {
      const { result: res } = await withGeminiModel((model) =>
        geminiFetch(`models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          systemInstruction: { parts: [{ text: WRITE_SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: writePrompt(instruction, currentText) }] }],
          generationConfig: { maxOutputTokens: 16384 },
        }));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5));
          checkBlocked(data);
          const t = geminiParts(data);
          if (t) { acc += t; onText(acc); }
        }
      }
      const text = acc.trim();
      if (!text) throw new AiError("Gemini hat keinen Text geliefert – bitte nochmal versuchen.");
      onText(text);
      return text;
    },

    async test() {
      const { result, model } = await withGeminiModel(async (m) => {
        const data = await (await geminiFetch(`models/${encodeURIComponent(m)}:generateContent`, {
          contents: [{ role: "user", parts: [{ text: "Antworte nur mit dem Wort OK." }] }],
        })).json();
        checkBlocked(data);
        return geminiParts(data);
      });
      return { model, reply: result.trim() };
    },

    async correctText(text) {
      const { text: out, truncated } = await geminiGenerate({
        systemInstruction: { parts: [{ text: CORRECT_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `<text>\n${text}\n</text>` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_CORRECT_SCHEMA, maxOutputTokens: 16384 },
      });
      return parseJsonText(out, truncated);
    },

    async labelGlyphs(page, sheets, lines, count) {
      const image = (data) => ({ inline_data: { mime_type: "image/jpeg", data } });
      const { text, truncated } = await geminiGenerate({
        contents: [{
          role: "user",
          parts: [
            { text: PAGE_INTRO }, image(page),
            { text: SHEETS_INTRO }, ...sheets.map(image),
            { text: labelPrompt(lines, count) },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_LABEL_SCHEMA, maxOutputTokens: 32768 },
      });
      return parseJsonText(text, truncated).items;
    },
  };

  // =====================================================================

  function friendlyError(e) {
    const A = window.Anthropic;
    if (e instanceof AiError || !A) return e.message || String(e);
    if (e instanceof A.AuthenticationError) return "Der Claude-API-Schlüssel ist ungültig.";
    if (e instanceof A.PermissionDeniedError) return "Der API-Schlüssel hat keine Berechtigung dafür.";
    if (e instanceof A.RateLimitError) return "Zu viele Anfragen – bitte kurz warten und nochmal versuchen.";
    if (e instanceof A.BadRequestError) return "Anfrage abgelehnt: " + e.message;
    if (e instanceof A.APIConnectionError) return "Keine Verbindung zur KI – bitte Internet prüfen.";
    if (e instanceof A.APIError) return `KI-Fehler (${e.status}): ${e.message}`;
    return e.message || String(e);
  }

  const impl = () => (getProvider() === "claude" ? claude : gemini);

  window.HandschriftKI = {
    getProvider,
    setProvider: (p) => write(STORE.provider, p),
    getKey,
    setKey,
    hasKey: () => !!getKey(),
    getGeminiModel: () => read(STORE.geminiModel),
    setGeminiModel: (m) => { write(STORE.geminiModel, m); workingModel = null; },
    getWorkingGeminiModel: () => workingModel,
    listGeminiModels,
    pickGeminiModel,
    writeText: (...a) => impl().writeText(...a),
    correctText: (...a) => impl().correctText(...a),
    labelGlyphs: (...a) => impl().labelGlyphs(...a),
    test: () => impl().test(),
    friendlyError,
  };
})();
