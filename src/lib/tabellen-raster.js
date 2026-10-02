// ── lib/tabellen-raster.js — Tabellenkalkulations-Logik für bearbeitbare Tabellen (Gebäudeübersicht) ──
// DOM-frei: Bereiche markieren, Werte herunterziehen (Ausfüllkästchen), Strg+D, Kopieren/Einfügen im
// Format von Excel (Tabulator/Zeilenumbruch) und deutsche Zahlen lesen. Die Oberfläche
// (04a-ui-panels.js) übersetzt Mausereignisse in Zeilen-/Spaltenindizes und wendet die Änderungen an.
//
// Koordinaten: r = Zeile in der sichtbaren Reihenfolge, c = Index der bearbeitbaren Spalte.

/** Bereich aus zwei Ecken, normalisiert: { r0, r1, c0, c1 } mit r0 <= r1, c0 <= c1. */
export function trBereich(a, b = a) {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
}

export const trImBereich = (b, r, c) => !!b && r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1;
export const trGroesse = b => (b ? (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) : 0);

/**
 * Ausfüllkästchen: Der Bereich `b` wird bis Zeile `ziel` erweitert (nach unten oder oben). Die Quellzeilen
 * wiederholen sich zyklisch wie in Excel. Ergebnis: [{ r, c, quelleR }] nur für die neuen Zellen.
 */
export function trFuellen(b, ziel) {
  const out = [];
  const h = b.r1 - b.r0 + 1;
  if (ziel > b.r1) {
    for (let r = b.r1 + 1; r <= ziel; r++) for (let c = b.c0; c <= b.c1; c++) out.push({ r, c, quelleR: b.r0 + ((r - b.r0) % h) });
  } else if (ziel < b.r0) {
    for (let r = b.r0 - 1; r >= ziel; r--) for (let c = b.c0; c <= b.c1; c++) out.push({ r, c, quelleR: b.r1 - ((b.r1 - r) % h) });
  }
  return out;
}

/** Strg+D: die oberste Zeile des Bereichs in alle übrigen Zeilen übernehmen. */
export function trNachUnten(b) {
  const out = [];
  for (let r = b.r0 + 1; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) out.push({ r, c, quelleR: b.r0 });
  return out;
}

/** Text aus der Zwischenablage (Excel, LibreOffice, Google Sheets) als Matrix. Anführungszeichen-Zellen werden aufgelöst. */
export function trZwischenablageLesen(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!s) return [];
  const zeilen = [];
  let zeile = [], zelle = '', inAnf = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inAnf) {
      if (ch === '"' && s[i + 1] === '"') { zelle += '"'; i++; } else if (ch === '"') inAnf = false; else zelle += ch;
    } else if (ch === '"' && zelle === '') inAnf = true;
    else if (ch === '\t') { zeile.push(zelle); zelle = ''; } else if (ch === '\n') { zeile.push(zelle); zeilen.push(zeile); zeile = []; zelle = ''; } else zelle += ch;
  }
  if (zelle !== '' || zeile.length) { zeile.push(zelle); zeilen.push(zeile); }
  return zeilen.map(z => z.map(v => v.trim()));
}

/** Matrix als Text für die Zwischenablage (Tabulator und Zeilenumbruch, Excel-kompatibel). */
export function trAlsText(matrix) {
  return matrix.map(z => z.map(v => {
    const t = String(v ?? '');
    return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join('\t')).join('\n');
}

/**
 * Ziele beim Einfügen: Eine einzelne Zelle in einen markierten Bereich füllt den ganzen Bereich (wie Excel);
 * sonst wird die Matrix ab der Ankerzelle eingesetzt und am Tabellenrand abgeschnitten.
 * Ergebnis: [{ r, c, wert }].
 */
export function trEinfuegen(matrix, anker, bereich, zeilenAnzahl, spaltenAnzahl) {
  const out = [];
  if (!matrix.length || !matrix[0].length) return out;
  if (matrix.length === 1 && matrix[0].length === 1 && bereich && trGroesse(bereich) > 1) {
    for (let r = bereich.r0; r <= bereich.r1; r++) for (let c = bereich.c0; c <= bereich.c1; c++) out.push({ r, c, wert: matrix[0][0] });
    return out;
  }
  // Mehrzeilige Matrix in einen größeren Bereich: wiederholen, wenn der Bereich ein Vielfaches ist
  const start = bereich ? { r: bereich.r0, c: bereich.c0 } : anker;
  const hoehe = bereich && (bereich.r1 - bereich.r0 + 1) % matrix.length === 0 ? bereich.r1 - bereich.r0 + 1 : matrix.length;
  for (let i = 0; i < hoehe; i++) {
    const zeile = matrix[i % matrix.length];
    for (let j = 0; j < zeile.length; j++) {
      const r = start.r + i, c = start.c + j;
      if (r < zeilenAnzahl && c < spaltenAnzahl) out.push({ r, c, wert: zeile[j] });
    }
  }
  return out;
}

/** Deutsche oder englische Zahlenschreibweise lesen: „1.234,5“, „1234,5“, „1234.5“, „1.234“ (Tausender). NaN bei Unsinn. */
export function trZahl(text) {
  let t = String(text ?? '').trim().replace(/[\s\u00a0]/g, '').replace(/[a-zA-Zäöü²³/%€]+$/u, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Nutzung aus eingefügtem Text: passt auf Kennung oder Bezeichnung, ohne Groß-/Kleinschreibung. null, wenn unbekannt. */
export function trNutzung(text, typen) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t) return null;
  const treffer = typen.find(x => String(x.id).toLowerCase() === t) || typen.find(x => String(x.label || '').toLowerCase() === t)
    || typen.find(x => String(x.label || '').toLowerCase().startsWith(t));
  return treffer ? treffer.id : null;
}
