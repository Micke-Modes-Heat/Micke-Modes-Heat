// ── 25-pv-modus.js — PV-Modus: Dachflächen direkt auf der Karte planen ──────
//
// Der Weg zu einer Dachfläche führte bisher über fünf Ebenen: Gebäudeliste →
// Karte aufklappen → Elektro-Assets → Dach & PV → „Flächen zeichnen" →
// „+ Belegungsfläche" (03c-gebaeude-io.js). Nach jeder Fläche endete der
// Zeichenmodus und man begann von vorn — bei 50 Gebäuden der Zeitfresser.
//
// Der PV-Modus dreht das um: ein Werkzeug, das anbleibt. Klick auf ein Dach =
// erste Ecke der Fläche, Startpunkt erneut klicken = fertig, nächstes Dach.
// Die fertige Fläche gehört dem Gebäude, auf dem sie LIEGT (pvModusZuordnen),
// nicht dem, das vorher ausgewählt war.
//
// Für die Masse gibt es zwei Abkürzungen, die das Zeichnen ganz ersetzen:
//   • „Grundriss übernehmen" — bei Schrägdächern ist die Dachfläche der
//     Grundriss (das Tool projiziert ihn mit 1/cos(Neigung) und teilt ihn am
//     First). Einzeln oder als Stapel für die in der Gebäudeliste ausgewählten
//     Gebäude; die Auswahl ist bewusst die Grenze, sonst bekämen Garagen und
//     Schuppen ungefragt eine Anlage.
//   • Rechteck-Werkzeug — zwei Klicks, am First ausgerichtet. Freihändige
//     Vierecke sind nie rechtwinklig, darin geht das Modulraster schlechter auf.
//
// Der Modus rechnet nichts selbst. Modulplatzierung, kWp, Profile und Assets
// bleiben in 03c-gebaeude-io.js; hier stehen Bedienung und Zuordnung. Was das
// Panel anfasst, ruft dieselben Handler wie die Gebäudekarte.

import { beginInteraction, cancelInteraction } from './lib/interaction-state.js';
import { ensureSatellite, map } from './02b-gebaeude.js';
import { polygonCenter, polygonAreaM2, forwardClickToMap, updateViz } from './02c-karte-werkzeuge.js';
import {
  _hasBelegung, calcGebKwp, calcGebKwpKorr, getGebPvModules, pvNettoFlaeche,
  getDachDefaultNeigung, detectRoofAzimutFromPolygon, setPvVisible, escHtml, flyTo,
  attachGebPvLayer, redrawGebPvModules, _clipPolyHalfPlane, _polyCentroidLL,
} from './03c-gebaeude-io.js';
import { getAssetsForBuilding, deleteAsset } from './13a-assets-core.js';

const PANEL_ID    = 'pv-modus-panel';
const INTERAKTION = 'pv-modus';
const DACHFORMEN  = { flach: 'Flachdach', sattel: 'Satteldach', walm: 'Walmdach', pult: 'Pultdach' };
const GELB = '#ffd54f';
const ROT  = '#e53935';

let _stoppt = false;
/** @type {((e:KeyboardEvent)=>void)|null} */
let _tastenHandler = null;
/** Rückgängig-Stapel: je Eintrag die in einem Schritt entstandenen Flächen. */
let _verlauf = [];
/**
 * kWp der PV-Assets VOR dem laufenden Schritt (null = es gab keins). Muss vor
 * dem Zeichnen erfasst werden: `finishGebPvDraw` legt über
 * `_autoCreatePvAssetFromDraw` selbst ein Asset an, danach ist nicht mehr
 * erkennbar, ob es zum Schritt gehört — und Strg+Z ließe es stehen.
 * @type {Map<number, number|null>}
 */
let _assetStand = new Map();

function _assetStandErfassen() {
  _assetStand = new Map();
  for (const g of (window.gebaeude || [])) {
    const pv = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
    _assetStand.set(g.id, pv ? (parseFloat(pv.props?.leistungKWp) || 0) : null);
  }
}

/** @returns {number|null|undefined} undefined = unbekannt (Asset unangetastet lassen) */
const _assetVorher = gId => (_assetStand.has(gId) ? _assetStand.get(gId) : undefined);

const _name = g => g?.name || ('Gebäude ' + g?.id);
const _geb  = gId => (window.gebaeude || []).find(x => x.id === gId) || null;
const _mitPolygon = () => (window.gebaeude || []).filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3);

function _vorgabe() {
  if (!window.pvModusVorgabe) {
    window.pvModusVorgabe = {
      dachform: 'sattel', belegung: 90, neigung: null,
      // Nordseiten belegt man nicht: bei ±45° um Nord (Nordost über Nord bis
      // Nordwest) liegt der Ertragsfaktor unter 70 %. Beim Satteldach wird die
      // betroffene Hälfte automatisch als Sperrfläche ausgespart.
      nordSperr: true, nordSektor: 45,
    };
  }
  return window.pvModusVorgabe;
}

// ══════════════════════════════════════════════════════════════════════════
// MODUS AN/AUS
// ══════════════════════════════════════════════════════════════════════════

export function pvModusToggle() {
  if (window.pvModusAktiv) pvModusStop(); else pvModusStart();
}

export function pvModusStart() {
  if (window.pvModusAktiv) return;
  // Über die Interaktionsregistrierung, damit ein anderes Kartenwerkzeug den
  // Modus sauber beendet (und umgekehrt) statt zwei Werkzeuge gleichzeitig
  // auf denselben Kartenklick hören zu lassen.
  beginInteraction({
    id: INTERAKTION,
    label: '☀ PV-Modus',
    hint: 'Dach anklicken = Fläche zeichnen · B/S = Belegung/Sperrfläche · N = nächstes offenes Dach',
    cancel: () => pvModusStop(),
  });
  window.pvModusAktiv = true;
  if (!window.pvModusTyp)   window.pvModusTyp   = 'belegung';
  if (!window.pvModusForm)  window.pvModusForm  = 'polygon';
  if (!window.pvModusListe) window.pvModusListe = 'mit';
  if (window.pvModusHilfe === undefined) window.pvModusHilfe = true;
  _vorgabe();
  _verlauf = [];
  _assetStandErfassen();
  ensureSatellite();
  setPvVisible(true);
  const cb = document.getElementById('el-pv-visible');
  if (cb) cb.checked = true;
  window.updateSperrVisibility?.();            // im Modus: Sperrflächen aller Gebäude
  _tastenHandler = _taste;
  document.addEventListener('keydown', _tastenHandler, true);
  map.on('click', _rechteckKartenklick);
  document.getElementById('btn-pv-modus-toggle')?.classList.add('active');
  pvModusRender();
  pvModusMarkiereKarte();
}

/**
 * Einstieg aus der „Dach & PV"-Sektion eines Gebäudes: Modus starten und
 * dieses Dach ins Panel holen. Von dort geht es ohne Rückweg in die Liste
 * mit den übrigen Dächern weiter.
 */
export function pvModusStartFuer(gId) {
  window.pvModusGeb = gId;
  if (!window.pvModusAktiv) pvModusStart();
  flyTo(gId);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvModusStop() {
  if (!window.pvModusAktiv || _stoppt) return;
  _stoppt = true;
  try {
    window.cancelGebPvDraw?.();
    window.cancelGebFirstDraw?.();
    _rechteckAbbruch();
    window.pvModusAktiv = false;
    if (_tastenHandler) { document.removeEventListener('keydown', _tastenHandler, true); _tastenHandler = null; }
    map.off('click', _rechteckKartenklick);
    _verlauf = [];
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById('btn-pv-modus-toggle')?.classList.remove('active');
    cancelInteraction(INTERAKTION);            // no-op, wenn der Stopp von dort kam
    window.updateSperrVisibility?.();
    updateViz();                               // Gebäudestile zurück auf die normale Darstellung
  } finally { _stoppt = false; }
}

/** Belegung/Sperrfläche umschalten — wirkt auch mitten in einer laufenden Zeichnung. */
export function pvModusSetTyp(typ) {
  window.pvModusTyp = typ === 'sperr' ? 'sperr' : 'belegung';
  const st = window.gebPvDraw;
  if (st) {
    st.typ = window.pvModusTyp;
    st.polyline?.setStyle({ color: st.typ === 'sperr' ? ROT : GELB });
  }
  if (window.pvRechteck) {
    window.pvRechteck.typ = window.pvModusTyp;
    window.pvRechteck.layer?.setStyle({ color: window.pvModusTyp === 'sperr' ? ROT : GELB });
  }
  pvModusRender();
}

/** Zeichenart: freies Polygon oder Rechteck aus zwei Klicks. */
export function pvmSetForm(form) {
  window.pvModusForm = form === 'rechteck' ? 'rechteck' : 'polygon';
  window.cancelGebPvDraw?.();
  _rechteckAbbruch();
  pvModusRender();
}

function _taste(event) {
  const ziel = event.target;
  const tippt = !!ziel && (ziel.tagName === 'INPUT' || ziel.tagName === 'TEXTAREA' ||
                           ziel.tagName === 'SELECT' || ziel.isContentEditable);
  if (event.key === 'Escape') {
    if (tippt) { ziel.blur(); return; }
    // Esc beendet erst die laufende Zeichnung, erst beim zweiten Mal den Modus.
    // Ohne stopPropagation würden zusätzlich der Esc-Handler in 02c und der der
    // Interaktionsregistrierung feuern — der Modus fiele mit der Fläche zusammen.
    event.preventDefault();
    event.stopPropagation();
    if (window.gebPvDraw || window.gebFirstDraw || window.pvRechteck) {
      window.cancelGebPvDraw?.();
      window.cancelGebFirstDraw?.();
      _rechteckAbbruch();
      pvModusRender();
      return;
    }
    pvModusStop();
    return;
  }
  if (tippt) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.stopPropagation();
    pvmUndo();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const k = event.key.toLowerCase();
  if (k === 'b' || k === 's') { pvModusSetTyp(k === 'b' ? 'belegung' : 'sperr'); event.preventDefault(); }
  else if (k === 'n')         { pvmNaechstesOffenes(); event.preventDefault(); }
  else if (k === 'r')         { pvmSetForm(window.pvModusForm === 'rechteck' ? 'polygon' : 'rechteck'); event.preventDefault(); }
}

// ══════════════════════════════════════════════════════════════════════════
// KARTENKLICK — aus attachPolygonLayer (02b-gebaeude.js)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Klick auf ein Gebäudepolygon im PV-Modus. Der Klick ist zugleich die erste
 * Ecke der neuen Fläche: das Polygon schluckt den Kartenklick
 * (bubblingMouseEvents:false), deshalb wird er über forwardClickToMap an die
 * Karte weitergereicht, wo der normale Zeichenpfad ihn aufnimmt.
 * @returns {boolean} true = Klick verbraucht (keine Gebäudeauswahl)
 */
export function pvModusBuildingClick(gId, event) {
  if (!window.pvModusAktiv) return false;
  // Läuft bereits eine Polygonzeichnung, ist der Klick eine weitere Ecke — der
  // reguläre Weg (selectFromMap → forwardClickToMap) erledigt das.
  if (window.gebPvDraw || window.gebFirstDraw) return false;
  const g = _geb(gId);
  if (!g) return false;
  const latlng = _klickLatLng(event);
  if (window.pvModusForm === 'rechteck') {
    if (latlng) _rechteckKlick(latlng, gId);
    return true;
  }
  window.pvModusGeb = gId;
  _assetStandErfassen();
  window.startGebPvDraw?.(gId, window.pvModusTyp || 'belegung', { keepView: true });
  forwardClickToMap(event);
  pvModusRender();
  pvModusMarkiereKarte();
  return true;
}

/**
 * Klick auf eine bereits gezeichnete Fläche (aus attachGebPvLayer). Die
 * PV-Flächen liegen in einer eigenen Pane über den Gebäuden und fangen den
 * Klick ab, bevor er das Dach erreicht — seit „Grundriss als Fläche" deckt die
 * Belegung meist das ganze Dach, dieser Fall ist also der Normalfall:
 *   • Sperrflächen-Modus → hier beginnt die neue Fläche (Kamine, Gauben und
 *     Verschattung liegen naturgemäß INNERHALB der Belegung),
 *   • sonst → Dach nur ins Panel holen.
 * Der Klick blubbert anschließend zur Karte weiter und setzt dort die erste
 * Ecke; deshalb wird er hier NICHT zusätzlich weitergereicht.
 * @returns {boolean} true = Klick verbraucht (keine Gebäudeauswahl)
 */
export function pvModusFlaecheClick(gId) {
  if (!window.pvModusAktiv) return false;
  if (window.gebPvDraw || window.gebFirstDraw || window.pvRechteck) return false;  // Zeichnung läuft
  if (window.pvModusForm === 'rechteck') return false;                             // macht der Kartenklick
  const g = _geb(gId);
  if (!g) return false;
  window.pvModusGeb = gId;
  if (window.pvModusTyp === 'sperr') {
    _assetStandErfassen();
    window.startGebPvDraw?.(gId, 'sperr', { keepView: true });
  }
  pvModusRender();
  pvModusMarkiereKarte();
  return true;
}

function _klickLatLng(event) {
  const domEv = event?.originalEvent;
  if (domEv && typeof map.mouseEventToLatLng === 'function') {
    try { return map.mouseEventToLatLng(domEv); } catch { /* Fallback unten */ }
  }
  return event?.latlng || null;
}

// ══════════════════════════════════════════════════════════════════════════
// RECHTECK — zwei Klicks, am First ausgerichtet
// ══════════════════════════════════════════════════════════════════════════

// Ecken eines Rechtecks von p1 nach p2 in einem um `winkelDeg` gedrehten
// Raster (0° = Nord). Für Schrägdächer ist das die Firstrichtung, damit die
// Fläche parallel zu First und Traufe liegt.
function _rechteckPunkte(p1, p2, winkelDeg) {
  const cosL = Math.cos(p1.lat * Math.PI / 180);
  const th = winkelDeg * Math.PI / 180;
  const e1 = { n: Math.cos(th),  e: Math.sin(th) };      // entlang First
  const e2 = { n: -Math.sin(th), e: Math.cos(th) };      // senkrecht dazu
  const dn = (p2.lat - p1.lat) * 111320;
  const de = (p2.lng - p1.lng) * 111320 * cosL;
  const a = dn * e1.n + de * e1.e;
  const b = dn * e2.n + de * e2.e;
  const punkt = (x, y) => ({
    lat: p1.lat + (x * e1.n + y * e2.n) / 111320,
    lng: p1.lng + (x * e1.e + y * e2.e) / (111320 * cosL),
  });
  return [punkt(0, 0), punkt(a, 0), punkt(a, b), punkt(0, b)];
}

function _rechteckWinkel(g) {
  if (!g || g.dachform === 'flach') return (g?.dachAzimut ?? 180) + 90;
  return (g.dachAzimut ?? 180) + 90;                     // First steht senkrecht zur Falllinie
}

function _rechteckKartenklick(e) {
  if (!window.pvModusAktiv || window.pvModusForm !== 'rechteck') return;
  if (window.gebPvDraw) return;
  _rechteckKlick(e.latlng, null);
}

function _rechteckKlick(latlng, gId) {
  const st = window.pvRechteck;
  if (!st) {
    const g = gId != null ? _geb(gId) : _gebaeudeUnter(latlng);
    if (!g) { window.showHint?.('Rechteck: mit dem ersten Klick auf ein Dach beginnen.', 4000); return; }
    window.pvModusGeb = g.id;
    _assetStandErfassen();
    window.pvRechteck = {
      gId: g.id, typ: window.pvModusTyp || 'belegung',
      p1: { lat: latlng.lat, lng: latlng.lng },
      winkel: _rechteckWinkel(g), layer: null,
    };
    map.on('mousemove', _rechteckBewegung);
    map.getContainer().style.cursor = 'crosshair';
    window.showHint?.('▭ Rechteck: zweite Ecke anklicken · Esc = abbrechen', 6000);
    pvModusRender();
    return;
  }
  const punkte = _rechteckPunkte(st.p1, latlng, st.winkel);
  const typ = st.typ;
  _rechteckAbbruch();
  _flaecheAnlegen(punkte, typ);
}

function _rechteckBewegung(e) {
  const st = window.pvRechteck;
  if (!st) return;
  const punkte = _rechteckPunkte(st.p1, e.latlng, st.winkel);
  const col = st.typ === 'sperr' ? ROT : GELB;
  if (st.layer) st.layer.setLatLngs(punkte);
  else st.layer = L.polygon(punkte, { color: col, weight: 2, dashArray: '6 4', fillOpacity: 0.15 }).addTo(map);
}

function _rechteckAbbruch() {
  const st = window.pvRechteck;
  if (!st) return;
  if (st.layer) map.removeLayer(st.layer);
  map.off('mousemove', _rechteckBewegung);
  window.pvRechteck = null;
  if (typeof map !== 'undefined') map.getContainer().style.cursor = '';
  window.hideHint?.();
}

function _gebaeudeUnter(latlng) {
  const treffer = _mitPolygon().filter(g => _pip(latlng, g.polygon));
  return treffer.length ? _kleinstes(treffer) : null;
}

// ══════════════════════════════════════════════════════════════════════════
// ZUORDNUNG — die Geometrie entscheidet, nicht die Vorauswahl
// ══════════════════════════════════════════════════════════════════════════

function _pip(pt, poly) {
  const x = pt.lng, y = pt.lat;
  let innen = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const xi = a.lng ?? a[1], yi = a.lat ?? a[0];
    const xj = b.lng ?? b[1], yj = b.lat ?? b[0];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi)) innen = !innen;
  }
  return innen;
}

function _meter(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Liegt der Schwerpunkt in mehreren Polygonen (Innenhof, verschachtelte
// Grundrisse), gewinnt das kleinste — es ist das speziellere.
function _kleinstes(liste) {
  return liste.reduce((a, b) => ((+a.flaeche || Infinity) <= (+b.flaeche || Infinity) ? a : b));
}

// Flächenanteil per Rasterstichprobe: ohne Polygonverschnitt ist das die
// ehrlichste billige Näherung — Punkte innerhalb der gezeichneten Fläche
// werden gegen jedes Gebäude gezählt.
function _groessteUeberlappung(punkte, kandidaten) {
  const lats = punkte.map(p => p.lat), lngs = punkte.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const N = 12;
  const proben = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const pt = {
        lat: minLat + (maxLat - minLat) * (i + 0.5) / N,
        lng: minLng + (maxLng - minLng) * (j + 0.5) / N,
      };
      if (_pip(pt, punkte)) proben.push(pt);
    }
  }
  if (!proben.length) return null;
  let bester = null, meiste = 0;
  for (const g of kandidaten) {
    let n = 0;
    for (const pt of proben) if (_pip(pt, g.polygon)) n++;
    if (n > meiste) { meiste = n; bester = g; }
  }
  return meiste >= proben.length * 0.2 ? bester : null;
}

/**
 * Gebäude zu einer fertig gezeichneten Fläche bestimmen.
 * 1. Schwerpunkt im Gebäude · 2. größte Überlappung · 3. Rückfrage.
 * @returns {any|null} null = Fläche verwerfen
 */
export function pvModusZuordnen(punkte) {
  const kandidaten = _mitPolygon();
  if (!kandidaten.length) {
    alert('Es gibt kein Gebäude, dem die Fläche zugeordnet werden könnte.\nDie Fläche wurde verworfen.');
    return null;
  }
  const c = polygonCenter(punkte);
  const treffer = kandidaten.filter(g => _pip(c, g.polygon));
  if (treffer.length) return _kleinstes(treffer);

  const ueberlappt = _groessteUeberlappung(punkte, kandidaten);
  if (ueberlappt) {
    window.showHint?.(`Fläche „${_name(ueberlappt)}" zugeordnet (Schwerpunkt lag außerhalb des Grundrisses).`, 5000);
    return ueberlappt;
  }

  let nah = null, dist = Infinity;
  for (const g of kandidaten) {
    const d = _meter(c, polygonCenter(g.polygon));
    if (d < dist) { dist = d; nah = g; }
  }
  const ok = confirm(
    `Die Fläche liegt auf keinem Gebäude.\n\n` +
    `Stattdessen „${_name(nah)}" zuordnen? (${Math.round(dist)} m entfernt)\n\n` +
    `Abbrechen verwirft die Fläche.`);
  return ok ? nah : null;
}

// ══════════════════════════════════════════════════════════════════════════
// FLÄCHEN ANLEGEN (Rechteck, Grundriss) + Nachlauf des Zeichnens
// ══════════════════════════════════════════════════════════════════════════

// Fläche aus fertigen Punkten anlegen — gemeinsamer Weg für Rechteck und
// Grundrissübernahme. Das freie Polygon geht weiter über finishGebPvDraw.
function _flaecheAnhaengen(g, punkte, typ) {
  if (!g.pvFlaechen) g.pvFlaechen = [];
  window._gebPvFlCounter = (window._gebPvFlCounter || 0) + 1;
  const fl = {
    id: window._gebPvFlCounter, typ,
    polygon: punkte.map(p => ({ lat: p.lat, lng: p.lng })),
    flaeche: polygonAreaM2(punkte) || 0, layer: null, svgLayer: null,
  };
  g.pvFlaechen.push(fl);
  g.pvModus = 'flaechen';
  if (typ !== 'sperr') g.pvAktiv = true;
  attachGebPvLayer(g, fl);
  redrawGebPvModules(g);
  return fl;
}

function _flaecheAnlegen(punkte, typ) {
  const g = pvModusZuordnen(punkte);
  if (!g) return null;
  const fl = _flaecheAnhaengen(g, punkte, typ);
  const vorher = _assetVorher(g.id);
  const nordIds = _erstbelegung(g);
  _verlaufMerken(_schritt(g.id, fl.id, nordIds, vorher));
  window.pvModusGeb = g.id;
  window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.pvModusHilfe = false;
  pvModusMarkiereKarte();
  pvModusRender();
  return fl;
}

/**
 * Nachlauf einer im Modus fertig gezeichneten Fläche (aus finishGebPvDraw):
 * Vorgaben und Azimut setzen, kWp sofort ins PV-Asset. Ohne diese Übernahme
 * entstünde der Zustand „abweichend", den die PV-Übersicht hinterher repariert.
 */
export function pvModusNachFlaeche(g) {
  if (!g) return;
  window.pvModusGeb = g.id;
  const vorher = _assetVorher(g.id);
  // Vor _erstbelegung merken: danach kann die letzte Fläche die automatisch
  // angelegte Nord-Sperrfläche sein, nicht mehr die gerade gezeichnete.
  const gezeichnet = (g.pvFlaechen || []).at(-1);
  const nordIds = _erstbelegung(g);
  if (gezeichnet) _verlaufMerken(_schritt(g.id, gezeichnet.id, nordIds, vorher));
  window.calcStromPanel?.();
  window.pvModusHilfe = false;
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// NORDSEITE AUSSPAREN
// ══════════════════════════════════════════════════════════════════════════

/**
 * Welche Satteldachhälfte zeigt nach Norden?
 * @returns {boolean|null} true = Vorderseite (Azimut A) · false = Rückseite
 *   (A+180) · null = keine der beiden liegt im Nordsektor
 */
function _nordSeite(g) {
  if (!g || g.dachform !== 'sattel') return null;   // nur hier gibt es zwei Seiten
  const sektor = _vorgabe().nordSektor ?? 45;
  const abstandNord = a => { const x = ((a % 360) + 360) % 360; return Math.min(x, 360 - x); };
  const A = g.dachAzimut ?? 180;
  if (abstandNord(A) <= sektor) return true;
  if (abstandNord(A + 180) <= sektor) return false;
  return null;
}

function _autoNordFlaechen(g) {
  return (g.pvFlaechen || []).filter(f => f.typ === 'sperr' && f.auto === 'nord');
}

function _autoNordEntfernen(g) {
  const weg = _autoNordFlaechen(g);
  for (const fl of weg) {
    if (fl.layer) map.removeLayer(fl.layer);
    if (fl.svgLayer) map.removeLayer(fl.svgLayer);
  }
  if (weg.length) g.pvFlaechen = g.pvFlaechen.filter(f => !(f.typ === 'sperr' && f.auto === 'nord'));
  return weg.length;
}

/**
 * Nordhälfte der Belegung als Sperrfläche anlegen — exakt an derselben
 * Firstlinie, an der die Berechnung das Dach teilt (_clipPolyHalfPlane mit
 * pvRidgeOverride bzw. Schwerpunkt). Nur so bleibt auf der Südseite kein
 * Modul-Streifen der Nordseite stehen.
 * @returns {number[]} ids der angelegten Sperrflächen
 */
function _nordAnwenden(g) {
  _autoNordEntfernen(g);
  const nordVorne = _nordSeite(g);
  if (nordVorne === null) return [];
  const bel = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr' && f.polygon && f.polygon.length >= 3);
  if (!bel.length) return [];
  const alle   = bel.flatMap(f => f.polygon);
  const maxLat = Math.max(...alle.map(p => p.lat)), minLat = Math.min(...alle.map(p => p.lat));
  const cosL   = Math.cos((maxLat + minLat) / 2 * Math.PI / 180);
  const C      = g.pvRidgeOverride || _polyCentroidLL(alle);
  const A      = g.dachAzimut ?? 180;
  const ids = [];
  for (const f of bel) {
    const haelfte = _clipPolyHalfPlane(f.polygon, C, A, cosL, nordVorne);
    if (haelfte.length < 3) continue;
    const fl = _flaecheAnhaengen(g, haelfte, 'sperr');
    fl.auto = 'nord';
    ids.push(fl.id);
  }
  redrawGebPvModules(g);
  return ids;
}

/** Nordseite aussparen bzw. die automatische Sperrfläche wieder freigeben. */
export function pvmNordAussparen(gId) {
  const g = _geb(gId);
  if (!g) return;
  if (_autoNordFlaechen(g).length) {
    _autoNordEntfernen(g);
    g._pvNordFrei = true;                  // bewusste Entscheidung — beim Drehen nicht zurückholen
    redrawGebPvModules(g);
  } else {
    delete g._pvNordFrei;
    if (_nordSeite(g) === null) {
      alert(`Keine Dachhälfte von „${_name(g)}" liegt im Nordsektor (±${_vorgabe().nordSektor}° um Nord).\n\nDer Sektor lässt sich unter „Vorgaben für neue Dächer" ändern.`);
      return;
    }
    const ids = _nordAnwenden(g);
    if (ids.length) _verlaufMerken(ids.map(flId => ({ gId: g.id, flId })));
  }
  _uebernehmen(g);
  window._rerenderCard?.(gId);
  window._updateGebLabelPv?.(gId);
  window.calcStromPanel?.();
  pvModusRender();
  pvModusMarkiereKarte();
}

// Erstbelegung eines Dachs: Vorgabewerte und Azimut aus dem Grundriss setzen,
// Nordseite aussparen, danach kWp ins Asset.
// @returns {number[]} ids automatisch angelegter Sperrflächen (für Strg+Z)
function _erstbelegung(g) {
  if (!g || !_hasBelegung(g)) return [];
  const v = _vorgabe();
  const erste = (g.pvFlaechen || []).filter(f => f.typ !== 'sperr').length <= 1;
  let nordIds = [];
  if (erste) {
    if (v.dachform && !g._pvDachformManuell) g.dachform = v.dachform;
    if (v.belegung != null) g.pvFlBelegung = v.belegung;
    if (v.neigung  != null) g.dachNeigung  = v.neigung;
    if (g.dachAzimut == null && Array.isArray(g.polygon) && g.polygon.length >= 3) {
      const az = detectRoofAzimutFromPolygon(g.polygon);
      if (az !== null) { g.dachAzimut = az; g.dachAutoAzimut = true; }
    }
    redrawGebPvModules(g);
    if (v.nordSperr) nordIds = _nordAnwenden(g);
  }
  _uebernehmen(g);
  window._rerenderCard?.(g.id);
  window._updateGebLabelPv?.(g.id);
  return nordIds;
}

// Verlaufseintrag für eine neue Belegung samt automatischer Nord-Sperrfläche.
// Die Sperrflächen stehen vorn: Strg+Z arbeitet die Liste der Reihe nach ab und
// die Assetfrage hängt daran, dass die Belegung zuletzt verschwindet.
function _schritt(gId, belId, nordIds, assetVorher) {
  return [...nordIds.map(flId => ({ gId, flId })), { gId, flId: belId, assetVorher }];
}

// kWp ins PV-Asset schreiben; legt es an, wenn es noch keins gibt (pvuFixOne
// aus 03c macht beides und rechnet das Stromnetz nach).
function _uebernehmen(g) {
  if (!g || !_hasBelegung(g)) return;
  window.pvuFixOne?.(g.id);
}

function _verlaufMerken(eintraege) {
  _verlauf.push(eintraege);
  if (_verlauf.length > 50) _verlauf.shift();
}

/** Letzten Schritt zurücknehmen (Strg+Z) — auch einen ganzen Grundriss-Stapel. */
export function pvmUndo() {
  const schritt = _verlauf.pop();
  if (!schritt) { window.showHint?.('Nichts mehr zurückzunehmen.', 3000); return; }
  for (const { gId, flId, assetVorher } of schritt) {
    const g = _geb(gId);
    if (!g) continue;
    const fl = (g.pvFlaechen || []).find(f => f.id === flId);
    if (fl) {
      if (fl.layer) map.removeLayer(fl.layer);
      if (fl.svgLayer) map.removeLayer(fl.svgLayer);
      g.pvFlaechen = g.pvFlaechen.filter(f => f.id !== flId);
    }
    redrawGebPvModules(g);
    if (!_hasBelegung(g)) {
      g.pvAktiv = false;
      // Ein in diesem Schritt entstandenes PV-Asset gehört zur Fläche und geht
      // mit ihr — sonst bliebe eine Anlage ohne Dachfläche im Projekt zurück.
      // Ein vorher vorhandenes Asset bekommt sein altes kWp zurück.
      const pv = getAssetsForBuilding(g.id).find(a => a.type === 'PV');
      if (pv && assetVorher === null) deleteAsset(pv.id, true);
      else if (pv && typeof assetVorher === 'number') {
        if (!pv.props) pv.props = {};
        pv.props.leistungKWp = assetVorher;
      }
    } else {
      _uebernehmen(g);
    }
    window._rerenderCard?.(gId);
    window._updateGebLabelPv?.(gId);
  }
  if (typeof window.recalcStromNetz === 'function') window.recalcStromNetz();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`↶ ${schritt.length} Fläche(n) zurückgenommen.`, 3000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// GRUNDRISS ÜBERNEHMEN
// ══════════════════════════════════════════════════════════════════════════

function _grundriss(g) {
  if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3) return null;
  return _flaecheAnhaengen(g, g.polygon, 'belegung');
}

/** Grundriss eines Gebäudes als Belegungsfläche übernehmen. */
export function pvmGrundriss(gId) {
  const g = _geb(gId);
  if (!g) return;
  if (_hasBelegung(g) &&
      !confirm(`„${_name(g)}" hat bereits eine Belegungsfläche.\nGrundriss zusätzlich übernehmen?`)) return;
  _assetStandErfassen();
  const fl = _grundriss(g);
  if (!fl) { alert('Dieses Gebäude hat keinen Grundriss.'); return; }
  const vorher = _assetVorher(g.id);
  const nordIds = _erstbelegung(g);
  _verlaufMerken(_schritt(g.id, fl.id, nordIds, vorher));
  window.pvModusGeb = g.id;
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`Grundriss übernommen: ${calcGebKwpKorr(g).toFixed(1)} kWp.`, 4000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// Gebäude, die die Stapelaktion trifft: ausgewählt (Haken in Gebäudeliste oder
// -tabelle), mit Grundriss, noch ohne Belegungsfläche.
function _stapelZiele() {
  return _mitPolygon().filter(g => g.selected && !_hasBelegung(g));
}

/**
 * Grundriss für alle ausgewählten Gebäude übernehmen. Die Auswahl ist bewusst
 * die Grenze — „alle offenen Dächer" würde Garagen und Schuppen mitbelegen.
 */
export function pvmGrundrissAuswahl() {
  const ziele = _stapelZiele();
  if (!ziele.length) {
    alert('Keine passenden Gebäude ausgewählt.\n\nGebäude in der Gebäudeliste oder in der Gebäudetabelle ankreuzen (dort lässt sich filtern und „alle sichtbaren" auswählen). Gebäude, die schon eine Belegungsfläche haben, bleiben unberührt.');
    return;
  }
  if (!confirm(`${ziele.length} ausgewählte Dächer mit ihrem Grundriss belegen?\n\n` +
               `Für jedes Dach entsteht eine Belegungsfläche in Grundrissgröße, die kWp gehen direkt ins PV-Asset. ` +
               `Mit Strg+Z lässt sich der ganze Schritt zurücknehmen.`)) return;

  _assetStandErfassen();
  const schritt = [];
  let summe = 0;
  for (const g of ziele) {
    const vorher = _assetVorher(g.id);
    const fl = _grundriss(g);
    if (!fl) continue;
    const nordIds = _erstbelegung(g);
    schritt.push(..._schritt(g.id, fl.id, nordIds, vorher));
    summe += calcGebKwpKorr(g) || 0;
  }
  if (schritt.length) _verlaufMerken(schritt);
  window.pvModusHilfe = false;
  window.calcStromPanel?.();
  window.renderList?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`${schritt.length} Dächer belegt · Σ ${summe.toFixed(0)} kWp. Strg+Z nimmt den Schritt zurück.`, 7000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION: NÄCHSTES OFFENES DACH
// ══════════════════════════════════════════════════════════════════════════

function _offeneDaecher() {
  return _mitPolygon().filter(g => !_hasBelegung(g));
}

/** Zum nächstgelegenen Dach ohne Belegungsfläche springen (Taste N). */
export function pvmNaechstesOffenes() {
  const offen = _offeneDaecher();
  if (!offen.length) { window.showHint?.('✓ Alle Dächer haben eine Fläche.', 4000); return; }
  const aktiv = _geb(window.pvModusGeb);
  const von = aktiv?.polygon ? polygonCenter(aktiv.polygon) : map.getCenter();
  let ziel = null, dist = Infinity;
  for (const g of offen) {
    if (aktiv && g.id === aktiv.id) continue;
    const d = _meter(von, polygonCenter(g.polygon));
    if (d < dist) { dist = d; ziel = g; }
  }
  if (!ziel) ziel = offen[0];
  window.pvModusGeb = ziel.id;
  flyTo(ziel.id);
  window.showHint?.(`→ „${_name(ziel)}" · noch ${offen.length} offen`, 4000);
  pvModusMarkiereKarte();
  pvModusRender();
}

// ══════════════════════════════════════════════════════════════════════════
// KARTENDARSTELLUNG
// ══════════════════════════════════════════════════════════════════════════

/** Dächer mit Fläche warm, Dächer ohne Fläche gestrichelt — offene Arbeit sichtbar. */
export function pvModusMarkiereKarte() {
  if (!window.pvModusAktiv) return;
  const aktiv = window.pvModusGeb;
  (window.gebaeude || []).forEach(g => {
    if (!g.polygonLayer) return;
    const hat = _hasBelegung(g);
    const ist = g.id === aktiv;
    g.polygonLayer.setStyle({
      color: ist ? GELB : hat ? '#ffb300' : 'rgba(255,255,255,.55)',
      weight: ist ? 3 : hat ? 2 : 1.4,
      dashArray: hat ? '' : '4 4',
      fillColor: hat ? GELB : '#ffffff',
      fillOpacity: hat ? 0.10 : 0.04,
    });
    if (ist) g.polygonLayer.bringToFront();
  });
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL
// ══════════════════════════════════════════════════════════════════════════

export function pvModusRender() {
  if (!window.pvModusAktiv) return;
  let el = document.getElementById(PANEL_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'PV-Modus');
    document.body.appendChild(el);
  }
  el.innerHTML = _html();
}

function _regler({ label, titel, min, max, step, wert, farbe, einheit, handler }) {
  return `<div class="inp-group">
      <div class="inp-label" title="${titel}">${label}</div>
      <div style="display:flex;align-items:center;gap:5px;padding:2px 0;">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${wert}"
          style="flex:1;cursor:pointer;accent-color:${farbe};height:4px;"
          oninput="this.nextElementSibling.textContent=this.value+'${einheit}'"
          data-change="${handler}"/>
        <span style="min-width:32px;text-align:right;font-size:11px;color:${farbe};font-weight:600;">${wert}${einheit}</span>
      </div>
    </div>`;
}

// Steuerelemente je Dachform — dieselbe Aufteilung wie in buildDachSection:
// Schrägdach über Belegungsgrad/Neigung/Azimut, Flachdach über GCR/Aufständerung.
function _dachRegler(g) {
  const schraeg = !!(g.dachform && g.dachform !== 'flach');
  if (schraeg) {
    const nei = g.dachNeigung != null ? g.dachNeigung : getDachDefaultNeigung(g.dachform);
    return _regler({ label:'Belegungsgrad (%)', titel:'Anteil der Dachfläche, der mit Modulen belegt wird', min:40, max:100, step:5,
                     wert: g.pvFlBelegung != null ? g.pvFlBelegung : 90, farbe:GELB, einheit:'%', handler:`pvmFl(${g.id},'belegung',this.value)` })
      + _regler({ label:'Neigung (°)', titel:'Neigung der Dachfläche', min:5, max:75, step:5,
                  wert: nei, farbe:'#80deea', einheit:'°', handler:`pvmDach(${g.id},'dachNeigung',this.value)` })
      + _regler({ label:'Azimut (°)', titel:'0=Nord · 90=Ost · 180=Süd · 270=West', min:0, max:355, step:5,
                  wert: g.dachAzimut ?? 180, farbe:'#ef9a9a', einheit:'°', handler:`pvmDach(${g.id},'dachAzimut',this.value)` })
      + (g.dachform === 'sattel' ? `
        <div style="display:flex;gap:4px;margin-top:2px;">
          <button class="btn-xs" style="flex:1;" data-click="pvmFirst(${g.id})"
            title="Firstlinie auf dem Satellitenbild nachzeichnen (2 Klicks)">📐 First zeichnen</button>
          ${g.pvRidgeOverride ? `<button class="btn-xs" data-click="pvmFirstReset(${g.id})" title="First zurück auf automatische Mitte">↺</button>` : ''}
        </div>` : '');
  }
  const gcr = g.pvFlGcr != null ? g.pvFlGcr : (g.pvFlAusrichtung === 'ostwest' ? 85 : 40);
  return _regler({ label:'GCR (% Belegung)', titel:'Anteil Modulfläche an der gezeichneten Fläche', min:5, max:95, step:5,
                   wert: gcr, farbe:GELB, einheit:'%', handler:`pvmFl(${g.id},'gcr',this.value)` })
    + `<div class="inp-group">
        <div class="inp-label">Aufständerung</div>
        <select class="inp-field" data-change="pvmFl(${g.id},'ausrichtung',this.value)">
          <option value="sued"${g.pvFlAusrichtung !== 'ostwest' ? ' selected' : ''}>Süd</option>
          <option value="ostwest"${g.pvFlAusrichtung === 'ostwest' ? ' selected' : ''}>Ost-West</option>
        </select>
      </div>`;
}

function _aktivBlock(g) {
  if (!g) {
    return `<div style="padding:8px 2px;font-size:10px;color:var(--muted);line-height:1.5;text-align:center;">
      Noch kein Dach gewählt — eines anklicken oder „→ nächstes offenes".
    </div>`;
  }
  const kwp     = calcGebKwpKorr(g);
  const basis   = calcGebKwp(g);
  const faktor  = basis > 0 ? kwp / basis : 1;
  const modRes  = _hasBelegung(g) ? getGebPvModules(g) : null;
  const mod     = modRes ? modRes.count : 0;
  const split   = (g.dachform === 'sattel' && modRes && modRes.frontCount != null)
    ? ` · 2-seitig ${modRes.frontCount}/${modRes.backCount}` : '';
  const netto   = pvNettoFlaeche(g);
  const fakFarbe = faktor >= 0.9 ? '#4caf50' : faktor >= 0.75 ? '#f9a825' : ROT;
  const schraeg = !!(g.dachform && g.dachform !== 'flach');
  const nordDa  = _autoNordFlaechen(g).length > 0;

  const flaechen = (g.pvFlaechen || []).map(fl => {
    const bel = fl.typ !== 'sperr';
    const beschriftung = bel ? 'Belegung' : (fl.auto === 'nord' ? 'Sperr · Nordseite' : 'Sperrfläche');
    return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:1px 0;">
      <span style="color:${bel ? GELB : ROT};">${bel ? '☀' : '⛔'}</span>
      <span style="flex:1;">${beschriftung}</span>
      <span style="font-family:'DM Mono',monospace;color:var(--muted);">${(fl.flaeche || 0).toFixed(0)} m²</span>
      <button class="btn-xs red" data-click="pvmFlaecheWeg(${g.id},${fl.id})" title="Fläche entfernen">✕</button>
    </div>`;
  }).join('');

  return `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span style="color:${GELB};">☀</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${escHtml(_name(g))}</span>
      <span style="font-family:'DM Mono',monospace;color:${GELB};font-size:11px;">${kwp.toFixed(1)} kWp</span>
    </div>
    <button class="btn-xs" style="width:100%;border-color:${GELB};color:${GELB};"
      data-click="pvmGrundriss(${g.id})"
      title="Den Gebäudegrundriss als Belegungsfläche übernehmen — bei Schrägdächern ist er die Dachfläche (Projektion und Firstteilung macht die Berechnung)">⊞ Grundriss als Fläche</button>
    ${g.dachform === 'sattel' ? `
    <button class="btn-xs" style="width:100%;margin-top:4px;${nordDa ? `border-color:${ROT};color:${ROT};` : ''}"
      data-click="pvmNordAussparen(${g.id})"
      title="${nordDa
        ? 'Die automatische Sperrfläche auf der Nordseite wieder entfernen'
        : `Die nach Norden zeigende Dachhälfte als Sperrfläche aussparen (Sektor ±${_vorgabe().nordSektor}° um Nord)`}">
      ${nordDa ? '↺ Nordseite wieder freigeben' : '⛔ Nordseite aussparen'}</button>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px;">
      <div class="inp-group">
        <div class="inp-label">Dachform</div>
        <select class="inp-field" data-change="pvmDach(${g.id},'dachform',this.value)">
          ${Object.entries(DACHFORMEN).map(([v, l]) =>
            `<option value="${v}"${(g.dachform || 'sattel') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="inp-group">
        <div class="inp-label" title="0=Nord · 90=Ost · 180=Süd · 270=West">Ausrichtung (°)</div>
        <div style="display:flex;gap:4px;">
          <input class="inp-field" type="number" min="0" max="359" style="flex:1;"
            value="${g.dachAzimut ?? ''}" placeholder="${g.dachAutoAzimut ? 'auto' : '180'}"
            data-change="pvmDach(${g.id},'dachAzimut',this.value)"/>
          <button class="btn-xs" title="Aus der Polygon-Längsachse ermitteln" data-click="pvmAzimutAuto(${g.id})">🔄</button>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;">${_dachRegler(g)}</div>
    ${flaechen
      ? `<div style="margin-top:6px;padding:4px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);">${flaechen}</div>`
      : '<div style="font-size:9px;color:var(--muted);margin-top:6px;text-align:center;">Noch keine Fläche an diesem Gebäude.</div>'}
    ${netto > 0 ? `
    <div class="geb-dach-kwp-row" style="margin-top:6px;">
      <span>${mod} Mod.${split}</span><span>${netto.toFixed(0)} m²</span>
      ${schraeg
        ? `<span>Faktor</span><span style="color:${fakFarbe};font-weight:600;">${(faktor * 100).toFixed(0)} %</span>`
        : `<span>Fläche</span><span style="font-weight:600;">${basis.toFixed(1)} kWp</span>`}
      <span style="font-weight:600;">= PV</span><span style="color:${GELB};font-weight:600;">${kwp.toFixed(1)} kWp</span>
    </div>` : ''}`;
}

function _vorgabeBlock() {
  if (!window.pvModusVorgabeOffen) {
    const v = _vorgabe();
    return `<div style="display:flex;align-items:center;gap:5px;font-size:9px;color:var(--muted);margin-top:8px;cursor:pointer;"
        data-click="pvmVorgabeToggle()" title="Werte, die jedes neu belegte Dach erbt">
      <span style="text-transform:uppercase;letter-spacing:.06em;flex:1;">Vorgaben für neue Dächer</span>
      <span>${DACHFORMEN[v.dachform] || v.dachform} · ${v.belegung} %${v.neigung != null ? ' · ' + v.neigung + '°' : ''}${v.nordSperr ? ` · Nord ±${v.nordSektor}° aus` : ''}</span>
      <span>▸</span>
    </div>`;
  }
  const v = _vorgabe();
  return `
    <div style="display:flex;align-items:center;gap:5px;font-size:9px;color:var(--muted);margin-top:8px;cursor:pointer;text-transform:uppercase;letter-spacing:.06em;"
      data-click="pvmVorgabeToggle()">
      <span style="flex:1;">Vorgaben für neue Dächer</span><span>▾</span>
    </div>
    <div style="padding:5px 7px;background:var(--bg);border-radius:4px;border:1px solid var(--border);margin-top:3px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <div class="inp-group">
          <div class="inp-label">Dachform</div>
          <select class="inp-field" data-change="pvmVorgabe('dachform',this.value)">
            ${Object.entries(DACHFORMEN).map(([w, l]) =>
              `<option value="${w}"${v.dachform === w ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="inp-group">
          <div class="inp-label" title="Leer = Standard der Dachform">Neigung (°)</div>
          <input class="inp-field" type="number" min="0" max="75" step="5" value="${v.neigung ?? ''}"
            placeholder="${getDachDefaultNeigung(v.dachform)}" data-change="pvmVorgabe('neigung',this.value)"/>
        </div>
      </div>
      ${_regler({ label:'Belegungsgrad (%)', titel:'Vorgabe für neu belegte Dächer', min:40, max:100, step:5,
                  wert: v.belegung, farbe:GELB, einheit:'%', handler:`pvmVorgabe('belegung',this.value)` })}
      <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">
        <label style="display:flex;align-items:center;gap:4px;flex:1;font-size:10px;cursor:pointer;"
          title="Beim Satteldach die nach Norden zeigende Hälfte automatisch als Sperrfläche aussparen">
          <input type="checkbox" ${v.nordSperr ? 'checked' : ''} style="accent-color:${ROT};cursor:pointer;"
            data-change="pvmVorgabe('nordSperr',this.checked)"/>Nordseiten aussparen
        </label>
        <span style="font-size:9px;color:var(--muted);" title="Halber Öffnungswinkel um Nord: 45° reicht von Nordost über Nord bis Nordwest">±</span>
        <input class="inp-field" type="number" min="5" max="90" step="5" value="${v.nordSektor}"
          style="width:52px;padding:2px 4px;" data-change="pvmVorgabe('nordSektor',this.value)"/>
        <span style="font-size:9px;color:var(--muted);">°</span>
      </div>
      <button class="btn-xs" style="width:100%;margin-top:4px;" data-click="pvmVorgabeAufAlle()"
        title="Dachform, Neigung und Belegungsgrad auf alle Dächer mit Fläche übertragen">↧ Auf alle belegten Dächer übertragen</button>
    </div>`;
}

function _listenBlock() {
  const alle  = _mitPolygon();
  const mitPv = alle.filter(_hasBelegung);
  const offen = alle.filter(g => !_hasBelegung(g));
  const summe = mitPv.reduce((s, g) => s + (calcGebKwpKorr(g) || 0), 0);
  const aktiv = window.pvModusGeb;
  const zeigeOffen = window.pvModusListe === 'offen';
  const liste = zeigeOffen ? offen : mitPv;

  const zeilen = liste.map(g => `
    <div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0;cursor:pointer;
         ${g.id === aktiv ? 'color:' + GELB + ';' : 'color:var(--text);'}"
         data-click="pvmWaehle(${g.id})" title="Auf der Karte zeigen und hier bearbeiten">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(_name(g))}</span>
      ${zeigeOffen
        ? `<span style="font-family:'DM Mono',monospace;color:var(--muted);">${(+g.flaeche || 0).toFixed(0)} m²</span>`
        : `<span style="font-family:'DM Mono',monospace;">${(calcGebKwpKorr(g) || 0).toFixed(1)}</span>`}
    </div>`).join('');

  const tab = (wert, text, an) => `<button class="btn-xs" style="flex:1;${an ? `border-color:${GELB};color:${GELB};` : ''}"
      data-click="pvmListe('${wert}')">${text}</button>`;

  return `
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
      <div style="display:flex;gap:4px;margin-bottom:4px;">
        ${tab('mit',   `mit Fläche (${mitPv.length})`, !zeigeOffen)}
        ${tab('offen', `offen (${offen.length})`,      zeigeOffen)}
      </div>
      <div style="max-height:150px;overflow-y:auto;">
        ${zeilen || `<div style="font-size:10px;color:var(--muted);padding:2px 0;">${zeigeOffen ? '✓ Kein Dach mehr offen.' : 'Noch nichts gezeichnet.'}</div>`}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid var(--border);">
        <span style="color:var(--muted);">Σ ${mitPv.length} Dächer${offen.length ? ` · ${offen.length} offen` : ''}</span>
        <span style="color:${GELB};font-weight:600;font-family:'DM Mono',monospace;">${summe.toFixed(0)} kWp</span>
      </div>
    </div>`;
}

function _html() {
  const g     = _geb(window.pvModusGeb);
  const typ   = window.pvModusTyp || 'belegung';
  const form  = window.pvModusForm || 'polygon';
  const sperr = typ === 'sperr';
  const ziele = _stapelZiele().length;
  const offen = _offeneDaecher().length;

  const knopf = (aktiv, farbe, handler, text, titel) =>
    `<button class="btn-xs" style="flex:1;${aktiv ? `border-color:${farbe};color:${farbe};background:${farbe}1f;` : ''}"
      data-click="${handler}" title="${titel}">${text}</button>`;

  return `
    <div class="pvm-head"${sperr ? ` style="border-bottom-color:${ROT};"` : ''}>
      <span class="pvm-head-title"${sperr ? ` style="color:${ROT};"` : ''}>${sperr ? '⛔ Sperrflächen' : '☀ PV-Modus'}</span>
      <button class="btn-xs" data-click="pvmHilfeToggle()" title="Kurzanleitung ein-/ausblenden">?</button>
      <button class="btn-xs" data-click="pvModusStop()" title="Modus beenden (Esc)">✓ Fertig</button>
    </div>
    <div class="pvm-body">
      <div style="display:flex;gap:4px;">
        ${knopf(!sperr, GELB, "pvModusSetTyp('belegung')", '☀ Belegung', 'Taste B')}
        ${knopf(sperr,  ROT,  "pvModusSetTyp('sperr')",    '⛔ Sperrfläche', 'Taste S')}
      </div>
      <div style="display:flex;gap:4px;margin-top:4px;">
        ${knopf(form === 'polygon',  '#80deea', "pvmSetForm('polygon')",  '✎ Polygon',  'Ecken einzeln klicken · Taste R wechselt')}
        ${knopf(form === 'rechteck', '#80deea', "pvmSetForm('rechteck')", '▭ Rechteck', 'Zwei Klicks, am First ausgerichtet · Taste R wechselt')}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px;">
        <button class="btn-xs" style="flex:1;" data-click="pvmNaechstesOffenes()"
          title="Zum nächstgelegenen Dach ohne Fläche springen (Taste N)">→ Nächstes offenes${offen ? ` (${offen})` : ''}</button>
        <button class="btn-xs" data-click="pvmUndo()" title="Letzten Schritt zurücknehmen (Strg+Z)">↶</button>
      </div>
      ${ziele
        ? `<button class="btn-xs" style="width:100%;margin-top:4px;border-color:${GELB};color:${GELB};"
             data-click="pvmGrundrissAuswahl()"
             title="Für jedes ausgewählte Dach ohne Fläche den Grundriss als Belegungsfläche übernehmen">⊞ Grundriss für ${ziele} ausgewählte Dächer</button>`
        : `<div style="font-size:9px;color:var(--muted);margin-top:4px;line-height:1.4;">
             Stapelweise: Gebäude in der Liste oder Gebäudetabelle ankreuzen (dort filtern) — dann erscheint hier „Grundriss für die Auswahl".
           </div>`}
      <div style="margin-top:8px;">${_aktivBlock(g)}</div>
      ${_vorgabeBlock()}
      ${_listenBlock()}
      ${window.pvModusHilfe ? `
      <div style="font-size:9px;color:var(--muted);margin-top:8px;line-height:1.45;">
        Dach anklicken = erste Ecke · roter Startpunkt = abschließen · Rechtsklick = Ecke zurück ·
        Esc = Zeichnung abbrechen, nochmal = Modus beenden · Strg+Z = Schritt zurück.
        Die Fläche gehört dem Dach, auf dem sie liegt; das kWp geht sofort ins PV-Asset.
      </div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// PANEL-HANDLER — rufen die bestehenden Handler und rendern danach neu
// ══════════════════════════════════════════════════════════════════════════

export function pvmDach(gId, feld, wert) {
  const g = _geb(gId);
  if (feld === 'dachform' && g) g._pvDachformManuell = true;
  const hatteNord = !!g && _autoNordFlaechen(g).length > 0;
  window.updateGebDach?.(gId, feld, wert);
  // Dreht sich der First (Azimut) oder wechselt die Dachform, liegt eine
  // automatisch ausgesparte Nordseite nicht mehr an der Firstlinie — neu
  // ableiten statt eine schiefe Sperrfläche stehen zu lassen. Das gilt auch,
  // wenn sie zwischendurch nur deshalb verschwunden war, weil keine Seite im
  // Nordsektor lag; nur ein bewusstes „freigeben" schaltet sie für das Dach ab.
  const nachziehen = hatteNord || (_vorgabe().nordSperr && !g?._pvNordFrei);
  if (g && nachziehen && _hasBelegung(g) && (feld === 'dachAzimut' || feld === 'dachform')) {
    _nordAnwenden(g);
    _uebernehmen(g);
    window._rerenderCard?.(gId);
    window._updateGebLabelPv?.(gId);
    window.calcStromPanel?.();
  }
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmFl(gId, feld, wert) {
  window.updateGebPvFl?.(gId, feld, wert);
  pvModusRender();
}

export function pvmAzimutAuto(gId) {
  window.ermittleAzimut?.(gId);
  pvModusRender();
}

export function pvmFirst(gId) {
  window.startGebFirstDraw?.(gId);
}

export function pvmFirstReset(gId) {
  window.resetGebFirst?.(gId);
  pvModusRender();
}

export function pvmFlaecheWeg(gId, flId) {
  const g = _geb(gId);
  // Wer die automatische Nord-Sperrfläche löscht, will die Nordseite belegen.
  if (g && (g.pvFlaechen || []).some(f => f.id === flId && f.auto === 'nord')) g._pvNordFrei = true;
  window.removeGebPvFlaeche?.(gId, flId);
  if (g && _hasBelegung(g)) _uebernehmen(g);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmWaehle(gId) {
  window.pvModusGeb = gId;
  flyTo(gId);
  pvModusRender();
  pvModusMarkiereKarte();
}

export function pvmListe(wert) {
  window.pvModusListe = wert === 'offen' ? 'offen' : 'mit';
  pvModusRender();
}

export function pvmHilfeToggle() {
  window.pvModusHilfe = !window.pvModusHilfe;
  pvModusRender();
}

export function pvmVorgabeToggle() {
  window.pvModusVorgabeOffen = !window.pvModusVorgabeOffen;
  pvModusRender();
}

export function pvmVorgabe(feld, wert) {
  const v = _vorgabe();
  if (feld === 'dachform')        v.dachform = wert;
  else if (feld === 'belegung')   v.belegung = Math.min(100, parseFloat(wert) || 90);
  else if (feld === 'neigung')    v.neigung  = wert === '' ? null : parseFloat(wert);
  else if (feld === 'nordSperr')  v.nordSperr = !!wert;
  else if (feld === 'nordSektor') v.nordSektor = Math.max(5, Math.min(90, parseFloat(wert) || 45));
  pvModusRender();
}

/** Vorgaben auf alle Dächer mit Fläche übertragen (Sammelkorrektur). */
export function pvmVorgabeAufAlle() {
  const v = _vorgabe();
  const ziele = _mitPolygon().filter(_hasBelegung);
  if (!ziele.length) { alert('Es gibt noch kein Dach mit Belegungsfläche.'); return; }
  if (!confirm(`Dachform „${DACHFORMEN[v.dachform]}"${v.neigung != null ? `, Neigung ${v.neigung}°` : ''} und Belegungsgrad ${v.belegung} % ` +
               `auf ${ziele.length} Dächer mit Fläche übertragen?\n\nAzimut und gezeichnete Flächen bleiben unverändert.`)) return;
  for (const g of ziele) {
    g.dachform = v.dachform;
    g.pvFlBelegung = v.belegung;
    if (v.neigung != null) g.dachNeigung = v.neigung;
    redrawGebPvModules(g);
    _uebernehmen(g);
    window._rerenderCard?.(g.id);
    window._updateGebLabelPv?.(g.id);
  }
  window.calcStromPanel?.();
  window.renderGebPvPanel?.();
  window.showHint?.(`${ziele.length} Dächer angeglichen.`, 5000);
  pvModusMarkiereKarte();
  pvModusRender();
}
