// ── lib/resilienz-app.js — Erhebungs-Werkzeug als verschickbare HTML-Datei ──
//
// Alternative zur Abfragedatei (.xlsx): Das Hauptwerkzeug erzeugt eine einzelne
// HTML-Datei mit dem Lageplan der Liegenschaft. Der Betreiber öffnet sie im
// Browser, wird in sechs Schritten durch die Erhebung geführt, beschreibt die
// Funktionen direkt an den Gebäuden und sieht die Einordnung auf dem Plan.
// Gespeichert wird wieder dieselbe HTML-Datei mit eingebettetem Stand — sie
// lässt sich weiterbearbeiten und wird zurückgeschickt. Das Hauptwerkzeug liest
// sie mit raLesenErhebung() (lib/resilienz-abfrage.js) wie eine Abfragedatei.
//
// Die Oberfläche selbst liegt in src/resilienz-app/ (vorlage.html + app.js,
// ein Skript ohne Imports). Dieses Modul setzt die Teile zusammen; es ist
// DOM-frei und unit-testbar.

import {
  RA_SZENARIEN, RA_LISTEN, RA_KLASSEN, RA_KLASSEN_KEYS, RA_FUNKTION_SPALTEN, RA_FUNKTION_VORLAGEN, RA_KATALOG,
  RA_ALLGEMEIN_FELDER, RA_BESTAND_FELDER, RA_RUECKMELDUNG_FELDER, RA_ERHEBUNG_KENNUNG,
  raVorbelegung, raKategorieVorbelegung, raText,
} from './resilienz-abfrage.js';

/** Platzhalter in src/resilienz-app/vorlage.html. */
export const RA_APP_PLATZHALTER = Object.freeze({
  titel:  '__RA_TITEL__',
  konfig: '__RA_KONFIG__',
  stand:  '__RA_STAND__',
  app:    '/*__RA_APP__*/',
});

/** Kennung des eingebetteten Stands — daran erkennt das Einlesen die Datei. */
export const RA_APP_STAND_ID = 'ra-stand';

/**
 * Was die Oberfläche an festen Listen und Texten braucht. Kommt aus
 * lib/resilienz-abfrage.js, damit Datei und Werkzeug dieselben Begriffe führen.
 */
export function raErhebungKonfig() {
  const titel = Object.fromEntries(RA_FUNKTION_SPALTEN.map(s => [s.feld, s.titel]));
  return {
    kennung: RA_ERHEBUNG_KENNUNG,
    szenarien: RA_SZENARIEN,
    listen: RA_LISTEN,
    klassen: RA_KLASSEN_KEYS.map(k => RA_KLASSEN[k]),
    vorlagen: RA_FUNKTION_VORLAGEN.map(v => v.name),
    katalog: RA_KATALOG,
    titel,
    allgemein: RA_ALLGEMEIN_FELDER,
    bestand: RA_BESTAND_FELDER,
    rueckmeldung: RA_RUECKMELDUNG_FELDER,
  };
}

const _r6 = v => Math.round(Number(v) * 1e6) / 1e6;

/** Gebäudeumriss als [[lat, lng], …] — akzeptiert {lat,lng} und [lat,lng]. */
function _umriss(polygon) {
  if (!Array.isArray(polygon)) return null;
  const pts = polygon
    .map(p => (Array.isArray(p) ? [p[0], p[1]] : [p?.lat, p?.lng]))
    .filter(([a, b]) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)))
    .map(([a, b]) => [_r6(a), _r6(b)]);
  return pts.length >= 3 ? pts : null;
}

/** Zufällige Kennung, damit Zwischenstände verschiedener Erhebungen im Browser getrennt bleiben. */
function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Anfangsstand einer neuen Erhebung.
 * @param {object} opt
 * @param {object} [opt.meta]      lieg, stand, stelle, bearb, empfaenger, ansprechpartner
 * @param {Array<{id:any,name?:string,nutzung?:string,polygon?:Array}>} [opt.gebaeude]
 * @param {string} [opt.uid]       feste Kennung (Tests)
 */
export function raErhebungStart(opt = {}) {
  const meta = { ...(opt.meta || {}) };
  const geb = Array.isArray(opt.gebaeude) ? opt.gebaeude.filter(Boolean) : [];
  // raVorbelegung legt je Gebäude genau eine Zeile an, in derselben Reihenfolge.
  // Gebäudearten (Kategorien) gibt es im Werkzeug nicht — gleichartige Gebäude
  // bekommen ihre Angaben per Übertragen bzw. aus dem Beispielkatalog. Die
  // Betriebszeit, die sonst in der Kategorie stünde, kommt darum in die Zeile.
  const betriebNach = new Map(raKategorieVorbelegung(geb).map(k => [k.kategorie, k.betrieb]));
  const funktionen = raVorbelegung(geb).map(({ kategorie, ...f }, i) => ({
    ...f, betrieb: f.betrieb || betriebNach.get(kategorie) || '',
    gebId: i < geb.length ? geb[i].id ?? null : null, sz: {},
  }));
  const allgemein = {};
  for (const f of RA_ALLGEMEIN_FELDER) if (raText(meta[f.feld])) allgemein[f.feld] = raText(meta[f.feld]);
  return {
    kennung: RA_ERHEBUNG_KENNUNG,
    uid: opt.uid || _uid(),
    meta: {
      lieg: raText(meta.lieg), stand: raText(meta.stand), stelle: raText(meta.stelle),
      empfaenger: raText(meta.empfaenger), ansprechpartner: raText(meta.ansprechpartner),
    },
    gebaeude: geb.map(g => ({
      id: g.id ?? null,
      name: raText(g.name) || (g.id != null ? `Gebäude ${g.id}` : ''),
      nutzung: raText(g.nutzung),
      umriss: _umriss(g.polygon),
    })),
    allgemein,
    szenarien: RA_SZENARIEN.map(s => ({ id: s.id, relevant: '', dauer: '', herkunft: '', bem: '' })),
    kategorien: [],
    funktionen,
    bestand: {},
    rueckmeldung: {},
    gespeichert: null,
  };
}

/** JSON so serialisieren, dass es in einem <script>-Element nichts beenden kann. */
export function raJsonFuerSkript(wert) {
  return JSON.stringify(wert)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const _escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Die verschickbare HTML-Datei zusammensetzen.
 * @param {object} teile
 * @param {string} teile.vorlage   Inhalt von src/resilienz-app/vorlage.html
 * @param {string} teile.app       Inhalt von src/resilienz-app/app.js
 * @param {object} teile.stand     raErhebungStart() oder ein gespeicherter Stand
 */
export function raErhebungHtml({ vorlage, app, stand }) {
  const P = RA_APP_PLATZHALTER;
  for (const p of Object.values(P)) {
    if (!String(vorlage || '').includes(p)) throw new Error(`Vorlage des Erhebungs-Werkzeugs: Platzhalter ${p} fehlt.`);
  }
  const titel = `Resilienz-Erhebung${stand?.meta?.lieg ? ' – ' + stand.meta.lieg : ''}`;
  // Ersetzen mit Funktion: „$" im Inhalt darf nicht als Muster gelesen werden.
  return vorlage
    .replace(P.app, () => String(app || '').replace(/<\/script/gi, '<\\/script'))
    .replace(P.titel, () => _escHtml(titel))
    .replace(P.konfig, () => raJsonFuerSkript(raErhebungKonfig()))
    .replace(P.stand, () => raJsonFuerSkript(stand));
}

/**
 * Den eingebetteten Stand aus einer gespeicherten Erhebungsdatei holen.
 * @returns {object|null}  null, wenn die Datei keinen Stand enthält
 */
export function raErhebungAusHtml(text) {
  // „<\/" statt „</": dieses Modul steht im Single-File-Build selbst in einem <script>.
  const m = new RegExp(`<script[^>]*\\bid=["']${RA_APP_STAND_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i').exec(String(text || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Dateiname der Erhebungsdatei. */
export function raErhebungDateiname(meta) {
  const datum = (meta?.stand && /^\d{4}-\d{2}-\d{2}$/.test(meta.stand))
    ? meta.stand : new Date().toISOString().slice(0, 10);
  const lieg = raText(meta?.lieg).replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `Resilienzerhebung_${lieg ? lieg + '_' : ''}${datum}.html`;
}
