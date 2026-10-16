// lib/canvas-farben.js — Farben für Canvas-Diagramme aus den Design-Tokens.
//
// Canvas kennt keine CSS-Variablen. Die Diagramme lesen die Tokens aus
// src/styles/lkebw.css deshalb beim Zeichnen; hell und dunkel ergeben so dieselben
// Diagramme in passenden Tönen. Bis 16.10.2026 waren die Farben fest für den alten
// dunklen Grund eingetragen (tools/oberflaeche-canvas.mjs hat sie umgestellt).
//
//   cvInk(a)      Schleier/Gitter/Beschriftung: Schriftfarbe mit Deckkraft a
//                 (hell: dunkle Tinte, dunkel: weiß — wie das Token --ink)
//   cvTok(name)   ein Token als Farbwert: 'surface', 'surface2', 'text', 'muted',
//                 'faint', 'border', 'line-2', 'brand', 'c-blue' …
//   CV_SCHRIFT    Schriftfamilie für ctx.font (statt der alten Mono-Schrift)

export const CV_SCHRIFT = '"Source Sans 3","Segoe UI",Tahoma,sans-serif';

// Rückfall, falls die Tokens (noch) nicht lesbar sind — Werte der hellen Darstellung
const HELL = {
  ink: '25,29,26', surface: '#FFFFFF', surface2: '#F6F7F5', bg: '#EEF0ED',
  text: '#191D1A', muted: '#58615A', faint: '#89918A', border: '#DADFD9', 'line-2': '#C3C9C2',
  brand: '#266426',
};

let _cache = null;
let _schluessel = null;

function _tokens() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || typeof getComputedStyle !== 'function') return HELL;
  const schluessel = root.dataset.theme || 'light';
  if (_cache && _schluessel === schluessel) return _cache;
  const cs = getComputedStyle(root);
  const tok = {};
  const lesen = name => {
    if (!(name in tok)) tok[name] = cs.getPropertyValue('--' + name).trim() || HELL[name] || '';
    return tok[name];
  };
  for (const k of Object.keys(HELL)) lesen(k);
  _cache = new Proxy(tok, { get: (t, k) => (typeof k === 'string' ? lesen(k) : undefined) });
  _schluessel = schluessel;
  return _cache;
}

/** Schriftfarbe mit Deckkraft a — für Gitterlinien, Achsen, Schleier, Beschriftungen. */
export function cvInk(a) {
  return `rgba(${_tokens().ink},${a})`;
}

/** Ein Design-Token als Farbwert (z. B. 'surface', 'text', 'muted', 'border'). */
export function cvTok(name) {
  return _tokens()[name];
}

// Umschalten hell/dunkel: gezeichnete Diagramme behalten sonst die alten Farben.
// Die sichtbare Auswertung neu aufbauen und ein resize auslösen (Diagramme in Fenstern).
if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
  new MutationObserver(() => {
    _cache = null;
    const av = document.getElementById('center-analyse-view');
    if (av && getComputedStyle(av).display !== 'none') window.refreshAnalyseView?.();
    window.dispatchEvent(new Event('resize'));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
