// ── 13v-schicht-bar.js — Planungsschicht-Umschalter in der Kopfleiste ────────
//
// Der Eingabemodus bestimmt, welche Schicht neu angelegte Gebäude und Assets
// bekommen (s. lib/schichten.js). Er sitzt bewusst in der Kopfleiste neben dem
// Jahres-Slider und NICHT in einem Tab-Panel: Gebäude entstehen im Gebäude-Tab,
// Elektroassets im Elektro-Tab — ein tab-gebundener Umschalter wäre jeweils aus
// der Hälfte der Anlagesituationen nicht erreichbar.
//
// Der Modus verändert nichts Bestehendes und keine Berechnung.

import {
  SCHICHT, SCHICHT_META, SCHICHT_REIHENFOLGE,
  getAktiveSchicht, setAktiveSchicht, schichtSichtbar, setSchichtSichtbar,
} from './lib/schichten.js';
import { varianten, activeVariantId } from './01-globals-varianten.js';

const BAR_ID = 'schicht-bar';

// Im Planungsmodus landen neue Objekte im Delta der AKTIVEN Variante. Welche das
// ist, muss am Umschalter stehen — sonst plant man in der falschen und merkt es
// nicht, weil auf der Karte kein Unterschied sichtbar ist.
function _aktiveVariantenName() {
  if (activeVariantId == null) return 'Basisdaten';
  return varianten.find(v => v.id === activeVariantId)?.name || 'Variante';
}

function _html() {
  const aktiv = getAktiveSchicht();

  const knoepfe = SCHICHT_REIHENFOLGE.map(s => {
    const m = SCHICHT_META[s];
    const an = s === aktiv;
    const beschriftung = an
      ? ' ' + (s === SCHICHT.ENTSCHEIDUNG ? _aktiveVariantenName() : m.label)
      : '';
    const titel = s === SCHICHT.ENTSCHEIDUNG
      ? `${m.hinweis} — aktuell: ${_aktiveVariantenName()}`
      : m.hinweis;
    return `<button data-click="schichtSetModus('${s}')" title="${titel}"
      style="padding:2px 7px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;
             border:1px solid ${an ? m.farbe : 'var(--border)'};
             color:${an ? m.farbe : 'var(--muted)'};
             background:${an ? m.farbe + '22' : 'transparent'};
             font-weight:${an ? '600' : '400'};">${m.icon}${beschriftung}</button>`;
  }).join('');

  const augen = SCHICHT_REIHENFOLGE.map(s => {
    const m = SCHICHT_META[s];
    const sichtbar = schichtSichtbar(s);
    return `<label title="${m.label} auf der Karte ein-/ausblenden"
      style="display:inline-flex;align-items:center;cursor:pointer;opacity:${sichtbar ? 1 : 0.35};font-size:11px;">
      <input type="checkbox" ${sichtbar ? 'checked' : ''}
        style="accent-color:${m.farbe};cursor:pointer;width:11px;height:11px;margin:0 1px 0 0;"
        data-change="schichtSetSichtbar('${s}', this.checked)">${m.icon}</label>`;
  }).join('');

  return `<span class="ctx-label">Schicht</span>
    <div style="display:flex;gap:3px;">${knoepfe}</div>
    <div style="display:flex;gap:3px;margin-left:5px;" title="Sichtbarkeit auf der Karte">${augen}</div>`;
}

export function schichtBarRender() {
  const el = document.getElementById(BAR_ID);
  if (el) el.innerHTML = _html();
  _markiereKarte();
}

/** Eingabemodus wechseln — wirkt nur auf künftig angelegte Objekte. */
export function schichtSetModus(s) {
  setAktiveSchicht(s);
  schichtBarRender();
}

/** Eine Schicht auf der Karte ein-/ausblenden. */
export function schichtSetSichtbar(s, an) {
  setSchichtSichtbar(s, an);
  schichtBarRender();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
}

// Farbrahmen an der Karte, solange NICHT im Bestandsmodus gearbeitet wird —
// den Modus zu vergessen ist sonst der wahrscheinlichste Bedienfehler.
function _markiereKarte() {
  const el = document.getElementById('map');
  if (!el) return;
  const s = getAktiveSchicht();
  el.style.boxShadow = s === SCHICHT.BESTAND ? '' : `inset 0 0 0 3px ${SCHICHT_META[s].farbe}`;
}

// Selbst initialisieren: im Single-File-Build liegt das Skript am Body-Ende,
// im Dev-Modus kann das DOM noch fehlen.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schichtBarRender);
  } else {
    setTimeout(schichtBarRender, 0);
  }
}
