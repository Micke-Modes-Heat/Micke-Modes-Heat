// ── lib/gutachten-fragen.js — optionaler Fragebogen je Gutachtenkapitel ──
// DOM-frei. Antworten stehen im Gutachten-Dokument (dok.fragen = { frageId: wert }) und damit in der Projektdatei.
// Unbeantwortete Fragen gelten mit ihrer Vorgabe; die Vorgabe darf vom Projekt abhängen (ctx, z. B. welche
// Techniken in den Varianten stecken). Es gibt keine Pflichtfragen und keine Warnungen für offene Fragen.

/** Techniken der Potenzialanalyse 4.2 (Schlüssel → Titel, Quelle für die Einleitung, Erzeugerschlüssel im Dispatch). */
export const GF_TECHNIKEN = Object.freeze({
  geo: { titel: 'Oberflächennahe Geothermie', quelle: 'Umweltwärme aus dem Erdreich (Erdwärmesonden)', erzeuger: ['geo'] },
  eis: { titel: 'Eisspeicher-Wärmepumpe', quelle: 'Umweltwärme über einen Eisspeicher mit Solar-Luftabsorbern', erzeuger: [] },
  lwwp: { titel: 'Luft-Wasser-Wärmepumpe', quelle: 'Umweltwärme aus der Außenluft', erzeuger: ['lwwp'] },
  tiefengeo: { titel: 'Tiefengeothermie', quelle: 'Tiefengeothermie', erzeuger: [] },
  biomasse: { titel: 'Biomasse (Pellets/Hackschnitzel)', quelle: 'feste Biomasse (Holzpellets bzw. Hackschnitzel)', erzeuger: ['pellets', 'hhs'] },
});

export const GF_POT_OPTIONEN = Object.freeze([
  ['vertieft', 'näher beschreiben (4.2)'], ['kurz', 'nur nennen (4.2)'], ['nicht', 'nicht berücksichtigt, Begründung in 4.1'], ['weglassen', 'nicht erwähnen'],
]);

/** In 4.1 aufgeführte Standardpunkte (Schlüssel wie PT_NICHT in lib/gutachten-potenzial.js). */
export const GF_NICHT_PUNKTE = Object.freeze([
  ['abwaerme', 'Abwärme'], ['solarthermie', 'Solarthermie'], ['wasserstoff', 'Wasserstoff'], ['gasGrundlast', 'Gas-Grundlast'],
  ['wind', 'Windkraft'], ['bioFluessigGas', 'flüssige/gasförmige Biomasse'],
]);

/**
 * Fragen: { id, kapitel (Nummer der Standardgliederung), frage, art: 'auswahl'|'mehrfach'|'text', optionen: [[wert, label]],
 *   standard: wert oder (ctx) => wert, hinweis }. Optionen dürfen eine Funktion (ctx) sein (z. B. Variantennamen).
 */
export const GF_FRAGEN = Object.freeze([
  { id: 'umfang-bestand', kapitel: '2.1', frage: 'Umfang der Bestandsanalyse', art: 'auswahl',
    optionen: [['auto', 'automatisch nach Gebäudezahl und Neubauanteil'], ['ausfuehrlich', 'ausführlich'], ['kompakt', 'kompakt (Text und Übersicht)']], standard: 'auto',
    hinweis: 'Automatisch kompakt bei höchstens 5 Bestandsgebäuden oder wenn die Neubauten überwiegen.' },
  { id: 'egb', kapitel: '2.2', frage: 'Energiestandard für Neubau und Sanierung (EEFB)', art: 'auswahl',
    optionen: [['auto', 'Neubau EGB 40, Sanierung EGB 55'], ['40', 'durchgängig EGB 40'], ['55', 'durchgängig EGB 55'], ['keiner', 'nicht erwähnen']], standard: 'auto',
    hinweis: 'Fügt einen Satz mit Bezug auf die Energieeffizienzfestlegungen des Bundes (EEFB) in die baulichen Veränderungen ein.' },
  { id: 'reserve', kapitel: '3.2.5', frage: 'Leistungsreserve für die Wärmeerzeugung empfehlen?', art: 'auswahl',
    optionen: [['auto', 'nur bei auffälliger Nutzung'], ['10', 'ja, +10 %'], ['20', 'ja, +20 %'], ['nein', 'nein']], standard: 'auto' },
  ...Object.entries(GF_TECHNIKEN).map(([k, t]) => ({
    id: `pot-${k}`, kapitel: '4', frage: t.titel, art: 'auswahl', optionen: GF_POT_OPTIONEN,
    standard: ctx => (ctx?.inVariante?.[k] ? 'vertieft' : k === 'eis' ? 'weglassen' : 'vertieft'),
    hinweis: k === 'eis' ? 'Vorgabe: nur beschreiben, wenn eine Variante einen Eisspeicher nutzt.' : '',
  })),
  { id: 'pot-fernwaerme', kapitel: '4', frage: 'Fernwärme', art: 'auswahl',
    optionen: [['keinNetz', 'kein Netz in der Nähe'], ['unwirtschaftlich', 'Netz vorhanden, Anschluss unwirtschaftlich'], ['anfrage', 'Anfrage beim Betreiber läuft'], ['weglassen', 'nicht erwähnen']],
    standard: 'keinNetz' },
  { id: 'pot-nicht', kapitel: '4', frage: 'Weitere nicht berücksichtigte Potenziale in 4.1', art: 'mehrfach', optionen: GF_NICHT_PUNKTE,
    standard: GF_NICHT_PUNKTE.map(([k]) => k) },
  { id: 'lwwp-quoten', kapitel: '4', frage: 'Deckungsgrade im Luft-WP-Vergleich (%)', art: 'text', standard: '65, 90, 99, 100',
    hinweis: 'Durch Komma getrennt, z. B. 65, 90, 99, 100.' },
  { id: 'zsb', kapitel: '7', frage: 'Vorgabe Zweistoffbrenner (Spitzenlast/Resilienz)', art: 'auswahl',
    optionen: [['gilt', 'gilt für alle Varianten'], ['gilt-nicht', 'gilt nicht']], standard: 'gilt' },
  { id: 'empfehlung', kapitel: '9.1', frage: 'Empfohlene Variante', art: 'auswahl',
    optionen: ctx => [['auto', 'nach Bewertungsmatrix'], ...(ctx?.varianten || []).map(n => [n, n])], standard: 'auto' },
  { id: 'nt', kapitel: '9.1', frage: 'Niedertemperatur-Ertüchtigung', art: 'auswahl',
    optionen: [['empfehlen', 'ausführlich empfehlen'], ['erwaehnen', 'nur kurz erwähnen'], ['weglassen', 'weglassen']], standard: 'empfehlen' },
]);

const istObjekt = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Antworten bereinigen: nur bekannte Fragen, Text bis 200 Zeichen, Mehrfachauswahl als Liste bekannter Werte. */
export function gfNormalisieren(roh) {
  const out = {};
  if (!istObjekt(roh)) return out;
  for (const f of GF_FRAGEN) {
    const v = roh[f.id];
    if (v === undefined || v === null || v === '') continue;
    if (f.art === 'mehrfach') {
      if (!Array.isArray(v)) continue;
      const erlaubt = new Set(f.optionen.map(o => o[0]));
      out[f.id] = [...new Set(v.map(String).filter(x => erlaubt.has(x)))];
    } else if (f.art === 'text') {
      out[f.id] = String(v).slice(0, 200);
    } else {
      out[f.id] = String(v).slice(0, 120);
    }
  }
  return out;
}

export const gfOptionen = (f, ctx) => (typeof f.optionen === 'function' ? f.optionen(ctx) : f.optionen || []);
export const gfStandard = (f, ctx) => (typeof f.standard === 'function' ? f.standard(ctx) : f.standard);

/** Antwort oder Vorgabe. Unbekannte Auswahlwerte (z. B. gelöschte Variante) fallen auf die Vorgabe zurück. */
export function gfAntwort(antworten, id, ctx = {}) {
  const f = GF_FRAGEN.find(x => x.id === id);
  if (!f) return undefined;
  const v = istObjekt(antworten) ? antworten[id] : undefined;
  if (v === undefined || v === '') return gfStandard(f, ctx);
  if (f.art === 'auswahl' && !gfOptionen(f, ctx).some(o => o[0] === v)) return gfStandard(f, ctx);
  return v;
}

/** Fragen eines Kapitels (Nummer der Standardgliederung). */
export const gfFragenZuKapitel = nr => GF_FRAGEN.filter(f => f.kapitel === nr);

/** Deckungsgrade aus der Textantwort: Zahlen 1–100, aufsteigend, ohne Dubletten; leer → Vorgabe. */
export function gfQuoten(text) {
  const z = [...new Set(String(text || '').split(/[;,\s]+/).map(s => Number(s.replace(',', '.'))).filter(x => x > 0 && x <= 100))].sort((a, b) => a - b);
  return z.length ? z.slice(0, 6) : [65, 90, 99, 100];
}
