// ── 13v-schicht-bar.js — „Neu → …“ in der Kopfleiste ─────────────────────────
//
// Früher ein Umschalter, den man vor jedem Anlegen richtig stellen musste.
// Jetzt eine Anzeige: Sie sagt, wohin das NÄCHSTE neue Objekt geht. Die Schicht
// ergibt sich aus dem Jahres-Slider und der Objektart (lib/varianten-regeln.js):
//
//   Slider auf heute               → Bestand (alle Varianten)
//   Zukunft + Gebäude/Verbraucher  → Entwicklung (alle Varianten, Baujahr = Slider)
//   Zukunft + Erzeuger/Netz/Speicher → nur aktive Variante (Baujahr = Slider)
//
// Über das Menü lässt sich eine Schicht fest einstellen (z. B. Bestand
// nachtragen, während der Slider in der Zukunft steht); ✕ kehrt zur Regel
// zurück. Dort liegen auch die Sichtbarkeits-Schalter je Schicht.
//
// Die Anzeige verändert nichts Bestehendes und keine Berechnung.

import {
  SCHICHT, SCHICHT_META, SCHICHT_REIHENFOLGE,
  getSchichtModus, setSchichtModus, schichtSichtbar, setSchichtSichtbar,
} from './lib/schichten.js';
import { schichtFuerNeu } from './lib/varianten-regeln.js';
import { globalYear, basisJahr, aktiverVariantenName } from './01-globals-varianten.js';

const BAR_ID = 'schicht-bar';
let _menuOffen = false;

function _jahr() {
  // window.globalYear ist ein Live-Accessor (main.js); der Import dient dem Dev-Modus.
  return (typeof window !== 'undefined' && window.globalYear) || globalYear;
}

function _ziel(s) {
  const m = SCHICHT_META[s];
  const wo = s === SCHICHT.ENTSCHEIDUNG ? `nur ${aktiverVariantenName()}` : 'alle Varianten';
  const ab = s === SCHICHT.BESTAND ? 'heute vorhanden' : `ab ${_jahr()}`;
  return { m, wo, ab };
}

function _html() {
  const modus = getSchichtModus();
  const fest = modus !== 'auto';
  const jahr = _jahr(), basis = basisJahr();
  // Für die Anzeige der Normalfall: eine Anlage (Erzeuger/Netz/Speicher).
  const s = schichtFuerNeu({ modus, kategorie: 'entscheidung', jahr, basisjahr: basis });
  const sBedarf = schichtFuerNeu({ modus, kategorie: 'bedarf', jahr, basisjahr: basis });
  const z = _ziel(s);
  const nebenbei = (!fest && sBedarf !== s)
    ? ` · Gebäude/Verbraucher: ${SCHICHT_META[sBedarf].icon} alle Varianten` : '';
  const titel = fest
    ? `Fest eingestellt: neue Objekte werden „${z.m.label}“ (${z.wo}). ✕ = wieder automatisch nach Jahr und Objektart.`
    : `Automatisch: Slider auf ${basis} = Bestand. In der Zukunft gehen Gebäude und Verbraucher in alle Varianten (Entwicklung), Anlagen, Netz und Speicher nur in die aktive Variante.${nebenbei ? ' Gebäude und Verbraucher gehen jetzt in alle Varianten.' : ''}`;

  const augen = SCHICHT_REIHENFOLGE.map(k => {
    const m = SCHICHT_META[k];
    const an = schichtSichtbar(k);
    return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 0;">
      <input type="checkbox" ${an ? 'checked' : ''} style="accent-color:${m.farbe};"
        data-change="schichtSetSichtbar('${k}', this.checked)">${m.icon} ${m.label} zeigen</label>`;
  }).join('');
  const wahl = ['auto', ...SCHICHT_REIHENFOLGE].map(k => {
    const an = modus === k;
    const lab = k === 'auto' ? '⚙ automatisch (empfohlen)'
      : `${SCHICHT_META[k].icon} immer ${k === SCHICHT.ENTSCHEIDUNG ? 'nur aktive Variante' : SCHICHT_META[k].label}`;
    return `<button data-click="schichtSetModus('${k}')" style="display:block;width:100%;text-align:left;padding:4px 8px;margin:1px 0;
      border-radius:4px;border:1px solid ${an ? 'var(--accent)' : 'transparent'};background:${an ? 'rgba(212,168,85,.12)' : 'transparent'};
      color:var(--text);font:inherit;font-size:11px;cursor:pointer;">${lab}</button>`;
  }).join('');

  return `<span class="ctx-label">Neu</span>
    <div style="position:relative;display:flex;align-items:center;gap:3px;">
      <button data-click="schichtMenuToggle()" title="${titel}"
        style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;
               border:1px ${fest ? 'dashed' : 'solid'} ${z.m.farbe};color:${z.m.farbe};background:${z.m.farbe}1f;font-weight:600;white-space:nowrap;">
        ${z.m.icon} ${z.wo}<span style="font-weight:400;color:var(--muted);">· ${z.ab}${fest ? ' · fest' : ''}</span> ▾</button>
      ${fest ? `<button data-click="schichtSetModus('auto')" title="Wieder automatisch nach Jahr und Objektart"
        style="padding:1px 6px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;">✕</button>` : ''}
      <div id="schicht-menu" style="display:${_menuOffen ? 'block' : 'none'};position:absolute;top:calc(100% + 6px);left:0;z-index:1300;min-width:260px;
           background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,.45);font-size:11px;color:var(--text);">
        <div style="color:var(--muted);margin-bottom:6px;line-height:1.4;">Wohin gehen neu angelegte Objekte?</div>
        ${wahl}
        <div style="border-top:1px solid var(--border);margin:8px 0 4px;"></div>
        <div style="color:var(--muted);margin-bottom:2px;">Auf der Karte</div>
        ${augen}
      </div>
    </div>`;
}

export function schichtBarRender() {
  const el = document.getElementById(BAR_ID);
  if (el) el.innerHTML = _html();
  _markiereKarte();
}

export function schichtMenuToggle() {
  _menuOffen = !_menuOffen;
  schichtBarRender();
}

/** 'auto' oder eine feste Schicht — wirkt nur auf künftig angelegte Objekte. */
export function schichtSetModus(s) {
  setSchichtModus(s);
  _menuOffen = false;
  schichtBarRender();
}

/** Eine Schicht auf der Karte ein-/ausblenden. */
export function schichtSetSichtbar(s, an) {
  setSchichtSichtbar(s, an);
  schichtBarRender();
  if (typeof window.redrawAllAssets === 'function') window.redrawAllAssets();
}

// Ein fest eingestellter Modus ist die Ausnahme — dann rahmt die Karte gestrichelt
// in der Schichtfarbe, damit man ihn nicht vergisst.
function _markiereKarte() {
  const el = document.getElementById('map');
  if (!el) return;
  const m = getSchichtModus();
  el.style.boxShadow = m === 'auto' ? '' : `inset 0 0 0 3px ${SCHICHT_META[m].farbe}`;
}

// Menü schließen bei Klick daneben
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (!_menuOffen) return;
    if (e.target.closest?.('#schicht-bar')) return;
    _menuOffen = false;
    schichtBarRender();
  });
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
