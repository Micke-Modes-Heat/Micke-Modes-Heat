// ── lib/gutachten-waerme-texte.js — Ergebnisgesteuerte Textbausteine für den Wärmeteil des Gutachtens ──
// DOM- und importfrei, damit jede Fallunterscheidung in Vitest direkt prüfbar ist und die Datei ein Blatt im
// Importgraph bleibt. Die Funktionen bekommen einen Schnappschuss der Projektdaten (siehe wtNormalisiere) und
// liefern Absätze: jeder Absatz ist eine Liste aus Textstücken (string) und Platzhaltern ({ feld, wert }).
// Ein Platzhalter mit leerem `wert` erscheint im Gutachten gelb als „[Feldname]“, mit Wert grün — dieselbe
// Mechanik wie bei den Strom-Bausteinen in 17-gutachten-grafik.js.
//
// Grundsätze:
//   • Keine erfundenen Werte. Was im Projekt fehlt, wird Platzhalter oder der Satz entfällt.
//   • Die Datenherkunft steht immer im Text: Messung oder Synthese, Klimastandort, gesetzte oder geschätzte
//     Gebäudewerte, Quelle der Netzverluste.
//   • Wertungen („niedrig“, „typisch“, „erhöht“) hängen an den benannten Schwellen unten.
//   • Bestand und Neubau werden unterschieden: Ohne Gebäudebestand gibt es keinen Ist-Zustand.
//   • Der Soll-Zustand (2.2) kennt KEIN Versorgungssystem. Er beschreibt nur Bedarf und Lastgang nach den baulichen
//     Veränderungen. Erzeuger und Konzepte kommen erst im Variantenvergleich (2.4), die Wahl in der Empfehlung (2.7);
//     die empfohlene Variante setzt der Gutachter.
//
// Kapitel (Standardgliederung, lib/gutachten-dokument.js):
//   2.1 Ist-Zustand · 2.2.1 Dimensionierung WEA (Bedarf und Auslegungsleistung) · 2.2.2 WVN · 2.2.3 WH ·
//   2.4 Variantenvergleich · 2.5 Wirtschaftlichkeit · 2.7 Empfehlung · 6.1 Fazit Wärmeversorgung

/* ══════════════════════════════════════════════════════════════════════════
 * Schwellen und Kataloge
 * ═══════════════════════════════════════════════════════════════════════ */

/** Mindestanteile erneuerbarer Energien und unvermeidbarer Abwärme in Wärmenetzen nach WPG. */
export const WPG_EE_ZIELE = [{ jahr: 2030, pct: 30 }, { jahr: 2040, pct: 80 }, { jahr: 2045, pct: 100 }];

/** Auslegungsregeln der Netzhydraulik im Tool (Pa/m je Leitung, m/s). */
export const WT_HYDRAULIK_STANDARD = { dpNetzPaM: 150, dpAnschlussPaM: 250, vZielMs: 1.0, vMinMs: 0.3, vMaxMs: 2.0, hausstationBar: 0.5 };

export const WT_SCHWELLEN = {
  vollbenutzungH: { spitzig: 1800, gleichmaessig: 3000 },   // Wärmenetze mit Heizlast und Warmwasser liegen typisch dazwischen
  leerlaufAnteil: 0.05,                         // Anteil der Stunden mit Last < 2 % der Spitze, ab dem von Sommerabschaltung gesprochen wird
  leistungsreserve: { unterdeckung: 0.95, knapp: 1.0, ausreichend: 1.2, ueberdimensioniert: 1.5 },
  n1Teil: 0.7,                                  // Anteil der Spitzenlast, den die Restanlage nach Ausfall des größten Erzeugers noch hält
  jaz: { sehrGut: 4.0, gut: 3.2, maessig: 2.5 },
  bhkwH: { gering: 3000, hoch: 6000 },
  kesselAnteil: { reserve: 10, spitze: 50 },    // % der Jahreswärme
  netzverlustPct: { niedrig: 10, ueblich: 20, erhoeht: 30 },
  waermebelegungKwhM: { niedrig: 500, hoch: 1500 },
  vorlaufC: { hoch: 90, mittel: 70, nieder: 50 },
  spreizungK: { gering: 20, gut: 30 },
  ruecklaufC: { gut: 40, moderat: 55 },
  gleichwertigPct: { wgk: 3, co2: 5 },          // Spannweite darunter gilt als „nahezu gleichwertig“
  bedarfsaenderungPct: 2,                       // darunter gilt der Bedarf als unverändert
};

/** Anteile der Jahreswärme, für die die Deckungsleistung genannt wird (systemunabhängige Kennzahl der Dauerlinie). */
export const WT_DECKUNGSANTEILE = [0.3, 0.65, 0.9];

/** Erzeugerarten des Dispatch; `ee` zählt zum Anteil erneuerbarer Energien, `fossil` zu den fossilen Erzeugern. */
export const WT_ERZEUGER = {
  lwwp:        { name: 'Luft-Wasser-Wärmepumpe', art: 'wp', unterart: 'luft', ee: true },
  geo:         { name: 'Erdwärmepumpe', art: 'wp', unterart: 'erde', ee: true },
  fg:          { name: 'Fließgewässer-Wärmepumpe', art: 'wp', unterart: 'wasser', ee: true },
  gaskessel:   { name: 'Gaskessel', art: 'kessel', fossil: true },
  _autoGk:     { name: 'Spitzenlast-Gaskessel', art: 'kessel', fossil: true },
  heizoel:     { name: 'Heizölkessel', art: 'kessel', fossil: true },
  bhkw:        { name: 'BHKW', art: 'bhkw', fossil: true },
  pellets:     { name: 'Pelletkessel', art: 'biomasse', ee: true },
  hhs:         { name: 'Holzhackschnitzelkessel', art: 'biomasse', ee: true },
  stromkessel: { name: 'Elektrodenkessel', art: 'strom' },
  solarthermie: { name: 'Solarthermieanlage', art: 'solar', ee: true },
  fernwaerme:  { name: 'Fernwärme-Anschluss', art: 'fernwaerme' },
  _thermSpeicher: { name: 'Wärmespeicher', art: 'speicher' },
};

/* ══════════════════════════════════════════════════════════════════════════
 * Hilfen
 * ═══════════════════════════════════════════════════════════════════════ */
const num = v => (v == null || v === '' ? NaN : Number(v));
const ok = v => Number.isFinite(v);
const nf = (v, nk = 0) => {
  const x = Math.abs(v) < 0.5 * 10 ** -nk ? 0 : v;
  return Number(x).toLocaleString('de-DE', { minimumFractionDigits: nk, maximumFractionDigits: nk });
};
const pct = (v, nk = 0) => `${nf(v, nk)} %`;
/** Platzhalter; leerer Wert = offen (gelb). */
export const F = (feld, wert) => ({ feld, wert: wert == null ? '' : String(wert) });
const liste = teile => (teile.length <= 1 ? teile.join('') : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`);
const summe = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
const kleinN = (n, einzahl, mehrzahl) => (n === 1 ? einzahl : mehrzahl);
/** Bestimmter Artikel zum Erzeuger („der Gaskessel“, „die Wärmepumpe“, „das BHKW“); `gross` für den Satzanfang. */
const ARTIKEL = { wp: 'die', kessel: 'der', biomasse: 'der', strom: 'der', bhkw: 'das', solar: 'die', fernwaerme: 'der', speicher: 'der' };
const mitArtikel = (e, gross = false) => {
  const a = ARTIKEL[e.art] || 'der';
  return `${gross ? a[0].toUpperCase() + a.slice(1) : a} ${e.name}`;
};

/** Absatz aus Zeichenketten und Platzhaltern; benachbarte Zeichenketten werden verbunden. */
function absatz(...teile) {
  const out = [];
  for (const t of teile.flat(Infinity)) {
    if (t === '' || t == null || t === false) continue;
    if (typeof t === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/** Zwischenüberschrift innerhalb eines Bausteins (LKEBw-Grün, fett) — ein Absatz mit Kennzeichen `ueberschrift`. */
function ueberschrift(text) {
  const a = absatz(text);
  a.ueberschrift = true;
  return a;
}

/** Hilfen für verwandte Textmodule (Gebäudekapitel): gleiche Zahlenformate, Platzhalter und Absatzbildung. */
export const wtHilfen = { num, ok, nf, pct, liste, summe, kleinN, absatz, ueberschrift };

/** Absätze als Klartext — Platzhalter als „[Feld]“ bzw. mit Wert. Für Tests und die Zwischenablage. */
export function wtKlartext(absaetze) {
  return absaetze.map(a => (a.ueberschrift ? '## ' : '') + a.map(s => (typeof s === 'string' ? s : (s.wert || `[${s.feld}]`))).join('')).join('\n\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bewertungen (einzeln prüfbar)
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtEeBewertung(p) {
  if (!ok(p)) return { pct: NaN, erfuellt: [], naechstes: null };
  return { pct: p, erfuellt: WPG_EE_ZIELE.filter(z => p >= z.pct - 0.05).map(z => z.jahr), naechstes: WPG_EE_ZIELE.find(z => p < z.pct - 0.05) || null };
}

export function wtVollbenutzungKlasse(h) {
  const s = WT_SCHWELLEN.vollbenutzungH;
  return h < s.spitzig ? 'spitzig' : h <= s.gleichmaessig ? 'typisch' : 'gleichmaessig';
}

export function wtJazKlasse(j) {
  const s = WT_SCHWELLEN.jaz;
  return j >= s.sehrGut ? 'sehrGut' : j >= s.gut ? 'gut' : j >= s.maessig ? 'maessig' : 'niedrig';
}

export function wtLeistungsKlasse(verhaeltnis) {
  const s = WT_SCHWELLEN.leistungsreserve;
  return verhaeltnis < s.unterdeckung ? 'unterdeckung' : verhaeltnis < s.knapp ? 'knapp' : verhaeltnis < s.ausreichend ? 'ausreichend'
    : verhaeltnis < s.ueberdimensioniert ? 'komfortabel' : 'ueberdimensioniert';
}

export function wtNetzverlustKlasse(p) {
  const s = WT_SCHWELLEN.netzverlustPct;
  return p < s.niedrig ? 'niedrig' : p < s.ueblich ? 'ueblich' : p < s.erhoeht ? 'erhoeht' : 'hoch';
}

export function wtVorlaufKlasse(c) {
  const s = WT_SCHWELLEN.vorlaufC;
  return c >= s.hoch ? 'hoch' : c >= s.mittel ? 'mittel' : c >= s.nieder ? 'nieder' : 'kalt';
}

/** Bestand, Neubau oder gemischt — aus den Gebäudezahlen; null, wenn keine Gebäudeliste vorliegt. */
export function wtProjektTyp(projekt) {
  const a = projekt?.anzahl || {};
  const ges = num(a.gesamt), bestand = num(a.bestand) || 0, neu = num(a.neubau) || 0;
  if (!(ges > 0)) return null;
  if (bestand <= 0 && neu > 0) return 'neubau';
  if (neu <= 0) return 'bestand';
  return 'gemischt';
}

/**
 * Leistung, mit der ein Erzeuger `anteil` (0..1) der Jahresarbeit des Lastgangs deckt — Kennzahl der
 * Jahresdauerlinie, unabhängig von der Technik. `jdl`: Lastwerte in kW (Reihenfolge egal).
 */
export function wtDeckungsleistung(jdl, anteil) {
  const n = jdl?.length || 0;
  if (!n) return NaN;
  let gesamt = 0, max = 0;
  for (let i = 0; i < n; i++) { const v = jdl[i] || 0; gesamt += v; if (v > max) max = v; }
  if (!(gesamt > 0) || !(anteil > 0) || anteil >= 1) return anteil >= 1 ? max : NaN;
  let lo = 0, hi = max;
  for (let it = 0; it < 40; it++) {
    const p = (lo + hi) / 2;
    let abgedeckt = 0;
    for (let i = 0; i < n; i++) abgedeckt += Math.min(jdl[i] || 0, p);
    if (abgedeckt / gesamt < anteil) lo = p; else hi = p;
  }
  return (lo + hi) / 2;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Schnappschuss normalisieren
 * ═══════════════════════════════════════════════════════════════════════ */
function normErz(liste) {
  const erz = (liste || []).map(e => {
    const k = WT_ERZEUGER[e.key] || {};
    return {
      ...k, ...e, key: e.key, name: e.name || k.name || e.key,
      leistungKw: num(e.leistungKw) || 0, waermeMwh: num(e.waermeMwh) || 0, elMwh: num(e.elMwh) || 0,
    };
  }).filter(e => e.leistungKw > 0 || e.waermeMwh > 0);
  const waermeErz = erz.filter(e => e.art !== 'speicher');
  const gesamtErz = summe(waermeErz, e => e.waermeMwh);
  waermeErz.forEach(e => { e.anteil = gesamtErz > 0 ? (e.waermeMwh / gesamtErz) * 100 : NaN; });
  const nachLeistung = [...waermeErz].sort((a, b) => b.leistungKw - a.leistungKw);
  const nachWaerme = [...waermeErz].sort((a, b) => b.waermeMwh - a.waermeMwh || b.leistungKw - a.leistungKw);
  return {
    erz: waermeErz, speicher: erz.find(e => e.art === 'speicher') || null, instKw: summe(waermeErz, e => e.leistungKw),
    gesamtErz, groesster: nachLeistung[0] || null, grund: nachWaerme[0] || null,
  };
}

/**
 * Erwartete Form (alles optional):
 *   lastgang   { pMaxKw, nutzMwh, gesamtMwh, netzverlustPct, netzverlustMwh, tMinC, jdlKw }   // für das Jahr projekt.lastgangJahr
 *   projekt    { basisJahr, lastgangJahr, anzahl: { gesamt, bestand, neubau, abriss, saniert },
 *                bedarfsverlauf: [{ jahr, bedarfMwh, heizlastKw }], ereignisse: [{ jahr, art: 'neubau'|'abriss'|'sanierung', anzahl, deltaMwh }] }
 *   herkunft   { lastgang: 'import'|'importMonate'|'monate'|'monateGesamt'|'gesamt'|'gebaeude', zeitreihe: { intervallMin, quelle, qualitaet },
 *                stadt, klimajahr, plz, normAtC, gesamtMwh, profil1, profil2, gebaeude: { gesamt, gesetzt, geschaetzt },
 *                netzverlustQuelle: 'waermenetz'|'prozentwert', netzverlustPct }
 *   netz       { laengeM, anzahlAnschluesse, vlC, rlC, bestand, ueberschreitungen, hydraulik }
 *   gebaeude   { anzahl, heizlastSummeKw }
 *   wirtschaft { zinsPct, co2PreisEurT, strompreisCt, gaspreisCt, fernwaermeCt }
 *   varianten  [{ name, aktiv, erzeuger: [{ key, name, leistungKw, waermeMwh, elMwh, speicherM3 }],
 *                 investEur, jahreskostenEur, wgkCt, co2T, eeAnteilPct, netzverlustPct }]
 */
export function wtNormalisiere(d = {}) {
  const lg = d.lastgang || {};
  const nutz = num(lg.nutzMwh);
  const varianten = (d.varianten || []).map(v => ({
    ...v, ...normErz(v.erzeuger),
    investEur: num(v.investEur), jahreskostenEur: num(v.jahreskostenEur), wgkCt: num(v.wgkCt),
    co2T: num(v.co2T), eeAnteilPct: num(v.eeAnteilPct), netzverlustPct: num(v.netzverlustPct),
  }));
  return {
    pMaxKw: num(lg.pMaxKw), nutzMwh: nutz, gesamtMwh: ok(num(lg.gesamtMwh)) ? num(lg.gesamtMwh) : nutz, tMinC: num(lg.tMinC),
    jdlKw: lg.jdlKw || null,
    netzverlustPct: num(lg.netzverlustPct), netzverlustMwh: num(lg.netzverlustMwh),
    projekt: d.projekt || {}, typ: wtProjektTyp(d.projekt), herkunft: d.herkunft || {},
    netz: d.netz || {}, gebaeude: d.gebaeude || {}, wirt: d.wirtschaft || {},
    varianten,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Datenherkunft und bauliche Entwicklung (Grundlage von 3.1 und 3.2.5)
 * ═══════════════════════════════════════════════════════════════════════ */
/** Klimadaten als Nominalphrase; `dativ` für „aus den …“, sonst Akkusativ („die …“). */
const klimaText = (stadt, klimajahr, plz, dativ) => {
  const jahr = String(klimajahr ?? '').trim();
  const bez = /^\d{4}$/.test(jahr) ? `Wetterjahr ${jahr}` : /tmy/i.test(jahr) || !jahr ? 'typisches Wetterjahr (TMY)' : jahr;
  return `${dativ ? 'den' : 'die'} Klimadaten ${stadt ? `des Standorts ${stadt}` : 'des Standorts'} (${bez})`
    + (String(plz ?? '').trim() ? `, Postleitzahl ${String(plz).trim()}` : '');
};

/** Sätze zur Herkunft des Wärmelastgangs: Messung oder Synthese, Klima, Gebäudewerte. */
function herkunftLastgangAbsaetze(n) {
  const h = n.herkunft;
  const art = h.lastgang;
  const normAt = ok(num(h.normAtC)) ? ` mit einer Norm-Außentemperatur von ${nf(num(h.normAtC), 1)} °C` : '';
  const hatKlima = ok(num(h.normAtC)) || !!h.stadt;
  const klimaAkk = hatKlima ? `${klimaText(h.stadt, h.klimajahr, h.plz, false)}${normAt}` : 'ein Standardklima';   // „wurde … zugrunde gelegt“
  const klimaDat = hatKlima ? `${klimaText(h.stadt, h.klimajahr, h.plz, true)}${normAt}` : 'einem Standardklima';  // „ergeben sich aus …“
  const zr = h.zeitreihe || {};
  const abtast = ok(num(zr.intervallMin)) ? `${nf(num(zr.intervallMin))}-Minuten-Werten` : 'Werten';
  const out = [];
  if (!art) {
    return [absatz('Die Herkunft des Wärmelastgangs ist ', F('Datenherkunft des Wärmelastgangs, z. B. Messung oder Synthese'), '.')];
  }
  if (art === 'import') {
    out.push(absatz(`Der Wärmelastgang beruht auf einer hochgeladenen Messreihe aus ${abtast}`, zr.quelle ? ` (Quelle: ${zr.quelle})` : '',
      zr.qualitaet === 'synthetic' ? ', die als synthetisch gekennzeichnet ist' : '',
      '. Die Reihe enthält die Netzverluste bereits. ',
      h.witterung && ok(num(h.witterung.faktor))
        ? `Sie wurde über Gradtagzahlen witterungsbereinigt (Faktor ${nf(num(h.witterung.faktor), 3)}, Messjahr ${h.witterung.messjahr}).`
        : ['Sie spiegelt die Witterung des Messjahres wider; die Klimabereinigung ist ', F('Klimabereinigung erfolgt / nicht erfolgt'), '.']));
  } else if (art === 'importMonate') {
    out.push(absatz(`Der Wärmelastgang beruht auf einer hochgeladenen Reihe aus ${abtast}, die monatsweise auf die vorgegebenen Monatsverbräuche skaliert wurde. Die Netzverluste sind bereits enthalten.`));
  } else if (art === 'monate' || art === 'monateGesamt') {
    out.push(absatz('Der Wärmelastgang wurde synthetisch aus den vorgegebenen Monatsverbräuchen erzeugt'
      + (art === 'monateGesamt' && ok(num(h.gesamtMwh)) ? ` (vorgegebener Jahresverbrauch ${nf(num(h.gesamtMwh))} MWh)` : '')
      + `; ein gemessener Lastgang lag nicht vor. Für den Tagesgang und den Verlauf über das Jahr wurde ${klimaAkk} zugrunde gelegt.`));
  } else if (art === 'gesamt') {
    out.push(absatz(`Der Wärmelastgang wurde rein synthetisch aus einem vorgegebenen Jahresverbrauch${ok(num(h.gesamtMwh)) ? ` von ${nf(num(h.gesamtMwh))} MWh` : ''} erzeugt; ein gemessener Lastgang lag nicht vor. `
      + `Verlauf und Spitzenlast ergeben sich aus ${klimaDat} und den angesetzten Nutzungsprofilen${h.profil1 ? ` (${h.profil1}${h.profil2 ? ` und ${h.profil2}` : ''})` : ''}.`));
  } else if (art === 'gebaeude') {
    out.push(absatz('Der Wärmelastgang wurde rein synthetisch aus den Gebäudedaten (Nutzung, Fläche, Baujahr und spezifischer Wärmebedarf) mit gebäudeweisen Lastprofilen aufgebaut; ein gemessener Lastgang oder Verbrauchsdaten für die Liegenschaft insgesamt lagen nicht vor. '
      + `Die Außentemperaturen und Lastspitzen ergeben sich aus ${klimaDat}.`));
  }
  const g = h.gebaeude || {};
  const ges = num(g.gesamt), gesetzt = num(g.gesetzt), geschaetzt = num(g.geschaetzt);
  if (ges > 0 && ok(gesetzt) && ok(geschaetzt)) {
    out.push(absatz(gesetzt === 0
      ? `Die Wärmebedarfe und Heizlasten aller ${nf(ges)} Gebäude sind Schätzwerte aus Fläche, Baujahr und Nutzung auf Basis üblicher Gebäudetypologien (IWU/TABULA); gesetzte oder gemessene Gebäudewerte liegen nicht vor.`
      : geschaetzt === 0
        ? `Die Wärmebedarfe und Heizlasten aller ${nf(ges)} Gebäude sind vorgegebene Werte (Messung, Abrechnung oder Eingabe).`
        : `Von ${nf(ges)} Gebäuden beruhen ${nf(gesetzt)} auf vorgegebenen Werten (Messung, Abrechnung oder Eingabe), ${nf(geschaetzt)} auf Schätzwerten aus Fläche, Baujahr und Nutzung (IWU/TABULA).`));
  }
  return out;
}

/** Schlusssatz zur Belastbarkeit je nach Herkunft. */
function belastbarkeitAbsatz(n) {
  const art = n.herkunft.lastgang;
  if (art === 'import' || art === 'importMonate') {
    return absatz('Da der Lastgang auf Messwerten beruht, sind Spitzenlast und Verlauf belastbar, soweit das Messjahr in Witterung und Nutzung repräsentativ war.');
  }
  if (art === 'monate' || art === 'monateGesamt') {
    return absatz('Die Spitzenlast ist eine Modellrechnung auf Basis der Monatsverbräuche und des Standardklimas. Zur Absicherung der Auslegung wird empfohlen, einen gemessenen Lastgang (z. B. 15-Minuten-Werte des Wärmezählers) zu beschaffen.');
  }
  if (art === 'gesamt' || art === 'gebaeude') {
    return absatz('Spitzenlast und Verlauf sind eine reine Modellrechnung; Messwerte zur Plausibilisierung liegen nicht vor. Die Auslegung sollte vor der Ausführungsplanung durch einen gemessenen Lastgang oder durch Heizlastberechnungen der Gebäude abgesichert werden.');
  }
  return [];
}

function netzverlustHerkunft(n, mitMwh = true) {
  const h = n.herkunft;
  if (h.netzverlustQuelle === 'waermenetz') return `aus der leitungsgenauen Berechnung des Wärmenetzes${mitMwh && ok(n.netzverlustMwh) ? ` (${nf(n.netzverlustMwh)} MWh/a)` : ''}`;
  if (h.netzverlustQuelle === 'prozentwert') return `pauschal mit ${ok(num(h.netzverlustPct)) ? pct(num(h.netzverlustPct), 1) : 'einem Prozentwert'} angesetzt, da kein Netz berechnet ist`;
  return '';
}

/** Zusammenfassung der baulichen Veränderungen als Sätze. */
function entwicklungAbsaetze(n) {
  const p = n.projekt, a = p.anzahl || {};
  const typ = n.typ;
  const basis = num(p.basisJahr);
  const out = [];
  const verlauf = (p.bedarfsverlauf || []).filter(x => ok(num(x.bedarfMwh))).sort((x, y) => x.jahr - y.jahr);
  const ereignisse = (p.ereignisse || []).filter(e => ok(num(e.jahr)));

  if (!typ) {
    out.push(absatz('Für die Liegenschaft liegt keine Gebäudeliste vor; der Wärmebedarf wurde direkt vorgegeben. Bauliche Veränderungen (Neubau, Abriss, Sanierung) sind daher ', F('bauliche Veränderungen'), '.'));
    return out;
  }
  const teil = [];
  if (typ === 'neubau') {
    out.push(absatz(`Die Liegenschaft besteht ausschließlich aus geplanten Neubauten (${nf(a.neubau)} ${kleinN(a.neubau, 'Gebäude', 'Gebäuden')}). Ein Gebäudebestand und damit ein Ist-Zustand der Wärmeversorgung liegen nicht vor; der Wärmebedarf wird vollständig aus den Planungsdaten abgeleitet.`));
  } else if (typ === 'gemischt') {
    out.push(absatz(`Die Liegenschaft besteht aus ${nf(a.bestand)} ${kleinN(a.bestand, 'Bestandsgebäude', 'Bestandsgebäuden')} und ${nf(a.neubau)} geplanten ${kleinN(a.neubau, 'Neubau', 'Neubauten')}. Der Ist-Zustand umfasst den Bestand; der Soll-Zustand berücksichtigt zusätzlich die baulichen Veränderungen.`));
  } else {
    out.push(absatz(`Die Liegenschaft besteht aus ${nf(a.bestand)} ${kleinN(a.bestand, 'Bestandsgebäude', 'Bestandsgebäuden')}.`));
  }
  const nach = art => ereignisse.filter(e => e.art === art);
  const fass = (art, titel, vorz) => {
    const liste = nach(art);
    if (!liste.length) return;
    const anz = summe(liste, e => num(e.anzahl)), mwh = summe(liste, e => num(e.deltaMwh));
    const j0 = Math.min(...liste.map(e => e.jahr)), j1 = Math.max(...liste.map(e => e.jahr));
    teil.push(`${titel}: ${nf(anz)} Gebäude ${j0 === j1 ? `im Jahr ${j0}` : `zwischen ${j0} und ${j1}`}`
      + (ok(mwh) && mwh !== 0 ? ` (${vorz}${nf(Math.abs(mwh))} MWh/a)` : ''));
  };
  fass('neubau', 'Neubau', '+'); fass('abriss', 'Abriss', '−'); fass('sanierung', 'energetische Sanierung', '−');
  if (typ !== 'neubau' || nach('neubau').length) {
    out.push(teil.length
      ? absatz(`Im Betrachtungszeitraum ${ok(basis) ? `ab ${basis} ` : ''}sind folgende bauliche Veränderungen vorgesehen: ${teil.join('; ')}.`)
      : absatz('Bauliche Veränderungen (Neubau, Abriss, energetische Sanierung) sind im Betrachtungszeitraum nicht vorgesehen; der Soll-Bedarf entspricht dem Ist-Bedarf.'));
  }
  if (verlauf.length >= 2) {
    const v0 = verlauf[0], v1 = verlauf[verlauf.length - 1];
    const d = ((v1.bedarfMwh - v0.bedarfMwh) / (v0.bedarfMwh || 1)) * 100;
    if (v0.bedarfMwh > 0) {
      out.push(absatz(Math.abs(d) < WT_SCHWELLEN.bedarfsaenderungPct
        ? `Der Wärmebedarf der Gebäude bleibt mit rund ${nf(v1.bedarfMwh)} MWh/a nahezu unverändert (${v0.jahr}: ${nf(v0.bedarfMwh)} MWh/a, ${v1.jahr}: ${nf(v1.bedarfMwh)} MWh/a).`
        : `Der Wärmebedarf der Gebäude ${d > 0 ? 'steigt' : 'sinkt'} von ${nf(v0.bedarfMwh)} MWh/a im Jahr ${v0.jahr} auf ${nf(v1.bedarfMwh)} MWh/a im Jahr ${v1.jahr} (${d > 0 ? '+' : '−'}${pct(Math.abs(d), 1)}).`
          + (ok(num(v0.heizlastKw)) && ok(num(v1.heizlastKw)) && v0.heizlastKw > 0
            ? ` Die Summe der Gebäudeheizlasten ${num(v1.heizlastKw) >= num(v0.heizlastKw) ? 'steigt' : 'sinkt'} dabei von ${nf(v0.heizlastKw)} kW auf ${nf(v1.heizlastKw)} kW.` : '')));
    } else if (v1.bedarfMwh > 0) {
      out.push(absatz(`Der Wärmebedarf der Gebäude beträgt nach Fertigstellung aller Neubauten ${nf(v1.bedarfMwh)} MWh/a (${v1.jahr})`
        + (ok(num(v1.heizlastKw)) ? ` bei einer Summe der Gebäudeheizlasten von ${nf(v1.heizlastKw)} kW.` : '.')));
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.1 Ist-Anlagentechnik (früher Ist-Zustand Wärme)
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtIstZustand(d) {
  const n = wtNormalisiere(d);
  const out = [];
  if (n.typ === 'neubau') {
    out.push(absatz('Für die Liegenschaft besteht kein Gebäudebestand. Ein Ist-Zustand der Wärmeversorgung liegt daher nicht vor; das Kapitel entfällt. Der Wärmebedarf der geplanten Neubauten wird im Soll-Zustand (Kapitel 3.2) auf Grundlage der Planungsdaten ermittelt.'));
    const g = n.herkunft.gebaeude || {};
    if (num(g.gesamt) > 0) out.push(absatz('Datengrundlage sind die Gebäudedaten der Planung (Nutzung, Fläche, Baujahr und Wärmebedarf).'));
    return out;
  }
  out.push(...entwicklungAbsaetze(n).slice(0, 1));
  if (ok(n.gesamtMwh) && n.gesamtMwh > 0) {
    out.push(absatz(`Der Wärmebedarf der Liegenschaft beträgt rund ${nf(n.gesamtMwh)} MWh pro Jahr einschließlich Netzverlusten`
      + (ok(n.pMaxKw) ? `, die Spitzenlast ${nf(n.pMaxKw)} kW` : '') + '.'
      + (netzverlustHerkunft(n) ? ` Die Netzverluste sind ${netzverlustHerkunft(n)}.` : '')));
  } else {
    out.push(absatz('Der Wärmebedarf der Liegenschaft beträgt ', F('Wärmebedarf in MWh/a'), ' MWh pro Jahr, die Spitzenlast ', F('Spitzenlast in kW'), ' kW.'));
  }
  out.push(...herkunftLastgangAbsaetze(n));
  out.push(absatz('Die bestehende Wärmeerzeugung der Liegenschaft besteht aus ', F('Bestehende Wärmeerzeuger (Typ, Leistung, Baujahr)'), '.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.2.5 Dimensionierung WEA — Bedarf und Auslegungsleistung (ohne Versorgungssystem)
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtDimensionierungWea(d) {
  const n = wtNormalisiere(d);
  const out = [];
  const jahr = num(n.projekt.lastgangJahr);

  out.push(...entwicklungAbsaetze(n));
  out.push(...herkunftLastgangAbsaetze(n));

  if (ok(n.pMaxKw) && n.pMaxKw > 0) {
    const bedarf = ok(n.gesamtMwh) ? ` Der Jahreswärmebedarf einschließlich Netzverlusten beträgt ${nf(n.gesamtMwh)} MWh, die maßgebende Spitzenlast ${nf(n.pMaxKw)} kW`
      + (ok(n.tMinC) ? ` (tiefste Außentemperatur im Lastgang ${nf(n.tMinC, 1)} °C)` : '') + '.'
      : ` Die maßgebende Spitzenlast beträgt ${nf(n.pMaxKw)} kW.`;
    const p = [ok(jahr) ? `Der Soll-Lastgang ist für das Jahr ${jahr} berechnet.` : 'Der Soll-Lastgang berücksichtigt den Stand der baulichen Entwicklung im Betrachtungsjahr.', bedarf];
    if (ok(n.gesamtMwh) && n.gesamtMwh > 0) {
      const h = (n.gesamtMwh * 1000) / n.pMaxKw;
      p.push(` Daraus ergeben sich rechnerische Vollbenutzungsstunden von ${nf(h)} h/a. `);
      p.push({
        spitzig: 'Der Lastgang ist stark von der Spitzenlast geprägt: Die Spitzenlast wird nur an wenigen Stunden des Jahres benötigt. Die Auslegung auf die volle Spitzenlast bindet daher Leistung, die nur selten abgerufen wird.',
        typisch: 'Dieser Wert ist typisch für eine von der Gebäudebeheizung geprägte Wärmeversorgung.',
        gleichmaessig: 'Der Lastgang verläuft vergleichsweise gleichmäßig und weist einen hohen Grundlastanteil auf, wie er bei hohem Warmwasser- oder Prozesswärmebedarf typisch ist.',
      }[wtVollbenutzungKlasse(h)]);
    }
    out.push(absatz(...p));

    // Kennzahlen der Dauerlinie, systemunabhängig
    if (n.jdlKw && n.jdlKw.length) {
      const teile = WT_DECKUNGSANTEILE.map(a => ({ a, p: wtDeckungsleistung(n.jdlKw, a) })).filter(x => ok(x.p));
      if (teile.length) {
        out.push(absatz(`Aus der Jahresdauerlinie folgt, dass ${liste(teile.map(x => `${nf(x.p)} kW (${pct(x.p / n.pMaxKw * 100)} der Spitzenlast) für ${pct(x.a * 100)}`))} der Jahreswärme ausreichen würden. `
          + 'Ein Großteil der Wärme wird demnach mit einem Bruchteil der Spitzenlast bereitgestellt.'));
      }
      const klein = Array.prototype.filter.call(n.jdlKw, v => v < n.pMaxKw * 0.02).length;
      if (klein / n.jdlKw.length > WT_SCHWELLEN.leerlaufAnteil) {
        out.push(absatz(`In ${nf(klein)} Stunden des Jahres (${pct(klein / n.jdlKw.length * 100)}) liegt die Last unter 2 % der Spitzenlast; in dieser Zeit ist der Wärmebedarf praktisch entfallen (z. B. Sommerabschaltung).`));
      }
    }
  } else {
    out.push(absatz('Die maßgebende Spitzenlast beträgt ', F('Spitzenlast in kW'), ' kW bei einem Jahreswärmebedarf von ', F('Jahreswärmebedarf in MWh'), ' MWh.'));
  }

  const bel = belastbarkeitAbsatz(n);
  if (bel.length) out.push(bel);
  out.push(absatz('Die Auslegungsleistung der Wärmeerzeugungsanlage (WEA) richtet sich nach dieser Spitzenlast zuzüglich einer Reserve von ', F('Reserve in %'), ' %. Die Wahl des Versorgungssystems erfolgt erst im Variantenvergleich (Kapitel 7).'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.3.1 Wärmeversorgungsnetz (WVN), Soll-Zustand
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtWvn(d) {
  const n = wtNormalisiere(d);
  const z = n.netz;
  const laenge = num(z.laengeM), anschl = num(z.anzahlAnschluesse), vl = num(z.vlC), rl = num(z.rlC);
  const hyd = { ...WT_HYDRAULIK_STANDARD, ...(z.hydraulik || {}) };
  const bestandsnetz = z.bestand === true && n.typ !== 'neubau';
  const out = [];

  // Netzaufbau
  const aufbau = [];
  if (z.bestand === undefined || z.bestand === null) aufbau.push('Das Wärmeversorgungsnetz (WVN) verbindet die Heizzentrale mit den angeschlossenen Gebäuden.');
  else if (bestandsnetz) aufbau.push('Das Wärmeversorgungsnetz (WVN) wird auf Basis des vorhandenen Bestandsnetzes weitergeführt. Leitungsverläufe und Nennweiten des Bestands bleiben unverändert; neue Gebäude werden über zusätzliche Hausanschlüsse angebunden.');
  else aufbau.push(n.typ === 'neubau'
    ? 'Für die geplanten Neubauten besteht kein Wärmenetz. Der Trassenentwurf des Wärmeversorgungsnetzes (WVN) ist neu aufgebaut; Trassenführung und Nennweiten sind anhand der Gebäudelasten ausgelegt.'
    : 'Das Wärmeversorgungsnetz (WVN) wird als Neubaunetz geplant. Trassenführung und Nennweiten werden anhand der Gebäudelasten ausgelegt.');
  if (ok(laenge) && laenge > 0 && ok(anschl) && anschl > 0) {
    aufbau.push(` Die Trassenlänge beträgt ${nf(laenge)} m bei ${nf(anschl)} ${kleinN(anschl, 'Gebäudeanschluss', 'Gebäudeanschlüssen')}; das entspricht ${nf(laenge / anschl)} m Trasse je Anschluss.`);
  } else if (ok(laenge) && laenge > 0) aufbau.push(` Die Trassenlänge beträgt ${nf(laenge)} m.`);
  else aufbau.push(' Die Trassenlänge beträgt ', F('Trassenlänge in m'), ' m.');
  out.push(absatz(...aufbau));

  // Bauliche Veränderungen im Netz
  const erei = (n.projekt.ereignisse || []).filter(e => ok(num(e.jahr)));
  const neu = summe(erei.filter(e => e.art === 'neubau'), e => num(e.anzahl)), ab = summe(erei.filter(e => e.art === 'abriss'), e => num(e.anzahl));
  if (neu > 0 || ab > 0) {
    out.push(absatz('Durch die baulichen Veränderungen ', [neu > 0 ? `kommen ${nf(neu)} ${kleinN(neu, 'Gebäudeanschluss', 'Gebäudeanschlüsse')} hinzu` : '', neu > 0 && ab > 0 ? ' und ' : '', ab > 0 ? `${nf(ab)} ${kleinN(ab, 'Anschluss entfällt', 'Anschlüsse entfallen')}` : ''].join(''),
      '; die Anschlüsse sind erst ab dem jeweiligen Baujahr bzw. bis zum Abrissjahr in der hydraulischen Berechnung enthalten.'));
  }

  // Wärmebelegung
  if (ok(laenge) && laenge > 0 && ok(n.nutzMwh) && n.nutzMwh > 0) {
    const bel = (n.nutzMwh * 1000) / laenge;
    const s = WT_SCHWELLEN.waermebelegungKwhM;
    out.push(absatz(`Bei einer Nutzwärmeabgabe von ${nf(n.nutzMwh)} MWh/a ergibt sich eine Wärmebelegung von ${nf(bel)} kWh je Trassenmeter und Jahr. `,
      bel < s.niedrig
        ? 'Dieser Wert ist niedrig. Die Wärmeverluste und Netzkosten verteilen sich auf wenig Wärmeabsatz; die Wirtschaftlichkeit des Netzes ist besonders kritisch zu prüfen, und eine Verdichtung oder Verkürzung der Trasse ist zu erwägen.'
        : bel < s.hoch
          ? 'Dieser Wert liegt im mittleren Bereich; die Netzkosten sind tragbar, ein Potenzial zur Verdichtung durch weitere Anschlüsse besteht.'
          : 'Dieser Wert ist hoch und spricht für ein wirtschaftlich günstiges Netz mit geringen spezifischen Verlusten.'));
  }

  // Netzverluste mit Herkunft
  if (ok(n.netzverlustPct) && n.netzverlustPct >= 0) {
    const kl = wtNetzverlustKlasse(n.netzverlustPct);
    const wm = ok(n.netzverlustMwh) && ok(laenge) && laenge > 0 ? (n.netzverlustMwh * 1e6) / 8760 / laenge : NaN;
    const herk = netzverlustHerkunft(n, false);
    const p = [`Die Netzverluste betragen ${pct(n.netzverlustPct, 1)} der eingespeisten Wärme`
      + (ok(n.netzverlustMwh) ? ` (${nf(n.netzverlustMwh)} MWh/a)` : '')
      + (ok(wm) ? `, bezogen auf die Trasse ${nf(wm)} W/m` : '') + (herk ? `; sie sind ${herk}` : '') + '. '];
    p.push({
      niedrig: 'Das ist ein niedriger Wert; das Netz arbeitet verlustarm.',
      ueblich: 'Das ist ein für Wärmenetze übliches Niveau.',
      erhoeht: 'Das ist ein erhöhter Wert. Maßnahmen zur Verlustminderung, etwa eine Absenkung der Netztemperaturen, verbesserte Dämmung oder eine kürzere Trassenführung, sind zu prüfen.',
      hoch: 'Das ist ein hoher Wert, der die Wirtschaftlichkeit und die Klimabilanz deutlich belastet. Eine Absenkung der Netztemperaturen, die Verdichtung der Anschlüsse und eine Verbesserung der Dämmung sind dringend zu prüfen.',
    }[kl]);
    out.push(absatz(...p));
  }

  // Temperaturniveau (systemneutral)
  if (ok(vl) && ok(rl)) {
    const sp = vl - rl;
    const kl = wtVorlaufKlasse(vl);
    const p = [`Das Netz ist für eine Vorlauftemperatur von ${nf(vl)} °C und eine Rücklauftemperatur von ${nf(rl)} °C ausgelegt (Spreizung ${nf(sp)} K). `];
    p.push({
      hoch: 'Das Temperaturniveau ist hoch. Es begrenzt die Nutzung von Wärmequellen auf niedrigem Temperaturniveau; eine Absenkung ist im Variantenvergleich zu berücksichtigen.',
      mittel: 'Das Temperaturniveau ist mittel; eine weitere Absenkung bleibt im Variantenvergleich zu prüfen.',
      nieder: 'Es handelt sich um ein Niedertemperaturnetz, das die Nutzung von Wärmequellen auf niedrigem Temperaturniveau erleichtert.',
      kalt: 'Es handelt sich um ein Netz mit sehr niedriger Temperatur („kalte Nahwärme“). Die Gebäude benötigen dezentral eine Nachheizung für die Trinkwassererwärmung.',
    }[kl]);
    p.push(' ');
    p.push(sp >= WT_SCHWELLEN.spreizungK.gut
      ? 'Die große Spreizung hält Volumenströme und Pumpenenergie niedrig.'
      : sp >= WT_SCHWELLEN.spreizungK.gering
        ? 'Die Spreizung liegt im üblichen Bereich.'
        : 'Die geringe Spreizung führt zu großen Volumenströmen, höheren Druckverlusten und erhöhter Pumpenenergie; der hydraulische Abgleich der Anlagen ist zu prüfen.');
    out.push(absatz(...p));
  } else {
    out.push(absatz('Das Netz ist für eine Vorlauftemperatur von ', F('Vorlauftemperatur in °C'), ' °C und eine Rücklauftemperatur von ', F('Rücklauftemperatur in °C'), ' °C ausgelegt.'));
  }

  // Hydraulik
  const ue = num(z.ueberschreitungen);
  const h = [`Die Nennweiten werden so gewählt, dass in der Verteilleitung ein Druckverlust von ${nf(hyd.dpNetzPaM)} Pa/m und im Hausanschluss von ${nf(hyd.dpAnschlussPaM)} Pa/m `
    + `nicht überschritten wird; die Fließgeschwindigkeit wird auf ${nf(hyd.vZielMs, 1)} m/s ausgelegt (zulässiger Bereich ${nf(hyd.vMinMs, 1)} bis ${nf(hyd.vMaxMs, 1)} m/s). `
    + `Für die Hausstation wird eine Druckreserve von ${nf(hyd.hausstationBar, 1)} bar angesetzt. `];
  if (ok(ue)) {
    if (ue <= 0) h.push('Die hydraulische Prüfung zeigt keine Überschreitung der Grenzwerte.');
    else if (bestandsnetz) h.push(`Die hydraulische Prüfung zeigt bei ${nf(ue)} ${kleinN(ue, 'Strang', 'Strängen')} eine Überschreitung der Grenzwerte. Da die Nennweiten des Bestands nicht verändert werden, sind diese Stränge zu markieren und im Einzelfall zu prüfen, ob eine Anpassung erforderlich ist.`);
    else h.push(`Die hydraulische Prüfung zeigte bei ${nf(ue)} ${kleinN(ue, 'Strang', 'Strängen')} eine Überschreitung der Grenzwerte, die durch Anpassung der Nennweite behoben werden muss.`);
  }
  out.push(absatz(...h));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3.3.2 Wärmetechnische Hausstation (WH), Soll-Zustand
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtHausstation(d) {
  const n = wtNormalisiere(d);
  const g = n.gebaeude, z = n.netz;
  const anzahl = num(g.anzahl), summeKw = num(g.heizlastSummeKw), vl = num(z.vlC), rl = num(z.rlC);
  const hyd = { ...WT_HYDRAULIK_STANDARD, ...(z.hydraulik || {}) };
  const out = [];

  if (ok(anzahl) && anzahl > 0) {
    const mittel = ok(summeKw) && summeKw > 0 ? summeKw / anzahl : NaN;
    const gh = n.herkunft.gebaeude || {};
    out.push(absatz(`Die Wärmeübergabe an die Gebäude erfolgt über ${nf(anzahl)} ${kleinN(anzahl, 'Hausstation', 'Hausstationen')}`
      + (ok(summeKw) && summeKw > 0 ? ` mit einer summierten Anschlussleistung von ${nf(summeKw)} kW (im Mittel ${nf(mittel)} kW je Anschluss)` : '')
      + (num(gh.geschaetzt) > 0 && num(gh.gesetzt) === 0 ? '; die Anschlussleistungen sind Schätzwerte aus Fläche, Baujahr und Nutzung' : '')
      + '. Die Anschlussart (direkt oder indirekt) ist ', F('Anschlussart der Hausstationen'), '.'));
  } else {
    out.push(absatz('Die Wärmeübergabe an die Gebäude erfolgt über Hausstationen. Die Zahl der anzuschließenden Gebäude beträgt ', F('Anzahl Hausstationen'), '.'));
  }

  out.push(absatz(`Für die Hausstationen wird eine Druckreserve von ${nf(hyd.hausstationBar, 1)} bar angesetzt, damit der Differenzdruck auch am hydraulisch ungünstigsten Anschluss ausreicht.`));

  if (ok(vl)) {
    const kl = wtVorlaufKlasse(vl);
    if (kl === 'hoch') {
      out.push(absatz(`Bei der Vorlauftemperatur von ${nf(vl)} °C sind die Hausstationen und die Heizflächen in den Gebäuden für ein hohes Temperaturniveau ausgelegt. Bei einer späteren Absenkung der Netztemperatur ist zu prüfen, ob die vorhandenen Heizflächen die Heizlast noch decken.`));
    } else if (kl === 'mittel') {
      out.push(absatz(`Bei der Vorlauftemperatur von ${nf(vl)} °C ist in unsanierten Gebäuden mit hohen Heizflächentemperaturen eine Prüfung der Heizflächen sinnvoll; mit sinkender Temperatur steigt der Anpassungsbedarf.`));
    } else {
      out.push(absatz(`Bei der niedrigen Vorlauftemperatur von ${nf(vl)} °C ist je Gebäude zu prüfen, ob die Heizflächen die Heizlast decken und ob Maßnahmen an der Gebäudehülle oder den Heizflächen erforderlich sind. `
        + 'Für die Trinkwassererwärmung sind die Anforderungen an den Legionellenschutz (DVGW W 551) zu beachten; üblich sind Frischwasserstationen im Durchflussprinzip oder eine dezentrale Nachheizung.'));
    }
    if (vl < 60) {
      out.push(absatz('Da die Vorlauftemperatur unter 60 °C liegt, kann die Trinkwassererwärmung nicht direkt aus dem Netz erfolgen. Hierfür ist ein Konzept zur Nachheizung bzw. zur Einhaltung der Hygieneanforderungen erforderlich: ', F('Konzept Trinkwassererwärmung'), '.'));
    }
    if (n.typ === 'neubau') {
      out.push(absatz('Da es sich um Neubauten handelt, können Heizflächen und Hausstationen von Beginn an auf das gewählte Temperaturniveau ausgelegt werden; Anpassungen im Bestand entfallen.'));
    }
  }

  if (ok(rl)) {
    const s = WT_SCHWELLEN.ruecklaufC;
    out.push(absatz(rl <= s.gut
      ? `Die Rücklauftemperatur von ${nf(rl)} °C ist günstig; sie sollte durch eine Rücklauftemperaturbegrenzung in den Hausstationen gesichert werden.`
      : rl <= s.moderat
        ? `Die Rücklauftemperatur von ${nf(rl)} °C ist moderat. Durch hydraulischen Abgleich und Rücklauftemperaturbegrenzung in den Hausstationen lässt sie sich weiter senken, was die Effizienz der Wärmeerzeugung und die Netzverluste verbessert.`
        : `Die Rücklauftemperatur von ${nf(rl)} °C ist hoch. Dies deutet auf einen mangelhaften hydraulischen Abgleich oder fehlende Rücklauftemperaturbegrenzung in den Hausstationen hin und mindert die Effizienz der Wärmeerzeugung deutlich; eine Optimierung der Hausstationen ist vorzusehen.`));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Varianten: Konzept, Leistungsbilanz, EE-Anteil, Technik (ab 2.4)
 * ═══════════════════════════════════════════════════════════════════════ */
const nameV = v => v.name || 'Variante';

function eeAbsatz(v) {
  const e = wtEeBewertung(v.eeAnteilPct);
  const co2 = ok(v.co2T) && v.co2T > 0 ? ` Die jährlichen Treibhausgasemissionen der Wärmeerzeugung betragen rund ${nf(v.co2T)} t CO₂e.` : '';
  if (!ok(e.pct)) return absatz('Der Anteil erneuerbarer Energien an der Wärmeerzeugung beträgt ', F('Anteil erneuerbare Energien in %'), ' %.', co2);
  const ziele = 'mindestens 30 % ab 2030, 80 % ab 2040 und vollständige Treibhausgasneutralität bis 2045';
  if (e.pct <= 0.05) {
    return absatz(`Die Wärmeerzeugung erfolgt vollständig aus nicht erneuerbaren Energieträgern. Die Anforderungen des Wärmeplanungsgesetzes (WPG) an Wärmenetze (${ziele}) werden damit nicht erfüllt.`, co2);
  }
  const anteil = `Der Anteil erneuerbarer Energien an der Wärmeerzeugung beträgt ${pct(e.pct, 1)}.`;
  if (e.erfuellt.length === 3) return absatz(`${anteil} Die Anforderungen des Wärmeplanungsgesetzes (WPG) an Wärmenetze (${ziele}) werden damit eingehalten.`, co2);
  if (e.erfuellt.length === 2) {
    return absatz(`${anteil} Damit sind die Vorgaben des Wärmeplanungsgesetzes (WPG) für 2030 und 2040 erfüllt. Für das Ziel der vollständigen Treibhausgasneutralität bis 2045 verbleibt ein Anteil von ${pct(100 - e.pct, 1)}, der in einem weiteren Schritt auf erneuerbare Energieträger umgestellt werden muss.`, co2);
  }
  if (e.erfuellt.length === 1) {
    return absatz(`${anteil} Die Vorgabe des Wärmeplanungsgesetzes (WPG) von 30 % ab 2030 wird eingehalten. Die Vorgabe von 80 % ab 2040 wird um ${nf(80 - e.pct, 1)} Prozentpunkte verfehlt; hierfür ist ein weiterer Ausbau erneuerbarer Erzeugung erforderlich.`, co2);
  }
  return absatz(`${anteil} Damit wird die Mindestvorgabe des Wärmeplanungsgesetzes (WPG) von 30 % ab 2030 um ${nf(30 - e.pct, 1)} Prozentpunkte unterschritten. Zur Einhaltung ist der Anteil erneuerbarer Erzeugung deutlich zu erhöhen.`, co2);
}

function konzeptAbsatz(v) {
  if (!v.erz.length) return absatz(`Für die Variante „${nameV(v)}“ sind noch keine Wärmeerzeuger ausgelegt.`);
  if (v.erz.length === 1) {
    const e = v.erz[0];
    return absatz(`Die Variante „${nameV(v)}“ versorgt die Liegenschaft monovalent über ${mitArtikel(e)} mit einer thermischen Leistung von ${nf(e.leistungKw)} kW.`
      + (e.art === 'wp' ? ' Eine monovalente Wärmepumpenlösung stellt hohe Anforderungen an die Auslegung bei niedrigen Außentemperaturen und an die Redundanz.' : '')
      + (e.fossil ? ' Die Versorgung beruht vollständig auf einem fossilen Energieträger.' : ''));
  }
  const g = v.grund;
  const rest = v.erz.filter(e => e !== g);
  const fossilSpitze = rest.filter(e => e.fossil && ok(e.anteil) && e.anteil < WT_SCHWELLEN.kesselAnteil.reserve);
  return absatz(`Die Variante „${nameV(v)}“ versorgt die Liegenschaft ${v.erz.length === 2 ? 'bivalent' : 'multivalent'} aus ${v.erz.length} Erzeugern. `
    + (ok(g.anteil) && g.waermeMwh > 0
      ? `Den größten Anteil an der Jahreswärme deckt ${mitArtikel(g)} mit ${pct(g.anteil, 1)} (${nf(g.leistungKw)} kW). `
      : `Der leistungsstärkste Erzeuger ist ${mitArtikel(g)} (${nf(g.leistungKw)} kW). `)
    + `${kleinN(rest.length, 'Weiterer Erzeuger ist', 'Weitere Erzeuger sind')} ${liste(rest.map(e => e.name))}.`
    + (fossilSpitze.length
      ? ` ${liste(fossilSpitze.map(e => e.name))} ${kleinN(fossilSpitze.length, 'dient', 'dienen')} überwiegend der Spitzenlast und Redundanz und ${kleinN(fossilSpitze.length, 'liefert', 'liefern')} nur `
        + `${pct(summe(fossilSpitze, e => e.anteil), 1)} der Jahreswärme.` : ''));
}

function leistungsAbsaetze(v, pMax) {
  const out = [];
  if (!ok(pMax) || pMax <= 0 || v.instKw <= 0) return out;
  const q = v.instKw / pMax;
  const kl = wtLeistungsKlasse(q);
  const basis = `Die installierte thermische Leistung beträgt insgesamt ${nf(v.instKw)} kW, die Spitzenlast ${nf(pMax)} kW.`;
  if (kl === 'unterdeckung') {
    out.push(absatz(`${basis} Die Spitzenlast kann damit nicht vollständig gedeckt werden; es verbleibt eine Unterdeckung von ${nf(pMax - v.instKw)} kW (${pct((1 - q) * 100, 1)}). Zur Sicherstellung der Versorgung bei Auslegungstemperatur ist die Leistung zu erhöhen, etwa durch einen zusätzlichen Spitzenlasterzeuger oder eine mobile Heizzentrale.`));
  } else if (kl === 'knapp') {
    out.push(absatz(`${basis} Die Spitzenlast wird damit nur knapp unterschritten. Eine nennenswerte Reserve besteht nicht; Betriebsstörungen oder Lastzuwächse im Netz können zu einer Unterversorgung führen.`));
  } else if (kl === 'ausreichend') {
    out.push(absatz(`${basis} Die Spitzenlast wird damit abgedeckt, die Leistungsreserve beträgt ${pct((q - 1) * 100, 1)}.`));
  } else if (kl === 'komfortabel') {
    out.push(absatz(`${basis} Die Spitzenlast wird mit einer komfortablen Reserve von ${pct((q - 1) * 100, 1)} abgedeckt; zusätzliche Anschlüsse oder ein erhöhter Bedarf lassen sich damit aufnehmen.`));
  } else {
    out.push(absatz(`${basis} Die Anlage ist mit dem ${nf(q, 1)}-Fachen der Spitzenlast deutlich überdimensioniert. Die Erzeuger arbeiten überwiegend im Teillastbereich; zu prüfen ist, ob eine kleinere Auslegung oder eine Aufteilung auf mehrere Module wirtschaftlicher ist.`));
  }
  if (v.erz.length === 1) {
    out.push(absatz(`Mit nur einem Erzeuger besteht keine Redundanz. Bei einem Ausfall von ${mitArtikel(v.groesster)} ist die Wärmeversorgung nicht gesichert; eine Reserveerzeugung (z. B. mobile Heizzentrale oder Anschlussmöglichkeit dafür) ist vorzusehen.`));
  } else if (v.erz.length > 1) {
    const rest = v.instKw - v.groesster.leistungKw;
    const teil = rest / pMax;
    if (teil >= 1) {
      out.push(absatz(`Auch bei Ausfall des größten Erzeugers (${v.groesster.name}, ${nf(v.groesster.leistungKw)} kW) bleibt die Spitzenlast gedeckt (Restleistung ${nf(rest)} kW). Die Variante erfüllt damit das N-1-Kriterium.`));
    } else if (teil >= WT_SCHWELLEN.n1Teil) {
      out.push(absatz(`Bei Ausfall des größten Erzeugers (${v.groesster.name}, ${nf(v.groesster.leistungKw)} kW) stehen noch ${nf(rest)} kW zur Verfügung; das entspricht ${pct(teil * 100)} der Spitzenlast. Das N-1-Kriterium wird nicht vollständig erfüllt. In der Auslegungsspitze wäre ein Lastabwurf oder eine Absenkung der Netztemperatur nötig; eine Reserveerzeugung ist zu prüfen.`));
    } else {
      out.push(absatz(`Bei Ausfall des größten Erzeugers (${v.groesster.name}, ${nf(v.groesster.leistungKw)} kW) stehen nur noch ${nf(rest)} kW (${pct(teil * 100)} der Spitzenlast) zur Verfügung. Das N-1-Kriterium wird deutlich verfehlt; für die Versorgungssicherheit ist eine Reserveerzeugung vorzusehen.`));
    }
  }
  return out;
}

/** Zahlen zur Technik der Variante (nur mit Dispatch-Ergebnis) plus einmalige Hinweise je Technik (`gesehen`). */
function technikAbsaetze(v, gesehen) {
  const out = [];
  const von = art => v.erz.filter(e => e.art === art);
  const einmal = (schluessel, text) => { if (!gesehen.has(schluessel)) { gesehen.add(schluessel); return text; } return ''; };

  const wps = von('wp');
  if (wps.length) {
    const w = summe(wps, e => e.waermeMwh), el = summe(wps, e => e.elMwh), kw = summe(wps, e => e.leistungKw);
    const plural = wps.length > 1;
    const p = [`${plural ? 'Die Wärmepumpen' : mitArtikel(wps[0], true)} (${nf(kw)} kW thermisch)`];
    if (w > 0 && el > 0) {
      const jaz = w / el;
      p.push(` ${kleinN(wps.length, 'erzeugt', 'erzeugen')} rund ${nf(w)} MWh Wärme pro Jahr und ${kleinN(wps.length, 'benötigt', 'benötigen')} dafür ${nf(el)} MWh Strom. Die rechnerische Jahresarbeitszahl (JAZ) beträgt ${nf(jaz, 2)}. `);
      p.push({
        sehrGut: 'Dieser Wert ist sehr gut und spricht für ein günstiges Verhältnis von Wärmequelle und Netztemperatur.',
        gut: 'Dieser Wert ist gut und liegt im üblichen Bereich effizient betriebener Großwärmepumpen.',
        maessig: 'Dieser Wert ist mäßig. Eine Absenkung der Vorlauftemperatur würde die Effizienz und damit die Betriebskosten spürbar verbessern.',
        niedrig: 'Dieser Wert ist niedrig. Die Wirtschaftlichkeit und die Fördervoraussetzungen sind kritisch zu prüfen; Ansatzpunkte sind eine Absenkung der Netztemperaturen und die Wahl einer günstigeren Wärmequelle.',
      }[wtJazKlasse(jaz)]);
    } else if (w > 0) {
      p.push(` ${kleinN(wps.length, 'erzeugt', 'erzeugen')} rund ${nf(w)} MWh Wärme pro Jahr. Die Jahresarbeitszahl wird nach Abschluss der Dispatch-Berechnung ergänzt: JAZ `, F('Jahresarbeitszahl'), '.');
    } else p.push(' ist Teil der Variante.');
    const hinweis = einmal('wp', ` Der zusätzliche Strombedarf ${kleinN(wps.length, 'der Wärmepumpe', 'der Wärmepumpen')} geht als Zusatzbedarf aus dem Wärmekonzept in die Bedarfsprognose Strom (Kapitel 5.3.2) ein und ist bei der Auslegung des Netzanschlusses zu berücksichtigen.`)
      + (wps.some(e => e.unterart === 'luft') ? einmal('luft', ' Bei Luft-Wasser-Wärmepumpen sind Schallemissionen (TA Lärm) sowie Platzbedarf und Aufstellung der Außengeräte im weiteren Planungsverlauf nachzuweisen.') : '')
      + (wps.some(e => e.unterart === 'erde') ? einmal('erde', ' Für die Erdwärmenutzung sind Flächenbedarf des Sondenfelds und die wasserrechtlichen Genehmigungsvoraussetzungen zu klären.') : '');
    out.push(absatz(...p, hinweis));
  }

  for (const b of von('bhkw')) {
    const h = b.leistungKw > 0 ? b.waermeMwh * 1000 / b.leistungKw : NaN;
    const p = [`Das BHKW (${nf(b.leistungKw)} kW thermisch)`];
    if (b.waermeMwh > 0) {
      p.push(` liefert rund ${nf(b.waermeMwh)} MWh Wärme${b.elMwh > 0 ? ` und erzeugt dabei rund ${nf(b.elMwh)} MWh Strom` : ''} pro Jahr. `);
      if (ok(h)) {
        p.push(`Daraus ergeben sich ${nf(h)} Vollbenutzungsstunden. `);
        p.push(h < WT_SCHWELLEN.bhkwH.gering
          ? 'Die Auslastung ist gering; die Wirtschaftlichkeit des KWK-Betriebs (Zuschläge, Eigenstromnutzung) hängt von einer ausreichenden Betriebsdauer ab und ist zu prüfen.'
          : h > WT_SCHWELLEN.bhkwH.hoch
            ? 'Die Auslastung ist hoch; das BHKW läuft im Wesentlichen als Grundlasterzeuger.'
            : 'Die Auslastung liegt im wirtschaftlich üblichen Bereich eines wärmegeführten BHKW.');
      }
    } else p.push(' ist Teil der Variante.');
    out.push(absatz(...p));
  }

  for (const k of von('kessel')) {
    const a = k.anteil;
    const p = [`${mitArtikel(k, true)} (${nf(k.leistungKw)} kW)`];
    if (ok(a) && k.waermeMwh > 0) {
      p.push(` deckt ${pct(a, 1)} der Jahreswärme (${nf(k.waermeMwh)} MWh). `);
      p.push(a < WT_SCHWELLEN.kesselAnteil.reserve
        ? 'Der Kessel dient damit im Wesentlichen als Spitzenlast- und Redundanzerzeuger und läuft nur an wenigen Stunden im Jahr.'
        : a < WT_SCHWELLEN.kesselAnteil.spitze
          ? 'Der Kessel übernimmt damit nennenswerte Anteile der Mittel- und Spitzenlast.'
          : 'Der Kessel ist damit ein Hauptwärmeerzeuger; der fossile Anteil bestimmt maßgeblich die Emissionen und den Handlungsbedarf zur Dekarbonisierung.');
    } else p.push(' ist als Reserve vorgesehen und hat im Dispatch keinen nennenswerten Wärmeanteil. ');
    out.push(absatz(...p));
  }

  for (const b of von('biomasse')) {
    out.push(absatz(`${mitArtikel(b, true)} (${nf(b.leistungKw)} kW)${b.waermeMwh > 0 ? ` erzeugt ${nf(b.waermeMwh)} MWh Wärme (${pct(b.anteil, 1)})` : ''}.`,
      einmal('biomasse', ' Zu berücksichtigen sind Brennstofflogistik und Lagerraum, die Brennstoffverfügbarkeit sowie die Anforderungen an Emissionen (BImSchV).')));
  }

  for (const s of von('strom')) {
    const hoch = ok(s.anteil) && s.anteil > 20;
    out.push(absatz(`${mitArtikel(s, true)} (${nf(s.leistungKw)} kW) wandelt Strom mit nahezu 100 % Wirkungsgrad in Wärme um${s.waermeMwh > 0 ? ` und liefert ${nf(s.waermeMwh)} MWh/a (${pct(s.anteil, 1)})` : ''}. `
      + (hoch
        ? 'Bei diesem Anteil sind die Betriebskosten stark vom Strompreis abhängig; der Einsatz sollte auf Spitzenlast und Überschussstrom begrenzt werden.'
        : 'Der Einsatz beschränkt sich auf Spitzenlast und Überschussstrom; die Betriebskosten sind vom Strompreis abhängig.')));
  }

  for (const s of von('solar')) {
    out.push(absatz(`Die Solarthermieanlage liefert ${nf(s.waermeMwh)} MWh Wärme pro Jahr (${pct(s.anteil, 1)}).`,
      einmal('solar', ' Der Flächenbedarf und die Flächenkonkurrenz zu Photovoltaik sind im weiteren Verlauf zu prüfen.')));
  }

  for (const f of von('fernwaerme')) {
    out.push(absatz(`Der Fernwärmeanschluss (${nf(f.leistungKw)} kW) deckt ${ok(f.anteil) ? pct(f.anteil, 1) : ''} der Jahreswärme. `
      + 'Der Anteil erneuerbarer Energien richtet sich nach dem Erzeugungsmix des Fernwärmeversorgers; ', F('Primärenergiefaktor / EE-Anteil Fernwärme'), '.'));
  }

  if (v.speicher) {
    const vol = num(v.speicher.speicherM3);
    out.push(absatz(ok(vol)
      ? `Der Wärmespeicher mit einem Volumen von ${nf(vol)} m³ entkoppelt Erzeugung und Bedarf und erhöht die Betriebsdauer der Grundlasterzeuger.`
      : ['Der Wärmespeicher mit einem Volumen von ', F('Speichervolumen in m³'), ' m³ entkoppelt Erzeugung und Bedarf und erhöht die Betriebsdauer der Grundlasterzeuger.']));
  }
  return out;
}

/** Vollständige Beschreibung einer Variante. */
function variantenBeschreibung(v, pMax, gesehen) {
  return [konzeptAbsatz(v), ...leistungsAbsaetze(v, pMax), ...(v.erz.length ? [eeAbsatz(v)] : []), ...technikAbsaetze(v, gesehen)];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 Variantenvergleich
 * ═══════════════════════════════════════════════════════════════════════ */
function extrem(varianten, feld, richtung) {
  const gueltig = varianten.filter(v => ok(v[feld]));
  if (!gueltig.length) return null;
  return gueltig.reduce((b, v) => (richtung === 'min' ? (v[feld] < b[feld] ? v : b) : (v[feld] > b[feld] ? v : b)));
}
const spanne = (varianten, feld) => {
  const w = varianten.map(v => v[feld]).filter(ok);
  return w.length >= 2 ? { min: Math.min(...w), max: Math.max(...w) } : null;
};
const wpgText = p => {
  const e = wtEeBewertung(p);
  return e.erfuellt.length === 3 ? 'alle Stufen des WPG (2030, 2040, 2045)' : e.erfuellt.length ? `die WPG-Stufe${e.erfuellt.length > 1 ? 'n' : ''} ${e.erfuellt.join(' und ')}` : 'keine WPG-Stufe';
};

export function wtVariantenvergleich(d) {
  const n = wtNormalisiere(d);
  const V = n.varianten;
  const w = n.wirt;
  const out = [];

  if (!V.length) {
    return [absatz('Für den Variantenvergleich liegen noch keine berechneten Varianten vor. Betrachtete Varianten: ', F('Varianten der Wärmeversorgung'), '.')];
  }

  // Einleitung
  const bedarfsSatz = ok(n.gesamtMwh) ? ` Grundlage ist der Soll-Bedarf aus Kapitel 3.2 (${nf(n.gesamtMwh)} MWh/a${ok(n.pMaxKw) ? `, Spitzenlast ${nf(n.pMaxKw)} kW` : ''}).` : ' Grundlage ist der Soll-Bedarf aus Kapitel 3.2.';
  if (V.length === 1) {
    out.push(absatz(`Betrachtet wird eine Variante der Wärmeversorgung, „${nameV(V[0])}“.${bedarfsSatz} Weitere Varianten sind `, F('Weitere Varianten oder Begründung für die Betrachtung einer Variante'), '.'));
  } else {
    out.push(absatz(`Verglichen werden ${V.length} Varianten der Wärmeversorgung: ${liste(V.map(nameV))}.${bedarfsSatz} Alle Varianten werden für denselben Wärmebedarf und dasselbe Netz gerechnet.`));
  }
  const rahmen = [];
  if (ok(num(w.co2PreisEurT))) rahmen.push(`ein CO₂-Preis von ${nf(num(w.co2PreisEurT))} €/t`);
  if (ok(num(w.strompreisCt))) rahmen.push(`ein Strompreis von ${nf(num(w.strompreisCt), 1)} ct/kWh`);
  if (ok(num(w.gaspreisCt))) rahmen.push(`ein Gaspreis von ${nf(num(w.gaspreisCt), 1)} ct/kWh`);
  if (rahmen.length) out.push(absatz(`Den Berechnungen liegen ${liste(rahmen)} zugrunde.`));

  // Beschreibung je Variante
  const gesehen = new Set();
  for (const v of V) out.push(...variantenBeschreibung(v, n.pMaxKw, gesehen));

  if (V.length === 1) {
    const v = V[0];
    const teile = [];
    if (ok(v.wgkCt)) teile.push(`Wärmegestehungskosten von ${nf(v.wgkCt, 1)} ct/kWh`);
    if (ok(v.investEur)) teile.push(`eine Investition von rund ${nf(v.investEur / 1000)} Tsd. €`);
    if (teile.length) out.push(absatz(`Die Variante erreicht ${liste(teile)}.`));
    return out;
  }

  // Ökologie
  const co2 = V.filter(v => ok(v.co2T));
  if (co2.length >= 2) {
    const best = extrem(co2, 'co2T', 'min'), schlecht = extrem(co2, 'co2T', 'max'), sp = spanne(co2, 'co2T');
    const rel = schlecht.co2T > 0 ? ((schlecht.co2T - best.co2T) / schlecht.co2T) * 100 : 0;
    out.push(absatz(rel < WT_SCHWELLEN.gleichwertigPct.co2
      ? `Die Emissionen der Varianten liegen mit ${nf(sp.min)} bis ${nf(sp.max)} t CO₂e pro Jahr nahezu gleichauf; die Varianten unterscheiden sich ökologisch kaum.`
      : `Die jährlichen Emissionen liegen zwischen ${nf(sp.min)} t CO₂e (${nameV(best)}) und ${nf(sp.max)} t CO₂e (${nameV(schlecht)}). ${nameV(best)} verursacht damit ${pct(rel)} weniger Emissionen als ${nameV(schlecht)}.`));
  }
  const ee = V.filter(v => ok(v.eeAnteilPct));
  if (ee.length >= 2) {
    out.push(absatz('Die Anforderungen des Wärmeplanungsgesetzes (WPG) an den Anteil erneuerbarer Energien erfüllen die Varianten wie folgt: ',
      ee.map(v => `${nameV(v)} (${pct(v.eeAnteilPct, 1)}): ${wpgText(v.eeAnteilPct)}`).join('; '), '.'));
  }

  // Wirtschaft
  const wgk = V.filter(v => ok(v.wgkCt));
  const bestWgk = extrem(wgk, 'wgkCt', 'min'), schlechtWgk = extrem(wgk, 'wgkCt', 'max');
  if (wgk.length >= 2) {
    const rel = schlechtWgk.wgkCt > 0 ? ((schlechtWgk.wgkCt - bestWgk.wgkCt) / schlechtWgk.wgkCt) * 100 : 0;
    out.push(absatz(rel < WT_SCHWELLEN.gleichwertigPct.wgk
      ? `Die Wärmegestehungskosten liegen mit ${nf(bestWgk.wgkCt, 1)} bis ${nf(schlechtWgk.wgkCt, 1)} ct/kWh nahezu gleichauf; die Varianten sind wirtschaftlich gleichwertig, die Entscheidung kann anhand anderer Kriterien erfolgen.`
      : `Die Wärmegestehungskosten reichen von ${nf(bestWgk.wgkCt, 1)} ct/kWh (${nameV(bestWgk)}) bis ${nf(schlechtWgk.wgkCt, 1)} ct/kWh (${nameV(schlechtWgk)}). ${nameV(bestWgk)} ist damit ${pct(rel)} günstiger als ${nameV(schlechtWgk)}.`
        + (wgk.length >= 3 ? ` Die Rangfolge nach Kosten lautet: ${[...wgk].sort((a, b) => a.wgkCt - b.wgkCt).map(v => `${nameV(v)} (${nf(v.wgkCt, 1)} ct/kWh)`).join(', ')}.` : '')));
  } else if (wgk.length === 1) {
    out.push(absatz(`Für ${nameV(wgk[0])} liegen Wärmegestehungskosten von ${nf(wgk[0].wgkCt, 1)} ct/kWh vor; für ${kleinN(V.length - 1, 'die weitere Variante', 'die übrigen Varianten')} fehlen die Wirtschaftlichkeitswerte (`, F('fehlende Wirtschaftlichkeitswerte'), ').'));
  }
  const inv = V.filter(v => ok(v.investEur));
  const bestInv = extrem(inv, 'investEur', 'min');
  if (inv.length >= 2 && bestWgk && bestInv && bestInv !== bestWgk) {
    out.push(absatz(`Die geringste Investition erfordert ${nameV(bestInv)} (${nf(bestInv.investEur / 1000)} Tsd. €), die niedrigsten Gestehungskosten erreicht jedoch ${nameV(bestWgk)} (Investition ${nf(bestWgk.investEur / 1000)} Tsd. €). Höhere Investitionen werden hier durch geringere Betriebskosten über die Nutzungsdauer ausgeglichen.`));
  }

  // Zielkonflikt oder Gleichlauf
  const bestCo2 = extrem(co2, 'co2T', 'min');
  if (bestWgk && bestCo2 && wgk.length >= 2 && co2.length >= 2) {
    if (bestWgk === bestCo2) {
      out.push(absatz(`${nameV(bestWgk)} ist sowohl wirtschaftlich als auch ökologisch die günstigste Variante; ein Zielkonflikt zwischen Kosten und Klimaschutz besteht nicht.`));
    } else if (ok(bestWgk.co2T) && ok(bestCo2.wgkCt)) {
      const mehr = bestCo2.wgkCt - bestWgk.wgkCt;
      let satz = `Zwischen Kosten und Klimaschutz besteht ein Zielkonflikt: Die wirtschaftlichste Variante (${nameV(bestWgk)}) ist nicht die emissionsärmste (${nameV(bestCo2)}). `
        + `Die emissionsärmste Variante verursacht Mehrkosten von ${nf(mehr, 1)} ct/kWh (${pct(bestWgk.wgkCt > 0 ? (mehr / bestWgk.wgkCt) * 100 : 0)}) bei ${nf(bestWgk.co2T - bestCo2.co2T)} t CO₂e geringeren Emissionen pro Jahr.`;
      if (ok(bestWgk.jahreskostenEur) && ok(bestCo2.jahreskostenEur) && bestWgk.co2T - bestCo2.co2T > 0) {
        const vermeid = (bestCo2.jahreskostenEur - bestWgk.jahreskostenEur) / (bestWgk.co2T - bestCo2.co2T);
        if (vermeid > 0) satz += ` Das entspricht CO₂-Vermeidungskosten von rund ${nf(vermeid)} €/t CO₂e.`;
      }
      out.push(absatz(satz));
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7.2 Wirtschaftlichkeit und Investitionskosten (variantenbezogen)
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtWirtschaftlichkeit(d) {
  const n = wtNormalisiere(d);
  const w = n.wirt;
  const V = n.varianten;
  const out = [];
  const zins = num(w.zinsPct), co2p = num(w.co2PreisEurT);

  out.push(absatz('Die Wirtschaftlichkeit wird als Wärmegestehungskostenrechnung nach VDI 2067 auf Basis der Annuitätenmethode ermittelt. Berücksichtigt werden kapitalgebundene Kosten, '
    + 'verbrauchsgebundene Kosten (Energie), betriebsgebundene Kosten (Wartung, Instandhaltung, Bedienung) und CO₂-Kosten. Der Betrachtungszeitraum beträgt ', F('Betrachtungszeitraum in Jahren'), ' Jahre'
    + (ok(zins) ? `, der Kalkulationszinssatz ${nf(zins, 1)} %` : ''), ok(zins) ? '.' : [', der Kalkulationszinssatz ', F('Kalkulationszinssatz in %'), ' %.']));

  const preise = [];
  if (ok(num(w.strompreisCt))) preise.push(`Strom ${nf(num(w.strompreisCt), 1)} ct/kWh`);
  if (ok(num(w.gaspreisCt))) preise.push(`Erdgas ${nf(num(w.gaspreisCt), 1)} ct/kWh`);
  if (ok(co2p)) preise.push(`CO₂ ${nf(co2p)} €/t`);
  if (preise.length) out.push(absatz(`Es wurden folgende Preise angesetzt: ${preise.join(', ')}. Preissteigerungen über den Betrachtungszeitraum sind `, F('Annahme zu Preissteigerungen'), '.'));

  const mitWerten = V.filter(v => (ok(v.investEur) && v.investEur > 0) || ok(v.wgkCt));
  if (!mitWerten.length) {
    out.push(absatz('Die Gesamtinvestition und die Wärmegestehungskosten der Varianten betragen ', F('Investition und Wärmegestehungskosten je Variante'), '.'));
  } else {
    for (const v of mitWerten) {
      const teile = [];
      if (ok(v.investEur) && v.investEur > 0) teile.push(`Gesamtinvestition rund ${nf(v.investEur / 1000)} Tsd. €${v.instKw > 0 ? ` (${nf(v.investEur / v.instKw)} € je kW installierter Leistung)` : ''}`);
      if (ok(v.jahreskostenEur)) teile.push(`jährliche Gesamtkosten ${nf(v.jahreskostenEur / 1000)} Tsd. €`);
      if (ok(v.wgkCt)) teile.push(`Wärmegestehungskosten ${nf(v.wgkCt, 1)} ct/kWh`);
      out.push(absatz(`Variante „${nameV(v)}“: ${teile.join(', ')}.`));
    }
    const wgk = mitWerten.filter(v => ok(v.wgkCt));
    const fw = num(w.fernwaermeCt);
    const best = extrem(wgk, 'wgkCt', 'min');
    if (wgk.length >= 2) {
      const s = extrem(wgk, 'wgkCt', 'max');
      const invs = spanne(mitWerten, 'investEur');
      out.push(absatz(`Im Variantenvergleich liegen die Wärmegestehungskosten zwischen ${nf(best.wgkCt, 1)} und ${nf(s.wgkCt, 1)} ct/kWh`
        + (invs ? ` bei Investitionen zwischen ${nf(invs.min / 1000)} und ${nf(invs.max / 1000)} Tsd. €` : '')
        + `. Die wirtschaftlichste Variante ist ${nameV(best)}.`));
    }
    if (best && ok(fw) && fw > 0) {
      const d2 = ((best.wgkCt - fw) / fw) * 100;
      const bez = wgk.length > 1 ? `Die günstigste Variante (${nameV(best)})` : 'Die Variante';
      out.push(absatz(Math.abs(d2) < 3
        ? `${bez} liegt mit ${nf(best.wgkCt, 1)} ct/kWh auf dem Niveau des angesetzten Fernwärmepreises von ${nf(fw, 1)} ct/kWh.`
        : d2 < 0
          ? `${bez} liegt mit ${nf(best.wgkCt, 1)} ct/kWh ${pct(-d2)} unter dem angesetzten Fernwärmepreis von ${nf(fw, 1)} ct/kWh und ist gegenüber einem Fernwärmebezug wirtschaftlich vorteilhaft.`
          : `${bez} liegt mit ${nf(best.wgkCt, 1)} ct/kWh ${pct(d2)} über dem angesetzten Fernwärmepreis von ${nf(fw, 1)} ct/kWh; gegenüber einem Fernwärmebezug ist sie wirtschaftlich nachteilig und nur durch Förderung, Klimaschutzvorgaben oder Versorgungssicherheit zu begründen.`));
    }
  }

  // Kostentreiber nach Technologie der verglichenen Varianten
  const alle = V.flatMap(v => v.erz);
  const treiber = [];
  if (alle.some(e => e.art === 'wp' || e.art === 'strom')) treiber.push('Strompreis');
  if (alle.some(e => (e.art === 'kessel' && e.key !== 'heizoel') || e.art === 'bhkw')) treiber.push('Gaspreis');
  if (alle.some(e => e.key === 'heizoel')) treiber.push('Heizölpreis');
  if (alle.some(e => e.art === 'biomasse')) treiber.push('Brennstoffpreis für Biomasse');
  if (alle.some(e => e.fossil)) treiber.push('CO₂-Preis');
  if (treiber.length) {
    out.push(absatz(`Die Betriebskosten hängen je nach Variante maßgeblich von ${liste(treiber.map(t => `dem ${t}`))} ab. Änderungen dieser Größen wirken sich unmittelbar auf die Wärmegestehungskosten aus; eine Sensitivitätsbetrachtung ist im weiteren Planungsverlauf sinnvoll.`));
  }

  out.push(absatz('Fördermittel (', F('Förderprogramm, z. B. BEW'), ') sind in den dargestellten Kosten ', F('berücksichtigt / nicht berücksichtigt'), '.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7.5 Empfehlung und 9.1 Fazit
 * ═══════════════════════════════════════════════════════════════════════ */
/** Folgeschritte; was nur ein Teil der Varianten enthält, steht bedingt („sofern die gewählte Variante …“). */
function folgeschritte(n) {
  const V = n.varianten.filter(v => v.erz.length);
  const hat = fn => V.filter(v => v.erz.some(fn)).length;
  const schritte = [];
  const vl = num(n.netz.vlC);
  const add = (anz, text) => { if (anz > 0) schritte.push(anz === V.length ? text : `(sofern die gewählte Variante dies enthält) ${text}`); };
  add(hat(e => e.art === 'wp'), 'der Netzanschlussantrag für den zusätzlichen Strombedarf der Wärmepumpen (Kapitel 5.4.1)');
  add(hat(e => e.unterart === 'luft'), 'ein schalltechnisches Gutachten für die Luft-Wasser-Wärmepumpen (TA Lärm)');
  add(hat(e => e.unterart === 'erde'), 'die Klärung der wasserrechtlichen Genehmigung und des Flächenbedarfs der Erdwärmesonden');
  if (ok(vl) && vl >= WT_SCHWELLEN.vorlaufC.mittel) schritte.push('die Prüfung einer Absenkung der Netztemperaturen einschließlich der Heizflächen in den Gebäuden');
  add(hat(e => e.fossil), 'ein Fahrplan zum Ersatz oder zur Umstellung der fossilen Erzeuger');
  add(V.filter(v => v.speicher).length, 'die Dimensionierung des Wärmespeichers in der Entwurfsplanung');
  schritte.push('die Beantragung von Fördermitteln');
  return schritte;
}

export function wtEmpfehlung(d) {
  const n = wtNormalisiere(d);
  const V = n.varianten;
  const out = [];

  if (V.length >= 2) {
    const bw = extrem(V, 'wgkCt', 'min'), bc = extrem(V, 'co2T', 'min'), be = extrem(V, 'eeAnteilPct', 'max');
    const teile = [];
    if (bw) teile.push(`wirtschaftlich am günstigsten ist ${nameV(bw)} (${nf(bw.wgkCt, 1)} ct/kWh)`);
    if (bc) teile.push(`die geringsten Emissionen hat ${nameV(bc)} (${nf(bc.co2T)} t CO₂e/a)`);
    if (be && ok(be.eeAnteilPct)) teile.push(`den höchsten Anteil erneuerbarer Energien erreicht ${nameV(be)} (${pct(be.eeAnteilPct, 1)})`);
    out.push(absatz('Im Variantenvergleich zeigt sich: ', liste(teile), '.'));
    if (bw && bc && bw === bc) {
      out.push(absatz(`Da ${nameV(bw)} wirtschaftlich und ökologisch vorn liegt, wird diese Variante zur Umsetzung empfohlen.`));
    } else {
      out.push(absatz('Empfohlen wird die Umsetzung der Variante ', F('Empfohlene Variante'), '. Die Empfehlung begründet sich durch ', F('Begründung der Empfehlung, z. B. Abwägung Wirtschaftlichkeit, Klimaschutz, Versorgungssicherheit'), '.'));
    }
  } else if (V.length === 1) {
    const v = V[0];
    const e = wtEeBewertung(v.eeAnteilPct);
    out.push(absatz(`Es wurde nur eine Variante betrachtet, „${nameV(v)}“. Empfohlen wird ihre Umsetzung`
      + (e.erfuellt.length ? `, da sie ${wpgText(v.eeAnteilPct)} erfüllt` : ok(v.eeAnteilPct) ? ', unter der Voraussetzung, dass der Anteil erneuerbarer Energien durch weitere Maßnahmen gesteigert wird (die WPG-Mindestvorgabe von 30 % wird derzeit nicht erreicht)' : '')
      + '. Die Variante ist durch ', F('Begründung der Empfehlung'), ' begründet.'));
  } else {
    out.push(absatz('Empfohlen wird die Umsetzung der Variante ', F('Empfohlene Variante'), '.'));
  }

  out.push(absatz('Für die Umsetzung sind als nächste Schritte vorzusehen: ', liste(folgeschritte(n)), '. Als Förderprogramm ist ', F('Förderprogramm, z. B. BEW'), ' vorgesehen.'));
  return out;
}

export function wtFazit(d) {
  const n = wtNormalisiere(d);
  const V = n.varianten;
  const out = [];
  const typSatz = { neubau: ' Die Liegenschaft besteht ausschließlich aus geplanten Neubauten.', gemischt: ' Die Liegenschaft besteht aus Bestandsgebäuden und geplanten Neubauten.', bestand: '' }[n.typ] || '';
  const bedarf = ok(n.gesamtMwh) ? `Der Wärmebedarf der Liegenschaft beträgt im Soll-Zustand rund ${nf(n.gesamtMwh)} MWh pro Jahr bei einer Spitzenlast von ${nf(n.pMaxKw)} kW.${typSatz}` : '';
  const herk = {
    import: 'gemessenen Lastgang', importMonate: 'gemessenen, auf Monatsverbräuche skalierten Lastgang',
    monate: 'synthetischen, auf Monatsverbräuche gestützten Lastgang', monateGesamt: 'synthetischen, auf Monatsverbräuche gestützten Lastgang',
    gesamt: 'synthetischen, auf den Jahresverbrauch gestützten Lastgang', gebaeude: 'aus den Gebäudedaten synthetisierten Lastgang',
  }[n.herkunft.lastgang];
  out.push(absatz(bedarf, herk ? ` Er beruht auf einem ${herk}.` : '', bedarf ? '' : ['Der Wärmebedarf der Liegenschaft ist ', F('Zusammenfassung des Wärmebedarfs'), '.']));

  if (V.length) {
    const bw = extrem(V, 'wgkCt', 'min'), bc = extrem(V, 'co2T', 'min');
    const teile = [];
    if (V.length > 1) teile.push(`Im Variantenvergleich wurden ${V.length} Varianten betrachtet.`);
    else teile.push(`Betrachtet wurde die Variante „${nameV(V[0])}“.`);
    if (V.length > 1 && bw) teile.push(` Wirtschaftlich am günstigsten ist ${nameV(bw)} mit ${nf(bw.wgkCt, 1)} ct/kWh.`);
    if (V.length > 1 && bc) teile.push(` Die geringsten Emissionen verursacht ${nameV(bc)} mit ${nf(bc.co2T)} t CO₂e pro Jahr.`);
    if (V.length === 1) {
      const v = V[0];
      const erg = [];
      if (ok(v.eeAnteilPct)) erg.push(`einen Anteil erneuerbarer Energien von ${pct(v.eeAnteilPct, 1)} (${wpgText(v.eeAnteilPct)})`);
      if (ok(v.co2T)) erg.push(`Emissionen von ${nf(v.co2T)} t CO₂e pro Jahr`);
      if (ok(v.wgkCt)) erg.push(`Wärmegestehungskosten von ${nf(v.wgkCt, 1)} ct/kWh`);
      if (ok(v.investEur)) erg.push(`eine Investition von rund ${nf(v.investEur / 1000)} Tsd. €`);
      if (erg.length) teile.push(` Sie erreicht ${liste(erg)}.`);
    }
    out.push(absatz(...teile));
    out.push(absatz('Empfohlen wird die Variante ', F('Empfohlene Variante'), '.'));
  } else {
    out.push(absatz('Die Wärmeversorgung wird in Kapitel 7 über einen Variantenvergleich festgelegt: ', F('Zusammenfassung des Variantenvergleichs'), '.'));
  }

  const offen = [];
  if (ok(n.netzverlustPct) && wtNetzverlustKlasse(n.netzverlustPct) !== 'niedrig' && wtNetzverlustKlasse(n.netzverlustPct) !== 'ueblich') offen.push(`die Netzverluste von ${pct(n.netzverlustPct, 1)} sind zu senken`);
  if (['gesamt', 'gebaeude', 'monate', 'monateGesamt'].includes(n.herkunft.lastgang)) offen.push('die Auslegung ist durch einen gemessenen Lastgang abzusichern');
  if (V.some(v => ok(v.eeAnteilPct) && v.eeAnteilPct < 100)) offen.push('bei Varianten mit fossilen Anteilen ist ein Fahrplan zur Umstellung auf erneuerbare Energien bis 2045 erforderlich');
  if (offen.length) out.push(absatz(`Handlungsbedarf besteht in folgenden Punkten: ${liste(offen)}.`));
  return out;
}
