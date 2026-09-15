// ── lib/stromdaten.js — Strom-Messjahre: Lastgänge einlesen, je Jahr auswerten, vergleichen ──
// DOM-frei. Genutzt von 23-messjahre-panel.js (⚡ Strom-Grundlagen › Messjahre) und den
// Gutachten-Figuren zu Kapitel 3.2 Stromverbrauchsdaten (17). Ein Messjahr trägt den
// Bezugslastgang vom Netzbetreiber und optional den Erzeugungslastgang eines BHKW; ausgewertet
// wird immer die Summe beider (= Stromverbrauch der Liegenschaft).
//
// Messjahr: { id, jahr, bezug: Reihe, bhkw: Reihe|null }
// Reihe:    { werte: Float32Array (kW), istViertel, startDate: Date|null, dateiname }

export const SD_VERSION = 1;
/** Ab dieser Veränderung vom ersten zum letzten Messjahr (in %) gilt der Verbrauch als steigend bzw. fallend. */
export const SD_TREND_SCHWELLE = 5;

const VIERTEL = { min: 34800, max: 36000, kappe: 35136 };   // 35.040 Werte, Toleranz für Schaltjahre
const STUNDEN = { min: 8560, max: 9000, kappe: 8784 };

let _idZaehler = 0;
export function sdId() {
  _idZaehler++;
  return 'mj' + Date.now().toString(36) + _idZaehler.toString(36) + Math.random().toString(36).slice(2, 6);
}

const gueltig = d => d instanceof Date && !isNaN(d.getTime());

/** Zeitstempel „TT.MM.JJJJ hh:mm“ oder „JJJJ-MM-TT hh:mm“ → Date, sonst null. */
function parseZeit(roh) {
  const s = String(roh || '').trim().replace(/['"]/g, '');
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

/**
 * Lastgang-CSV lesen — dieselben Regeln wie der bisherige Upload unter Strom-Grundlagen:
 * Trenner Semikolon/Tab/Komma, Dezimalpunkt oder -komma, optional Zeitstempel in Spalte 1,
 * 35.040 Viertelstunden- oder 8.760 Stundenwerte (Schaltjahr-Toleranz).
 * @returns {{werte: Float32Array, istViertel: boolean, startDate: Date|null, jahr: number|null} | {fehler: string}}
 */
export function sdParseLastgang(text) {
  const roh = String(text || '');
  const ohneBom = roh.charCodeAt(0) === 0xfeff ? roh.slice(1) : roh;   // UTF-8-BOM mancher Excel-Exporte
  const zeilen = ohneBom.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  if (zeilen.length < 100) return { fehler: 'Zu wenig Zeilen (< 100). Bitte Format prüfen.' };

  const probe = zeilen.slice(0, 5).join('\n');
  const sep = probe.includes(';') ? ';' : probe.includes('\t') ? '\t' : ',';
  const ersteSpalten = zeilen[0].split(sep);
  const hatZwei = ersteSpalten.length >= 2;
  const s0 = ersteSpalten[0].trim().replace(',', '.');
  const s1 = hatZwei ? ersteSpalten[1].trim().replace(',', '.') : '';
  const s0IstZahl = !isNaN(parseFloat(s0)) && /^-?[\d.]+$/.test(s0);
  const s1IstZahl = hatZwei && !isNaN(parseFloat(s1));
  const wertSpalte = (hatZwei && !s0IstZahl) ? 1 : (hatZwei && s1IstZahl) ? 1 : 0;
  const ersterWert = (ersteSpalten[wertSpalte] || '').trim().replace(',', '.');
  const start = isNaN(parseFloat(ersterWert)) ? 1 : 0;   // Kopfzeile überspringen

  const werte = [], datenZeilen = [];
  for (let i = start; i < zeilen.length; i++) {
    const spalten = zeilen[i].split(sep);
    if (spalten.length <= wertSpalte) continue;
    const v = parseFloat(spalten[wertSpalte].trim().replace(',', '.'));
    if (!isNaN(v)) { werte.push(v); datenZeilen.push(i); }
  }
  const n = werte.length;
  if (n < 100) {
    return { fehler: `Zu wenig verwertbare Werte (${n}). Bitte Trennzeichen, Dezimalzeichen und Wert-Spalte prüfen.` };
  }
  const istViertel = n >= VIERTEL.min && n <= VIERTEL.max;
  if (!istViertel && !(n >= STUNDEN.min && n <= STUNDEN.max)) {
    return { fehler: `Unbekannte Wertanzahl: ${n.toLocaleString('de-DE')} Messwerte. Erwartet werden 35.040 `
                   + 'Viertelstunden- oder 8.760 Stundenwerte eines Jahres.' };
  }

  let startDate = null, jahr = null;
  if (wertSpalte > 0) {
    const zeit = i => parseZeit(zeilen[datenZeilen[i]].split(sep)[0]);
    const erste = zeit(0);
    if (gueltig(erste)) startDate = erste;
    // Jahr aus der Jahresmitte: ein erster Wert „31.12. 23:45“ oder „01.01. 00:15“ verschiebt es nicht
    const mitte = zeit(Math.floor(datenZeilen.length / 2));
    jahr = gueltig(mitte) ? mitte.getFullYear() : startDate ? startDate.getFullYear() : null;
  }
  return { werte: Float32Array.from(werte.slice(0, istViertel ? VIERTEL.kappe : STUNDEN.kappe)), istViertel, startDate, jahr };
}

/** Messjahr aus einem Dateinamen („Lastgang_2023.csv“ → 2023), sonst null. */
export function sdJahrAusDateiname(name) {
  const m = String(name || '').match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/);
  return m ? Number(m[1]) : null;
}

/** Viertelstunden zu Stundenmitteln (volle Stunden; ein Schaltjahr bleibt 8.784 Stunden lang). */
export function sdViertelZuStunden(werte) {
  const n = Math.floor(werte.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (werte[4 * i] + werte[4 * i + 1] + werte[4 * i + 2] + werte[4 * i + 3]) / 4;
  return out;
}

/** Genau 8.760 Stundenwerte für die Stundenrechnung (PV, Optimierer) — wie bisher ohne die letzten 24 h eines Schaltjahrs. */
export function sdStunden8760(werte, istViertel) {
  const h = istViertel ? sdViertelZuStunden(werte) : werte;
  const out = new Float32Array(8760);
  for (let i = 0; i < Math.min(h.length, 8760); i++) out[i] = h[i];
  return out;
}

/**
 * Bezug + BHKW-Erzeugung Wert für Wert. Bei unterschiedlicher Auflösung wird auf Stunden gemittelt;
 * fehlende BHKW-Werte am Ende zählen als 0. abweichungWerte = Längenunterschied in der gemeinsamen Auflösung.
 */
export function sdSummenreihe(bezug, bhkw) {
  if (!bhkw) return { werte: bezug.werte, istViertel: bezug.istViertel, abweichungWerte: 0 };
  const viertel = bezug.istViertel && bhkw.istViertel;
  const a = viertel || !bezug.istViertel ? bezug.werte : sdViertelZuStunden(bezug.werte);
  const b = viertel || !bhkw.istViertel ? bhkw.werte : sdViertelZuStunden(bhkw.werte);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (i < b.length ? b[i] : 0);
  return { werte: out, istViertel: viertel, abweichungWerte: Math.abs(a.length - b.length) };
}

/** Jahresarbeit, Spitzenlast, Grundlast (1-%-Quantil wie die Gutachten-Ganglinien) und Benutzungsdauer. */
export function sdKennzahlen(werte, istViertel) {
  const n = werte.length;
  if (!n) return { arbeitKwh: 0, spitzeKw: 0, grundlastKw: 0, benutzungsdauerH: null };
  let summe = 0, spitze = 0;
  for (let i = 0; i < n; i++) { const v = werte[i]; summe += v; if (v > spitze) spitze = v; }
  const sortiert = Float32Array.from(werte).sort();
  const arbeitKwh = summe * (istViertel ? 0.25 : 1);
  return {
    arbeitKwh,
    spitzeKw: spitze,
    grundlastKw: sortiert[Math.floor(n * 0.01)] || 0,
    benutzungsdauerH: spitze > 0 ? arbeitKwh / spitze : null,
  };
}

const _auswertung = new WeakMap();
/** Kennzahlen eines Messjahrs (Bezug, BHKW, Summe) samt Summenreihe — je Messjahr-Objekt gemerkt; Änderungen legen neue Objekte an. */
export function sdJahresauswertung(mj) {
  let a = _auswertung.get(mj);
  if (a) return a;
  const reihe = sdSummenreihe(mj.bezug, mj.bhkw);
  a = {
    bezug: sdKennzahlen(mj.bezug.werte, mj.bezug.istViertel),
    bhkw: mj.bhkw ? sdKennzahlen(mj.bhkw.werte, mj.bhkw.istViertel) : null,
    gesamt: sdKennzahlen(reihe.werte, reihe.istViertel),
    reihe,
  };
  _auswertung.set(mj, a);
  return a;
}

/**
 * Tabellenzeilen aller Messjahre mit Bezugslastgang, aufsteigend nach Jahr. Leistungswerte und Arbeit
 * „gesamt“ = Bezug + BHKW; aenderungProzent = Gesamtverbrauch gegenüber dem vorherigen Messjahr (erste Zeile null).
 */
export function sdJahresuebersicht(daten) {
  const jahre = (daten?.jahre || []).filter(mj => mj?.bezug && Number.isFinite(mj.jahr)).sort((x, y) => x.jahr - y.jahr);
  let vorher = null;
  return jahre.map(mj => {
    const a = sdJahresauswertung(mj);
    const z = {
      id: mj.id, jahr: mj.jahr, referenz: mj.id === daten.referenzId,
      bezugKwh: a.bezug.arbeitKwh, bhkwKwh: a.bhkw ? a.bhkw.arbeitKwh : null, gesamtKwh: a.gesamt.arbeitKwh,
      spitzeKw: a.gesamt.spitzeKw, spitzeBezugKw: a.bezug.spitzeKw, grundlastKw: a.gesamt.grundlastKw,
      benutzungsdauerH: a.gesamt.benutzungsdauerH, istViertel: a.reihe.istViertel,
      aenderungProzent: vorher && vorher.gesamtKwh > 0 ? (a.gesamt.arbeitKwh / vorher.gesamtKwh - 1) * 100 : null,
    };
    vorher = z;
    return z;
  });
}

/** Verbrauchstrend vom ersten zum letzten Messjahr; null bei weniger als zwei Jahren. */
export function sdTrend(zeilen, schwelle = SD_TREND_SCHWELLE) {
  if (!zeilen || zeilen.length < 2) return null;
  const von = zeilen[0], bis = zeilen[zeilen.length - 1];
  const prozent = von.gesamtKwh > 0 ? (bis.gesamtKwh / von.gesamtKwh - 1) * 100 : 0;
  const werte = zeilen.map(z => z.gesamtKwh);
  return {
    art: prozent > schwelle ? 'steigend' : prozent < -schwelle ? 'fallend' : 'bestaendig',
    prozent, von, bis, minKwh: Math.min(...werte), maxKwh: Math.max(...werte),
  };
}

/** [2022, 2023, 2024] → „2022 bis 2024“; mit Lücken → „2021, 2023 und 2024“. */
export function sdZeitraumText(jahre) {
  const j = [...new Set(jahre)].sort((a, b) => a - b);
  if (!j.length) return '';
  if (j.length === 1) return String(j[0]);
  if (j[j.length - 1] - j[0] === j.length - 1) return `${j[0]} bis ${j[j.length - 1]}`;
  return `${j.slice(0, -1).join(', ')} und ${j[j.length - 1]}`;
}

/** Absteigend sortierte Jahresdauerlinie, auf feste Stützstellenzahl verdichtet (erste = Spitze, letzte = Minimum). */
export function sdDauerlinie(werte, punkte = 600) {
  const n = werte.length;
  if (!n) return [];
  const aufsteigend = Float32Array.from(werte).sort();
  const p = Math.max(2, Math.min(punkte, n));
  const out = new Array(p);
  for (let k = 0; k < p; k++) out[k] = aufsteigend[n - 1 - Math.round(k * (n - 1) / (p - 1))];
  return out;
}

/** Referenz-Messjahr als Reihen für window.elQuartierH15/H (Bezug + BHKW); null ohne gewähltes Jahr. */
export function sdReferenzReihen(daten) {
  const mj = (daten?.jahre || []).find(j => j.id === daten.referenzId && j.bezug);
  if (!mj) return null;
  const { reihe } = sdJahresauswertung(mj);
  const sd = mj.bezug.startDate;
  return {
    mj,
    h15: reihe.istViertel ? reihe.werte : null,
    h: sdStunden8760(reihe.werte, reihe.istViertel),
    aufloesung: reihe.istViertel ? 15 : 60,
    // Zeitstempel der Datei, solange er zum Messjahr passt (auch „31.12. 23:45“ des Vorjahrs); sonst 1. Januar
    startDate: gueltig(sd) && Math.abs(sd.getFullYear() - mj.jahr) <= 1 ? sd : new Date(mj.jahr, 0, 1),
    dateiname: `Messjahr ${mj.jahr}${mj.bhkw ? ' (Bezug + BHKW)' : ''}${mj.bezug.dateiname ? ` · ${mj.bezug.dateiname}` : ''}`,
  };
}

/* ── Projektdatei ────────────────────────────────────────────────────────── */
const rund = v => Math.round(v * 100) / 100;

function reiheSpeichern(r) {
  return {
    werte: Array.from(r.werte, rund),
    startDate: gueltig(r.startDate) ? r.startDate.toISOString() : null,
    dateiname: r.dateiname || '',
  };
}

export function sdCapture(daten) {
  return {
    version: SD_VERSION,
    referenzId: daten.referenzId || null,
    jahre: daten.jahre.map(mj => ({
      id: mj.id, jahr: mj.jahr, bezug: reiheSpeichern(mj.bezug), bhkw: mj.bhkw ? reiheSpeichern(mj.bhkw) : null,
    })),
  };
}

/** Gespeicherte Reihe prüfen — die Auflösung ergibt sich aus der Wertanzahl. */
function reiheLaden(r) {
  if (!r || typeof r !== 'object' || !(Array.isArray(r.werte) || ArrayBuffer.isView(r.werte))) return null;
  const n = r.werte.length;
  const istViertel = n >= VIERTEL.min && n <= VIERTEL.kappe;
  if (!istViertel && !(n >= STUNDEN.min && n <= STUNDEN.kappe)) return null;
  const d = r.startDate ? new Date(r.startDate) : null;
  return {
    werte: Float32Array.from(r.werte, v => Number(v) || 0),
    istViertel,
    startDate: gueltig(d) ? d : null,
    dateiname: typeof r.dateiname === 'string' ? r.dateiname : '',
  };
}

/** Gespeicherte Messjahre prüfen; unbrauchbare Einträge fallen weg, eine ungültige Referenz wird null. */
export function sdNormalisieren(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.jahre)) return { jahre: [], referenzId: null };
  const ids = new Set();
  const jahre = [];
  for (const e of input.jahre) {
    const bezug = reiheLaden(e?.bezug);
    if (!bezug) continue;
    let jahr = Math.round(Number(e.jahr));
    if (!(jahr >= 1990 && jahr <= 2100)) jahr = bezug.startDate ? bezug.startDate.getFullYear() : NaN;
    if (!Number.isFinite(jahr)) continue;
    let id = typeof e.id === 'string' ? e.id.replace(/[^\w-]/g, '') : '';
    if (!id || ids.has(id)) id = sdId();
    ids.add(id);
    jahre.push({ id, jahr, bezug, bhkw: reiheLaden(e.bhkw) });
  }
  const referenzId = jahre.some(j => j.id === input.referenzId) ? input.referenzId : null;
  return { jahre, referenzId };
}

/** Altprojekt mit einem einzelnen Lastgang (quartierProfile) als ein Messjahr — bleibt Referenz, weil alle Rechnungen darauf aufbauten. */
export function sdAusQuartierProfil(qp) {
  if (!qp || !Array.isArray(qp.values)) return { jahre: [], referenzId: null };
  const bezug = reiheLaden({ werte: qp.values15?.length ? qp.values15 : qp.values, startDate: qp.startDate, dateiname: qp.filename || '' });
  if (!bezug) return { jahre: [], referenzId: null };
  const jahr = bezug.startDate?.getFullYear() ?? sdJahrAusDateiname(qp.filename) ?? new Date().getFullYear();
  const mj = { id: sdId(), jahr, bezug, bhkw: null };
  return { jahre: [mj], referenzId: mj.id };
}
