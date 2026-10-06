// ── 34-stations-steckbrief.js — Stations-Steckbrief (Trafo-/Übergabestation als Ganzes) ──
//
// Ein Blatt je Station, gegliedert wie die Vorlage „Liegenschaft_Steckbrief Trafostation":
//   Kopf (Liegenschaft, Gebäude-Nr., Stationsart) · Stationsschema
//   1. MS-Station (inkl. Gebäude) · 2. MS-Schaltanlage · 3. Transformatoren · 4. NSHV
//   · weitere Betrachtung (Mängel/Feststellungen) · Datum der Begehung
//
// Die Komponenten bleiben einzelne Assets: das Blatt liest sie zusammen (lib/stations-steckbrief.js)
// und schreibt jede Eingabe an die Stelle zurück, an der sie im Tool ohnehin steht — Trafoleistung
// an den Trafo, Feldanzahl an die Schaltanlage, Messort an die Netzanschluss-Stammdaten. Nur was
// es allein für die Station gibt (Stationsart, Bauart, Mängel …), liegt am Gebäude
// (g.stationSteckbrief). Der Inspector des einzelnen Assets bleibt über „↗" erreichbar.

import { ASSETS, ASSET_CFG, listAssets } from './13a-assets-core.js';
import { openAssetInspector } from './13e-assets-inspector.js';
import { drawAssetMarker } from './13b-assets-render.js';
import { map } from './02b-gebaeude.js';
import { showHint } from './03c-gebaeude-io.js';
import {
  ssStationModell, ssStationsGebaeude, ssStationsLabel, ssSetzeStationsfeld,
  SS_OPTIONEN, SS_MS_EBENEN, SS_ND_TRAFO_VORGABE,
} from './lib/stations-steckbrief.js';

const PANEL_ID = 'stations-steckbrief';
const KVA_STUFEN = [50, 100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000];
const BETRACHTUNGSFELDER = ['NSHV', 'Raumaufteilung', 'baulicher Zustand', 'Zugangsregelung', 'Brandschutz',
  'Lüftung / Klima', 'Erdung / Potentialausgleich', 'Beschilderung / Sicherheitskennzeichnung', 'Kabelkeller / Kabeleinführung'];

let _gebId = null;     // aktuell gezeigte Station (Gebäude-ID)
let _modell = null;

const _esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _js = v => JSON.stringify(v).replace(/"/g, '&quot;');   // Wert als JS-Literal im data-Attribut
const _label = (liste, wert) => SS_OPTIONEN[liste].find(o => o.wert === wert)?.label ?? '';

const _gebaeude = () => window.gebaeude || [];
const _geb = () => _gebaeude().find(g => String(g.id) === String(_gebId)) || null;
const _asset = id => ASSETS.items.find(a => String(a.id) === String(id)) || null;

function _sammle() {
  let assets = [];
  try { assets = listAssets(); } catch { assets = ASSETS.items; }
  return ssStationModell({
    gebaeudeId: _gebId, assets, edges: window.stromEdges || [], gebaeude: _gebaeude(),
    heute: new Date().getFullYear(), messort: String(window.naMessort || ''),
  });
}

// ── Panel ────────────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel';
  panel.style.cssText = 'top:56px;width:min(860px,96vw);max-height:90vh;padding:0 18px 14px;overflow:auto;--panel-accent:#43a047;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#66bb6a;font-size:12px;font-weight:600;">📋 Stations-Steckbrief</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;" data-click="ssbSchliessen()">✕</span>
    </div>
    <div id="ssb-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

/** Steckbrief der Station in diesem Gebäude öffnen. */
export function openStationsSteckbrief(gebaeudeId) {
  if (gebaeudeId == null) return;
  _gebId = gebaeudeId;
  _ensurePanel().style.display = 'block';
  ssbAktualisieren();
}

/** Station des Assets öffnen (Knopf im Inspector). */
export function openStationsSteckbriefFuerAsset(assetId) {
  const a = _asset(assetId);
  if (!a || a.buildingId == null) { showHint('⚠ Die Komponente ist keinem Gebäude zugeordnet — ohne Gebäude keine Station.'); return; }
  openStationsSteckbrief(a.buildingId);
}

export function ssbSchliessen() {
  const p = document.getElementById(PANEL_ID);
  if (p) p.style.display = 'none';
}

export function ssbAktualisieren() {
  const body = document.getElementById('ssb-body');
  if (!body) return;
  if (!_geb()) { body.innerHTML = '<div class="ssb-leer">Gebäude nicht mehr vorhanden.</div>'; return; }
  _modell = _sammle();
  const scroll = document.getElementById(PANEL_ID)?.scrollTop ?? 0;
  body.innerHTML = _kopf() + _hinweise() + _schema() + _sec1() + _sec2() + _sec3() + _sec4() + _sec5() + _weitere();
  const p = document.getElementById(PANEL_ID);
  if (p) p.scrollTop = scroll;
}

/** Offenen Steckbrief nach Änderungen an Assets/Kabeln auffrischen (z. B. aus dem Inspector). */
export function ssbFallsOffenAktualisieren() {
  const p = document.getElementById(PANEL_ID);
  if (p && p.style.display === 'block') ssbAktualisieren();
}

// ── Schreibwege ──────────────────────────────────────────────────────────────

/** Angabe auf Stationsebene; erneuter Klick auf die gewählte Option hebt die Wahl auf (→ Ableitung). */
export function ssbSetStation(feld, wert, umschalten = false) {
  const g = _geb();
  if (!g) return;
  const alt = g.stationSteckbrief?.[feld];
  if (typeof wert === 'number' && !Number.isFinite(wert)) wert = '';
  ssSetzeStationsfeld(g, feld, umschalten && alt === wert ? '' : (typeof wert === 'string' ? wert.trim() : wert));
  ssbAktualisieren();
}

export function ssbSetGebBaujahr(wert) {
  const g = _geb();
  if (!g) return;
  const n = parseInt(wert, 10);
  g.baujahr = Number.isFinite(n) ? n : null;
  ssbAktualisieren();
}

/** Asset-Eigenschaft (props) setzen; Zahlen als Zahl, leer → entfernen. */
export function ssbSetProp(assetId, key, wert, art = 'zahl', umschalten = false) {
  const a = _asset(assetId);
  if (!a) return;
  a.props = a.props || {};
  if (umschalten && a.props[key] === wert) { delete a.props[key]; }
  else if (wert === '' || wert == null) delete a.props[key];
  else if (art === 'zahl') {
    const n = parseFloat(String(wert).replace(',', '.'));
    if (Number.isFinite(n)) a.props[key] = n; else delete a.props[key];
  } else a.props[key] = wert;
  _assetGeaendert(a);
}

export function ssbSetBaujahr(assetId, wert) {
  const a = _asset(assetId);
  if (!a) return;
  const n = parseInt(wert, 10);
  a.baujahr = Number.isFinite(n) ? n : null;
  _assetGeaendert(a);
}

export function ssbSetName(assetId, wert) {
  const a = _asset(assetId);
  if (!a || !String(wert).trim()) { ssbAktualisieren(); return; }
  a.name = String(wert).trim();
  _assetGeaendert(a);
}

/** Bezeichnung eines Schaltfelds (Index = Feldnummer − 1) */
export function ssbSetFeldName(saId, idx, wert) {
  const a = _asset(saId);
  if (!a) return;
  a.props = a.props || {};
  const namen = Array.isArray(a.props.feldNamen) ? [...a.props.feldNamen] : [];
  while (namen.length <= idx) namen.push('');
  namen[idx] = String(wert ?? '').trim();
  while (namen.length && !namen[namen.length - 1]) namen.pop();
  if (namen.length) a.props.feldNamen = namen; else delete a.props.feldNamen;
  _assetGeaendert(a);
}

/** NAP-Spannung = MS-Ebene; gibt es in der Station keinen NAP, steht der Wert am Steckbrief. */
export function ssbSetMsKV(wert) {
  const nap = _modell?.naps?.[0];
  if (nap) ssbSetProp(nap.id, 'spannungKV', wert, 'zahl');
  else ssbSetStation('msKV', wert === '' ? '' : parseFloat(wert));
}

/** Zählung des VNB = Messort der Netzanschluss-Stammdaten (eine Quelle für Gutachten 3.1.1 und Steckbrief). */
export function ssbSetMessort(wert) {
  const neu = String(window.naMessort || '') === wert ? '' : wert;
  if (typeof window.sgNaSetMessort === 'function') window.sgNaSetMessort(neu);
  else window.naMessort = neu;
  ssbAktualisieren();
}

export function ssbMangelNeu() {
  const g = _geb();
  if (!g) return;
  const liste = [...(g.stationSteckbrief?.maengel || []), { feld: '', text: '' }];
  ssSetzeStationsfeld(g, 'maengel', liste);
  ssbAktualisieren();
}

export function ssbMangelSet(i, feld, wert) {
  const g = _geb();
  const liste = [...(g?.stationSteckbrief?.maengel || [])];
  if (!liste[i]) return;
  liste[i] = { ...liste[i], [feld]: String(wert ?? '') };
  ssSetzeStationsfeld(g, 'maengel', liste);
  // kein Neuzeichnen: der Cursor bliebe sonst nicht im Textfeld
}

export function ssbMangelWeg(i) {
  const g = _geb();
  const liste = [...(g?.stationSteckbrief?.maengel || [])];
  liste.splice(i, 1);
  ssSetzeStationsfeld(g, 'maengel', liste.length ? liste : '');
  ssbAktualisieren();
}

export function ssbOeffneAsset(id) {
  const a = _asset(id);
  if (!a) return;
  if (a.lat != null && a.lng != null) map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
  openAssetInspector(a);
}

export function ssbZurKarte() {
  const g = _geb();
  if (!g?.polygon?.length) return;
  try { map.flyToBounds(L.latLngBounds(g.polygon), { padding: [80, 80], maxZoom: 19, duration: 0.8 }); } catch { /* ohne Geometrie nichts */ }
}

function _assetGeaendert(a) {
  try { drawAssetMarker(a); } catch { /* Marker ist Kosmetik */ }
  // Offenen Inspector derselben Komponente nachziehen
  const slot = document.getElementById('sb-asset-inspector-slot');
  if (ASSETS.selectedId === a.id && slot && slot.style.display !== 'none') openAssetInspector(a);
  ssbAktualisieren();
}

// ── Bausteine ────────────────────────────────────────────────────────────────

/**
 * Auswahl als Knopfreihe (entspricht den Ankreuzfeldern der Vorlage).
 * aktiv: {wert, auto}; aufruf: Wert-Literal → Handler-Code (direkter Funktionsaufruf, s. 12-inline-handlers).
 */
function _wahl(liste, aktiv, aufruf, { gesperrt = false } = {}) {
  return `<span class="ssb-wahl${gesperrt ? ' is-gesperrt' : ''}">${SS_OPTIONEN[liste].map(o => {
    const an = aktiv?.wert === o.wert;
    const cls = an ? (aktiv.auto ? ' is-auto' : ' is-an') : '';
    const tip = an && aktiv.auto ? ' title="Aus dem Netzmodell abgeleitet — anklicken übernimmt den Wert fest"' : an ? ' title="Erneut klicken hebt die Auswahl auf"' : '';
    return `<button class="ssb-opt${cls}"${tip} data-click="${aufruf(_js(o.wert))}">${_esc(o.label)}</button>`;
  }).join('')}</span>`;
}

const _stAufruf = feld => w => `ssbSetStation('${feld}', ${w}, true)`;
const _propAufruf = (id, key) => w => `ssbSetProp(${id}, '${key}', ${w}, 'text', true)`;

const _autoBadge = (text = 'auto', tip = 'Aus dem Netzmodell abgeleitet') =>
  `<span class="ssb-auto" title="${_esc(tip)}">${_esc(text)}</span>`;

function _zeile(label, inhalt, extra = '') {
  return `<div class="ssb-zeile${extra}"><div class="ssb-lbl">${label}</div><div class="ssb-wert">${inhalt}</div></div>`;
}

function _zahlInput(wert, aufruf, { placeholder = '—', breite = 70, step = 1, min = null } = {}) {
  return `<input class="ssb-in" type="number" style="width:${breite}px" step="${step}"${min != null ? ` min="${min}"` : ''}
    value="${wert ?? ''}" placeholder="${_esc(placeholder)}" data-change="${aufruf}">`;
}

function _fotos(liste) {
  const fotos = (liste || []).filter(f => f?.dataUrl);
  if (!fotos.length) return `<div class="ssb-fotos-leer">Keine Fotos — Fotos kommen aus der Feld-App (Begehung) an Gebäude bzw. Komponente.</div>`;
  return `<div class="ssb-fotos">${fotos.map(f =>
    `<img src="${f.dataUrl}" title="${_esc(f.name)}" onclick="openImageLightbox(this.src,this.title)">`).join('')}</div>`;
}

function _assetKopf(a, zusatz = '') {
  const cfg = ASSET_CFG[a.type] || {};
  return `<div class="ssb-karte-kopf">
    <span class="ssb-icon" style="background:${cfg.color}">${cfg.icon || ''}</span>
    <input class="ssb-in ssb-name" value="${_esc(a.name)}" data-change="ssbSetName(${_js(a.id)}, this.value)" title="Bezeichnung">
    ${zusatz}
    <button class="ssb-link" data-click="ssbOeffneAsset(${_js(a.id)})" title="Einzelne Komponente im Inspector öffnen (Maßnahmen, Schicht, alle Eigenschaften)">Inspector ↗</button>
  </div>`;
}

const _abschnitt = (nr, titel, inhalt, fotos = '') =>
  `<section class="ssb-sec"><div class="ssb-sec-titel">${nr ? nr + '. ' : ''}${titel}</div>${fotos}${inhalt}</section>`;

// ── Kopf ─────────────────────────────────────────────────────────────────────

function _kopf() {
  const m = _modell;
  const sb = m.steckbrief;
  const stationen = ssStationsGebaeude(ASSETS.items, _gebaeude());
  const opts = stationen.map(g => `<option value="${_esc(g.id)}"${String(g.id) === String(_gebId) ? ' selected' : ''}>${_esc(ssStationsLabel(g))}</option>`).join('');
  const lieg = String(window.pdKaserneName || '').trim();
  const adr = String(window.pdLiegenschaftAdresse || '').trim();
  const we = String(window.pdWeNummer || '').trim();
  const art = m.station.stationsart.wert ? _label('stationsart', m.station.stationsart.wert) : 'Station';
  return `
  <div class="ssb-kopf">
    <div class="ssb-kopf-zeile">
      <select class="ssb-in ssb-wechsel" data-change="openStationsSteckbrief(this.value)" title="Andere Station öffnen">${opts}</select>
      <span class="ssb-kopf-akt">
        <button class="eb-btn" data-click="ssbZurKarte()" title="Station auf der Karte zeigen">🗺 Karte</button>
        <button class="eb-btn" data-click="ssbAktualisieren()" title="Neu aus dem Netzmodell einlesen">↻</button>
        <button class="eb-btn eb-btn-primary" data-click="ssbDrucken()" title="Steckbrief im Layout der Vorlage drucken oder als PDF speichern">🖨 Drucken / PDF</button>
      </span>
    </div>
    <table class="ssb-kopf-tab"><tr>
      <td><div class="ssb-mut">Liegenschaft</div><b>${_esc(lieg || '— (Projektdaten)')}</b>${adr ? `<div class="ssb-mut">${_esc(adr)}</div>` : ''}</td>
      <td><div class="ssb-mut">WE-Nr.</div>${_esc(we || '—')}</td>
      <td><div class="ssb-mut">Gebäude-Nr. · Station</div><b>${_esc(m.geb.nummer ? 'Geb. ' + m.geb.nummer : '—')}</b> · ${_esc(m.geb.name || '')}</td>
      <td><div class="ssb-mut">Stationsart</div>${_esc(art)}</td>
      <td><div class="ssb-mut">Datum der Begehung</div>
        <input class="ssb-in" type="date" value="${_esc(sb.begehung || '')}" data-change="ssbSetStation('begehung', this.value)"></td>
    </tr></table>
  </div>`;
}

function _hinweise() {
  const h = _modell.hinweise;
  if (!h.length) return '';
  return `<div class="ssb-hinweise">${h.map(x => `<div>⚠ ${_esc(x)}</div>`).join('')}</div>`;
}

// ── Stationsschema (MS-Schiene · Felder · Trafos · NSHV) ─────────────────────

function _schema() {
  const m = _modell;
  const felder = m.schaltanlagen.flatMap(s => s.felder.map(f => ({ ...f, sa: s.asset })));
  const trafoIdsMitFeld = new Set(felder.filter(f => f.art === 'trafo').map(f => String(f.trafoId)));
  const freieTrafos = m.trafos.filter(t => !trafoIdsMitFeld.has(String(t.asset.id)));
  // Spalten: jedes Feld, dazu Trafos ohne Feld (Kompaktstation ohne erfasste Schaltanlage)
  const spalten = [...felder, ...freieTrafos.map(t => ({ art: 'trafo-direkt', trafoId: t.asset.id, auto: t.asset.name }))];
  if (!spalten.length && !m.naps.length) return '';
  const n = Math.max(spalten.length, 1);
  const dx = Math.max(64, Math.min(110, 720 / n));
  const W = Math.max(760, n * dx + 60);
  const x0 = (W - (n - 1) * dx) / 2;
  const yMS = 74, yTr = 150, yNS = 214, H = m.nshvs.length ? 250 : 190;
  const trafo = id => m.trafos.find(t => String(t.asset.id) === String(id));
  let s = '';
  if (felder.length) {
    s += `<line x1="${x0 - 24}" y1="${yMS}" x2="${x0 + (felder.length - 1) * dx + 24}" y2="${yMS}" class="ssb-sch-schiene"/>`;
    s += `<text x="${x0 - 30}" y="${yMS + 4}" text-anchor="end" class="ssb-sch-klein">MS${m.station.msKV ? ' ' + m.station.msKV + ' kV' : ''}</text>`;
  }
  spalten.forEach((f, i) => {
    const x = x0 + i * dx;
    const titel = _esc(f.name || f.auto);
    if (f.art === 'einspeisung' || f.art === 'kabel') {
      const ts = f.trennstelle;
      s += `<line x1="${x}" y1="${yMS}" x2="${x}" y2="20" class="ssb-sch-ltg${ts ? ' is-offen' : ''}"/>`;
      s += `<rect x="${x - 7}" y="${yMS - 22}" width="14" height="14" rx="2" class="ssb-sch-feld${ts ? ' is-offen' : ''}"><title>${titel}${ts ? ' — offene Trennstelle' : ''}</title></rect>`;
      const ziel = f.art === 'einspeisung' ? 'VNB' : (f.ziel || '').replace(/\s*\(Geb\. [^)]*\)/, '');
      s += `<text x="${x + 4}" y="16" class="ssb-sch-klein" transform="rotate(-18 ${x + 4} 16)">${_esc(ziel.length > 18 ? ziel.slice(0, 17) + '…' : ziel)}</text>`;
    } else if (f.art === 'trafo' || f.art === 'trafo-direkt') {
      const t = trafo(f.trafoId);
      if (f.art === 'trafo') {
        s += `<line x1="${x}" y1="${yMS}" x2="${x}" y2="${yTr - 18}" class="ssb-sch-ltg"/>`;
        s += `<rect x="${x - 7}" y="${yMS + 8}" width="14" height="14" rx="2" class="ssb-sch-feld"><title>${titel}</title></rect>`;
      } else {
        s += `<line x1="${x}" y1="24" x2="${x}" y2="${yTr - 18}" class="ssb-sch-ltg"/>`;
      }
      const nd = t?.nd?.status;
      s += `<g class="ssb-sch-trafo${nd ? ' nd-' + nd : ''}"><circle cx="${x}" cy="${yTr - 8}" r="11"/><circle cx="${x}" cy="${yTr + 6}" r="11"/>
        <title>${_esc(t?.asset.name || 'Trafo')}${t?.kva ? ' · ' + t.kva + ' kVA' : ''}${nd ? ' · Nutzungsdauer ' + _label('ndStatus', nd) : ''}</title></g>`;
      s += `<text x="${x + 16}" y="${yTr - 4}" class="ssb-sch-txt">${_esc(t?.asset.name || 'Trafo')}</text>`;
      s += `<text x="${x + 16}" y="${yTr + 9}" class="ssb-sch-klein">${t?.kva ? t.kva + ' kVA' : '? kVA'}</text>`;
      if (m.nshvs.length) s += `<line x1="${x}" y1="${yTr + 17}" x2="${x}" y2="${yNS}" class="ssb-sch-ltg"/>`;
    } else {
      s += `<line x1="${x}" y1="${yMS}" x2="${x}" y2="${yMS + 16}" class="ssb-sch-ltg is-reserve"/>`;
      s += `<rect x="${x - 7}" y="${yMS + 8}" width="14" height="14" rx="2" class="ssb-sch-feld is-reserve"><title>${titel}</title></rect>`;
    }
    s += `<text x="${x}" y="${yMS + (f.art === 'einspeisung' || f.art === 'kabel' ? -27 : 36)}" text-anchor="middle" class="ssb-sch-nr">${f.nr ? 'F' + f.nr : ''}</text>`;
  });
  if (m.nshvs.length) {
    const xs = spalten.map((_, i) => x0 + i * dx).filter((_, i) => spalten[i].art === 'trafo' || spalten[i].art === 'trafo-direkt');
    const a = xs.length ? Math.min(...xs) - 30 : x0 - 30, b = xs.length ? Math.max(...xs) + 120 : x0 + 160;
    s += `<line x1="${a}" y1="${yNS}" x2="${b}" y2="${yNS}" class="ssb-sch-schiene is-ns"/>`;
    const txt = m.nshvs.map(nv => `${nv.asset.name || 'NSHV'}${nv.abgaenge != null ? ` · ${nv.abgaenge} Abgänge` : ''} (${nv.belegt} belegt${nv.frei != null ? `, ${nv.frei} frei` : ''})`).join('  ·  ');
    s += `<text x="${a}" y="${yNS + 18}" class="ssb-sch-txt">${_esc(txt)}</text>`;
    s += `<text x="${a - 6}" y="${yNS + 4}" text-anchor="end" class="ssb-sch-klein">NS</text>`;
  }
  return `<div class="ssb-schema"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:${H}px">${s}</svg>
    <div class="ssb-legende"><span><i class="lg-feld"></i>Schaltfeld</span><span><i class="lg-offen"></i>offene Trennstelle</span>
    <span><i class="lg-nd ueberschritten"></i>Trafo über Nutzungsdauer</span><span><i class="lg-nd erreicht"></i>erreicht</span></div></div>`;
}

// ── 1. MS-Station (inkl. Gebäude) ────────────────────────────────────────────

function _sec1() {
  const m = _modell, st = m.station, sb = m.steckbrief;
  const g = _geb();
  const kvOpts = [...new Set([...SS_MS_EBENEN, ...(st.msKV ? [st.msKV] : [])])].sort((a, b) => a - b)
    .map(v => `<option value="${v}"${st.msKV === v ? ' selected' : ''}>${v} kV</option>`).join('');
  const kvQuelle = st.msKVQuelle === 'nap' ? _autoBadge('NAP', 'Nennspannung des NAP dieser Station')
    : st.msKVQuelle === 'netz' ? _autoBadge('aus Netz', 'Nennspannung des NAP im Netz — Eingabe hier gilt nur für diese Station') : '';
  const zaehlung = st.zaehlungMoeglich
    ? _wahl('zaehlung', st.zaehlung ? { wert: st.zaehlung, auto: false } : null, w => `ssbSetMessort(${w})`)
      + ` <span class="ssb-mut" title="Steht in ⚡ Strom-Grundlagen › Netzanschluss (Messort) und fließt in Gutachten 3.1.1">= Messort Netzanschluss</span>`
    : '<span class="ssb-mut">— (keine Übergabestation)</span>';
  const anb = st.anbindung.length
    ? st.anbindung.map(x => x.art === 'netz'
      ? `<span class="ssb-chip is-netz">⚡ ${_esc(x.label)}</span>`
      : `<button class="ssb-chip" ${x.gebId != null ? `data-click="openStationsSteckbrief(${_js(x.gebId)})"` : ''} title="Steckbrief dieser Station öffnen">
          ${x.trennstelle ? '✂ ' : ''}${_esc(x.label)}${x.systeme > 1 ? ` · ${x.systeme} Systeme` : ''}</button>`).join('')
      + _autoBadge('aus Kabeln', 'Aus den MS-Kabeln des Netzmodells; ✂ = offene Trennstelle auf der Verbindung')
    : '<span class="ssb-mut">Keine MS-Kabel erfasst.</span>';
  const kompakt = st.bauweise.wert === 'kompakt';
  const inhalt = `<div class="ssb-raster">
    ${_zeile('Baujahr', _zahlInput(m.geb.baujahr, 'ssbSetGebBaujahr(this.value)', { placeholder: 'Gebäude' })
      + `<span class="ssb-lbl-inline">Umbau / Sanierung</span>` + _zahlInput(st.umbauJahr, "ssbSetStation('umbauJahr', this.value === '' ? '' : parseInt(this.value, 10))"))}
    ${_zeile('MS-Ebene', `<select class="ssb-in" data-change="ssbSetMsKV(this.value)"><option value="">—</option>${kvOpts}</select> ${kvQuelle}`)}
    ${_zeile('Zählung VNB', zaehlung)}
    ${_zeile('Stationsart', _wahl('stationsart', st.stationsart, _stAufruf('stationsart'))
      + _wahl('bauweise', st.bauweise, _stAufruf('bauweise'))
      + _wahl('lage', st.lage, _stAufruf('lage')))}
    ${_zeile('Anbindung an', anb)}
    ${_zeile('Einspeisung', _wahl('einspeisung', st.einspeisung, _stAufruf('einspeisung'))
      + (st.einspeisung.text ? ` <span class="ssb-mut">${_esc(st.einspeisung.text)}</span>` : ''))}
    ${_zeile('Bauart <span class="ssb-mut">(wenn begehbar)</span>', _wahl('bauart', st.bauart, _stAufruf('bauart'), { gesperrt: kompakt })
      + `<input class="ssb-in" style="width:160px" placeholder="Anmerkung Bauart" value="${_esc(sb.bauartText || '')}" data-change="ssbSetStation('bauartText', this.value)">`)}
  </div>`;
  return _abschnitt(1, 'MS-Station (inkl. Gebäude)', inhalt, _fotos(g?.feldFotos));
}

// ── 2. MS-Schaltanlage ───────────────────────────────────────────────────────

function _sec2() {
  const m = _modell;
  if (!m.schaltanlagen.length) {
    return _abschnitt(2, 'MS-Schaltanlage', `<div class="ssb-leer-klein">Keine MS-Schaltanlage in diesem Gebäude erfasst${m.trafos.length ? ' — Trafos hängen direkt am Kabel (Kompaktstation)' : ''}.</div>`);
  }
  const karten = m.schaltanlagen.map(s => {
    const a = s.asset, p = a.props || {}, id = _js(a.id);
    const felderTab = `<table class="ssb-tab"><thead><tr><th style="width:44px">Feld</th><th>Feldbezeichnung</th><th style="width:150px">aus dem Netzmodell</th></tr></thead><tbody>
      ${s.felder.map((f, i) => `<tr class="${f.art === 'reserve' ? 'is-reserve' : ''}">
        <td>${f.nr}</td>
        <td><input class="ssb-in ssb-voll" value="${_esc(f.name || '')}" placeholder="${_esc(f.auto)}"
             data-change="ssbSetFeldName(${id}, ${i}, this.value)"></td>
        <td class="ssb-mut">${_esc({ einspeisung: 'Übergabe', kabel: 'Kabel', trafo: 'Trafo', reserve: 'Reserve' }[f.art])}${f.trennstelle ? ' · ✂ offen' : ''}</td>
      </tr>`).join('')}
    </tbody></table>`;
    return `<div class="ssb-karte">
      ${_assetKopf(a)}
      <div class="ssb-raster">
        ${_zeile('Ausführung', _wahl('saAusfuehrung', p.ausfuehrung ? { wert: p.ausfuehrung } : null, _propAufruf(id, 'ausfuehrung')))}
        ${_zeile('Isolationsmedium', _wahl('saIsolation', p.isolation ? { wert: p.isolation } : null, _propAufruf(id, 'isolation')))}
        ${_zeile('Weitere Angaben', `<span class="ssb-lbl-inline">Baujahr</span>${_zahlInput(a.baujahr, `ssbSetBaujahr(${id}, this.value)`)}
          <span class="ssb-lbl-inline">Anz. Schaltfelder</span>${_zahlInput(p.felder, `ssbSetProp(${id}, 'felder', this.value)`, { min: 1, breite: 56 })}
          <span class="ssb-lbl-inline">Nennstrom</span>${_zahlInput(p.nennstromA, `ssbSetProp(${id}, 'nennstromA', this.value)`, { breite: 64 })} A
          ${s.zuWenig ? `<span class="ssb-warn">${s.belegt} Felder belegt</span>` : ''}`)}
      </div>
      ${felderTab}
      ${_fotos(a.feldFotos)}
    </div>`;
  }).join('');
  return _abschnitt(2, 'MS-Schaltanlage', karten);
}

// ── 3. Transformatoren ───────────────────────────────────────────────────────

function _sec3() {
  const m = _modell;
  if (!m.trafos.length) return _abschnitt(3, 'Transformatoren', '<div class="ssb-leer-klein">Kein Trafo in diesem Gebäude erfasst.</div>');
  const sp = fn => m.trafos.map(t => `<td>${fn(t, t.asset, t.asset.props || {}, _js(t.asset.id))}</td>`).join('');
  const kvaSel = (t, a, p, id) => {
    const stufen = [...new Set([...KVA_STUFEN, ...(t.kva ? [t.kva] : [])])].sort((x, y) => x - y);
    return `<select class="ssb-in" data-change="ssbSetProp(${id}, 'leistungKVA', this.value)"><option value="">—</option>${
      stufen.map(v => `<option value="${v}"${t.kva === v ? ' selected' : ''}>${v} kVA</option>`).join('')}</select>`;
  };
  const nd = t => {
    if (!t.nd) return '<span class="ssb-mut">Baujahr fehlt</span>';
    return `<span class="ssb-nd nd-${t.nd.status}">${_label('ndStatus', t.nd.status)}</span>
      <span class="ssb-mut">${t.nd.alter} a${t.nd.rest > 0 ? ` · noch ${t.nd.rest} a` : ''}</span>`;
  };
  const tab = `<table class="ssb-tab ssb-tab-quer">
    <tr><th>Bezeichnung</th>${sp((t, a, p, id) => `<input class="ssb-in ssb-voll" value="${_esc(a.name)}" data-change="ssbSetName(${id}, this.value)">`)}</tr>
    <tr><th>Leistung</th>${sp(kvaSel)}</tr>
    <tr><th>uk</th>${sp((t, a, p, id) => _zahlInput(p.ukProzent, `ssbSetProp(${id}, 'ukProzent', this.value)`, { step: 0.1, breite: 56, placeholder: '4' }) + ' %')}</tr>
    <tr><th>Baujahr</th>${sp((t, a, p, id) => _zahlInput(a.baujahr, `ssbSetBaujahr(${id}, this.value)`))}</tr>
    <tr><th>Ausführung</th>${sp((t, a, p, id) => _wahl('kuehlung', p.kuehlung ? { wert: p.kuehlung } : null, _propAufruf(id, 'kuehlung')))}</tr>
    <tr><th>Netzart</th>${sp((t, a, p) => p.netzart === 'erzeugung' ? 'Erzeugungsnetz' : 'Verbrauchsnetz')}</tr>
    <tr><th title="Rechnerische wirtschaftliche Nutzungsdauer gem. VDI 2067 — bezogen auf das Jahr der Begehung (sonst das laufende Jahr)">rechn. wirtschaftl. Nutzungsdauer</th>${sp(t => nd(t))}</tr>
    <tr><th>Komponente</th>${sp((t, a) => `<button class="ssb-link" data-click="ssbOeffneAsset(${_js(a.id)})">Inspector ↗</button>`)}</tr>
  </table>`;
  const ndZeile = `<div class="ssb-fuss">Anzahl Trafos: <b>${m.trafos.length}</b> · Nutzungsdauer-Ansatz
    ${_zahlInput(m.steckbrief.ndTrafo, "ssbSetStation('ndTrafo', this.value === '' ? '' : parseInt(this.value, 10))", { placeholder: String(SS_ND_TRAFO_VORGABE), breite: 50, min: 1 })} a
    (VDI 2067) · Bezugsjahr ${m.bezugsjahr}${m.bezugAusBegehung ? ' (Begehung)' : ''}</div>`;
  return _abschnitt(3, 'Transformatoren', tab + ndZeile + _fotos(m.trafos.flatMap(t => t.asset.feldFotos || [])));
}

// ── 4. NSHV ──────────────────────────────────────────────────────────────────

function _sec4() {
  const m = _modell;
  if (!m.nshvs.length) return _abschnitt(4, 'NSHV', '<div class="ssb-leer-klein">Keine NSHV in diesem Gebäude erfasst.</div>');
  const karten = m.nshvs.map(nv => {
    const a = nv.asset, p = a.props || {}, id = _js(a.id);
    const netzOpts = SS_OPTIONEN.netzform.map(o => `<option value="${o.wert}"${p.netzform === o.wert ? ' selected' : ''}>${o.label}</option>`).join('');
    return `<div class="ssb-karte">
      ${_assetKopf(a)}
      <div class="ssb-raster">
        ${_zeile('Baujahr', _zahlInput(a.baujahr, `ssbSetBaujahr(${id}, this.value)`)
          + `<span class="ssb-lbl-inline">Nennstrom</span>${_zahlInput(p.nennstromA, `ssbSetProp(${id}, 'nennstromA', this.value)`, { breite: 64 })} A`)}
        ${_zeile('Anzahl Abgänge', _zahlInput(nv.abgaenge, `ssbSetProp(${id}, 'abgaenge', this.value)`, { min: 0, breite: 56 })
          + ` <span class="ssb-mut">${nv.belegt} mit Kabel im Netz</span>${nv.zuWenig ? ' <span class="ssb-warn">mehr Kabel als Abgänge</span>' : ''}`)}
        ${_zeile('Anz. freie Abgänge', _zahlInput(nv.freiAuto ? '' : nv.frei, `ssbSetProp(${id}, 'freieAbgaenge', this.value)`,
            { min: 0, breite: 56, placeholder: nv.frei != null ? String(nv.frei) : '—' })
          + (nv.freiAuto && nv.frei != null ? _autoBadge('Abgänge − belegt') : ''))}
        ${_zeile('Ausführung NS-Netz', `<select class="ssb-in" data-change="ssbSetProp(${id}, 'netzform', this.value, 'text')"><option value="">—</option>${netzOpts}</select>`)}
      </div>
      ${_fotos(a.feldFotos)}
    </div>`;
  }).join('');
  return _abschnitt(4, 'NSHV', karten);
}

// ── Weitere Betrachtung (Mängel, Anmerkungen) ────────────────────────────────

function _sec5() {
  const liste = _modell.maengel;
  const dl = `<datalist id="ssb-felder">${BETRACHTUNGSFELDER.map(f => `<option value="${_esc(f)}">`).join('')}</datalist>`;
  const zeilen = liste.map((x, i) => `<tr>
    <td><input class="ssb-in ssb-voll" list="ssb-felder" value="${_esc(x.feld)}" placeholder="z. B. Raumaufteilung"
         data-change="ssbMangelSet(${i}, 'feld', this.value)"></td>
    <td><textarea class="ssb-in ssb-voll" rows="2" placeholder="Feststellungen" data-change="ssbMangelSet(${i}, 'text', this.value)">${_esc(x.text)}</textarea></td>
    <td style="width:24px"><button class="ssb-x" data-click="ssbMangelWeg(${i})" title="Zeile entfernen">✕</button></td>
  </tr>`).join('');
  const tab = `${dl}<table class="ssb-tab"><thead><tr><th style="width:34%">Betrachtungsfeld</th><th>Mängel, Anmerkungen (Feststellungen)</th><th></th></tr></thead>
    <tbody>${zeilen || '<tr><td colspan="3" class="ssb-mut">Noch keine Feststellungen.</td></tr>'}</tbody></table>
    <button class="eb-btn" style="margin-top:6px" data-click="ssbMangelNeu()">+ Feststellung</button>`;
  return _abschnitt('', 'Weitere Betrachtung der Trafostation', tab);
}

function _weitere() {
  const w = _modell.weitere;
  if (!w.length) return '';
  return `<div class="ssb-weitere"><span class="ssb-mut">Weitere Komponenten im Gebäude:</span>
    ${w.map(a => `<button class="ssb-chip" data-click="ssbOeffneAsset(${_js(a.id)})">${ASSET_CFG[a.type]?.icon || ''} ${_esc(a.name)}</button>`).join('')}</div>`;
}

// ── Druckfassung im Layout der Vorlage ───────────────────────────────────────

const _kb = (liste, wert) => SS_OPTIONEN[liste].map(o => `${o.wert === wert ? '☒' : '☐'} ${_esc(o.label)}`).join('<br>');

function _druckFotos(liste) {
  const f = (liste || []).filter(x => x?.dataUrl).slice(0, 6);
  return f.length ? `<div class="fotos">${f.map(x => `<img src="${x.dataUrl}">`).join('')}</div>` : '<div class="leer">—</div>';
}

function _druckHtml(m) {
  const st = m.station;
  const lieg = String(window.pdKaserneName || '').trim();
  const adr = String(window.pdLiegenschaftAdresse || '').trim();
  const we = String(window.pdWeNummer || '').trim();
  const g = _geb();
  const datum = m.steckbrief.begehung ? new Date(m.steckbrief.begehung).toLocaleDateString('de-DE') : '__.__.____';
  const titel = (nr, t) => `<tr class="titel"><td colspan="5">${nr ? nr + '. ' : ''}${t}</td></tr>`;
  const fotoZeile = (t, fotos) => `<tr><td colspan="5"><div class="lbl">Fotos (${t})</div>${_druckFotos(fotos)}</td></tr>`;
  const anb = st.anbindung.map(x => `☒ ${_esc(x.art === 'netz' ? 'Netz' : 'Stat. ' + x.label)}`).join('<br>') || '☐ Netz';

  let h = `<table class="kopf"><tr><td class="anl">Anlage ?</td><td><b>${_esc(lieg || 'Liegenschaftsbezeichnung')}</b></td>
    <td><b>${_esc(m.geb.nummer ? 'Geb. ' + m.geb.nummer : '')}${m.geb.nummer && m.geb.name ? ' – ' : ''}${_esc(m.geb.name)}</b></td></tr></table>`;
  h += `<table class="blatt">
    <tr><td class="lbl">Liegenschaft</td><td colspan="2"><b>${_esc(lieg)}</b><br>${_esc(adr)}</td><td colspan="2">${_esc(we)}</td></tr>
    <tr><td class="lbl">Gebäude Nr. ${_esc(m.geb.nummer)}</td><td colspan="4">${_esc(_label('stationsart', st.stationsart.wert) || '')}</td></tr>
    ${titel(1, 'MS-Station (inkl. Gebäude)')}
    ${fotoZeile('Übersicht Trafostation, Gebäude, Stationstüren', g?.feldFotos)}
    <tr><td class="lbl">Baujahr</td><td>${_esc(m.geb.baujahr ?? '')}</td><td class="lbl">Umbau/Sanierung</td><td colspan="2">${_esc(st.umbauJahr ?? '')}</td></tr>
    <tr><td class="lbl">MS-Ebene</td><td>${st.msKV ? st.msKV + ' kV' : ''}</td><td class="lbl">Zählung VNB</td><td colspan="2">${st.zaehlungMoeglich ? _kb('zaehlung', st.zaehlung) : '—'}</td></tr>
    <tr><td class="lbl">Stationsart</td><td>${_kb('stationsart', st.stationsart.wert)}</td><td>${_kb('bauweise', st.bauweise.wert)}</td><td colspan="2">${_kb('lage', st.lage.wert)}</td></tr>
    <tr><td class="lbl">Anbindung an</td><td colspan="4">${anb}</td></tr>
    <tr><td class="lbl">Einspeisung</td><td colspan="4">${_kb('einspeisung', st.einspeisung.wert).replace(/<br>/g, ' &nbsp; ')}${st.einspeisung.text ? ` <span class="mut">(${_esc(st.einspeisung.text)})</span>` : ''}</td></tr>
    <tr><td class="lbl">Bauart (wenn begehbar)</td><td colspan="4">${_kb('bauart', st.bauart.wert).replace(/<br>/g, ' &nbsp; ')}${m.steckbrief.bauartText ? ' – ' + _esc(m.steckbrief.bauartText) : ''}</td></tr>`;

  h += titel(2, 'MS-Schaltanlage');
  h += fotoZeile('Schaltanlage, Übersichtsplan', m.schaltanlagen.flatMap(s => s.asset.feldFotos || []));
  if (!m.schaltanlagen.length) h += `<tr><td colspan="5" class="mut">keine MS-Schaltanlage erfasst</td></tr>`;
  m.schaltanlagen.forEach(s => {
    const p = s.asset.props || {};
    h += `<tr><td class="lbl">Ausführung${m.schaltanlagen.length > 1 ? '<br><span class="mut">' + _esc(s.asset.name) + '</span>' : ''}</td><td>${_kb('saAusfuehrung', p.ausfuehrung)}</td>
      <td class="lbl">Isolationsmedium Schaltanlage</td><td colspan="2">${_kb('saIsolation', p.isolation)}</td></tr>
      <tr><td class="lbl">Weitere Angaben</td><td>Baujahr: ${_esc(s.asset.baujahr ?? '')}<br>Anz. Schaltfelder: ${_esc(p.felder ?? s.felder.length)}</td>
      <td colspan="3">${s.felder.map(f => `Feld ${f.nr} – ${_esc(f.name || f.auto)}`).join('<br>')}</td></tr>`;
  });

  h += titel(3, 'Transformatoren');
  h += fotoZeile('Trafos, Typenschilder', m.trafos.flatMap(t => t.asset.feldFotos || []));
  const tr = m.trafos.slice(0, 4);
  const zelle = fn => tr.map(fn).map(x => `<td>${x}</td>`).join('') + '<td></td>'.repeat(Math.max(0, 4 - tr.length));
  h += `<tr><td class="lbl">Anzahl Trafos</td><td colspan="4">${m.trafos.length}</td></tr>
    <tr><td class="lbl">Bezeichnung Trafo</td>${zelle(t => _esc(t.asset.name))}</tr>
    <tr><td class="lbl">Leistungen Trafos</td>${zelle(t => (t.kva ? t.kva + ' kVA' : ''))}</tr>
    <tr><td class="lbl">Baujahr Trafo</td>${zelle(t => _esc(t.asset.baujahr ?? ''))}</tr>
    <tr><td class="lbl">Ausführung</td>${zelle(t => _kb('kuehlung', t.asset.props?.kuehlung))}</tr>
    <tr><td class="lbl">rechn. wirtschaftliche Nutzungsdauer gem. VDI 2067 (${m.ndTrafo} a)</td>${zelle(t => _kb('ndStatus', t.nd?.status))}</tr>`;
  if (m.trafos.length > 4) h += `<tr><td colspan="5" class="mut">+ ${m.trafos.length - 4} weitere Trafos (siehe Tool)</td></tr>`;

  h += titel(4, 'NSHV');
  h += fotoZeile('NSHV, Messgeräte, Abgänge', m.nshvs.flatMap(n => n.asset.feldFotos || []));
  if (!m.nshvs.length) h += `<tr><td colspan="5" class="mut">keine NSHV erfasst</td></tr>`;
  m.nshvs.forEach(nv => {
    const nf = SS_OPTIONEN.netzform.find(o => o.wert === nv.asset.props?.netzform)?.label || '';
    h += `<tr><td class="lbl">Baujahr:${m.nshvs.length > 1 ? '<br><span class="mut">' + _esc(nv.asset.name) + '</span>' : ''}</td><td>${_esc(nv.asset.baujahr ?? '')}</td>
      <td class="lbl">Anzahl Abgänge:</td><td colspan="2">${_esc(nv.abgaenge ?? '')}</td></tr>
      <tr><td class="lbl">Ausführung NS-Netz:</td><td>${_esc(nf)}</td><td class="lbl">Anz. freie Abgänge:</td><td colspan="2">${_esc(nv.frei ?? '')}</td></tr>`;
  });

  h += `<tr class="titel"><td colspan="2">weitere Betrachtung der Trafostation</td><td colspan="3">Mängel, Anmerkungen</td></tr>`;
  const ml = m.maengel.filter(x => x.feld || x.text);
  h += ml.length
    ? ml.map(x => `<tr><td colspan="2">${_esc(x.feld)}</td><td colspan="3" class="pre">${_esc(x.text)}</td></tr>`).join('')
    : `<tr><td colspan="2" class="mut">Betrachtungsfeld (z.B. NSHV, Raumaufteilung, baulicher Zustand, Zugangsregelung usw.)</td><td colspan="3" class="mut">(Feststellungen)</td></tr>`;
  h += `</table><div class="fuss">Datum der Begehung: ${_esc(datum)}</div>`;
  return h;
}

export function ssbDrucken() {
  if (!_modell) return;
  const m = _modell;
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Steckbrief ${_esc(m.geb.nummer ? 'Geb. ' + m.geb.nummer + ' ' : '')}${_esc(m.geb.name)}</title>
<style>
  @page { size: A4 portrait; margin: 16mm 14mm 18mm; }
  body { font-family: Arial, "Segoe UI", sans-serif; font-size: 9pt; color: #1a1a1a; margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  .kopf td { border-bottom: 1.5pt solid #3b8a3e; padding: 2mm 1mm; font-size: 9.5pt; }
  .kopf .anl { width: 22mm; color: #3b8a3e; font-weight: 700; }
  .blatt { margin-top: 4mm; table-layout: fixed; }
  .blatt td { border: 0.6pt solid #9aa59a; padding: 1.4mm 1.8mm; vertical-align: top; line-height: 1.45; }
  .blatt td.lbl, .lbl { color: #333; font-weight: 600; }
  tr.titel td { background: #3b8a3e; color: #fff; font-weight: 700; font-size: 10pt; padding: 1.8mm; }
  tr { page-break-inside: avoid; }
  .fotos { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 1mm; }
  .fotos img { height: 32mm; max-width: 58mm; object-fit: cover; border: 0.5pt solid #bbb; }
  .leer, .mut { color: #777; }
  .pre { white-space: pre-wrap; }
  .fuss { margin-top: 5mm; font-size: 8.5pt; color: #333; border-top: 0.6pt solid #9aa59a; padding-top: 1.5mm; }
  .druckleiste { margin: 0 0 4mm; } @media print { .druckleiste { display: none; } }
</style></head><body>
<div class="druckleiste"><button onclick="window.print()">🖨 Drucken / Als PDF speichern</button></div>
${_druckHtml(m)}
</body></html>`;
  const win = window.open('', '_blank');
  if (!win) { showHint('⚠ Popup blockiert — bitte für diese Seite erlauben.'); return; }
  win.document.write(html);
  win.document.close();
}
