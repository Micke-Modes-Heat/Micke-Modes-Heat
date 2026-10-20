import { describe, it, expect } from 'vitest';
import { ohne3d, flach2d, karte2dEinrichten } from '../src/lib/karte-2d.js';

describe('karte-2d', () => {
  it('ersetzt translate3d durch translate', () => {
    expect(ohne3d('translate3d(12px, -7.5px, 0px)')).toBe('translate(12px, -7.5px)');
    expect(ohne3d('translate3d(3px,4px,0)')).toBe('translate(3px, 4px)');
  });

  it('lässt Rotation und Skalierung (leaflet-rotate, Zoom) stehen', () => {
    expect(ohne3d('translate3d(10px, 20px, 0px) scale(2) rotate(0.5rad)'))
      .toBe('translate(10px, 20px) scale(2) rotate(0.5rad)');
  });

  it('ändert nichts ohne translate3d', () => {
    expect(ohne3d('translate(1px, 2px)')).toBe('translate(1px, 2px)');
    expect(ohne3d('')).toBe('');
    expect(ohne3d(undefined)).toBe(undefined);
  });

  it('flach2d setzt den Stil am Element und ist null-sicher', () => {
    const el = { style: { transform: 'translate3d(5px, 6px, 0px)' } };
    flach2d(el);
    expect(el.style.transform).toBe('translate(5px, 6px)');
    expect(() => flach2d(null)).not.toThrow();
  });

  it('karte2dEinrichten legt Kacheln, Kachel-Container und SVG-Fläche 2D', () => {
    const el3d = () => ({ style: { transform: 'translate3d(1px, 2px, 0px)' } });
    function GridLayer() { this._tiles = {}; }
    GridLayer.prototype._tileCoordsToKey = c => c.x + ':' + c.y;
    GridLayer.prototype._addTile = function (coords) { this._tiles[this._tileCoordsToKey(coords)] = { el: el3d() }; };
    GridLayer.prototype._setZoomTransform = function (level) { level.el.style.transform = 'translate3d(3px, 4px, 0px) scale(2)'; };
    function SVG() { this._container = el3d(); }
    SVG.prototype._update = function () { this._container.style.transform = 'translate3d(5px, 6px, 0px)'; };
    SVG.prototype._updateTransform = function () { this._container.style.transform = 'translate3d(7px, 8px, 0px) scale(0.5)'; };
    const L = { Marker: function () {}, ImageOverlay: function () {}, GridLayer, SVG };
    L.Marker.prototype._setPos = () => {};
    L.ImageOverlay.prototype._reset = () => {};
    karte2dEinrichten(L);

    const g = new GridLayer();
    g._addTile({ x: 1, y: 2 });
    expect(g._tiles['1:2'].el.style.transform).toBe('translate(1px, 2px)');
    const level = { el: el3d() };
    g._setZoomTransform(level);
    expect(level.el.style.transform).toBe('translate(3px, 4px) scale(2)');
    const svg = new SVG();
    svg._update();
    expect(svg._container.style.transform).toBe('translate(5px, 6px)');
    svg._updateTransform();
    expect(svg._container.style.transform).toBe('translate(7px, 8px) scale(0.5)');
  });
});
