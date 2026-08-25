// ── 13w-bestand-panel.js — Bestands-Tor: Plausibilitätsprüfung vor der Planung ──
//
// Zeigt das Ergebnis von lib/bestand-check.js:
//   • Reifegrad  — welche Analyse trägt mit dem aktuellen Datenstand
//   • Befunde    — was am Bestand nicht stimmt, nach Schwere sortiert
//
// Bewusst nicht blockierend: In echten Projekten sind Bestandsdaten immer
// unvollständig. Das Panel sagt, was belastbar ist — es verhindert nichts.
//
// Das Panel wird beim ersten Öffnen dynamisch erzeugt (vgl. Engpass-Panel).

import { bestandPruefen, SCHWERE } from './lib/bestand-check.js';
import { ASSETS } from './13a-assets-core.js';
import { elCalcAssets, openCableInspector } from './05b-stromnetz.js';
import { openAssetInspector } from './13e-assets-inspector.js';
import { map } from './02b-gebaeude.js';
import { showHint, flyTo } from './03c-gebaeude-io.js';
import { SCHICHT } from './lib/schichten.js';

const PANEL_ID = 'bestand-panel';
let _ergebnis = null;

const SCHWERE_META = {
  [SCHWERE.FEHLER]:  { farbe: '#e53935', icon: '✕', label: 'Fehler' },
  [SCHWERE.WARNUNG]: { farbe: '#f9a825', icon: '!', label: 'Warnung' },
  [SCHWERE.HINWEIS]: { farbe: '#4fc3f7', icon: 'i', label: 'Hinweis' },
};

// ── Panel-Gerüst ─────────────────────────────────────────────────────────────

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel amber-border';
  panel.style.cssText = 'top:70px;min-width:520px;max-width:760px;max-height:84vh;padding:0 18px 14px;overflow:auto;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#4fc3f7;font-size:12px;font-weight:600;">🏛 Bestand prüfen</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="bestandPanelToggle()">✕</span>
    </div>
    <div id="bestand-panel-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

function _body() { return document.getElementById('bestand-panel-body'); }

export function bestandPanelToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar) bestandPruefenUndZeigen();
}

/** Netz für das Basisjahr rechnen und alle Prüfungen ausführen. */
export function bestandPruefenUndZeigen() {
  _ensurePanel().style.display = 'block';
  _body().innerHTML = '<div style="padding:22px;color:var(--muted);font-size:11px;">⏳ Bestand wird geprüft …</div>';
  setTimeout(() => {
    try {
      const heute = new Date().getFullYear();
      // NUR die Bestandsschicht rechnen — pruefeAuslastungHeute liest die Werte,
      // die elCalcAssets auf die Kanten schreibt. Der Jahresfilter allein würde
      // hier nicht reichen: ein Entwicklungsobjekt mit bereits vergangenem
      // Baujahr zählte sonst mit und täuschte einen Bestandsmangel vor.
      elCalcAssets({ year: heute, silent: true, schichten: [SCHICHT.BESTAND] });
      _ergebnis = bestandPruefen({
        assets:   ASSETS.items || [],
        edges:    window.stromEdges || [],
        gebaeude: window.gebaeude || [],
        heute,
      });
      _render();
      // Live-Zustand wiederherstellen: die Prüfrechnung hat Auslastungen und
      // auto-dimensionierte Querschnitte auf den Bestand allein bezogen.
      elCalcAssets();
    } catch (err) {
      console.error('Bestandsprüfung:', err);
      _body().innerHTML = '<div style="padding:18px;color:#e53935;font-size:11px;">Prüfung fehlgeschlagen — Details in der Konsole.</div>';
    }
  }, 50);
}

/** Von einem Befund aus zum betroffenen Objekt springen. */
export function bestandSpringeZu(id, art) {
  if (art === 'kabel') {
    const edge = (window.stromEdges || []).find(e => e.id === id);
    if (!edge) { showHint('⚠ Kabel nicht mehr vorhanden.'); return; }
    if (edge.layer) map.flyToBounds(edge.layer.getBounds(), { padding: [60, 60], maxZoom: 19, duration: 1 });
    openCableInspector(edge);
  } else if (art === 'gebaeude') {
    // Gebäude-IDs sind Zahlen; aus dem data-Attribut kommen sie als Text zurück.
    flyTo(Number(id));
  } else {
    const asset = (ASSETS.items || []).find(a => a.id === id);
    if (!asset) { showHint('⚠ Anlage nicht mehr vorhanden.'); return; }
    if (asset.lat != null && asset.lng != null) {
      map.flyTo([asset.lat, asset.lng], Math.max(map.getZoom(), 18), { duration: 1 });
    }
    openAssetInspector(asset);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function _render() {
  const el = _body();
  if (!el || !_ergebnis) return;
  el.innerHTML = `
    ${_kopf()}
    ${_reifegrad()}
    ${_befunde()}`;
}

function _kopf() {
  const { zaehler } = _ergebnis;
  const btn = 'padding:5px 10px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--text);font-family:inherit;font-size:10px;cursor:pointer;';
  const chip = (n, meta) => n
    ? `<span style="color:${meta.farbe};font-weight:600;">${n} ${meta.label}${n > 1 ? 'e' : ''}</span>`
    : '';
  const chips = [
    chip(zaehler.fehler,  SCHWERE_META[SCHWERE.FEHLER]),
    chip(zaehler.warnung, SCHWERE_META[SCHWERE.WARNUNG]),
    chip(zaehler.hinweis, SCHWERE_META[SCHWERE.HINWEIS]),
  ].filter(Boolean).join(' · ');

  return `
  <div style="display:flex;align-items:center;gap:8px;margin:2px 0 10px;">
    <button style="${btn}border-color:#4fc3f7;color:#4fc3f7;" data-click="bestandPruefenUndZeigen()">↻ Neu prüfen</button>
    <span style="margin-left:auto;font-size:10px;">
      ${chips || '<span style="color:#4caf50;">✓ keine Befunde</span>'}
    </span>
  </div>`;
}

// Reifegrad: welche Analyse trägt mit dem aktuellen Datenstand
function _reifegrad() {
  const zeilen = _ergebnis.reifegrad.map(s => `
    <div style="display:flex;align-items:center;gap:8px;padding:3px 6px;font-size:10px;">
      <span style="flex:0 0 14px;color:${s.erfuellt ? '#4caf50' : '#546e7a'};">${s.erfuellt ? '✓' : '○'}</span>
      <span style="flex:0 0 180px;color:${s.erfuellt ? 'var(--text)' : 'var(--muted)'};">${s.label}</span>
      <span style="flex:1;color:var(--muted);font-size:9px;">${s.fehlt}</span>
    </div>`).join('');

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Belastbar auswertbar
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:6px 4px;margin-bottom:12px;">
    ${zeilen}
    <div style="font-size:8.5px;color:var(--muted);padding:5px 6px 0;line-height:1.6;">
      Kein Tor, das etwas verbietet — eine Aussage darüber, welche Analyse der aktuelle
      Datenstand trägt. Alles darüber lässt sich rechnen, ist aber nicht belastbar.
    </div>
  </div>`;
}

function _befunde() {
  const { befunde } = _ergebnis;
  if (!befunde.length) {
    return `<div style="padding:14px;background:var(--surface2);border-radius:6px;font-size:11px;color:#4caf50;">
      ✓ Keine Auffälligkeiten im Bestand gefunden.</div>`;
  }

  const MAX = 12;   // lange Listen würden das Panel sprengen
  const bloecke = befunde.map(b => {
    const meta = SCHWERE_META[b.schwere];
    const gezeigt = b.betroffene.slice(0, MAX);
    const rest = b.betroffene.length - gezeigt.length;
    const items = gezeigt.map(t => `
      <span style="display:inline-block;font-size:9px;padding:1px 6px;margin:1px 2px 1px 0;border-radius:3px;
                   background:var(--surface);border:1px solid var(--border);color:var(--text);cursor:pointer;"
            data-click="bestandSpringeZu('${t.id}','${t.art}')"
            title="Auf der Karte anzeigen und Eigenschaften öffnen">${t.label}</span>`).join('');
    const restTxt = rest > 0 ? `<span style="font-size:9px;color:var(--muted);"> +${rest} weitere</span>` : '';

    return `
    <div style="border-left:3px solid ${meta.farbe};background:var(--surface2);border-radius:0 6px 6px 0;
                padding:6px 8px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--text);">
        <span style="color:${meta.farbe};font-weight:700;">${meta.icon}</span>
        <b>${b.titel}</b>
        ${b.betroffene.length ? `<span style="color:var(--muted);font-size:9px;">${b.betroffene.length}×</span>` : ''}
      </div>
      <div style="font-size:9px;color:var(--muted);line-height:1.6;margin:3px 0 4px;">${b.detail}</div>
      ${items}${restTxt}
    </div>`;
  }).join('');

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Befunde · ${befunde.length}
  </div>
  ${bloecke}
  <div style="font-size:8.5px;color:var(--muted);padding:2px 6px;line-height:1.6;">
    Für schon heute überlastete Betriebsmittel schlägt der Engpass-Fahrplan unter
    „🔧 Bestandsmängel" konkrete Korrekturen der Dimensionierung vor.
  </div>`;
}
