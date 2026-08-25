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
import {
  lastgangSchnappschuesse, lastgangSchnappschuesseAlleVarianten, schnappschussUeberlast,
} from './13y-lastgang-schnappschuss.js';

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

  el.innerHTML = `${_grundlage(v)}${_spalten(v)}${_netzwirkung()}${_fussnote()}`;
}

/**
 * Netzwirkung: was die geplanten Anlagen an den Knoten auslösen.
 *
 * Läuft nicht automatisch mit — jeder Schnappschuss verlangt, die Variante
 * kurz zu aktivieren, und das baut das Stromnetz jedes Mal neu auf.
 */
export function variantenVergleichNetzwirkung() {
  const btn = document.getElementById('vv-netz-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ rechnet …'; }
  setTimeout(() => {
    try {
      lastgangSchnappschuesseAlleVarianten();
    } catch (err) {
      console.error('Netzwirkung:', err);
    }
    variantenVergleichRender();
  }, 50);
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

// Gegenüberstellung der eingefrorenen Knotenlastgänge. Zeigt je Variante die
// höchstbelasteten Knoten in BEIDEN Richtungen — eine PV-lastige Variante
// belastet das Netz rückwärts, ohne die Bezugsspitze anzurühren.
function _netzwirkung() {
  const kopf = `
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 3px;">
    Netzwirkung an den Knoten
  </div>`;

  const schnapp = lastgangSchnappschuesse();
  if (!schnapp.size) {
    return `${kopf}
    <div style="background:var(--surface2);border-radius:6px;padding:8px 9px;font-size:9.5px;color:var(--muted);line-height:1.7;">
      Noch nicht berechnet. Jede Variante muss dafür kurz aktiviert werden — das
      baut das Stromnetz jedes Mal neu auf und dauert entsprechend.
      <div style="margin-top:6px;">
        <button id="vv-netz-btn" data-click="variantenVergleichNetzwirkung()"
          style="padding:4px 10px;border-radius:5px;border:1px solid #ce93d8;background:transparent;
                 color:#ce93d8;font-family:inherit;font-size:10px;cursor:pointer;">
          ⚡ Netzwirkung berechnen</button>
      </div>
    </div>`;
  }

  const zeilen = [...schnapp.values()].map(s => {
    const top = [...s.knoten]
      .sort((a, b) => Math.max(b.auslastungPct ?? 0, b.rueckspeisungPct ?? 0)
                    - Math.max(a.auslastungPct ?? 0, a.rueckspeisungPct ?? 0))
      .slice(0, 3);
    const ueber = schnappschussUeberlast(s).length;

    const knotenTxt = top.length
      ? top.map(k => {
          const a = k.auslastungPct, r = k.rueckspeisungPct;
          const col = p => p == null ? 'var(--muted)' : p > 100 ? '#e53935' : p > 80 ? '#f9a825' : '#4caf50';
          return `<div style="display:flex;gap:8px;font-size:9px;padding:1px 0 1px 14px;">
            <span style="flex:0 0 150px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${k.name}</span>
            <span style="flex:0 0 78px;color:${col(a)};" title="Bezug">↑ ${a == null ? '—' : a.toFixed(0) + ' %'}</span>
            <span style="flex:0 0 78px;color:${col(r)};" title="Rückspeisung">↓ ${r == null ? '—' : r.toFixed(0) + ' %'}</span>
          </div>`;
        }).join('')
      : '<div style="font-size:9px;color:var(--muted);padding-left:14px;">keine Infrastrukturknoten</div>';

    return `
    <div style="margin-bottom:7px;">
      <div style="display:flex;align-items:center;gap:7px;font-size:10px;">
        <b style="color:var(--text);">${s.varianteName}</b>
        <span style="color:var(--muted);font-size:9px;">Jahr ${s.jahr}</span>
        <span style="margin-left:auto;font-size:9px;color:${ueber ? '#e53935' : '#4caf50'};">
          ${ueber ? `${ueber} Knoten über Grenze` : '✓ alle im Rahmen'}</span>
      </div>
      ${knotenTxt}
    </div>`;
  }).join('');

  return `${kopf}
  <div style="background:var(--surface2);border-radius:6px;padding:8px 9px;">
    ${zeilen}
    <div style="display:flex;align-items:center;gap:8px;font-size:8.5px;color:var(--muted);padding-top:4px;line-height:1.6;">
      ↑ Bezug · ↓ Rückspeisung, jeweils gegen die Knotenkapazität. Die drei
      höchstbelasteten Knoten je Variante.
      <button data-click="variantenVergleichNetzwirkung()"
        style="margin-left:auto;padding:2px 8px;border-radius:4px;border:1px solid var(--border);
               background:transparent;color:var(--muted);font-family:inherit;font-size:9px;cursor:pointer;
               white-space:nowrap;">↻ neu</button>
    </div>
  </div>`;
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
