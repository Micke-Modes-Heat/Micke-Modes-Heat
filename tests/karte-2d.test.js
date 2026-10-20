import { describe, it, expect } from 'vitest';
import { ohne3d, flach2d } from '../src/lib/karte-2d.js';

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
});
