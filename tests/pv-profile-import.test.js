import { describe, expect, it } from 'vitest';
import { parsePvProfileCsv, syntheticPvProfileMeta } from '../src/lib/pv-profile-import.js';

describe('PV-Profilimport mit Provenienz', () => {
  it('liest echte PVGIS-Spalten und rechnet Watt in kW um', () => {
    const rows = ['Latitude: 52', 'time,P,G(i),T2m'];
    for (let i = 0; i < 8760; i++) rows.push(`2023${String(Math.floor(i/744)+1).padStart(2,'0')}01:${String(i%24).padStart(2,'0')}00,1500,2,3`);
    const r = parsePvProfileCsv(rows.join('\n'), {filename:'pvgis.csv'});
    expect(r.values).toHaveLength(8760);
    expect(r.values[0]).toBe(1.5);
    expect(r.meta.quality).toBe('modeled_external');
    expect(r.meta.unitConversion).toMatch(/W → kW/);
  });

  it('entfernt bei 8.784 Werten kalenderkorrekt den Schalttag', () => {
    const text = Array.from({length:8784}, (_, i) => String(i)).join('\n');
    const r = parsePvProfileCsv(text);
    expect(r.values[1415]).toBe(1415);
    expect(r.values[1416]).toBe(1440);
    expect(r.meta.quality).toBe('uploaded_unverified');
  });

  it('weist interne Profile als Screening aus', () => {
    expect(syntheticPvProfileMeta().quality).toBe('synthetic_screening');
  });
});
