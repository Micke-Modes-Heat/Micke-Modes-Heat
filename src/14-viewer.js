import { setViewMode, setLeftTab, setAnalyseSection, setWaermeTab } from './04a-ui-panels.js';

// ── Viewer-Modus (?viewer=1) ─────────────────────────────────────────────────
// Aktiviert eine read-only TOC-Sidebar (Gutachten-Gliederung 1–6) im left-panel.
// Aktivierung: URL mit ?viewer=1 aufrufen.

(function () {
  if (!/[?&]viewer=1/.test(location.search)) return;

  var _CSS = [
    // Normale Tab-Buttons ausblenden
    'body.viewer #lp-tabs { display: none; }',
    'body.viewer .lp-head .lp-collapse-btn { display: none; }',
    // TOC-Container
    '#viewer-toc { padding: 10px 8px 8px; border-bottom: 1px solid var(--border); }',
    // Header-Zeile
    '.vtoc-header { display: flex; justify-content: space-between; align-items: center;',
    '  margin-bottom: 10px; padding: 0 4px; }',
    '.vtoc-header-label { font-size: 9px; letter-spacing: 0.08em; color: var(--muted);',
    '  text-transform: uppercase; }',
    '.vtoc-badge { font-size: 8px; background: rgba(239,83,80,0.12);',
    '  border: 1px solid rgba(239,83,80,0.35); color: #ef9a9a;',
    '  border-radius: 3px; padding: 2px 6px; letter-spacing: 0.05em; white-space: nowrap; }',
    // Nav
    '.vtoc-nav { display: flex; flex-direction: column; gap: 2px; }',
    '.vtoc-divider { height: 1px; background: var(--border); margin: 5px 4px; }',
    // Einzelner Eintrag
    '.vtoc-item { display: flex; align-items: center; gap: 8px; width: 100%;',
    '  text-align: left; padding: 7px 8px; background: none;',
    '  border: 1px solid transparent; border-radius: 5px;',
    '  color: var(--muted); cursor: pointer; font-size: 11px; font-family: inherit;',
    '  transition: background 0.12s, border-color 0.12s, color 0.12s; }',
    '.vtoc-item:hover { background: rgba(255,255,255,0.04);',
    '  border-color: var(--border); color: var(--text); }',
    '.vtoc-item.active { background: rgba(79,195,247,0.10);',
    '  border-color: rgba(79,195,247,0.35); color: var(--accent); }',
    // Nummerkreis
    '.vtoc-num { flex-shrink: 0; width: 20px; height: 20px;',
    '  display: flex; align-items: center; justify-content: center;',
    "  border-radius: 50%; background: rgba(255,255,255,0.06);",
    "  font-size: 9px; font-family: 'DM Mono', monospace; }",
    '.vtoc-item.active .vtoc-num { background: rgba(79,195,247,0.18); }',
    '.vtoc-label { font-size: 11px; line-height: 1.3; }',
  ].join('\n');

  var _CHAPTERS = [
    [1, 'Projektgebiet'],
    [2, 'Gebäudebestand'],
    null, // divider
    [3, 'Wärme & Energiebedarf'],
    [4, 'Versorgungsvarianten'],
    [5, 'Wirtschaftlichkeit'],
    null, // divider
    [6, 'Emissionen & Fazit'],
  ];

  function _item(n, label) {
    return '<button class="vtoc-item' + (n === 1 ? ' active' : '') +
      '" data-vtoc="' + n + '" data-click="viewerNav(' + n + ')">' +
      '<span class="vtoc-num">' + n + '</span>' +
      '<span class="vtoc-label">' + label + '</span>' +
      '</button>';
  }

  function _activate() {
    // CSS
    var s = document.createElement('style');
    s.textContent = _CSS;
    document.head.appendChild(s);

    // body-Klasse
    document.body.classList.add('viewer');

    // TOC aufbauen
    var lp = document.getElementById('lp-tabs');
    if (!lp) return;

    var nav = _CHAPTERS.map(function(ch) {
      return ch ? _item(ch[0], ch[1]) : '<div class="vtoc-divider"></div>';
    }).join('');

    var toc = document.createElement('div');
    toc.id = 'viewer-toc';
    toc.innerHTML =
      '<div class="vtoc-header">' +
        '<span class="vtoc-header-label">Gliederung</span>' +
        '<span class="vtoc-badge">Nur-Lesen</span>' +
      '</div>' +
      '<nav class="vtoc-nav">' + nav + '</nav>';

    lp.parentNode.insertBefore(toc, lp);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _activate);
  } else {
    _activate();
  }
})();

export function viewerNav(n) {
  document.querySelectorAll('.vtoc-item').forEach(function(b) {
    b.classList.toggle('active', +b.dataset.vtoc === n);
  });
  switch (n) {
    case 1:
      setViewMode('karte');
      setLeftTab('gebiet');
      break;
    case 2:
      setViewMode('karte');
      setLeftTab('ergebnis');
      break;
    case 3:
      setViewMode('analyse');
      setAnalyseSection('waerme');
      if (typeof setWaermeTab === 'function') setWaermeTab('lastgang');
      break;
    case 4:
      setViewMode('analyse');
      setAnalyseSection('uebersicht');
      break;
    case 5:
      setViewMode('analyse');
      setAnalyseSection('wirtschaft');
      break;
    case 6:
      setViewMode('analyse');
      setAnalyseSection('emissionen');
      break;
  }
}
