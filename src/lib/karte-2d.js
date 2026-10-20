// ── lib/karte-2d.js — Kartenelemente ohne eigene GPU-Ebene positionieren ──
//
// Leaflet positioniert jeden Marker und jedes Bild-/SVG-Overlay mit
// translate3d(x, y, 0); Leaflets CSS gibt SVG-Overlays zusätzlich dauerhaft
// will-change: transform. Chrome macht aus jedem solchen Element eine eigene
// Compositing-Ebene. Bei Hunderten Gebäude-Markern und je einem PV-Overlay pro
// Dach muss der Browser beim Kartenziehen in jedem Bild alle Ebenen neu ordnen
// („Layerize") — gemessen 20.10.2026 mit 177 belegten Dächern: Ziehen ruckelte,
// mit 2D-Lage ¼ der Layerize-Zeit. Dieselbe Lage per translate(x, y) erzeugt
// keine eigene Ebene; das Verschieben der Kartenebene selbst bleibt auf der GPU.
// Während der Zoom-Animation setzt Leaflet kurz wieder 3D (Transition) — das ist
// gewollt; nach dem Zoom wird neu positioniert und damit wieder 2D.

const RE_3D = /translate3d\(\s*([^,()]+?)px\s*,\s*([^,()]+?)px\s*,\s*0(?:px)?\s*\)/;

/**
 * translate3d(x, y, 0) durch translate(x, y) ersetzen; Rotation/Skalierung bleiben.
 * @param {string} transform CSS-transform-Wert
 * @returns {string}
 */
export function ohne3d(transform) {
  if (!transform || transform.indexOf('translate3d') < 0) return transform;
  return transform.replace(RE_3D, 'translate($1px, $2px)');
}

/** transform eines Elements auf 2D umstellen (null-sicher). */
export function flach2d(el) {
  if (!el || !el.style) return;
  const t = el.style.transform;
  if (t && t.indexOf('translate3d') >= 0) el.style.transform = ohne3d(t);
}

/**
 * Leaflet einmalig umstellen: alle Marker, dazu die Bild-/SVG-Overlays der
 * genannten Panes, liegen nach jedem Positionieren 2D. Muss vor dem Anlegen
 * der Karte laufen (spätere Marker sind dann ohnehin erfasst, frühere nicht).
 * @param {any} L Leaflet-Namensraum
 * @param {{overlayPanes?: string[]}} [opt] Panes, deren Overlays 2D liegen sollen
 */
export function karte2dEinrichten(L, { overlayPanes = ['pvPane'] } = {}) {
  if (!L || !L.Marker || L.__karte2d) return;
  L.__karte2d = true;

  // Marker-Icons und Schatten (auch mit leaflet-rotate: dessen _setPos wird umhüllt)
  const setPos = L.Marker.prototype._setPos;
  L.Marker.prototype._setPos = function (pos) {
    setPos.call(this, pos);
    flach2d(this._icon);
    flach2d(this._shadow);
  };

  // Bild-/SVG-Overlays ausgewählter Panes (PV-Module je Dach, Freiflächen-Module)
  const reset = L.ImageOverlay.prototype._reset;
  L.ImageOverlay.prototype._reset = function () {
    reset.call(this);
    if (overlayPanes.includes(this.options.pane)) flach2d(this._image);
  };

  // will-change aus Leaflets CSS (svg.leaflet-zoom-animated) würde die Ebene erzwingen.
  // Pane-Klasse nach Leaflet-Regel: 'pvPane' → .leaflet-pv-pane
  if (typeof document !== 'undefined' && overlayPanes.length) {
    const st = document.createElement('style');
    st.dataset.karte2d = '';
    st.textContent = overlayPanes
      .map(p => `.leaflet-${p.replace('Pane', '')}-pane > .leaflet-image-layer { will-change: auto; }`)
      .join('\n');
    document.head.appendChild(st);
  }
}
