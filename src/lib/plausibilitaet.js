// @ts-check
// Plausibilitätsprüfung der Kernparameter — DOM-frei.
// Eine zentrale Tabelle mit plausiblen Bereichen; die Oberfläche (src/50-datenqualitaet.js)
// liest die Feldwerte ein und zeigt die Hinweise auf der Projektseite und am Feld.
// Bereiche sind bewusst weit gefasst: Sie sollen Tipp- und Formatfehler finden
// (0,92 statt 92 %, €/kWh statt ct/kWh), keine fachliche Bewertung ersetzen.

/**
 * @typedef {{id: string, gruppe: string, label: string, einheit: string, min: number, max: number,
 *   fallback?: number, optional?: boolean, aktivWenn?: string, panel: string, ort: string,
 *   kleinHinweis?: {unter: number, text: string}}} PlausiParameter
 */

/** @type {PlausiParameter[]} */
export const PLAUSI_PARAMETER = [
  // Wirkungsgrade in % — das Tool rechnet überall mit Wert/100
  { id: 'gk-eta', gruppe: 'Wirkungsgrade', label: 'Wirkungsgrad Gaskessel', einheit: '%', min: 80, max: 110, fallback: 92, aktivWenn: 'gasKessel', panel: 'gaskessel-panel', ort: 'Planung › Wärme › Erzeugung › Gaskessel', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,92 statt 92 %)' } },
  { id: 'hko-eta', gruppe: 'Wirkungsgrade', label: 'Wirkungsgrad Heizölkessel', einheit: '%', min: 80, max: 105, fallback: 90, aktivWenn: 'heizoelKessel', panel: 'heizoel-panel', ort: 'Planung › Wärme › Erzeugung › Heizöl', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,91 statt 91 %)' } },
  { id: 'pk-eta', gruppe: 'Wirkungsgrade', label: 'Wirkungsgrad Pelletkessel', einheit: '%', min: 75, max: 100, fallback: 88, aktivWenn: 'pelletsKessel', panel: 'pellets-panel', ort: 'Planung › Wärme › Erzeugung › Pellets', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,88 statt 88 %)' } },
  { id: 'hhs-eta', gruppe: 'Wirkungsgrade', label: 'Wirkungsgrad Hackschnitzelkessel', einheit: '%', min: 70, max: 95, fallback: 85, aktivWenn: 'heizhackschnitzel', panel: 'hhs-panel', ort: 'Planung › Wärme › Erzeugung › Hackschnitzel', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,85 statt 85 %)' } },
  { id: 'bhkw-eta', gruppe: 'Wirkungsgrade', label: 'Gesamtwirkungsgrad BHKW', einheit: '%', min: 75, max: 100, fallback: 88, aktivWenn: 'bhkw', panel: 'bhkw-panel', ort: 'Planung › Wärme › Erzeugung › BHKW', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,88 statt 88 %)' } },
  { id: 'bhkw-skz', gruppe: 'Wirkungsgrade', label: 'Stromkennzahl BHKW', einheit: '', min: 0.2, max: 0.9, fallback: 0.45, aktivWenn: 'bhkw', panel: 'bhkw-panel', ort: 'Planung › Wärme › Erzeugung › BHKW' },
  { id: 'sk-eta', gruppe: 'Wirkungsgrade', label: 'Wirkungsgrad Elektrokessel', einheit: '%', min: 90, max: 100, fallback: 99, aktivWenn: 'stromkessel', panel: 'stromkessel-panel', ort: 'Planung › Wärme › Erzeugung › Elektrokessel', kleinHinweis: { unter: 1.5, text: 'sieht nach einem Bruchteil aus (0,99 statt 99 %)' } },
  // Jahresarbeitszahlen (vom Tool berechnet oder von Hand gesetzt)
  { id: 'lwwp-jaz', gruppe: 'Jahresarbeitszahlen', label: 'JAZ Luft-Wärmepumpe', einheit: '', min: 2, max: 5.5, aktivWenn: 'lwWp', panel: 'lwwp-panel', ort: 'Planung › Wärme › Erzeugung › Luft-WP' },
  { id: 'geo-jaz', gruppe: 'Jahresarbeitszahlen', label: 'JAZ Erdwärme', einheit: '', min: 3, max: 6.5, aktivWenn: 'geoThermie', panel: 'geo-panel', ort: 'Planung › Wärme › Erzeugung › Erdwärme' },
  { id: 'fg-jaz', gruppe: 'Jahresarbeitszahlen', label: 'JAZ Flusswasser-WP', einheit: '', min: 2.5, max: 6.5, aktivWenn: 'fliessgewaesser', panel: 'fg-panel', ort: 'Planung › Wärme › Erzeugung › Flusswasser' },
  // Emissionsfaktoren g CO₂eq/kWh
  { id: 'strom-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Strom', einheit: 'g/kWh', min: 100, max: 700, fallback: 363, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte', kleinHinweis: { unter: 1.5, text: 'sieht nach kg/kWh aus — erwartet wird g/kWh' } },
  { id: 'strom-emf-lz', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Strom (Zieljahr)', einheit: 'g/kWh', min: 0, max: 450, optional: true, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte' },
  { id: 'gas-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Erdgas', einheit: 'g/kWh', min: 180, max: 300, fallback: 240, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte', kleinHinweis: { unter: 1.5, text: 'sieht nach kg/kWh aus — erwartet wird g/kWh' } },
  { id: 'heizoel-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Heizöl', einheit: 'g/kWh', min: 250, max: 350, fallback: 310, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte', kleinHinweis: { unter: 1.5, text: 'sieht nach kg/kWh aus — erwartet wird g/kWh' } },
  { id: 'fernwaerme-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Fernwärme', einheit: 'g/kWh', min: 0, max: 400, optional: true, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte' },
  { id: 'pellets-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Pellets', einheit: 'g/kWh', min: 5, max: 80, fallback: 20, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte' },
  { id: 'hhs-emf', gruppe: 'Emissionsfaktoren', label: 'Emissionsfaktor Hackschnitzel', einheit: 'g/kWh', min: 5, max: 80, fallback: 20, panel: 'kennwerte-panel', ort: 'Projekt › Kennwerte' },
  // Energiepreise ct/kWh (brutto/netto egal — es geht um Größenordnung)
  { id: 'wirt-p-strom', gruppe: 'Preise', label: 'Strompreis', einheit: 'ct/kWh', min: 10, max: 60, fallback: 35, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-strom-wp', gruppe: 'Preise', label: 'Wärmepumpen-Strompreis', einheit: 'ct/kWh', min: 10, max: 50, optional: true, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-gas', gruppe: 'Preise', label: 'Gaspreis', einheit: 'ct/kWh', min: 3, max: 25, fallback: 10, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-hko', gruppe: 'Preise', label: 'Heizölpreis', einheit: 'ct/kWh', min: 4, max: 25, fallback: 10, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-fw', gruppe: 'Preise', label: 'Fernwärmepreis', einheit: 'ct/kWh', min: 5, max: 35, fallback: 17, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-pk', gruppe: 'Preise', label: 'Pelletpreis', einheit: 'ct/kWh', min: 3, max: 20, fallback: 8, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-hhs', gruppe: 'Preise', label: 'Hackschnitzelpreis', einheit: 'ct/kWh', min: 2, max: 15, fallback: 6, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit', kleinHinweis: { unter: 1, text: 'sieht nach €/kWh aus — erwartet wird ct/kWh' } },
  { id: 'wirt-p-co2', gruppe: 'Preise', label: 'CO₂-Preis', einheit: '€/t', min: 0, max: 400, optional: true, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit' },
  { id: 'wirt-zins', gruppe: 'Preise', label: 'Kapitalzins', einheit: '%', min: 0, max: 12, optional: true, panel: 'wirtschaft-panel', ort: 'Auswertung › Wirtschaftlichkeit' },
];

// Spezifischer Wärmebedarf je Gebäude (kWh/m²a, bezogen auf die Nutzfläche)
export const PLAUSI_SPEZ_WAERME = { min: 15, max: 450 };
// Spezifischer Strombedarf je Gebäude (kWh/m²a)
export const PLAUSI_SPEZ_STROM = { min: 1, max: 300 };

/** @param {number} x @param {number} [nk] */
function zahl(x, nk = 2) {
  return x.toLocaleString('de-DE', { maximumFractionDigits: nk });
}

/** Rohwert (Feldinhalt, Zahl oder Text mit Komma) → Zahl oder null. @param {unknown} roh */
export function plausiZahl(roh) {
  if (roh == null) return null;
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null;
  const s = String(roh).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prüft einen Feldwert gegen seinen Bereich.
 * Leer oder 0 bei Feldern mit Standardwert heißt: Das Tool rechnet mit dem Fallback
 * (`parseFloat(x) || 92`) — das wird als eigener, milderer Hinweis gemeldet.
 * @param {PlausiParameter} p @param {unknown} roh
 * @returns {null | {stufe: 'warnung' | 'fallback', text: string, wert: number | null}}
 */
export function pruefeWert(p, roh) {
  const w = plausiZahl(roh);
  if (w == null || w === 0) {
    if (p.optional) return null;
    if (p.fallback != null) return { stufe: 'fallback', wert: w, text: `${w === 0 ? '0' : 'leer'} → Standardwert ${zahl(p.fallback)}${p.einheit ? ' ' + p.einheit : ''} verwendet` };
    if (w == null) return null;
  }
  if (w == null) return null;
  const bereich = `plausibel ${zahl(p.min)}–${zahl(p.max)}${p.einheit ? ' ' + p.einheit : ''}`;
  if (p.kleinHinweis && w > 0 && w < p.kleinHinweis.unter) {
    return { stufe: 'warnung', wert: w, text: `${zahl(w, 3)} ${p.kleinHinweis.text}; ${bereich}` };
  }
  if (w < p.min || w > p.max) {
    return { stufe: 'warnung', wert: w, text: `${zahl(w, 3)}${p.einheit ? ' ' + p.einheit : ''} liegt außerhalb (${bereich})` };
  }
  return null;
}

/**
 * @typedef {{id: string, gruppe: string, label: string, stufe: 'warnung' | 'fallback' | 'korrigiert',
 *   text: string, ort?: string, panel?: string, gebId?: number, ohneFeld?: boolean}} PlausiHinweis
 */

/**
 * Prüft alle Kernparameter.
 * @param {Record<string, unknown>} werte Rohwerte je Feld-ID
 * @param {Set<string> | string[]} aktiv aktive Erzeuger (Schlüssel wie 'gasKessel', 'lwWp')
 * @returns {PlausiHinweis[]}
 */
export function pruefeParameter(werte, aktiv) {
  const an = aktiv instanceof Set ? aktiv : new Set(aktiv);
  /** @type {PlausiHinweis[]} */
  const out = [];
  for (const p of PLAUSI_PARAMETER) {
    if (p.aktivWenn && !an.has(p.aktivWenn)) continue;
    if (!(p.id in werte)) continue;
    const r = pruefeWert(p, werte[p.id]);
    if (r) out.push({ id: p.id, gruppe: p.gruppe, label: p.label, stufe: r.stufe, text: r.text, ort: p.ort, panel: p.panel });
  }
  return out;
}

/**
 * Spezifischer Wärme- und Strombedarf je Gebäude. Gebäude ohne Fläche oder Bedarf bleiben außen vor
 * (das meldet die Ladeübersicht).
 * @param {Array<Record<string, any>>} gebaeude
 * @returns {PlausiHinweis[]}
 */
export function pruefeGebaeude(gebaeude) {
  /** @type {PlausiHinweis[]} */
  const out = [];
  for (const g of gebaeude || []) {
    const fl = plausiZahl(g.flaeche);
    const name = String(g.name || `Gebäude ${g.id}`);
    if (!fl || fl <= 0) continue;
    const mwh = plausiZahl(g.waerme);
    const spez = mwh != null && mwh > 0 ? mwh * 1000 / fl : plausiZahl(g.spez);
    if (spez != null && spez > 0 && (spez < PLAUSI_SPEZ_WAERME.min || spez > PLAUSI_SPEZ_WAERME.max)) {
      out.push({ id: 'geb-' + g.id, gebId: Number(g.id), gruppe: 'Gebäude', label: name, stufe: 'warnung',
        text: `spez. Wärmebedarf ${zahl(spez, 0)} kWh/m²a (plausibel ${PLAUSI_SPEZ_WAERME.min}–${PLAUSI_SPEZ_WAERME.max}) — Fläche oder Wärmebedarf (MWh/a) prüfen` });
    }
    const smwh = plausiZahl(g.strom);
    const sspez = smwh != null && smwh > 0 ? smwh * 1000 / fl : null;
    if (sspez != null && (sspez < PLAUSI_SPEZ_STROM.min || sspez > PLAUSI_SPEZ_STROM.max)) {
      out.push({ id: 'geb-s-' + g.id, gebId: Number(g.id), gruppe: 'Gebäude', label: name, stufe: 'warnung',
        text: `spez. Strombedarf ${zahl(sspez, 0)} kWh/m²a (plausibel ${PLAUSI_SPEZ_STROM.min}–${PLAUSI_SPEZ_STROM.max}) — Fläche oder Strombedarf (MWh/a) prüfen` });
    }
  }
  return out;
}

/**
 * Mittelspannungskabel mit Niederspannungstyp (z. B. NYY/NAYY statt NA2XS2Y). Rechnerisch fällt das kaum auf,
 * weil MS-Kabel nach Querschnitt bewertet werden, im Gutachten (Übersichtsschaltbild, MS-Kabeltabelle) steht der
 * Typ aber wörtlich — und ist für jeden Fachleser sofort falsch.
 * @param {Array<{id?: any, name?: string, msLevel?: boolean, cableType?: string}>} kanten Kabel des Netzes
 * @param {(typ: string) => string | null | undefined} gruppeVon Katalog-Gruppe eines Kabeltyps ('ns' | 'ms' | …)
 * @returns {PlausiHinweis[]}
 */
export function pruefeMsKabel(kanten, gruppeVon) {
  /** @type {Map<string, {n: number, namen: string[]}>} */
  const jeTyp = new Map();
  for (const k of kanten || []) {
    const typ = String(k?.cableType || '').trim();
    if (!k?.msLevel || !typ || gruppeVon(typ) !== 'ns') continue;
    const e = jeTyp.get(typ) || { n: 0, namen: [] };
    e.n++;
    if (k.name && e.namen.length < 3) e.namen.push(String(k.name));
    jeTyp.set(typ, e);
  }
  return [...jeTyp].map(([typ, e]) => ({
    id: 'ms-kabel-' + typ, gruppe: 'Stromnetz', label: `Mittelspannungskabel als ${typ}`, stufe: 'warnung',
    text: `${e.n} MS-${e.n === 1 ? 'Kabel ist' : 'Kabel sind'} mit dem Niederspannungstyp ${typ} erfasst`
      + (e.namen.length ? ` (${e.namen.join(', ')}${e.n > e.namen.length ? ' …' : ''})` : '')
      + ' — Kabeltyp prüfen, z. B. NA2XS2Y; das Gutachten nennt den Typ im Übersichtsschaltbild',
    ort: 'Planung › Strom › Netz', ohneFeld: true,
  }));
}

// Projektdatei-Schlüssel der Erzeuger mit Wirkungsgrad in % → Feld-ID
const ETA_FELDER = /** @type {Record<string, string>} */ ({
  gasKessel: 'gk-eta', heizoelKessel: 'hko-eta', pelletsKessel: 'pk-eta',
  heizhackschnitzel: 'hhs-eta', bhkw: 'bhkw-eta', stromkessel: 'sk-eta',
});

/**
 * Ältere Projektdateien speichern Wirkungsgrade als Bruchteil („0.92“), das Tool
 * erwartet Prozent. Erkannt wird alles unter 1,5 — ein Kessel mit 1,5 % gibt es nicht.
 * Durchsucht Projektwurzel und Variantenstände (beliebige Tiefe, große Zeitreihen ausgenommen)
 * und korrigiert IN PLACE. Gibt die Korrekturen zurück.
 * @param {Record<string, any>} project
 * @returns {PlausiHinweis[]}
 */
export function migriereWirkungsgrade(project) {
  /** @type {PlausiHinweis[]} */
  const out = [];
  const label = /** @type {Record<string, string>} */ (Object.fromEntries(PLAUSI_PARAMETER.map(p => [p.id, p.label])));
  /** @param {any} obj @param {string} pfad @param {number} tiefe */
  const lauf = (obj, pfad, tiefe) => {
    if (!obj || typeof obj !== 'object' || tiefe > 6) return;
    if (Array.isArray(obj)) {
      if (obj.length > 200 || typeof obj[0] !== 'object') return;
      obj.forEach((x, i) => lauf(x, `${pfad}[${i}]`, tiefe + 1));
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (!v || typeof v !== 'object') continue;
      if (k in ETA_FELDER && !Array.isArray(v) && v.eta != null && v.eta !== '') {
        const n = plausiZahl(v.eta);
        if (n != null && n > 0 && n < 1.5) {
          const neu = Math.round(n * 1000) / 10;
          v.eta = String(neu);
          const id = ETA_FELDER[k];
          out.push({ id, gruppe: 'Wirkungsgrade', label: label[id] || k, stufe: 'korrigiert',
            text: `beim Laden als Bruchteil erkannt: ${zahl(n, 3)} → ${zahl(neu, 1)} %${pfad ? ` (${pfad.replace(/^\./, '')})` : ''}` });
        }
      }
      if (k === 'gebaeude' || k === 'pvProfile' || k === 'stromLastgaenge') continue;
      lauf(v, `${pfad}.${k}`, tiefe + 1);
    }
  };
  lauf(project, '', 0);
  return out;
}
