import { describe, it, expect, beforeAll } from 'vitest';

// ResizeObserver-Attrappe: merkt sich beobachtete Elemente, melden() ruft den Rückruf wie der Browser
const beobachtet = new Set();
let rueckruf = null;
class FakeRO {
  constructor(cb) { rueckruf = cb; }
  observe(el) { beobachtet.add(el); }
  unobserve(el) { beobachtet.delete(el); }
}
const melden = el => rueckruf([{ target: el }]);
const element = sichtbar => ({ isConnected: true, sichtbar, checkVisibility() { return this.sichtbar; }, get clientWidth() { return this.sichtbar ? 400 : 0; }, parentElement: null });

let m;
beforeAll(async () => {
  globalThis.ResizeObserver = FakeRO;
  m = await import('../src/lib/zeichnen-bei-sicht.js');
});

describe('zeichneWennSichtbar', () => {
  it('zeichnet sichtbare Diagramme sofort', () => {
    let n = 0;
    m.zeichneWennSichtbar(element(true), () => n++);
    expect(n).toBe(1);
    expect(m.ausstehendeAnzahl()).toBe(0);
  });

  it('wartet bei ausgeblendeten, zeichnet beim Einblenden nur den jüngsten Auftrag', () => {
    const el = element(false);
    const gezeichnet = [];
    m.zeichneWennSichtbar(el, () => gezeichnet.push('alt'));
    m.zeichneWennSichtbar(el, () => gezeichnet.push('neu'));
    expect(gezeichnet).toEqual([]);
    expect(beobachtet.has(el)).toBe(true);
    melden(el);                         // Größenmeldung, aber noch unsichtbar
    expect(gezeichnet).toEqual([]);
    el.sichtbar = true;
    melden(el);
    expect(gezeichnet).toEqual(['neu']);
    expect(beobachtet.has(el)).toBe(false);
    melden(el);                         // kein zweites Mal
    expect(gezeichnet).toEqual(['neu']);
  });

  it('ein sichtbarer Aufruf erledigt einen wartenden Auftrag', () => {
    const el = element(false);
    const gezeichnet = [];
    m.zeichneWennSichtbar(el, () => gezeichnet.push('alt'));
    el.sichtbar = true;
    m.zeichneWennSichtbar(el, () => gezeichnet.push('neu'));
    melden(el);
    expect(gezeichnet).toEqual(['neu']);
    expect(m.ausstehendeAnzahl()).toBe(0);
  });

  it('ausstehendeZeichnen holt alles nach (vor Exporten), Fehler brechen nicht ab', () => {
    const a = element(false), b = element(false);
    const gezeichnet = [];
    m.zeichneWennSichtbar(a, () => { throw new Error('kaputt'); });
    m.zeichneWennSichtbar(b, () => gezeichnet.push('b'));
    const err = console.error; console.error = () => {};
    try { m.ausstehendeZeichnen(); } finally { console.error = err; }
    expect(gezeichnet).toEqual(['b']);
    expect(m.ausstehendeAnzahl()).toBe(0);
  });

  it('nicht eingehängte Elemente gelten als unsichtbar', () => {
    expect(m.istSichtbar({ ...element(true), isConnected: false })).toBe(false);
    expect(m.istSichtbar(null)).toBe(false);
  });
});
