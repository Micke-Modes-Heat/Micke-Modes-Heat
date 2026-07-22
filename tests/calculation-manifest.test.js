import { describe, expect, it } from 'vitest';
import { createCalculationManifest } from '../src/lib/calculation-manifest.js';

describe('Berechnungsmanifest', () => {
  it('führt Versionen, Datenprovenienz und Aussagegrenzen maschinenlesbar', () => {
    const manifest = createCalculationManifest({
      appVersion: 'test', buildDate: '2026-07-19', generatedAt: '2026-07-19T00:00:00.000Z',
      timeSeriesMeta: {quality:'measured', source:'Messung', timezone:'Europe/Berlin'},
    });
    expect(manifest.appVersion).toBe('test');
    expect(manifest.models.optimizer.method).toMatch(/heuristisch/i);
    expect(manifest.dataQuality.heatLoadSeries).toEqual({quality:'measured', source:'Messung', timezone:'Europe/Berlin'});
    expect(manifest.limitations.length).toBeGreaterThanOrEqual(4);
  });

  it('klont Metadaten statt Eingaben zu referenzieren', () => {
    const meta = {quality:'synthetic', history:['scale']};
    const manifest = createCalculationManifest({timeSeriesMeta: meta, generatedAt:'2026-07-19T00:00:00.000Z'});
    meta.history.push('mutated');
    expect(manifest.dataQuality.heatLoadSeries.history).toEqual(['scale']);
  });
});
