// goodnotes-kit – .goodnotes-Dateien im Browser erzeugen (ohne Server, ohne weitere Bibliotheken)
//
// Was es kann:
//   - Striche (Kugelschreiber) schreiben, die in Goodnotes radierbar und mit dem Lasso verschiebbar sind
//   - Seiten mit Hintergrund: PDF-Seiten (bleiben scharf) oder Bilder
//   - Schrift aus Fotos/Scans in bearbeitbare Striche umwandeln (strokesFromCanvas)
//   - Canvas-Zeichnungen (fillText, drawImage) aufzeichnen und in Striche umwandeln (createRecorder)
//   - kleine PDFs aus JPEGs bauen (makePdf)
//   - alle Goodnotes-Elemente: Textfelder, Formen, Textmarker, Bleistift, Form-Werkzeug, Haftnotizen,
//     Linien/Pfeile, Bilder, Links, Lesezeichen, Seitendrehung, Inhaltsverzeichnis (page.items)
// Benutzung und Beispiele: README.md in diesem Ordner. Alles hängt an window.GoodnotesExport.
//
// Das Dateiformat ist nicht offiziell dokumentiert; der Aufbau folgt Dateien aus der Goodnotes-App
// und der Beschreibung in https://github.com/Taylor-Nilsen/goodnotes-codec (docs/FORMAT.md).
// Getestet: Import in Goodnotes auf dem iPad (Oktober 2026), Schema-Version 24.
(() => {
  "use strict";

  // ---------- Aufzeichnen: ein Canvas-Ersatz, der sich merkt, was gezeichnet wird ----------

  // Unterstützt genau das, was der Umwandler beim Schreiben einer Zeile benutzt
  function createRecorder() {
    const ops = [];
    let m = new DOMMatrix();
    const stack = [];
    const ctx = {
      font: "", fillStyle: "#000", strokeStyle: "#000", textBaseline: "alphabetic",
      globalAlpha: 1, lineWidth: 1, lineCap: "butt", lineJoin: "miter",
      ops,
      save() { stack.push({ m, font: this.font, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha }); },
      restore() {
        const st = stack.pop();
        if (!st) return;
        m = st.m; this.font = st.font; this.fillStyle = st.fillStyle; this.globalAlpha = st.globalAlpha;
      },
      translate(x, y) { m = m.translate(x, y); },
      rotate(a) { m = m.rotate((a * 180) / Math.PI); },
      scale(x, y) { m = m.scale(x, y); },
      transform(a, b, c, d, e, f) { m = m.multiply(new DOMMatrix([a, b, c, d, e, f])); },
      fillText(text, x, y) { ops.push({ type: "text", text, x, y, font: this.font, m }); },
      drawImage(img, x, y, w, h) {
        ops.push({ type: "image", img, x, y, w: w ?? img.width, h: h ?? img.height, m });
      },
      // Selbst gezeichnete Buchstaben: Striche direkt übernehmen (Koordinaten in em)
      recordStrokes(strokes, em, penWidth, ox, oy, widthOf) {
        ops.push({ type: "strokes", strokes, em, penWidth, ox, oy, widthOf, m });
      },
      // Alles andere wird nicht gebraucht
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, stroke() {}, fill() {},
      measureText: (t) => ({ width: 0, text: t }),
    };
    return ctx;
  }

  // ---------- Bild → Mittellinien (Skelett) ----------

  const SS = 4; // Überabtastung beim Vektorisieren

  // Zhang-Suen-Verdünnung auf einer 0/1-Maske (mit 1 Pixel Rand)
  function thin(img, w, h) {
    const del = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (!img[i]) continue;
            const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1];
            const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
            const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (b < 2 || b > 6) continue;
            const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
              (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (a !== 1) continue;
            if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
            del.push(i);
          }
        }
        for (const i of del) img[i] = 0;
        if (del.length) changed = true;
      }
    }
  }

  const NB = (w) => [-w - 1, -w, -w + 1, 1, w + 1, w, w - 1, -1]; // im Uhrzeigersinn

  // Entfernt Pixel, ohne die der Rest trotzdem zusammenhängt (Treppenstufen, 2×2-Blöcke)
  function pruneRedundant(img, w, h) {
    const nb = NB(w);
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!img[i]) continue;
          let n = 0;
          for (const d of nb) n += img[i + d];
          if (n < 2) continue;
          // Zusammenhangskomponenten der Nachbarn im Ring (8er-Nachbarschaft innerhalb des Rings)
          const ring = nb.map((d) => img[i + d]);
          let comps = 0;
          const seen = new Array(8).fill(false);
          for (let k = 0; k < 8; k++) {
            if (!ring[k] || seen[k]) continue;
            comps++;
            const todo = [k];
            seen[k] = true;
            while (todo.length) {
              const c = todo.pop();
              // Ring-Nachbarn: immer k±1; die Seitenmitten (ungerade k) berühren auch k±2
              for (const s of [1, 7, 2, 6]) {
                const j = (c + s) % 8;
                if (!ring[j] || seen[j]) continue;
                if ((s === 2 || s === 6) && c % 2 === 0) continue;
                seen[j] = true;
                todo.push(j);
              }
            }
          }
          if (comps === 1) { img[i] = 0; changed = true; }
        }
      }
    }
  }

  // Abstand jedes Tintenpixels zum Rand (Chamfer 3-4, Ergebnis in Pixeln)
  function distance(mask, w, h) {
    const INF = 1e9;
    const d = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], d[i - 1] + 3, d[i - w] + 3, d[i - w - 1] + 4, d[i - w + 1] + 4);
      }
    }
    for (let y = h - 2; y > 0; y--) {
      for (let x = w - 2; x > 0; x--) {
        const i = y * w + x;
        if (!d[i]) continue;
        d[i] = Math.min(d[i], d[i + 1] + 3, d[i + w] + 3, d[i + w + 1] + 4, d[i + w - 1] + 4);
      }
    }
    for (let i = 0; i < w * h; i++) d[i] /= 3;
    return d;
  }

  // Skelett → Pfade (Listen von Pixel-Indizes); a/b = Knoten an den Enden
  function trace(img, w, h) {
    const nb = NB(w);
    const deg = new Uint8Array(w * h);
    const pix = [];
    for (let i = 0; i < w * h; i++) {
      if (!img[i]) continue;
      pix.push(i);
      let n = 0;
      for (const d of nb) n += img[i + d];
      deg[i] = n;
    }
    const isNode = (i) => deg[i] !== 2;
    // Benachbarte Knotenpixel (Enden, Kreuzungen) bilden zusammen einen Knoten
    const cluster = new Int32Array(w * h).fill(-1);
    let clusters = 0;
    for (const i of pix) {
      if (!isNode(i) || cluster[i] >= 0) continue;
      const todo = [i];
      cluster[i] = clusters;
      while (todo.length) {
        const c = todo.pop();
        for (const d of nb) {
          const k = c + d;
          if (img[k] && isNode(k) && cluster[k] < 0) { cluster[k] = clusters; todo.push(k); }
        }
      }
      clusters++;
    }
    const visited = new Uint8Array(w * h);
    const edges = [];
    const touched = new Uint8Array(clusters);

    for (const i of pix) {
      if (!isNode(i)) continue;
      for (const d of nb) {
        const j = i + d;
        if (!img[j]) continue;
        if (isNode(j)) {
          // Zwei verschiedene Knoten direkt nebeneinander: kurze Kante, nur einmal
          if (cluster[j] !== cluster[i] && i < j) {
            edges.push({ p: [i, j], a: cluster[i], b: cluster[j] });
            touched[cluster[i]] = touched[cluster[j]] = 1;
          }
          continue;
        }
        if (visited[j]) continue;
        const p = [i, j];
        visited[j] = 1;
        let prev = i, cur = j;
        for (;;) {
          let next = -1;
          for (const e of nb) {
            const k = cur + e;
            if (!img[k] || k === prev || (cluster[k] === cluster[i] && p.length < 4)) continue;
            if (isNode(k)) { if (next < 0 || !isNode(next)) next = k; continue; }
            if (!visited[k] && next < 0) next = k;
          }
          if (next < 0) break;
          p.push(next);
          if (isNode(next)) break;
          visited[next] = 1;
          prev = cur;
          cur = next;
        }
        const last = p[p.length - 1];
        const end = isNode(last) ? cluster[last] : -2 - edges.length; // offenes Ende ohne Knoten
        edges.push({ p, a: cluster[i], b: end });
        touched[cluster[i]] = 1;
        if (end >= 0) touched[end] = 1;
      }
    }
    // Knoten ohne Kanten: Punkte (z. B. i-Punkt) oder winzige Kleckse
    const firstOf = new Int32Array(clusters).fill(-1);
    for (const i of pix) if (isNode(i) && firstOf[cluster[i]] < 0) firstOf[cluster[i]] = i;
    for (let c = 0; c < clusters; c++) if (!touched[c]) edges.push({ p: [firstOf[c]], a: c, b: c });

    // Übrig: geschlossene Ringe ohne Knoten (z. B. „o“)
    for (const i of pix) {
      if (visited[i] || isNode(i)) continue;
      const p = [i];
      visited[i] = 1;
      let prev = -1, cur = i;
      for (;;) {
        let next = -1;
        for (const e of nb) {
          const k = cur + e;
          if (img[k] && k !== prev && !visited[k]) { next = k; break; }
        }
        if (next < 0) break;
        p.push(next);
        visited[next] = 1;
        prev = cur;
        cur = next;
      }
      p.push(i);
      edges.push({ p, a: -1, b: -1, closed: true });
    }
    return edges;
  }

  // Kurze Äste (typische Skelett-Artefakte an Ecken) entfernen
  function pruneSpurs(edges, minLen) {
    const count = new Map();
    const inc = (n) => count.set(n, (count.get(n) || 0) + 1);
    for (const e of edges) if (!e.closed && e.p.length > 1) { inc(e.a); inc(e.b); } // Schleifen zählen doppelt
    return edges.filter((e) => {
      if (e.closed || e.a === e.b) return true;
      const endA = count.get(e.a) === 1, endB = count.get(e.b) === 1;
      // Ast = ein Ende frei, das andere an einer Kreuzung
      if ((endA && !endB) || (endB && !endA)) return e.p.length >= minLen;
      return true;
    });
  }

  // An Kreuzungen jeweils die Äste verbinden, die am geradesten weiterlaufen
  function joinAtNodes(edges, w) {
    const ends = new Map(); // Knoten → [{e, atStart}]
    for (const e of edges) {
      if (e.closed || e.p.length < 2) continue;
      for (const atStart of [true, false]) {
        const n = atStart ? e.a : e.b;
        if (!ends.has(n)) ends.set(n, []);
        ends.get(n).push({ e, atStart });
      }
    }
    const xy = (i) => [i % w, Math.floor(i / w)];
    const dir = ({ e, atStart }) => {
      const p = e.p;
      const k = Math.min(p.length - 1, 6);
      const [x0, y0] = xy(atStart ? p[0] : p[p.length - 1]);
      const [x1, y1] = xy(atStart ? p[k] : p[p.length - 1 - k]);
      const L = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [(x1 - x0) / L, (y1 - y0) / L];
    };
    const link = new Map(); // "Kante|Ende" → Partner
    const key = (x) => x.e.id + (x.atStart ? "s" : "e");
    edges.forEach((e, i) => { e.id = i; });
    for (const list of ends.values()) {
      if (list.length < 2) continue;
      const pairs = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].e === list[j].e) continue;
          const a = dir(list[i]), b = dir(list[j]);
          pairs.push({ i, j, dot: a[0] * b[0] + a[1] * b[1] });
        }
      }
      pairs.sort((p, q) => p.dot - q.dot);
      const used = new Set();
      for (const pr of pairs) {
        if (pr.dot > -0.35) break; // nur fast gerade Fortsetzungen
        if (used.has(pr.i) || used.has(pr.j)) continue;
        used.add(pr.i); used.add(pr.j);
        link.set(key(list[pr.i]), list[pr.j]);
        link.set(key(list[pr.j]), list[pr.i]);
      }
    }
    // Ketten ablaufen
    const done = new Set();
    const out = [];
    const walk = (start) => {
      const pts = [];
      let cur = start; // {e, atStart}: Kante, in die wir am Ende atStart eintreten
      while (cur && !done.has(cur.e.id)) {
        done.add(cur.e.id);
        const seq = cur.atStart ? cur.e.p : cur.e.p.slice().reverse();
        pts.push(...(pts.length ? seq.slice(1) : seq));
        const exit = { e: cur.e, atStart: !cur.atStart };
        cur = link.get(key(exit));
      }
      return pts;
    };
    for (const e of edges) {
      if (done.has(e.id)) continue;
      if (e.closed || e.p.length < 2) { done.add(e.id); out.push({ p: e.p, closed: !!e.closed }); continue; }
      // Am freien Ende einer Kette beginnen
      const linkedStart = link.has(key({ e, atStart: true }));
      if (linkedStart && link.has(key({ e, atStart: false }))) continue;
      out.push({ p: walk({ e, atStart: !linkedStart }) });
    }
    // Was übrig ist, sind verbundene Ringe
    for (const e of edges) if (!done.has(e.id)) out.push({ p: walk({ e, atStart: true }), closed: true });
    return out;
  }

  function smooth(pts, closed) {
    if (pts.length < 5) return pts;
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
      let sx = 0, sy = 0, c = 0;
      for (let k = -2; k <= 2; k++) {
        let j = i + k;
        if (closed) j = (j + n - 1) % (n - 1);
        else j = Math.max(0, Math.min(n - 1, j));
        sx += pts[j][0]; sy += pts[j][1]; c++;
      }
      out.push([sx / c, sy / c]);
    }
    if (closed) out[n - 1] = out[0];
    return out;
  }

  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const L = Math.hypot(bx - ax, by - ay);
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        const d = L ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay);
        if (d > best) { best = d; bi = i; }
      }
      if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // Maske (Alpha-Werte) → Striche [{pts: [[x, y]...], w}] in Pixeln der Maske
  function vectorize(alpha, w, h) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = alpha[i] > 100 ? 1 : 0;
    // Rand frei lassen
    for (let x = 0; x < w; x++) { mask[x] = 0; mask[(h - 1) * w + x] = 0; }
    for (let y = 0; y < h; y++) { mask[y * w] = 0; mask[y * w + w - 1] = 0; }
    const dist = distance(mask, w, h);
    const sk = mask.slice();
    thin(sk, w, h);
    pruneRedundant(sk, w, h);

    // Typische halbe Strichbreite fürs Entfernen kurzer Äste
    const ds = [];
    for (let i = 0; i < w * h; i++) if (sk[i]) ds.push(dist[i]);
    if (!ds.length) return [];
    ds.sort((a, b) => a - b);
    const half = ds[Math.floor(ds.length / 2)];

    let edges = trace(sk, w, h);
    for (let round = 0; round < 2; round++) edges = pruneSpurs(edges, Math.max(3, half * 1.6));
    const chains = joinAtNodes(edges, w);

    const strokes = [];
    for (const c of chains) {
      const ws = c.p.map((i) => dist[i]).sort((a, b) => a - b);
      const hw = ws[Math.floor(ws.length / 2)] || half;
      let pts = c.p.map((i) => [(i % w) + 0.5, Math.floor(i / w) + 0.5]);
      pts = simplify(smooth(pts, c.closed), 0.6);
      // Strichbreite: doppelter Randabstand der Mittellinie
      strokes.push({ pts, w: Math.max(1, 2 * hw - 0.5) });
    }
    return strokes;
  }

  // ---------- Aufgezeichnete Zeichen → Striche in Seitenpixeln ----------

  const measureCtx = document.createElement("canvas").getContext("2d");
  let scratchCanvas = null;
  const scratch = () => scratchCanvas || (scratchCanvas = document.createElement("canvas"));

  function localBox(op) {
    if (op.type === "image") return [op.x, op.y, op.x + op.w, op.y + op.h];
    measureCtx.font = op.font;
    const t = measureCtx.measureText(op.text);
    const pad = 4;
    return [
      op.x - (t.actualBoundingBoxLeft || 0) - pad,
      op.y - (t.actualBoundingBoxAscent || 0) - pad,
      op.x + (t.actualBoundingBoxRight || t.width) + pad,
      op.y + (t.actualBoundingBoxDescent || 0) + pad,
    ];
  }

  function opToStrokes(op) {
    if (op.type === "strokes") return vectorStrokes(op);
    const [x0, y0, x1, y1] = localBox(op);
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => op.m.transformPoint(new DOMPoint(x, y)));
    const bx = Math.floor(Math.min(...corners.map((p) => p.x))) - 2;
    const by = Math.floor(Math.min(...corners.map((p) => p.y))) - 2;
    const bw = Math.ceil(Math.max(...corners.map((p) => p.x))) + 2 - bx;
    const bh = Math.ceil(Math.max(...corners.map((p) => p.y))) + 2 - by;
    if (bw <= 0 || bh <= 0 || bw * bh > 400000) return [];
    // Ein einziges Zeichenfeld für alle Zeichen: Safari hat ein festes Speicherlimit für Canvas
    const c = scratch();
    if (c.width < bw * SS || c.height < bh * SS) {
      c.width = Math.max(c.width, bw * SS);
      c.height = Math.max(c.height, bh * SS);
    }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw * SS, bh * SS);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.setTransform(SS, 0, 0, SS, -bx * SS, -by * SS);
    const m = op.m;
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.fillStyle = "#000";
    if (op.type === "text") {
      ctx.font = op.font;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(op.text, op.x, op.y);
    } else {
      ctx.drawImage(op.img, op.x, op.y, op.w, op.h);
    }
    const W = bw * SS, H = bh * SS;
    const data = ctx.getImageData(0, 0, W, H).data;
    const alpha = new Uint8Array(W * H);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return vectorize(alpha, W, H).map((s) => ({
      pts: s.pts.map(([x, y]) => [bx + x / SS, by + y / SS]),
      w: s.w / SS,
    }));
  }

  // Selbst gezeichnete Striche: Punkte in Seitenkoordinaten umrechnen
  function vectorStrokes(op) {
    const out = [];
    const sc = Math.sqrt(Math.abs(op.m.a * op.m.d - op.m.b * op.m.c));
    for (const st of op.strokes) {
      if (!st.length) continue;
      const pts = st.map(([x, y]) => {
        const p = op.m.transformPoint(new DOMPoint(op.ox + x * op.em, op.oy + y * op.em));
        return [p.x, p.y];
      });
      const avgP = st.reduce((a, q) => a + (q[2] ?? 0.5), 0) / st.length;
      out.push({ pts: simplify(pts, 0.15), w: op.widthOf(op.penWidth, avgP) * sc });
    }
    return out;
  }

  // ---------- Protobuf und Dateiformat ----------

  const enc = new TextEncoder();

  function varint(n, out) {
    let v = BigInt.asUintN(64, BigInt(n));
    while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    out.push(Number(v));
  }

  // msg = [[Feldnummer, Typ, Wert], ...]; Typen: "v" Ganzzahl, "s" Text/Bytes/Nachricht, "f" float32, "d" float64
  function encode(msg) {
    const out = [];
    for (const [num, type, val] of msg) {
      if (type === "v") { varint(num << 3, out); varint(val, out); continue; }
      if (type === "f") {
        varint((num << 3) | 5, out);
        const b = new Uint8Array(4);
        new DataView(b.buffer).setFloat32(0, val, true);
        out.push(...b);
        continue;
      }
      if (type === "d") {
        varint((num << 3) | 1, out);
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, val, true);
        out.push(...b);
        continue;
      }
      const bytes = typeof val === "string" ? enc.encode(val) : Array.isArray(val) ? encode(val) : val;
      varint((num << 3) | 2, out);
      varint(bytes.length, out);
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
    }
    return Uint8Array.from(out);
  }

  function delimited(msgs) {
    const parts = msgs.map(encode);
    const out = [];
    for (const p of parts) {
      varint(p.length, out);
      for (let i = 0; i < p.length; i++) out.push(p[i]);
    }
    return Uint8Array.from(out);
  }

  function concat(arrays) {
    const n = arrays.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }

  // Goodnotes speichert Geometrie LZ4-komprimiert in „bv41“-Blöcken; ein LZ4-Block darf aus
  // reinen Literalen bestehen, also ohne echte Kompression
  function bv41(body) {
    const parts = [];
    for (let i = 0; i < Math.max(body.length, 1); i += 32768) {
      const chunk = body.subarray(i, i + 32768);
      const n = chunk.length;
      const head = [];
      if (n < 15) head.push(n << 4);
      else {
        head.push(0xf0);
        let rest = n - 15;
        while (rest >= 255) { head.push(255); rest -= 255; }
        head.push(rest);
      }
      const payload = concat([Uint8Array.from(head), chunk]);
      const hdr = new Uint8Array(12);
      hdr.set(enc.encode("bv41"), 0);
      new DataView(hdr.buffer).setUint32(4, n, true);
      new DataView(hdr.buffer).setUint32(8, payload.length, true);
      parts.push(hdr, payload);
    }
    parts.push(enc.encode("bv4$"));
    return concat(parts);
  }

  // Punkte dichter machen (höchstens step Einheiten Abstand), wie bei echten Goodnotes-Strichen – so kann der
  // Radierer auch Teile eines Strichs entfernen. Abgetastet wird die weiche Kurve, die strokeGeometry aus den
  // Punkten macht (Punkte als Kontrollpunkte, Mittelpunkte als Kurvenenden), damit nichts eckig wird.
  function densify(pts, step) {
    if (pts.length < 2) return pts;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = [pts[0]];
    const quad = (p0, c, p1) => {
      const n = Math.max(1, Math.ceil((Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1])) / step));
      for (let j = 1; j <= n; j++) {
        const t = j / n, u = 1 - t;
        out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
      }
    };
    if (pts.length === 2) {
      quad(pts[0], mid(pts[0], pts[1]), pts[1]);
      return out;
    }
    let cur = pts[0];
    const first = mid(pts[0], pts[1]);
    quad(cur, mid(cur, first), first);
    cur = first;
    for (let i = 1; i < pts.length - 1; i++) {
      const end = i === pts.length - 2 ? pts[i + 1] : mid(pts[i], pts[i + 1]);
      quad(cur, pts[i], end);
      cur = end;
    }
    return out;
  }

  // Kugelschreiber-Strich: Schema "vuA(v)A(S(uu))A(S(uuuu))vA(f)"
  const PSTROKE = "vuA(v)A(S(uu))A(S(uuuu))vA(f)";
  function strokeGeometry(pts, thickness) {
    const kinds = [], moves = [], quads = [];
    kinds.push(0);
    moves.push(pts[0]);
    if (pts.length === 1) {
      kinds.push(1);
      quads.push([pts[0][0], pts[0][1], pts[0][0] + 0.01, pts[0][1]]);
    } else if (pts.length === 2) {
      kinds.push(1);
      quads.push([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, pts[1][0], pts[1][1]]);
    } else {
      // Weiche Kurve durch die Mittelpunkte, die Punkte selbst sind die Kontrollpunkte
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let cur = pts[0];
      const first = mid(pts[0], pts[1]);
      kinds.push(1);
      quads.push([(cur[0] + first[0]) / 2, (cur[1] + first[1]) / 2, first[0], first[1]]);
      for (let i = 1; i < pts.length - 1; i++) {
        const end = i === pts.length - 2 ? pts[i + 1] : mid(pts[i], pts[i + 1]);
        kinds.push(1);
        quads.push([pts[i][0], pts[i][1], end[0], end[1]]);
      }
    }
    const schema = enc.encode(PSTROKE + "\0");
    const size = 2 + 4 + 4 + kinds.length * 2 + 4 + moves.length * 8 + 4 + quads.length * 16 + 2 + 4;
    const body = new Uint8Array(8 + schema.length + size);
    const dv = new DataView(body.buffer);
    body.set(enc.encode("tpl\0"), 0);
    dv.setUint32(4, body.length, true);
    body.set(schema, 8);
    let o = 8 + schema.length;
    const u16 = (v) => { dv.setUint16(o, v, true); o += 2; };
    const u32 = (v) => { dv.setUint32(o, v, true); o += 4; };
    const f32 = (v) => { dv.setFloat32(o, v, true); o += 4; };
    u16(2);
    f32(thickness);
    u32(kinds.length); kinds.forEach(u16);
    u32(moves.length); moves.forEach(([x, y]) => { f32(x); f32(y); });
    u32(quads.length); quads.forEach((q) => q.forEach(f32));
    u16(1);
    u32(0);
    return bv41(body);
  }

  const rnd32 = () => (crypto.getRandomValues(new Uint32Array(1))[0]);
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID().toUpperCase();
    // Ältere Browser: Version-4-UUID von Hand
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const stamp = (counter = 1) => (counter ? [[1, "v", counter], [2, "v", rnd32()]] : [[2, "v", rnd32()]]);

  // „UUID + 1“: die Striche einer Seite liegen in notes/<Seiten-ID + 1>
  function uuidPlusOne(u) {
    const hex = u.replace(/-/g, "");
    const n = (BigInt("0x" + hex) + 1n) % (1n << 128n);
    const h = n.toString(16).toUpperCase().padStart(32, "0");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Seitenreihenfolge: Schlüssel, die als ASCII-Text sortiert werden
  const KEY_ALPHABET = "!-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";
  function keyAfter(a) {
    let out = "";
    for (let i = 0; ; i++) {
      const ia = i < a.length ? KEY_ALPHABET.indexOf(a[i]) : 0;
      if (KEY_ALPHABET.length - ia > 1) return out + KEY_ALPHABET[Math.floor((ia + KEY_ALPHABET.length) / 2)];
      out += i < a.length ? a[i] : KEY_ALPHABET[0];
    }
  }

  function color(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  const colorMsg = (rgba) => rgba.map((c, i) => [i + 1, "f", c]).filter(([, , c]) => c);

  // ---------- ZIP ----------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(d) {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(data) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const cs = new CompressionStream("deflate-raw");
      const buf = await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer();
      return new Uint8Array(buf);
    } catch (_) {
      return null;
    }
  }

  async function zip(files) {
    const local = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const [name, data] of files) {
      const nameB = enc.encode(name);
      const crc = crc32(data);
      let method = 0, body = data;
      if (data.length > 64) {
        const z = await deflateRaw(data);
        if (z && z.length < data.length) { method = 8; body = z; }
      }
      const lh = new Uint8Array(30 + nameB.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8-Namen
      dv.setUint16(8, method, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, body.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameB.length, true);
      lh.set(nameB, 30);
      local.push(lh, body);
      const ch = new Uint8Array(46 + nameB.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, body.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + body.length;
    }
    const cd = concat(central);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cd.length, true);
    ev.setUint32(16, offset, true);
    return new Blob([...local, cd, end], { type: "application/zip" });
  }

  // ---------- Kleine PDFs ohne weitere Bibliothek ----------

  /**
   * Baut ein PDF aus Seiten: [{ wPt, hPt, jpeg?: Uint8Array, imgW?, imgH? }].
   * Seiten ohne jpeg bleiben weiß. Das JPEG wird unverändert eingebettet.
   */
  function makePdf(pages) {
    const objs = []; // Index = Objektnummer - 1
    const add = (parts) => { objs.push(parts); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const kids = [];
    for (const pg of pages) {
      const w = +pg.wPt.toFixed(2), h = +pg.hPt.toFixed(2);
      let res = "<< >>", content = "";
      if (pg.jpeg) {
        const im = add([`<< /Type /XObject /Subtype /Image /Width ${pg.imgW} /Height ${pg.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`, pg.jpeg, "\nendstream"]);
        res = `<< /XObject << /Im0 ${im} 0 R >> >>`;
        content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
      }
      const cs = add([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
      kids.push(add([`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${w} ${h}] /Resources ${res} /Contents ${cs} 0 R >>`]));
    }
    objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`];
    objs[pagesObj - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`];
    const chunks = [enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((parts, i) => {
      offsets.push(offset);
      const piece = concat([enc.encode(`${i + 1} 0 obj\n`), ...parts.map((x) => (typeof x === "string" ? enc.encode(x) : x)), enc.encode("\nendobj\n")]);
      chunks.push(piece);
      offset += piece.length;
    });
    const xref = ["xref", `0 ${objs.length + 1}`, "0000000000 65535 f "]
      .concat(offsets.map((o) => String(o).padStart(10, "0") + " 00000 n "))
      .join("\n");
    chunks.push(enc.encode(`${xref}\ntrailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    return concat(chunks);
  }

  async function canvasToJpeg(canvas, quality = 0.9) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---------- Schrift aus Fotos/Scans → Striche ----------

  // Papierfarbe je 32er-Block aus den Pixeln außerhalb von hole, ohne dunkle Linien (Pixel nahe beim
  // Helligkeits-Median), weich interpoliert. Gibt (x, y, Kanal) → Wert zurück.
  function paperEstimate(px, hole, w, h) {
    const B = 32, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const est = new Float32Array(bw * bh * 3);
    const ok = new Uint8Array(bw * bh);
    const hist = new Uint32Array(256);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        hist.fill(0);
        let n = 0;
        const y0 = by * B, y1 = Math.min(h, y0 + B), x0 = bx * B, x1 = Math.min(w, x0 + B);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (hole[i]) continue;
          hist[Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2])]++;
          n++;
        }
        if (n < 40) continue;
        // Mittel der Pixel um die häufigste Helligkeit (das Papier): Linien fallen heraus, auch wenn
        // neben der Schrift fast nur Linien übrig sind; Rauschen mittelt sich weg
        let mode = 255, best = -1;
        for (let v = 0; v < 256; v++) {
          let sum = 0;
          for (let d = -3; d <= 3; d++) sum += hist[Math.min(255, Math.max(0, v + d))];
          if (sum > best || (sum === best && v > mode)) { best = sum; mode = v; }
        }
        if (best < 30) continue;
        const lo = mode - 6, hi = mode + 6;
        let r = 0, g = 0, b = 0, c = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (hole[i]) continue;
          const l = Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
          if (l < lo || l > hi) continue;
          r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; c++;
        }
        const o = (by * bw + bx) * 3;
        est[o] = r / c; est[o + 1] = g / c; est[o + 2] = b / c;
        ok[by * bw + bx] = 1;
      }
    }
    // Ausreißer (Block deutlich dunkler als seine Nachbarn, meist nur Linienpixel übrig) verwerfen
    const lumOf = (k) => 0.299 * est[k * 3] + 0.587 * est[k * 3 + 1] + 0.114 * est[k * 3 + 2];
    const drop = [];
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const k = by * bw + bx;
      if (!ok[k]) continue;
      const around = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = bx + dx, yy = by + dy;
        if ((dx || dy) && xx >= 0 && yy >= 0 && xx < bw && yy < bh && ok[yy * bw + xx]) around.push(lumOf(yy * bw + xx));
      }
      if (around.length < 4) continue;
      around.sort((a, b) => a - b);
      if (lumOf(k) < around[around.length >> 1] - 5) drop.push(k);
    }
    for (const k of drop) ok[k] = 0;
    // Blöcke ganz unter Schrift: aus den Nachbarn ergänzen
    for (let round = 0; round < bw + bh; round++) {
      let missing = 0;
      const next = ok.slice();
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const k = by * bw + bx;
        if (ok[k]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = bx + dx, yy = by + dy;
          if (xx < 0 || yy < 0 || xx >= bw || yy >= bh || !ok[yy * bw + xx]) continue;
          const o = (yy * bw + xx) * 3;
          r += est[o]; g += est[o + 1]; b += est[o + 2]; c++;
        }
        if (!c) { missing++; continue; }
        est[k * 3] = r / c; est[k * 3 + 1] = g / c; est[k * 3 + 2] = b / c;
        next[k] = 1;
      }
      ok.set(next);
      if (!missing) break;
    }
    return (x, y, ch) => {
      const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5)), fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const v = (xx, yy) => est[(yy * bw + xx) * 3 + ch];
      return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
    };
  }

  // Lange, gerade Linien (Randlinie, Linien, Kästchen des Papiers) gehören nicht zur Schrift:
  // Pixel entlang einer geraden Linie über mehr als ein Viertel der Seite aus der Maske nehmen.
  function removePaperLines(mask, w, h) {
    const dark = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dark[i] = mask[i] ? 50 : 0;
    for (const vertical of [true, false]) {
      const t = lineSlope(dark, w, h, vertical);
      const off = vertical ? h : w;
      const bins = new Uint32Array(w + h + 8);
      const bin = (x, y) => (vertical ? Math.round(x - y * t) : Math.round(y - x * t)) + off;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) bins[bin(x, y)]++;
      const span = vertical ? h : w;
      const line = new Uint8Array(bins.length);
      for (let b = 6; b < bins.length - 6; b++) {
        if (bins[b] < span * 0.25) continue;
        // Dünn muss sie sein: wenige Pixel daneben fast leer (eine Schriftzeile ist dort genauso dicht)
        const side = Math.max(bins[b - 5], bins[b - 6], bins[b + 5], bins[b + 6]);
        if (bins[b] < 4 * side) continue;
        line[b] = 1;
        if (b > 0 && bins[b - 1] > span * 0.08) line[b - 1] = 1;
        if (b + 1 < bins.length && bins[b + 1] > span * 0.08) line[b + 1] = 1;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x] && line[bin(x, y)]) mask[y * w + x] = 0;
    }
  }

  // Neigung der Papierlinien (liniert/kariert) schätzen: der Winkel, bei dem die Projektion der
  // „Liniendunkelheit“ am schärfsten ist. vertical=false: waagerechte Linien (y - x·tan), sonst senkrechte.
  function lineSlope(dark, w, h, vertical) {
    // Nur die Pixel mit Linienanteil sammeln (jeder 2. Punkt reicht), dann Winkel durchprobieren
    const xs = [], ys = [], vs = [];
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const v = dark[y * w + x];
        if (v >= 3) { xs.push(x); ys.push(y); vs.push(v); }
      }
    }
    const bins = new Float64Array(w + h + 8);
    const score = (deg) => {
      const t = Math.tan(deg * Math.PI / 180);
      bins.fill(0);
      for (let k = 0; k < xs.length; k++) {
        const bin = vertical ? Math.round(xs[k] - ys[k] * t) + h : Math.round(ys[k] - xs[k] * t) + w;
        if (bin >= 0 && bin < bins.length) bins[bin] += vs[k];
      }
      let sc = 0;
      for (let i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
      return sc;
    };
    // grob in 0,1°-Schritten, dann fein um das beste Ergebnis
    let best = 0, bestScore = -1;
    for (let a = -40; a <= 40; a++) {
      const sc = score(a / 10);
      if (sc > bestScore) { bestScore = sc; best = a / 10; }
    }
    const coarse = best;
    for (let d = -0.08; d <= 0.081; d += 0.02) {
      const sc = score(coarse + d);
      if (sc > bestScore) { bestScore = sc; best = coarse + d; }
    }
    return Math.tan(best * Math.PI / 180);
  }


  // Füllt die Pixel in hole (0/1): Papierfarbe (ohne Linien) plus die Linien des Papiers, die von beiden
  // Seiten in die Lücke laufen – entlang der gemessenen Neigung, mit ihrer echten Dicke und Farbe.
  function fillHoles(px, hole, w, h) {
    const paper = paperEstimate(px, hole, w, h);
    const orig = px.slice();
    // Abweichung jedes sauberen Pixels vom Papier (Linien, Ränder) und ihre Dunkelheit
    const delta = new Float32Array(w * h * 3);
    const dark = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hole[i]) continue;
        const dr = orig[i * 4] - paper(x, y, 0), dg = orig[i * 4 + 1] - paper(x, y, 1), db = orig[i * 4 + 2] - paper(x, y, 2);
        delta[i * 3] = dr; delta[i * 3 + 1] = dg; delta[i * 3 + 2] = db;
        dark[i] = Math.max(0, -(0.299 * dr + 0.587 * dg + 0.114 * db));
      }
    }
    // Nur dünne Linien zählen: dunkler als die Pixel 4 Punkte quer dazu (Schatten, Tisch, Ränder fallen weg)
    const thinH = new Float32Array(w * h), thinV = new Float32Array(w * h);
    for (let y = 4; y < h - 4; y++) {
      for (let x = 4; x < w - 4; x++) {
        const i = y * w + x;
        if (!dark[i]) continue;
        thinH[i] = Math.max(0, dark[i] - Math.max(dark[i - 4 * w], dark[i + 4 * w]));
        thinV[i] = Math.max(0, dark[i] - Math.max(dark[i - 4], dark[i + 4]));
      }
    }
    const sH = lineSlope(thinH, w, h, false), sV = lineSlope(thinV, w, h, true);

    // Erstes sauberes Pixel in Richtung (dx, dy) ab (x, y); Ergebnis: Index oder -1, Abstand in d
    const walk = (x, y, dx, dy, out) => {
      for (let j = 1; j < 4000; j++) {
        const xx = Math.round(x + dx * j), yy = Math.round(y + dy * j);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return -1;
        const i = yy * w + xx;
        if (!hole[i]) { out.d = j; return i; }
      }
      return -1;
    };
    const A = { d: 0 }, B = { d: 0 };
    // Linienanteil in einer Richtung: nur wenn beide Seiten dunkel sind (die Linie läuft durch)
    // Dunkelheit einer Linie, die am Pixel in Richtung (dx, dy) weiterläuft: Minimum über 3 Punkte
    // nach außen (eine querliegende Linie ist nach wenigen Pixeln zu Ende und zählt dann nicht)
    const along = (x, y, dx, dy, d, map) => {
      let m = 1e9, n = 0;
      for (let k = d; k <= d + 12 && n < 4; k += 2) {
        const xx = Math.round(x + dx * k), yy = Math.round(y + dy * k);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
        const i = yy * w + xx;
        if (hole[i]) continue; // nächstes Wort: überspringen
        m = Math.min(m, map[i]);
        n++;
      }
      return n >= 2 ? m : n === 1 ? m * 0.5 : 0;
    };
    const lineDelta = (x, y, dx, dy, map, acc) => {
      const ia = walk(x, y, -dx, -dy, A), ib = walk(x, y, dx, dy, B);
      if (ia < 0 || ib < 0) return;
      const da = along(x, y, -dx, -dy, A.d, map), db = along(x, y, dx, dy, B.d, map);
      if (da < 3 || db < 3) return;
      const t = A.d / (A.d + B.d);
      // Stärke durch die schwächere Seite begrenzen (sonst „bluten“ dunkle Kanten in die Lücke)
      const f = Math.min(1, Math.min(da, db) / Math.max(da, db) * 1.5);
      for (let c = 0; c < 3; c++) acc[c] += (delta[ia * 3 + c] * (1 - t) + delta[ib * 3 + c] * t) * f;
    };
    let seed = 12345;
    const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 3; };
    const nH = Math.hypot(1, sH), nV = Math.hypot(sV, 1);
    const acc = [0, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        acc[0] = acc[1] = acc[2] = 0;
        lineDelta(x, y, 1 / nH, sH / nH, dark, acc);
        lineDelta(x, y, sV / nV, 1 / nV, dark, acc);
        const n = noise();
        for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, paper(x, y, c) + acc[c] + n));
        px[i * 4 + 3] = 255;
      }
    }
  }

  // Quadratische Verbreiterung einer 0/1-Maske um r Pixel (zeilen- und spaltenweise)
  function dilate(mask, w, h, r) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      for (let x = 0; x < w; x++) { if (mask[y * w + x]) last = x; if (x - last <= r) tmp[y * w + x] = 1; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
    }
    return out;
  }

  /**
   * Findet dunkle Tinte (Schrift, Zeichnungen) in einem Bild und macht daraus Striche.
   * Gibt { strokes: [{pts, w, color}], cleaned: Canvas ohne Tinte } in Pixeln des Bildes zurück.
   * opts.contrast: wie viel dunkler als das Papier ein Pixel sein muss (0..1, Standard 0.28)
   */
  function strokesFromCanvas(canvas, opts = {}) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, w, h);
    const d = src.data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

    // Papierfarbe je Block: Mittel der helleren Hälfte, dann weich interpoliert
    const B = 32, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    const bg = new Float32Array(bw * bh * 4);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let sum = 0, n = 0;
        for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) { sum += lum[y * w + x]; n++; }
        const mean = sum / n;
        let r = 0, g = 0, b = 0, l = 0, c = 0;
        for (let y = by * B; y < Math.min(h, by * B + B); y++) {
          for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
            const i = y * w + x;
            if (lum[i] < mean) continue;
            r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; l += lum[i]; c++;
          }
        }
        const o = (by * bw + bx) * 4;
        bg[o] = r / c; bg[o + 1] = g / c; bg[o + 2] = b / c; bg[o + 3] = l / c;
      }
    }
    const bgAt = (x, y, ch) => {
      const fx = Math.min(bw - 1, Math.max(0, x / B - 0.5)), fy = Math.min(bh - 1, Math.max(0, y / B - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const v = (xx, yy) => bg[(yy * bw + xx) * 4 + ch];
      return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
    };

    const contrast = opts.contrast ?? 0.28;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const p = bgAt(x, y, 3);
        if (p - lum[i] > Math.max(35, p * contrast)) mask[i] = 1;
      }
    }
    // Einzelne Staubkörner entfernen
    const minArea = opts.minArea ?? Math.max(4, Math.round((w * h) / 400000));
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      const comp = [];
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        comp.push(c);
        const cx = c % w;
        for (const n of [c - w, c + w, cx > 0 ? c - 1 : -1, cx < w - 1 ? c + 1 : -1, c - w - 1, c - w + 1, c + w - 1, c + w + 1]) {
          if (n < 0 || n >= w * h || !mask[n] || seen[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (comp.length < minArea) for (const c of comp) mask[c] = 0;
    }

    removePaperLines(mask, w, h);

    // Rand von 1 Pixel einplanen, den vectorize freihält
    const W = w + 2, H = h + 2;
    const alpha = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) alpha[(y + 1) * W + x + 1] = 255;
    const raw = vectorize(alpha, W, H);

    const strokes = raw.map((s) => {
      const pts = s.pts.map(([x, y]) => [x - 1, y - 1]);
      // Farbe: Mittel der Bildpunkte entlang des Strichs
      let r = 0, g = 0, b = 0, n = 0;
      for (const [x, y] of pts) {
        const i = Math.min(h - 1, Math.max(0, Math.round(y - 0.5))) * w + Math.min(w - 1, Math.max(0, Math.round(x - 0.5)));
        if (!mask[i]) continue;
        r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++;
      }
      const color = n ? [r / n / 255, g / n / 255, b / n / 255, 1] : [0, 0, 0, 1];
      return { pts, w: s.w, color };
    });

    // Bild ohne Tinte: Tinte samt weichem Rand (Unschärfe, JPEG) entfernen und die Lücke aus dem sauberen
    // Papier daneben auffüllen – zeilenweise (Linien laufen durch), bei breiten Lücken auch spaltenweise
    const cleaned = document.createElement("canvas");
    cleaned.width = w;
    cleaned.height = h;
    const cctx = cleaned.getContext("2d");
    const out = cctx.createImageData(w, h);
    out.data.set(d);
    const hole = dilate(mask, w, h, Math.max(3, Math.round(Math.max(w, h) / 300)));
    fillHoles(out.data, hole, w, h);
    cctx.putImageData(out, 0, 0);
    return { strokes, cleaned };
  }

  // ---------- Weitere Goodnotes-Elemente ----------
  // Aufbau nach goodnotes-codec (model.py: new_box, new_sticky, new_line, new_image, new_shape_stroke,
  // new_pencil_stroke, rich_text), dort in Goodnotes geprüft. Alle Koordinaten und Größen sind im
  // Koordinatensystem der Seite (sizePx) und werden mit k in Goodnotes-Einheiten umgerechnet.

  const pointMsg = (x, y) => [...(x ? [[1, "f", x]] : []), ...(y ? [[2, "f", y]] : [])];
  const INHERIT = -404; // „wie Standard“ in Zeichenattributen
  const U64_MAX = (1n << 64n) - 1n;

  // Leerer Text einer Form, genau wie Goodnotes ihn schreibt, mit seinem Prüfwert
  const EMPTY_TEXT = Uint8Array.from(atob(
    "Cl0SLhoUDfHw8D0V2djYPR3Z2Ng9JQAAgD/FAgAAgEHgA+z8/////////wG1BAAAysMaKwoCCgASCwj///////////8BGhYI////////////ARD///////////8BIAI="),
    (c) => c.charCodeAt(0));
  const EMPTY_TEXT_HASH = Uint8Array.from([0xaf, 0xd2, 0xf3, 0xd3, 0x8e, 0x51, 0x6a, 0xda]);

  /**
   * Formatierter Text. runs: Text oder [{ text, color, font, size, bold, italic, link }, …]
   * size in Goodnotes-Einheiten (bereits umgerechnet). link: URL oder { page: Seitenindex }.
   */
  function richText(runs, ctx) {
    const list = typeof runs === "string" ? [{ text: runs }] : runs;
    return list.map((r) => {
      const a = [[3, "s", colorMsg(toRgba(r.color || [0.118, 0.106, 0.106, 1]))]];
      if (r.link !== undefined && r.link !== null) a.push([4, "s", linkUrl(r.link, ctx)]);
      if (r.font) a.push([30, "s", r.font]);
      a.push([40, "f", r.size ?? INHERIT]);
      if (r.italic) a.push([50, "v", 1]);
      a.push([60, "v", r.bold ? -30 : INHERIT]);
      a.push([70, "f", INHERIT]);
      const para = [[1, "s", [[1, "s", ""]]], [2, "s", [[1, "v", U64_MAX]]], [3, "s", [[1, "v", U64_MAX], [2, "v", U64_MAX]]]];
      return [1, "s", [[1, "s", r.text || ""], [2, "s", a], [3, "s", para]]];
    });
  }

  function linkUrl(link, ctx) {
    if (typeof link === "string") return link;
    const pageId = ctx.pageIds[link.page];
    if (!pageId) return "";
    const anchor = encodeURIComponent(btoa(`page-${pageId}`));
    return `https://app.goodnotes.com/documents/?anchor=${anchor}#${btoa(ctx.docId).replace(/=+$/, "")}`;
  }

  // Text-Halter {2 Text (bv41), 3 Prüfwert, 4 1}: Goodnotes prüft den Prüfwert nicht
  function textHolder(runs, ctx) {
    if (runs === undefined || runs === null || runs === "") {
      return [[2, "s", bv41(EMPTY_TEXT)], [3, "s", EMPTY_TEXT_HASH], [4, "v", 1]];
    }
    const body = encode(richText(runs, ctx));
    return [[2, "s", bv41(body)], [3, "s", crypto.getRandomValues(new Uint8Array(8))], [4, "v", 1]];
  }

  function defaultTextAttrs(font = "Helvetica Neue", size = 24) {
    const a = [[3, "s", [[4, "f", 1]]], [30, "s", font], [40, "f", size], [60, "v", -60], [70, "f", -20]];
    const p = [[1, "s", [[1, "s", ""]]], [2, "s", ""], [3, "s", [[1, "v", U64_MAX], [2, "v", U64_MAX]]]];
    return [[1, "s", a], [2, "s", p]];
  }

  // Linienstil {1 Breite, 2 {1 durchgezogen | 2 {1 Strich, 2 Lücke}}, 3 {1 Farbe}}
  function strokeStyle(width, color, dash) {
    const pattern = dash
      ? [[2, "s", [...(dash[0] ? [[1, "f", dash[0]]] : []), [2, "f", dash[1]]]]]
      : [[1, "s", ""]];
    return [[1, "f", width], [2, "s", pattern], [3, "s", [[1, "s", colorMsg(toRgba(color))]]]];
  }
  const DASHES = { dashed: [3, 4], dotted: [0, 2] };
  const dashOf = (d) => (Array.isArray(d) ? d : DASHES[d] || null);
  const ARROWS = { none: 0, open: 1, filled: 2 };
  const arrowOf = (a) => (typeof a === "number" ? a : a === true ? 1 : ARROWS[a] || 0);

  function templateBlob(schema, write) {
    const parts = [];
    const sch = enc.encode(schema + "\0");
    const vals = [];
    write({
      u16: (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); vals.push(b); },
      u32: (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); vals.push(b); },
      f32: (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); vals.push(b); },
    });
    const body = concat(vals);
    const head = new Uint8Array(8);
    head.set(enc.encode("tpl\0"), 0);
    new DataView(head.buffer).setUint32(4, 8 + sch.length + body.length, true);
    parts.push(head, sch, body);
    return bv41(concat(parts));
  }

  // Hülle eines Strichs (Stift 0 = Kugelschreiber, 5 = Bleistift)
  function strokeShell(ctx, color, geometry, { pen = 0, highlighter = false, shape = null } = {}) {
    const id = uuid(), st = stamp(2);
    const body = [[1, "s", id], [2, "s", geometry]];
    if (pen) body.push([3, "v", pen]);
    body.push([4, "s", colorMsg(toRgba(color))]);
    if (highlighter) body.push([5, "v", 1]);
    body.push([6, "s", ""], [7, "s", [[1, "s", stamp(1)]]], [9, "s", shape || ""], [15, "s", st], [20, "s", ""], [21, "v", 24]);
    return [ctx.meta(id, st), [[7, "s", body]]];
  }

  const PENCIL_SCHEMA = "vuA(v)A(S(uuuuu))A(S(uuuuuuuuuuu))A(S(uu))A(v)A(S(uu))A(S(uuuu))A(u)";

  function buildItem(it, ctx) {
    const k = ctx.k;
    const P = (p) => [p[0] * k, p[1] * k];
    switch (it.type) {
      case "stroke":
      case "highlighter": {
        const hl = it.type === "highlighter";
        const color = it.color || (hl ? [1, 0.85, 0, 0.5] : ctx.ink || "#000000");
        const rgba = toRgba(color);
        if (hl && rgba[3] === 1) rgba[3] = 0.5;
        const w = (it.w ?? (hl ? 20 : 2)) * k;
        return strokeShell(ctx, rgba, strokeGeometry(densify(it.pts.map(P), 6), Math.max(0.3, w)), { highlighter: hl });
      }
      case "pencil": {
        // Bleistift: je Punkt x, y, Azimut, Höhe, Druck; jedes Kurvenstück beginnt mit einem Textur-Zufallswert
        const pts = densify(it.pts.map(P), 6);
        const f = it.pressure ?? 0.6;
        const p5 = (q) => [q[0], q[1], 0.5, 1, f];
        const w = (it.w ?? 2) * k;
        const geometry = templateBlob(PENCIL_SCHEMA, ({ u16, u32, f32 }) => {
          u16(1); f32(w / 2);
          u32(pts.length); u16(0); for (let i = 1; i < pts.length; i++) u16(1);
          u32(1); p5(pts[0]).forEach(f32);
          u32(pts.length - 1);
          for (let i = 1; i < pts.length; i++) {
            u32(rnd32());
            p5([(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2]).forEach(f32);
            p5(pts[i]).forEach(f32);
          }
          for (let a = 0; a < 5; a++) u32(0);
        });
        return strokeShell(ctx, it.color || [0.2, 0.2, 0.2, 1], geometry, { pen: 5 });
      }
      case "shapeStroke": {
        // Mit dem Form-Werkzeug gezeichnet: leerer Pfad plus Beschreibung der Form
        const w = (it.w ?? 2.5) * k;
        let d;
        if (it.shape === "rect") d = [[3, "s", [[1, "s", pointMsg(...P(it.center))], [2, "s", pointMsg(...P(it.size))]]]];
        else if (it.shape === "ellipse") d = [[4, "s", [[1, "s", pointMsg(...P(it.center))], [2, "s", pointMsg(...P(it.radii))], ...(it.angle ? [[3, "f", it.angle]] : [])]]];
        else d = [[1, "s", it.points.map((p) => [1, "s", pointMsg(...P(p))])]];
        d.push([5, "s", [[2, "v", 1]]], [15, "f", w]);
        const geometry = templateBlob(PSTROKE, ({ u16, u32, f32 }) => { u16(2); f32(w / 2); u32(0); u32(0); u32(0); u16(1); u32(0); });
        return strokeShell(ctx, it.color || ctx.ink || "#000000", geometry, { shape: d });
      }
      case "shape":
      case "text": {
        const id = uuid(), st = stamp();
        const b = [[1, "s", id], [2, "v", 35], [3, "s", st], [7, "s", [[1, "s", stamp()]]]];
        b.push([20, "s", [[1, "s", pointMsg(it.x * k, it.y * k)], [3, "f", 1]]]);
        b.push([21, "s", [[2, "s", [...pointMsg(it.w * k, it.h * k), [3, "f", Infinity]]]]]);
        let geo;
        const shape = it.type === "text" ? "rect" : it.shape || "rect";
        if (shape === "ellipse") geo = [[2, "s", ""]];
        else if (shape === "polygon") {
          geo = [[3, "s", [[1, "s", [...it.vertices.map(([x, y]) => [1, "s", [[1, "s", pointMsg(x, y)], [2, "v", 1]]]), [2, "v", 1]]]]]];
        } else if (it.radius) geo = [[1, "s", [[1, "f", it.radius * k]]]];
        else geo = [[1, "s", ""]];
        b.push([22, "s", geo]);
        b.push([30, "s", [[1, "s", it.fill ? [[1, "s", colorMsg(toRgba(it.fill))]] : ""]]]);
        b.push([31, "s", it.outline
          ? strokeStyle((it.outline.width ?? 2) * k, it.outline.color || "#000000", dashOf(it.outline.dash))
          : [[2, "s", [[1, "s", ""]]]]]);
        const size = (it.size ?? 24 / k) * k;
        const runs = typeof it.text === "string"
          ? [{ text: it.text, color: it.color, font: it.font, size, bold: it.bold, italic: it.italic, link: it.link }]
          : (it.text || []).map((r) => ({ ...r, size: r.size !== undefined ? r.size * k : size }));
        const t = [
          [1, "s", textHolder(it.text ? runs : null, ctx)],
          [5, "s", defaultTextAttrs(it.font || "Helvetica Neue", size)],
          [10, "s", [1, 2, 3, 4].map((n) => [n, "f", 10])],
        ];
        b.push([32, "s", t]);
        return [ctx.meta(id, st, 35), [[21, "s", b]]];
      }
      case "sticky": {
        const id = uuid(), st = stamp(4);
        const size = (it.size ?? 24 / k) * k;
        const b = [[1, "s", id], [2, "v", 35], [3, "s", st], [7, "s", [[1, "s", stamp()]]],
          [20, "s", [[1, "s", pointMsg(it.x * k, it.y * k)], [3, "f", 1]]],
          [21, "s", [[2, "s", [...pointMsg((it.w ?? 256 / k) * k, (it.h ?? 256 / k) * k), [3, "f", Infinity]]]]],
          [30, "s", colorMsg(toRgba(it.color || [0.98, 0.906, 0.471, 1]))]];
        const t = [[5, "s", defaultTextAttrs()]];
        if (it.text) t.push([1, "s", textHolder(typeof it.text === "string" ? [{ text: it.text, size }] : it.text, ctx)]);
        b.push([31, "s", t], [40, "v", 1], [41, "v", 1]);
        return [ctx.meta(id, st, 35), [[20, "s", b]]];
      }
      case "line": {
        const id = uuid(), st = stamp();
        const b = [[1, "s", id], [2, "v", 31], [3, "s", st], [7, "s", [[1, "s", stamp()]]]];
        const a = P(it.from), e = P(it.to);
        const m = it.via ? P(it.via) : [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
        if (it.elbow) {
          b.push([21, "s", [[1, "s", [[1, "s", pointMsg(...a)]]], [3, "s", [[1, "s", pointMsg(...e)]]], [5, "s", [[2, "s", pointMsg(...m)]]]]]);
        } else {
          b.push([20, "s", [[1, "s", [[1, "s", pointMsg(...a)]]], [2, "s", pointMsg(...m)], [3, "s", [[1, "s", pointMsg(...e)]]]]]);
        }
        const sa = arrowOf(it.startArrow), ea = arrowOf(it.endArrow);
        if (sa) b.push([30, "v", sa]);
        if (ea) b.push([31, "v", ea]);
        b.push([32, "s", strokeStyle((it.w ?? 3) * k, it.color || ctx.ink || "#000000", dashOf(it.dash))]);
        return [ctx.meta(id, st, 31), [[22, "s", b]]];
      }
      case "image": {
        const aid = ctx.attachment(it.data);
        const id = uuid(), st = stamp(6);
        const w = it.w * k, h = it.h * k;
        const cx = (it.x + it.w / 2) * k, cy = (it.y + it.h / 2) * k;
        const ang = it.angle || 0;
        const bw = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang));
        const bh = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
        const b = [
          [1, "s", id],
          [2, "s", [[1, "s", pointMsg(cx - bw / 2, cy - bh / 2)], [2, "s", pointMsg(bw, bh)]]],
          [3, "s", [[1, "s", pointMsg(cx, cy)], [2, "s", pointMsg(w, h)], ...(ang ? [[3, "f", ang]] : [])]],
          [4, "s", aid], [5, "s", [[1, "s", stamp()]]], [6, "v", 1], [15, "s", st], [18, "v", 24],
        ];
        return [ctx.meta(id, st, 24, aid), [[1, "s", b]]];
      }
      default:
        throw new Error(`Unbekannter Elementtyp: ${it.type}`);
    }
  }

  // ---------- Dokument zusammenbauen ----------

  // Goodnotes rechnet in Einheiten von 1/1,8333 pt (A4 = 1091,35 × 1543,46)
  const GN_PER_PT = 11 / 6;
  const DEFAULT_COVER = "5A53E89E-F4C2-4548-8DD3-E9DF9FB4592E";
  const A4 = [595.28, 841.89];

  const toRgba = (c) => (Array.isArray(c) ? (c.length === 4 ? c : [...c, 1]) : color(c || "#000000"));

  /**
   * Baut eine .goodnotes-Datei (Blob).
   *
   * pages: [{
   *   strokes:    [{ pts: [[x, y], ...], w, color? }]  – Koordinaten in sizePx der Seite, w = Strichbreite
   *   sizePt:     [Breite, Höhe] in pt (Standard: opts.pagePt oder A4)
   *   sizePx:     [Breite, Höhe] des Koordinatensystems der Striche (Standard: opts.pagePx oder sizePt)
   *   background: { pdf: Uint8Array, page: 1 }  – Seite eines PDFs als Hintergrund (Standard: weiß)
   *   items:      [{ type: "text" | "shape" | "sticky" | "line" | "image" | "stroke" | "highlighter" |
   *                       "pencil" | "shapeStroke", … }]  – siehe buildItem und README.md
   *   bookmark, rotation (90/180/270), outline ("Titel im Inhaltsverzeichnis")
   * }]
   * opts: { title, ink (Standardfarbe, "#rrggbb"), thumbnail (JPEG-Bytes), language ("de_DE"),
   *         pagePt, pagePx, background (PDF-Bytes für alle Seiten) }
   */
  async function buildDocument(pages, opts = {}) {
    const device = BigInt.asUintN(63, (BigInt(rnd32()) << 32n) | BigInt(rnd32()));
    let clock = Date.now() - 1000;
    const tick = () => ++clock;
    let seq = 0;
    const docId = uuid();
    const time = () => Date.now() + Math.random();

    const files = [];
    const events = [];
    const attIndex = [];

    // Dokument
    events.push([[1, "s", docId], [30, "s", [
      [1, "s", docId],
      [2, "s", [[1, "s", opts.title || "Dokument"], [2, "s", stamp()]]],
      // Standard-Umschlag und -Papier, wie in allen Goodnotes-Dateien
      [3, "s", [[1, "s", DEFAULT_COVER], [2, "s", stamp()]]],
      [6, "s", [[1, "s", "P"], [2, "s", stamp()]]],
      [7, "s", [[1, "s", DEFAULT_COVER], [2, "s", stamp()]]],
      [9, "s", [[1, "s", opts.language || "de_DE"]]], // Sprache der Handschrifterkennung
      [10, "d", time()], [11, "s", uuid()], [13, "v", device], [14, "v", tick()],
      [17, "s", ""], [18, "s", ""],
      [19, "s", [[2, "s", stamp()]]],
      [20, "v", 24],
    ]]]);

    // Anhänge (PDFs) nur einmal speichern, Papier-Ebenen je Hintergrund und Größe nur einmal anlegen
    const attachments = new Map();
    const attachment = (bytes) => {
      if (attachments.has(bytes)) return attachments.get(bytes);
      const id = uuid();
      attachments.set(bytes, id);
      files.push([`attachments/${id}`, bytes]);
      attIndex.push([[1, "s", id], [2, "s", `attachments/${id}`]]);
      events.push([[1, "s", id], [6, "s", [
        [1, "s", id], [2, "s", id], [5, "v", bytes.length], [6, "s", docId],
        [10, "d", time()], [11, "s", uuid()], [12, "s", ""], [14, "v", device], [15, "v", tick()], [16, "v", 24],
      ]]]);
      return id;
    };
    const layers = new Map();
    const blanks = new Map();
    const layer = (bg, sizePt) => {
      let pdf = bg && bg.pdf, pdfPage = (bg && bg.page) || 1;
      if (!pdf) {
        const key = sizePt.join("x");
        if (!blanks.has(key)) blanks.set(key, makePdf([{ wPt: sizePt[0], hPt: sizePt[1] }]));
        pdf = blanks.get(key);
        pdfPage = 1;
      }
      const attId = attachment(pdf);
      const key = `${attId}|${pdfPage}|${sizePt.join("x")}`;
      if (layers.has(key)) return layers.get(key);
      const id = uuid();
      layers.set(key, id);
      events.push([[1, "s", id], [2, "s", [
        [1, "s", docId], [2, "s", id], [4, "s", attId], [5, "v", pdfPage],
        [8, "s", [[1, "f", sizePt[0] * GN_PER_PT], [2, "f", sizePt[1] * GN_PER_PT]]],
        [10, "d", time()], [11, "s", uuid()],
        [12, "s", [[2, "s", stamp()]]], [13, "s", [[2, "s", stamp()]]],
        [15, "v", device], [16, "v", tick()],
        [17, "s", [[2, "s", stamp()]]], [19, "s", [[2, "s", stamp()]]],
        [21, "v", 24],
      ]]]);
      return id;
    };

    const notesIndex = [];
    let key = "";
    let firstPageId = null;
    const pageIds = pages.map(() => uuid());
    let outlineKey = "";
    for (const [pageIndex, page] of pages.entries()) {
      const sizePt = page.sizePt || opts.pagePt || A4;
      const sizePx = page.sizePx || opts.pagePx || sizePt;
      const bg = page.background || (opts.background ? { pdf: opts.background, page: 1 } : null);
      const layerId = layer(bg, sizePt);
      const k = (sizePt[0] * GN_PER_PT) / sizePx[0];

      const pageId = pageIds[pageIndex];
      const notesId = uuidPlusOne(pageId);
      key = keyAfter(key);
      events.push([[1, "s", pageId], [54, "s", [
        [1, "s", docId], [2, "s", pageId],
        [3, "s", [[1, "s", layerId], [2, "s", stamp()]]],
        [4, "s", [[1, "s", key], [2, "s", stamp()]]],
        [10, "d", time()], [11, "s", uuid()], [13, "v", device], [14, "v", tick()], [15, "v", 24],
      ]]]);
      events.push([[1, "s", notesId], [102, "s", [
        [1, "s", notesId], [10, "d", time()], [11, "s", uuid()], [13, "v", device], [14, "v", tick()],
        [15, "v", 24], [16, "s", docId],
      ]]]);
      firstPageId = firstPageId || pageId;

      const records = [];
      for (const s of page.strokes || []) {
        if (!s.pts.length) continue;
        const id = uuid();
        const st = stamp(2);
        records.push([
          [1, "s", id], [2, "s", st], [8, "v", device], [9, "v", ++seq], [14, "v", 5381], [16, "v", 24],
        ]);
        records.push([[7, "s", [
          [1, "s", id],
          [2, "s", strokeGeometry(densify(s.pts.map(([x, y]) => [x * k, y * k]), 6), Math.max(0.3, s.w * k))],
          [4, "s", colorMsg(toRgba(s.color || opts.ink))],
          [6, "s", ""],
          [7, "s", [[1, "s", stamp(1)]]],
          [9, "s", ""],
          [15, "s", st],
          [20, "s", ""],
          [21, "v", 24],
        ]]]);
      }
      // Weitere Elemente: Textfelder, Formen, Haftnotizen, Linien, Bilder, Textmarker, Bleistift …
      const ctx = {
        k, device, docId, pageIds, seq: () => ++seq, attachment, ink: opts.ink,
        meta: (id, st, version = 24, att = null) => [
          [1, "s", id], [2, "s", st], ...(att ? [[4, "s", att]] : []),
          [8, "v", device], [9, "v", ++seq], [14, "v", 5381], [16, "v", version],
        ],
      };
      for (const it of page.items || []) records.push(...buildItem(it, ctx));

      // Seiten-Eigenschaften (jede ist ein eigenes Ereignis)
      const pageEvent = (kind, body, versionField = 15) => {
        body.push([10, "d", time()], [11, "s", uuid()], [13, "v", device], [14, "v", tick()], [versionField, "v", 24]);
        events.push([[1, "s", pageId], [kind, "s", body]]);
        return body;
      };
      if (page.bookmark) {
        pageEvent(57, [[1, "s", docId], [2, "s", pageId], [3, "s", [[1, "v", 1], [2, "s", stamp()]]]]);
      }
      if (page.rotation) {
        const q = ((Math.round(page.rotation / 90) % 4) + 4) % 4;
        pageEvent(63, [[1, "s", docId], [2, "s", pageId], [3, "s", [...(q ? [[1, "v", q]] : []), [2, "s", stamp()]]]], 16);
      }
      if (page.outline) {
        outlineKey = keyAfter(outlineKey);
        const body = pageEvent(65, [
          [1, "s", pageId], [2, "s", uuid()],
          [3, "s", [[2, "s", stamp(0)]]],
          [4, "s", [[1, "s", outlineKey], [2, "s", stamp(0)]]],
          [5, "s", [[1, "s", String(page.outline)], [2, "s", stamp(0)]]],
          [6, "s", [[2, "s", stamp(0)]]],
          [15, "s", [[1, "s", ""], [2, "s", stamp(0)]]],
          [17, "s", docId],
        ], 16);
        body[body.length - 1] = [16, "v", 26]; // Inhaltsverzeichnis-Einträge tragen 26 statt 24
      }

      notesIndex.push([[1, "s", notesId], [2, "s", `notes/${notesId}`]]);
      files.push([`notes/${notesId}`, delimited(records)]);
    }
    // Zuletzt angesehene Seite: die erste
    events.push([[1, "s", docId], [10, "s", [
      [1, "s", docId], [2, "s", firstPageId], [3, "s", `PagingViewServiceUpdater:${uuid()}`],
      [10, "d", time()], [11, "s", uuid()], [13, "v", device], [14, "v", tick()], [15, "v", 24],
    ]]]);

    const out = [
      ["index.search.pb", new Uint8Array(0)],
      ["index.notes.pb", delimited(notesIndex)],
      ...files.filter(([n]) => n.startsWith("notes/")),
      ["index.events.pb", delimited(events)],
    ];
    if (opts.thumbnail) out.push(["thumbnail.jpg", opts.thumbnail]);
    out.push(["index.attachments.pb", delimited(attIndex)]);
    out.push(...files.filter(([n]) => n.startsWith("attachments/")));
    out.push(["schema.pb", Uint8Array.from([0x08, 0x18])]);
    return zip(out);
  }

  // Wandelt die aufgezeichneten Zeichen einer Seite in Striche um
  function strokesFromOps(ops) {
    const out = [];
    for (const op of ops) out.push(...opToStrokes(op));
    return out;
  }

  // ---------- Getippter Text aus PDFs → Goodnotes-Textfelder ----------

  const GN_INSET_PT = 10 / GN_PER_PT; // Innenabstand der Goodnotes-Textfelder (10 Einheiten) in pt
  const GN_ASCENT = 0.952;           // Oberlänge von Helvetica Neue: Abstand Feldoberkante → Grundlinie

  function gnFont(name, family) {
    const n = `${name || ""} ${family || ""}`;
    if (/courier|mono|consol/i.test(n)) return "Courier New";
    if (/times|serif(?!.*sans)|georgia|garamond|roman|minion|cambria|book/i.test(n) && !/sans/i.test(n)) return "Times New Roman";
    return "Helvetica Neue";
  }

  /**
   * Text einer PDF-Seite (PDF.js getTextContent) in Zeilen zerlegen.
   * pageHeightPt: Seitenhöhe; fontOf(fontName) → { name, family } (optional); colorAt(x, y, w, h) → "#rrggbb" (optional).
   * Ergebnis (pt, Ursprung oben links): [{ x, baseline, size, runs: [{ text, x, width, size, font, bold, italic, color }] }]
   */
  function pdfTextLines(textContent, pageHeightPt, fontOf, colorAt) {
    const pieces = [];
    for (const it of textContent.items) {
      if (!it.str || !it.transform) continue;
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 * Math.abs(a) || Math.abs(c) > 0.01 * Math.abs(d)) continue; // gedrehter Text bleibt im Hintergrund
      const size = Math.hypot(c, d) || Math.abs(d) || it.height;
      if (!size) continue;
      const info = (fontOf && fontOf(it.fontName)) || {};
      const style = (textContent.styles && textContent.styles[it.fontName]) || {};
      const fname = info.name || "";
      pieces.push({
        text: it.str, x: e, baseline: pageHeightPt - f, size, width: it.width,
        font: gnFont(fname, style.fontFamily),
        bold: info.bold || /bold|black|heavy|semibold|demi/i.test(fname),
        italic: info.italic || /italic|oblique/i.test(fname),
      });
    }
    pieces.sort((p, q) => p.baseline - q.baseline || p.x - q.x);
    // Zeilen: gleiche Grundlinie (± ein Viertel der Schriftgröße)
    const rows = [];
    for (const p of pieces) {
      const row = rows.find((r) => Math.abs(r.baseline - p.baseline) < 0.25 * Math.max(r.size, p.size));
      if (row) { row.items.push(p); row.size = Math.max(row.size, p.size); } else rows.push({ baseline: p.baseline, size: p.size, items: [p] });
    }
    const lines = [];
    for (const r of rows) {
      r.items.sort((p, q) => p.x - q.x);
      let cur = null, space = false;
      for (const p of r.items) {
        // Reine Leerzeichen-Stücke zählen nicht als Text (manche PDFs überbrücken damit ganze Tabellenspalten)
        if (!p.text.trim()) { space = true; continue; }
        const end = cur ? cur.x + cur.width : 0;
        const gap = cur ? p.x - end : 0;
        // Große Lücke (Tabellenspalten, Tabulatoren, mehrere Leerzeichen): neues Feld an eigener Stelle
        if (!cur || gap > 0.9 * r.size) {
          if (cur) lines.push(cur);
          cur = { x: p.x, baseline: r.baseline, size: r.size, width: 0, runs: [] };
          space = false;
        }
        const last = cur.runs[cur.runs.length - 1];
        let text = p.text;
        if (last && (space || gap > 0.15 * p.size) && !/\s$/.test(last.text) && !/^\s/.test(text)) text = " " + text;
        space = false;
        if (last && last.font === p.font && last.bold === p.bold && last.italic === p.italic && Math.abs(last.size - p.size) < 0.5) {
          last.text += text;
          last.width = p.x + p.width - last.x;
        } else {
          cur.runs.push({ text, x: p.x, width: p.width, size: p.size, font: p.font, bold: p.bold, italic: p.italic });
        }
        cur.width = p.x + p.width - cur.x;
      }
      if (cur) lines.push(cur);
    }
    for (const l of lines) {
      l.runs = l.runs.filter((r) => r.text.trim());
      if (!l.runs.length) continue;
      l.runs[0].text = l.runs[0].text.replace(/^\s+/, "");
      if (colorAt) {
        let prev = "#1e1b1b";
        for (const r of l.runs) {
          // Bereich von der Oberlänge bis unter die Grundlinie (Unterstriche, Unterlängen)
          const c = colorAt(r.x, l.baseline - r.size * 0.8, Math.max(1, r.width), r.size * 1.05);
          const n = parseInt(c.slice(1), 16);
          const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
          r.color = lum > 200 ? prev : c; // nichts Dunkles gefunden: Farbe davor bzw. Schwarz
          prev = r.color;
        }
      }
    }
    return lines.filter((l) => l.runs.length);
  }

  /** Zeilen aus pdfTextLines → Textfelder für page.items (eins je Zeile, gemischte Formatierung möglich) */
  function textBoxesFromLines(lines) {
    return lines.map((l) => ({
      type: "text",
      x: l.x - GN_INSET_PT,
      y: l.baseline - GN_ASCENT * l.size - GN_INSET_PT,
      // etwas Luft, weil die Goodnotes-Schrift breiter sein kann als die des PDFs
      w: l.width * 1.12 + 2 * GN_INSET_PT + l.size,
      h: l.size * 1.3 + 2 * GN_INSET_PT,
      font: l.runs[0].font,
      size: l.size,
      text: l.runs.map((r) => ({ text: r.text, size: r.size, font: r.font, bold: r.bold, italic: r.italic, color: r.color })),
    }));
  }

  // ---------- Bequeme Wege: Bilder / PDF → Goodnotes ----------

  // Seitengröße in pt für ein Bild: auf A4-Breite (Hochformat) bzw. A4-Höhe (Querformat) skaliert
  function fitPt(wPx, hPx) {
    const portrait = hPx >= wPx;
    const long = A4[1], short = A4[0];
    return portrait ? [short, (short * hPx) / wPx] : [long, (long * hPx) / wPx];
  }

  /**
   * Bilder (Canvas, Bild-Elemente) → Seiten für buildDocument.
   * opts.editable: true = dunkle Schrift wird zu bearbeitbaren Strichen, das Bild darunter ohne Schrift
   * opts.contrast: siehe strokesFromCanvas; opts.sizesPt: Seitengröße in pt je Bild (Standard: A4-Breite)
   * opts.onProgress(i, n): Fortschritt
   */
  async function fromImagesPages(images, opts = {}) {
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      if (opts.onProgress) opts.onProgress(i, images.length);
      const src = images[i];
      const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      // Weißer Untergrund für transparente Bilder
      const flat = document.createElement("canvas");
      flat.width = w;
      flat.height = h;
      const fx = flat.getContext("2d");
      fx.fillStyle = "#fff";
      fx.fillRect(0, 0, w, h);
      fx.drawImage(src, 0, 0, w, h);
      let strokes = [], bgCanvas = flat;
      if (opts.editable) {
        const r = strokesFromCanvas(flat, opts);
        strokes = r.strokes;
        bgCanvas = r.cleaned;
      }
      const sizePt = (opts.sizesPt && opts.sizesPt[i]) || fitPt(w, h);
      const jpeg = await canvasToJpeg(bgCanvas, opts.quality ?? 0.88);
      pages.push({
        strokes,
        sizePt,
        sizePx: [w, h],
        background: { pdf: makePdf([{ wPt: sizePt[0], hPt: sizePt[1], jpeg, imgW: w, imgH: h }]), page: 1 },
      });
      // Speicher sofort freigeben (Safari begrenzt den Canvas-Speicher)
      if (bgCanvas !== flat) bgCanvas.width = bgCanvas.height = 0;
      flat.width = flat.height = 0;
      await new Promise((r) => setTimeout(r, 0));
    }
    return pages;
  }

  /** Bilder → .goodnotes (Blob). Optionen wie fromImagesPages, dazu title, language. */
  async function fromImages(images, opts = {}) {
    const pages = await fromImagesPages(images, opts);
    let thumbnail = null;
    if (images.length) {
      const t = document.createElement("canvas");
      const src = images[0];
      const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
      t.width = 300;
      t.height = Math.max(1, Math.round((300 * h) / w));
      const tx = t.getContext("2d");
      tx.fillStyle = "#fff";
      tx.fillRect(0, 0, t.width, t.height);
      tx.drawImage(src, 0, 0, t.width, t.height);
      thumbnail = await canvasToJpeg(t, 0.7);
    }
    return buildDocument(pages, { title: opts.title, thumbnail, language: opts.language });
  }

  /**
   * PDF → .goodnotes. Ohne „editable“ bleibt das PDF unverändert (scharfe Schrift) als Hintergrund.
   * pdfBytes: Uint8Array; pageSizes: [[wPt, hPt], ...] (z. B. von PDF.js);
   * renderPage(i) → Canvas der Seite i (nur für opts.editable nötig)
   */
  async function fromPdf(pdfBytes, pageSizes, opts = {}, renderPage) {
    if (opts.editable && renderPage) {
      const canvases = [];
      for (let i = 0; i < pageSizes.length; i++) canvases.push(await renderPage(i));
      return fromImages(canvases, opts);
    }
    const pages = pageSizes.map((sizePt, i) => ({ strokes: [], sizePt, background: { pdf: pdfBytes, page: i + 1 } }));
    return buildDocument(pages, { title: opts.title, language: opts.language, thumbnail: opts.thumbnail });
  }

  window.GoodnotesExport = {
    // Handschrift-Umwandler
    createRecorder, strokesFromOps,
    // allgemein
    buildDocument, fromImages, fromImagesPages, fromPdf, strokesFromCanvas, vectorize, makePdf, canvasToJpeg,
    // getippter Text aus PDFs
    pdfTextLines, textBoxesFromLines,
  };
})();
