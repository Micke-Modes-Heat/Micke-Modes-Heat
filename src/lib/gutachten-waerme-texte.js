// ── lib/gutachten-waerme-texte.js — Ergebnisgesteuerte Textbausteine für den Wärmeteil des Gutachtens ──
// DOM- und importfrei, damit jede Fallunterscheidung in Vitest direkt prüfbar ist und die Datei ein Blatt im
// Importgraph bleibt. Die Funktionen bekommen einen Schnappschuss der Projektdaten (siehe wtNormalisiere) und
// liefern Absätze: jeder Absatz ist eine Liste aus Textstücken (string) und Platzhaltern ({ feld, wert }).
// Ein Platzhalter mit leerem `wert` erscheint im Gutachten gelb als „[Feldname]“, mit Wert grün — dieselbe
// Mechanik wie bei den Strom-Bausteinen in 17-gutachten-grafik.js.
//
// Grundsätze:
//   • Keine erfundenen Werte. Was im Projekt fehlt, wird Platzhalter oder der Satz entfällt.
//   • Wertungen („niedrig“, „typisch“, „erhöht“) hängen an den benannten Schwellen unten, nicht an Bauchgefühl.
//   • Entscheidungen, die der Gutachter trifft (empfohlene Variante, Förderprogramm), bleiben Platzhalter.
//
// Kapitel (Standardgliederung, lib/gutachten-dokument.js):
//   2.2.1 Dimensionierung WEA · 2.2.2 WVN · 2.2.3 WH · 2.4 Variantenvergleich · 2.5 Wirtschaftlichkeit ·
//   2.7 Empfehlung · 6.1 Fazit Wärmeversorgung

/* ══════════════════════════════════════════════════════════════════════════
 * Schwellen und Kataloge
 * ═══════════════════════════════════════════════════════════════════════ */

/** Mindestanteile erneuerbarer Energien und unvermeidbarer Abwärme in Wärmenetzen nach WPG. */
export const WPG_EE_ZIELE = [{ jahr: 2030, pct: 30 }, { jahr: 2040, pct: 80 }, { jahr: 2045, pct: 100 }];

/** Auslegungsregeln der Netzhydraulik im Tool (Pa/m je Leitung, m/s). */
export const WT_HYDRAULIK_STANDARD = { dpNetzPaM: 150, dpAnschlussPaM: 250, vZielMs: 1.0, vMinMs: 0.3, vMaxMs: 2.0, hausstationBar: 0.5 };

export const WT_SCHWELLEN = {
  vollbenutzungH: { spitzig: 1800, gleichmaessig: 3000 },   // Wärmenetze mit Heizlast und Warmwasser liegen typisch dazwischen
  leistungsreserve: { unterdeckung: 0.95, knapp: 1.0, ausreichend: 1.2, ueberdimensioniert: 1.5 },
  n1Teil: 0.7,                                  // Anteil der Spitzenlast, den die Restanlage nach Ausfall des größten Erzeugers noch hält
  jaz: { sehrGut: 4.0, gut: 3.2, maessig: 2.5 },
  bhkwH: { gering: 3000, hoch: 6000 },
  kesselAnteil: { reserve: 10, spitze: 50 },    // % der Jahreswärme
  netzverlustPct: { niedrig: 10, ueblich: 20, erhoeht: 30 },
  netzverlustWM: { niedrig: 20, ueblich: 40 },  // W je Trassenmeter
  waermebelegungKwhM: { niedrig: 500, hoch: 1500 },
  vorlaufC: { hoch: 90, mittel: 70, nieder: 50 },
  spreizungK: { gering: 20, gut: 30 },
  ruecklaufC: { gut: 40, moderat: 55 },
  gleichwertigPct: { wgk: 3, co2: 5 },          // Spannweite darunter gilt als „nahezu gleichwertig“
};

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
  for (const t of teile.flat()) {
    if (t === '' || t == null || t === false) continue;
    if (typeof t === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/** Absätze als Klartext — Platzhalter als „[Feld]“ bzw. mit Wert. Für Tests und die Zwischenablage. */
export function wtKlartext(absaetze) {
  return absaetze.map(a => a.map(s => (typeof s === 'string' ? s : (s.wert || `[${s.feld}]`))).join('')).join('\n\n');
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

/* ══════════════════════════════════════════════════════════════════════════
 * Schnappschuss normalisieren
 * ═══════════════════════════════════════════════════════════════════════ */
/**
 * Erwartete Form (alles optional):
 *   lastgang   { pMaxKw, nutzMwh, gesamtMwh, netzverlustPct, netzverlustMwh, tMinC }
 *   erzeuger   [{ key, name, leistungKw, waermeMwh, elMwh, speicherM3 }]   // key aus WT_ERZEUGER
 *   eeAnteilPct, co2T                                                      // des aktiven Konzepts
 *   netz       { laengeM, anzahlAnschluesse, vlC, rlC, bestand, ueberschreitungen, hydraulik }
 *   gebaeude   { anzahl, heizlastSummeKw }
 *   wirtschaft { investEur, jahreskostenEur, wgkCt, zinsPct, co2PreisEurT, strompreisCt, gaspreisCt, fernwaermeCt }
 *   varianten  [{ name, aktiv, erzeuger, investEur, jahreskostenEur, wgkCt, co2T, eeAnteilPct, netzverlustPct }]
 */
export function wtNormalisiere(d = {}) {
  const lg = d.lastgang || {};
  const erz = (d.erzeuger || []).map(e => {
    const k = WT_ERZEUGER[e.key] || {};
    return {
      ...k, ...e, key: e.key, name: e.name || k.name || e.key,
      leistungKw: num(e.leistungKw) || 0, waermeMwh: num(e.waermeMwh) || 0, elMwh: num(e.elMwh) || 0,
    };
  }).filter(e => e.leistungKw > 0 || e.waermeMwh > 0);
  const waermeErz = erz.filter(e => e.art !== 'speicher');
  const speicher = erz.find(e => e.art === 'speicher') || null;
  const gesamtErz = summe(waermeErz, e => e.waermeMwh);
  waermeErz.forEach(e => { e.anteil = gesamtErz > 0 ? (e.waermeMwh / gesamtErz) * 100 : NaN; });
  const nutz = num(lg.nutzMwh);
  const ges = ok(num(lg.gesamtMwh)) ? num(lg.gesamtMwh) : nutz;
  const pMax = num(lg.pMaxKw);
  let ee = num(d.eeAnteilPct);
  if (!ok(ee) && gesamtErz > 0) ee = (summe(waermeErz.filter(e => e.ee), e => e.waermeMwh) / gesamtErz) * 100;
  const inst = summe(waermeErz, e => e.leistungKw);
  const nachLeistung = [...waermeErz].sort((a, b) => b.leistungKw - a.leistungKw);
  const nachWaerme = [...waermeErz].sort((a, b) => b.waermeMwh - a.waermeMwh || b.leistungKw - a.leistungKw);
  return {
    pMaxKw: pMax, nutzMwh: nutz, gesamtMwh: ges, tMinC: num(lg.tMinC),
    netzverlustPct: num(lg.netzverlustPct), netzverlustMwh: num(lg.netzverlustMwh),
    erz: waermeErz, speicher, instKw: inst, groesster: nachLeistung[0] || null, grund: nachWaerme[0] || null,
    eePct: ee, co2T: num(d.co2T),
    netz: d.netz || {}, gebaeude: d.gebaeude || {}, wirt: d.wirtschaft || {},
    varianten: (d.varianten || []).map(v => ({
      ...v, investEur: num(v.investEur), jahreskostenEur: num(v.jahreskostenEur), wgkCt: num(v.wgkCt),
      co2T: num(v.co2T), eeAnteilPct: num(v.eeAnteilPct), netzverlustPct: num(v.netzverlustPct),
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2.2.1 Dimensionierung der Wärmeerzeugungsanlage (WEA)
 * ═══════════════════════════════════════════════════════════════════════ */
function eeAbsatz(n) {
  const e = wtEeBewertung(n.eePct);
  const co2 = ok(n.co2T) && n.co2T > 0
    ? ` Die jährlichen Treibhausgasemissionen der Wärmeerzeugung betragen rund ${nf(n.co2T)} t CO₂e.` : '';
  if (!ok(e.pct)) {
    return absatz('Der Anteil erneuerbarer Energien an der Wärmeerzeugung beträgt ', F('Anteil erneuerbare Energien in %'), ' %.', co2);
  }
  const ziele = 'mindestens 30 % ab 2030, 80 % ab 2040 und vollständige Treibhausgasneutralität bis 2045';
  if (e.pct <= 0.05) {
    return absatz('Die Wärmeerzeugung erfolgt vollständig aus nicht erneuerbaren Energieträgern. Die Anforderungen des Wärmeplanungsgesetzes (WPG) '
      + `an Wärmenetze (${ziele}) werden damit nicht erfüllt.`, co2);
  }
  const anteil = `Der Anteil erneuerbarer Energien an der Wärmeerzeugung beträgt ${pct(e.pct, 1)}.`;
  if (e.erfuellt.length === 3) {
    return absatz(`${anteil} Die Anforderungen des Wärmeplanungsgesetzes (WPG) an Wärmenetze (${ziele}) werden damit eingehalten.`, co2);
  }
  if (e.erfuellt.length === 2) {
    return absatz(`${anteil} Damit sind die Vorgaben des Wärmeplanungsgesetzes (WPG) für 2030 und 2040 erfüllt. Für das Ziel der vollständigen `
      + `Treibhausgasneutralität bis 2045 verbleibt ein Anteil von ${pct(100 - e.pct, 1)}, der in einem weiteren Schritt auf erneuerbare `
      + 'Energieträger umgestellt werden muss.', co2);
  }
  if (e.erfuellt.length === 1) {
    return absatz(`${anteil} Die Vorgabe des Wärmeplanungsgesetzes (WPG) von 30 % ab 2030 wird eingehalten. Die Vorgabe von 80 % ab 2040 `
      + `wird um ${nf(80 - e.pct, 1)} Prozentpunkte verfehlt; hierfür ist ein weiterer Ausbau erneuerbarer Erzeugung erforderlich.`, co2);
  }
  return absatz(`${anteil} Damit wird die Mindestvorgabe des Wärmeplanungsgesetzes (WPG) von 30 % ab 2030 um ${nf(30 - e.pct, 1)} `
    + 'Prozentpunkte unterschritten. Zur Einhaltung ist der Anteil erneuerbarer Erzeugung deutlich zu erhöhen.', co2);
}

function leistungsAbsaetze(n) {
  const out = [];
  if (!ok(n.pMaxKw) || n.pMaxKw <= 0 || n.instKw <= 0) return out;
  const v = n.instKw / n.pMaxKw;
  const kl = wtLeistungsKlasse(v);
  const basis = `Die installierte thermische Leistung der Wärmeerzeuger beträgt insgesamt ${nf(n.instKw)} kW, die Spitzenlast ${nf(n.pMaxKw)} kW.`;
  if (kl === 'unterdeckung') {
    out.push(absatz(`${basis} Die Spitzenlast kann damit nicht vollständig gedeckt werden; es verbleibt eine Unterdeckung von ${nf(n.pMaxKw - n.instKw)} kW `
      + `(${pct((1 - v) * 100, 1)}). Zur Sicherstellung der Versorgung bei Auslegungstemperatur ist die Leistung zu erhöhen, etwa durch einen `
      + 'zusätzlichen Spitzenlasterzeuger oder eine mobile Heizzentrale.'));
  } else if (kl === 'knapp') {
    out.push(absatz(`${basis} Die Spitzenlast wird damit nur knapp unterschritten. Eine nennenswerte Reserve besteht nicht; Betriebsstörungen oder `
      + 'Lastzuwächse im Netz können zu einer Unterversorgung führen.'));
  } else if (kl === 'ausreichend') {
    out.push(absatz(`${basis} Die Spitzenlast wird damit abgedeckt, die Leistungsreserve beträgt ${pct((v - 1) * 100, 1)}.`));
  } else if (kl === 'komfortabel') {
    out.push(absatz(`${basis} Die Spitzenlast wird mit einer komfortablen Reserve von ${pct((v - 1) * 100, 1)} abgedeckt; zusätzliche Anschlüsse `
      + 'oder ein erhöhter Bedarf nach Sanierung der Wärmeverteilung lassen sich damit aufnehmen.'));
  } else {
    out.push(absatz(`${basis} Die Anlage ist mit dem ${nf(v, 1)}-Fachen der Spitzenlast deutlich überdimensioniert. Die Erzeuger arbeiten überwiegend `
      + 'im Teillastbereich; zu prüfen ist, ob eine kleinere Auslegung oder eine Aufteilung auf mehrere Module wirtschaftlicher ist.'));
  }
  // Redundanz nach Ausfall des größten Erzeugers
  if (n.erz.length === 1) {
    out.push(absatz(`Mit nur einem Erzeuger besteht keine Redundanz. Bei einem Ausfall von ${n.groesster.name} ist die Wärmeversorgung nicht gesichert; `
      + 'eine Reserveerzeugung (z. B. mobile Heizzentrale oder Anschlussmöglichkeit dafür) ist vorzusehen.'));
  } else if (n.erz.length > 1) {
    const rest = n.instKw - n.groesster.leistungKw;
    const teil = rest / n.pMaxKw;
    if (teil >= 1) {
      out.push(absatz(`Auch bei Ausfall des größten Erzeugers (${n.groesster.name}, ${nf(n.groesster.leistungKw)} kW) bleibt die Spitzenlast gedeckt `
        + `(Restleistung ${nf(rest)} kW). Die Anlage erfüllt damit das N-1-Kriterium.`));
    } else if (teil >= WT_SCHWELLEN.n1Teil) {
      out.push(absatz(`Bei Ausfall des größten Erzeugers (${n.groesster.name}, ${nf(n.groesster.leistungKw)} kW) stehen noch ${nf(rest)} kW zur `
        + `Verfügung; das entspricht ${pct(teil * 100)} der Spitzenlast. Das N-1-Kriterium wird nicht vollständig erfüllt. In der Auslegungsspitze `
        + 'wäre ein Lastabwurf oder eine Absenkung der Netztemperatur nötig; eine Reserveerzeugung ist zu prüfen.'));
    } else {
      out.push(absatz(`Bei Ausfall des größten Erzeugers (${n.groesster.name}, ${nf(n.groesster.leistungKw)} kW) stehen nur noch ${nf(rest)} kW `
        + `(${pct(teil * 100)} der Spitzenlast) zur Verfügung. Das N-1-Kriterium wird deutlich verfehlt; für die Versorgungssicherheit ist eine `
        + 'Reserveerzeugung vorzusehen.'));
    }
  }
  return out;
}

function technologieAbsaetze(n) {
  const out = [];
  const von = art => n.erz.filter(e => e.art === art);

  const wps = von('wp');
  if (wps.length) {
    const w = summe(wps, e => e.waermeMwh), el = summe(wps, e => e.elMwh), kw = summe(wps, e => e.leistungKw);
    const mehrere = wps.length > 1;
    const bez = mehrere ? 'Die Wärmepumpen' : `Die ${wps[0].name}`;
    let p = [`${bez} (${nf(kw)} kW thermisch) ${kleinN(wps.length, 'erzeugt', 'erzeugen')} rund ${nf(w)} MWh Wärme pro Jahr`];
    if (el > 0 && w > 0) {
      const jaz = w / el;
      p.push(` und ${kleinN(wps.length, 'benötigt', 'benötigen')} dafür ${nf(el)} MWh Strom. Die rechnerische Jahresarbeitszahl (JAZ) beträgt ${nf(jaz, 2)}. `);
      p.push({
        sehrGut: 'Dieser Wert ist sehr gut und spricht für ein günstiges Verhältnis von Wärmequelle und Netztemperatur.',
        gut: 'Dieser Wert ist gut und liegt im üblichen Bereich effizient betriebener Großwärmepumpen.',
        maessig: 'Dieser Wert ist mäßig. Eine Absenkung der Vorlauftemperatur würde die Effizienz und damit die Betriebskosten spürbar verbessern.',
        niedrig: 'Dieser Wert ist niedrig. Die Wirtschaftlichkeit und die Fördervoraussetzungen sind kritisch zu prüfen; Ansatzpunkte sind eine '
          + 'Absenkung der Netztemperaturen und die Wahl einer günstigeren Wärmequelle.',
      }[wtJazKlasse(jaz)]);
    } else {
      p.push('. Die Jahresarbeitszahl wird nach Abschluss der Dispatch-Berechnung ergänzt: JAZ ', F('Jahresarbeitszahl'), '.');
    }
    out.push(absatz(...p));
    out.push(absatz(`Der zusätzliche Strombedarf ${kleinN(wps.length, 'der Wärmepumpe', 'der Wärmepumpen')} geht als Zusatzbedarf aus dem Wärmekonzept `
      + 'in die Bedarfsprognose Strom (Kapitel 3.3.2) ein und ist bei der Auslegung des Netzanschlusses zu berücksichtigen.'
      + (wps.some(e => e.unterart === 'luft')
        ? ' Bei Luft-Wasser-Wärmepumpen sind Schallemissionen (TA Lärm) sowie Platzbedarf und Aufstellung der Außengeräte im weiteren Planungsverlauf nachzuweisen.' : '')
      + (wps.some(e => e.unterart === 'erde')
        ? ' Für die Erdwärmenutzung sind Flächenbedarf des Sondenfelds und die wasserrechtlichen Genehmigungsvoraussetzungen zu klären.' : '')));
  }

  for (const b of von('bhkw')) {
    const h = b.leistungKw > 0 ? b.waermeMwh * 1000 / b.leistungKw : NaN;
    let p = [`Das BHKW (${nf(b.leistungKw)} kW thermisch) liefert rund ${nf(b.waermeMwh)} MWh Wärme`];
    if (b.elMwh > 0) p.push(` und erzeugt dabei rund ${nf(b.elMwh)} MWh Strom`);
    p.push(' pro Jahr. ');
    if (ok(h) && b.waermeMwh > 0) {
      p.push(`Daraus ergeben sich ${nf(h)} Vollbenutzungsstunden. `);
      p.push(h < WT_SCHWELLEN.bhkwH.gering
        ? 'Die Auslastung ist gering; die Wirtschaftlichkeit des KWK-Betriebs (Zuschläge, Eigenstromnutzung) hängt von einer ausreichenden Betriebsdauer ab und ist zu prüfen.'
        : h > WT_SCHWELLEN.bhkwH.hoch
          ? 'Die Auslastung ist hoch; das BHKW läuft im Wesentlichen als Grundlasterzeuger.'
          : 'Die Auslastung liegt im wirtschaftlich üblichen Bereich eines wärmegeführten BHKW.');
    }
    out.push(absatz(...p));
  }

  for (const k of von('kessel')) {
    const a = k.anteil;
    let p = [`${mitArtikel(k, true)} (${nf(k.leistungKw)} kW)`];
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
    out.push(absatz(`${mitArtikel(b, true)} (${nf(b.leistungKw)} kW)${b.waermeMwh > 0 ? ` erzeugt ${nf(b.waermeMwh)} MWh Wärme (${pct(b.anteil, 1)})` : ''}. `
      + 'Zu berücksichtigen sind Brennstofflogistik und Lagerraum, die Brennstoffverfügbarkeit sowie die Anforderungen an Emissionen (BImSchV).'));
  }

  for (const s of von('strom')) {
    const hoch = ok(s.anteil) && s.anteil > 20;
    out.push(absatz(`${mitArtikel(s, true)} (${nf(s.leistungKw)} kW) wandelt Strom mit nahezu 100 % Wirkungsgrad in Wärme um${s.waermeMwh > 0 ? ` und liefert ${nf(s.waermeMwh)} MWh/a (${pct(s.anteil, 1)})` : ''}. `
      + (hoch
        ? 'Bei diesem Anteil sind die Betriebskosten stark vom Strompreis abhängig; der Einsatz sollte auf Spitzenlast und Überschussstrom begrenzt werden.'
        : 'Der Einsatz beschränkt sich auf Spitzenlast und Überschussstrom; die Betriebskosten sind vom Strompreis abhängig.')));
  }

  for (const s of von('solar')) {
    out.push(absatz(`Die Solarthermieanlage liefert ${nf(s.waermeMwh)} MWh Wärme pro Jahr (${pct(s.anteil, 1)}). Der Flächenbedarf und die Flächenkonkurrenz zu Photovoltaik sind im weiteren Verlauf zu prüfen.`));
  }

  for (const f of von('fernwaerme')) {
    out.push(absatz(`Der Fernwärmeanschluss (${nf(f.leistungKw)} kW) deckt ${ok(f.anteil) ? pct(f.anteil, 1) : ''} der Jahreswärme. `
      + 'Der Anteil erneuerbarer Energien richtet sich nach dem Erzeugungsmix des Fernwärmeversorgers; ', F('Primärenergiefaktor / EE-Anteil Fernwärme'), '.'));
  }

  if (n.speicher) {
    const vol = num(n.speicher.speicherM3);
    out.push(absatz(ok(vol)
      ? `Der Wärmespeicher mit einem Volumen von ${nf(vol)} m³ entkoppelt Erzeugung und Bedarf und erhöht die Betriebsdauer der Grundlasterzeuger.`
      : ['Der Wärmespeicher mit einem Volumen von ', F('Speichervolumen in m³'), ' m³ entkoppelt Erzeugung und Bedarf und erhöht die Betriebsdauer der Grundlasterzeuger.']));
  }
  return out;
}

export function wtDimensionierungWea(d) {
  const n = wtNormalisiere(d);
  const out = [];

  // Auslegungsgrundlage
  if (ok(n.pMaxKw) && n.pMaxKw > 0) {
    const bedarf = ok(n.gesamtMwh) ? ` Der Jahreswärmebedarf einschließlich Netzverlusten beträgt ${nf(n.gesamtMwh)} MWh, die maßgebende Spitzenlast ${nf(n.pMaxKw)} kW`
      + (ok(n.tMinC) ? ` (tiefste Außentemperatur im Lastgang ${nf(n.tMinC, 1)} °C)` : '') + '.'
      : ` Die maßgebende Spitzenlast beträgt ${nf(n.pMaxKw)} kW.`;
    const p = ['Die Dimensionierung der Wärmeerzeugungsanlage (WEA) erfolgt auf Grundlage des stundenscharfen Wärmelastgangs der Liegenschaft.', bedarf];
    if (ok(n.gesamtMwh) && n.gesamtMwh > 0) {
      const h = (n.gesamtMwh * 1000) / n.pMaxKw;
      p.push(` Daraus ergeben sich rechnerische Vollbenutzungsstunden von ${nf(h)} h/a. `);
      p.push({
        spitzig: 'Der Lastgang ist stark von der Spitzenlast geprägt: Die Spitzenlast wird nur an wenigen Stunden des Jahres benötigt. Eine bivalente Auslegung mit Grund- und Spitzenlasterzeuger ist daher wirtschaftlich naheliegend.',
        typisch: 'Dieser Wert ist typisch für eine von der Gebäudebeheizung geprägte Wärmeversorgung.',
        gleichmaessig: 'Der Lastgang verläuft vergleichsweise gleichmäßig und weist einen hohen Grundlastanteil auf, wie er bei hohem Warmwasser- oder Prozesswärmebedarf typisch ist. Ein größerer Leistungsanteil des Grundlasterzeugers ist dadurch wirtschaftlich sinnvoll.',
      }[wtVollbenutzungKlasse(h)]);
    }
    out.push(absatz(...p));
  } else {
    out.push(absatz('Die Dimensionierung der Wärmeerzeugungsanlage (WEA) erfolgt auf Grundlage des Wärmelastgangs der Liegenschaft. Die maßgebende Spitzenlast beträgt ',
      F('Spitzenlast in kW'), ' kW bei einem Jahreswärmebedarf von ', F('Jahreswärmebedarf in MWh'), ' MWh.'));
  }

  // Erzeugerkonzept
  if (!n.erz.length) {
    out.push(absatz('Im Konzept sind noch keine Wärmeerzeuger ausgelegt. Die Zusammensetzung der WEA ist mit ', F('Erzeugerkonzept'), ' zu ergänzen.'));
  } else {
    if (n.erz.length === 1) {
      const e = n.erz[0];
      out.push(absatz(`Die Wärmeversorgung erfolgt monovalent über ${e.name} mit einer thermischen Leistung von ${nf(e.leistungKw)} kW.`
        + (e.art === 'wp' ? ' Eine monovalente Wärmepumpenlösung stellt hohe Anforderungen an die Auslegung bei niedrigen Außentemperaturen und an die Redundanz.' : '')
        + (e.fossil ? ' Die Versorgung beruht vollständig auf einem fossilen Energieträger.' : '')));
    } else {
      const g = n.grund;
      const rest = n.erz.filter(e => e !== g);
      const fossilSpitze = rest.filter(e => e.fossil && ok(e.anteil) && e.anteil < WT_SCHWELLEN.kesselAnteil.reserve);
      out.push(absatz(`Die Wärmeversorgung erfolgt ${n.erz.length === 2 ? 'bivalent' : 'multivalent'} aus ${n.erz.length} Erzeugern. `
        + (ok(g.anteil) && g.waermeMwh > 0
          ? `Den größten Anteil an der Jahreswärme deckt ${mitArtikel(g)} mit ${pct(g.anteil, 1)} (${nf(g.leistungKw)} kW). `
          : `Der leistungsstärkste Erzeuger ist ${mitArtikel(g)} (${nf(g.leistungKw)} kW). `)
        + `${kleinN(rest.length, 'Weiterer Erzeuger ist', 'Weitere Erzeuger sind')} ${liste(rest.map(e => e.name))}.`
        + (fossilSpitze.length
          ? ` ${liste(fossilSpitze.map(e => e.name))} ${kleinN(fossilSpitze.length, 'dient', 'dienen')} überwiegend der Spitzenlast und Redundanz und ${kleinN(fossilSpitze.length, 'liefert', 'liefern')} nur `
            + `${pct(summe(fossilSpitze, e => e.anteil), 1)} der Jahreswärme.` : '')));
    }
    out.push(absatz('Im Einzelnen ergeben sich folgende Leistungen und Wärmemengen: ',
      n.erz.map(e => `${e.name} ${nf(e.leistungKw)} kW${e.waermeMwh > 0 ? `, ${nf(e.waermeMwh)} MWh/a (${pct(e.anteil, 1)})` : ''}`).join('; '), '.'));
    out.push(...leistungsAbsaetze(n));
    out.push(eeAbsatz(n));
    out.push(...technologieAbsaetze(n));
    out.push(absatz('Als Standort der Heizzentrale ist ', F('Standort der Heizzentrale'), ' vorgesehen.'));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2.2.2 Wärmeversorgungsnetz (WVN), Soll-Zustand
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtWvn(d) {
  const n = wtNormalisiere(d);
  const z = n.netz;
  const laenge = num(z.laengeM), anschl = num(z.anzahlAnschluesse), vl = num(z.vlC), rl = num(z.rlC);
  const hyd = { ...WT_HYDRAULIK_STANDARD, ...(z.hydraulik || {}) };
  const out = [];

  // Netzaufbau
  const aufbau = [];
  if (z.bestand === true) aufbau.push('Das Wärmeversorgungsnetz (WVN) wird auf Basis des vorhandenen Bestandsnetzes weitergeführt. Leitungsverläufe und Nennweiten des Bestands bleiben unverändert; neue Gebäude werden über zusätzliche Hausanschlüsse angebunden.');
  else if (z.bestand === false) aufbau.push('Das Wärmeversorgungsnetz (WVN) wird als Neubaunetz geplant. Trassenführung und Nennweiten werden anhand der Gebäudelasten ausgelegt.');
  else aufbau.push('Das Wärmeversorgungsnetz (WVN) verbindet die Heizzentrale mit den angeschlossenen Gebäuden.');
  if (ok(laenge) && laenge > 0 && ok(anschl) && anschl > 0) {
    aufbau.push(` Die Trassenlänge beträgt ${nf(laenge)} m bei ${nf(anschl)} ${kleinN(anschl, 'Gebäudeanschluss', 'Gebäudeanschlüssen')}; das entspricht ${nf(laenge / anschl)} m Trasse je Anschluss.`);
  } else if (ok(laenge) && laenge > 0) aufbau.push(` Die Trassenlänge beträgt ${nf(laenge)} m.`);
  else aufbau.push(' Die Trassenlänge beträgt ', F('Trassenlänge in m'), ' m.');
  out.push(absatz(...aufbau));

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

  // Netzverluste
  if (ok(n.netzverlustPct) && n.netzverlustPct >= 0) {
    const kl = wtNetzverlustKlasse(n.netzverlustPct);
    const wm = ok(n.netzverlustMwh) && ok(laenge) && laenge > 0 ? (n.netzverlustMwh * 1e6) / 8760 / laenge : NaN;
    let p = [`Die Netzverluste betragen ${pct(n.netzverlustPct, 1)} der eingespeisten Wärme`
      + (ok(n.netzverlustMwh) ? ` (${nf(n.netzverlustMwh)} MWh/a)` : '')
      + (ok(wm) ? `, bezogen auf die Trasse ${nf(wm)} W/m` : '') + '. '];
    p.push({
      niedrig: 'Das ist ein niedriger Wert; das Netz arbeitet verlustarm.',
      ueblich: 'Das ist ein für Wärmenetze übliches Niveau.',
      erhoeht: 'Das ist ein erhöhter Wert. Maßnahmen zur Verlustminderung, etwa eine Absenkung der Netztemperaturen, verbesserte Dämmung oder eine kürzere Trassenführung, sind zu prüfen.',
      hoch: 'Das ist ein hoher Wert, der die Wirtschaftlichkeit und die Klimabilanz deutlich belastet. Eine Absenkung der Netztemperaturen, die Verdichtung der Anschlüsse und eine Verbesserung der Dämmung sind dringend zu prüfen.',
    }[kl]);
    out.push(absatz(...p));
  }

  // Temperaturniveau
  if (ok(vl) && ok(rl)) {
    const sp = vl - rl;
    const kl = wtVorlaufKlasse(vl);
    let p = [`Das Netz wird mit einer Vorlauftemperatur von ${nf(vl)} °C und einer Rücklauftemperatur von ${nf(rl)} °C betrieben (Spreizung ${nf(sp)} K). `];
    p.push({
      hoch: 'Das Temperaturniveau ist hoch. Für Wärmepumpen und andere erneuerbare Erzeuger mindert es die Effizienz deutlich; eine schrittweise Absenkung ist eine zentrale Voraussetzung der Transformation.',
      mittel: 'Das Temperaturniveau ist mittel. Für Wärmepumpen ist es bei gleitender Fahrweise nutzbar, eine weitere Absenkung bleibt vorteilhaft.',
      nieder: 'Es handelt sich um ein Niedertemperaturnetz, das für den Einsatz von Wärmepumpen gut geeignet ist.',
      kalt: 'Es handelt sich um ein Netz mit sehr niedriger Temperatur („kalte Nahwärme“). Die Gebäude benötigen dezentrale Wärmepumpen oder Nachheizung für die Trinkwassererwärmung.',
    }[kl]);
    p.push(' ');
    p.push(sp >= WT_SCHWELLEN.spreizungK.gut
      ? 'Die große Spreizung hält Volumenströme und Pumpenenergie niedrig.'
      : sp >= WT_SCHWELLEN.spreizungK.gering
        ? 'Die Spreizung liegt im üblichen Bereich.'
        : 'Die geringe Spreizung führt zu großen Volumenströmen, höheren Druckverlusten und erhöhter Pumpenenergie; der hydraulische Abgleich der Anlagen ist zu prüfen.');
    out.push(absatz(...p));
  } else {
    out.push(absatz('Das Netz wird mit einer Vorlauftemperatur von ', F('Vorlauftemperatur in °C'), ' °C und einer Rücklauftemperatur von ', F('Rücklauftemperatur in °C'), ' °C betrieben.'));
  }

  // Hydraulik
  const ue = num(z.ueberschreitungen);
  let h = [`Die Nennweiten werden so gewählt, dass in der Verteilleitung ein Druckverlust von ${nf(hyd.dpNetzPaM)} Pa/m und im Hausanschluss von ${nf(hyd.dpAnschlussPaM)} Pa/m `
    + `nicht überschritten wird; die Fließgeschwindigkeit wird auf ${nf(hyd.vZielMs, 1)} m/s ausgelegt (zulässiger Bereich ${nf(hyd.vMinMs, 1)} bis ${nf(hyd.vMaxMs, 1)} m/s). `
    + `Für die Hausstation wird eine Druckreserve von ${nf(hyd.hausstationBar, 1)} bar angesetzt. `];
  if (ok(ue)) {
    if (ue <= 0) h.push('Die hydraulische Prüfung zeigt keine Überschreitung der Grenzwerte.');
    else if (z.bestand === true) h.push(`Die hydraulische Prüfung zeigt bei ${nf(ue)} ${kleinN(ue, 'Strang', 'Strängen')} eine Überschreitung der Grenzwerte. Da die Nennweiten des Bestands nicht verändert werden, sind diese Stränge zu markieren und im Einzelfall zu prüfen, ob eine Anpassung erforderlich ist.`);
    else h.push(`Die hydraulische Prüfung zeigte bei ${nf(ue)} ${kleinN(ue, 'Strang', 'Strängen')} eine Überschreitung der Grenzwerte, die durch Anpassung der Nennweite behoben werden muss.`);
  }
  out.push(absatz(...h));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2.2.3 Wärmetechnische Hausstation (WH), Soll-Zustand
 * ═══════════════════════════════════════════════════════════════════════ */
export function wtHausstation(d) {
  const n = wtNormalisiere(d);
  const g = n.gebaeude, z = n.netz;
  const anzahl = num(g.anzahl), summeKw = num(g.heizlastSummeKw), vl = num(z.vlC), rl = num(z.rlC);
  const hyd = { ...WT_HYDRAULIK_STANDARD, ...(z.hydraulik || {}) };
  const out = [];

  if (ok(anzahl) && anzahl > 0) {
    const mittel = ok(summeKw) && summeKw > 0 ? summeKw / anzahl : NaN;
    out.push(absatz(`Die Wärmeübergabe an die Gebäude erfolgt über ${nf(anzahl)} ${kleinN(anzahl, 'Hausstation', 'Hausstationen')}`
      + (ok(summeKw) && summeKw > 0 ? ` mit einer summierten Anschlussleistung von ${nf(summeKw)} kW (im Mittel ${nf(mittel)} kW je Anschluss)` : '')
      + '. Die Anschlussart (direkt oder indirekt) ist ', F('Anschlussart der Hausstationen'), '.'));
  } else {
    out.push(absatz('Die Wärmeübergabe an die Gebäude erfolgt über Hausstationen. Die Zahl der anzuschließenden Gebäude beträgt ', F('Anzahl Hausstationen'), '.'));
  }

  out.push(absatz(`Für die Hausstationen wird eine Druckreserve von ${nf(hyd.hausstationBar, 1)} bar angesetzt, damit der Differenzdruck auch am hydraulisch ungünstigsten Anschluss ausreicht.`));

  if (ok(vl)) {
    const kl = wtVorlaufKlasse(vl);
    if (kl === 'hoch') {
      out.push(absatz(`Bei der Vorlauftemperatur von ${nf(vl)} °C sind die Hausstationen und die Heizflächen in den Gebäuden für das heutige Temperaturniveau ausgelegt. Bei einer späteren Absenkung der Netztemperatur ist zu prüfen, ob die vorhandenen Heizflächen die Heizlast noch decken.`));
    } else if (kl === 'mittel') {
      out.push(absatz(`Bei der Vorlauftemperatur von ${nf(vl)} °C ist in unsanierten Gebäuden mit hohen Heizflächentemperaturen eine Prüfung der Heizflächen sinnvoll; mit sinkender Temperatur steigt der Anpassungsbedarf.`));
    } else {
      out.push(absatz(`Bei der niedrigen Vorlauftemperatur von ${nf(vl)} °C ist je Gebäude zu prüfen, ob die Heizflächen die Heizlast decken und ob Maßnahmen an der Gebäudehülle oder den Heizflächen erforderlich sind. `
        + 'Für die Trinkwassererwärmung sind die Anforderungen an den Legionellenschutz (DVGW W 551) zu beachten; üblich sind Frischwasserstationen im Durchflussprinzip oder eine dezentrale Nachheizung.'));
    }
    if (vl < 60) {
      out.push(absatz('Da die Vorlauftemperatur unter 60 °C liegt, kann die Trinkwassererwärmung nicht direkt aus dem Netz erfolgen. Hierfür ist ein Konzept zur Nachheizung bzw. zur Einhaltung der Hygieneanforderungen erforderlich: ', F('Konzept Trinkwassererwärmung'), '.'));
    }
  }

  if (ok(rl)) {
    const s = WT_SCHWELLEN.ruecklaufC;
    out.push(absatz(rl <= s.gut
      ? `Die Rücklauftemperatur von ${nf(rl)} °C ist günstig; sie sollte durch eine Rücklauftemperaturbegrenzung in den Hausstationen gesichert werden.`
      : rl <= s.moderat
        ? `Die Rücklauftemperatur von ${nf(rl)} °C ist moderat. Durch hydraulischen Abgleich und Rücklauftemperaturbegrenzung in den Hausstationen lässt sie sich weiter senken, was die Effizienz der Erzeuger und die Netzverluste verbessert.`
        : `Die Rücklauftemperatur von ${nf(rl)} °C ist hoch. Dies deutet auf einen mangelhaften hydraulischen Abgleich oder fehlende Rücklauftemperaturbegrenzung in den Hausstationen hin und mindert die Effizienz der Erzeuger deutlich; eine Optimierung der Hausstationen ist vorzusehen.`));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2.4 Variantenvergleich und 2.5 Wirtschaftlichkeit
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
const erzeugerKurz = v => (v.erzeuger || []).filter(e => num(e.leistungKw) > 0)
  .map(e => `${e.name || WT_ERZEUGER[e.key]?.name || e.key} ${nf(num(e.leistungKw))} kW`).join(', ');
const nameV = v => v.name || 'Variante';
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
  if (V.length === 1) {
    const v = V[0];
    out.push(absatz(`Betrachtet wird die Variante „${nameV(v)}“`, erzeugerKurz(v) ? ` mit ${erzeugerKurz(v)}` : '', '. Weitere Varianten sind ', F('Weitere Varianten oder Begründung für die Betrachtung einer Variante'), '.'));
    const teile = [];
    if (ok(v.eeAnteilPct)) teile.push(`einen Anteil erneuerbarer Energien von ${pct(v.eeAnteilPct, 1)}`);
    if (ok(v.co2T)) teile.push(`Emissionen von ${nf(v.co2T)} t CO₂e pro Jahr`);
    if (ok(v.wgkCt)) teile.push(`Wärmegestehungskosten von ${nf(v.wgkCt, 1)} ct/kWh`);
    if (teile.length) out.push(absatz(`Die Variante erreicht ${liste(teile)}.`, ok(v.eeAnteilPct) ? ` Damit erfüllt sie ${wpgText(v.eeAnteilPct)}.` : ''));
    return out;
  }
  out.push(absatz(`Verglichen werden ${V.length} Varianten der Wärmeversorgung: `, V.map(v => `${nameV(v)}${erzeugerKurz(v) ? ` (${erzeugerKurz(v)})` : ''}`).join('; '), '. Alle Varianten werden für denselben Wärmebedarf und dasselbe Netz gerechnet.'));

  const rahmen = [];
  if (ok(num(w.co2PreisEurT))) rahmen.push(`ein CO₂-Preis von ${nf(num(w.co2PreisEurT))} €/t`);
  if (ok(num(w.strompreisCt))) rahmen.push(`ein Strompreis von ${nf(num(w.strompreisCt), 1)} ct/kWh`);
  if (ok(num(w.gaspreisCt))) rahmen.push(`ein Gaspreis von ${nf(num(w.gaspreisCt), 1)} ct/kWh`);
  if (rahmen.length) out.push(absatz(`Den Berechnungen liegen ${liste(rahmen)} zugrunde.`));

  // Ökologie
  const co2 = V.filter(v => ok(v.co2T));
  if (co2.length >= 2) {
    const best = extrem(co2, 'co2T', 'min'), schlecht = extrem(co2, 'co2T', 'max'), sp = spanne(co2, 'co2T');
    const rel = schlecht.co2T > 0 ? ((schlecht.co2T - best.co2T) / schlecht.co2T) * 100 : 0;
    out.push(absatz(rel < WT_SCHWELLEN.gleichwertigPct.co2
      ? `Die Emissionen der Varianten liegen mit ${nf(sp.min)} bis ${nf(sp.max)} t CO₂e pro Jahr nahezu gleichauf; die Varianten unterscheiden sich ökologisch kaum.`
      : `Die jährlichen Emissionen liegen zwischen ${nf(sp.min)} t CO₂e (${nameV(best)}) und ${nf(sp.max)} t CO₂e (${nameV(schlecht)}). `
        + `${nameV(best)} verursacht damit ${pct(rel)} weniger Emissionen als ${nameV(schlecht)}.`));
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
      : `Die Wärmegestehungskosten reichen von ${nf(bestWgk.wgkCt, 1)} ct/kWh (${nameV(bestWgk)}) bis ${nf(schlechtWgk.wgkCt, 1)} ct/kWh (${nameV(schlechtWgk)}). `
        + `${nameV(bestWgk)} ist damit ${pct(rel)} günstiger als ${nameV(schlechtWgk)}.`
        + (wgk.length >= 3 ? ` Die Rangfolge nach Kosten lautet: ${[...wgk].sort((a, b) => a.wgkCt - b.wgkCt).map(v => `${nameV(v)} (${nf(v.wgkCt, 1)} ct/kWh)`).join(', ')}.` : '')));
  } else if (wgk.length === 1) {
    out.push(absatz(`Für ${nameV(wgk[0])} liegen Wärmegestehungskosten von ${nf(wgk[0].wgkCt, 1)} ct/kWh vor; für ${kleinN(V.length - 1, 'die weitere Variante', 'die übrigen Varianten')} fehlen die Wirtschaftlichkeitswerte (`, F('fehlende Wirtschaftlichkeitswerte'), ').'));
  }
  const inv = V.filter(v => ok(v.investEur));
  const bestInv = extrem(inv, 'investEur', 'min');
  if (inv.length >= 2 && bestWgk && bestInv && bestInv !== bestWgk) {
    out.push(absatz(`Die geringste Investition erfordert ${nameV(bestInv)} (${nf(bestInv.investEur / 1000)} Tsd. €), die niedrigsten Gestehungskosten erreicht jedoch ${nameV(bestWgk)} `
      + `(Investition ${nf(bestWgk.investEur / 1000)} Tsd. €). Höhere Investitionen werden hier durch geringere Betriebskosten über die Nutzungsdauer ausgeglichen.`));
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

export function wtWirtschaftlichkeit(d) {
  const n = wtNormalisiere(d);
  const w = n.wirt;
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

  // aktive Variante
  const inv = num(w.investEur), jk = num(w.jahreskostenEur), wgk = num(w.wgkCt);
  if (ok(inv) && inv > 0) {
    let p = [`Die Gesamtinvestition für das Wärmekonzept beträgt rund ${nf(inv / 1000)} Tsd. €`];
    if (n.instKw > 0) p.push(`, das entspricht ${nf(inv / n.instKw)} € je kW installierter Leistung`);
    p.push('.');
    if (ok(jk)) p.push(` Die jährlichen Gesamtkosten betragen ${nf(jk / 1000)} Tsd. €`);
    if (ok(wgk)) p.push(`${ok(jk) ? ', die' : ' Die'} Wärmegestehungskosten ${nf(wgk, 1)} ct/kWh`);
    if (ok(jk) || ok(wgk)) p.push('.');
    out.push(absatz(...p));
  } else {
    out.push(absatz('Die Gesamtinvestition beträgt ', F('Gesamtinvestition in €'), ' €, die Wärmegestehungskosten betragen ', F('Wärmegestehungskosten in ct/kWh'), ' ct/kWh.'));
  }
  const fw = num(w.fernwaermeCt);
  if (ok(wgk) && ok(fw) && fw > 0) {
    const d2 = ((wgk - fw) / fw) * 100;
    out.push(absatz(Math.abs(d2) < 3
      ? `Die Wärmegestehungskosten liegen auf dem Niveau des angesetzten Fernwärmepreises von ${nf(fw, 1)} ct/kWh.`
      : d2 < 0
        ? `Die Wärmegestehungskosten liegen ${pct(-d2)} unter dem angesetzten Fernwärmepreis von ${nf(fw, 1)} ct/kWh; das Konzept ist gegenüber dem Fernwärmebezug wirtschaftlich vorteilhaft.`
        : `Die Wärmegestehungskosten liegen ${pct(d2)} über dem angesetzten Fernwärmepreis von ${nf(fw, 1)} ct/kWh; gegenüber dem Fernwärmebezug ist das Konzept wirtschaftlich nachteilig und nur durch Förderung, Klimaschutzvorgaben oder Versorgungssicherheit zu begründen.`));
  }

  // Kostentreiber nach Technologie
  const treiber = [];
  if (n.erz.some(e => e.art === 'wp' || e.art === 'strom')) treiber.push('Strompreis');
  if (n.erz.some(e => (e.art === 'kessel' && e.key !== 'heizoel') || e.art === 'bhkw')) treiber.push('Gaspreis');
  if (n.erz.some(e => e.key === 'heizoel')) treiber.push('Heizölpreis');
  if (n.erz.some(e => e.art === 'biomasse')) treiber.push('Brennstoffpreis für Biomasse');
  if (n.erz.some(e => e.fossil)) treiber.push('CO₂-Preis');
  if (treiber.length) {
    out.push(absatz(`Die Betriebskosten hängen maßgeblich von ${liste(treiber.map(t => `dem ${t}`))} ab. Änderungen dieser Größen wirken sich unmittelbar auf die Wärmegestehungskosten aus; eine Sensitivitätsbetrachtung ist im weiteren Planungsverlauf sinnvoll.`));
  }

  // Variantenvergleich
  const V = n.varianten.filter(v => ok(v.wgkCt));
  if (V.length >= 2) {
    const b = extrem(V, 'wgkCt', 'min'), s = extrem(V, 'wgkCt', 'max');
    const invs = spanne(n.varianten, 'investEur');
    out.push(absatz(`Im Variantenvergleich liegen die Wärmegestehungskosten zwischen ${nf(b.wgkCt, 1)} und ${nf(s.wgkCt, 1)} ct/kWh`
      + (invs ? ` bei Investitionen zwischen ${nf(invs.min / 1000)} und ${nf(invs.max / 1000)} Tsd. €` : '')
      + `. Die wirtschaftlichste Variante ist ${nameV(b)}.`));
  }

  out.push(absatz('Fördermittel (', F('Förderprogramm, z. B. BEW'), ') sind in den dargestellten Kosten ', F('berücksichtigt / nicht berücksichtigt'), '.'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2.7 Empfehlung und 6.1 Fazit
 * ═══════════════════════════════════════════════════════════════════════ */
function folgeschritte(n) {
  const schritte = [];
  const vl = num(n.netz.vlC);
  if (n.erz.some(e => e.art === 'wp')) schritte.push('der Netzanschlussantrag für den zusätzlichen Strombedarf der Wärmepumpen (Kapitel 3.4.1)');
  if (n.erz.some(e => e.unterart === 'luft')) schritte.push('ein schalltechnisches Gutachten für die Luft-Wasser-Wärmepumpen (TA Lärm)');
  if (n.erz.some(e => e.unterart === 'erde')) schritte.push('die Klärung der wasserrechtlichen Genehmigung und des Flächenbedarfs der Erdwärmesonden');
  if (ok(vl) && vl >= WT_SCHWELLEN.vorlaufC.mittel) schritte.push('die Prüfung einer Absenkung der Netztemperaturen einschließlich der Heizflächen in den Gebäuden');
  if (n.erz.some(e => e.fossil) && ok(n.eePct) && n.eePct < 100) schritte.push('ein Fahrplan zum Ersatz oder zur Umstellung der fossilen Erzeuger');
  if (n.speicher) schritte.push('die Dimensionierung des Wärmespeichers in der Entwurfsplanung');
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
    out.push(absatz(`Empfohlen wird die Umsetzung der Variante „${nameV(v)}“`
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
  const out = [];
  const bedarf = ok(n.gesamtMwh) ? `Der Wärmebedarf der Liegenschaft beträgt rund ${nf(n.gesamtMwh)} MWh pro Jahr bei einer Spitzenlast von ${nf(n.pMaxKw)} kW.` : '';
  const konzept = n.erz.length
    ? ` Die Wärmeversorgung erfolgt ${n.erz.length === 1 ? 'monovalent' : n.erz.length === 2 ? 'bivalent' : 'multivalent'} über ${liste(n.erz.map(e => `${e.name} (${nf(e.leistungKw)} kW)`))}.` : '';
  out.push(absatz(bedarf, konzept, n.erz.length ? '' : ['Das Wärmekonzept ist ', F('Zusammenfassung des Wärmekonzepts'), '.']));

  const ergebnisse = [];
  if (ok(n.eePct)) ergebnisse.push(`einen Anteil erneuerbarer Energien von ${pct(n.eePct, 1)} (${wpgText(n.eePct)})`);
  if (ok(n.co2T)) ergebnisse.push(`Emissionen von ${nf(n.co2T)} t CO₂e pro Jahr`);
  if (ok(num(n.wirt.wgkCt))) ergebnisse.push(`Wärmegestehungskosten von ${nf(num(n.wirt.wgkCt), 1)} ct/kWh`);
  if (ok(num(n.wirt.investEur))) ergebnisse.push(`eine Investition von rund ${nf(num(n.wirt.investEur) / 1000)} Tsd. €`);
  if (ergebnisse.length) out.push(absatz(`Das Konzept erreicht ${liste(ergebnisse)}.`));

  const offen = [];
  if (ok(n.eePct) && n.eePct < 100) offen.push(`Für die vollständige Treibhausgasneutralität bis 2045 verbleibt ein Anteil von ${pct(100 - n.eePct, 1)}, der umzustellen ist`);
  if (ok(n.netzverlustPct) && wtNetzverlustKlasse(n.netzverlustPct) !== 'niedrig' && wtNetzverlustKlasse(n.netzverlustPct) !== 'ueblich') offen.push(`die Netzverluste von ${pct(n.netzverlustPct, 1)} sind zu senken`);
  if (ok(n.pMaxKw) && n.instKw > 0 && n.instKw < n.pMaxKw * WT_SCHWELLEN.leistungsreserve.unterdeckung) offen.push('die installierte Leistung deckt die Spitzenlast nicht, hier besteht Ergänzungsbedarf');
  if (offen.length) out.push(absatz(`Handlungsbedarf besteht in folgenden Punkten: ${liste(offen)}.`));
  return out;
}
