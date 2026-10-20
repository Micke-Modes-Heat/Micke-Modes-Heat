// ── 53-fenster-seiten.js — Berichts-Fenster als Seiten der Auswertung ──
//
// Fenster, die nur rechnen oder berichten (keine Klicks auf der Karte), sind keine Reiter
// neben der Karte, sondern Seiten in Auswertung/Gutachten. Das Fenster selbst bleibt das
// Modul (gleiches DOM, gleiche Funktionen) und wird beim Zeigen per _embedPanelInline (04a)
// in die Seite gehängt — genauso wie Wirtschaftlichkeit und Strombilanz.
//
// Eine Seite = Eintrag in SEITEN. 04a ruft fsBuildSections / fsHideAll / fsShowSection über
// window (kein Importzyklus), 49 kennt die Navigation über _ABSCHNITTE.
//
// Verlässt man die Seite, gibt _restoreInlinePanels das Fenster zurück; es bleibt dann aber
// per style.display offen und würde an der Karte andocken (52). Darum schließt es dieses Modul
// beim Verlassen der Seite.

export const SEITEN = [
  {
    section: 'ergebnisblatt', panel: 'el-ergebnisblatt', tab: 'Ergebnisblatt',
    tip: 'Vollständige Rechenergebnisse: Kennzahlen, Grenzwertnachweis, Kabel- und Knotentabellen, Mengengerüst, Kosten und alle Annahmen — druckbar und als CSV',
    zeigen: () => window.ergebnisblattAktualisieren?.(),
  },
];

const _wrapId = s => 'analyse-fs-' + s.section;
const _beobachtet = new WeakSet();

/** Reiter + Seitenbereiche einmalig einhängen (idempotent). */
export function fsBuildSections() {
  const tabBar = document.getElementById('analyse-view-tabs');
  const view = document.getElementById('center-analyse-view');
  for (const s of SEITEN) {
    if (tabBar && !tabBar.querySelector(`[data-section="${s.section}"]`)) {
      const btn = document.createElement('button');
      btn.className = 'analyse-section-tab';
      btn.dataset.section = s.section;
      btn.textContent = s.tab;
      btn.title = s.tip || '';
      btn.addEventListener('click', () => window.setAnalyseSection?.(s.section));
      tabBar.appendChild(btn);
    }
    if (view && !document.getElementById(_wrapId(s))) {
      const wrap = document.createElement('div');
      wrap.id = _wrapId(s);
      wrap.className = 'fs-seite';
      wrap.style.display = 'none';
      view.appendChild(wrap);
    }
  }
}

export function fsHideAll() {
  for (const s of SEITEN) {
    const w = document.getElementById(_wrapId(s));
    if (w) w.style.display = 'none';
  }
}

/** Seite zeigen; false, wenn die Sektion keine Fenster-Seite ist. */
export function fsShowSection(section) {
  const s = SEITEN.find(x => x.section === section);
  if (!s) return false;
  fsBuildSections();
  const wrap = document.getElementById(_wrapId(s));
  if (!wrap) return false;
  wrap.style.display = '';
  s.zeigen();                                   // legt das Fenster an und füllt es
  const panel = document.getElementById(s.panel);
  if (!panel) return true;
  panel.dataset.fsSeite = s.section;
  _beobachten(panel);
  window._embedPanelInline?.(s.panel, wrap);
  return true;
}

/** Wird das Fenster aus der Seite gelöst (Seitenwechsel), schließen statt an der Karte andocken. */
function _beobachten(panel) {
  if (_beobachtet.has(panel)) return;
  _beobachtet.add(panel);
  // Nur ändern, was wirklich anders ist: classList.remove schreibt das class-Attribut auch dann
  // neu, wenn die Klasse fehlt — das löst diesen Beobachter erneut aus (Endlosschleife).
  new MutationObserver(() => {
    if (panel.classList.contains('inline-mode')) return;
    if (panel.style.display && panel.style.display !== 'none') panel.style.display = 'none';
    if (panel.classList.contains('visible')) panel.classList.remove('visible');
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });
}

/** Für Knöpfe, die früher das Fenster geöffnet haben: zur Seite springen. */
export function fsSeiteOeffnen(section) {
  fsBuildSections();
  if (typeof window.uiGeheZu === 'function' && document.body.classList.contains('ui-lkebw')) window.uiGeheZu('auswertung', section);
  else { window.setViewMode?.('analyse'); window.setAnalyseSection?.(section); }
}
