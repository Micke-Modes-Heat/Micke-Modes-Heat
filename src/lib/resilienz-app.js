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
  RA_ROLLEN, RA_KRITISCH, RA_ALLGEMEIN_SCHLANK, RA_BEISPIEL_SCHLANK, raAuswAusKritisch,
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
    // schlanke Fassung (stand.variante === 'schlank')
    allgemeinSchlank: RA_ALLGEMEIN_SCHLANK,
    rollen: RA_ROLLEN,
    kritisch: RA_KRITISCH,
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
 * @param {'schlank'} [opt.variante] schlanke Fassung: nur Auswirkungs-Fragen (Betreiber)
 *                                  und gekennzeichnete Auftraggeber-Punkte, keine Technik
 */
export function raErhebungStart(opt = {}) {
  const meta = { ...(opt.meta || {}) };
  const geb = Array.isArray(opt.gebaeude) ? opt.gebaeude.filter(Boolean) : [];
  // raVorbelegung legt je Gebäude genau eine Zeile an, in derselben Reihenfolge.
  // Gebäudearten (Kategorien) gibt es im Werkzeug nicht — gleichartige Gebäude
  // bekommen ihre Angaben per Übertragen bzw. aus dem Beispielkatalog. Die
  // Betriebszeit, die sonst in der Kategorie stünde, kommt darum in die Zeile.
  const betriebNach = new Map(raKategorieVorbelegung(geb).map(k => [k.kategorie, k.betrieb]));
  const schlank = opt.variante === 'schlank';
  const funktionen = raVorbelegung(geb).map(({ kategorie, ...f }, i) => ({
    ...f, betrieb: schlank ? '' : f.betrieb || betriebNach.get(kategorie) || '',
    gebId: i < geb.length ? geb[i].id ?? null : null, sz: {},
  }));
  const allgemein = {};
  for (const f of RA_ALLGEMEIN_FELDER) if (raText(meta[f.feld])) allgemein[f.feld] = raText(meta[f.feld]);
  return {
    kennung: RA_ERHEBUNG_KENNUNG,
    ...(schlank ? { variante: 'schlank' } : {}),
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
    szenarien: RA_SZENARIEN.map(s => ({ id: s.id, relevant: '', dauer: '', ...(schlank ? { bereich: '', bereiche: '' } : {}),
      herkunft: '', bem: '' })),
    kategorien: [],
    funktionen,
    bestand: {},
    rueckmeldung: {},
    gespeichert: null,
  };
}

// ── Beispiel der schlanken Fassung ───────────────────────────────────────────
// Lageplan der erfundenen Musterkaserne Ulm, passend zu RA_BEISPIEL_SCHLANK in
// lib/resilienz-abfrage.js. Die Umrisse sind echte Gebäude aus OpenStreetMap
// (Ulm, Oberer Eselsberg; © OpenStreetMap-Mitwirkende, ODbL) — Namen und
// Nutzungen sind frei erfunden.
const _G = (name, nutzung, umriss) => Object.freeze({ name, nutzung, umriss });
export const RA_BEISPIEL_SCHLANK_GEBAEUDE = Object.freeze([
  _G("Geb. 1 Stabsgebäude", "verwaltung", [[48.423929,9.955254],[48.423673,9.955474],[48.423729,9.955624],[48.423743,9.955661],[48.423998,9.955438],[48.42407,9.955624],[48.423711,9.955926],[48.423633,9.955714],[48.423505,9.955374],[48.423862,9.955072]]),
  _G("Geb. 2 Wache", "polizei", [[48.42401,9.954937],[48.423913,9.955017],[48.423989,9.955229],[48.424086,9.955149]]),
  _G("Geb. 3 Sanitätsbereich", "rettungswache", [[48.424524,9.95684],[48.424312,9.957021],[48.424257,9.957065],[48.424203,9.95692],[48.424109,9.956664],[48.424256,9.95654],[48.424374,9.956442],[48.42441,9.956537],[48.424439,9.956513],[48.424516,9.95672],[48.424488,9.956745]]),
  _G("Geb. 4 Truppenküche", "kantine", [[48.422032,9.955587],[48.421944,9.955551],[48.421942,9.955567],[48.421815,9.955514],[48.42182,9.955614],[48.421767,9.955591],[48.421712,9.955567],[48.421664,9.95562],[48.421583,9.955438],[48.421548,9.955455],[48.421555,9.955237],[48.421518,9.955183],[48.421665,9.954936],[48.42172,9.955089],[48.421831,9.954996],[48.421841,9.955023],[48.421865,9.955091],[48.422068,9.955176],[48.42206,9.955219],[48.422081,9.955275],[48.422093,9.955306],[48.422076,9.955319],[48.422033,9.955355],[48.422053,9.95541],[48.422087,9.955402],[48.422084,9.955421],[48.422064,9.955439],[48.422087,9.955504],[48.422098,9.955495],[48.422114,9.955538],[48.422103,9.955547],[48.422108,9.955562],[48.422223,9.955877],[48.422205,9.955892],[48.422159,9.955931],[48.422084,9.955727],[48.422049,9.955635]]),
  _G("Geb. 10 Unterkunft", "unterkunft", [[48.425431,9.961406],[48.425621,9.961249],[48.425551,9.961058],[48.425356,9.961219],[48.425267,9.960975],[48.425137,9.961082],[48.425224,9.96132],[48.425085,9.961434],[48.425157,9.961633],[48.425187,9.961608],[48.425301,9.961515],[48.425432,9.961876],[48.425563,9.961768]]),
  _G("Geb. 11 Unterkunft", "unterkunft", [[48.425151,9.962625],[48.425093,9.962673],[48.425077,9.96264],[48.425035,9.96267],[48.4251,9.96285],[48.425058,9.96289],[48.425009,9.962776],[48.424888,9.962889],[48.424959,9.963069],[48.425037,9.963015],[48.425065,9.963078],[48.424969,9.963162],[48.424945,9.963181],[48.42497,9.963248],[48.424993,9.963229],[48.425024,9.963314],[48.42528,9.9631],[48.425315,9.963073]]),
  _G("Geb. 12 Unterkunft", "unterkunft", [[48.425268,9.963344],[48.425296,9.963415],[48.425323,9.9634],[48.425338,9.963441],[48.425382,9.963483],[48.425415,9.963557],[48.42539,9.96359],[48.425422,9.963669],[48.425468,9.963791],[48.425173,9.964045],[48.425145,9.963969],[48.425102,9.964013],[48.425054,9.963895],[48.425328,9.96366],[48.425293,9.963566],[48.424927,9.963874],[48.424885,9.963769],[48.424926,9.963732],[48.424899,9.963665],[48.42499,9.963586]]),
  _G("Geb. 13 Unterkunft", "unterkunft", [[48.425701,9.963243],[48.425689,9.963211],[48.42566,9.963239],[48.425605,9.963239],[48.425563,9.963271],[48.425523,9.963316],[48.425512,9.963362],[48.425478,9.963399],[48.425431,9.963444],[48.4256,9.963869],[48.425717,9.963767],[48.425592,9.963444],[48.425648,9.963395],[48.425804,9.963801],[48.425937,9.963684],[48.425754,9.963209]]),
  _G("Geb. 14 Unterkunft", "unterkunft", [[48.426104,9.962689],[48.425792,9.962947],[48.425814,9.963021],[48.425789,9.963053],[48.425811,9.963085],[48.42581,9.963138],[48.42581,9.963183],[48.425841,9.963181],[48.425942,9.963439],[48.426234,9.963186],[48.426162,9.963008],[48.425924,9.96321],[48.425887,9.963112],[48.426172,9.962872]]),
  _G("Geb. 15 Unterkunft", "unterkunft", [[48.425123,9.962102],[48.425047,9.962168],[48.425077,9.962234],[48.425077,9.96228],[48.42514,9.962404],[48.425284,9.96228],[48.425362,9.96222],[48.425364,9.96219],[48.425362,9.962168],[48.425355,9.962122],[48.425351,9.9621],[48.425337,9.962056],[48.425323,9.96202],[48.425301,9.962006],[48.425288,9.961989],[48.425276,9.961977],[48.425229,9.961977],[48.425221,9.961957],[48.4252,9.961956],[48.425176,9.961959],[48.42516,9.961965],[48.425141,9.961975],[48.42513,9.961982],[48.425113,9.961996],[48.425099,9.962012],[48.425082,9.962035],[48.42507,9.962057],[48.425058,9.962083],[48.425074,9.962122],[48.425114,9.962083]]),
  _G("Geb. 16 Unterkunft", "unterkunft", [[48.425499,9.962137],[48.425727,9.961949],[48.425848,9.962282],[48.425621,9.96247]]),
  _G("Geb. 17 Unterkunft", "unterkunft", [[48.424757,9.961365],[48.424918,9.961225],[48.425019,9.961489],[48.425079,9.961644],[48.425084,9.961657],[48.425035,9.961699],[48.42503,9.961686],[48.42498,9.961725],[48.424918,9.961784],[48.42478,9.961425],[48.424771,9.961434],[48.424748,9.961373]]),
  _G("Geb. 30 Werkhalle", "werkstatt", [[48.422357,9.956105],[48.422296,9.95594],[48.422241,9.955987],[48.422205,9.955892],[48.422223,9.955877],[48.422108,9.955562],[48.422103,9.955547],[48.422114,9.955538],[48.422098,9.955495],[48.422087,9.955504],[48.422064,9.955439],[48.422084,9.955421],[48.422087,9.955402],[48.422053,9.95541],[48.422033,9.955355],[48.422076,9.955319],[48.422093,9.955306],[48.422081,9.955275],[48.422116,9.955246],[48.422115,9.955243],[48.422257,9.955124],[48.422319,9.955286],[48.422335,9.955326],[48.42235,9.955314],[48.422348,9.95531],[48.42237,9.955291],[48.422377,9.955286],[48.422386,9.955241],[48.422374,9.955236],[48.422403,9.955077],[48.422407,9.95506],[48.422437,9.955036],[48.422443,9.955054],[48.42245,9.955049],[48.422543,9.955296],[48.422552,9.955321],[48.422562,9.955313],[48.42257,9.955333],[48.422642,9.955528],[48.422633,9.955538],[48.422641,9.955557],[48.422698,9.955541],[48.422748,9.955676],[48.422757,9.955698],[48.422687,9.955799],[48.422665,9.955784],[48.422641,9.955768],[48.422601,9.955782],[48.422614,9.955819],[48.422548,9.955916],[48.422553,9.955929],[48.422555,9.955935],[48.422526,9.955959],[48.422533,9.955976],[48.422498,9.956006],[48.42243,9.956063],[48.422421,9.95607],[48.422416,9.956055]]),
  _G("Geb. 31 Werkhalle", "werkstatt", [[48.422913,9.956288],[48.422928,9.95633],[48.422934,9.956346],[48.422967,9.956432],[48.423135,9.956289],[48.423197,9.956456],[48.423339,9.956335],[48.423397,9.956286],[48.423308,9.956047],[48.423302,9.956032],[48.42347,9.955889],[48.42346,9.955865],[48.423422,9.955762],[48.423391,9.955679],[48.423327,9.955509],[48.42316,9.955651],[48.423096,9.955479],[48.42304,9.955527],[48.42301,9.955553],[48.422954,9.9556],[48.422915,9.955633],[48.422906,9.955641],[48.422897,9.955649],[48.422992,9.955905],[48.423007,9.955946],[48.423024,9.95599],[48.422855,9.956133],[48.42286,9.956146]]),
  _G("Geb. 32 Werkhalle", "werkstatt", [[48.423245,9.954909],[48.423307,9.954856],[48.423433,9.955197],[48.423575,9.955078],[48.42357,9.955065],[48.423574,9.955062],[48.423579,9.955074],[48.423637,9.955025],[48.423589,9.954894],[48.423526,9.954947],[48.42348,9.954822],[48.423538,9.954773],[48.423705,9.954633],[48.423694,9.954605],[48.423625,9.954419],[48.423609,9.954374],[48.42375,9.954255],[48.423563,9.953749],[48.423422,9.953867],[48.423407,9.953826],[48.423397,9.953834],[48.423274,9.953938],[48.423321,9.954065],[48.423283,9.954096],[48.423289,9.95411],[48.423336,9.954237],[48.423158,9.954386],[48.423136,9.954404],[48.423225,9.954644],[48.423165,9.954694],[48.423213,9.954822]]),
  _G("Geb. 40 Heizzentrale", "technik", [[48.421665,9.954634],[48.42185,9.954472],[48.421886,9.954565],[48.421701,9.954727]]),
  _G("Geb. 41 Lager", "lager", [[48.425557,9.959239],[48.425621,9.959408],[48.425342,9.959645],[48.425279,9.959476]]),
]);

/** Ausgefüllter Stand der schlanken Erhebung — das Beispiel als HTML-Werkzeug. */
export function raErhebungBeispielSchlank() {
  const B = RA_BEISPIEL_SCHLANK;
  const geb = RA_BEISPIEL_SCHLANK_GEBAEUDE.map((g, i) => ({ id: i + 1, name: g.name, nutzung: g.nutzung, polygon: g.umriss }));
  const st = raErhebungStart({
    meta: { lieg: B.allgemein.lieg, stand: B.allgemein.stand, stelle: B.allgemein.stelle,
      empfaenger: 'Standortverwaltung Musterstadt', ansprechpartner: 'Beispiel — Name, Dienststelle, Telefon, E-Mail' },
    gebaeude: geb, variante: 'schlank', uid: 'beispiel-schlank',
  });
  const idNach = new Map(geb.map(g => [g.name, g.id]));
  st.allgemein = { ...B.allgemein };
  st.szenarien = B.szenarien.map(s => ({ ...s }));
  st.funktionen = B.funktionen.map(({ autarkie, ...f }) => ({
    ...f, ...raAuswAusKritisch(f.kritisch), autarkie_text: autarkie, gebId: idNach.get(f.geb) ?? null, sz: {},
  }));
  st.rueckmeldung = { ...B.rueckmeldung };
  return st;
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
  const titel = `Resilienz-Erhebung${stand?.variante === 'schlank' ? ' (schlank)' : ''}${stand?.meta?.lieg ? ' – ' + stand.meta.lieg : ''}`;
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
export function raErhebungDateiname(meta, variante) {
  const datum = (meta?.stand && /^\d{4}-\d{2}-\d{2}$/.test(meta.stand))
    ? meta.stand : new Date().toISOString().slice(0, 10);
  const lieg = raText(meta?.lieg).replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `Resilienzerhebung_${variante === 'schlank' ? 'schlank_' : ''}${lieg ? lieg + '_' : ''}${datum}.html`;
}
