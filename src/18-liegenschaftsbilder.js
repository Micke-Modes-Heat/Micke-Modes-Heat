// ── 18-liegenschaftsbilder.js — Bilder der Liegenschaft: Kartenscreenshot + Vektor-Lageplan ──
// Im Unterschied zu den Datengrafiken in 17-gutachten-grafik.js geht es hier NICHT um
// Diagramme, sondern um echte geometrische Darstellungen der Liegenschaft (Gebäude,
// Wärme-/Stromnetz), analog zu einem Lageplan im Gutachten. Zwei Wege dahin:
//   • Kartenscreenshot — die reale Leaflet-Karte hochauflösend + ohne UI-Chrome rastern
//     (html2canvas, wie bereits in 05e-projektbericht.js für den Projektbericht genutzt).
//   • Vektor-Lageplan — Gebäude-Polygone + Netzkanten aus den Roh-Koordinaten neu
//     gezeichnet, im selben Papier-Stil wie die Gutachten-Grafiken (Kopfzeile aus
//     17-gutachten-grafik.js wiederverwendet: ggSheetHeader/ggTxt).

// Bewusst OHNE Imports aus dem App-Kern (Karte, Gebäude/Netz-State, Layer-Setter): dieses
// Modul soll — wie 17-gutachten-grafik.js — ein Blatt im Importgraph bleiben (siehe
// tests/import-architecture.test.js). Alles Nötige liegt zur Laufzeit auf window, weil
// main.js alle Modul-Exporte dort ablegt (Karten-/Gebäude-Globals sogar als Live-Getter).
import { GG_THEME, ggSheetHeader, ggTxt, ggSvgSource, ggSvgToPngBlob, ggCopyForWord } from './17-gutachten-grafik.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 0) GEMEINSAME HELFER
 * ═══════════════════════════════════════════════════════════════════════ */
const lbEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lbR = n => Math.round(n * 100) / 100;

function lbDateiname(basis, ext) {
  if (typeof window.projektExportFilename === 'function') return window.projektExportFilename(basis, ext);
  return `${basis}.${ext}`;
}

function lbDownloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1) KARTENSCREENSHOT — echte Leaflet-Karte hochauflösend + „sauber" rastern
 * ═══════════════════════════════════════════════════════════════════════ */
const LB_CAP_PRESETS = {
  alle:     { label: 'Alle Ebenen',        gebaeude: true, labels: false, waerme: true,  strom: true,  assets: true  },
  gebaeude: { label: 'Nur Gebäude',        gebaeude: true, labels: true,  waerme: false, strom: false, assets: false },
  waerme:   { label: 'Nur Wärmenetz',      gebaeude: true, labels: false, waerme: true,  strom: false, assets: false },
  strom:    { label: 'Nur Stromnetz + PV', gebaeude: true, labels: false, waerme: false, strom: true,  assets: true  },
};

let _lbCapLayers = { ...LB_CAP_PRESETS.alle };
let _lbCapScale = 3;
let _lbCapBlob = null, _lbCapUrl = null;
let _lbBusy = false;

function lbCapApplyPreset(id) {
  const p = LB_CAP_PRESETS[id];
  if (!p) return;
  _lbCapLayers = { gebaeude: p.gebaeude, labels: p.labels, waerme: p.waerme, strom: p.strom, assets: p.assets };
  lbRenderCapturePanel();
}

/**
 * html2canvas kann die CSS-Drehung der Kartenebene NICHT abbilden (leaflet-rotate
 * dreht `.leaflet-rotate-pane` per transform; im Rasterbild landet die Karte
 * trotzdem nord-oben, während einzelne Overlays ihre eigene Transformation
 * behalten — das Ergebnis ist in sich widersprüchlich). Im Browser nachgemessen:
 * eine Aufnahme bei 0° und bei 90° zeigt dieselbe Nordausrichtung.
 *
 * Deshalb wird für die Dauer der Aufnahme auf Nord-oben zurückgedreht und danach
 * der vorherige Winkel wiederhergestellt. Für ein GEDREHTES Bild ist ohnehin der
 * Vektor-Lageplan der richtige Weg — der dreht sauber (siehe lpBuildTransform).
 *
 * @returns {Promise<{winkel:number, zurueck:function}>} winkel = 0, wenn nichts zu tun war
 */
async function lbDrehungPausieren() {
  const winkel = (typeof window.kdAktiv === 'function' && window.kdAktiv()) ? window.kdWinkel() : 0;
  if (!winkel) return { winkel: 0, zurueck: () => {} };
  window.map.setBearing(0);
  // Kurz warten: der nord-oben-Ausschnitt zeigt an den Rändern Kacheln, die im
  // gedrehten Zustand außerhalb lagen und erst nachgeladen werden müssen.
  await new Promise(res => setTimeout(res, 600));
  return { winkel, zurueck: () => { try { window.map.setBearing(winkel); } catch (e) { void e; } } };
}

async function lbCaptureMap() {
  if (_lbBusy) return;
  if (typeof window.html2canvas !== 'function') { lbCapSay('html2canvas nicht verfügbar.', true); return; }
  const mapEl = document.getElementById('map');
  if (!mapEl) { lbCapSay('Karte nicht gefunden.', true); return; }
  _lbBusy = true;
  lbCapSay('Bild wird erzeugt …');

  // Ebenen gemäß Auswahl setzen — bleibt danach so stehen (wie ein manuelles
  // Umschalten der Werkzeugleiste), damit sich nichts "unsichtbar" im Hintergrund ändert.
  window.setGebVisible(_lbCapLayers.gebaeude);
  window.setLabelsVisible(_lbCapLayers.labels);
  window.setNetzVisible(_lbCapLayers.waerme);
  window.setStromNetzVisible(_lbCapLayers.strom);
  window.setAssetLayerVisible(_lbCapLayers.assets);

  // UI-Chrome nur für den Moment der Aufnahme ausblenden (reine Darstellung, kein State)
  const chrome = [...mapEl.querySelectorAll('.leaflet-control-zoom, .leaflet-control-attribution, .leaflet-control-rotate, .leaflet-popup')];
  const prevDisplay = chrome.map(el => el.style.display);
  chrome.forEach(el => { el.style.display = 'none'; });

  const dreh = await lbDrehungPausieren();

  // Zwei Frames abwarten, damit Leaflet die geänderte Ebenen-Sichtbarkeit fertig gezeichnet hat
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  try {
    const canvas = await window.html2canvas(mapEl, {
      useCORS: true, allowTaint: true, scale: _lbCapScale, logging: false, backgroundColor: '#eef2f5',
    });
    dreh.zurueck();
    chrome.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    canvas.toBlob(blob => {
      _lbBusy = false;
      if (!blob) { lbCapSay('Bild konnte nicht erzeugt werden.', true); return; }
      _lbCapBlob = blob;
      if (_lbCapUrl) URL.revokeObjectURL(_lbCapUrl);
      _lbCapUrl = URL.createObjectURL(blob);
      lbCapSay(`✓ Kartenbild erzeugt (${canvas.width}×${canvas.height} px).`
        + (dreh.winkel ? ' Für die Aufnahme kurz auf Nord-oben gedreht — ein gedrehtes Bild liefert der Vektor-Lageplan.' : ''));
      lbRenderCapturePanel();
    }, 'image/png');
  } catch (err) {
    dreh.zurueck();
    chrome.forEach((el, i) => { el.style.display = prevDisplay[i]; });
    _lbBusy = false;
    lbCapSay('Kartenbild konnte nicht erzeugt werden: ' + (err?.message || err), true);
  }
}

function lbCapDownload() {
  if (!_lbCapBlob) return;
  lbDownloadBlob(_lbCapBlob, lbDateiname('liegenschaft-karte', 'png'));
}

function lbCapSay(msg, err) {
  const el = document.getElementById('lb-cap-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? '#ef5350' : '#26a69a';
}

function lbCapPanelHtml() {
  const chk = (key, label, title) => `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;" title="${lbEsc(title || '')}">
    <input type="checkbox" ${_lbCapLayers[key] ? 'checked' : ''} data-change="lbCapSetLayer('${key}',this.checked)">${lbEsc(label)}</label>`;
  const presetBtn = (id) => `<button data-click="lbCapApplyPreset('${id}')" style="padding:5px 11px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:10px;cursor:pointer;">${lbEsc(LB_CAP_PRESETS[id].label)}</button>`;
  const scaleBtn = (v) => `<button data-click="lbCapSetScale(${v})" style="padding:4px 10px;border-radius:12px;border:1px solid ${_lbCapScale===v?'#26a69a':'rgba(255,255,255,.14)'};background:${_lbCapScale===v?'rgba(38,166,154,.16)':'transparent'};color:${_lbCapScale===v?'#26a69a':'var(--muted)'};font-family:inherit;font-size:10px;cursor:pointer;">${v}× · ~${v*96} dpi</button>`;

  return `
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Karten-Voreinstellung</div>
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">${Object.keys(LB_CAP_PRESETS).map(presetBtn).join('')}</div>

  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Ebenen im Bild</div>
  <div style="display:flex;flex-wrap:wrap;gap:10px 18px;margin-bottom:14px;">
    ${chk('gebaeude', 'Gebäude')}
    ${chk('labels', 'Beschriftungen', 'Gebäude-Namen/Nummern als Text auf der Karte')}
    ${chk('waerme', 'Wärmenetz')}
    ${chk('strom', 'Stromnetz')}
    ${chk('assets', 'PV/Assets', 'PV-Module, Batterien, sonstige Erzeuger-Icons')}
  </div>

  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Auflösung</div>
  <div style="display:flex;gap:6px;margin-bottom:14px;">${[2,3,4].map(scaleBtn).join('')}</div>

  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
    <button data-click="lbCaptureMap()" style="padding:8px 16px;border-radius:6px;border:1px solid rgba(38,166,154,.6);background:rgba(38,166,154,.18);color:#26a69a;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;">📷 Bild aus aktuellem Kartenausschnitt erzeugen</button>
    ${_lbCapBlob ? `<button data-click="lbCapDownload()" style="padding:8px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:12px;cursor:pointer;">⤓ PNG herunterladen</button>` : ''}
  </div>
  <div id="lb-cap-status" style="font-size:11px;color:#26a69a;min-height:16px;margin-bottom:10px;"></div>
  <div style="font-size:10px;color:var(--muted);line-height:1.5;margin-bottom:12px;">
    Nutzt den aktuellen Kartenausschnitt (Zoom/Ausschnitt vorher auf der Karte einstellen). Zoom-Regler und Copyright-Zeile werden für die Aufnahme automatisch ausgeblendet. Die Ebenen-Auswahl schaltet die echten Kartenebenen um — bleibt danach so stehen wie auf der Karte selbst.
  </div>
  <div id="lb-cap-preview" style="border:1px solid rgba(255,255,255,.1);border-radius:6px;overflow:hidden;background:#11151d;min-height:80px;display:flex;align-items:center;justify-content:center;">
    ${_lbCapUrl ? `<img src="${_lbCapUrl}" style="max-width:100%;display:block;">` : `<span style="font-size:11px;color:var(--muted);padding:20px;">Noch kein Bild erzeugt.</span>`}
  </div>`;
}

function lbRenderCapturePanel() {
  const el = document.getElementById('lb-cap-panel');
  if (el) el.innerHTML = lbCapPanelHtml();
}

window.lbCapApplyPreset = lbCapApplyPreset;
window.lbCapSetLayer = (key, on) => { _lbCapLayers[key] = !!on; lbRenderCapturePanel(); };
window.lbCapSetScale = (v) => { _lbCapScale = v; lbRenderCapturePanel(); };
window.lbCaptureMap = lbCaptureMap;
window.lbCapDownload = lbCapDownload;

/* ══════════════════════════════════════════════════════════════════════════
 * 2) VEKTOR-LAGEPLAN — Gebäude/Netz/Assets aus den Roh-Koordinaten als SVG
 *
 * Flexibel in vier unabhängigen Dimensionen:
 *   • Zeithorizont  — Referenzjahr (heute/Bestand) + Zieljahr (Ausbauziel),
 *     Anzeige-Filter Alle/Nur Bestand/Nur Neubau/Nur Rückbau (vereinheitlicht
 *     getComputedStats() für Gebäude, getAssetStatus() für Assets/Stromkanten,
 *     visibleFromYear/visibleUntilYear für Wärmenetzkanten).
 *   • Ebenen        — Gebäude/Wärmenetz/Stromnetz/MS-Ring einzeln ein-/ausblendbar.
 *   • Assets        — je Asset-Typ (Trafo, PV, Batterie, …) ein eigener Schalter,
 *     Liste ergibt sich dynamisch aus dem, was im Projekt tatsächlich existiert.
 *   • Einfärben nach — Keine (einheitlich) / Nutzungstyp / Status, mit dynamisch
 *     erzeugter Legende (Farbpalette, kein Feldname hart codiert).
 *   • Beschriftungen — eigener Master-Schalter plus Auswahl, WAS benannt wird
 *     (Gebäude + je Asset-Typ, z. B. ein Plan mit ausschließlich Trafo-Namen);
 *     jede Beschriftung ist im Plan mit der Maus frei verschiebbar, bleibt dabei
 *     aber an ihrem Objekt hängen (_lpLabelOffsets).
 * ═══════════════════════════════════════════════════════════════════════ */
const LP_R = 6371000; // Erdradius (m), äquirektangulare Näherung — für Liegenschaftsgröße ausreichend
const LP_STATUS_LABEL = { bestand: 'Bestand', neu: 'Neubau', abriss: 'Rückbau' };
const LP_STATUS_FARBE = { bestand: '#266426', neu: '#1E88E5', abriss: '#C62828' };
const LP_PALETTE = ['#8D6E63', '#7986CB', '#4DB6AC', '#F06292', '#AED581', '#FFB74D',
                     '#A1887F', '#90A4AE', '#BA68C8', '#4DD0E1', '#DCE775', '#F48FB1'];

let _lpState = {
  referenzjahr: null, zieljahr: null,   // lazy: beim ersten Rendern gesetzt
  anzeige: 'alle',                      // 'alle' | 'bestand' | 'neubau' | 'abriss'
  einfaerben: 'keine',                  // 'keine' | 'nutzung' | 'status'
  gebaeude: true, waerme: true, strom: true, msring: false,
  beschriftung: false,                  // Master-Schalter: Namen/Nummern von Gebäuden + Assets zeigen
  labelGeb: true,                       // Teil der Beschriftungs-Auswahl: Gebäude benennen (Assets je Typ, s. _lpLabelTypes)
  energieModus: 'spez',                 // nur relevant wenn einfaerben==='energie': 'spez'|'heizlast'|'verlust'
  kartenausschnitt: null,               // null = automatisch an Inhalt anpassen; sonst {south,west,north,east}
  drehung: 0,                           // Drehwinkel des Plans in Grad (im Uhrzeigersinn, 0 = Norden oben)
  satBild: null,                        // {dataUrl, bounds} — eingefangenes Satellitenbild, oder null
  satBildAn: true,                      // ob das eingefangene Bild angezeigt wird (unabhängig vom Einfangen selbst)
  vergleich: false,                     // Vorher/Nachher: referenzjahr + zieljahr als zwei Momentaufnahmen nebeneinander
};
let _lpAssetTypes = {};   // { [ASSET_CFG-Typ]: boolean } — welche Asset-Ebenen aktiv sind
let _lpAssetCounts = {};  // { [Typ]: Anzahl im Projekt } — für die Panel-Liste
// Beschriftungs-Auswahl — bewusst getrennt von _lpAssetTypes: das steuert, WAS gezeichnet wird,
// dies steuert, WAS davon einen Namen bekommt (z. B. nur die Trafos beschriften, während
// Gebäude und übrige Assets stumm bleiben). Default true, damit der Master-Schalter
// "Beschriftungen" wie bisher zunächst alles Sichtbare benennt.
let _lpLabelTypes = {};   // { [Typ]: boolean } — je Asset-Typ: Beschriftung an/aus
// Von Hand verschobene Standard-Beschriftungen: key `geb:<id>` / `asset:<id>` -> {dx,dy} in
// SVG-Einheiten RELATIV zur Standardposition am Objekt (nicht Lat/Lng) — die Beschriftung bleibt
// dadurch am richtigen Objekt hängen und überlebt Pan/Zoom/Filter-/Jahreswechsel. Gleiche Idee wie
// `offset` bei den individuellen Markierungen (s. _lpMarkierungen), aber eigene Liste: hier hängt
// kein Text/Hervorheben dran, es ist nur die Position einer ohnehin gezeichneten Beschriftung.
let _lpLabelOffsets = new Map();
let _lpSatBusy = false;

// Freie Beschriftungen (Text/Linie) — in SVG-Koordinaten des Plans (nicht Lat/Lng), weil
// sie eine feste Anmerkung auf dem AKTUELL gezeichneten Blatt sind, kein weiteres
// geografisches Objekt. Einfacher als eine echte Zeichen-Werkzeugleiste: Text eintippen,
// Position per Klick auf die Vorschau setzen (siehe lpAttachPlacingHandler).
const LP_ANNO_FARBE = '#6A1B9A';
let _lpAnnotations = []; // { id, type:'text'|'line', x,y (Text) | x1,y1,x2,y2 (Linie), text }
let _lpAnnoNextId = 1;
let _lpPlacing = null;   // null | { type:'text'|'line', text, x1?, y1? }

// "An Achse ausrichten": zwei Klicks in den Plan legen eine Achse fest (z. B. Anfang/Ende
// der Hauptstraße), aus deren Richtung sich der Drehwinkel ergibt. Bewusst NICHT über
// _lpPlacing gelöst — das steuert die freien Text-/Linien-Annotationen und blendet dafür
// eigene Panel-Hinweise ein.
let _lpAchse = null;     // null | { p1: {lat,lng}|null }

// Einzeln markierte Objekte (Gebäude/Assets) — Klick auf ein Objekt im Plan wählt es aus und
// zeigt einen kleinen Inline-Editor im Panel (Text/Hervorheben/Sichtbarkeit), UNABHÄNGIG vom
// globalen "Beschriftungen"-Schalter und von den freien Text-/Linien-Annotationen oben (die an
// Plan-Pixel-Koordinaten hängen, nicht an einem konkreten Objekt — verschiebt/filtert man den
// Plan, bleiben Markierungen am richtigen Gebäude/Asset, während freie Texte an ihrer Stelle
// "kleben"). `offset` ist die Verschiebung der Beschriftung GEGENÜBER der Standardposition
// (per Ziehen an der Beschriftung selbst gesetzt, s. lpWireNachjustieren).
const LP_MARK_FARBE = '#E91E63';
let _lpMarkierungen = new Map(); // key `${kind}:${id}` -> { kind, id, text, sichtbar, hervorheben, offset:{dx,dy} }
let _lpSelected = null; // Key der aktuell im Panel geöffneten Markierung, oder null
let _lpScale = 3;
let _lpSvg = null;
// Zuletzt gezeichnete Plot-Rechtecke + ihr Transform + der davon sichtbare Geo-Ausschnitt —
// füllt sich in lpRenderSvg()/lpRenderSvgVergleich() neu, wird von lpWireNachjustieren()
// (Ziehen/Zoomen direkt im Plan) gelesen, um Bildschirm- in Geo-Koordinaten umzurechnen.
let _lpLastPlots = [];

/** Rendergeometrie eines Netzkanten-Layers (Leaflet-Polyline) auslesen, mit Fallback auf die Knotenpunkte. */
function lpNetzPunkte(edge) {
  try {
    const ll = edge?.layer?.getLatLngs?.();
    if (Array.isArray(ll) && ll.length >= 2 && typeof ll[0]?.lat === 'number') {
      return ll.map(p => ({ lat: p.lat, lng: p.lng }));
    }
  } catch (e) { void e; }
  const u = edge?.uNode?.pt, v = edge?.vNode?.pt;
  return (u && v) ? [u, v] : null;
}
function lpStromPunkte(edge) {
  if (Array.isArray(edge?.route) && edge.route.length >= 2 && typeof edge.route[0]?.lat === 'number') {
    return edge.route.map(p => ({ lat: p.lat, lng: p.lng }));
  }
  try {
    const ll = edge?.layer?.getLatLngs?.();
    if (Array.isArray(ll) && ll.length >= 2 && typeof ll[0]?.lat === 'number') {
      return ll.map(p => ({ lat: p.lat, lng: p.lng }));
    }
  } catch (e) { void e; }
  const un = (window.stromNodes || []).find(n => n.id === edge.u), vn = (window.stromNodes || []).find(n => n.id === edge.v);
  return (un && vn) ? [{ lat: un.lat, lng: un.lng }, { lat: vn.lat, lng: vn.lng }] : null;
}
/** Kombiniertes Label "Nummer · Name" — dieselbe Konvention wie _gebCompactName() in 02b-gebaeude.js. */
function lpGebLabel(g) {
  return g.gebaeudenummer ? `${g.gebaeudenummer} · ${g.name || g.id}` : (g.name || g.id);
}
function lpPolyCentroid(poly) {
  if (!Array.isArray(poly) || !poly.length) return null;
  let lat = 0, lng = 0;
  for (const p of poly) { lat += p.lat; lng += p.lng; }
  return { lat: lat / poly.length, lng: lng / poly.length };
}

// ── Status "bestand/neu/abriss" zu einem Jahr — vereinheitlicht die drei
// verschiedenen App-Konzepte (Gebäude/Assets+Stromkanten/Wärmekanten). ──
function lpGebStatus(g, jahr) {
  const st = typeof window.getComputedStats === 'function' ? window.getComputedStats(g, jahr)?.status : null;
  return st === 'geplant' ? 'neu' : st === 'abgerissen' ? 'abriss' : 'bestand';
}
function lpAssetStatus(item, jahr) {
  const st = typeof window.getAssetStatus === 'function' ? window.getAssetStatus(item, jahr) : null;
  return st === 'planned' ? 'neu' : st === 'demolished' ? 'abriss' : 'bestand';
}
function lpNetzStatus(edge, jahr) {
  if (edge.visibleFromYear != null && jahr < edge.visibleFromYear) return 'neu';
  if (edge.visibleUntilYear != null && jahr >= edge.visibleUntilYear) return 'abriss';
  return 'bestand';
}
/**
 * Verdichtet Referenz-/Ziel-Status zu EINEM Horizont-Wert — Grundlage für Filter UND
 * Einfärbung zugleich. Ohne diese Verdichtung wäre "Einfärben nach Status" unter der
 * Anzeige "Alle bis Zieljahr" wirkungslos: dort haben ohnehin alle sichtbaren Objekte
 * denselben Status-am-Zieljahr ('bestand') — erst der Vergleich mit dem Referenzjahr
 * unterscheidet "war schon immer da" (bestand) von "neu seit Referenzjahr" (neu).
 * @returns {'bestand'|'neu'|'abriss'|null} null = jenseits des Zeithorizonts, ausblenden
 */
function lpHorizontStatus(statusReferenz, statusZiel) {
  if (statusZiel === 'bestand') return statusReferenz === 'bestand' ? 'bestand' : 'neu';
  if (statusZiel === 'abriss') return statusReferenz === 'bestand' ? 'abriss' : null;
  return null; // am Zieljahr noch nicht gebaut ('neu' über den Zielhorizont hinaus) — irrelevant
}
/** Anzeige-Filter aus dem Panel auf den Horizont-Status anwenden. */
function lpSichtbarNachHorizont(horizont) {
  if (horizont == null) return false;
  switch (_lpState.anzeige) {
    case 'bestand': return horizont === 'bestand';
    case 'neubau':  return horizont === 'neu';
    case 'abriss':  return horizont === 'abriss';
    default:        return horizont !== 'abriss'; // 'alle' — Bestand + Neubau bis Zieljahr
  }
}
function lpFarbeFuer(key, cache) {
  if (!cache.has(key)) cache.set(key, LP_PALETTE[cache.size % LP_PALETTE.length]);
  return cache.get(key);
}
/** Füllfarbe eines Gebäudes gemäß "Einfärben nach" — null = Standard-Grünton. */
function lpGebFarbe(g, horizont, cache) {
  if (_lpState.einfaerben === 'status') return LP_STATUS_FARBE[horizont] || LP_STATUS_FARBE.bestand;
  if (_lpState.einfaerben === 'nutzung') {
    const nt = typeof window.getNutzungstypById === 'function' ? window.getNutzungstypById(g.nutzung) : null;
    return lpFarbeFuer(nt?.gruppe || g.nutzung || 'Unbekannt', cache);
  }
  return null;
}
function lpAufhellen(hex, amt = 0.75) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = c => Math.round(c + (255 - c) * amt);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/* ── "Energiekennwert" (Kreise) — 1:1 nachgebaut aus getColor()/getSpezColor()/
 * getColorVal()/getModeVal() in 02b-gebaeude.js. Dort ist die Farblogik an das
 * globale window.currentMode gebunden (verändert die echte Karte); hier bewusst
 * parametrisiert, damit der Lageplan einen EIGENEN Modus unabhängig von der Karte
 * hat, ohne window.currentMode anzufassen. Farbskalen sind exakt die echten
 * CSS-Legendenverläufe der Karte (02c-karte-werkzeuge.js updateViz()). ─────── */
const LP_ENERGIE_LABEL = { spez: 'Spez. Wärmebedarf', heizlast: 'Heizlast', verlust: 'Zugerechneter Netzverlust' };
const LP_ENERGIE_EINHEIT = { spez: 'kWh/m²a', heizlast: 'kW', verlust: '%' };
const LP_ENERGIE_GRADIENT = {
  spez:     ['#4caf50', '#f9a825', '#f44336', '#640000'],
  heizlast: ['#2e7d32', '#8bc34a', '#f9a825', '#e65100', '#b71c1c'],
  verlust:  ['#4caf50', '#f9a825', '#e53935'],
};
const LP_R_MIN = 4, LP_R_MAX = 20; // eigene, SVG-taugliche Radien statt der zoomabhängigen R_MIN/R_MAX der Karte

function lpRgbHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}
function lpLerp(c1, c2, t) {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
  return lpRgbHex(r1 + t * (r2 - r1), g1 + t * (g2 - g1), b1 + t * (b2 - b1));
}
/** Entspricht getSpezColor() — feste Schwellen 20/250 kWh/m²a, unabhängig von Min/Max im Projekt. */
function lpSpezFarbe(val) {
  const n = Number(val);
  if (val == null || isNaN(n)) return '#4a7a8a';
  if (n <= 20) return '#4caf50';
  if (n >= 250) {
    const over = Math.min(1, Math.max(0, (n - 250) / 250));
    return lpRgbHex(249 - 149 * over, 67 - 67 * over, 54 - 54 * over);
  }
  const t = (n - 20) / 230;
  if (t < 0.5) { const f = t * 2; return lpRgbHex(76 + 173 * f, 175 - 7 * f, 80 - 43 * f); }
  const f = (t - 0.5) * 2; return lpRgbHex(249, 168 - 101 * f, 37 + 17 * f);
}
/** Entspricht dem 'verlust'-Zweig von getColor() — feste Skala 0–20 % zugerechneter Verlust. */
function lpVerlustFarbe(val) {
  if (val == null) return '#4a7a8a';
  const t = Math.max(0, Math.min(1, val / 20));
  return t < 0.5 ? lpLerp('#4caf50', '#f9a825', t * 2) : lpLerp('#f9a825', '#e53935', (t - 0.5) * 2);
}
/** Entspricht dem 'heizlast'-Zweig (5-Stufen-Regenbogen) von getColor() — projektbezogen Min/Max-normiert. */
function lpHeizlastFarbe(val, min, max) {
  if (val == null || max === min) return '#4a7a8a';
  const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
  const stops = [[46, 125, 50], [139, 195, 74], [249, 168, 37], [230, 81, 0], [183, 28, 28]];
  const seg = t * (stops.length - 1), i = Math.floor(seg), f = seg - i;
  const a = stops[Math.min(i, 4)], b = stops[Math.min(i + 1, 4)];
  return lpRgbHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
}
function lpEnergieFarbe(modus, val, min, max) {
  if (modus === 'spez') return lpSpezFarbe(val);
  if (modus === 'verlust') return lpVerlustFarbe(val);
  return lpHeizlastFarbe(val, min, max);
}
/** Entspricht der Kreisradius-Formel aus updateViz() in 02c-karte-werkzeuge.js: Fläche ∝ Wert. */
function lpEnergieRadius(val, max) {
  if (!val || !max || max <= 0) return LP_R_MIN;
  return Math.max(LP_R_MIN, LP_R_MAX * Math.sqrt(Math.max(0, val) / max));
}
/**
 * Farb-/Größenwert EINES Gebäudes für den gewählten Energiemodus — entspricht
 * getColorVal()/getModeVal(), aber mit explizitem Jahr statt window.globalYear
 * und ohne die Bindung an window.currentMode. Von lpEnergieSkala() getrennt,
 * damit der Vorher/Nachher-Vergleich Werte zweier Jahre VOR der Min/Max-Bildung
 * zusammenführen kann (siehe lpRenderSvgVergleich) — sonst hätten beide Seiten
 * unterschiedliche Farbskalen und wären nicht mehr vergleichbar.
 */
function lpEnergieWert(g, modus, jahr) {
  const stats = typeof window.getComputedStats === 'function' ? window.getComputedStats(g, jahr) : null;
  let farbwert = null, groessenwert = null;
  if (stats) {
    if (modus === 'spez') { farbwert = stats.spez || null; groessenwert = stats.spez || null; }
    else if (modus === 'heizlast') { farbwert = stats.heizlast || null; groessenwert = stats.heizlast || null; }
    else if (modus === 'verlust') { farbwert = g.netzVerlustRatioPct ?? null; groessenwert = g.netzVerlustKW || null; }
  }
  return { farbwert, groessenwert };
}
/** Min/Max-Skala aus einer Liste von {farbwert,groessenwert}-Paaren — s. lpEnergieWert(). */
function lpEnergieSkala(paare) {
  const groessenMax = Math.max(1, ...paare.map(w => w.groessenwert || 0));
  const farbwerte = paare.map(w => w.farbwert).filter(v => v != null);
  const farbMin = farbwerte.length ? Math.min(...farbwerte) : 0;
  const farbMax = farbwerte.length ? Math.max(...farbwerte) : 1;
  return { groessenMax, farbMin, farbMax };
}
function lpEnergieDaten(gebaeudeListe, modus, jahr) {
  const werte = gebaeudeListe.map(({ g }) => ({ g, ...lpEnergieWert(g, modus, jahr) }));
  return { werte, ...lpEnergieSkala(werte) };
}

/** Zählt alle im Projekt vorhandenen Asset-Typen (unabhängig von der aktuellen Filterauswahl). */
function lpAssetTypenAktualisieren() {
  const counts = {};
  if (typeof window.listAssets === 'function') {
    for (const a of (window.listAssets() || [])) counts[a.type] = (counts[a.type] || 0) + 1;
  }
  _lpAssetCounts = counts;
  for (const t of Object.keys(counts)) {
    if (!(t in _lpAssetTypes)) _lpAssetTypes[t] = false;
    if (!(t in _lpLabelTypes)) _lpLabelTypes[t] = true; // Beschriftung folgt standardmäßig der Ebene
  }
}

/** Sammelt die zu zeichnende Geometrie gemäß Zeithorizont, Ebenen- und Asset-Auswahl. */
function lpSammleGeometrie() {
  const referenz = _lpState.referenzjahr, ziel = _lpState.zieljahr;

  const gebaeudeListe = _lpState.gebaeude
    ? (window.gebaeude || [])
        .filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3)
        .filter(g => _lpMarkierungen.get(`geb:${g.id}`)?.sichtbar !== false)
        .map(g => ({ g, poly: g.polygon, horizont: lpHorizontStatus(lpGebStatus(g, referenz), lpGebStatus(g, ziel)) }))
        .filter(x => lpSichtbarNachHorizont(x.horizont))
    : [];

  const waermeListe = _lpState.waerme
    ? (window.netzEdges || []).filter(e => !e.pruned).map(e => {
        const pts = lpNetzPunkte(e);
        if (!pts || pts.length < 2) return null;
        return { pts, horizont: lpHorizontStatus(lpNetzStatus(e, referenz), lpNetzStatus(e, ziel)) };
      }).filter(x => x && lpSichtbarNachHorizont(x.horizont))
    : [];

  const stromListe = _lpState.strom
    ? (window.stromEdges || []).map(e => {
        const pts = lpStromPunkte(e);
        if (!pts || pts.length < 2) return null;
        return { pts, horizont: lpHorizontStatus(lpAssetStatus(e, referenz), lpAssetStatus(e, ziel)) };
      }).filter(x => x && lpSichtbarNachHorizont(x.horizont))
    : [];

  let msRingListe = [];
  if (_lpState.msring && typeof window.elDetectMSRings === 'function') {
    try {
      for (const ring of (window.elDetectMSRings() || [])) {
        for (const e of (ring.edges || [])) {
          const pts = lpStromPunkte(e);
          if (pts && pts.length >= 2) msRingListe.push(pts);
        }
      }
    } catch (err) { void err; }
  }

  let assetListe = [];
  if (typeof window.listAssets === 'function') {
    assetListe = (window.listAssets() || [])
      .filter(a => _lpAssetTypes[a.type])
      .filter(a => _lpMarkierungen.get(`asset:${a.id}`)?.sichtbar !== false)
      .map(a => {
        let lat = a.lat, lng = a.lng;
        if ((lat == null || lng == null) && a.buildingId) {
          const geb = (window.gebaeude || []).find(g => g.id === a.buildingId);
          const c = geb && lpPolyCentroid(geb.polygon);
          if (c) { lat = c.lat; lng = c.lng; }
        }
        return { asset: a, lat, lng, horizont: lpHorizontStatus(lpAssetStatus(a, referenz), lpAssetStatus(a, ziel)) };
      })
      .filter(x => x.lat != null && x.lng != null && lpSichtbarNachHorizont(x.horizont));
  }

  return { gebaeudeListe, waermeListe, stromListe, msRingListe, assetListe };
}

/**
 * Geometrie als reine Momentaufnahme EINES Jahres (Referenz- und Zieljahr auf denselben
 * Wert gesetzt) — für den Vorher/Nachher-Vergleich. lpHorizontStatus(x,x) liefert dann
 * immer 'bestand' für zu diesem Jahr existierende Objekte bzw. null für noch nicht
 * gebaute/bereits abgerissene, unabhängig vom Anzeige-Filter — genau die Semantik
 * "was steht zum Jahr J tatsächlich". _lpState wird nur kurz umgebogen (synchron, ohne
 * Await dazwischen) und danach zuverlässig zurückgesetzt.
 */
function lpSammleGeometrieJahr(jahr) {
  const savedRef = _lpState.referenzjahr, savedZiel = _lpState.zieljahr;
  _lpState.referenzjahr = jahr; _lpState.zieljahr = jahr;
  const col = lpSammleGeometrie();
  _lpState.referenzjahr = savedRef; _lpState.zieljahr = savedZiel;
  return col;
}

/**
 * Geografische Bounding Box roher Punkte — für den gemeinsamen Kartenausschnitt beider
 * Seiten im Vergleich. `padFrac` bläht die Box zusätzlich um etwas Rand auf: anders als beim
 * normalen Einzelplan (dort sorgt lpBuildTransform() selbst per Scale-Reduktion für Randluft
 * um automatisch angepasste Inhaltspunkte) ist das Ergebnis hier IMMER ein fester `ausschnitt`
 * — und der wird seit dem Nachjustieren-Fix bewusst OHNE weiteres Padding gerendert (exakte
 * 1:1-Abbildung, sonst bläht jeder Zoom-/Drag-Schritt den sichtbaren Bereich zusätzlich auf).
 * Ohne diesen Parameter würde der automatische Vergleichs-Ausschnitt die Gebäude daher bis an
 * den Bildrand quetschen.
 */
/**
 * Aktuelle Plandrehung als Sinus/Cosinus. Der Winkel dreht den INHALT im fertigen Bild im
 * Uhrzeigersinn (gleiche Konvention wie SVG `rotate(+deg)`, y zeigt nach unten). 0 = Norden oben.
 */
function lpDreh() {
  const deg = _lpState.drehung || 0;
  const rad = deg * Math.PI / 180;
  return { deg, rad, cos: Math.cos(rad), sin: Math.sin(rad) };
}

/**
 * Drehwinkel (Grad), der die Achse A→B im Bild senkrecht stellt. Auf ±90° normiert, damit
 * der Plan nicht auf dem Kopf landet (senkrecht ist senkrecht, egal in welche Richtung).
 */
function lpAchsenWinkel(a, b) {
  const latRef = (a.lat + b.lat) / 2 * Math.PI / 180;
  const du = (b.lng - a.lng) * Math.PI / 180 * LP_R * Math.cos(latRef);  // nach Osten
  const dv = -(b.lat - a.lat) * Math.PI / 180 * LP_R;                    // nach Süden (wie SVG-y)
  if (Math.hypot(du, dv) < 1) return null; // < 1 m — kein sinnvoller Richtungsvektor
  let deg = Math.atan2(du, dv) * 180 / Math.PI;   // löst du·cos − dv·sin = 0
  if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
  return Math.round(deg);
}

function lpAutoBounds(punkte, padFrac = 0.08) {
  if (!punkte.length) return null;
  // Einpassung im GEDREHTEN Bezugssystem (u = im Bild nach rechts, v = nach unten): bei
  // schräg liegender Liegenschaft wäre das Nord-oben-Hüllrechteck sonst deutlich zu groß.
  // Rückgabeformat bleibt eine Lat/Lng-Box — sie beschreibt Mitte + Spannweiten der
  // gedrehten Fläche, genau wie lpBuildTransform sie wieder interpretiert.
  const { cos, sin } = lpDreh();
  const latRef = punkte.reduce((sum, p) => sum + p.lat, 0) / punkte.length;
  const cosRef = Math.cos(latRef * Math.PI / 180);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of punkte) {
    const u0 = (p.lng * Math.PI / 180) * LP_R * cosRef, v0 = -(p.lat * Math.PI / 180) * LP_R;
    const u = u0 * cos - v0 * sin, v = u0 * sin + v0 * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const halbU = (maxU - minU) / 2 + ((maxU - minU) * padFrac || 30);
  const halbV = (maxV - minV) / 2 + ((maxV - minV) * padFrac || 30);
  const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
  const cu = mu * cos + mv * sin, cv = -mu * sin + mv * cos;   // Mitte zurückdrehen
  const mitteLng = cu / (LP_R * cosRef) * (180 / Math.PI), mitteLat = -cv / LP_R * (180 / Math.PI);
  const dLng = halbU / (LP_R * cosRef) * (180 / Math.PI), dLat = halbV / LP_R * (180 / Math.PI);
  return { south: mitteLat - dLat, north: mitteLat + dLat, west: mitteLng - dLng, east: mitteLng + dLng };
}

/** Zusammenfassungszeile "N Gebäude · M m Wärmenetz · …" für eine gesammelte Geometrie. */
function lpZusammenfassung(col) {
  const wLen = col.waermeListe.reduce((s, x) => s + lpLaengeM(x.pts), 0);
  const sLen = col.stromListe.reduce((s, x) => s + lpLaengeM(x.pts), 0);
  return [
    col.gebaeudeListe.length ? `${col.gebaeudeListe.length} Gebäude` : null,
    col.waermeListe.length ? `${Math.round(wLen)} m Wärmenetz` : null,
    col.stromListe.length ? `${Math.round(sLen)} m Stromnetz` : null,
    col.assetListe.length ? `${col.assetListe.length} Assets` : null,
  ].filter(Boolean).join(' · ') || '—';
}

/** Legende als {label,farbe,art,dash}[] — unabhängig von der Zeichenreihenfolge, gleiche Farblogik wie beim Zeichnen. */
function lpBuildLegendItems(col) {
  const items = [], seen = new Set();
  const add = (label, farbe, art, dash) => { if (!seen.has(label)) { seen.add(label); items.push({ label, farbe, art, dash }); } };
  if (col.gebaeudeListe.length) {
    if (_lpState.einfaerben === 'nutzung') {
      const cache = new Map();
      for (const { g } of col.gebaeudeListe) {
        const nt = window.getNutzungstypById?.(g.nutzung);
        const key = nt?.gruppe || g.nutzung || 'Unbekannt';
        add(key, lpFarbeFuer(key, cache), 'flaeche');
      }
    } else if (_lpState.einfaerben === 'status') {
      for (const { horizont } of col.gebaeudeListe) add(LP_STATUS_LABEL[horizont], LP_STATUS_FARBE[horizont], 'flaeche');
    } else {
      add('Gebäude', GG_THEME.accents.gruenDunkel, 'flaeche');
    }
  }
  if (col.waermeListe.length) add('Wärmenetz', GG_THEME.energy.waerme, 'linie');
  if (col.stromListe.length) add('Stromnetz', GG_THEME.energy.strom, 'linie', true);
  if (col.msRingListe.length) add('MS-Ring', '#FB8C00', 'linie');
  for (const { asset } of col.assetListe) {
    const cfg = window.ASSET_CFG?.[asset.type];
    add(cfg?.label || asset.type, cfg?.color || '#607d8b', 'punkt');
  }
  return items;
}
/** Packt Legenden-Einträge zeilenweise in eine Breite — liefert Positionen + Zeilenanzahl. */
function lpPackLegend(items, x0, width, rowH = 20) {
  const laid = [];
  let x = x0, row = 0;
  for (const it of items) {
    const w = 22 + it.label.length * 6.3 + 20;
    if (x + w > x0 + width && x > x0) { row++; x = x0; }
    laid.push({ ...it, x, y: row * rowH });
    x += w;
  }
  return { laid, rows: row + 1 };
}

/**
 * Äquirektangulare Projektion + Einpassung in eine Ziel-Fläche (px). Ohne Drehung ist
 * Nord = oben; `_lpState.drehung` dreht den kompletten Planinhalt im Uhrzeigersinn (für
 * Liegenschaften, deren Hauptachse schräg zur Nordrichtung liegt).
 *
 * Gerechnet wird in "Planmetern" u/v (u = nach Osten, v = nach Süden — v zeigt wie die
 * SVG-y-Achse nach unten), anschließend gedreht und in die Plotfläche skaliert.
 *
 * @param {{south,west,north,east}|null} ausschnitt — fester Kartenausschnitt statt
 *   automatisch an `allePunkte` angepasst (siehe "Aktuellen Kartenausschnitt übernehmen").
 *   Bei gedrehtem Plan beschreibt die Box Mitte + Spannweiten der GEDREHTEN Fläche, nicht
 *   deren Nord-oben-Hüllrechteck — nur so bleiben Ziehen/Zoomen im Plan verlustfrei
 *   umkehrbar (sichtbarerAusschnitt() liefert genau wieder so eine Box).
 */
function lpBuildTransform(allePunkte, plotX, plotY, plotW, plotH, padFrac = 0.07, ausschnitt = null) {
  const { deg, cos, sin } = lpDreh();
  const latRef = ausschnitt ? (ausschnitt.south + ausschnitt.north) / 2
    : allePunkte.reduce((s, p) => s + p.lat, 0) / allePunkte.length;
  const cosRef = Math.cos(latRef * Math.PI / 180);
  const toUV = (lat, lng) => ({
    u: (lng * Math.PI / 180) * LP_R * cosRef,
    v: -(lat * Math.PI / 180) * LP_R,
  });
  const dreh  = (u, v) => ({ u: u * cos - v * sin, v: u * sin + v * cos });   // wie SVG rotate(+deg)
  const rueck = (u, v) => ({ u: u * cos + v * sin, v: -u * sin + v * cos });
  const zuLatLng = (u, v) => ({ lat: -v / LP_R * (180 / Math.PI), lng: u / (LP_R * cosRef) * (180 / Math.PI) });

  let cu, cv, spanX, spanY;   // Mitte im gedrehten System + einzupassende Spannweiten
  if (ausschnitt) {
    const a = toUV(ausschnitt.south, ausschnitt.west), b = toUV(ausschnitt.north, ausschnitt.east);
    const m = dreh((a.u + b.u) / 2, (a.v + b.v) / 2);
    cu = m.u; cv = m.v;
    spanX = Math.abs(b.u - a.u); spanY = Math.abs(b.v - a.v);
  } else {
    const pts = allePunkte.map(p => { const q = toUV(p.lat, p.lng); return dreh(q.u, q.v); });
    const minU = Math.min(...pts.map(p => p.u)), maxU = Math.max(...pts.map(p => p.u));
    const minV = Math.min(...pts.map(p => p.v)), maxV = Math.max(...pts.map(p => p.v));
    cu = (minU + maxU) / 2; cv = (minV + maxV) / 2;
    spanX = maxU - minU; spanY = maxV - minV;
  }
  spanX = Math.max(1, spanX); spanY = Math.max(1, spanY);
  // Rand-Padding nur beim automatischen Zuschnitt auf rohe Inhaltspunkte sinnvoll (Luft um
  // Gebäude/Netz). Bei einem FESTEN ausschnitt ist die Fläche bereits "der gewünschte
  // Bildausschnitt" (von der echten Karte übernommen, oder von lpZoomSchritt/dem Ziehen
  // berechnet) — nochmals padden würde ihn bei jedem Aufruf zusätzlich vergrößern. Das fiel
  // beim interaktiven Nachjustieren auf: ein einzelner Zoomschritt kam nur zu ~93% statt 100%
  // des angeforderten Faktors an, weil jeder Render den vorherigen (bereits gepaddeten)
  // sichtbaren Ausschnitt erneut um denselben Faktor aufblies.
  const pad = ausschnitt ? 1 : 1 - padFrac * 2;
  const scale = Math.min(plotW * pad / spanX, plotH * pad / spanY);
  const svgCx = plotX + plotW / 2, svgCy = plotY + plotH / 2;
  const mitte = rueck(cu, cv);   // Mitte in UNGEDREHTEN Planmetern
  return {
    toSvg: (lat, lng) => {
      const q = toUV(lat, lng);
      const d = dreh(q.u - mitte.u, q.v - mitte.v);
      return { x: svgCx + d.u * scale, y: svgCy + d.v * scale };
    },
    // Umkehrung von toSvg — für das Nachjustieren (Ziehen/Zoomen) direkt im Plan: dort muss
    // aus einer Bildschirmposition der zugehörige Geo-Punkt bestimmt werden (Zoom-Zentrum,
    // Fixieren des Punkts unter dem Cursor beim Draggen). Affine Abbildung (Drehung +
    // gleichmäßige Skalierung), daher exakt umkehrbar.
    fromSvg: (x, y) => {
      const d = rueck((x - svgCx) / scale, (y - svgCy) / scale);
      return zuLatLng(mitte.u + d.u, mitte.v + d.v);
    },
    // Platzierung OHNE Drehung (Nord oben) — für das Satellitenbild: das eingefangene
    // Kachelbild ist nord-oben orientiert und wird als achsenparalleles <image> gezeichnet,
    // das per SVG-transform um dieselbe Bildmitte mitgedreht wird.
    toSvgUnrot: (lat, lng) => {
      const q = toUV(lat, lng);
      return { x: svgCx + (q.u - mitte.u) * scale, y: svgCy + (q.v - mitte.v) * scale };
    },
    /**
     * Geo-Box, die die aktuell sichtbare Planfläche beschreibt (Mitte + Spannweiten im
     * gedrehten System). Ersetzt das frühere Auslesen der vier Plot-Ecken via fromSvg —
     * das lieferte bei gedrehtem Plan das Hüllrechteck statt der Fläche selbst. Ist direkt
     * wieder als `ausschnitt` einsetzbar (verlustfreier Rundlauf).
     */
    sichtbarerAusschnitt: (w, h) => {
      const c = zuLatLng(mitte.u, mitte.v);
      const dLng = (w / 2 / scale) / (LP_R * cosRef) * (180 / Math.PI);
      const dLat = (h / 2 / scale) / LP_R * (180 / Math.PI);
      return { south: c.lat - dLat, north: c.lat + dLat, west: c.lng - dLng, east: c.lng + dLng };
    },
    /** Verschiebung in Blattpixeln → Geo-Delta. Translationsinvariant, aber drehungsabhängig. */
    planDelta: (dx, dy) => {
      const d = rueck(dx / scale, dy / scale);
      return { dlng: d.u / (LP_R * cosRef) * (180 / Math.PI), dlat: -d.v / LP_R * (180 / Math.PI) };
    },
    drehDeg: deg, svgCx, svgCy,
    scale, cosRef,
    metersPerPx: 1 / scale,
  };
}

/** Runde, "hübsche" Maßstabslänge (m) nahe der Ziel-Pixelbreite. */
function lpNiceScale(targetPx, metersPerPx) {
  const targetM = targetPx * metersPerPx;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
  let best = steps[0];
  for (const s of steps) { if (s <= targetM) best = s; else break; }
  return best;
}

const LP_W = GG_THEME.width;      // 1000 px, wie alle Gutachten-Grafiken
const LP_PLOT_H = 640;
const LP_PLOT_H_VERGLEICH = 460;  // etwas niedriger als LP_PLOT_H — zwei Pläne nebeneinander statt einer voller Breite

/** Vergleicht zwei Kartenausschnitte auf (annähernde) Gleichheit — Schutz gegen veraltete Satellitenbilder. */
function lpBoundsGleich(a, b) {
  if (!a || !b) return false;
  const eps = 1e-7;
  return Math.abs(a.south - b.south) < eps && Math.abs(a.west - b.west) < eps
      && Math.abs(a.north - b.north) < eps && Math.abs(a.east - b.east) < eps;
}

/**
 * Fängt die aktuell sichtbaren Kartenkacheln (idealerweise Luftbild) als Hintergrundbild
 * für den Vektor-Lageplan ein. Legt dabei IMMER auch den Kartenausschnitt exakt auf die
 * eingefangenen Bounds fest (`_lpState.kartenausschnitt`) — nur so bleiben Bild und
 * Vektor-Overlay in `lpRenderSvg()` pixelgenau deckungsgleich (beide nutzen dieselbe
 * `lpBuildTransform(..., ausschnitt)`-Projektion für dieselben Bounds).
 */
async function lpCaptureSatellite() {
  if (_lpSatBusy) return;
  if (typeof window.html2canvas !== 'function') { lpSay('html2canvas nicht verfügbar.', true); return; }
  if (!window.map || typeof window.map.getBounds !== 'function') { lpSay('Karte nicht verfügbar.', true); return; }
  const mapEl = document.getElementById('map');
  if (!mapEl) { lpSay('Karte nicht gefunden.', true); return; }
  _lpSatBusy = true;
  lpSay('Satellitenbild wird eingefangen …');

  // ERST zurückdrehen, DANN die Bounds lesen: bei gedrehter Karte liefert
  // getBounds() die Hülle der vier gedrehten Ecken — die passt nicht zu dem
  // nord-oben aufgenommenen Bild (s. lbDrehungPausieren).
  const dreh = await lbDrehungPausieren();
  const b = window.map.getBounds();
  const bounds = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };

  // Luftbild sicherstellen (bleibt danach als Kartenhintergrund aktiv — wie bei den
  // Ebenen-Voreinstellungen des Kartenscreenshots ist das eine bewusste, sichtbare
  // Nebenwirkung statt eines unsichtbar zurückgesetzten Zustands).
  // ⚠ window.currentTile ist ein primitiver Wert aus einem Nicht-Globals-Modul — main.js
  // kopiert den beim Laden nur EINMAL nach window (kein Live-Getter wie bei 01-globals-
  // varianten.js), bliebe also für immer 'osm' hängen. map/esriTile sind echte Objekte
  // und bleiben live — deshalb den tatsächlichen Layer-Zustand direkt prüfen.
  if (!window.map.hasLayer(window.esriTile) && typeof window.toggleTile === 'function') {
    window.toggleTile();
    await new Promise(res => setTimeout(res, 150)); // Tile-Layer-Wechsel anstoßen lassen
  }
  if (window.esriTile?.isLoading?.()) {
    await new Promise(res => { window.esriTile.once('load', res); setTimeout(res, 3000); });
  }

  // Alle Overlay-Panes (Gebäude, Netz, Assets, Marker, Popups, Tooltips) ausblenden —
  // rein per DOM/CSS über die Leaflet-Panes, ohne App-Sichtbarkeits-State anzufassen
  // (der ist über mehrere Module verstreut und nicht überall zuverlässig lesbar).
  const panes = typeof window.map.getPanes === 'function' ? window.map.getPanes() : {};
  const versteckt = [];
  for (const [name, el] of Object.entries(panes)) {
    if (name === 'tilePane' || name === 'mapPane' || !el || el.style.display === 'none') continue;
    versteckt.push(el);
    el.style.display = 'none';
  }
  const chrome = [...mapEl.querySelectorAll('.leaflet-control-zoom, .leaflet-control-attribution, .leaflet-control-rotate, .leaflet-popup')];
  const prevChromeDisplay = chrome.map(el => el.style.display);
  chrome.forEach(el => { el.style.display = 'none'; });

  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

  const restore = () => {
    dreh.zurueck();
    versteckt.forEach(el => { el.style.display = ''; });
    chrome.forEach((el, i) => { el.style.display = prevChromeDisplay[i]; });
  };

  try {
    const canvas = await window.html2canvas(mapEl, {
      useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: '#eef2f5',
    });
    restore();
    _lpState.satBild = { dataUrl: canvas.toDataURL('image/jpeg', 0.85), bounds };
    _lpState.satBildAn = true;
    _lpState.kartenausschnitt = bounds; // Bild + Vektor-Overlay müssen denselben Ausschnitt nutzen
    // Stand die Arbeitskarte gedreht, übernimmt der Plan diesen Winkel — das Bild
    // selbst ist nord-oben und wird im Plan mitgedreht (Blattecken bleiben dann leer).
    if (dreh.winkel) _lpState.drehung = dreh.winkel;
    _lpSatBusy = false;
    // Reihenfolge: erst neu rendern, DANN melden — lpRenderPanel() baut das Panel-HTML
    // komplett neu auf und würde eine vorher gesetzte Statusmeldung sofort wegwerfen.
    lpRenderPanel();
    lpSay('✓ Satellitenbild eingefangen und als Kartenausschnitt übernommen.'
      + (dreh.winkel ? ` Plandrehung auf ${dreh.winkel > 0 ? '+' : ''}${dreh.winkel}° gesetzt — an den Blattecken fehlt dann Bildmaterial.` : ''));
  } catch (err) {
    restore();
    _lpSatBusy = false;
    lpSay('Satellitenbild konnte nicht erzeugt werden: ' + (err?.message || err), true);
  }
}

/**
 * Zeichnet EINEN Karten-Ausschnitt (Gebäude/Kreise/Netz/Assets/Beschriftungen +
 * Maßstab + Nordpfeil) in ein gegebenes Plot-Rechteck. Von lpRenderSvg() extrahiert,
 * damit lpRenderSvgVergleich() denselben Code für zwei nebeneinanderliegende Pläne
 * wiederverwenden kann, statt ihn zu duplizieren. `tr` ist der fertige Transform
 * (null = keine Geodaten UND kein fester Kartenausschnitt → nur Platzhaltertext).
 */
function lpZeichnePlot({ col, energieInfo, tr, ausschnitt, plotX, plotY, plotW, plotH, clipId, txt, T }) {
  const { gebaeudeListe, waermeListe, stromListe, msRingListe, assetListe } = col;
  let out = `<rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}" fill="${T.neutral.cardBg}" stroke="${T.line}" stroke-width="1"/>`;
  out += `<clipPath id="${clipId}"><rect x="${plotX}" y="${plotY}" width="${plotW}" height="${plotH}"/></clipPath>`;

  if (!tr) {
    out += txt(plotX + plotW / 2, plotY + plotH / 2, 'Keine Geodaten für diese Auswahl — Zeithorizont/Ebenen/Assets oben anpassen.',
      { anchor: 'middle', size: 13, fill: T.text.faint });
    return out;
  }

  const pathOf = pts => pts.map(p => { const s = tr.toSvg(p.lat, p.lng); return `${lbR(s.x)},${lbR(s.y)}`; }).join(' ');
  const gebFarbCache = new Map();
  // Bei festem Kartenausschnitt kann Geometrie über den Rand hinausragen — dann sauber
  // am Rahmen abschneiden (bei automatischem Zuschnitt ohnehin wirkungslos).
  out += `<g clip-path="url(#${clipId})">`;

  // Satellitenbild-Hintergrund — nur gültig, wenn er zum aktuellen Kartenausschnitt passt
  // (siehe lpCaptureSatellite: setzt beide gemeinsam, damit sie nie auseinanderlaufen).
  if (_lpState.satBildAn && _lpState.satBild && lpBoundsGleich(_lpState.satBild.bounds, ausschnitt)) {
    // Das Kachelbild ist nord-oben orientiert: erst achsenparallel platzieren (toSvgUnrot),
    // dann per SVG-transform um dieselbe Bildmitte mitdrehen wie der Rest des Plans. Bei
    // gedrehtem Plan bleiben dadurch die Blattecken bildlos — dort lag im nord-oben
    // eingefangenen Ausschnitt schlicht kein Bildmaterial.
    const tl = tr.toSvgUnrot(ausschnitt.north, ausschnitt.west), br = tr.toSvgUnrot(ausschnitt.south, ausschnitt.east);
    const satDreh = tr.drehDeg ? ` transform="rotate(${lbR(tr.drehDeg)} ${lbR(tr.svgCx)} ${lbR(tr.svgCy)})"` : '';
    out += `<image href="${_lpState.satBild.dataUrl}" x="${lbR(tl.x)}" y="${lbR(tl.y)}" width="${lbR(br.x - tl.x)}" height="${lbR(br.y - tl.y)}"${satDreh} preserveAspectRatio="none"/>`;
  }

  // Gebäude — bei "Energiekennwert" bleibt die Fläche neutral (T.tint), die Farbe
  // trägt dann der Kreis darüber, genau wie auf der echten Karte (Fläche = Umriss,
  // Kreis = Kennwert).
  for (const { g, poly, horizont } of gebaeudeListe) {
    const farbe = _lpState.einfaerben === 'energie' ? null : lpGebFarbe(g, horizont, gebFarbCache);
    out += `<polygon points="${pathOf(poly)}" fill="${farbe ? lpAufhellen(farbe) : T.tint}" stroke="${farbe || T.accents.gruenDunkel}" stroke-width="1" opacity="0.92" data-lp-mark="geb:${lbEsc(String(g.id))}"/>`;
  }
  // Energiekennwert-Kreise — 1:1 wie auf der Karte: Farbe + Fläche ∝ Kennwert
  if (energieInfo) {
    for (const w of energieInfo.werte) {
      const c = lpPolyCentroid(w.g.polygon);
      if (!c) continue;
      const s = tr.toSvg(c.lat, c.lng);
      const farbe = lpEnergieFarbe(_lpState.energieModus, w.farbwert, energieInfo.farbMin, energieInfo.farbMax);
      const radius = lpEnergieRadius(w.groessenwert, energieInfo.groessenMax);
      // Eigenes data-lp-mark (nicht nur auf dem darunterliegenden Polygon): der Kreis liegt
      // im Energiekennwert-Modus optisch darüber und würde Klicks sonst abfangen, ohne dass
      // .closest() das Polygon findet (Geschwister-Elemente, kein Vorfahre).
      out += `<circle cx="${lbR(s.x)}" cy="${lbR(s.y)}" r="${lbR(radius)}" fill="${farbe}" fill-opacity="0.88" stroke="#fff" stroke-width="1" data-lp-mark="geb:${lbEsc(String(w.g.id))}"/>`;
    }
  }
  // Wärmenetz
  for (const { pts } of waermeListe) {
    out += `<polyline points="${pathOf(pts)}" fill="none" stroke="${T.energy.waerme}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // Stromnetz
  for (const { pts } of stromListe) {
    out += `<polyline points="${pathOf(pts)}" fill="none" stroke="${T.energy.strom}" stroke-width="2" stroke-dasharray="7 3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  // MS-Ring — dick, orange, oberhalb des normalen Stromnetzes
  for (const pts of msRingListe) {
    out += `<polyline points="${pathOf(pts)}" fill="none" stroke="#FB8C00" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`;
  }
  // Assets — kleine Marker mit Typ-Icon/-Farbe aus ASSET_CFG
  for (const { asset, lat, lng } of assetListe) {
    const s = tr.toSvg(lat, lng);
    const cfg = window.ASSET_CFG?.[asset.type] || {};
    out += `<circle cx="${lbR(s.x)}" cy="${lbR(s.y)}" r="8.5" fill="${cfg.color || '#607d8b'}" stroke="#fff" stroke-width="1.5" data-lp-mark="asset:${lbEsc(String(asset.id))}"/>`;
    if (cfg.icon) out += `<text x="${lbR(s.x)}" y="${lbR(s.y) + 3.5}" text-anchor="middle" font-size="9">${lbEsc(cfg.icon)}</text>`;
  }

  // Beschriftungen — Name/Nummer von Gebäuden + Assets, dezent unter/neben dem Symbol.
  // WELCHE Gruppen benannt werden, steuert die Auswahl im Panel (Gebäude + je Asset-Typ),
  // damit sich z. B. ein Plan bauen lässt, der nur die Trafo-Namen zeigt. Jede Beschriftung
  // trägt `data-lp-stdlabel-drag` und lässt sich im Plan mit der Maus an eine freie Stelle
  // ziehen (Offset in _lpLabelOffsets) — nötig, weil sich die Namen bei dicht stehenden
  // Gebäuden sonst gegenseitig überdecken. Bewusst kein Auto-Layout: der Nutzer soll das
  // Blatt für das Gutachten selbst aufräumen können.
  if (_lpState.beschriftung) {
    const stdLabel = (key, x, y, text, o) => {
      const off = _lpLabelOffsets.get(key) || { dx: 0, dy: 0 };
      return `<text x="${lbR(x + off.dx)}" y="${lbR(y + off.dy)}" text-anchor="middle" font-family="${T.font}"`
        + ` font-size="${o.size}" font-weight="${o.weight}" fill="${o.fill}"`
        + ` data-lp-stdlabel-drag="${lbEsc(key)}" style="cursor:move;">${lbEsc(text)}</text>`;
    };
    if (_lpState.labelGeb) {
      for (const { g, poly } of gebaeudeListe) {
        const c = lpPolyCentroid(poly);
        if (!c) continue;
        const s = tr.toSvg(c.lat, c.lng);
        out += stdLabel(`geb:${g.id}`, s.x, s.y + 3.5, lpGebLabel(g), { size: 8.5, weight: 600, fill: T.text.strong });
      }
    }
    for (const { asset, lat, lng } of assetListe) {
      if (_lpLabelTypes[asset.type] === false) continue;
      const s = tr.toSvg(lat, lng);
      out += stdLabel(`asset:${asset.id}`, s.x, s.y + 19,
        asset.name || window.ASSET_CFG?.[asset.type]?.label || asset.type,
        { size: 8, weight: 400, fill: T.text.muted });
    }
  }

  // Einzeln markierte Objekte — Hervorhebungsring (nur wenn "Hervorheben" an), gestrichelter
  // Auswahlring (nur für das gerade im Panel geöffnete Objekt) und optionale eigene, per Ziehen
  // verschiebbare Beschriftung. Ausgeblendete Objekte (sichtbar:false) tauchen in gebaeudeListe/
  // assetListe gar nicht mehr auf (Filter in lpSammleGeometrie) — hier ist daher nur zu klären,
  // WIE ein sichtbares, markiertes Objekt zusätzlich gekennzeichnet wird.
  if (_lpMarkierungen.size) {
    for (const [key, m] of _lpMarkierungen.entries()) {
      let anchor = null;
      if (m.kind === 'geb') {
        const item = gebaeudeListe.find(x => String(x.g.id) === m.id);
        if (!item) continue;
        const c = lpPolyCentroid(item.poly);
        if (!c) continue;
        anchor = tr.toSvg(c.lat, c.lng);
        if (m.hervorheben) out += `<polygon points="${pathOf(item.poly)}" fill="none" stroke="${LP_MARK_FARBE}" stroke-width="3"/>`;
        if (key === _lpSelected) out += `<polygon points="${pathOf(item.poly)}" fill="none" stroke="#2196F3" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      } else if (m.kind === 'asset') {
        const item = assetListe.find(x => String(x.asset.id) === m.id);
        if (!item) continue;
        anchor = tr.toSvg(item.lat, item.lng);
        if (m.hervorheben) out += `<circle cx="${lbR(anchor.x)}" cy="${lbR(anchor.y)}" r="12.5" fill="none" stroke="${LP_MARK_FARBE}" stroke-width="2.5"/>`;
        if (key === _lpSelected) out += `<circle cx="${lbR(anchor.x)}" cy="${lbR(anchor.y)}" r="16" fill="none" stroke="#2196F3" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      }
      if (anchor && m.text) {
        // offset=0/0 → Standardposition knapp über dem Objekt; per Ziehen an der Beschriftung
        // (data-lp-label-drag, siehe lpWireNachjustieren) verschiebt sich NUR der Offset, die
        // Bezugsposition bleibt am Objekt hängen (überlebt also Pan/Zoom/Filterwechsel).
        const off = m.offset || { dx: 0, dy: 0 };
        const baseDy = m.kind === 'geb' ? -9 : -14;
        const lx = anchor.x + off.dx, ly = anchor.y + baseDy + off.dy;
        out += `<text x="${lbR(lx)}" y="${lbR(ly)}" text-anchor="middle" font-family="${T.font}" font-size="10" font-weight="700" fill="${LP_MARK_FARBE}" data-lp-label-drag="${lbEsc(key)}" style="cursor:move;">${lbEsc(m.text)}</text>`;
      }
    }
  }

  out += `</g>`; // /clipPath-Gruppe

  // Maßstabsbalken unten links im Kartenfeld
  const balkenM = lpNiceScale(130, tr.metersPerPx);
  const balkenPx = balkenM / tr.metersPerPx;
  const bx = plotX + 14, by = plotY + plotH - 16;
  out += `<line x1="${bx}" y1="${by}" x2="${lbR(bx + balkenPx)}" y2="${by}" stroke="${T.text.strong}" stroke-width="2"/>`;
  out += `<line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}" stroke="${T.text.strong}" stroke-width="1.5"/>`;
  out += `<line x1="${lbR(bx + balkenPx)}" y1="${by - 4}" x2="${lbR(bx + balkenPx)}" y2="${by + 4}" stroke="${T.text.strong}" stroke-width="1.5"/>`;
  out += txt(bx + balkenPx / 2, by - 7, balkenM >= 1000 ? `${balkenM / 1000} km` : `${balkenM} m`,
    { anchor: 'middle', size: 10, weight: 600, mono: true });
  // Absichtlich gegen _lpState.kartenausschnitt geprüft, nicht gegen den lokalen `ausschnitt`-
  // Parameter: im Vorher/Nachher-Vergleich ist `ausschnitt` auch bei automatischer Anpassung
  // gesetzt (gemeinsame Bounding Box beider Jahre, s. lpRenderSvgVergleich) — der Hinweis soll
  // aber nur erscheinen, wenn der Nutzer den Ausschnitt tatsächlich manuell fixiert hat.
  if (_lpState.kartenausschnitt) out += txt(bx, by + 15, 'Fester Kartenausschnitt', { size: 8, fill: T.text.faint });

  // Nordpfeil oben rechts im Kartenfeld — dreht mit dem Plan mit. Das "N" sitzt weiterhin
  // am Pfeilfuß (mitgedreht), wird aber gegengedreht gezeichnet und bleibt so lesbar.
  const nx = plotX + plotW - 30, ny = plotY + 34;
  const nDeg = tr.drehDeg || 0;
  const nOpen = nDeg ? `<g transform="rotate(${lbR(nDeg)} ${nx} ${ny})">` : '';
  const nClose = nDeg ? '</g>' : '';
  out += nOpen;
  out += `<polygon points="${nx},${ny - 16} ${nx - 6},${ny + 8} ${nx},${ny + 3} ${nx + 6},${ny + 8}" fill="${T.text.strong}"/>`;
  out += nDeg ? `<g transform="rotate(${lbR(-nDeg)} ${nx} ${ny + 22})">` : '';
  out += txt(nx, ny + 22, 'N', { anchor: 'middle', size: 12, weight: 700 });
  out += nDeg ? '</g>' : '';
  out += nClose;
  if (nDeg) out += txt(plotX + plotW - 14, plotY + plotH - 8, `Plan gedreht: ${nDeg > 0 ? '+' : ''}${nDeg}°`,
    { anchor: 'end', size: 8, fill: T.text.faint });

  return out;
}

function lpRenderSvg() {
  const T = GG_THEME, S = T.sheet;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);
  const col = lpSammleGeometrie();
  const { gebaeudeListe, waermeListe, stromListe, msRingListe, assetListe } = col;
  const legendItems = lpBuildLegendItems(col);
  // Früh berechnet (nicht erst beim Zeichnen), weil sowohl die Kreise als auch die
  // Gradienten-Legende dieselben Min/Max brauchen und die Legende die Blatthöhe mitbestimmt.
  const energieInfo = _lpState.einfaerben === 'energie' && gebaeudeListe.length
    ? lpEnergieDaten(gebaeudeListe, _lpState.energieModus, _lpState.zieljahr) : null;

  const headH = S.headH;
  const plotX = 40, plotY = S.headBand + headH + 24, plotW = LP_W - 2 * plotX, plotH = LP_PLOT_H;
  const legendPack = lpPackLegend(legendItems, plotX, plotW);
  const legendY = plotY + plotH + 22;
  const energieLegendY = legendY + legendPack.rows * 20 + 6;
  const energieLegendH = energieInfo ? 34 : 0;
  const summaryY = energieLegendY + energieLegendH + 4;
  const height = summaryY + 20 + S.footSpace;

  const G = { S, W: LP_W, headH, reduziert: false, height };
  const zielLabel = _lpState.anzeige === 'alle' ? ` — Stand ${_lpState.zieljahr}`
    : ` — ${{bestand:'Bestand', neubau:'Neubau', abriss:'Rückbau'}[_lpState.anzeige]} ${_lpState.referenzjahr}–${_lpState.zieljahr}`;
  let out = ggSheetHeader({
    eyebrow: 'Elektrotechnisches Gutachten', titel: 'Lageplan der Liegenschaft' + zielLabel,
    ort: lpLiegenschaft(),
    meta: { 'Datum': new Date().toLocaleDateString('de-DE'), 'Bearbeiter': window.pdBearbeiterStrom || window.pdBearbeiterWaerme || '', 'WE-Nr.': window.pdWeNummer || '' },
  }, T, G);

  const allePunkte = [
    ...gebaeudeListe.flatMap(x => x.poly),
    ...waermeListe.flatMap(x => x.pts),
    ...stromListe.flatMap(x => x.pts),
    ...msRingListe.flat(),
    ...assetListe.map(x => ({ lat: x.lat, lng: x.lng })),
  ];
  const ausschnitt = _lpState.kartenausschnitt;
  const tr = (allePunkte.length || ausschnitt) ? lpBuildTransform(allePunkte, plotX, plotY, plotW, plotH, 0.07, ausschnitt) : null;
  _lpLastPlots = tr ? [{ tr, plotX, plotY, plotW, plotH }] : [];
  out += lpZeichnePlot({ col, energieInfo, tr, ausschnitt, plotX, plotY, plotW, plotH, clipId: 'lpPlotClip', txt, T });

  // Freie Beschriftungen (Text/Linie) — schon in Plan-Koordinaten, unabhängig vom obigen
  // Zweig zeichenbar; eigene Clip-Gruppe, weil sie außerhalb von dessen <g> liegen können.
  if (_lpAnnotations.length) {
    out += `<g clip-path="url(#lpPlotClip)">`;
    for (const a of _lpAnnotations) {
      if (a.type === 'text') {
        out += txt(a.x, a.y, a.text, { size: 11.5, weight: 600, fill: LP_ANNO_FARBE });
      } else {
        out += `<line x1="${lbR(a.x1)}" y1="${lbR(a.y1)}" x2="${lbR(a.x2)}" y2="${lbR(a.y2)}" stroke="${LP_ANNO_FARBE}" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round"/>`;
        out += `<circle cx="${lbR(a.x1)}" cy="${lbR(a.y1)}" r="2.5" fill="${LP_ANNO_FARBE}"/><circle cx="${lbR(a.x2)}" cy="${lbR(a.y2)}" r="2.5" fill="${LP_ANNO_FARBE}"/>`;
        if (a.text) out += txt((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2 - 6, a.text, { anchor: 'middle', size: 10, weight: 600, fill: LP_ANNO_FARBE });
      }
    }
    out += `</g>`;
  }

  // Legende (dynamisch, mehrzeilig)
  for (const it of legendPack.laid) {
    const ly = legendY + it.y;
    if (it.art === 'flaeche') out += `<rect x="${it.x}" y="${ly - 9}" width="16" height="11" fill="${lpAufhellen(it.farbe)}" stroke="${it.farbe}" stroke-width="1"/>`;
    else if (it.art === 'punkt') out += `<circle cx="${it.x + 8}" cy="${ly - 4}" r="6.5" fill="${it.farbe}" stroke="#fff" stroke-width="1"/>`;
    else out += `<line x1="${it.x}" y1="${ly - 4}" x2="${it.x + 16}" y2="${ly - 4}" stroke="${it.farbe}" stroke-width="2.4" ${it.dash ? 'stroke-dasharray="7 3"' : ''}/>`;
    out += txt(it.x + 22, ly, it.label, { size: 11 });
  }

  // Gradienten-Legende für den Energiekennwert — Farbverlauf entspricht exakt dem
  // CSS-Verlauf der echten Karte (updateViz() in 02c-karte-werkzeuge.js).
  if (energieInfo) {
    const modus = _lpState.energieModus, gradId = 'lpEnergieGrad';
    const stops = LP_ENERGIE_GRADIENT[modus];
    out += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">`
      + stops.map((c, i) => `<stop offset="${i / (stops.length - 1) * 100}%" stop-color="${c}"/>`).join('')
      + `</linearGradient></defs>`;
    const gx = plotX, gy = energieLegendY, gw = 160, gh = 9;
    out += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="url(#${gradId})" stroke="${T.line}" stroke-width="1"/>`;
    const einheit = LP_ENERGIE_EINHEIT[modus];
    const minLabel = modus === 'spez' ? '≤ 20' : modus === 'verlust' ? '0' : (isFinite(energieInfo.farbMin) ? Math.round(energieInfo.farbMin).toLocaleString('de-DE') : '—');
    const maxLabel = modus === 'spez' ? '≥ 250' : modus === 'verlust' ? '≥ 20' : (isFinite(energieInfo.farbMax) ? Math.round(energieInfo.farbMax).toLocaleString('de-DE') : '—');
    out += txt(gx, gy + gh + 11, `${minLabel} ${einheit}`, { size: 8.5, fill: T.text.faint });
    out += txt(gx + gw, gy + gh + 11, `${maxLabel} ${einheit}`, { anchor: 'end', size: 8.5, fill: T.text.faint });
    out += txt(gx + gw + 14, gy + gh - 1, `Farbe/Kreisgröße = ${LP_ENERGIE_LABEL[modus]}`, { size: 10.5, fill: T.text.muted });
  }

  // Zusammenfassung
  out += txt(plotX, summaryY, lpZusammenfassung(col), { size: 10.5, fill: T.text.muted });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `0 0 ${LP_W} ${lbR(height)}`);
  svg.setAttribute('width', LP_W);
  svg.setAttribute('height', lbR(height));
  svg.innerHTML = out;
  return svg;
}

/**
 * Vorher/Nachher-Doppellageplan: Referenzjahr (Bestand) und Zieljahr (Ausbauziel) als
 * zwei Momentaufnahmen nebeneinander, mit GEMEINSAMEM Kartenausschnitt/Maßstab (sonst
 * wären die beiden Pläne nicht direkt vergleichbar) und — bei aktivem Energiekennwert —
 * gemeinsamer Farb-/Größenskala (siehe lpEnergieSkala). Ebenen-/Einfärbe-/Asset-Auswahl
 * gelten identisch für beide Seiten; nur der Zeitpunkt unterscheidet sich.
 */
function lpRenderSvgVergleich() {
  const T = GG_THEME, S = T.sheet;
  const txt = (x, y, s, o) => ggTxt(T, S, x, y, s, o);

  const jahrA = _lpState.referenzjahr, jahrB = _lpState.zieljahr;
  const colA = lpSammleGeometrieJahr(jahrA);
  const colB = lpSammleGeometrieJahr(jahrB);

  const legendItems = lpBuildLegendItems({
    gebaeudeListe: [...colA.gebaeudeListe, ...colB.gebaeudeListe],
    waermeListe: [...colA.waermeListe, ...colB.waermeListe],
    stromListe: [...colA.stromListe, ...colB.stromListe],
    msRingListe: [...colA.msRingListe, ...colB.msRingListe],
    assetListe: [...colA.assetListe, ...colB.assetListe],
  });

  let energieInfoA = null, energieInfoB = null;
  if (_lpState.einfaerben === 'energie') {
    const werteA = colA.gebaeudeListe.map(({ g }) => ({ g, ...lpEnergieWert(g, _lpState.energieModus, jahrA) }));
    const werteB = colB.gebaeudeListe.map(({ g }) => ({ g, ...lpEnergieWert(g, _lpState.energieModus, jahrB) }));
    const skala = lpEnergieSkala([...werteA, ...werteB]);
    energieInfoA = { werte: werteA, ...skala };
    energieInfoB = { werte: werteB, ...skala };
  }

  const headH = S.headH, subH = 22, gap = 24;
  const plotX = 40, plotY = S.headBand + headH + 24 + subH;
  const plotWHalf = (LP_W - 2 * plotX - gap) / 2, plotH = LP_PLOT_H_VERGLEICH;
  const plotXA = plotX, plotXB = plotX + plotWHalf + gap;

  const legendPack = lpPackLegend(legendItems, plotX, LP_W - 2 * plotX);
  const legendY = plotY + plotH + 22;
  const energieLegendY = legendY + legendPack.rows * 20 + 6;
  const energieLegendH = energieInfoA ? 34 : 0;
  const summaryY = energieLegendY + energieLegendH + 4;
  const height = summaryY + 20 + S.footSpace;

  const G = { S, W: LP_W, headH, reduziert: false, height };
  let out = ggSheetHeader({
    eyebrow: 'Elektrotechnisches Gutachten', titel: 'Lageplan der Liegenschaft — Vorher/Nachher-Vergleich',
    ort: lpLiegenschaft(),
    meta: { 'Datum': new Date().toLocaleDateString('de-DE'), 'Bearbeiter': window.pdBearbeiterStrom || window.pdBearbeiterWaerme || '', 'WE-Nr.': window.pdWeNummer || '' },
  }, T, G);

  const allePunkte = [
    ...colA.gebaeudeListe.flatMap(x => x.poly), ...colB.gebaeudeListe.flatMap(x => x.poly),
    ...colA.waermeListe.flatMap(x => x.pts), ...colB.waermeListe.flatMap(x => x.pts),
    ...colA.stromListe.flatMap(x => x.pts), ...colB.stromListe.flatMap(x => x.pts),
    ...colA.msRingListe.flat(), ...colB.msRingListe.flat(),
    ...colA.assetListe.map(x => ({ lat: x.lat, lng: x.lng })), ...colB.assetListe.map(x => ({ lat: x.lat, lng: x.lng })),
  ];
  // Gemeinsamer Ausschnitt für beide Seiten: fester Kartenausschnitt, falls gesetzt,
  // sonst Bounding Box über BEIDE Jahre (nicht je Seite einzeln — sonst unterschiedlicher
  // Maßstab/Framing und die beiden Pläne wären nicht mehr direkt vergleichbar).
  const ausschnitt = _lpState.kartenausschnitt || lpAutoBounds(allePunkte);
  const trA = ausschnitt ? lpBuildTransform([], plotXA, plotY, plotWHalf, plotH, 0.07, ausschnitt) : null;
  const trB = ausschnitt ? lpBuildTransform([], plotXB, plotY, plotWHalf, plotH, 0.07, ausschnitt) : null;
  _lpLastPlots = [
    ...(trA ? [{ tr: trA, plotX: plotXA, plotY, plotW: plotWHalf, plotH }] : []),
    ...(trB ? [{ tr: trB, plotX: plotXB, plotY, plotW: plotWHalf, plotH }] : []),
  ];

  out += txt(plotXA + plotWHalf / 2, plotY - 9, `Bestand · ${jahrA}`, { anchor: 'middle', size: 12, weight: 700, fill: T.text.strong });
  out += txt(plotXB + plotWHalf / 2, plotY - 9, `Ausbauziel · ${jahrB}`, { anchor: 'middle', size: 12, weight: 700, fill: T.text.strong });

  out += lpZeichnePlot({ col: colA, energieInfo: energieInfoA, tr: trA, ausschnitt, plotX: plotXA, plotY, plotW: plotWHalf, plotH, clipId: 'lpPlotClipA', txt, T });
  out += lpZeichnePlot({ col: colB, energieInfo: energieInfoB, tr: trB, ausschnitt, plotX: plotXB, plotY, plotW: plotWHalf, plotH, clipId: 'lpPlotClipB', txt, T });

  // Legende (dynamisch, mehrzeilig, für beide Seiten gemeinsam)
  for (const it of legendPack.laid) {
    const ly = legendY + it.y;
    if (it.art === 'flaeche') out += `<rect x="${it.x}" y="${ly - 9}" width="16" height="11" fill="${lpAufhellen(it.farbe)}" stroke="${it.farbe}" stroke-width="1"/>`;
    else if (it.art === 'punkt') out += `<circle cx="${it.x + 8}" cy="${ly - 4}" r="6.5" fill="${it.farbe}" stroke="#fff" stroke-width="1"/>`;
    else out += `<line x1="${it.x}" y1="${ly - 4}" x2="${it.x + 16}" y2="${ly - 4}" stroke="${it.farbe}" stroke-width="2.4" ${it.dash ? 'stroke-dasharray="7 3"' : ''}/>`;
    out += txt(it.x + 22, ly, it.label, { size: 11 });
  }

  // Gradienten-Legende — gemeinsame Skala beider Seiten (energieInfoA.farbMin/farbMax === energieInfoB.*)
  if (energieInfoA) {
    const modus = _lpState.energieModus, gradId = 'lpEnergieGrad';
    const stops = LP_ENERGIE_GRADIENT[modus];
    out += `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">`
      + stops.map((c, i) => `<stop offset="${i / (stops.length - 1) * 100}%" stop-color="${c}"/>`).join('')
      + `</linearGradient></defs>`;
    const gx = plotX, gy = energieLegendY, gw = 160, gh = 9;
    out += `<rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" fill="url(#${gradId})" stroke="${T.line}" stroke-width="1"/>`;
    const einheit = LP_ENERGIE_EINHEIT[modus];
    const minLabel = modus === 'spez' ? '≤ 20' : modus === 'verlust' ? '0' : (isFinite(energieInfoA.farbMin) ? Math.round(energieInfoA.farbMin).toLocaleString('de-DE') : '—');
    const maxLabel = modus === 'spez' ? '≥ 250' : modus === 'verlust' ? '≥ 20' : (isFinite(energieInfoA.farbMax) ? Math.round(energieInfoA.farbMax).toLocaleString('de-DE') : '—');
    out += txt(gx, gy + gh + 11, `${minLabel} ${einheit}`, { size: 8.5, fill: T.text.faint });
    out += txt(gx + gw, gy + gh + 11, `${maxLabel} ${einheit}`, { anchor: 'end', size: 8.5, fill: T.text.faint });
    out += txt(gx + gw + 14, gy + gh - 1, `Farbe/Kreisgröße = ${LP_ENERGIE_LABEL[modus]} (beide Seiten gleiche Skala)`, { size: 10.5, fill: T.text.muted });
  }

  // Zusammenfassung — je Seite eine Zeile
  out += txt(plotXA, summaryY, `${jahrA}: ${lpZusammenfassung(colA)}`, { size: 10.5, fill: T.text.muted });
  out += txt(plotXB, summaryY, `${jahrB}: ${lpZusammenfassung(colB)}`, { size: 10.5, fill: T.text.muted });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `0 0 ${LP_W} ${lbR(height)}`);
  svg.setAttribute('width', LP_W);
  svg.setAttribute('height', lbR(height));
  svg.innerHTML = out;
  return svg;
}

function lpLaengeM(punkte) {
  let s = 0;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1], b = punkte[i];
    const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const latRef = (a.lat + b.lat) / 2 * Math.PI / 180;
    const dx = dLng * LP_R * Math.cos(latRef), dy = dLat * LP_R;
    s += Math.hypot(dx, dy);
  }
  return s;
}

function lpLiegenschaft() {
  const name = document.querySelector('.header-projekt-name')?.textContent?.trim() || '';
  const plz = document.getElementById('gl-plz')?.value?.trim() || '';
  const ort = document.getElementById('gl-stadt')?.value?.trim() || '';
  return [name, [plz, ort].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

const LP_INP_STYLE = 'padding:5px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--text,#e8eaed);font-family:inherit;font-size:11px;';

function lpPanelHtml() {
  const inp = LP_INP_STYLE;
  const jahrFeld = (key, label, title) => `<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted);" title="${lbEsc(title || '')}">${lbEsc(label)}
    <input type="number" value="${_lpState[key]}" data-change="lpSetJahr('${key}',this.value)" style="${inp}width:76px;"></label>`;
  const anzeigeBtn = (id, label) => `<button data-click="lpSetAnzeige('${id}')" style="padding:5px 11px;border-radius:14px;border:1px solid ${_lpState.anzeige===id?'#26a69a':'rgba(255,255,255,.14)'};background:${_lpState.anzeige===id?'rgba(38,166,154,.16)':'transparent'};color:${_lpState.anzeige===id?'#26a69a':'var(--muted)'};font-family:inherit;font-size:10px;cursor:pointer;white-space:nowrap;">${label}</button>`;
  const chk = (checked, label, onClick, title) => `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;" title="${lbEsc(title || '')}">
    <input type="checkbox" ${checked ? 'checked' : ''} data-change="${onClick}">${lbEsc(label)}</label>`;
  const d = _lpState.drehung || 0;
  const drehBtn = (v, label) => `<button data-click="lpSetDrehung(${v})" title="Plan auf ${v}° drehen"
    style="padding:4px 9px;border-radius:12px;border:1px solid ${d===v?'#26a69a':'rgba(255,255,255,.14)'};background:${d===v?'rgba(38,166,154,.16)':'transparent'};color:${d===v?'#26a69a':'var(--muted)'};font-family:inherit;font-size:10px;cursor:pointer;white-space:nowrap;">${label}</button>`;
  const scaleBtn = (v) => `<button data-click="lpSetScale(${v})" style="padding:4px 10px;border-radius:12px;border:1px solid ${_lpScale===v?'#26a69a':'rgba(255,255,255,.14)'};background:${_lpScale===v?'rgba(38,166,154,.16)':'transparent'};color:${_lpScale===v?'#26a69a':'var(--muted)'};font-family:inherit;font-size:10px;cursor:pointer;">${v}×</button>`;
  const vergleichBtn = `<button data-click="lpToggleVergleich()" title="Zeigt Referenzjahr (Bestand) und Zieljahr (Ausbauziel) als zwei Lagepläne nebeneinander — gleicher Maßstab und Kartenausschnitt für beide Seiten"
    style="padding:5px 11px;border-radius:14px;border:1px solid ${_lpState.vergleich?'#26a69a':'rgba(255,255,255,.14)'};background:${_lpState.vergleich?'rgba(38,166,154,.16)':'transparent'};color:${_lpState.vergleich?'#26a69a':'var(--muted)'};font-family:inherit;font-size:10px;cursor:pointer;white-space:nowrap;">🔀 Vorher/Nachher-Vergleich</button>`;

  const assetTypen = Object.keys(_lpAssetCounts).sort((a, b) =>
    (window.ASSET_CFG?.[a]?.label || a).localeCompare(window.ASSET_CFG?.[b]?.label || b));
  const assetChecks = assetTypen.map(t => {
    const cfg = window.ASSET_CFG?.[t] || {};
    return chk(!!_lpAssetTypes[t], `${cfg.icon ? cfg.icon + ' ' : ''}${cfg.label || t} (${_lpAssetCounts[t]})`, `lpSetAssetType('${t}',this.checked)`, cfg.beschreibung);
  }).join('');
  // Beschriftungs-Auswahl: dieselbe Typenliste, aber die Frage ist "wird benannt?" statt
  // "wird gezeichnet?". Ist die zugehörige Ebene aus, kann nichts beschriftet werden — das
  // steht am Eintrag dran, statt ihn zu verstecken (sonst sucht man den Trafo-Haken vergeblich).
  const labelChecks = assetTypen.map(t => {
    const cfg = window.ASSET_CFG?.[t] || {};
    const ebeneAus = !_lpAssetTypes[t];
    return chk(_lpLabelTypes[t] !== false,
      `${cfg.icon ? cfg.icon + ' ' : ''}${cfg.label || t}${ebeneAus ? ' — Ebene aus' : ''}`,
      `lpSetLabelType('${t}',this.checked)`,
      ebeneAus ? 'Diese Asset-Ebene wird gerade nicht gezeichnet — oben unter "Assets im Plan" einschalten, dann erscheinen auch die Namen.' : (cfg.beschreibung || ''));
  }).join('');
  const kleinBtn = (onClick, label, title) => `<button data-click="${onClick}" title="${lbEsc(title || '')}"
    style="padding:4px 10px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:10.5px;cursor:pointer;">${label}</button>`;

  return `
  <div style="display:flex;flex-wrap:wrap;gap:14px 22px;align-items:flex-end;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:6px;">
    ${jahrFeld('referenzjahr', 'Referenzjahr', 'Baseline für "Bestand" — was zu diesem Jahr schon existiert')}
    ${jahrFeld('zieljahr', 'Zieljahr (Ausbauziel)', 'Stichjahr, auf das der Plan sich bezieht')}
    <div style="display:flex;flex-direction:column;gap:3px;">
      <span style="font-size:10px;color:var(--muted);">Anzeige</span>
      ${_lpState.vergleich
        ? `<span style="font-size:10px;color:var(--muted);max-width:230px;">Vorher/Nachher zeigt Referenz- und Zieljahr automatisch als zwei Bestands-Zeitpunkte.</span>`
        : `<div style="display:flex;gap:6px;flex-wrap:wrap;">${anzeigeBtn('alle', 'Alle bis Zieljahr')}${anzeigeBtn('bestand', 'Nur Bestand')}${anzeigeBtn('neubau', 'Nur Neubau')}${anzeigeBtn('abriss', 'Nur Rückbau')}</div>`}
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;">
      <span style="font-size:10px;color:var(--muted);">&nbsp;</span>
      ${vergleichBtn}
    </div>
    <label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted);">Gebäude einfärben nach
      <select data-change="lpSetEinfaerben(this.value)" style="${inp}">
        <option value="keine" ${_lpState.einfaerben==='keine'?'selected':''}>Keine (einheitlich)</option>
        <option value="nutzung" ${_lpState.einfaerben==='nutzung'?'selected':''}>Nutzungstyp</option>
        <option value="status" ${_lpState.einfaerben==='status'?'selected':''}>Status (Bestand/Neubau/Rückbau)</option>
        <option value="energie" ${_lpState.einfaerben==='energie'?'selected':''}>Energiekennwert (Kreise, wie auf der Karte)</option>
      </select></label>
    ${_lpState.einfaerben === 'energie' ? `<label style="display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted);">Kennwert
      <select data-change="lpSetEnergieModus(this.value)" style="${inp}">
        <option value="spez" ${_lpState.energieModus==='spez'?'selected':''}>Spez. Wärmebedarf</option>
        <option value="heizlast" ${_lpState.energieModus==='heizlast'?'selected':''}>Heizlast</option>
        <option value="verlust" ${_lpState.energieModus==='verlust'?'selected':''}>Netzverlust</option>
      </select></label>` : ''}
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:10px;">
    <div style="display:flex;flex-wrap:wrap;gap:10px 16px;">
      ${chk(_lpState.gebaeude, 'Gebäude', "lpSetLayer('gebaeude',this.checked)")}
      ${chk(_lpState.waerme, 'Wärmenetz', "lpSetLayer('waerme',this.checked)")}
      ${chk(_lpState.strom, 'Stromnetz', "lpSetLayer('strom',this.checked)")}
      ${chk(_lpState.msring, 'MS-Ring hervorheben', "lpSetLayer('msring',this.checked)", 'Erkennt Mittelspannungs-Ringe aus NAP/Trafo/Schaltanlage + Stromnetz und hebt sie dick orange hervor')}
      ${chk(_lpState.beschriftung, 'Beschriftungen', "lpSetLayer('beschriftung',this.checked)", 'Namen im Plan anzeigen — welche Gruppen benannt werden (z. B. nur die Trafos), steht darunter in der Auswahl')}
    </div>
    <div style="display:flex;gap:6px;margin-left:auto;">${[2,3,4].map(scaleBtn).join('')}</div>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;">
    <button data-click="lpUebernehmeKartenausschnitt()" title="Übernimmt den aktuell auf der Karte sichtbaren Zoom/Ausschnitt statt automatisch an die gezeichneten Objekte anzupassen"
      style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:10.5px;cursor:pointer;">📍 Aktuellen Kartenausschnitt übernehmen</button>
    <div style="display:flex;gap:4px;">
      <button data-click="lpZoomSchritt(0.8)" title="Im Plan hineinzoomen (oder Mausrad über dem Plan)"
        style="padding:5px 9px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:11px;cursor:pointer;">🔍+</button>
      <button data-click="lpZoomSchritt(1.25)" title="Im Plan herauszoomen (oder Mausrad über dem Plan)"
        style="padding:5px 9px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:11px;cursor:pointer;">🔍−</button>
    </div>
    ${_lpState.kartenausschnitt
      ? `<button data-click="lpKartenausschnittZuruecksetzen()" style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:10.5px;cursor:pointer;">↺ Automatisch an Inhalt anpassen</button>
         <span style="font-size:10px;color:#26a69a;">Fester Ausschnitt aktiv</span>`
      : `<span style="font-size:10px;color:var(--muted);">Automatisch an die gezeichneten Objekte angepasst</span>`}
    <span style="font-size:10px;color:var(--muted);width:100%;">🖱 Im Plan direkt ziehen zum Verschieben, Mausrad zum Zoomen — feines Nachjustieren ohne zur Karte zu wechseln.</span>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;">
    <span style="font-size:10px;color:var(--muted);white-space:nowrap;">Ausrichtung des Plans</span>
    <input type="range" min="-180" max="180" step="1" value="${d}"
      title="Dreht den kompletten Plan — Geometrie, Satellitenbild und Nordpfeil. 0° = Norden oben."
      data-input="lpDrehungVorschau(this.value)" data-change="lpSetDrehung(this.value)" style="width:170px;">
    <input id="lp-dreh-zahl" type="number" min="-180" max="180" step="1" value="${d}"
      data-change="lpSetDrehung(this.value)" style="${inp}width:62px;">
    <span style="font-size:10px;color:var(--muted);">°</span>
    <div style="display:flex;gap:4px;">${drehBtn(0, 'Nord oben')}${drehBtn(-45, '−45°')}${drehBtn(-90, '−90°')}${drehBtn(45, '+45°')}${drehBtn(90, '+90°')}</div>
    ${_lpAchse
      ? `<span style="font-size:10px;color:#ffcc80;">🖱 ${_lpAchse.p1 ? 'Zweiten' : 'Ersten'} Punkt der Achse im Plan anklicken …</span>
         <button data-click="lpAbbrechenAchse()" style="padding:5px 11px;border-radius:5px;border:1px solid rgba(239,83,80,.4);background:transparent;color:#ef5350;font-family:inherit;font-size:10.5px;cursor:pointer;">Abbrechen</button>`
      : `<button data-click="lpStartAchse()" title="Zwei Punkte im Plan anklicken (z. B. Anfang und Ende der Hauptstraße) — der Plan wird so gedreht, dass diese Achse senkrecht steht"
           style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:10.5px;cursor:pointer;">📐 An Achse ausrichten</button>`}
    <span style="font-size:10px;color:var(--muted);width:100%;">Für Liegenschaften, deren Hauptachse schräg zur Nordrichtung liegt. Nordpfeil und Satellitenbild drehen mit — an den Blattecken kann das Bild dann fehlen (auf der Karte weiter herauszoomen und neu einfangen). Freie Beschriftungen hängen an Blattkoordinaten und drehen NICHT mit.</span>
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;">
    <button data-click="lpCaptureSatellite()" ${_lpSatBusy ? 'disabled' : ''}
      title="Fängt die aktuell sichtbaren Kartenkacheln (Luftbild, falls aktiv) als Hintergrund ein und legt den Kartenausschnitt exakt darauf fest"
      style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:${_lpSatBusy?'var(--muted)':'#26a69a'};font-family:inherit;font-size:10.5px;cursor:${_lpSatBusy?'default':'pointer'};">🛰 Satellitenbild einfangen</button>
    ${_lpState.satBild ? chk(_lpState.satBildAn, 'als Hintergrund zeigen', 'lpSetSatBildAn(this.checked)') : ''}
    <span style="font-size:10px;color:var(--muted);">${window.map?.hasLayer?.(window.esriTile) ? 'Kartenhintergrund: Luftbild' : 'Kartenhintergrund: Straßenkarte — beim Einfangen automatisch auf Luftbild umgeschaltet'}</span>
  </div>

  ${assetTypen.length ? `
  <div style="margin-bottom:12px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">Assets im Plan</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;">${assetChecks}</div>
  </div>` : ''}

  ${_lpState.beschriftung ? `
  <div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:6px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px;">Beschriftungen — was benannt wird</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;">
      ${chk(_lpState.labelGeb, `Gebäude${_lpState.gebaeude ? '' : ' — Ebene aus'}`, "lpSetLayer('labelGeb',this.checked)", 'Nummer und Name jedes gezeichneten Gebäudes')}
      ${labelChecks}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;">
      ${kleinBtn('lpLabelAuswahl(true)', 'Alle', 'Alle Gruppen beschriften')}
      ${kleinBtn('lpLabelAuswahl(false)', 'Keine', 'Keine Gruppe beschriften — dann gezielt einzelne wieder anhaken')}
      ${_lpLabelOffsets.size ? kleinBtn('lpResetLabelOffsets()', `↺ ${_lpLabelOffsets.size} verschobene zurücksetzen`, 'Setzt alle von Hand verschobenen Beschriftungen auf ihre Standardposition am Objekt zurück') : ''}
    </div>
    <span style="display:block;margin-top:6px;font-size:10px;color:var(--muted);">🖱 Einzelne Beschriftung im Plan anfassen und ziehen, wenn sich Namen überdecken — sie bleibt an ihrem Objekt hängen (Verschieben/Zoomen/Jahreswechsel ändern daran nichts). Ein Klick ohne Ziehen öffnet den Objekt-Editor unten.</span>
  </div>` : ''}

  <div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:6px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Freie Beschriftungen</div>
    ${_lpState.vergleich ? `<div style="font-size:10.5px;color:var(--muted);">Im Vorher/Nachher-Vergleich nicht verfügbar (zwei unterschiedlich große Planflächen) — dafür bitte die Einzelansicht nutzen.</div>` : `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;${_lpAnnotations.length ? 'margin-bottom:8px;' : ''}">
      <input id="lp-anno-text" type="text" placeholder="Text (z. B. „geplante Erweiterung“) — bei Linie optional"
        value="${lbEsc(_lpPlacing?.text || '')}" ${_lpPlacing ? 'disabled' : ''} style="${inp}flex:1;min-width:200px;">
      <button data-click="lpStartPlacing('text')" ${_lpPlacing ? 'disabled' : ''}
        style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:${_lpPlacing?'var(--muted)':'#e8eaed'};font-family:inherit;font-size:10.5px;cursor:${_lpPlacing?'default':'pointer'};">✎ Text platzieren</button>
      <button data-click="lpStartPlacing('line')" ${_lpPlacing ? 'disabled' : ''}
        style="padding:5px 11px;border-radius:5px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:${_lpPlacing?'var(--muted)':'#e8eaed'};font-family:inherit;font-size:10.5px;cursor:${_lpPlacing?'default':'pointer'};">📏 Linie platzieren</button>
      ${_lpPlacing ? `<span style="font-size:10px;color:#ffcc80;">🖱 Auf den Plan klicken${_lpPlacing.type === 'line' ? (_lpPlacing.x1 == null ? ' — Startpunkt' : ' — Endpunkt') : ''} …</span>
        <button data-click="lpCancelPlacing()" style="padding:5px 11px;border-radius:5px;border:1px solid rgba(239,83,80,.4);background:transparent;color:#ef5350;font-family:inherit;font-size:10.5px;cursor:pointer;">Abbrechen</button>` : ''}
    </div>
    ${_lpAnnotations.length ? `<div style="display:flex;flex-direction:column;gap:4px;">
      ${_lpAnnotations.map(a => `<div style="display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--muted);">
        <span>${a.type === 'text' ? '✎' : '📏'}</span>
        <span style="flex:1;">${lbEsc(a.text || (a.type === 'line' ? 'Linie ohne Beschriftung' : ''))}</span>
        <button data-click="lpRemoveAnnotation(${a.id})" title="Entfernen" style="background:transparent;border:none;color:#ef5350;cursor:pointer;font-size:12px;">✕</button>
      </div>`).join('')}
    </div>` : ''}`}
  </div>

  <div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:6px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px;">Hervorgehobene / einzeln beschriftete Objekte</div>
    ${_lpSelected ? lpMarkEditorHtml() : ''}
    ${_lpMarkierungen.size ? `<div style="display:flex;flex-direction:column;gap:4px;">
      ${[..._lpMarkierungen.entries()].filter(([key]) => key !== _lpSelected).map(([key, m]) => `<div style="display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--muted);">
        <span style="color:${LP_MARK_FARBE};opacity:${m.sichtbar === false ? 0.4 : 1};">●</span>
        <button data-click="lpSelectMarkierung('${lbEsc(key)}')" style="flex:1;text-align:left;background:transparent;border:none;color:var(--muted);cursor:pointer;padding:0;font:inherit;">${lbEsc(lpMarkObjName(m.kind, m.id))}${m.text ? ` — „${lbEsc(m.text)}“` : ''}${m.sichtbar === false ? ' (ausgeblendet)' : ''}</button>
        <button data-click="lpRemoveMarkierung('${lbEsc(key)}')" title="Entfernen" style="background:transparent;border:none;color:#ef5350;cursor:pointer;font-size:12px;">✕</button>
      </div>`).join('')}
    </div>` : (_lpSelected ? '' : `<div style="font-size:10.5px;color:var(--muted);">Auf ein Gebäude oder Asset im Plan klicken, um es hervorzuheben, auszublenden oder individuell zu beschriften.</div>`)}
  </div>

  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
    <button data-click="lpCopy()" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(38,166,154,.6);background:rgba(38,166,154,.18);color:#26a69a;font-family:inherit;font-size:11px;cursor:pointer;">⧉ Für Word kopieren</button>
    <button data-click="lpSavePng()" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:11px;cursor:pointer;">⤓ PNG</button>
    <button data-click="lpSaveSvg()" style="padding:6px 12px;border-radius:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--muted);font-family:inherit;font-size:11px;cursor:pointer;">⤓ SVG</button>
    <span style="margin-left:auto;font-size:10px;color:var(--muted);align-self:center;">In Word mit Strg+V einfügen — SVG bleibt Vektor über Einfügen › Bilder.</span>
  </div>
  <div id="lp-status" style="font-size:11px;color:#26a69a;min-height:16px;margin-bottom:8px;"></div>
  <div id="lp-paper" style="background:#fff;border-radius:6px;padding:10px;overflow-x:auto;"></div>`;
}

/**
 * Nur das Planblatt neu zeichnen, ohne das Panel-HTML anzufassen. Nötig für das flüssige
 * Ziehen am Drehregler: ein kompletter innerHTML-Neuaufbau würde dem Regler mitten in der
 * Mausbewegung den Fokus entziehen und das Ziehen nach dem ersten Schritt abbrechen.
 */
function lpRenderPaper() {
  const paper = document.getElementById('lp-paper');
  if (!paper) return;
  _lpSvg = _lpState.vergleich ? lpRenderSvgVergleich() : lpRenderSvg();
  _lpSvg.style.width = '100%';
  _lpSvg.style.maxWidth = LP_W + 'px';
  _lpSvg.style.height = 'auto';
  _lpSvg.style.display = 'block';
  paper.replaceChildren(_lpSvg);
  if (_lpLastPlots.length && !_lpPlacing && !_lpAchse) _lpSvg.style.cursor = 'grab';
  lpAttachPlacingHandler();
  lpAttachAchseHandler();
}

function lpRenderPanel() {
  const el = document.getElementById('lb-lp-panel');
  if (!el) return;
  if (_lpState.referenzjahr == null) _lpState.referenzjahr = new Date().getFullYear();
  if (_lpState.zieljahr == null) _lpState.zieljahr = window.globalYear || _lpState.referenzjahr;
  lpAssetTypenAktualisieren();
  el.innerHTML = lpPanelHtml();
  lpRenderPaper();
  lpWireNachjustieren();
}

function lpSay(msg, err) {
  const el = document.getElementById('lp-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = err ? '#ef5350' : '#26a69a';
}

/**
 * Solange `_lpPlacing` aktiv ist, wandelt ein Klick auf die SVG-Vorschau die Bildschirm-
 * Koordinaten über die Screen-CTM in SVG-Nutzkoordinaten um (robust gegenüber der
 * Skalierung durch `width:100%`) und legt Text sofort bzw. eine Linie nach zwei Klicks an.
 */
function lpAttachPlacingHandler() {
  if (!_lpPlacing || !_lpSvg) return;
  _lpSvg.style.cursor = 'crosshair';
  const onClick = (evt) => {
    const pt = _lpSvg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(_lpSvg.getScreenCTM().inverse());
    if (_lpPlacing.type === 'text') {
      _lpAnnotations.push({ id: _lpAnnoNextId++, type: 'text', x: p.x, y: p.y, text: _lpPlacing.text });
      _lpPlacing = null;
      _lpSvg.removeEventListener('click', onClick);
      lpRenderPanel();
    } else if (_lpPlacing.x1 == null) {
      _lpPlacing.x1 = p.x; _lpPlacing.y1 = p.y;
      lpSay('Startpunkt gesetzt — jetzt den Endpunkt anklicken.');
    } else {
      _lpAnnotations.push({ id: _lpAnnoNextId++, type: 'line', x1: _lpPlacing.x1, y1: _lpPlacing.y1, x2: p.x, y2: p.y, text: _lpPlacing.text });
      _lpPlacing = null;
      _lpSvg.removeEventListener('click', onClick);
      lpRenderPanel();
    }
  };
  _lpSvg.addEventListener('click', onClick);
}

/**
 * Zwei Klicks in den Plan → Drehwinkel. Läuft über dieselbe Umkehrprojektion wie das
 * Ziehen/Zoomen (tr.fromSvg), damit die Achse geografisch gemeint ist und nicht in
 * Blattpixeln — der Winkel bleibt also korrekt, egal wie der Plan gerade steht.
 */
function lpAttachAchseHandler() {
  if (!_lpAchse || !_lpSvg) return;
  _lpSvg.style.cursor = 'crosshair';
  const onClick = (evt) => {
    const p = lpSvgPunkt(_lpSvg, evt);
    const plot = lpPlotUnter(p);
    if (!plot) { lpSay('Bitte innerhalb der Planfläche klicken.', true); return; }
    const geo = plot.tr.fromSvg(p.x, p.y);
    if (!_lpAchse.p1) {
      _lpAchse.p1 = geo;
      lpSay('Erster Punkt gesetzt — jetzt den zweiten Punkt der Achse anklicken.');
      return;
    }
    _lpSvg.removeEventListener('click', onClick);
    const winkel = lpAchsenWinkel(_lpAchse.p1, geo);
    _lpAchse = null;
    if (winkel == null) { lpRenderPanel(); lpSay('Die beiden Punkte liegen zu dicht beieinander.', true); return; }
    _lpState.drehung = winkel;
    lpRenderPanel();
    lpSay(`Plan an der gewählten Achse ausgerichtet — Drehung ${winkel > 0 ? '+' : ''}${winkel}°.`);
  };
  _lpSvg.addEventListener('click', onClick);
}

/** Bildschirm- → SVG-Nutzkoordinaten der übergebenen SVG-Wurzel (Skalierungs-robust). */
function lpSvgPunkt(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
/** Findet aus _lpLastPlots den Plot, dessen Rechteck den gegebenen SVG-Punkt enthält (oder null). */
function lpPlotUnter(p) {
  return _lpLastPlots.find(pl => p.x >= pl.plotX && p.x <= pl.plotX + pl.plotW && p.y >= pl.plotY && p.y <= pl.plotY + pl.plotH) || null;
}

let _lpNachjustierenWired = false;
// mode 'pan': {mode,startPt,tr,sichtbar,raf,moved,markTarget} — verschiebt den Kartenausschnitt.
// mode 'label': {mode,startPt,key,startOffset,raf,moved} — verschiebt NUR den Text-Offset einer Markierung.
// mode 'stdlabel': wie 'label', aber für eine normale Objekt-Beschriftung (_lpLabelOffsets).
let _lpDrag = null;

/**
 * Ziehen (verschieben) und Mausrad (zoomen) direkt auf dem gerenderten Plan — ergänzt das
 * bisherige "Aktuellen Kartenausschnitt übernehmen" (das nur den kompletten Sichtbereich der
 * ECHTEN Karte 1:1 kopiert) um ein Nachjustieren ohne zur Karte zurückzuwechseln. Wird EINMAL
 * dauerhaft verdrahtet (Delegation auf das stabile #lb-lp-panel-Element, das über Re-Renders
 * hinweg bestehen bleibt — im Gegensatz zu #lp-paper/der SVG selbst, die lpRenderPanel() bei
 * JEDEM Aufruf neu erzeugt) statt bei jedem Re-Render neue Listener anzuhäufen.
 */
function lpWireNachjustieren() {
  if (_lpNachjustierenWired) return;
  const panel = document.getElementById('lb-lp-panel');
  if (!panel) return; // Panel noch nicht im DOM — beim nächsten lpRenderPanel() erneut versuchen
  _lpNachjustierenWired = true;

  panel.addEventListener('mousedown', (evt) => {
    if (_lpPlacing || _lpAchse || evt.button !== 0 || !_lpSvg) return;
    const svg = evt.target.closest('svg');
    if (!svg || svg !== _lpSvg) return;
    const startPt = lpSvgPunkt(svg, evt);
    const plot = lpPlotUnter(startPt);
    if (!plot) return;
    // Ziehen an einer individuellen Beschriftung verschiebt NUR deren Offset, nicht den
    // ganzen Plan — deshalb VOR der allgemeinen Pan-Logik geprüft (die Beschriftung liegt
    // optisch über allem anderen).
    const stdLabelEl = evt.target.closest('[data-lp-stdlabel-drag]');
    if (stdLabelEl) {
      const key = stdLabelEl.getAttribute('data-lp-stdlabel-drag');
      _lpDrag = { mode: 'stdlabel', startPt, key, startOffset: { ...(_lpLabelOffsets.get(key) || { dx: 0, dy: 0 }) }, raf: null, moved: false };
      svg.style.cursor = 'move';
      evt.preventDefault();
      return;
    }
    const labelEl = evt.target.closest('[data-lp-label-drag]');
    if (labelEl) {
      const key = labelEl.getAttribute('data-lp-label-drag');
      const m = _lpMarkierungen.get(key);
      if (m) {
        _lpDrag = { mode: 'label', startPt, key, startOffset: { ...(m.offset || { dx: 0, dy: 0 }) }, raf: null, moved: false };
        svg.style.cursor = 'move';
        evt.preventDefault();
        return;
      }
    }
    // Sichtbarer Geo-Ausschnitt DIESES Plots als Basis — aus dem Transform abgeleitet, nicht
    // aus _lpState.kartenausschnitt gelesen: so ist es der TATSÄCHLICH sichtbare (bereits mit
    // Rand-Padding versehene) Rahmen, egal ob automatisch angepasst oder fest — kein Sprung
    // beim ersten Ziehen.
    // markTarget wird schon beim Mousedown eingefroren (nicht erst beim Mouseup gesucht):
    // damit bleibt eindeutig, WELCHES Objekt gemeint war, selbst wenn der Klick durch das
    // spätere Neu-Rendern (Drag/Zoom) unter dem Cursor durch ein anderes Element ersetzt wird.
    _lpDrag = {
      mode: 'pan', startPt, tr: plot.tr, sichtbar: plot.tr.sichtbarerAusschnitt(plot.plotW, plot.plotH),
      raf: null, moved: false, markTarget: evt.target.closest('[data-lp-mark]'),
    };
    svg.style.cursor = 'grabbing';
    evt.preventDefault();
  });

  window.addEventListener('mousemove', (evt) => {
    if (!_lpDrag || !_lpSvg) return;
    const p = lpSvgPunkt(_lpSvg, evt);
    const dx = p.x - _lpDrag.startPt.x, dy = p.y - _lpDrag.startPt.y;
    // Kleine Zitterbewegungen (Trackpad, Klick-Ungenauigkeit) sollen noch als "Klick" zählen,
    // nicht schon als Ziehen — Schwelle in SVG-Nutzeinheiten (Blattbreite 1000 = grob 1000px).
    if (Math.hypot(dx, dy) > 4) _lpDrag.moved = true;
    if (_lpDrag.raf) return;
    _lpDrag.raf = requestAnimationFrame(() => {
      if (!_lpDrag) return;
      _lpDrag.raf = null;
      if (_lpDrag.mode === 'stdlabel') {
        _lpLabelOffsets.set(_lpDrag.key, { dx: _lpDrag.startOffset.dx + dx, dy: _lpDrag.startOffset.dy + dy });
        lpRenderPanel();
        return;
      }
      if (_lpDrag.mode === 'label') {
        const m = _lpMarkierungen.get(_lpDrag.key);
        if (m) { m.offset = { dx: _lpDrag.startOffset.dx + dx, dy: _lpDrag.startOffset.dy + dy }; lpRenderPanel(); }
        return;
      }
      const { tr, sichtbar } = _lpDrag;
      // Verschiebung ist translationsinvariant (braucht kein Zentrum), aber drehungsabhängig:
      // bei gedrehtem Plan zeigen Bildschirm-dx/dy nicht mehr nach Osten/Norden.
      const { dlat, dlng } = tr.planDelta(dx, dy);
      _lpState.kartenausschnitt = {
        south: sichtbar.south - dlat, north: sichtbar.north - dlat,
        west: sichtbar.west - dlng, east: sichtbar.east - dlng,
      };
      _lpState.satBild = null; // Ausschnitt geändert — ein evtl. eingefangenes Satellitenbild passt nicht mehr
      lpRenderPanel();
    });
  });

  window.addEventListener('mouseup', () => {
    if (!_lpDrag) return;
    if (_lpSvg) _lpSvg.style.cursor = _lpDrag.mode === 'pan' ? 'grab' : 'move';
    if (!_lpDrag.moved) {
      // Kein Ziehen (Maus quasi nicht bewegt) → als Klick werten: auf einer Beschriftung oder
      // einem Objekt öffnet/schließt das den Inline-Editor, auf leerer Fläche im Plot wählt
      // eine offene Markierung wieder ab.
      // Klick (ohne Ziehen) auf eine Beschriftung meint dasselbe wie ein Klick auf das Objekt
      // selbst — der Schlüssel hat in beiden Fällen die Form `geb:<id>` / `asset:<id>`.
      if (_lpDrag.mode === 'label' || _lpDrag.mode === 'stdlabel') window.lpSelectMarkierung(_lpDrag.key);
      else if (_lpDrag.markTarget) window.lpSelectMarkierung(_lpDrag.markTarget.getAttribute('data-lp-mark'));
      else if (_lpSelected) window.lpDeselectMarkierung();
    }
    _lpDrag = null;
  });

  panel.addEventListener('wheel', (evt) => {
    if (_lpPlacing || _lpAchse || !_lpSvg) return;
    const svg = evt.target.closest('svg');
    if (!svg || svg !== _lpSvg) return;
    const p = lpSvgPunkt(svg, evt);
    const plot = lpPlotUnter(p);
    if (!plot) return;
    evt.preventDefault();
    const basis = plot.tr.sichtbarerAusschnitt(plot.plotW, plot.plotH);
    const ziel = plot.tr.fromSvg(p.x, p.y); // Geo-Punkt unter dem Cursor — bleibt beim Zoomen fix
    const faktor = evt.deltaY > 0 ? 1.15 : 1 / 1.15; // runter = raus (größerer Ausschnitt), hoch = rein
    _lpState.kartenausschnitt = {
      south: ziel.lat - (ziel.lat - basis.south) * faktor, north: ziel.lat + (basis.north - ziel.lat) * faktor,
      west: ziel.lng - (ziel.lng - basis.west) * faktor, east: ziel.lng + (basis.east - ziel.lng) * faktor,
    };
    _lpState.satBild = null;
    lpRenderPanel();
  }, { passive: false });
}

/** Anzeigename eines Gebäudes/Assets für den Inline-Editor und die Panel-Liste. */
function lpMarkObjName(kind, id) {
  if (kind === 'geb') {
    const g = (window.gebaeude || []).find(x => String(x.id) === id);
    return g ? lpGebLabel(g) : id;
  }
  const a = typeof window.listAssets === 'function' ? window.listAssets().find(x => String(x.id) === id) : null;
  return a?.name || window.ASSET_CFG?.[a?.type]?.label || id;
}

/** Eine Markierung gilt als "leer", wenn sie nichts vom Standard abweicht — wird beim Abwählen automatisch entfernt, statt als Karteileiche liegen zu bleiben. */
function lpMarkIstLeer(m) {
  return !m.text && m.sichtbar !== false && !m.hervorheben && (!m.offset || (!m.offset.dx && !m.offset.dy));
}
function lpMarkAuswahlAufraeumen() {
  if (_lpSelected && _lpMarkierungen.has(_lpSelected) && lpMarkIstLeer(_lpMarkierungen.get(_lpSelected))) {
    _lpMarkierungen.delete(_lpSelected);
  }
}

/**
 * Klick auf ein Gebäude/Asset im Plan (kein Ziehen) — wählt es aus und öffnet den Inline-
 * Editor im Panel (Text/Hervorheben/Sichtbarkeit statt eines prompt()-Dialogs). Erneuter Klick
 * auf dasselbe Objekt wählt ab. Eine unveränderte (leere) vorherige Auswahl wird beim Wechsel
 * automatisch aufgeräumt, damit bloßes Anklicken zum Ansehen keine Karteileichen hinterlässt.
 */
window.lpSelectMarkierung = (key) => {
  if (_lpSelected === key) { window.lpDeselectMarkierung(); return; }
  lpMarkAuswahlAufraeumen();
  _lpSelected = key;
  if (!_lpMarkierungen.has(key)) {
    const sep = key.indexOf(':');
    _lpMarkierungen.set(key, { kind: key.slice(0, sep), id: key.slice(sep + 1), text: '', sichtbar: true, hervorheben: false, offset: { dx: 0, dy: 0 } });
  }
  lpRenderPanel();
};
window.lpDeselectMarkierung = () => { lpMarkAuswahlAufraeumen(); _lpSelected = null; lpRenderPanel(); };
window.lpSetMarkText = (key, val) => { const m = _lpMarkierungen.get(key); if (m) { m.text = val.trim(); lpRenderPanel(); } };
window.lpSetMarkFlag = (key, flag, val) => { const m = _lpMarkierungen.get(key); if (m) { m[flag] = !!val; lpRenderPanel(); } };
window.lpResetMarkOffset = (key) => { const m = _lpMarkierungen.get(key); if (m) { m.offset = { dx: 0, dy: 0 }; lpRenderPanel(); } };
window.lpRemoveMarkierung = (key) => { _lpMarkierungen.delete(key); if (_lpSelected === key) _lpSelected = null; lpRenderPanel(); };

/** Inline-Editor für die aktuell ausgewählte Markierung — Text, Hervorheben, Sichtbarkeit. */
function lpMarkEditorHtml() {
  const m = _lpMarkierungen.get(_lpSelected);
  if (!m) return '';
  const name = lpMarkObjName(m.kind, m.id);
  const verschoben = m.offset && (m.offset.dx || m.offset.dy);
  return `
  <div style="padding:8px;border:1px solid rgba(233,30,99,.35);border-radius:6px;background:rgba(233,30,99,.06);margin-bottom:8px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:600;color:#e8eaed;flex:1;">${lbEsc(name)}</span>
      <button data-click="lpDeselectMarkierung()" style="padding:3px 9px;border-radius:4px;border:1px solid rgba(255,255,255,.14);background:transparent;color:var(--muted);font-family:inherit;font-size:10px;cursor:pointer;">Fertig</button>
    </div>
    <input type="text" placeholder="Individuelle Beschriftung (leer = keine)" value="${lbEsc(m.text)}"
      data-change="lpSetMarkText('${lbEsc(_lpSelected)}', this.value)" style="${LP_INP_STYLE}width:100%;margin-bottom:8px;box-sizing:border-box;">
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;">
        <input type="checkbox" ${m.hervorheben ? 'checked' : ''} data-change="lpSetMarkFlag('${lbEsc(_lpSelected)}','hervorheben',this.checked)">Hervorheben (Rahmen)</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;">
        <input type="checkbox" ${m.sichtbar !== false ? 'checked' : ''} data-change="lpSetMarkFlag('${lbEsc(_lpSelected)}','sichtbar',this.checked)">Im Plan anzeigen</label>
      ${verschoben ? `<button data-click="lpResetMarkOffset('${lbEsc(_lpSelected)}')" style="padding:3px 9px;border-radius:4px;border:1px solid rgba(255,255,255,.14);background:transparent;color:var(--muted);font-family:inherit;font-size:10px;cursor:pointer;">Textposition zurücksetzen</button>` : ''}
    </div>
    ${m.text ? `<div style="font-size:10px;color:var(--muted);margin-top:6px;">🖱 Beschriftung im Plan direkt anfassen und verschieben.</div>` : ''}
  </div>`;
}

/** Zoomt symmetrisch um die Mitte des aktuell sichtbaren Ausschnitts — für die +/- Buttons im Panel. */
window.lpZoomSchritt = (faktor) => {
  const plot = _lpLastPlots[0];
  if (!plot) return;
  const b = plot.tr.sichtbarerAusschnitt(plot.plotW, plot.plotH);
  const mitteLat = (b.south + b.north) / 2, mitteLng = (b.west + b.east) / 2;
  _lpState.kartenausschnitt = {
    south: mitteLat - (mitteLat - b.south) * faktor, north: mitteLat + (b.north - mitteLat) * faktor,
    west: mitteLng - (mitteLng - b.west) * faktor, east: mitteLng + (b.east - mitteLng) * faktor,
  };
  _lpState.satBild = null;
  lpRenderPanel();
};

window.lpSetLayer = (key, on) => { _lpState[key] = !!on; lpRenderPanel(); };
window.lpSetJahr = (key, val) => { const n = parseInt(val, 10); if (isFinite(n)) _lpState[key] = n; lpRenderPanel(); };
window.lpSetAnzeige = (id) => { _lpState.anzeige = id; lpRenderPanel(); };
window.lpSetEinfaerben = (v) => { _lpState.einfaerben = v; lpRenderPanel(); };
window.lpToggleVergleich = () => { _lpState.vergleich = !_lpState.vergleich; lpRenderPanel(); };
window.lpSetEnergieModus = (v) => { _lpState.energieModus = v; lpRenderPanel(); };
window.lpSetAssetType = (t, on) => { _lpAssetTypes[t] = !!on; lpRenderPanel(); };
window.lpSetLabelType = (t, on) => { _lpLabelTypes[t] = !!on; lpRenderPanel(); };
window.lpLabelAuswahl = (on) => {
  _lpState.labelGeb = !!on;
  for (const t of Object.keys(_lpAssetCounts)) _lpLabelTypes[t] = !!on;
  lpRenderPanel();
};
window.lpResetLabelOffsets = () => { _lpLabelOffsets.clear(); lpRenderPanel(); };
window.lpSetScale = (v) => { _lpScale = v; };
window.lpUebernehmeKartenausschnitt = () => {
  if (!window.map || typeof window.map.getBounds !== 'function') { lpSay('Karte nicht verfügbar.', true); return; }
  // Ist der Kartendrehungs-Versuch aktiv (20-kartendrehung.js), wird der Winkel
  // gleich mit übernommen — und der Ausschnitt aus Mitte/Zoom/Fenstergröße
  // gerechnet statt aus getBounds(): leaflet-rotate liefert dort die Hülle der
  // vier gedrehten Ecken, was den Plan bei schräger Karte stark aufblähen würde.
  let neu = null;
  if (typeof window.kdAktiv === 'function' && window.kdAktiv()) {
    _lpState.drehung = window.kdWinkel();
    neu = window.kdSichtAusschnitt();
  }
  if (!neu) {
    const b = window.map.getBounds();
    neu = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  }
  // Ein Satellitenbild gehört zu genau einem Ausschnitt — bei abweichendem neuen Ausschnitt
  // verwaist es sonst (Checkbox bliebe an, ohne dass sichtbar etwas passiert).
  if (_lpState.satBild && !lpBoundsGleich(_lpState.satBild.bounds, neu)) _lpState.satBild = null;
  _lpState.kartenausschnitt = neu;
  lpRenderPanel();
};
/** Drehwinkel auf einen gültigen ganzzahligen Grad-Wert in [-180,180] bringen. */
function lpDrehWert(val) {
  const n = Math.round(parseFloat(val));
  return isFinite(n) ? Math.max(-180, Math.min(180, n)) : null;
}
window.lpSetDrehung = (val) => { const w = lpDrehWert(val); if (w != null) _lpState.drehung = w; lpRenderPanel(); };
/** Aktuelle Plandrehung — von 20-kartendrehung.js für „↔ Wie Lageplan" gelesen. */
window.lpAktuelleDrehung = () => _lpState.drehung || 0;
/** Live-Vorschau beim Ziehen am Regler — zeichnet nur das Blatt neu (s. lpRenderPaper). */
window.lpDrehungVorschau = (val) => {
  const w = lpDrehWert(val);
  if (w == null || w === _lpState.drehung) return;
  _lpState.drehung = w;
  const zahl = document.getElementById('lp-dreh-zahl');
  if (zahl) zahl.value = w;
  lpRenderPaper();
};
window.lpStartAchse = () => {
  _lpPlacing = null;   // Achsenwahl und Annotations-Platzierung schließen sich aus
  _lpAchse = { p1: null };
  lpRenderPanel();
  lpSay('🖱 Ersten Punkt der Achse im Plan anklicken (z. B. Anfang der Hauptstraße).');
};
window.lpAbbrechenAchse = () => { _lpAchse = null; lpRenderPanel(); };

window.lpKartenausschnittZuruecksetzen = () => { _lpState.kartenausschnitt = null; _lpState.satBild = null; lpRenderPanel(); };
window.lpCaptureSatellite = lpCaptureSatellite;
window.lpSetSatBildAn = (on) => { _lpState.satBildAn = !!on; lpRenderPanel(); };
window.lpStartPlacing = (type) => {
  const text = document.getElementById('lp-anno-text')?.value?.trim() || '';
  if (type === 'text' && !text) { lpSay('Bitte zuerst einen Text eingeben.', true); return; }
  _lpAchse = null;   // s. lpStartAchse — nur ein Klick-Modus zur Zeit
  _lpPlacing = { type, text };
  lpRenderPanel();
  lpSay(type === 'line' ? 'Startpunkt der Linie auf dem Plan anklicken.' : 'Position des Texts auf dem Plan anklicken.');
};
window.lpCancelPlacing = () => { _lpPlacing = null; lpRenderPanel(); };
window.lpRemoveAnnotation = (id) => { _lpAnnotations = _lpAnnotations.filter(a => a.id !== id); lpRenderPanel(); };
window.lpCopy = async () => {
  if (!_lpSvg) return;
  try { lpSay('Kopiere … ' + await ggCopyForWord(_lpSvg, _lpScale)); }
  catch (e) { lpSay('Kopieren fehlgeschlagen: ' + e.message, true); }
};
window.lpSavePng = async () => {
  if (!_lpSvg) return;
  try {
    const blob = await ggSvgToPngBlob(_lpSvg, _lpScale);
    lbDownloadBlob(blob, lbDateiname('lageplan-liegenschaft', 'png'));
    lpSay('✓ PNG heruntergeladen.');
  } catch (e) { lpSay('PNG fehlgeschlagen: ' + e.message, true); }
};
window.lpSaveSvg = () => {
  if (!_lpSvg) return;
  const blob = new Blob([ggSvgSource(_lpSvg)], { type: 'image/svg+xml;charset=utf-8' });
  lbDownloadBlob(blob, lbDateiname('lageplan-liegenschaft', 'svg'));
  lpSay('✓ SVG heruntergeladen.');
};

/* ══════════════════════════════════════════════════════════════════════════
 * 3) PANEL — Analyse-Sektion „Liegenschaftsbilder" (zwei Unter-Reiter)
 * ═══════════════════════════════════════════════════════════════════════ */
let _lbTab = 'lageplan'; // 'karte' | 'lageplan'

export function lbSetTab(tab) {
  _lbTab = tab === 'lageplan' ? 'lageplan' : 'karte';
  lbRenderTabs();
}
window.lbSetTab = lbSetTab;

function lbRenderTabs() {
  const tabBar = document.getElementById('lb-subtabs');
  if (tabBar) {
    const tabBtn = (id, label) => `<button data-click="lbSetTab('${id}')" style="padding:6px 14px;border-radius:14px;border:1px solid ${_lbTab===id?'#26a69a':'var(--border)'};background:${_lbTab===id?'rgba(38,166,154,.16)':'transparent'};color:${_lbTab===id?'#26a69a':'var(--muted)'};font-family:inherit;font-size:11px;cursor:pointer;">${label}</button>`;
    tabBar.innerHTML = tabBtn('karte', '📷 Kartenscreenshot') + tabBtn('lageplan', '📐 Vektor-Lageplan');
  }
  const capWrap = document.getElementById('lb-cap-wrap');
  const lpWrap = document.getElementById('lb-lp-wrap');
  if (capWrap) capWrap.style.display = _lbTab === 'karte' ? 'block' : 'none';
  if (lpWrap) lpWrap.style.display = _lbTab === 'lageplan' ? 'block' : 'none';
  if (_lbTab === 'karte') lbRenderCapturePanel();
  else lpRenderPanel();
}

export function lbBuildAnalyseSection() {
  const tabBar = document.getElementById('analyse-view-tabs');
  if (tabBar && !tabBar.querySelector('[data-section="liegenschaftsbilder"]')) {
    const btn = document.createElement('button');
    btn.className = 'analyse-section-tab';
    btn.dataset.section = 'liegenschaftsbilder';
    btn.textContent = '🗺️ Liegenschaftsbilder';
    btn.title = 'Echte Bilder der Liegenschaft fürs Gutachten — hochauflösender Kartenscreenshot oder ein aus den Geodaten neu gezeichneter Vektor-Lageplan (Gebäude, Wärme-/Stromnetz).';
    btn.addEventListener('click', () => {
      if (typeof window.setAnalyseSection === 'function') window.setAnalyseSection('liegenschaftsbilder');
    });
    tabBar.appendChild(btn);
  }

  if (document.getElementById('analyse-liegenschaftsbilder-wrap')) return;
  const analyseView = document.getElementById('center-analyse-view');
  if (!analyseView) return;

  const wrap = document.createElement('div');
  wrap.id = 'analyse-liegenschaftsbilder-wrap';
  wrap.style.display = 'none';
  wrap.innerHTML = `
  <div id="lb-subtabs" style="display:flex;gap:6px;margin-bottom:16px;"></div>
  <div id="lb-cap-wrap"><div id="lb-cap-panel"></div></div>
  <div id="lb-lp-wrap" style="display:none;"><div id="lb-lp-panel"></div></div>`;
  analyseView.appendChild(wrap);
}

export function lbShowSection(show) {
  const wrap = document.getElementById('analyse-liegenschaftsbilder-wrap');
  if (!wrap) return;
  wrap.style.display = show ? 'block' : 'none';
  if (show) lbRenderTabs();
}
