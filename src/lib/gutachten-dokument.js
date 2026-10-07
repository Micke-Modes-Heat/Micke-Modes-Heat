// ── lib/gutachten-dokument.js — Dokumentmodell des Gutachten-Editors ──
// DOM- und importfrei, damit es in Vitest direkt prüfbar ist und ein Blatt im
// Importgraph bleibt. Die Oberfläche (21-gutachten-editor.js) und später der
// Word-Export lesen dasselbe Modell.
//
// Aufbau:
//   dok     = { version, kapitel: [kapitel, …], deckblatt, anlagen: [anlage, …] }
//   kapitel = { id, ebene: 1..3, titel, bloecke: [block, …] }
//   block   = { id, typ: 'text',  text }
//           | { id, typ: 'figur', figurId, layout: 'reduziert'|'voll', kennzahlen, unterschrift }
//           | { id, typ: 'bild',  svg, breite, hoehe, unterschrift, einstellungen }
//   anlage  = { id, typ: 'stationssteckbrief', gebaeudeId }
//
// Anlagen stehen hinter dem letzten Kapitel, jede auf einer eigenen Seite, nummeriert
// „Anlage I, II, …" in Listenreihenfolge (wie die Kapitelnummern nie gespeichert). Eine
// Stations-Anlage trägt nur das Gebäude — den Inhalt liest der Editor beim Zeichnen bzw.
// Exportieren live aus dem Netzmodell (lib/stations-steckbrief.js).
//
// 'bild' ist eine fertig gezeichnete, fremd erzeugte Grafik (z. B. der Vektor-Lageplan aus
// 18-liegenschaftsbilder.js) — anders als 'figur' liest sie keine Live-Daten über einen
// Katalogeintrag, sondern trägt ihr SVG-Quelltext-Schnappschuss direkt im Block. `svg` kann
// leer sein ("noch nicht eingerichtet", direkt nach dem Anlegen). `einstellungen` ist ein
// beliebiges, für 21 undurchsichtiges Objekt der Quelle (z. B. lpEinstellungenCapture()) —
// damit lässt sich die Quelle später mit denselben Einstellungen erneut öffnen. Ein erneutes
// „Übernehmen" ersetzt svg/breite/hoehe/einstellungen; sonst merkt sich das Dokument nichts
// über die Quelle.
//
// Die Gliederung ist eine flache Liste mit Ebenen (wie Überschrift 1–3 in Word).
// Kapitelnummern entstehen immer automatisch aus Reihenfolge und Ebene — es wird
// keine Nummer gespeichert, die beim Verschieben veralten könnte.

import { gfNormalisieren } from './gutachten-fragen.js';

export const GUTACHTEN_DOK_VERSION = 1;
export const GUTACHTEN_MAX_EBENE = 3;

/**
 * Standardgliederung = Inhaltsverzeichnis der Word-Vorlage
 * „Gutachten_Energieversorgung_LKEBw.docx" (Stand 09/2026). Die Kapitelnummern
 * der Gutachten-Grafiken (5.1.2, 5.4.2, …) beziehen sich auf diese Gliederung (Version 2, Variante B, seit 10/2026).
 *
 * Elektrotechnik (ab „Elektrotechnik“) folgt seit 09/2026 demselben Aufbau wie die
 * Wärmeversorgung: EIN Ist-Zustand, EINE Bedarfsprognose (Soll), dann Variantenbildung/
 * Wirtschaftlichkeit/Bewertungsmatrix/Empfehlung — statt wie zuvor Ist- und Soll-Zustand
 * als zwei parallele Zweige mit je eigenem Netzanschluss/Stromnetz-intern-Unterkapitel.
 * Ein Kapitel „Analyse möglicher Technologien“ wie in der Wärme gibt es bewusst nicht
 * (Entscheidung 09/2026): im Strom sind Netzanschluss, PV, Speicher, NEA und Ladeinfrastruktur
 * Bausteine, keine Alternativen — entschieden wird über ihre Dimensionierung in der Variantenbildung.
 *
 * Resilienz (Kapitel 8.2, bis 10/2026 5.2) enthält seit 09/2026 immer drei feste Szenarien vom Gebäude über die Station
 * zur Liegenschaft — nur die kritischen Gebäude (Notstromklasse A), je Trafostation eine NEA an der NSHV
 * für die Gebäude A/B und die Gesamtliegenschaft als Insel am NAP (Blackout-Modus, Reiter „Liegenschaft“) —,
 * ihre Gegenüberstellung und allgemeine Empfehlungen (Einspeisepunkte an den Trafostationen u. a.).
 * Bis 30.09.2026 war die Gesamtliegenschaft Szenario 2; der Abgleich zieht die Nummer im Titel nach.
 */
const G = (ebene, titel) => ({ ebene, titel });
export const GUTACHTEN_STANDARD_GLIEDERUNG = [
  G(1, 'Einleitung'), G(2, 'Ziele und Grundsätze'), G(2, 'Liegenschaftsinformationen'),
  G(1, 'Ist-Zustand Wärme'), G(2, 'Baulicher Ist-Zustand'), G(2, 'Bauliche Entwicklung'), G(3, 'Bauliche Veränderungen'), G(3, 'Entwicklung von Wärmebedarf und Heizlast'),
  G(1, 'Wärmeversorgung'),
  G(2, 'Ist-Anlagentechnik'), G(3, 'Erdgasanschluss'), G(3, 'Wärmeversorgungsnetz (WVN)'), G(3, 'Wärmetechnische Hausstation (WH)'),
  G(2, 'Ist- und Soll-Wärmeverbrauch'), G(3, 'Erdgasdaten'), G(3, 'Heizöl-EL-Daten'), G(3, 'Feste Biomasse'), G(3, 'Jahresvergleich der Daten'), G(3, 'Dimensionierung WEA'),
  G(2, 'Soll-Zustand Netz und Hausstationen'), G(3, 'WVN'), G(3, 'WH'),
  G(1, 'Potenzialanalyse'), G(2, 'Nicht berücksichtigte Potenziale'), G(2, 'Berücksichtigte Potenziale'),
  G(1, 'Elektrotechnik'),
  G(2, 'Ist-Zustand'), G(3, 'Liegenschaftsstromnetzanschluss'), G(3, 'Stromnetz intern (MS/NS)'),
  G(3, 'Erzeugungsanlagen'), G(3, 'Notstromversorgung'),
  G(2, 'Stromverbrauchsdaten'),
  G(2, 'Bedarfsprognose Strom (Soll)'), G(3, 'Bestandsbedarf und bauliche Entwicklung'),
  G(3, 'Zusatzbedarf aus Wärmekonzept'), G(3, 'Zusatzbedarf Ladeinfrastruktur'),
  G(3, 'Resultierende Anschlussleistung und Lastgang'),
  G(2, 'Variantenbildung und -vergleich'), G(3, 'Netzanschluss und internes Stromnetz'), G(3, 'PV-Anlage und Batteriespeicher'),
  G(3, 'Notstromversorgung und Lastmanagement'), G(3, 'Ladeinfrastruktur'),
  G(2, 'Wirtschaftlichkeit und Investitionskosten'), G(2, 'Bewertungsmatrix'), G(2, 'Empfehlung Elektrotechnik'),
  G(1, 'Gebäudeautomation (GA)'),
  G(1, 'Variantenvergleich Wärme'), G(2, 'Klimarelevanz'), G(2, 'Wirtschaftlichkeit und Investitionskosten'), G(3, 'Wirtschaftlichkeit mit PV-Eigenstrom'),
  G(2, 'Energiepreissensitivität'), G(2, 'Bewertungsmatrix'), G(2, 'Empfehlung'),
  G(1, 'Maßnahmen zur Steigerung der Resilienz'), G(2, 'Erläuterung Bewertungstool Resilienz'), G(2, 'Bewertung Resilienz'),
  G(3, 'Ist-Zustand'), G(3, 'Szenario 1: Versorgung der kritischen Gebäude'), G(3, 'Szenario 2: Versorgung je Trafostation'),
  G(3, 'Szenario 3: Versorgung der Gesamtliegenschaft'), G(3, 'Gegenüberstellung der Szenarien'), G(3, 'Allgemeine Empfehlungen'),
  G(3, 'Kurzfristige Maßnahmen'), G(3, 'Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)'),
  G(1, 'Fazit, Maßnahmenfahrplan'), G(2, 'Wärmeversorgung'), G(2, 'Elektrotechnik'),
];

/** Version der Standardgliederung: 1 = bis 10/2026 (Wärme komplett in Kapitel 2, Elektro 3), 2 = Variante B. */
export const GUTACHTEN_GLIEDERUNG_VERSION = 2;

/**
 * Gliederung bis 10/2026 (Version 1) — nur noch zum Erkennen und Umstellen älterer Dokumente.
 */
export const GUTACHTEN_GLIEDERUNG_V1 = Object.freeze([
  G(1, 'Einleitung'), G(2, 'Ziele und Grundsätze'), G(2, 'Liegenschaftsinformationen'), G(2, 'Hochbau'), G(3, 'Gebäudebestand (Ist)'), G(3, 'Bauliche Veränderungen'), G(3, 'Entwicklung von Wärmebedarf und Heizlast'),
  G(1, 'Wärmeversorgung'),
  G(2, 'Ist-Zustand Wärme'), G(3, 'Erdgasanschluss'), G(3, 'Wärmeversorgungsnetz (WVN)'), G(3, 'Wärmetechnische Hausstation (WH)'),
  G(3, 'Erdgasdaten'), G(3, 'Heizöl-EL-Daten'), G(3, 'Feste Biomasse'), G(3, 'Jahresvergleich der Daten'),
  G(2, 'Soll-Zustand Wärme'), G(3, 'Dimensionierung WEA'), G(3, 'WVN'), G(3, 'WH'),
  G(2, 'Analyse möglicher Energiequellen und Technologien'), G(3, 'Technologien'),
  G(2, 'Variantenvergleich'), G(2, 'Wirtschaftlichkeit und Investitionskosten'), G(2, 'Bewertungsmatrix'), G(2, 'Empfehlung'),
  G(1, 'Elektrotechnik'),
  G(2, 'Ist-Zustand'), G(3, 'Liegenschaftsstromnetzanschluss'), G(3, 'Stromnetz intern (MS/NS)'),
  G(3, 'Erzeugungsanlagen'), G(3, 'Notstromversorgung'),
  G(2, 'Stromverbrauchsdaten'),
  G(2, 'Bedarfsprognose Strom (Soll)'), G(3, 'Bestandsbedarf und bauliche Entwicklung'),
  G(3, 'Zusatzbedarf aus Wärmekonzept'), G(3, 'Zusatzbedarf Ladeinfrastruktur'),
  G(3, 'Resultierende Anschlussleistung und Lastgang'),
  G(2, 'Variantenbildung und -vergleich'), G(3, 'Netzanschluss und internes Stromnetz'), G(3, 'PV-Anlage und Batteriespeicher'),
  G(3, 'Notstromversorgung und Lastmanagement'), G(3, 'Ladeinfrastruktur'),
  G(2, 'Wirtschaftlichkeit und Investitionskosten'), G(2, 'Bewertungsmatrix'), G(2, 'Empfehlung Elektrotechnik'),
  G(1, 'Gebäudeautomation (GA)'),
  G(1, 'Maßnahmen zur Steigerung der Resilienz'), G(2, 'Erläuterung Bewertungstool Resilienz'), G(2, 'Bewertung Resilienz'),
  G(3, 'Ist-Zustand'), G(3, 'Szenario 1: Versorgung der kritischen Gebäude'), G(3, 'Szenario 2: Versorgung je Trafostation'),
  G(3, 'Szenario 3: Versorgung der Gesamtliegenschaft'), G(3, 'Gegenüberstellung der Szenarien'), G(3, 'Allgemeine Empfehlungen'),
  G(3, 'Kurzfristige Maßnahmen'), G(3, 'Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)'),
  G(1, 'Fazit, Maßnahmenfahrplan'), G(2, 'Wärmeversorgung'), G(2, 'Elektrotechnik'),
]);

/**
 * Kapitelnummer Version 1 → Version 2 (Variante B): Hochbau wird Kapitel 2, Wärme-Ist/-Soll Kapitel 3,
 * die Potenzialanalyse Kapitel 4, Elektrotechnik 5, GA 6, der Variantenvergleich Wärme 7, Resilienz 8, Fazit 9.
 * Elektrotechnik, GA, Resilienz und Fazit behalten ihren Aufbau — nur die erste Ziffer ändert sich.
 */
const V1_ZU_V2 = Object.freeze({
  1: '1', '1.1': '1.1', '1.2': '1.2', '1.3': '2', '1.3.1': '2.1', '1.3.2': '2.2.1', '1.3.3': '2.2.2',
  2: '3', '2.1': '3.1', '2.1.1': '3.1.1', '2.1.2': '3.1.2', '2.1.3': '3.1.3', '2.1.4': '3.2.1', '2.1.5': '3.2.2', '2.1.6': '3.2.3', '2.1.7': '3.2.4',
  '2.2': '3.2', '2.2.1': '3.2.5', '2.2.2': '3.3.1', '2.2.3': '3.3.2',
  '2.3': '4', '2.3.1': '4.2', '2.4': '7', '2.5': '7.2', '2.6': '7.4', '2.7': '7.5',
});
const V1_HAUPT = Object.freeze({ 3: '5', 4: '6', 5: '8', 6: '9' });

/** Kapitelnummer der Gliederung Version 1 in Version 2 („3.4.1“ → „5.4.1“, „2.2“ → „3.2“); unbekannt → unverändert. */
export function gdNummerV1ZuV2(nr) {
  const n = String(nr || '').trim();
  if (V1_ZU_V2[n]) return V1_ZU_V2[n];
  const [kopf, ...rest] = n.split('.');
  if (V1_HAUPT[kopf]) return [V1_HAUPT[kopf], ...rest].join('.');
  return n;
}


/** Deckblattfelder (alles Text); leere Felder füllt der Export aus den Projekt-Stammdaten bzw. den Vorgaben. */
export const GUTACHTEN_DECKBLATT_FELDER = ['liegenschaft', 'ort', 'projekt', 'auftraggeber', 'auftrag', 'aufgestelltDurch', 'aufgestellt', 'standort', 'stand'];
export const GUTACHTEN_DECKBLATT_VORGABEN = {
  auftraggeber: 'Bundesamt für Infrastruktur, Umweltschutz und Dienstleistungen der Bundeswehr',
  aufgestelltDurch: 'Leitstelle Klimaneutrale Energieversorgung der Liegenschaften der Bundeswehr',
};

export function gdNormDeckblatt(d) {
  const quelle = d !== null && typeof d === 'object' && !Array.isArray(d) ? d : {};
  const out = {};
  for (const f of GUTACHTEN_DECKBLATT_FELDER) out[f] = typeof quelle[f] === 'string' ? quelle[f] : '';
  out.ansprechpersonen = [0, 1, 2].map(i => {
    const p = Array.isArray(quelle.ansprechpersonen) ? quelle.ansprechpersonen[i] : null;
    return { name: typeof p?.name === 'string' ? p.name : '', telefon: typeof p?.telefon === 'string' ? p.telefon : '' };
  });
  return out;
}

let _idZaehler = 0;
/** Kurze, sitzungsweit eindeutige ID (nur Buchstaben/Ziffern — landet in data-click-Attributen). */
export function gdId(prefix) {
  _idZaehler++;
  return prefix + Date.now().toString(36) + _idZaehler.toString(36) + Math.random().toString(36).slice(2, 6);
}

const istObjekt = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const alsText = v => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function gdNeuerTextBlock(text = '') {
  return { id: gdId('b'), typ: 'text', text: alsText(text) };
}

export function gdNeuerFigurBlock(figurId) {
  return { id: gdId('b'), typ: 'figur', figurId: alsText(figurId), layout: 'reduziert', kennzahlen: true, unterschrift: '' };
}

/**
 * bild: {svg, breite, hoehe, einstellungen} — SVG-Quelltext-Schnappschuss samt Einstellungen
 * der Quelle. Ohne Argument (frisch angelegt, noch nicht eingerichtet): leeres Bild.
 */
export function gdNeuerBildBlock(bild) {
  return {
    id: gdId('b'), typ: 'bild',
    svg: alsText(bild?.svg),
    breite: Number(bild?.breite) || 0,
    hoehe: Number(bild?.hoehe) || 0,
    unterschrift: '',
    einstellungen: (bild?.einstellungen && istObjekt(bild.einstellungen)) ? bild.einstellungen : null,
  };
}

/** Ebenen so glätten, dass kein Kapitel mehr als eine Ebene tiefer als sein Vorgänger liegt. */
function glaetteEbenen(kapitel) {
  let vorher = 0;
  for (const k of kapitel) {
    const roh = Math.round(Number(k.ebene)) || 1;
    k.ebene = Math.max(1, Math.min(GUTACHTEN_MAX_EBENE, vorher + 1, roh));
    vorher = k.ebene;
  }
}

function normBlock(b, ids) {
  if (!istObjekt(b)) return null;
  let id = alsText(b.id).replace(/[^\w-]/g, '');
  if (!id || ids.has(id)) id = gdId('b');
  ids.add(id);
  if (b.typ === 'text') return { id, typ: 'text', text: alsText(b.text) };
  if (b.typ === 'figur' && alsText(b.figurId)) {
    return {
      id, typ: 'figur', figurId: alsText(b.figurId),
      layout: b.layout === 'voll' ? 'voll' : 'reduziert',
      kennzahlen: b.kennzahlen !== false,
      unterschrift: alsText(b.unterschrift),
    };
  }
  if (b.typ === 'bild') {
    return {
      id, typ: 'bild', svg: alsText(b.svg),
      breite: Number(b.breite) || 0, hoehe: Number(b.hoehe) || 0,
      unterschrift: alsText(b.unterschrift),
      einstellungen: (b.einstellungen && istObjekt(b.einstellungen)) ? b.einstellungen : null,
    };
  }
  return null;
}

/**
 * Gespeichertes Dokument prüfen und bereinigen. Liefert null, wenn keins angelegt ist.
 * Verändert die Eingabe nicht.
 */
export function gdNormalisieren(input) {
  if (!istObjekt(input) || !Array.isArray(input.kapitel)) return null;
  const ids = new Set();
  const kapitel = input.kapitel.filter(istObjekt).map(k => {
    let id = alsText(k.id).replace(/[^\w-]/g, '');
    if (!id || ids.has(id)) id = gdId('k');
    ids.add(id);
    return {
      id,
      ebene: k.ebene,
      titel: alsText(k.titel),
      bloecke: (Array.isArray(k.bloecke) ? k.bloecke : []).map(b => normBlock(b, ids)).filter(Boolean),
    };
  });
  glaetteEbenen(kapitel);
  const tv = Number(input.textVariante);
  const gl = Number(input.gliederung);
  return { version: GUTACHTEN_DOK_VERSION, kapitel, deckblatt: gdNormDeckblatt(input.deckblatt), anlagen: normAnlagen(input.anlagen, ids),
    ...(Number.isInteger(gl) && gl > 1 ? { gliederung: gl } : {}),   // Version der Standardgliederung, nach der das Dokument aufgebaut ist
    ...(istObjekt(input.fragen) && Object.keys(gfNormalisieren(input.fragen)).length ? { fragen: gfNormalisieren(input.fragen) } : {}),   // Fragebogen (lib/gutachten-fragen.js)
    ...(istObjekt(input.platzhalter) && Object.keys(normPlatzhalter(input.platzhalter)).length ? { platzhalter: normPlatzhalter(input.platzhalter) } : {}),   // im Editor ausgefüllte Platzhalter
    ...(istObjekt(input.praesentation) ? { praesentation: normPraesentation(input.praesentation) } : {}),   // Präsentation: Fassung, Folienauswahl, eigene Titel/Stichpunkte
    ...(Number.isInteger(tv) && tv > 0 ? { textVariante: tv } : {}) };   // Formulierungsvariante der Standardtexte (lib/gutachten-einleitung.js)
}

/** Im Editor ausgefüllte Platzhalter { Feldname: Wert } — nur Text, begrenzte Länge und Anzahl. */
function normPlatzhalter(roh) {
  const out = {};
  for (const [k, v] of Object.entries(roh).slice(0, 500)) {
    const name = alsText(k).trim().slice(0, 300), wert = alsText(v).trim().slice(0, 2000);
    if (name && wert) out[name] = wert;
  }
  return out;
}

export const GUTACHTEN_ANLAGEN_TYPEN = ['stationssteckbrief'];

function normAnlagen(liste, ids = new Set()) {
  const gebSchon = new Set();
  return (Array.isArray(liste) ? liste : []).filter(istObjekt).map(a => {
    if (!GUTACHTEN_ANLAGEN_TYPEN.includes(a.typ) || a.gebaeudeId == null || a.gebaeudeId === '') return null;
    const geb = String(a.gebaeudeId);
    if (gebSchon.has(geb)) return null;   // je Station höchstens eine Anlage
    gebSchon.add(geb);
    let id = alsText(a.id).replace(/[^\w-]/g, '');
    if (!id || ids.has(id)) id = gdId('a');
    ids.add(id);
    return { id, typ: a.typ, gebaeudeId: a.gebaeudeId };
  }).filter(Boolean);
}

/** Römische Ziffer (1 → I, 4 → IV, 12 → XII) — Anlagennummern wie in der Vorlage. */
export function gdRoemisch(n) {
  let x = Math.max(0, Math.floor(Number(n) || 0)), out = '';
  for (const [w, z] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) {
    while (x >= w) { out += z; x -= w; }
  }
  return out;
}

/** Präsentation: { fassung, an: {folienKey: bool}, titel: {folienKey: Text}, punkte: {folienKey: Text} } — Schlüssel wie 'fig:<blockId>'. */
function normPraesentation(roh) {
  const schluessel = k => /^(titel|(kap|fig|pkt):[\w-]{1,60})$/.test(k);
  const map = (o, f) => Object.fromEntries(Object.entries(istObjekt(o) ? o : {}).filter(([k]) => schluessel(k)).slice(0, 800).map(([k, v]) => [k, f(v)]).filter(([, v]) => v !== undefined));
  return {
    fassung: roh.fassung === 'lang' ? 'lang' : 'kurz',
    an: map(roh.an, v => (typeof v === 'boolean' ? v : undefined)),
    titel: map(roh.titel, v => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : undefined)),
    punkte: map(roh.punkte, v => (typeof v === 'string' ? v.slice(0, 3000) : undefined)),
  };
}

/** Anlagennummern ("I", "II", …) in Listenreihenfolge. */
export function gdAnlagenNummern(anlagen) {
  return (anlagen || []).map((_, i) => gdRoemisch(i + 1));
}

/**
 * Stations-Steckbriefe für die übergebenen Gebäude anlegen, soweit noch keiner existiert.
 * Neue kommen hinter den letzten vorhandenen Steckbrief (sonst ans Ende), in der Reihenfolge von
 * gebaeudeIds. Ergebnis: die neu angelegten Anlagen.
 */
export function gdStationsAnlagenErgaenzen(dok, gebaeudeIds = []) {
  if (!Array.isArray(dok.anlagen)) dok.anlagen = [];
  const vorhanden = new Set(dok.anlagen.filter(a => a.typ === 'stationssteckbrief').map(a => String(a.gebaeudeId)));
  const neu = [];
  for (const g of gebaeudeIds) {
    if (g == null || vorhanden.has(String(g))) continue;
    vorhanden.add(String(g));
    neu.push({ id: gdId('a'), typ: 'stationssteckbrief', gebaeudeId: g });
  }
  let pos = dok.anlagen.length;
  for (let i = dok.anlagen.length - 1; i >= 0; i--) if (dok.anlagen[i].typ === 'stationssteckbrief') { pos = i + 1; break; }
  dok.anlagen.splice(pos, 0, ...neu);
  return neu;
}

export function gdAnlageLoeschen(dok, id) {
  const i = (dok.anlagen || []).findIndex(a => a.id === id);
  if (i < 0) return false;
  dok.anlagen.splice(i, 1);
  return true;
}

export function gdAnlageVerschieben(dok, id, richtung) {
  const L = dok.anlagen || [];
  const i = L.findIndex(a => a.id === id);
  const j = i + (richtung < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= L.length) return false;
  [L[i], L[j]] = [L[j], L[i]];
  return true;
}

/** Automatische Kapitelnummern ("1", "1.2", "3.1.2") in Listenreihenfolge. */
export function gdKapitelNummern(kapitel) {
  const zaehler = new Array(GUTACHTEN_MAX_EBENE).fill(0);
  return kapitel.map(k => {
    const e = k.ebene;
    zaehler[e - 1]++;
    for (let i = e; i < zaehler.length; i++) zaehler[i] = 0;
    return zaehler.slice(0, e).join('.');
  });
}

/** Position eines Katalogeintrags im Kapitel: `reihe`, sonst Text vor Abbildung. */
const katalogRang = f => (Number.isFinite(f.reihe) ? f.reihe : f.istText ? 0 : 1000);
/**
 * Kapiteltitel vergleichbar machen: Groß-/Kleinschreibung, Leerzeichen und ein angehängter
 * Klammerzusatz zählen nicht — „Zusatzbedarf aus Wärmekonzept (Übernahme aus 3.8)“ in einem
 * älteren Dokument trifft so weiter „Zusatzbedarf aus Wärmekonzept“ der Standardgliederung.
 */
const titelSchluessel = t => ohneSzenarioNr(alsText(t).replace(/\s*\([^()]*\)\s*$/, '')).toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * „Szenario 2: Versorgung …“ → „Versorgung …“. Die Szenarien in 5.2 wurden umsortiert; ein Kapitel
 * findet sein Gegenstück deshalb unabhängig von der Nummer, und der Abgleich zieht nur die Nummer nach.
 */
const SZENARIO_NR = /^\s*Szenario\s+\d+\s*:\s*/i;
function ohneSzenarioNr(t) { return String(t).replace(SZENARIO_NR, ''); }
/** Kapitelnummer vorn im Katalog-Kapitel ("3.3.1 Bestandsbedarf …" → "3.3.1"). */
const katalogNummer = f => (alsText(f.kapitel).match(/^\d+(\.\d+)*/) || [''])[0];

/** Flache Kapitelliste als Baum { kinder: [{ k, kinder }] } — die Liste selbst bleibt unverändert. */
function kapitelBaum(kapitel) {
  const wurzel = { kinder: [] };
  const stapel = [{ ebene: 0, knoten: wurzel }];
  for (const k of kapitel) {
    while (stapel[stapel.length - 1].ebene >= k.ebene) stapel.pop();
    const knoten = { k, kinder: [] };
    stapel[stapel.length - 1].knoten.kinder.push(knoten);
    stapel.push({ ebene: k.ebene, knoten });
  }
  return wurzel;
}

/**
 * Neues Dokument aus der Standardgliederung. Figuren aus dem Katalog
 * ({id, kapitel: '3.2 Stromverbrauchsdaten', istText, reihe}) landen in dem Kapitel mit
 * derselben Nummer — Textbausteine vor den Abbildungen. Eine optionale `reihe`
 * (Zahl) legt die Position im Kapitel ausdrücklich fest, damit sich Texte und
 * Abbildungen abwechseln können; ohne `reihe` zählt ein Text als 0, eine Abbildung als 1000.
 */
export function gdStandardDokument(katalog = []) {
  const kapitel = GUTACHTEN_STANDARD_GLIEDERUNG.map(k => ({ id: gdId('k'), ebene: k.ebene, titel: k.titel, bloecke: [] }));
  const nummern = gdKapitelNummern(kapitel);
  const nichtZugeordnet = [];
  const reihenfolge = [...katalog].sort((a, b) => katalogRang(a) - katalogRang(b));   // stabil: gleicher Rang behält die Katalogreihenfolge
  for (const f of reihenfolge) {
    const nr = katalogNummer(f);
    const idx = nr ? nummern.indexOf(nr) : -1;
    if (idx < 0) { nichtZugeordnet.push(f.id); continue; }
    kapitel[idx].bloecke.push(gdNeuerFigurBlock(f.id));
  }
  return { dok: { version: GUTACHTEN_DOK_VERSION, gliederung: GUTACHTEN_GLIEDERUNG_VERSION, kapitel, deckblatt: gdNormDeckblatt(), anlagen: [] }, nichtZugeordnet };
}

/**
 * Bestehendes Dokument mit der aktuellen Standardgliederung abgleichen — nur ergänzen, nie ändern.
 *
 * Kapitel werden über ihren Titel zugeordnet, und zwar nur unter demselben Oberkapitel: so
 * bleiben gleichnamige Kapitel verschiedener Teile („Wirtschaftlichkeit …“ bei Wärme und Strom)
 * auseinander. Ein fehlendes Kapitel kommt samt Unterkapiteln hinter das zuletzt zugeordnete
 * Geschwister — bestehende Kapitel werden dabei nie umgehängt, umbenannt oder gelöscht.
 * Katalogeinträge, die noch nirgends im Dokument stehen, landen in dem Kapitel, das ihrer
 * Standard-Kapitelnummer entspricht, vor der ersten Abbildung mit höherem Rang (`reihe`).
 *
 * Ergebnis: { dok, neueKapitel: [{id, nr, titel}], neueBloecke: [{figurId, kapitelId, nr}],
 *   nichtZugeordnet: [figurId], fremdeKapitel: [{id, nr, titel}], umbenannt: [{id, nr, von, nach}] } —
 * fremdeKapitel sind die obersten Kapitel ohne Gegenstück in der Standardgliederung (z. B. aus einer
 * älteren Vorlage); umbenannt sind Szenario-Kapitel, deren Nummer der Standard vorgibt.
 * Die Eingabe bleibt unverändert.
 */
export function gdMitStandardAbgleichen(dok, katalog = [], standard = GUTACHTEN_STANDARD_GLIEDERUNG) {
  const basis = gdNormalisieren(dok) || { version: GUTACHTEN_DOK_VERSION, kapitel: [], deckblatt: gdNormDeckblatt(), anlagen: [] };
  const std = standard.map((s, idx) => ({ ebene: s.ebene, titel: s.titel, idx }));
  const stdNummern = gdKapitelNummern(std);
  const dokBaum = kapitelBaum(basis.kapitel);
  const zuordnung = new Map();   // Standard-Index → Kapitel im Ergebnis
  const getroffen = new Set();   // Kapitel mit Gegenstück (auch die neu angelegten)
  const neuIds = new Set();
  const umbenannt = [];

  const abgleichen = (sKnoten, dKnoten, ebene) => {
    let pos = 0;   // hinter dem zuletzt zugeordneten Geschwister einfügen
    for (const sk of sKnoten.kinder) {
      const schluessel = titelSchluessel(sk.k.titel);
      const idx = schluessel
        ? dKnoten.kinder.findIndex(dk => !getroffen.has(dk.k) && titelSchluessel(dk.k.titel) === schluessel)
        : -1;
      let ziel;
      if (idx >= 0) {
        ziel = dKnoten.kinder[idx];
        pos = Math.max(pos, idx + 1);
        // Einzige Ausnahme vom „nie umbenennen“: die Szenario-Nummer folgt der Standardgliederung
        const stdNr = sk.k.titel.match(SZENARIO_NR)?.[0];
        if (stdNr && SZENARIO_NR.test(ziel.k.titel)) {
          const neu = ziel.k.titel.replace(SZENARIO_NR, stdNr);
          if (neu !== ziel.k.titel) { umbenannt.push({ id: ziel.k.id, von: ziel.k.titel, nach: neu }); ziel.k.titel = neu; }
        }
      } else {
        ziel = { k: { id: gdId('k'), ebene, titel: sk.k.titel, bloecke: [] }, kinder: [] };
        dKnoten.kinder.splice(pos++, 0, ziel);
        neuIds.add(ziel.k.id);
      }
      getroffen.add(ziel.k);
      zuordnung.set(sk.k.idx, ziel.k);
      abgleichen(sk, ziel, ebene + 1);
    }
  };
  abgleichen(kapitelBaum(std), dokBaum, 1);

  const kapitel = [];
  const fremdOben = [];
  const flach = (knoten, ebene, elternGetroffen) => {
    for (const c of knoten.kinder) {
      c.k.ebene = ebene;
      kapitel.push(c.k);
      const hat = getroffen.has(c.k);
      if (!hat && elternGetroffen) fremdOben.push(c.k);
      flach(c, ebene + 1, hat);
    }
  };
  flach(dokBaum, 1, true);

  const nummern = gdKapitelNummern(kapitel);
  const nrVon = new Map(kapitel.map((k, i) => [k.id, nummern[i]]));
  const rangVon = new Map(katalog.map(f => [f.id, katalogRang(f)]));
  const imDok = gdFigurIds({ kapitel });
  const neueBloecke = [], nichtZugeordnet = [];
  for (const f of [...katalog].sort((a, b) => katalogRang(a) - katalogRang(b))) {
    if (imDok.has(f.id)) continue;
    const nr = katalogNummer(f);
    const kap = nr ? zuordnung.get(stdNummern.indexOf(nr)) : null;
    if (!kap) { nichtZugeordnet.push(f.id); continue; }
    const rang = katalogRang(f);
    const pos = kap.bloecke.findIndex(b => b.typ === 'figur' && rangVon.has(b.figurId) && rangVon.get(b.figurId) > rang);
    const block = gdNeuerFigurBlock(f.id);
    if (pos < 0) kap.bloecke.push(block); else kap.bloecke.splice(pos, 0, block);
    neueBloecke.push({ figurId: f.id, kapitelId: kap.id, nr: nrVon.get(kap.id) });
  }

  const eintrag = k => ({ id: k.id, nr: nrVon.get(k.id), titel: k.titel });
  return {
    dok: { ...basis, kapitel },
    neueKapitel: kapitel.filter(k => neuIds.has(k.id)).map(eintrag),
    neueBloecke,
    nichtZugeordnet,
    fremdeKapitel: fremdOben.map(eintrag),
    umbenannt: umbenannt.map(u => ({ ...u, nr: nrVon.get(u.id) })),
  };
}

export function gdLeeresDokument() {
  return { version: GUTACHTEN_DOK_VERSION, gliederung: GUTACHTEN_GLIEDERUNG_VERSION, kapitel: [{ id: gdId('k'), ebene: 1, titel: '', bloecke: [] }], deckblatt: gdNormDeckblatt(), anlagen: [] };
}

/** Index-Bereich [start, ende) eines Kapitels samt aller Unterkapitel. */
export function gdTeilbaum(kapitel, idx) {
  const e = kapitel[idx].ebene;
  let ende = idx + 1;
  while (ende < kapitel.length && kapitel[ende].ebene > e) ende++;
  return [idx, ende];
}

const kapIndex = (dok, kapId) => dok.kapitel.findIndex(k => k.id === kapId);

/**
 * Kapitel samt Unterkapiteln hinter das Ende des Teilbaums von `nachKapId`
 * einfügen — als Geschwister (gleiche Ebene) oder als letztes Unterkapitel.
 * Ohne `nachKapId` wird ein Hauptkapitel ans Ende angehängt.
 */
export function gdKapitelEinfuegen(dok, nachKapId, { unter = false, titel = '' } = {}) {
  const L = dok.kapitel;
  const idx = nachKapId ? kapIndex(dok, nachKapId) : -1;
  let ebene = 1, pos = L.length;
  if (idx >= 0) {
    ebene = Math.min(GUTACHTEN_MAX_EBENE, L[idx].ebene + (unter ? 1 : 0));
    pos = gdTeilbaum(L, idx)[1];
  }
  const neu = { id: gdId('k'), ebene, titel: alsText(titel), bloecke: [] };
  L.splice(pos, 0, neu);
  glaetteEbenen(L);
  return neu;
}

/** Kapitel entfernen; seine Unterkapitel rücken eine Ebene hoch, statt mit gelöscht zu werden. */
export function gdKapitelLoeschen(dok, kapId) {
  const L = dok.kapitel;
  const idx = kapIndex(dok, kapId);
  if (idx < 0) return false;
  const [, ende] = gdTeilbaum(L, idx);
  for (let i = idx + 1; i < ende; i++) L[i].ebene = Math.max(1, L[i].ebene - 1);
  L.splice(idx, 1);
  glaetteEbenen(L);
  return true;
}

/** Kapitel samt Unterkapiteln mit dem vorigen/nächsten Geschwister tauschen. */
export function gdKapitelVerschieben(dok, kapId, richtung) {
  const L = dok.kapitel;
  const idx = kapIndex(dok, kapId);
  if (idx < 0) return false;
  const e = L[idx].ebene;
  const [a, b] = gdTeilbaum(L, idx);
  if (richtung < 0) {
    let k = a - 1;
    while (k >= 0 && L[k].ebene > e) k--;
    if (k < 0 || L[k].ebene < e) return false;
    const teil = L.splice(a, b - a);
    L.splice(k, 0, ...teil);
    return true;
  }
  if (b >= L.length || L[b].ebene !== e) return false;
  const [, b2] = gdTeilbaum(L, b);
  const teil = L.splice(a, b - a);
  L.splice(b2 - (b - a), 0, ...teil);
  return true;
}

/** Ebene eines Kapitels samt Unterkapiteln um ±1 ändern — nur, wenn die Gliederung gültig bleibt. */
export function gdKapitelEbene(dok, kapId, delta) {
  const L = dok.kapitel;
  const idx = kapIndex(dok, kapId);
  if (idx < 0 || !delta) return false;
  const [a, b] = gdTeilbaum(L, idx);
  if (delta > 0) {
    if (idx === 0 || L[idx].ebene > L[idx - 1].ebene) return false;
    for (let i = a; i < b; i++) if (L[i].ebene + 1 > GUTACHTEN_MAX_EBENE) return false;
  } else if (L[idx].ebene <= 1) {
    return false;
  }
  const d = delta > 0 ? 1 : -1;
  for (let i = a; i < b; i++) L[i].ebene += d;
  glaetteEbenen(L);
  return true;
}

/** Position eines Blocks: {kapIdx, blockIdx} oder null. */
export function gdFindeBlock(dok, blockId) {
  for (let k = 0; k < dok.kapitel.length; k++) {
    const i = dok.kapitel[k].bloecke.findIndex(b => b.id === blockId);
    if (i >= 0) return { kapIdx: k, blockIdx: i };
  }
  return null;
}

/** Block am Ende eines Kapitels (oder direkt hinter `nachBlockId`) einfügen. */
export function gdBlockEinfuegen(dok, kapId, block, nachBlockId = null) {
  const kap = dok.kapitel[kapIndex(dok, kapId)];
  if (!kap) return false;
  const i = nachBlockId ? kap.bloecke.findIndex(b => b.id === nachBlockId) : -1;
  kap.bloecke.splice(i >= 0 ? i + 1 : kap.bloecke.length, 0, block);
  return true;
}

export function gdBlockLoeschen(dok, blockId) {
  const pos = gdFindeBlock(dok, blockId);
  if (!pos) return false;
  dok.kapitel[pos.kapIdx].bloecke.splice(pos.blockIdx, 1);
  return true;
}

/**
 * Block um eine Position verschieben. Am Kapitelanfang/-ende wandert er ins
 * vorige Kapitel (ans Ende) bzw. ins nächste (an den Anfang).
 */
export function gdBlockVerschieben(dok, blockId, richtung) {
  const pos = gdFindeBlock(dok, blockId);
  if (!pos) return false;
  const liste = dok.kapitel[pos.kapIdx].bloecke;
  const [block] = liste.splice(pos.blockIdx, 1);
  if (richtung < 0) {
    if (pos.blockIdx > 0) { liste.splice(pos.blockIdx - 1, 0, block); return true; }
    if (pos.kapIdx > 0) { dok.kapitel[pos.kapIdx - 1].bloecke.push(block); return true; }
  } else {
    if (pos.blockIdx < liste.length) { liste.splice(pos.blockIdx + 1, 0, block); return true; }
    if (pos.kapIdx < dok.kapitel.length - 1) { dok.kapitel[pos.kapIdx + 1].bloecke.unshift(block); return true; }
  }
  liste.splice(pos.blockIdx, 0, block);   // schon ganz oben/unten — nichts ändern
  return false;
}

/**
 * Fortlaufende Abbildungs- und Tabellennummern. `artenVon(block)` liefert je
 * Teil eines Blocks 'Abbildung', 'Tabelle' oder null (kein Beschriftungsobjekt,
 * z. B. Fließtext) — gilt nur für 'figur'-Blöcke. 'bild'-Blöcke zählen immer als
 * eine Abbildung. Ergebnis: Map blockId → [{art, nr} | null, …].
 */
export function gdBeschriftungen(dok, artenVon) {
  const zaehler = { Abbildung: 0, Tabelle: 0 };
  const out = new Map();
  for (const k of dok.kapitel) {
    for (const b of k.bloecke) {
      const arten = b.typ === 'figur' ? (artenVon(b) || []) : b.typ === 'bild' ? ['Abbildung'] : [];
      out.set(b.id, arten.map(art => (art in zaehler ? { art, nr: ++zaehler[art] } : null)));
    }
  }
  return out;
}

/** Figuren-IDs, die schon als Block im Dokument stehen. */
export function gdFigurIds(dok) {
  const ids = new Set();
  for (const k of dok?.kapitel || []) for (const b of k.bloecke) if (b.typ === 'figur') ids.add(b.figurId);
  return ids;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Umstellung älterer Dokumente auf die Gliederung Version 2 (Variante B)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Kapitel eines Dokuments den Kapiteln der Gliederung Version 1 zuordnen: zuerst Titel unter demselben (bereits
 * zugeordneten) Oberkapitel — so bleiben gleichnamige Kapitel wie „Wirtschaftlichkeit …“ bei Wärme und Strom
 * auseinander, auch wenn eigene Kapitel die Nummern verschoben haben —, sonst ein im Ganzen eindeutiger Titel.
 */
function v1Zuordnung(kapitel) {
  const n1 = gdKapitelNummern(GUTACHTEN_GLIEDERUNG_V1);
  const eltern = nr => nr.split('.').slice(0, -1).join('.');
  const v1 = GUTACHTEN_GLIEDERUNG_V1.map((k, i) => ({ nr: n1[i], eltern: eltern(n1[i]), schluessel: titelSchluessel(k.titel) }));
  const vergeben = new Set();
  const stapel = [];   // [{ ebene, nr (V1 oder null) }]
  return kapitel.map(k => {
    while (stapel.length && stapel[stapel.length - 1].ebene >= k.ebene) stapel.pop();
    const oben = stapel.length ? stapel[stapel.length - 1].nr : '';
    const s = titelSchluessel(k.titel);
    const frei = x => x.schluessel === s && !vergeben.has(x.nr);
    let t = oben !== null ? v1.find(x => frei(x) && x.eltern === oben) : null;
    if (!t) {
      const kand = v1.filter(frei);
      if (kand.length === 1) t = kand[0];
    }
    if (t) vergeben.add(t.nr);
    stapel.push({ ebene: k.ebene, nr: t ? t.nr : null });
    return t ? t.nr : null;
  });
}

/**
 * Nach welcher Gliederung ist das Dokument aufgebaut? 2 = aktuell (gespeichert oder ohne Merkmale der alten
 * Gliederung), 1 = ältere Gliederung (mindestens fünf Kapitel stimmen in Nummer und Titel mit Version 1 überein,
 * darunter „Wärmeversorgung“ als Kapitel 2).
 */
export function gdGliederungVersion(dok) {
  if (!dok || !Array.isArray(dok.kapitel)) return GUTACHTEN_GLIEDERUNG_VERSION;
  if (Number(dok.gliederung) >= 2) return Number(dok.gliederung);
  const nr = gdKapitelNummern(dok.kapitel);
  const n1 = gdKapitelNummern(GUTACHTEN_GLIEDERUNG_V1);
  const treffer = dok.kapitel.filter((k, i) => {
    const j = n1.indexOf(nr[i]);
    return j >= 0 && titelSchluessel(GUTACHTEN_GLIEDERUNG_V1[j].titel) === titelSchluessel(k.titel);
  }).length;
  const waerme2 = dok.kapitel.some((k, i) => nr[i] === '2' && titelSchluessel(k.titel) === 'wärmeversorgung');
  return treffer >= 5 && waerme2 ? 1 : GUTACHTEN_GLIEDERUNG_VERSION;
}

/**
 * Dokument der Gliederung Version 1 auf Version 2 umstellen — ohne Inhalte zu verlieren:
 * - Jedes Kapitel der alten Standardgliederung wandert mit allen Blöcken (Freitexte, Lagepläne, Einstellungen)
 *   in sein Gegenstück der neuen Gliederung (gdNummerV1ZuV2); Titel folgen der neuen Gliederung.
 * - Bausteine aus dem Katalog, die im alten Kapitel an ihrem Standardplatz standen, kommen in ihr neues
 *   Kapitel, sofern es im selben Hauptkapitel liegt (z. B. Klimarelevanz 7.1 statt 7).
 * - Eigene Kapitel (ohne Gegenstück) bleiben samt Unterkapiteln hinter dem Kapitel, dem sie vorher folgten.
 * Ergebnis: { dok, verschoben: [{von, nach, titel}], eigene: [titel], bausteine: Zahl }
 */
export function gdGliederungUmstellen(dok, katalog = []) {
  const basis = gdNormalisieren(dok);
  if (!basis) return null;
  const n2 = gdKapitelNummern(GUTACHTEN_STANDARD_GLIEDERUNG);
  const neu = GUTACHTEN_STANDARD_GLIEDERUNG.map((k, i) => ({ k: { id: gdId('k'), ebene: k.ebene, titel: k.titel, bloecke: [] }, nr: n2[i], nachher: [] }));
  const nachNr = new Map(neu.map(x => [x.nr, x]));
  const katalogNr = new Map(katalog.map(f => [f.id, katalogNummer(f)]));
  const zuordnung = v1Zuordnung(basis.kapitel);
  const nrAlt = gdKapitelNummern(basis.kapitel);
  const verschoben = [], eigene = [];
  let bausteine = 0;
  let letztes = neu[0], eigeneBasis = null;
  basis.kapitel.forEach((k, i) => {
    const v1 = zuordnung[i];
    const ziel = v1 ? nachNr.get(gdNummerV1ZuV2(v1)) : null;
    if (ziel) {
      if (!ziel.idUebernommen) { ziel.k.id = k.id; ziel.idUebernommen = true; }
      const haupt = ziel.nr.split('.')[0];
      for (const b of k.bloecke) {
        const kn = b.typ === 'figur' ? katalogNr.get(b.figurId) : null;
        const kz = kn && kn !== ziel.nr && kn.split('.')[0] === haupt ? nachNr.get(kn) : null;
        (kz || ziel).k.bloecke.push(b);
        if (kz) bausteine++;
      }
      if (nrAlt[i] !== ziel.nr) verschoben.push({ von: nrAlt[i], nach: ziel.nr, titel: ziel.k.titel });
      letztes = ziel; eigeneBasis = null;
    } else {
      // eigenes Kapitel: relativ zum zuletzt zugeordneten Kapitel einhängen, Unterkapitel behalten ihren Abstand
      if (!eigeneBasis) eigeneBasis = { altEbene: k.ebene, ebene: Math.max(1, Math.min(GUTACHTEN_MAX_EBENE, k.ebene, letztes.k.ebene + 1)) };
      const ebene = Math.max(1, Math.min(GUTACHTEN_MAX_EBENE, eigeneBasis.ebene + k.ebene - eigeneBasis.altEbene));
      letztes.nachher.push({ ...k, ebene });
      eigene.push(k.titel || '[ohne Titel]');
    }
  });
  // Eigene Kapitel stehen hinter dem Teilbaum ihres Bezugskapitels
  neu.forEach((x, i) => {
    let ende = i + 1;
    while (ende < neu.length && neu[ende].k.ebene > x.k.ebene) ende++;
    x.ende = ende;
  });
  const ergebnis = [];
  const offen = [];
  neu.forEach((x, i) => {
    ergebnis.push(x.k);
    if (x.nachher.length) offen.push({ ende: x.ende, liste: x.nachher });
    for (let j = offen.length - 1; j >= 0; j--) {
      if (offen[j].ende === i + 1) { ergebnis.push(...offen[j].liste); offen.splice(j, 1); }
    }
  });
  for (const o of offen) ergebnis.push(...o.liste);
  glaetteEbenen(ergebnis);
  return { dok: { ...basis, gliederung: GUTACHTEN_GLIEDERUNG_VERSION, kapitel: ergebnis }, verschoben, eigene, bausteine };
}

/**
 * Automatische Querverweise (C5): Nummer jedes Standardkapitels → seine aktuelle Nummer im Dokument. Zugeordnet wird
 * wie beim Abgleich über den Titel unter demselben Oberkapitel; Kapitel, die der Gutachter verschoben hat, behalten
 * so ihren Verweis. Fehlt ein Kapitel, bleibt die Nummer unverändert (kein Eintrag). Nur für Dokumente der aktuellen Gliederung.
 */
export function gdVerweisNummern(dok) {
  const m = new Map();
  if (!dok || !Array.isArray(dok.kapitel) || gdGliederungVersion(dok) < GUTACHTEN_GLIEDERUNG_VERSION) return m;
  const std = GUTACHTEN_STANDARD_GLIEDERUNG.map((s, idx) => ({ ebene: s.ebene, titel: s.titel, idx }));
  const stdNr = gdKapitelNummern(std), dokNr = gdKapitelNummern(dok.kapitel);
  const dokIdx = new Map(dok.kapitel.map((k, i) => [k, i]));
  const vergeben = new Set();
  const zuordnen = (sKnoten, dKnoten) => {
    for (const sk of sKnoten.kinder) {
      const s = titelSchluessel(sk.k.titel);
      const ziel = dKnoten?.kinder.find(dk => !vergeben.has(dk.k) && titelSchluessel(dk.k.titel) === s) || null;
      if (ziel) { vergeben.add(ziel.k); m.set(stdNr[sk.k.idx], dokNr[dokIdx.get(ziel.k)]); }
      zuordnen(sk, ziel);
    }
  };
  zuordnen(kapitelBaum(std), kapitelBaum(dok.kapitel));
  return m;
}

/** Kapitelnummern in einem Text über die Verweistabelle umschreiben („Kapitel 3.2“, „Kapiteln 5.3.1 bis 5.3.3“, „vgl. Kapitel 7“). */
export function gdVerweiseErsetzen(text, nrMap) {
  if (!nrMap || !nrMap.size) return text;
  const neu = n => nrMap.get(n) || n;
  return String(text).replace(/\b(Kapiteln?|Kap\.)(\s+)(\d+(?:\.\d+)*)(?![\d.]*\d)((\s*(?:–|-|bis|und|sowie)\s*)(\d+(?:\.\d+)*))?/g,
    (all, wort, ws, a, rest, verb, b) => `${wort}${ws}${neu(a)}${rest ? verb + neu(b) : ''}`);
}
