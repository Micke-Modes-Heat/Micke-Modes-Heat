// ── 13t-wind-analyse.js — Windkraft-Auslegungsübersicht (eigenes Panel, analog zur Netzanalyse) ──
// Listet alle Windkraftanlagen des Projekts mit Ertrag, Abständen, Eignungsfläche und
// Szenarien-Vergleich in einer geräumigen Übersicht — statt verstreut im schmalen
// Asset-Inspector. Verwendet ausschließlich bereits vorhandene Berechnungslogik
// (13q-wind-ertrag.js, 13e-assets-inspector.js) — keine neue Fachlogik.

import { ASSETS, getAssetStatus, createAsset } from './13a-assets-core.js';
import { globalYear } from './01-globals-varianten.js';
import { map } from './02b-gebaeude.js';
import { drawAssetMarker } from './13b-assets-render.js';
import { computeWindYield, computeWindScenarios, getWindAssetsSummary,
         fetchWindSiteData, getWindSiteData, windSiteVAtHeight } from './13q-wind-ertrag.js';
import { computeTurbinePlacements } from './13s-wind-flaeche.js';
import { windRestriktBlock, getWindRestriktRings } from './13u-wind-restriktion.js';
import { _liegenschaftJahresbedarfMWh, _distanceToPlangebietM, _activeGebietLabel } from './13e-assets-inspector.js';
import { _WINDA_KLASSEN } from './config/wind-defaults.js';
export { _WINDA_KLASSEN } from './config/wind-defaults.js';

// Anlagenklassen für die Platzierungsvorschläge — repräsentative, marktübliche Größen
// (kein Bezug zu evtl. schon vorhandenen Anlagen, dafür gibt es je Anlage die eigene
// Szenarien-Vergleich-Karte). Wind-/Nennwind-Defaults wie überall im Wind-Modul.
let _panelOpen = false;

export function windaTogglePanel() {
  _panelOpen = !_panelOpen;
  const panel = document.getElementById('windanalyse-panel');
  const btn   = document.getElementById('btn-windanalyse-toggle');
  if (!panel) return;
  panel.style.display = _panelOpen ? 'block' : 'none';
  btn?.classList.toggle('active', _panelOpen);
  if (_panelOpen) windaRenderPanel();
}

export function windaRenderPanel() {
  const el = document.getElementById('windanalyse-content');
  if (!el) return;
  const items = (ASSETS.items || []).filter(a => a.type === 'Wind');

  const gebiet = _activeGebietLabel();
  const gebietBlock = `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
      <button class="ins-link-btn" onclick="toggleDrawWindGebiet()" style="margin:0;">
        ${window.windGebietDrawing ? '✎ Zeichnen läuft … (ESC zum Abbrechen)' : window.windGebietPolygon ? '↺ Windgebiet neu zeichnen' : '🗺 Eigenes Windgebiet zeichnen'}
      </button>
      ${window.windGebietPolygon ? `<button class="ins-link-btn" onclick="clearWindGebiet()" style="margin:0;color:#ef9a9a;">✕ löschen</button>` : ''}
    </div>
    <div style="font-size:9px;color:var(--muted);margin-bottom:12px;">
      Maßgebliches Gebiet für Abstände/Eignungsfläche unten: <b style="color:${gebiet ? '#4dd0e1' : '#ef9a9a'};">${gebiet || 'keines gezeichnet'}</b>
      — das Windgebiet kann größer/anders zugeschnitten sein als das allgemeine Plangebiet.
    </div>`;

  const siteBlock         = _windaSiteBlock(items.length);
  const kartenLayerBlock  = (typeof windRestriktBlock === 'function') ? windRestriktBlock() : '';
  const platzierungBlock  = _windaPlatzierungBlock();

  if (!items.length) {
    el.innerHTML = gebietBlock + siteBlock + kartenLayerBlock + platzierungBlock + `<div style="font-size:11px;color:var(--muted);padding:8px 0;">Keine Windkraftanlagen im Projekt — im Elektro-Tab unter „Erzeugung → Windkraftanlage" anlegen, oder oben einen Platzierungsvorschlag übernehmen.</div>`;
    return;
  }

  const summary = getWindAssetsSummary();
  const zielMwh = _liegenschaftJahresbedarfMWh();

  const headerBlock = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
      <div style="background:var(--surface2);border-radius:6px;padding:6px 8px;">
        <div style="font-size:8px;color:var(--muted);">Anlagen (aktiv)</div>
        <div style="font-size:14px;font-weight:700;color:#4dd0e1;">${summary.count}</div>
      </div>
      <div style="background:var(--surface2);border-radius:6px;padding:6px 8px;">
        <div style="font-size:8px;color:var(--muted);">Jahresertrag gesamt</div>
        <div style="font-size:14px;font-weight:700;color:#4dd0e1;">${summary.mwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} MWh/a</div>
      </div>
      <div style="background:var(--surface2);border-radius:6px;padding:6px 8px;">
        <div style="font-size:8px;color:var(--muted);">Liegenschaftsbedarf</div>
        <div style="font-size:14px;font-weight:700;color:${zielMwh > 0 ? 'var(--text)' : '#ef9a9a'};">${zielMwh > 0 ? zielMwh.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' MWh/a' : '—'}</div>
      </div>
    </div>`;

  const cards = items.map(a => _windaCard(a, zielMwh)).join('');
  el.innerHTML = gebietBlock + siteBlock + kartenLayerBlock + platzierungBlock + headerBlock + cards;
}

// ── Standort-Winddaten (Open-Meteo / ERA5) ───────────────────────────────────
let _siteLoading = false;

// Koordinate für den Abruf: Windgebiet-Mitte > Plangebiet-Mitte > Kartenmitte
function _windaSiteCoords() {
  const poly = window.windGebietPolygon || window.areaPolygon;
  if (poly?.getBounds) {
    const c = poly.getBounds().getCenter();
    return { lat: c.lat, lng: c.lng, quelle: window.windGebietPolygon ? 'Windgebiet-Mitte' : 'Plangebiet-Mitte' };
  }
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng, quelle: 'Kartenmitte' };
}

function _windaSiteBlock(nAssets) {
  const s = getWindSiteData();
  const coords = _windaSiteCoords();
  const nY = parseInt(document.getElementById('winda-site-years')?.value) || 3;

  let statusHtml;
  if (_siteLoading) {
    statusHtml = `<div style="font-size:10px;color:#4dd0e1;padding:4px 0;">⏳ Lade Winddaten von Open-Meteo …</div>`;
  } else if (s) {
    statusHtml = `
      <div style="background:var(--surface2);border:1px solid rgba(77,208,225,0.35);border-radius:6px;padding:6px 9px;margin-bottom:6px;">
        <div style="font-size:10px;color:var(--text);">
          Ø <b style="color:#4dd0e1;">${s.vMean100.toFixed(2)} m/s</b> (100 m) ·
          Weibull-k <b style="color:#4dd0e1;">${s.weibullK.toFixed(2)}</b> ·
          Hellmann-α <b style="color:#4dd0e1;">${s.alpha.toFixed(2)}</b>
        </div>
        <div style="font-size:8px;color:var(--muted);margin-top:2px;">
          Jahre ${s.startYear}–${s.endYear} · Stundenreihe ${s.profilJahr} ·
          ${s.lat.toFixed(3)}, ${s.lng.toFixed(3)} · geladen ${new Date(s.geladen).toLocaleDateString('de-DE')}
        </div>
      </div>
      ${nAssets > 0 ? `<button class="ins-link-btn" onclick="windaApplySiteToAssets()" style="margin:0 0 4px;">→ Kennwerte auf alle ${nAssets} Windkraftanlage(n) übernehmen</button>` : ''}
      <div style="font-size:8px;color:#607d8b;margin-bottom:4px;">Solange geladen, rechnen alle Zeitprofile (Inspector, NAP-, PV-, Knotenpunkt-Analyse) automatisch mit der realen Stundenreihe statt dem synthetischen Profil. „Übernehmen" setzt zusätzlich Ø-Wind/Weibull-k je Anlage (auf deren Nabenhöhe umgerechnet).</div>`;
  } else {
    statusHtml = `<div style="font-size:9px;color:var(--muted);padding:2px 0 4px;">Noch keine Standortdaten geladen — Zeitprofile nutzen das synthetische Weibull-Profil.</div>`;
  }

  return `
    <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:2px 0 6px;">🌐 Standort-Winddaten (ERA5-Reanalyse)</div>
    <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:6px;">
      <div style="flex:1;">
        <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Jahre (Mittelung)</div>
        <input id="winda-site-years" type="number" value="${nY}" min="1" max="5" step="1"
          style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"/>
      </div>
      <button class="ins-link-btn" onclick="windaFetchSite()" ${_siteLoading ? 'disabled' : ''}
        style="margin:0;flex:2;">${s ? '↺ Neu laden' : '🌐 Winddaten laden'} (${coords.quelle})</button>
    </div>
    ${statusHtml}
    <div style="font-size:8px;color:#607d8b;margin-bottom:12px;">ERA5 ist ein ~25-km-Raster-Modell (Open-Meteo, CC-BY 4.0) — gut fürs Screening, lokale Effekte (Waldkante, Kuppe) fehlen. Ersetzt kein Standortwindgutachten.</div>`;
}

window.windaFetchSite = async function () {
  if (_siteLoading) return;
  const nY = parseInt(document.getElementById('winda-site-years')?.value) || 3;
  const { lat, lng } = _windaSiteCoords();
  _siteLoading = true;
  windaRenderPanel();
  try {
    await fetchWindSiteData(lat, lng, nY);
  } catch (e) {
    alert('Winddaten-Abruf fehlgeschlagen: ' + e.message + '\n\nBesteht eine Internetverbindung?');
  }
  _siteLoading = false;
  windaRenderPanel();
};

window.windaApplySiteToAssets = function () {
  const s = getWindSiteData();
  if (!s) return;
  let n = 0;
  for (const a of (ASSETS.items || [])) {
    if (a.type !== 'Wind') continue;
    const hubM = parseFloat(a.props?.nabenhoheM) || 100;
    a.props = a.props || {};
    a.props.mittlereWindMs = Math.round(windSiteVAtHeight(hubM) * 10) / 10;
    a.props.weibullK       = Math.round(s.weibullK * 100) / 100;
    drawAssetMarker(a);
    n++;
  }
  // Offenen Inspector aktualisieren, damit die neuen Werte sichtbar werden
  if (ASSETS.selectedId) {
    const sel = (ASSETS.items || []).find(a => a.id === ASSETS.selectedId);
    if (sel?.type === 'Wind' && typeof window.openAssetInspector === 'function') window.openAssetInspector(sel);
  }
  windaRenderPanel();
};

// ── Platzierungsvorschläge ───────────────────────────────────────────────────
// Bereits vorhandene Windkraftanlagen werden als zusätzliche Ausschlusskreise behandelt
// (mit ihrem eigenen Planungsabstand), damit Vorschläge nicht zu dicht an bestehende
// Anlagen rücken. Grobe Kreis-Näherung als 12-Eck.
function _circleRingApprox(lat, lng, radiusM, n = 12) {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push({ lat: lat + (radiusM * Math.sin(a)) / mPerLat, lng: lng + (radiusM * Math.cos(a)) / mPerLng });
  }
  return ring;
}

function _windaExistingWindRings() {
  return (ASSETS.items || [])
    .filter(a => a.type === 'Wind' && getAssetStatus(a, globalYear) === 'active')
    .map(a => {
      const p = a.props || {};
      const rotorD = parseFloat(p.rotordurchmesserM) || 60;
      const mult   = parseFloat(p.abstandMultiplikator) || 5;
      return _circleRingApprox(a.lat, a.lng, rotorD * mult);
    });
}

function _windaGebietRing() {
  const poly = window.windGebietPolygon || window.areaPolygon;
  if (!poly || typeof poly.getLatLngs !== 'function') return null;
  const rings = poly.getLatLngs();
  const ring = Array.isArray(rings[0]) ? rings[0] : rings;
  if (!ring || ring.length < 3) return null;
  return ring.map(ll => ({ lat: ll.lat, lng: ll.lng }));
}

function _windaBuildingRings() {
  return (window.gebaeude || [])
    .filter(g => Array.isArray(g.polygon) && g.polygon.length >= 3)
    .map(g => g.polygon.map(pt => ({ lat: pt.lat ?? pt[0], lng: pt.lng ?? pt[1] })));
}

// Cache der zuletzt berechneten Varianten (für den „übernehmen"-Klick, ohne alles neu zu rechnen)
let _windaLastVarianten = null;

function _windaComputeVarianten() {
  const ring = _windaGebietRing();
  if (!ring) return null;
  const buildingRings = [..._windaBuildingRings(), ..._windaExistingWindRings()];
  const site   = getWindSiteData();
  const vMean100 = parseFloat(document.getElementById('winda-vmean')?.value)
    || (site ? Math.round(site.vMean100 * 10) / 10 : 6.5);
  const mult   = parseFloat(document.getElementById('winda-mult')?.value) || 5;
  const alpha  = site?.alpha ?? 0.2;
  const wK     = site?.weibullK ?? 2;

  return _WINDA_KLASSEN.map(k => {
    const radiusM = k.rotorD * mult;
    const gesamthoeheK = k.nabenhoehe + k.rotorD / 2;
    // Zur Gebietsgrenze reicht die Kipphöhe (≈ Gesamthöhe) — der volle Planungsabstand
    // gilt nur untereinander und zu Gebäuden, sonst wird die Anlagenzahl unterschätzt.
    const placement = computeTurbinePlacements({ polygonRing: ring, buildingRings, exclusionRings: getWindRestriktRings(), radiusM, boundaryM: gesamthoeheK });
    // Wind auf Nabenhöhe der Klasse (Hellmann ab 100-m-Referenz) — sonst würde die
    // 35-m-Kleinanlage mit demselben Wind gerechnet wie die 150-m-Anlage.
    const vHub = vMean100 * Math.pow(k.nabenhoehe / 100, alpha);
    const y = computeWindYield({ vMean: vHub, k: wK, ratedKw: k.ratedKw, cutIn: 3, ratedWind: 12, cutOut: 25, rotorDiameterM: k.rotorD });
    return {
      ...k, radiusM, mult, vMean: vHub, vMean100, gesamthoehe: gesamthoeheK, boundaryM: gesamthoeheK,
      count: placement.points.length, points: placement.points,
      annualMWhEach: y.annualMWh, vlh: y.volllaststundenH,
    };
  });
}

function _windaPlatzierungBlock() {
  const ring = _windaGebietRing();
  if (!ring) return '';

  const site  = getWindSiteData();
  const vMean = parseFloat(document.getElementById('winda-vmean')?.value)
    || (site ? Math.round(site.vMean100 * 10) / 10 : 6.5);
  const mult  = parseFloat(document.getElementById('winda-mult')?.value) || 5;
  const varianten = _windaComputeVarianten();
  _windaLastVarianten = varianten;

  const rows = varianten.map(v => {
    const hoeheCol = v.gesamthoehe <= 50 ? '#4caf50' : '#f9a825';
    const totalMwh = v.count * v.annualMWhEach;
    const totalKw  = v.count * v.ratedKw;
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:8px 10px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="font-size:10px;font-weight:600;color:var(--text);flex:1;">${v.label}</span>
        <span style="font-size:9px;color:${hoeheCol};font-weight:700;">${v.gesamthoehe.toFixed(0)} m Gesamthöhe</span>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">
        ${v.ratedKw.toFixed(0)} kW · Ø ${v.rotorD.toFixed(0)} m · Nabenhöhe ${v.nabenhoehe.toFixed(0)} m · Abstand ${v.radiusM.toFixed(0)} m untereinander / ${v.boundaryM.toFixed(0)} m zur Grenze
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;font-size:10px;">
          <span style="color:#4dd0e1;font-weight:700;">${v.count}×</span> Standorte gefunden
          ${v.count > 0 ? `→ <span style="color:#4dd0e1;">${(totalKw/1000).toLocaleString('de-DE',{maximumFractionDigits:1})} MW</span> ·
            <span style="color:#4dd0e1;">${totalMwh.toLocaleString('de-DE',{maximumFractionDigits:0})} MWh/a</span>` : ''}
        </div>
        ${v.count > 0 ? `<button class="ins-link-btn" onclick="_windaApplyPlacement('${v.id}')" style="margin:0;">→ übernehmen</button>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
    <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:2px 0 6px;">📍 Platzierungsvorschläge im Gebiet</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
      <div>
        <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Ø Wind auf 100 m (m/s)${site ? ' <span style="color:#4dd0e1;">· ERA5</span>' : ''}</div>
        <input id="winda-vmean" type="number" value="${vMean}" step="0.1" min="0"
          style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
          onchange="windaRenderPanel()"/>
      </div>
      <div>
        <div style="font-size:8px;color:var(--muted);margin-bottom:2px;">Planungsabstand ×Ø</div>
        <input id="winda-mult" type="number" value="${mult}" step="0.5" min="1"
          style="width:100%;padding:3px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:10px;"
          onchange="windaRenderPanel()"/>
      </div>
    </div>
    ${rows}
    <div style="font-size:8px;color:#607d8b;margin-bottom:12px;">Näherung (Raster-Greedy, kein echtes Packungsoptimum) — Planungsabstand (×Ø) gilt untereinander und zu Gebäuden, zur Gebietsgrenze nur die Kipphöhe (≈ Gesamthöhe); bereits platzierte Anlagen sind als Ausschlusszonen berücksichtigt. „Übernehmen" legt echte Windkraftanlagen mit diesen Kennwerten an, danach im Inspector feinjustierbar.</div>`;
}

window._windaApplyPlacement = function (klassenId) {
  const varianten = _windaLastVarianten || _windaComputeVarianten();
  const v = varianten?.find(x => x.id === klassenId);
  if (!v || !v.points.length) return;
  if (!confirm(`${v.points.length} Windkraftanlage(n) „${v.label}" an den vorgeschlagenen Standorten anlegen?`)) return;

  for (const pt of v.points) {
    const asset = createAsset('Wind', pt.lat, pt.lng, {});
    if (!asset) continue;
    asset.props = {
      leistungKW: v.ratedKw, nabenhoheM: v.nabenhoehe, rotordurchmesserM: v.rotorD,
      einschaltwindMs: 3, nennwindMs: 12, abschaltwindMs: 25,
      mittlereWindMs: Math.round(v.vMean * 10) / 10,
      weibullK: Math.round((getWindSiteData()?.weibullK ?? 2) * 100) / 100,
      abstandMultiplikator: v.mult,
    };
    drawAssetMarker(asset);
  }
  if (typeof window.renderSidebarAssetList === 'function') window.renderSidebarAssetList();
  windaRenderPanel();
};

function _windaScenRow(s) {
  if (!s) return '';
  const gh = s.gesamthoeheM;
  const ghCol = gh <= 50 ? '#4caf50' : '#f9a825';
  return `<div style="display:flex;justify-content:space-between;gap:6px;font-size:9px;padding:2px 0;">
    <span style="color:var(--muted);">${s.label}</span>
    <span style="text-align:right;"><span style="color:${ghCol};">${gh.toFixed(0)} m</span> · ${s.ratedKw.toFixed(0)} kW ·
      <span style="color:#4dd0e1;">${s.annualMWh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} MWh/a</span></span>
  </div>`;
}

function _windaCard(asset, zielMwh) {
  const p = asset.props || {};
  const status    = getAssetStatus(asset, globalYear);
  const ratedKw   = parseFloat(p.leistungKW)        || 500;
  const cutIn     = parseFloat(p.einschaltwindMs)   || 3;
  const ratedWind = parseFloat(p.nennwindMs)        || 12;
  const cutOut    = parseFloat(p.abschaltwindMs)    || 25;
  const rotorD    = parseFloat(p.rotordurchmesserM) || 60;
  const nabenhoehe= parseFloat(p.nabenhoheM)        || 100;
  const vMean     = parseFloat(p.mittlereWindMs)    || 6.0;
  const wK        = parseFloat(p.weibullK)          || 2.0;
  const mult      = parseFloat(p.abstandMultiplikator) || 5;

  const y = computeWindYield({ vMean, k: wK, ratedKw, cutIn, ratedWind, cutOut, rotorDiameterM: rotorD });
  const gesamthoehe = nabenhoehe + rotorD / 2;
  const hoeheCol = gesamthoehe <= 50 ? '#4caf50' : '#f9a825';

  const maxRadiusM = _distanceToPlangebietM(asset.lat, asset.lng);
  const scen = computeWindScenarios({
    nabenhoheM: nabenhoehe, rotorDurchmesserM: rotorD, ratedKw, cutIn, ratedWind, cutOut, vMean, k: wK,
    hellmannAlpha: getWindSiteData()?.alpha ?? 0.2,
    zielJahresbedarfMWh: zielMwh, maxRadiusM, abstandMultiplikator: mult,
  });

  const stats = asset._eignungsStats;
  const eignungTxt = stats?.cells?.length
    ? `${(stats.areaM2 / 10000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ha geeignet`
    : (p.eignungsflaecheVisible === true ? 'keine Fläche gefunden' : 'nicht berechnet — im Inspector „Eignungsfläche anzeigen" aktivieren');

  const statusCol = { active: '#4caf50', planned: '#f9a825', demolished: '#ef5350' }[status] || '#888';
  const statusLbl = { active: 'aktiv', planned: 'geplant', demolished: 'abgerissen' }[status] || status;

  return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:10px 12px;margin-bottom:10px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${statusCol};flex-shrink:0;" title="${statusLbl}"></span>
      <span style="font-size:11px;font-weight:600;color:var(--text);flex:1;cursor:pointer;" onclick="_windaOpenAsset('${asset.id}')" title="Inspector öffnen &amp; auf Karte zeigen">${asset.name}</span>
      <span style="font-size:9px;color:${hoeheCol};font-weight:700;">Gesamthöhe ${gesamthoehe.toFixed(0)} m</span>
    </div>
    <div style="font-size:9px;color:var(--muted);margin-bottom:6px;">
      ${ratedKw.toFixed(0)} kW · Ø ${rotorD.toFixed(0)} m · Nabenhöhe ${nabenhoehe.toFixed(0)} m ·
      <span style="color:#4dd0e1;">${y.annualMWh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} MWh/a</span> ·
      ${y.volllaststundenH.toFixed(0)} Vlh · ${y.kapazitaetsfaktorPct.toFixed(0)} % KF
    </div>
    <div style="font-size:9px;color:var(--muted);margin-bottom:4px;">🗺 Eignungsfläche: ${eignungTxt}</div>
    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:4px;">
      ${_windaScenRow(scen.scen50)}${scen.scenBedarf ? _windaScenRow(scen.scenBedarf) : ''}${_windaScenRow(scen.scenMax)}
    </div>
  </div>`;
}

window._windaOpenAsset = function (id) {
  const a = (ASSETS.items || []).find(x => x.id === id);
  if (a && typeof window.openAssetInspector === 'function') {
    window.openAssetInspector(a);
    if (map && a.lat != null && a.lng != null) map.setView([a.lat, a.lng], Math.max(map.getZoom(), 15));
  }
};

setTimeout(() => {
  window.windaTogglePanel = windaTogglePanel;
  window.windaRenderPanel = windaRenderPanel;
  // Windgebiet-Änderungen sollen bei geöffnetem Panel auch dieses aktualisieren
  const prevHandler = window._onWindGebietChanged;
  window._onWindGebietChanged = function () {
    if (typeof prevHandler === 'function') prevHandler();
    if (_panelOpen) windaRenderPanel();
  };
}, 0);
