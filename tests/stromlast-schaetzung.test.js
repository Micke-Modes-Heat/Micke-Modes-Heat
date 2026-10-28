import { describe, it, expect } from 'vitest';
import { lastSchaetzen, lastGleich, lastZustand, lastWirdUebernommen, verbraucherSkalierung } from '../src/lib/stromlast-schaetzung.js';

describe('lastSchaetzen', () => {
  it('Energie ÷ Vbh: Schule 28,8 MWh bei 1800 h → 16 kW', () => {
    const r = lastSchaetzen({ energieMwh: 28.8, grundflaecheM2: 1000, vbh: 1800, wpm2: 22 });
    expect(r.kwEnergie).toBe(16);
    expect(r.kwFlaeche).toBe(22);
    expect(r.kw).toBe(16);
    expect(r.energieQuelle).toBe('kennwert');
    expect(r.faktor).toBeCloseTo(1.375);
  });

  it('Methode Fläche nimmt W/m²', () => {
    const r = lastSchaetzen({ energieMwh: 28.8, grundflaecheM2: 1000, vbh: 1800, wpm2: 22, methode: 'flaeche' });
    expect(r.kw).toBe(22);
    expect(r.ersatz).toBe(false);
  });

  it('fehlende Energie → Ersatz über die Fläche', () => {
    const r = lastSchaetzen({ energieMwh: 0, grundflaecheM2: 500, vbh: 1800, wpm2: 20 });
    expect(r.kw).toBe(10);
    expect(r.ersatz).toBe(true);
    expect(r.energieQuelle).toBeNull();
  });

  it('Zählerwert wird als Quelle gemeldet', () => {
    expect(lastSchaetzen({ energieMwh: 100, zaehler: true, grundflaecheM2: 0, vbh: 2500, wpm2: 0 }).energieQuelle).toBe('zaehler');
  });

  it('ohne Fläche und Energie keine Schätzung', () => {
    expect(lastSchaetzen({ energieMwh: 0, grundflaecheM2: 0, vbh: 1800, wpm2: 20 }).kw).toBeNull();
  });
});

describe('verbraucherSkalierung', () => {
  it('Schätzung und unbekannte Quelle folgen der Energie', () => {
    expect(verbraucherSkalierung({ quelle: 'schaetzung', energieKwh: 28800, leistungKw: 16 })).toBe('energie');
    expect(verbraucherSkalierung({ quelle: null, energieKwh: 28800, leistungKw: 16 })).toBe('energie');
    expect(verbraucherSkalierung({ quelle: null, energieKwh: 28800, leistungKw: 0 })).toBe('energie');
  });
  it('Hand und kalibriert behalten die Spitze', () => {
    expect(verbraucherSkalierung({ quelle: 'hand', energieKwh: 28800, leistungKw: 40 })).toBe('spitze');
    expect(verbraucherSkalierung({ quelle: 'kalibriert', energieKwh: 28800, leistungKw: 40 })).toBe('spitze');
  });
  it('ohne Energie Spitze, ohne beides nichts', () => {
    expect(verbraucherSkalierung({ quelle: 'schaetzung', energieKwh: 0, leistungKw: 10 })).toBe('spitze');
    expect(verbraucherSkalierung({ quelle: 'hand', energieKwh: 5000, leistungKw: 0 })).toBe('energie');
    expect(verbraucherSkalierung({ energieKwh: 0, leistungKw: 0 })).toBeNull();
  });
});

describe('lastZustand / Übernahme', () => {
  it('Toleranz 0,1 kW bzw. 2 %', () => {
    expect(lastGleich(16, 16.1)).toBe(true);
    expect(lastGleich(100, 101.9)).toBe(true);
    expect(lastGleich(100, 103)).toBe(false);
  });

  it('Zustände', () => {
    expect(lastZustand({ hatAsset: false, schaetzKw: 5 })).toBe('kein-asset');
    expect(lastZustand({ hatAsset: true, assetKw: null, schaetzKw: 5 })).toBe('leer');
    expect(lastZustand({ hatAsset: true, assetKw: 5, schaetzKw: 5 })).toBe('gleich');
    expect(lastZustand({ hatAsset: true, assetKw: 9, schaetzKw: 5 })).toBe('abweichend');
    expect(lastZustand({ hatAsset: true, assetKw: 9, quelle: 'kalibriert', schaetzKw: 5 })).toBe('geschuetzt');
  });

  it('Umfang der Übernahme', () => {
    const leer = { zustand: 'leer' }, abw = { zustand: 'abweichend' }, ges = { zustand: 'geschuetzt' };
    expect([leer, abw, ges].map(z => lastWirdUebernommen(z, 'leer'))).toEqual([true, false, false]);
    expect([leer, abw, ges].map(z => lastWirdUebernommen(z, 'schaetzung'))).toEqual([true, true, false]);
    expect([leer, abw, ges].map(z => lastWirdUebernommen(z, 'alle'))).toEqual([true, true, true]);
    expect(lastWirdUebernommen({ zustand: 'gleich' }, 'alle')).toBe(false);
  });
});
