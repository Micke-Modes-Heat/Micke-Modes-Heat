// ── lib/gutachten-dokument.js — Dokumentmodell des Gutachten-Editors ──
// DOM- und importfrei, damit es in Vitest direkt prüfbar ist und ein Blatt im
// Importgraph bleibt. Die Oberfläche (21-gutachten-editor.js) und später der
// Word-Export lesen dasselbe Modell.
//
// Aufbau:
//   dok     = { version, kapitel: [kapitel, …] }
//   kapitel = { id, ebene: 1..3, titel, bloecke: [block, …] }
//   block   = { id, typ: 'text',  text }
//           | { id, typ: 'figur', figurId, layout: 'reduziert'|'voll', kennzahlen, unterschrift }
//           | { id, typ: 'bild',  svg, breite, hoehe, unterschrift, einstellungen }
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

export const GUTACHTEN_DOK_VERSION = 1;
export const GUTACHTEN_MAX_EBENE = 3;

/**
 * Standardgliederung = Inhaltsverzeichnis der Word-Vorlage
 * „Gutachten_Energieversorgung_LKEBw.docx" (Stand 09/2026). Die Kapitelnummern
 * der Gutachten-Grafiken (3.1.2, 3.5.2, …) beziehen sich auf diese Gliederung.
 *
 * Elektrotechnik (ab „Elektrotechnik“) folgt seit 09/2026 demselben Aufbau wie die
 * Wärmeversorgung: EIN Ist-Zustand, EINE Bedarfsprognose (Soll), dann Analyse/
 * Variantenbildung/Wirtschaftlichkeit/Bewertungsmatrix/Empfehlung — statt wie zuvor
 * Ist- und Soll-Zustand als zwei parallele Zweige mit je eigenem Netzanschluss/
 * Stromnetz-intern-Unterkapitel.
 */
const G = (ebene, titel) => ({ ebene, titel });
export const GUTACHTEN_STANDARD_GLIEDERUNG = [
  G(1, 'Einleitung'), G(2, 'Ziele und Grundsätze'), G(2, 'Liegenschaftsinformationen'), G(2, 'Hochbau'),
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
  G(3, 'Zusatzbedarf aus Wärmekonzept (Übernahme aus 3.8)'), G(3, 'Zusatzbedarf Ladeinfrastruktur'),
  G(3, 'Resultierende Anschlussleistung und Lastgang'),
  G(2, 'Analyse möglicher Technologien'),
  G(2, 'Variantenbildung und -vergleich'), G(3, 'Netzanschluss und internes Stromnetz'), G(3, 'PV-Anlage und Batteriespeicher'),
  G(3, 'Notstromversorgung und Lastmanagement'), G(3, 'Ladeinfrastruktur'),
  G(2, 'Wirtschaftlichkeit und Investitionskosten'), G(2, 'Bewertungsmatrix'), G(2, 'Empfehlung Elektrotechnik'),
  G(1, 'Gebäudeautomation (GA)'),
  G(1, 'Maßnahmen zur Steigerung der Resilienz'), G(2, 'Erläuterung Bewertungstool Resilienz'), G(2, 'Bewertung Resilienz'),
  G(3, 'Ist-Zustand'), G(3, 'Kurzfristige Maßnahmen'), G(3, 'Langfristige Maßnahmen (Umsetzung der Empfehlung im Gutachten)'),
  G(1, 'Fazit, Maßnahmenfahrplan'), G(2, 'Wärmeversorgung'), G(2, 'Elektrotechnik'),
];

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
  return { version: GUTACHTEN_DOK_VERSION, kapitel, deckblatt: gdNormDeckblatt(input.deckblatt) };
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
  const rang = f => (Number.isFinite(f.reihe) ? f.reihe : f.istText ? 0 : 1000);
  const reihenfolge = [...katalog].sort((a, b) => rang(a) - rang(b));   // stabil: gleicher Rang behält die Katalogreihenfolge
  for (const f of reihenfolge) {
    const nr = (alsText(f.kapitel).match(/^\d+(\.\d+)*/) || [''])[0];
    const idx = nr ? nummern.indexOf(nr) : -1;
    if (idx < 0) { nichtZugeordnet.push(f.id); continue; }
    kapitel[idx].bloecke.push(gdNeuerFigurBlock(f.id));
  }
  return { dok: { version: GUTACHTEN_DOK_VERSION, kapitel, deckblatt: gdNormDeckblatt() }, nichtZugeordnet };
}

export function gdLeeresDokument() {
  return { version: GUTACHTEN_DOK_VERSION, kapitel: [{ id: gdId('k'), ebene: 1, titel: '', bloecke: [] }], deckblatt: gdNormDeckblatt() };
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
