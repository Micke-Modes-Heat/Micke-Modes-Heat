// ── 43-umspannwerke.js — Umspannwerke in der Nähe und Direktanschluss (Größenordnung) ──
// Teil des Netzanschluss-Moduls (44-netzanschluss-modul.js, Elektro › 3 · Auswerten › Netzanschluss),
// Schritt „Optionen", + eigene Kartenebene. Zustand, Karte und Projektdatei liegen hier; das Modul
// liest die Bewertung über uwAuswahlBewertet() und gibt die Zielleistung aus dem Bedarf vor.
//
// Lädt power=substation (und HS/MS-Trafos) im Umkreis des NAP aus OpenStreetMap, schätzt
// je Umspannwerk die Trassenlänge und daraus Bezugs-/Einspeiseleistung je Kabelsystem und
// die Anschlusskosten (lib/umspannwerk-core.js). Die geladene Liste wird als Schnappschuss
// im Projekt gespeichert (project.umspannwerke) — das Ergebnis soll sich nicht ändern, nur
// weil jemand OSM bearbeitet. Ein fehlendes UW lässt sich von Hand auf die Karte setzen.

import { map } from './02b-gebaeude.js';
import { _overpassFetchWithRetry } from './03b-netz.js';
import { hideHint } from './03c-gebaeude-io.js';
import { ASSETS } from './13a-assets-core.js';
import {
  UW_PARAMETER, UW_KATEGORIEN, uwParameterMischen, uwAusOverpass, uwBewerten, uwEbene, uwSatz,
  uwMw, uwEur, uwEurSpanne, uwSpannungen, uwMsKv, uwDistanzM, UW_TRAFO_QUELLE,
} from './lib/umspannwerk-core.js';

const WRAP_ID = 'na-modul-uw';
const PANE = 'uwPane';
const STIL_KNOPF = 'font-size:11px;padding:2px 7px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;';
const STIL_ZAHL = 'width:58px;box-sizing:border-box;text-align:right;font-size:12px;';
const MAX_KANDIDATEN = 8;

let _liste = [];          // Schnappschuss der Umspannwerke (OSM + von Hand)
let _geladenAm = null;    // ISO-Datum des OSM-Abrufs
let _auswahlId = null;
let _param = {};          // nur Abweichungen von UW_PARAMETER
let _ziel = { bezugMw: null, einspMw: null };
let _zielHand = false;    // true: Zielleistung von Hand, sonst aus dem Bedarf des Moduls
let _redundant = false;   // n-1 zwischen den Kabelsystemen (ein System Reserve)
let _sichtbar = true;
let _alleZeigen = false;
let _status = '';
let _laedt = false;
let _setzen = false;      // „von Hand setzen": nächster Kartenklick legt ein UW an
let _layer = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const zahl = v => { const n = parseFloat(String(v ?? '').trim().replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
/** Neu zeichnen: im Modul das ganze Fenster (Wege-Übersicht hängt am Zustand hier), sonst nur den Abschnitt. */
const _neu = () => (typeof window.naModulRender === 'function' ? window.naModulRender() : uwRender());
const km = m => (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/* ── Bezugspunkt: NAP-Asset, sonst Mitte des Plangebiets, sonst Kartenmitte ── */
function _bezug() {
  const nap = (ASSETS.items || []).find(a => a.type === 'NAP' && Number.isFinite(a.lat) && Number.isFinite(a.lng));
  const kv = zahl(nap?.props?.spannungKV);
  const uKvNap = kv > 1 ? kv : null;
  if (nap) return { lat: nap.lat, lng: nap.lng, quelle: `NAP „${nap.name || 'NAP'}“`, uKvNap };
  const ring = window.areaLatLngs;
  if (ring?.length >= 3) {
    const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
    const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
    return { lat, lng, quelle: 'Mitte des Plangebiets (kein NAP-Asset)', uKvNap };
  }
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, quelle: 'Kartenmitte (kein NAP, kein Plangebiet)', uKvNap };
}

const _p = () => uwParameterMischen(_param);
const _auswahl = () => _liste.find(u => u.id === _auswahlId) || null;
const _kandidaten = () => _liste.filter(u => UW_KATEGORIEN[u.kategorie]?.kandidat);

/** UW für die Rechnung: Handangaben (MS-Spannung, Trafos) gehen vor OSM. */
function _rechenUw(u) {
  return {
    ...u,
    msKv: u.msKvHand || u.msKv,
    trafos: u.trafosHand ? Array.from({ length: u.trafosHand.n }, () => ({ mva: u.trafosHand.mva })) : u.trafos,
  };
}

function _bewerten(u, ref = _bezug()) {
  return uwBewerten(_rechenUw(u), { ref, uKvNap: ref.uKvNap || 20, p: _p(), ziel: _ziel, redundant: _redundant });
}

/* ── Laden ──────────────────────────────────────────────────────────────── */
/**
 * Overpass über den gemeinsamen Helfer, aber ohne abgebrochene Antworten: Bei Zeitüberschreitung
 * liefert Overpass HTTP 200 mit Teilergebnis und „remark" — der Helfer nimmt das an. Bis zu 3 Versuche.
 */
async function _abfrage(query) {
  let letzter = null;
  for (let i = 0; i < 3; i++) {
    const data = await _overpassFetchWithRetry(query);
    if (!data?.elements) return letzter;
    if (!/error|timed out|out of memory/i.test(data.remark || '')) return data;
    letzter = null;   // Teilergebnis nie verwenden
    _status = `Antwort unvollständig (${String(data.remark).slice(0, 60)}) — neuer Versuch ${i + 2}/3 …`;
    uwRender();
  }
  return letzter;
}

export async function uwLaden() {
  if (_laedt) return;
  const ref = _bezug();
  const r = Math.round(_p().radiusKm * 1000);
  const um = `(around:${r},${ref.lat.toFixed(6)},${ref.lng.toFixed(6)})`;
  // Ortsnetzstationen und Bahnstrom gleich weglassen; „bb" liefert die Grundstücksgröße zur Einordnung
  const query = `[out:json][timeout:60];
nwr["power"="substation"]["substation"!~"^(minor_distribution|traction)$"]${um};
out bb tags;`;
  _laedt = true;
  _status = `Lade Umspannwerke im Umkreis von ${_p().radiusKm} km um ${ref.quelle} …`;
  uwRender();
  let data = null;
  try { data = await _abfrage(query); }
  catch (err) { _status = '✗ OSM-Abruf fehlgeschlagen: ' + err.message; }
  if (!data?.elements) {
    _laedt = false;
    setTimeout(hideHint, 3000);
    if (!_status.startsWith('✗')) _status = '✗ Keine vollständigen OSM-Daten erhalten (offline oder Server überlastet) — später erneut versuchen.';
    uwRender();
    return;
  }
  // Zweite, kleine Abfrage: HS/MS-Trafos nur innerhalb der Kandidaten-Flächen (Leistung für die n-1-Abschätzung).
  // Fehlschlag ist unkritisch — dann gilt der typische Wert.
  const vorab = uwAusOverpass(data.elements, { ref });
  const flaechen = vorab.filter(u => UW_KATEGORIEN[u.kategorie]?.kandidat && /^(way|relation)\//.test(u.osm)).slice(0, 80);
  let elemente = data.elements;
  if (flaechen.length) {
    const ids = typ => flaechen.filter(u => u.osm.startsWith(typ + '/')).map(u => u.osm.split('/')[1]);
    const w = ids('way'), rel = ids('relation');
    const tq = `[out:json][timeout:60];
(${w.length ? `way(id:${w.join(',')});` : ''}${rel.length ? `rel(id:${rel.join(',')});` : ''});
map_to_area->.uw;
nwr(area.uw)["power"="transformer"];
out center tags;`;
    _status = `⏳ ${flaechen.length} Umspannwerke gefunden — lade Trafoangaben …`;
    uwRender();
    try {
      const td = await _abfrage(tq);
      if (td?.elements) elemente = [...elemente, ...td.elements];
    } catch (e) { void e; }
  }
  _laedt = false;
  hideHint();   // der Overpass-Helfer lässt seinen Fortschrittshinweis stehen
  const manuell = _liste.filter(u => u.kategorie === 'manuell');
  const alt = new Map(_liste.map(u => [u.id, u]));
  const neu = uwAusOverpass(elemente, { ref }).map(u => {
    const a = alt.get(u.id);   // Handangaben überstehen ein erneutes Laden
    return a ? { ...u, msKvHand: a.msKvHand, trafosHand: a.trafosHand } : u;
  });
  _liste = [...neu, ...manuell];
  _geladenAm = new Date().toISOString().slice(0, 10);
  const k = _kandidaten();
  if (!_auswahl() || !UW_KATEGORIEN[_auswahl().kategorie]?.kandidat) {
    _auswahlId = k.sort((a, b) => uwDistanzM(ref, a) - uwDistanzM(ref, b))[0]?.id ?? null;
  }
  _status = k.length
    ? `✓ ${neu.length} Anlage(n) gefunden, davon ${k.length} als Umspannwerk-Kandidat.`
    : `⚠ ${neu.length} Anlage(n) gefunden, aber kein HS/MS-Umspannwerk — Radius vergrößern oder UW von Hand setzen.`;
  _sichtbar = true;
  _zeichnen();
  _neu();
}

/* ── Karte ──────────────────────────────────────────────────────────────── */
function _pane() {
  if (!map.getPane(PANE)) {
    const p = map.createPane(PANE);
    p.style.zIndex = 640;
  }
  return PANE;
}

function _zeichnen() {
  if (_layer) { map.removeLayer(_layer); _layer = null; }
  if (!_sichtbar || !_liste.length) return;
  const pane = _pane();
  const ref = _bezug();
  const g = L.layerGroup();
  const sel = _auswahl();
  if (sel) {
    const b = _bewerten(sel, ref);
    L.polyline([[ref.lat, ref.lng], [sel.lat, sel.lng]], { pane, color: '#4fc3f7', weight: 3, dashArray: '8 6', opacity: 0.9 })
      .bindTooltip(`Direktanschluss ${esc(sel.name || 'UW')}: Luftlinie ${km(b.luftlinieM)} km · Trasse ≈ ${b.laengeKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`, { sticky: true })
      .addTo(g);
  }
  L.circleMarker([ref.lat, ref.lng], { pane, radius: 5, color: '#fff', weight: 2, fillColor: '#e53935', fillOpacity: 1 })
    .bindTooltip(`Bezugspunkt: ${esc(ref.quelle)}`).addTo(g);
  for (const u of _liste) {
    const kat = UW_KATEGORIEN[u.kategorie] || UW_KATEGORIEN.unbekannt;
    if (!kat.kandidat && !_alleZeigen) continue;
    const istSel = u.id === _auswahlId;
    const m = L.circleMarker([u.lat, u.lng], {
      pane, radius: istSel ? 10 : kat.kandidat ? 7 : 4,
      color: istSel ? '#4fc3f7' : '#222', weight: istSel ? 3 : 1, fillColor: kat.farbe, fillOpacity: 0.9,
    });
    const kv = u.kvs?.length ? u.kvs.join('/') + ' kV' : 'Spannung unbekannt';
    m.bindTooltip(`<b>${esc(u.name || 'ohne Namen')}</b><br>${esc(kat.label)} · ${esc(kv)}${u.betreiber ? '<br>' + esc(u.betreiber) : ''}`
      + `<br>Luftlinie ${km(uwDistanzM(ref, u))} km${kat.kandidat ? '<br><i>Klick: als Anschluss-UW wählen</i>' : ''}`);
    if (kat.kandidat) m.on('click', ev => { L.DomEvent.stop(ev); uwWaehlen(u.id); });
    m.addTo(g);
  }
  _layer = g.addTo(map);
}

export function uwKarteUmschalten(an) {
  _sichtbar = an === undefined ? !_sichtbar : !!an;
  _zeichnen();
  _neu();
}

export function uwZeigen() {
  const sel = _auswahl();
  if (!sel) return;
  const ref = _bezug();
  _sichtbar = true;
  _zeichnen();
  map.flyToBounds(L.latLngBounds([[ref.lat, ref.lng], [sel.lat, sel.lng]]), { padding: [60, 60], maxZoom: 15 });
}

/* ── UW von Hand setzen ─────────────────────────────────────────────────── */
function _setzenKlick(e) {
  _setzenBeenden();
  const ref = _bezug();
  const id = 'hand-' + Date.now().toString(36);
  _liste.push({
    id, osm: null, name: 'Umspannwerk (von Hand)', betreiber: '', lat: e.latlng.lat, lng: e.latlng.lng,
    kvs: [], msKv: null, msKvHand: ref.uKvNap || 20, art: '', kategorie: 'manuell', trafos: [],
  });
  _auswahlId = id;
  _status = '✓ Umspannwerk von Hand gesetzt — Name, MS-Spannung und Trafos unten prüfen.';
  _sichtbar = true;
  _zeichnen();
  _neu();
}
function _setzenTaste(ev) { if (ev.key === 'Escape') { _setzenBeenden(); uwRender(); } }
function _setzenBeenden() {
  _setzen = false;
  map.off('click', _setzenKlick);
  document.removeEventListener('keydown', _setzenTaste);
  map.getContainer().style.cursor = '';
}
export function uwVonHandSetzen() {
  if (_setzen) { _setzenBeenden(); uwRender(); return; }
  _setzen = true;
  map.getContainer().style.cursor = 'crosshair';
  map.once('click', _setzenKlick);
  document.addEventListener('keydown', _setzenTaste);
  uwRender();
}

/* ── Eingaben ───────────────────────────────────────────────────────────── */
export function uwWaehlen(id) {
  _auswahlId = id;
  _zeichnen();
  _neu();
}

export function uwAlleZeigen(an) { _alleZeigen = !!an; _zeichnen(); _neu(); }

export function uwSetZiel(feld, wert) {
  if (feld !== 'bezugMw' && feld !== 'einspMw') return;
  const v = zahl(wert);
  _ziel = { ..._ziel, [feld]: v > 0 ? v : null };
  _zielHand = true;
  _neu();
}

/** Zielleistung aus dem Bedarf des Moduls (MW) — wirkt nur, solange sie nicht von Hand gesetzt ist. */
export function uwZielVorgabe(bezugMw, einspMw) {
  if (_zielHand) return;
  const r2 = v => (v > 0 ? Math.round(v * 100) / 100 : null);
  _ziel = { bezugMw: r2(bezugMw), einspMw: r2(einspMw) };
}

/** Handeingabe verwerfen, wieder den Bedarf übernehmen. */
export function uwZielAusBedarf() { _zielHand = false; _neu(); }

/** n-1 zwischen den Kabelsystemen ein/aus. */
export function uwSetRedundant(an) { _redundant = !!an; _zeichnen(); _neu(); }

/* ── Lesezugriff für das Netzanschluss-Modul ───────────────────────────── */
export const uwRedundant = () => _redundant;
export const uwZielVonHand = () => _zielHand;
export const uwOsmStand = () => _geladenAm;
export const uwParameter = () => _p();
/** Gewähltes Umspannwerk samt Bewertung (inkl. Zielleistung und n-1) — null ohne Auswahl. */
export function uwAuswahlBewertet() {
  const u = _auswahl();
  if (!u) return null;
  return { uw: u, name: u.name || '', betreiber: u.betreiber || '', b: _bewerten(u) };
}

export function uwSetParam(key, wert) {
  if (!UW_PARAMETER[key]) return;
  const v = zahl(wert);
  if (v == null || v < 0 || v === UW_PARAMETER[key].wert) delete _param[key];
  else _param[key] = v;
  _zeichnen();
  _neu();
}

export function uwParamZuruecksetzen() { _param = {}; _zeichnen(); _neu(); }

/** Handangaben am gewählten UW: name, msKv ("20"), trafos ("2 × 40" oder "40;31,5" → n × größter Wert gemittelt). */
export function uwSetUwFeld(feld, wert) {
  const u = _auswahl();
  if (!u) return;
  const s = String(wert ?? '').trim();
  if (feld === 'name') u.name = s;
  else if (feld === 'msKv') { const v = zahl(s); u.msKvHand = v > 1 && v <= 36 ? v : null; }
  else if (feld === 'trafos') {
    const m = s.match(/^(\d+)\s*[×x*]\s*([\d.,]+)/i);
    if (m) u.trafosHand = { n: Math.max(1, parseInt(m[1], 10)), mva: zahl(m[2]) || 0 };
    else u.trafosHand = null;
  } else return;
  _zeichnen();
  _neu();
}

export function uwEntfernen(id) {
  _liste = _liste.filter(u => u.id !== id);
  if (_auswahlId === id) _auswahlId = _kandidaten()[0]?.id ?? null;
  _zeichnen();
  _neu();
}

/* ── Panel ──────────────────────────────────────────────────────────────── */
function _kandidatenHtml(ref) {
  const k = _kandidaten().map(u => ({ u, b: _bewerten(u, ref) })).sort((a, b) => a.b.luftlinieM - b.b.luftlinieM);
  if (!k.length) return '';
  const rest = _liste.length - k.length;
  const zeilen = k.slice(0, MAX_KANDIDATEN).map(({ u, b }) => {
    const sel = u.id === _auswahlId;
    const kv = u.msKvHand ? `${u.msKvHand}*` : u.kvs?.length ? u.kvs.join('/') : '?';
    return `<tr data-click="uwWaehlen('${esc(u.id)}')" style="cursor:pointer;${sel ? 'background:rgba(79,195,247,.12);' : ''}">
        <td style="padding:2px 3px;"><span style="color:${UW_KATEGORIEN[u.kategorie]?.farbe};">●</span></td>
        <td style="padding:2px 3px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(u.betreiber)}">${esc(u.name || 'ohne Namen')}</td>
        <td style="padding:2px 3px;text-align:right;">${esc(kv)}</td>
        <td style="padding:2px 3px;text-align:right;">${b.laengeKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })}</td>
        <td style="padding:2px 3px;text-align:right;">${uwMw(b.jeSystem.bezugMw)} / ${uwMw(b.jeSystem.einspMw)}</td>
      </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin:4px 0;">
      <thead><tr style="color:var(--muted);text-align:left;">
        <th></th><th style="padding:2px 3px;">Umspannwerk</th><th style="padding:2px 3px;text-align:right;">kV</th>
        <th style="padding:2px 3px;text-align:right;" title="Luftlinie × Umwegfaktor">Trasse km</th>
        <th style="padding:2px 3px;text-align:right;" title="je Kabelsystem: Bezug / Einspeisung">MW je System</th>
      </tr></thead><tbody>${zeilen}</tbody></table>
    <label style="font-size:11px;color:var(--muted);display:flex;gap:4px;align-items:center;">
      <input type="checkbox" ${_alleZeigen ? 'checked' : ''} data-change="uwAlleZeigen(this.checked)"/>
      auch übrige Anlagen auf der Karte zeigen (${rest} — Übertragungsnetz, MS-Stationen, Bahnstrom, Sonstiges)</label>`;
}

function _detailHtml(ref) {
  const u = _auswahl();
  if (!u) return '';
  const p = _p();
  const b = _bewerten(u, ref);
  const zeilen = b.stufen.map(s => `<tr>
      <td style="padding:2px 4px;">${s.systeme}</td>
      <td style="padding:2px 4px;text-align:right;">${uwMw(s.bezugMw)}</td>
      <td style="padding:2px 4px;text-align:right;">${uwMw(s.einspMw)}</td>
      <td style="padding:2px 4px;text-align:right;white-space:nowrap;">${uwEurSpanne(s.kosten.anschlussEur)}</td>
      <td style="padding:2px 4px;color:var(--c-orange);" title="${s.ueberN1 ? 'mehr als die (n-1)-Trafoleistung des UW — ohne Ausbau des UW kaum möglich' : ''}">${s.ueberN1 ? '⚠ > n-1' : ''}</td>
    </tr>`).join('');
  const grenze = g => g === 'spannung' ? 'Spannungsfall' : 'Strombelastbarkeit';
  const n1 = b.n1.mva > 0
    ? `${uwMw(b.n1.mva)} MVA (${b.n1.anzahl} × Trafo, ${u.trafosHand ? 'von Hand' : UW_TRAFO_QUELLE[b.n1.aus]})`
    : `keine Reserve — nur 1 Trafo ${u.trafosHand ? 'eingetragen' : 'in OSM'} (${uwMw(b.n1.summeMva)} MVA); fehlen weitere, unter „Trafos HS/MS“ eintragen`;
  const heuteB = window.elNapMaxBezugKw, heuteE = window.elNapMaxEinspKw;
  const heute = (heuteB > 0 || heuteE > 0)
    ? `Heute vereinbart: ${heuteB > 0 ? `${Math.round(heuteB).toLocaleString('de-DE')} kVA Bezug` : 'Bezug offen'} · ${heuteE > 0 ? `${Math.round(heuteE).toLocaleString('de-DE')} kW Einspeisung` : 'Einspeisung offen'} (⚡ Strom-Grundlagen › NAP-Grenzen).`
    : 'NAP-Grenzen (⚡ Strom-Grundlagen) nicht eingetragen — kein Vergleich mit dem heutigen Anschluss.';
  const zielMva = Math.max(_ziel.bezugMw || 0, _ziel.einspMw || 0) / p.cosPhi;
  const ebene = uwEbene(zielMva, p);
  const zielHtml = b.ziel
    ? `<div style="margin-top:4px;">→ <b>${b.ziel.systeme} Kabelsystem${b.ziel.systeme > 1 ? 'e' : ''}</b>, Anschluss grob <b>${uwEurSpanne(b.ziel.kosten.anschlussEur)}</b>`
      + `${b.ziel.kosten.bkzEur > 0 ? ` + Baukostenzuschuss ≈ ${uwEur(b.ziel.kosten.bkzEur)}` : ''}.`
      + `${ebene ? `<br>Übliche Ebene bei ${uwMw(zielMva)} MVA: ${esc(ebene.label)}.` : ''}`
      + `${b.ziel.systeme > 3 ? '<br><span style="color:var(--c-orange);">⚠ Mehr als 3 Systeme: Hochspannungsanschluss bzw. eigener Trafo im UW ist dann meist günstiger.</span>' : ''}</div>`
    : '';
  const kvHinweis = b.uAusUw ? '' : ' <span style="color:var(--c-orange);">(MS-Spannung nicht aus OSM — bitte eintragen)</span>';
  return `<div style="border:1px solid var(--border);border-radius:6px;padding:6px 8px;margin-top:6px;font-size:12px;line-height:1.45;">
      <div style="display:grid;grid-template-columns:1fr 70px 80px;gap:6px;align-items:end;margin-bottom:4px;">
        <label style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:11px;color:var(--muted);">Umspannwerk</span>
          <input class="inp-field" type="text" value="${esc(u.name)}" placeholder="ohne Namen" data-change="uwSetUwFeld('name',this.value)" style="width:100%;box-sizing:border-box;text-align:left;font-size:12px;"/></label>
        <label style="display:flex;flex-direction:column;gap:2px;" title="MS-Spannung der Sammelschiene; leer = aus OSM bzw. NAP"><span style="font-size:11px;color:var(--muted);">MS kV</span>
          <input class="inp-field" type="text" value="${esc(u.msKvHand ?? '')}" placeholder="${esc(u.msKv ?? ref.uKvNap ?? 20)}" data-change="uwSetUwFeld('msKv',this.value)" style="${STIL_ZAHL}"/></label>
        <label style="display:flex;flex-direction:column;gap:2px;" title="z. B. „2 × 40“ (Anzahl × MVA); leer = aus OSM bzw. typisch"><span style="font-size:11px;color:var(--muted);">Trafos HS/MS</span>
          <input class="inp-field" type="text" value="${u.trafosHand ? `${u.trafosHand.n} × ${u.trafosHand.mva}` : ''}" placeholder="z. B. 2 × 40" data-change="uwSetUwFeld('trafos',this.value)" style="width:80px;box-sizing:border-box;font-size:12px;"/></label>
      </div>
      <div style="color:var(--muted);font-size:11px;">${esc(UW_KATEGORIEN[u.kategorie]?.label || '')}${u.betreiber ? ' · ' + esc(u.betreiber) : ''}${u.osm ? ` · <a href="https://www.openstreetmap.org/${esc(u.osm)}" target="_blank" rel="noopener" style="color:var(--accent);">OSM</a>` : ''}
        · Luftlinie ${km(b.luftlinieM)} km · Trasse ≈ ${b.laengeKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km · ${b.uKv.toLocaleString('de-DE')} kV${kvHinweis}
        ${u.kategorie === 'manuell' ? ` · <a href="#" data-click="event.preventDefault();uwEntfernen('${esc(u.id)}')" style="color:var(--muted);">entfernen</a>` : ''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;">
        <thead><tr style="color:var(--muted);font-size:11px;text-align:left;">
          <th style="padding:2px 4px;">Systeme${_redundant ? ' (1 Reserve)' : ''}</th><th style="padding:2px 4px;text-align:right;">Bezug MW${_redundant ? ' gesichert' : ''}</th>
          <th style="padding:2px 4px;text-align:right;">Einsp. MW${_redundant ? ' gesichert' : ''}</th><th style="padding:2px 4px;text-align:right;">Anschluss (−20/+40 %)</th><th></th>
        </tr></thead><tbody>${zeilen}</tbody></table>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">
        Je System begrenzt durch: Bezug ${grenze(b.jeSystem.grenzeBezug)}, Einspeisung ${grenze(b.jeSystem.grenzeEinsp)} (thermisch ${uwMw(b.jeSystem.thermMw)} MW).
        Umspannwerk (n-1): ${n1} — gilt für <i>alle</i> Kunden des UW, die Bestandslast kennt nur der Netzbetreiber.</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">${heute}</div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted);">Zielleistung
          ${_zielHand ? `(von Hand · <a href="#" data-click="event.preventDefault();uwZielAusBedarf()" style="color:var(--accent);">↺ aus Bedarf</a>):` : '(aus Schritt „Bedarf", Zieljahr):'}
          <label>Bezug <input class="inp-field" type="text" value="${esc(_ziel.bezugMw ?? '')}" placeholder="MW" data-change="uwSetZiel('bezugMw',this.value)" style="${STIL_ZAHL}"/> MW</label>
          <label>Einspeisung <input class="inp-field" type="text" value="${esc(_ziel.einspMw ?? '')}" placeholder="MW" data-change="uwSetZiel('einspMw',this.value)" style="${STIL_ZAHL}"/> MW</label>
        </div>${zielHtml}
      </div>
      <div style="margin-top:6px;font-size:11px;line-height:1.5;">${esc(uwSatz({ ...u, name: u.name || '' }, b))}</div>
    </div>`;
}

function _parameterHtml() {
  const geaendert = Object.keys(_param).length;
  const p = _p();
  const felder = Object.entries(UW_PARAMETER).map(([k, d]) => `<label style="display:flex;justify-content:space-between;gap:6px;align-items:center;">
      <span style="font-size:11px;color:${k in _param ? 'var(--text)' : 'var(--muted)'};">${esc(d.label)}</span>
      <span style="white-space:nowrap;"><input class="inp-field" type="text" value="${esc(p[k])}" data-change="uwSetParam('${k}',this.value)" style="${STIL_ZAHL}"/>
      <span style="font-size:11px;color:var(--muted);display:inline-block;width:30px;">${esc(d.einheit)}</span></span></label>`).join('');
  return `<details style="margin-top:6px;"><summary style="font-size:11px;color:var(--muted);cursor:pointer;">Annahmen und Kostenansätze${geaendert ? ` (${geaendert} geändert)` : ''}</summary>
      <div style="display:flex;flex-direction:column;gap:3px;margin-top:4px;">${felder}</div>
      ${geaendert ? `<button data-click="uwParamZuruecksetzen()" style="${STIL_KNOPF}margin-top:4px;">↺ auf Richtwerte zurücksetzen</button>` : ''}
    </details>`;
}

function _hinweiseHtml() {
  return `<details style="margin-top:4px;"><summary style="font-size:11px;color:var(--muted);cursor:pointer;">Was die Zahlen bedeuten — und was nicht</summary>
      <ul style="font-size:11px;color:var(--muted);line-height:1.5;margin:4px 0 0 14px;padding:0;">
        <li><b>Seriös</b> ist die Leistung über das <i>eigene</i> Kabel: Strombelastbarkeit NA2XS2Y und Spannungsfall bzw. -anhebung über die geschätzte Trassenlänge.</li>
        <li><b>Annahme</b> ist alles im Umspannwerk: Ob dort ein Feld frei ist und wie viel Trafoleistung neben der Bestandslast übrig bleibt, weiß nur der Netzbetreiber. Die (n-1)-Leistung ist eine Obergrenze, keine Zusage.</li>
        <li>Das nächstgelegene UW ist nicht unbedingt das zuständige (anderer Netzbetreiber, reines Übertragungsnetz-UW) — Zuständigkeit über VNB Digital prüfen.</li>
        <li><b>Bezug:</b> Anschlusskosten und Baukostenzuschuss (Leistungspreis laut Preisblatt × kW) trägt der Kunde.</li>
        <li><b>Einspeisung (EEG):</b> Der Anlagenbetreiber trägt den Anschluss bis zum Verknüpfungspunkt, den Netzausbau dahinter der Netzbetreiber; kein Baukostenzuschuss. Ob das UW-Feld Anschluss oder Netzausbau ist, wird im Einzelfall geklärt.</li>
        <li>Orientierung Anschlussebene (VNB-abhängig): bis ≈ ${uwMw(_p().grenzeStrangMva)} MVA meist am MS-Strang, bis ≈ ${uwMw(_p().grenzeUwMva)} MVA Direktanschluss an die MS-Sammelschiene, darüber HS bzw. eigener Trafo.</li>
      </ul></details>`;
}

function _panelHtml() {
  const ref = _bezug();
  const knopfSetzen = _setzen
    ? `<button data-click="uwVonHandSetzen()" style="${STIL_KNOPF}color:var(--c-orange);border-color:var(--c-orange);">✕ Setzen abbrechen (Esc)</button>`
    : `<button data-click="uwVonHandSetzen()" title="Nächster Klick auf die Karte legt ein Umspannwerk an — wenn OSM es nicht kennt" style="${STIL_KNOPF}">UW von Hand setzen</button>`;
  const status = _setzen ? 'Auf die Karte klicken, wo das Umspannwerk liegt …' : _status;
  return `<div class="sa-section-title" style="margin-top:4px;">Umspannwerk &amp; Direktanschluss <span style="font-weight:normal;text-transform:none;letter-spacing:0;color:var(--muted);font-size:11px;">Größenordnung · ersetzt keine Netzanschlussanfrage</span></div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
      <button data-click="uwLaden()" ${_laedt ? 'disabled' : ''} style="${STIL_KNOPF}">${_liste.some(u => u.osm) ? '⟳ Neu laden' : 'Umspannwerke laden'} (${uwMw(_p().radiusKm)} km)</button>
      ${knopfSetzen}
      ${_liste.length ? `<label style="font-size:11px;color:var(--muted);display:flex;gap:3px;align-items:center;"><input type="checkbox" ${_sichtbar ? 'checked' : ''} data-change="uwKarteUmschalten(this.checked)"/> Karte</label>` : ''}
      ${_auswahl() ? `<button data-click="uwZeigen()" style="${STIL_KNOPF}">zeigen</button>` : ''}
    </div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted);margin:2px 0 4px;">
      <label style="display:flex;gap:4px;align-items:center;" title="Jedes Kabelsystem trägt die volle Leistung allein; ein System ist Reserve. Für den Bezug einer Liegenschaft oft gewünscht, für reine PV-Einspeisung meist nicht.">
        <input type="checkbox" ${_redundant ? 'checked' : ''} data-change="uwSetRedundant(this.checked)"/> n-1: ein Kabelsystem als Reserve</label>
      <label style="display:flex;gap:4px;align-items:center;" title="Kabelweg = Luftlinie × Faktor. VDE FNN rechnet ohne Trassenplanung mit 1,5.">
        Umwegfaktor <input class="inp-field" type="text" value="${esc(_p().umwegFaktor)}" data-change="uwSetParam('umwegFaktor',this.value)" style="width:42px;box-sizing:border-box;text-align:right;font-size:12px;"/> <span>(FNN: 1,5)</span></label>
    </div>
    <div style="font-size:11px;color:var(--muted);line-height:1.4;">Bezugspunkt: ${esc(ref.quelle)}${_geladenAm ? ` · OSM-Stand ${esc(_geladenAm)}` : ''}${status ? `<br>${esc(status)}` : ''}</div>
    ${_kandidatenHtml(ref)}
    ${_detailHtml(ref)}
    ${_liste.length || _auswahl() ? _parameterHtml() : ''}
    ${_hinweiseHtml()}
    <div style="height:8px;"></div>`;
}

/** Abschnitt neu zeichnen. */
export function uwRender() {
  const wrap = $(WRAP_ID);
  if (wrap) wrap.innerHTML = _panelHtml();
}

/* ── Projektdatei ───────────────────────────────────────────────────────── */
export function uwCapture() {
  if (!_liste.length && !Object.keys(_param).length && !_zielHand && !_redundant) return null;
  return {
    liste: _liste.map(u => ({ ...u })),
    geladenAm: _geladenAm, auswahlId: _auswahlId, param: { ..._param }, ziel: { ..._ziel }, sichtbar: _sichtbar,
    zielHand: _zielHand, redundant: _redundant,
  };
}

export function uwRestore(s) {
  _setzenBeenden();
  const ok = s && typeof s === 'object';
  _liste = ok && Array.isArray(s.liste)
    ? s.liste.filter(u => Number.isFinite(u?.lat) && Number.isFinite(u?.lng)).map(u => ({
      ...u,
      kvs: Array.isArray(u.kvs) ? u.kvs : uwSpannungen(u.kvs),
      msKv: u.msKv ?? uwMsKv(Array.isArray(u.kvs) ? u.kvs : []),
      trafos: Array.isArray(u.trafos) ? u.trafos : [],
    }))
    : [];
  _geladenAm = ok ? s.geladenAm || null : null;
  _auswahlId = ok ? s.auswahlId || null : null;
  _param = {};
  if (ok && s.param) for (const [k, v] of Object.entries(s.param)) if (UW_PARAMETER[k] && Number.isFinite(+v)) _param[k] = +v;
  _ziel = { bezugMw: zahl(s?.ziel?.bezugMw), einspMw: zahl(s?.ziel?.einspMw) };
  // Ältere Projekte: eine gespeicherte Zielleistung war immer eine Handeingabe
  _zielHand = ok ? (s.zielHand ?? !!(_ziel.bezugMw || _ziel.einspMw)) : false;
  _redundant = ok ? !!s.redundant : false;
  _sichtbar = ok ? s.sichtbar !== false : true;
  _status = '';
  _zeichnen();
  _neu();
}

// Gezeichnet wird, sobald das Netzanschluss-Modul geöffnet ist (44) — vorher gibt es keinen Container.
