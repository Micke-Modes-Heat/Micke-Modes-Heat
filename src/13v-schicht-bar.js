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

  // Erscheinungsbild in src/styles/lkebw.css (Abschnitt 11); Farbe der Schicht nur als Punkt.
  const punkt = farbe => `<i class="ui-schicht-punkt" style="--sw:${farbe}"></i>`;
  const augen = SCHICHT_REIHENFOLGE.map(k => {
    const m = SCHICHT_META[k];
    const an = schichtSichtbar(k);
    return `<label class="ui-schicht-auge">
      <input type="checkbox" ${an ? 'checked' : ''} style="accent-color:${m.farbe};"
        data-change="schichtSetSichtbar('${k}', this.checked)">${punkt(m.farbe)}${m.label} zeigen</label>`;
  }).join('');
  const wahl = ['auto', ...SCHICHT_REIHENFOLGE].map(k => {
    const lab = k === 'auto' ? 'automatisch (empfohlen)'
      : `immer ${k === SCHICHT.ENTSCHEIDUNG ? 'nur aktive Variante' : SCHICHT_META[k].label}`;
    return `<button type="button" class="${modus === k ? 'active' : ''}" data-click="schichtSetModus('${k}')">${
      k === 'auto' ? '<i class="ui-schicht-punkt"></i>' : punkt(SCHICHT_META[k].farbe)}${lab}</button>`;
  }).join('');

  return `<span class="ctx-label">Neu</span>
    <div class="ui-schicht-wrap">
      <button type="button" class="ui-schicht-btn${fest ? ' fest' : ''}" data-click="schichtMenuToggle()" title="${titel} Jetzt: ${z.wo} · ${z.ab}." aria-haspopup="menu" aria-expanded="${_menuOffen}">
        ${punkt(z.m.farbe)}<span>${z.wo}</span><span class="ui-schicht-ab">· ${z.ab}</span>${fest ? '<span class="ui-schicht-fest">fest</span>' : ''}<svg class="ui-i ui-i-sm"><use href="#ui-i-down"/></svg></button>
      ${fest ? `<button type="button" class="ui-schicht-x" data-click="schichtSetModus('auto')" title="Wieder automatisch nach Jahr und Objektart" aria-label="Wieder automatisch"><svg class="ui-i ui-i-sm"><use href="#ui-i-x"/></svg></button>` : ''}
      <div id="schicht-menu" class="ui-schicht-menu" role="menu" style="display:${_menuOffen ? 'flex' : 'none'};">
        <div class="ui-menu-grp">Wohin gehen neu angelegte Objekte?</div>
        ${wahl}
        <div class="ui-menu-grp">Auf der Karte</div>
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

// Menü schließen bei Klick daneben. composedPath() statt closest(): der Klick auf den
// Knopf zeichnet die Leiste neu, das Ziel hängt danach nicht mehr im Dokument.
if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (!_menuOffen) return;
    if (e.composedPath().some(n => n.id === BAR_ID)) return;
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
