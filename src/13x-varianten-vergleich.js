// ── 13x-varianten-vergleich.js — Was plant welche Variante? ──────────────────
//
// Zeigt die Planungsentscheidungen ALLER Varianten nebeneinander, ohne die
// Variante zu wechseln. Erst durch das Delta-Modell möglich
// (lib/varianten-delta.js): Die Entscheidungen jeder Variante liegen als eigene,
// kleine Liste vor. Vorher hätte man jede Variante aktivieren müssen — und dabei
// jedes Mal das komplette Stromnetz abgerissen und neu aufgebaut.

import { variantenVergleich, splitStromNetzState } from './lib/varianten-delta.js';
import { ASSET_CFG } from './13a-assets-core.js';
import {
  varianten, activeVariantId, baseStromNetzSnapshot, stromNetzGemeinsam, activateVariant,
} from './01-globals-varianten.js';

const PANEL_ID = 'varianten-vergleich-panel';

function _ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'float-panel amber-border';
  panel.style.cssText = 'top:70px;min-width:540px;max-width:820px;max-height:84vh;padding:0 18px 14px;overflow:auto;';
  panel.innerHTML = `
    <div class="panel-drag-handle" onmousedown="startDrag(event,'${PANEL_ID}')">
      <span style="color:#ce93d8;font-size:12px;font-weight:600;">🔀 Varianten vergleichen</span>
      <span class="drag-dots">⠿</span>
      <span style="font-size:14px;color:var(--muted);cursor:pointer;line-height:1;"
            data-click="variantenVergleichToggle()">✕</span>
    </div>
    <div id="varianten-vergleich-body"></div>`;
  document.body.appendChild(panel);
  return panel;
}

export function variantenVergleichToggle() {
  const panel = _ensurePanel();
  const sichtbar = panel.style.display === 'block';
  panel.style.display = sichtbar ? 'none' : 'block';
  if (!sichtbar) variantenVergleichRender();
}

/** Zu einer Variante wechseln und die Ansicht aktualisieren. */
export function variantenVergleichAktivieren(id) {
  activateVariant(id === '' ? null : id);
  variantenVergleichRender();
}

export function variantenVergleichRender() {
  const el = document.getElementById('varianten-vergleich-body');
  if (!el) return;

  // Das gespeicherte Delta der aktiven Variante wird erst beim Wechsel
  // geschrieben — für die aktive Spalte deshalb den Live-Zustand auswerten,
  // sonst fehlt alles seit dem letzten Wechsel Angelegte.
  let liveDelta = null;
  try {
    const live = typeof window.captureStromNetzState === 'function' ? window.captureStromNetzState() : null;
    if (live) liveDelta = splitStromNetzState(live).delta;
  } catch (e) { console.warn('Variantenvergleich: Live-Zustand nicht lesbar', e); }

  const v = variantenVergleich({
    basisDelta: baseStromNetzSnapshot,
    varianten,
    aktiveVarianteId: activeVariantId,
    gemeinsam: stromNetzGemeinsam,
    liveDelta,
  });

  el.innerHTML = `${_grundlage(v)}${_spalten(v)}${_fussnote()}`;
}

// Die geteilte Grundlage — sie ist der Grund, warum der Vergleich überhaupt
// aussagekräftig ist: alle Varianten rechnen gegen dasselbe Netz.
function _grundlage(v) {
  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:2px 0 3px;">
    Gemeinsame Grundlage
  </div>
  <div style="background:var(--surface2);border-radius:6px;padding:7px 9px;margin-bottom:12px;
              display:flex;align-items:center;gap:14px;font-size:10px;">
    <span style="color:#4fc3f7;">🏛 Bestand + 📈 Entwicklung</span>
    <span style="color:var(--text);font-family:'DM Mono',monospace;">${v.gemeinsam.items} Anlagen · ${v.gemeinsam.edges} Kabel</span>
    <span style="margin-left:auto;color:var(--muted);font-size:9px;">
      gilt in allen Varianten gleich
    </span>
  </div>`;
}

function _spalten(v) {
  const zeilen = v.spalten.map(s => {
    const kennwerte = s.zusammenfassung.length
      ? s.zusammenfassung.map(g => {
          const cfg = ASSET_CFG[g.type];
          const wert = g.einheit ? ` ${_num(g.summe)} ${g.einheit}` : '';
          return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:9px;white-space:nowrap;">
            <span style="background:${cfg?.color || '#546e7a'};border-radius:3px;padding:0 4px;font-size:10px;">${cfg?.icon || '•'}</span>
            <span style="color:var(--text);">${g.anzahl}×${wert}</span></span>`;
        }).join('')
      : '<span style="color:var(--muted);font-size:9px;">keine Planungsentscheidungen</span>';

    const aktivBadge = s.aktiv
      ? '<span style="background:#66bb6a22;color:#66bb6a;border-radius:3px;padding:0 5px;font-size:9px;">aktiv</span>'
      : `<span style="font-size:9px;color:#7c4dff;cursor:pointer;"
              data-click="variantenVergleichAktivieren('${s.id ?? ''}')"
              title="Zu dieser Variante wechseln">→ wechseln</span>`;

    return `
    <div style="border-left:3px solid ${s.aktiv ? '#66bb6a' : 'var(--border)'};
                background:var(--surface2);border-radius:0 6px 6px 0;padding:6px 9px;margin-bottom:5px;">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">
        <b style="font-size:10.5px;color:var(--text);">${s.name}</b>
        ${aktivBadge}
        <span style="margin-left:auto;font-size:9px;color:var(--muted);font-family:'DM Mono',monospace;">
          ${s.anzahl} Anlage${s.anzahl === 1 ? '' : 'n'} · ${s.kabel} Kabel
        </span>
      </div>
      <div style="line-height:1.9;">${kennwerte}</div>
    </div>`;
  }).join('');

  return `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;">
    Planungsentscheidungen je Variante
  </div>
  ${zeilen}`;
}

function _fussnote() {
  return `
  <div style="font-size:8.5px;color:var(--muted);padding:4px 6px 0;line-height:1.7;">
    Gezeigt wird nur, was die jeweilige Variante zusätzlich plant. Bestand und
    Entwicklung sind gemeinsam — eine Korrektur daran wirkt sofort in allen
    Varianten, und ein gelöschtes Bestandsobjekt ist überall weg.
  </div>`;
}

const _num = n => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('de-DE') : String(Math.round(n * 10) / 10));
