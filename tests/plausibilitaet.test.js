import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAUSI_PARAMETER, migriereWirkungsgrade, plausiZahl, pruefeGebaeude, pruefeParameter, pruefeWert } from '../src/lib/plausibilitaet.js';
import { prepareProjectForImport } from '../src/lib/project-schema.js';

const hier = dirname(fileURLToPath(import.meta.url));
const param = id => PLAUSI_PARAMETER.find(p => p.id === id);

describe('Plausibilitätsbereiche', () => {
  it('jeder Parameter hat einen sinnvollen Bereich und eine eindeutige Feld-ID', () => {
    const ids = PLAUSI_PARAMETER.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLAUSI_PARAMETER) {
      expect(p.max, p.id).toBeGreaterThan(p.min);
      if (p.fallback != null) {
        expect(p.fallback, p.id).toBeGreaterThanOrEqual(p.min);
        expect(p.fallback, p.id).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('liest Zahlen mit Komma und lässt Leeres leer', () => {
    expect(plausiZahl('0,92')).toBe(0.92);
    expect(plausiZahl(' 92 ')).toBe(92);
    expect(plausiZahl('')).toBeNull();
    expect(plausiZahl('abc')).toBeNull();
  });

  it('erkennt einen Wirkungsgrad als Bruchteil', () => {
    const r = pruefeWert(param('gk-eta'), '0.92');
    expect(r?.stufe).toBe('warnung');
    expect(r?.text).toContain('Bruchteil');
    expect(pruefeWert(param('gk-eta'), '92')).toBeNull();
    expect(pruefeWert(param('gk-eta'), '130')?.stufe).toBe('warnung');
  });

  it('meldet €/kWh statt ct/kWh und den Standardwert bei leerem Feld', () => {
    expect(pruefeWert(param('wirt-p-gas'), '0.1')?.text).toContain('€/kWh');
    const leer = pruefeWert(param('wirt-p-strom'), '');
    expect(leer?.stufe).toBe('fallback');
    expect(leer?.text).toContain('35');
    expect(pruefeWert(param('wirt-p-strom-wp'), '')).toBeNull();   // optional: leer = wie Strom
  });

  it('prüft Erzeugerwerte nur bei aktivem Erzeuger', () => {
    const werte = { 'gk-eta': '0.92', 'lwwp-jaz': '9' };
    expect(pruefeParameter(werte, [])).toEqual([]);
    const an = pruefeParameter(werte, ['gasKessel', 'lwWp']);
    expect(an.map(h => h.id).sort()).toEqual(['gk-eta', 'lwwp-jaz']);
  });

  it('meldet unplausible spezifische Bedarfe je Gebäude', () => {
    const h = pruefeGebaeude([
      { id: 1, name: 'Ok', flaeche: 1000, waerme: '120', strom: '30' },
      { id: 2, name: 'Fläche in Tsd.', flaeche: 1.2, waerme: '120' },
      { id: 3, name: 'Ohne Fläche', flaeche: null, waerme: '120' },
    ]);
    expect(h.map(x => x.gebId)).toEqual([2]);
    expect(h[0].text).toContain('kWh/m²a');
  });
});

describe('Migration der Wirkungsgrade', () => {
  it('rechnet Bruchteile in Projektwurzel und Varianten auf Prozent um', () => {
    const p = {
      gasKessel: { leistungKw: 500, eta: '0.92' },
      bhkw: { eta: 0.88 },
      stromkessel: { eta: '99' },
      varianten: [{ id: 'v1', state: { heizoelKessel: { eta: '0,9' } } }],
    };
    const k = migriereWirkungsgrade(p);
    expect(p.gasKessel.eta).toBe('92');
    expect(p.bhkw.eta).toBe('88');
    expect(p.stromkessel.eta).toBe('99');
    expect(p.varianten[0].state.heizoelKessel.eta).toBe('90');
    expect(k.map(x => x.id).sort()).toEqual(['bhkw-eta', 'gk-eta', 'hko-eta']);
    expect(k.every(x => x.stufe === 'korrigiert')).toBe(true);
  });

  it('prepareProjectForImport korrigiert das alte Demo und meldet es', () => {
    const alt = JSON.parse(readFileSync(resolve(hier, 'fixtures/demo_projekt_alt_v1.json'), 'utf8'));
    // Das alte Demo speicherte Polygone als [lat, lng] — für diesen Test ins aktuelle Format
    alt.gebaeude.forEach(g => { g.polygon = g.polygon.map(([lat, lng]) => ({ lat, lng })); });
    const { project, korrekturen, warnings } = prepareProjectForImport(alt);
    expect(project.gasKessel.eta).toBe('92');
    expect(alt.gasKessel.eta).toBe('0.92');            // Eingabe bleibt unverändert
    expect(korrekturen).toHaveLength(1);
    expect(warnings.some(w => w.includes('Bruchteil'))).toBe(true);
  });
});
