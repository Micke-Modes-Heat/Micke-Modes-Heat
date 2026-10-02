// Vitest-Tests für lib/gutachten-eisspeicher-text.js — Funktionsweise immer, Ergebnisse je nach Simulation.
import { describe, it, expect } from 'vitest';
import { wtEisspeicher } from '../src/lib/gutachten-eisspeicher-text.js';

const text = abs => abs.map(a => a.map(t => (typeof t === 'string' ? t : `[${t.feld}:${t.wert}]`)).join('')).join('\n');
const stat = (o = {}) => ({ entzugKwh: 80000, absorberKwh: 70000, erdreichKwh: 10000, erdVerlustKwh: 0, maxVereisung: 0.62, minTemp: 0,
  maxTemp: 24.5, gesperrtH: 0, eisStunden: 1800, maxVereisungZulaessig: 0.85, ...o });

describe('wtEisspeicher', () => {
  it('erklärt die Funktionsweise auch ohne Eisspeicher in der Variante', () => {
    const t = text(wtEisspeicher({ aktiv: false }));
    expect(t).toContain('Kristallisationswärme');
    expect(t).toContain('Solar-Luftabsorber');
    expect(t).toContain('kein Eisspeicher vorgesehen');
  });
  it('beschreibt Auslegung, Regeneration und Kombination mit Luft-WP und Gaskessel', () => {
    const t = text(wtEisspeicher({ aktiv: true, volumenM3: 100, absorberM2: 260, maxVereisungZulPct: 85, wpKw: 100, jaz: 3.9,
      deckungPct: 72, waermeMwh: 180, folgeErzeuger: ['lwwp', 'gaskessel'], stat: stat() }));
    expect(t).toContain('[Speichervolumen:100 m³]');
    expect(t).toContain('mindestens den üblichen Auslegungsregeln');
    expect(t).toContain('zu 88 % aus den Absorbern');
    expect(t).toContain('höchste Vereisungsgrad liegt bei 62 %');
    expect(t).toContain('Vereisungsgrenze wird nicht erreicht');
    expect(t).toContain('Luft-Wasser-Wärmepumpe');
    expect(t).toContain('Resilienzeinheit');
    expect(t).toContain('3,90');
  });
  it('warnt bei Unterdimensionierung und fehlenden Ergebnissen', () => {
    const klein = text(wtEisspeicher({ aktiv: true, volumenM3: 30, absorberM2: 50, wpKw: 100, stat: stat({ gesperrtH: 900, maxVereisung: 0.85 }) }));
    expect(klein).toContain('unter dem Richtwert von 100 m³');
    expect(klein).toContain('unterdimensioniert');
    expect(klein).toContain('Spitzenlastkessel');
    const offen = wtEisspeicher({ aktiv: true, volumenM3: 30, absorberM2: 50 });
    expect(offen.flat().some(t => typeof t === 'object' && t.feld === 'Ergebnis Eisspeicher' && t.wert === '')).toBe(true);
  });
  it('beschreibt einen nie vereisenden Speicher', () => {
    expect(text(wtEisspeicher({ aktiv: true, volumenM3: 100, absorberM2: 300, stat: stat({ maxVereisung: 0 }) }))).toContain('vereist im Jahresverlauf nicht');
  });
});
