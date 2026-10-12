// @ts-check
// ── lib/lade-status.js — Ablauf „Plangebiet zeichnen → Bereich laden" ────────
//
// Der Gebäudeimport (03b-netz.js loadOsmBuildings) läuft in bis zu zehn
// Schritten, die bisher nur nacheinander als Hinweiszeile unten auf der Karte
// auftauchten. Dieses Modul hält sie als eine Schrittliste mit Zustand, damit
// die Übersicht (42-lade-status.js) jederzeit zeigt, was geladen ist, was
// gerade lädt und was noch kommt — rein, ohne DOM, damit testbar.
//
// Zustände: offen → laeuft → fertig | leer | fehler; uebersprungen steht
// entweder von Anfang an fest (nicht gewählt, keine Quelle) oder ergibt sich
// im Lauf (OSM nicht nötig, weil das Kataster geliefert hat).

/** @typedef {'offen'|'laeuft'|'fertig'|'leer'|'uebersprungen'|'fehler'} LsZustand */
/**
 * @typedef {Object} LsSchritt
 * @property {string} id
 * @property {string} titel
 * @property {LsZustand} zustand
 * @property {string} info      Status- bzw. Ergebnistext
 * @property {number|null} start
 * @property {number|null} ende
 * @property {string[]} unter   Unterzeilen (z. B. je Overpass-Server)
 */

/** Zustände, in denen ein Schritt nichts mehr tut. */
export const LS_ENDE = Object.freeze(['fertig', 'leer', 'uebersprungen', 'fehler']);

export const LS_BL_NAMEN = Object.freeze({
  bw: 'Baden-Württemberg', by: 'Bayern', be: 'Berlin', bb: 'Brandenburg', hb: 'Bremen',
  hh: 'Hamburg', he: 'Hessen', mv: 'Mecklenburg-Vorpommern', ni: 'Niedersachsen',
  nw: 'Nordrhein-Westfalen', rp: 'Rheinland-Pfalz', sl: 'Saarland', sn: 'Sachsen',
  st: 'Sachsen-Anhalt', sh: 'Schleswig-Holstein', th: 'Thüringen',
});

/** Baujahr-Quellen je Bundesland (03b-netz.js _enrichBaujahrFromSources). */
const BAUJAHR_QUELLE = { hh: 'Hamburg KWP', nw: 'NRW Energieatlas' };

const _schritt = (id, titel, zustand = 'offen', info = '') =>
  /** @type {LsSchritt} */ ({ id, titel, zustand, info, start: null, ende: null, unter: [] });

/**
 * Fläche eines Rings aus {lat,lng} in m² (lokal eben; genügt für die Anzeige).
 * @param {{lat:number,lng:number}[]|null|undefined} ring
 */
export function lsFlaecheM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const R = 6371000, k = Math.PI / 180, cos = Math.cos(ring[0].lat * k);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j].lng * cos) * ring[i].lat - (ring[i].lng * cos) * ring[j].lat;
  }
  return Math.abs(a / 2) * (R * k) * (R * k);
}

/** „0,8 ha" / „2.400 m²" */
export function lsFlaecheText(m2) {
  if (!(m2 > 0)) return '';
  if (m2 >= 10000) return `${(m2 / 10000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} ha`;
  return `${Math.round(m2).toLocaleString('de-DE')} m²`;
}

/** „8 s" / „1:05 min" */
export function lsDauerText(ms) {
  if (!(ms >= 0)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
}

/**
 * Text für den Schritt „Plangebiet" aus dem Zeichenzustand.
 * @param {{zeichnet?:boolean, punkte?:number, ring?:{lat:number,lng:number}[]|null}} g
 * @returns {{zustand:LsZustand, info:string}}
 */
export function lsGebietStand(g) {
  if (g.ring && g.ring.length >= 3) {
    return { zustand: 'fertig', info: `${g.ring.length} Eckpunkte · ${lsFlaecheText(lsFlaecheM2(g.ring))}` };
  }
  if (g.zeichnet) {
    const n = g.punkte || 0;
    return {
      zustand: 'laeuft',
      info: n === 0 ? 'Ersten Eckpunkt auf die Karte setzen'
        : n < 3 ? `${n} Eckpunkt${n === 1 ? '' : 'e'} gesetzt — mindestens 3 nötig`
          : `${n} Eckpunkte gesetzt — Startpunkt anklicken zum Abschließen`,
    };
  }
  return { zustand: 'offen', info: 'Noch nicht gezeichnet — sonst wird der Kartenausschnitt geladen' };
}

/**
 * Schrittliste für einen Import aufstellen.
 * @param {{
 *   gebiet: {zeichnet?:boolean, punkte?:number, ring?:{lat:number,lng:number}[]|null},
 *   bl: string|null,           // Bundesland-Schlüssel oder null (Ausland)
 *   kataster: boolean,         // gibt es einen WFS-Dienst für das Land?
 *   optionen: {dach?:boolean, strassen?:boolean, sparte?:string, baeume?:boolean},
 * }} o
 * @returns {LsSchritt[]}
 */
export function lsPlan(o) {
  const blName = o.bl ? (LS_BL_NAMEN[o.bl] || o.bl.toUpperCase()) : 'Ausland';
  const opt = o.optionen || {};
  const g = lsGebietStand(o.gebiet || {});
  const gebiet = _schritt('gebiet', 'Plangebiet', g.zustand, g.info);
  if (g.zustand === 'offen') { gebiet.zustand = 'uebersprungen'; gebiet.info = 'Kein Plangebiet — Kartenausschnitt wird geladen'; }

  const kataster = o.kataster
    ? _schritt('kataster', 'Gebäude · Kataster (ALKIS)', 'offen', `Amtliche Grundrisse ${blName}`)
    : _schritt('kataster', 'Gebäude · Kataster (ALKIS)', 'uebersprungen', o.bl ? `Kein freier Dienst für ${blName}` : 'Außerhalb Deutschlands');
  const osm = _schritt('osm', 'Gebäude · OpenStreetMap', 'offen',
    o.kataster ? 'Nur, falls das Kataster nichts liefert' : 'Overpass-Server, schnellste Antwort gewinnt');

  const bjQuelle = o.bl ? BAUJAHR_QUELLE[o.bl] : null;
  const sparte = opt.sparte === 'beide' ? 'Wärme + Elektro' : opt.sparte === 'waerme' ? 'Wärme' : 'Elektro';
  return [
    gebiet,
    kataster,
    osm,
    _schritt('klein', 'Kleinbauten bereinigen'),
    bjQuelle
      ? _schritt('baujahr', `Baujahr · ${bjQuelle}`)
      : _schritt('baujahr', 'Baujahr ergänzen', 'uebersprungen', `Keine Quelle für ${blName} — Standard-Baujahr`),
    _schritt('einfuegen', 'Gebäude auf die Karte'),
    _schritt('dachform', 'Dachformen · OpenStreetMap', 'offen', 'Nur für Kataster-Grundrisse (ohne Dachform)'),
    opt.dach ? _schritt('dach', 'Dachflächen aus Grundriss') : _schritt('dach', 'Dachflächen aus Grundriss', 'uebersprungen', 'Nicht gewählt'),
    opt.strassen ? _schritt('strassen', `Straßen als Trassen · ${sparte}`) : _schritt('strassen', 'Straßen als Trassen', 'uebersprungen', 'Nicht gewählt'),
    opt.baeume ? _schritt('baeume', 'Bäume · 150 m Umkreis') : _schritt('baeume', 'Bäume · 150 m Umkreis', 'uebersprungen', 'Nicht gewählt'),
  ];
}

/**
 * Zustand eines Schritts setzen (verändert die Liste). Ein Fehler bleibt stehen,
 * bis der Schritt neu startet — ein nachgeschobenes „fertig"/„leer" des
 * Aufrufers überschreibt die genauere Fehlermeldung des Laders nicht.
 * „Übersprungen" steht im Lauf fest (z. B. keine Baujahr-Quelle für das Land);
 * nur die Vorschau setzt es auf „offen" zurück.
 * @param {LsSchritt[]} schritte
 * @param {string} id
 * @param {LsZustand} zustand
 * @param {string} [info]
 * @param {number} [jetzt]
 * @returns {LsSchritt|null}
 */
export function lsSetze(schritte, id, zustand, info, jetzt = Date.now()) {
  const s = schritte.find(x => x.id === id);
  if (!s) return null;
  if (s.zustand === 'fehler' && zustand !== 'laeuft') return s;
  if (s.zustand === 'uebersprungen' && zustand !== 'offen') return s;
  if (zustand === 'laeuft') { s.start = jetzt; s.ende = null; s.unter = []; }
  else if (LS_ENDE.includes(zustand)) { if (s.start != null) s.ende = jetzt; s.unter = []; }
  s.zustand = zustand;
  if (info != null) s.info = info;
  return s;
}

/** Zuletzt gestarteter, noch laufender Schritt. */
export function lsAktiv(schritte) {
  let best = null;
  for (const s of schritte) if (s.zustand === 'laeuft' && (!best || (s.start || 0) >= (best.start || 0))) best = s;
  return best;
}

/**
 * Alle noch offenen Schritte abschließen (Abbruch oder „keine Gebäude").
 * @param {LsSchritt[]} schritte
 * @param {string} info
 */
export function lsRestUeberspringen(schritte, info, jetzt = Date.now()) {
  for (const s of schritte) if (s.zustand === 'offen') lsSetze(schritte, s.id, 'uebersprungen', info, jetzt);
}

/**
 * Überblick für Kopfzeile und Kurzstatus.
 * @param {LsSchritt[]} schritte
 */
export function lsZusammenfassung(schritte) {
  const z = { gesamt: 0, fertig: 0, laeuft: 0, offen: 0, fehler: 0, leer: 0, uebersprungen: 0 };
  for (const s of schritte) { z[s.zustand]++; if (s.zustand !== 'uebersprungen') z.gesamt++; }
  const aktiv = lsAktiv(schritte);
  const erledigt = z.fertig + z.leer + z.fehler;
  /** @type {'bereit'|'laeuft'|'fertig'|'fehler'} */
  let phase;
  if (z.laeuft) phase = 'laeuft';
  else if (z.offen) phase = 'bereit';
  else phase = z.fehler ? 'fehler' : 'fertig';
  return { ...z, erledigt, aktiv, phase };
}
