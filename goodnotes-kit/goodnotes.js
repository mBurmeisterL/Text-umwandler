// goodnotes-kit – .goodnotes-Dateien im Browser erzeugen (ohne Server, ohne weitere Bibliotheken)
//
// Was es kann:
//   - Striche (Kugelschreiber) schreiben, die in Goodnotes radierbar und mit dem Lasso verschiebbar sind
//   - Seiten mit Hintergrund: PDF-Seiten (bleiben scharf) oder Bilder
//   - Schrift aus Fotos/Scans in bearbeitbare Striche umwandeln (strokesFromCanvas)
//   - Canvas-Zeichnungen (fillText, drawImage) aufzeichnen und in Striche umwandeln (createRecorder)
//   - kleine PDFs aus JPEGs bauen (makePdf)
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
    const c = document.createElement("canvas");
    c.width = bw * SS;
    c.height = bh * SS;
    const ctx = c.getContext("2d", { willReadFrequently: true });
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
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const alpha = new Uint8Array(c.width * c.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return vectorize(alpha, c.width, c.height).map((s) => ({
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
  const uuid = () => crypto.randomUUID().toUpperCase();
  const stamp = (counter = 1) => [[1, "v", counter], [2, "v", rnd32()]];

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

    // Bild ohne Tinte: Tinte samt weichem Rand (Unschärfe, JPEG) durch Papierfarbe ersetzen
    const cleaned = document.createElement("canvas");
    cleaned.width = w;
    cleaned.height = h;
    const cctx = cleaned.getContext("2d");
    const out = cctx.createImageData(w, h);
    out.data.set(d);
    const near = dilate(mask, w, h, 1);
    const halo = dilate(mask, w, h, Math.max(3, Math.round(Math.max(w, h) / 450)));
    // Papierfarbe neu schätzen: Mittel aller Pixel ohne Tinte (die hellere Hälfte wäre zu hell)
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let r = 0, g = 0, b = 0, l = 0, c = 0;
        for (let y = by * B; y < Math.min(h, by * B + B); y++) {
          for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
            const i = y * w + x;
            if (halo[i]) continue;
            r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; l += lum[i]; c++;
          }
        }
        if (c < (B * B) / 8) continue; // zu wenig Papier im Block: alte Schätzung behalten
        const o = (by * bw + bx) * 4;
        bg[o] = r / c; bg[o + 1] = g / c; bg[o + 2] = b / c; bg[o + 3] = l / c;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!halo[i]) continue;
        const o = i * 4;
        const r = bgAt(x, y, 0), g = bgAt(x, y, 1), b = bgAt(x, y, 2);
        // Am Rand nur ersetzen, was farblich spürbar vom Papier abweicht
        if (!near[i] && Math.abs(d[o] - r) + Math.abs(d[o + 1] - g) + Math.abs(d[o + 2] - b) < 14) continue;
        out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = 255;
      }
    }
    cctx.putImageData(out, 0, 0);
    return { strokes, cleaned };
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
    for (const page of pages) {
      const sizePt = page.sizePt || opts.pagePt || A4;
      const sizePx = page.sizePx || opts.pagePx || sizePt;
      const bg = page.background || (opts.background ? { pdf: opts.background, page: 1 } : null);
      const layerId = layer(bg, sizePt);
      const k = (sizePt[0] * GN_PER_PT) / sizePx[0];

      const pageId = uuid();
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
          [2, "s", strokeGeometry(s.pts.map(([x, y]) => [x * k, y * k]), Math.max(0.3, s.w * k))],
          [4, "s", colorMsg(toRgba(s.color || opts.ink))],
          [6, "s", ""],
          [7, "s", [[1, "s", stamp(1)]]],
          [9, "s", ""],
          [15, "s", st],
          [20, "s", ""],
          [21, "v", 24],
        ]]]);
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
   * opts.contrast: siehe strokesFromCanvas; opts.onProgress(i, n): Fortschritt
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
      const sizePt = fitPt(w, h);
      const jpeg = await canvasToJpeg(bgCanvas, opts.quality ?? 0.88);
      pages.push({
        strokes,
        sizePt,
        sizePx: [w, h],
        background: { pdf: makePdf([{ wPt: sizePt[0], hPt: sizePt[1], jpeg, imgW: w, imgH: h }]), page: 1 },
      });
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
  };
})();
