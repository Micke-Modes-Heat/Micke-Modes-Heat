import { describe, it, expect } from 'vitest';
import { grRechenstand, grWarnungen } from '../src/lib/gutachten-rechenstand.js';

const bedarf = { lastgang: 'C:\\Daten\\Beelitz_2025_Strom.csv', dataYear: 2025, zieljahr: 2030, zubauKw: 873 };
const pvOk = { berechnet: true, stale: false, stand: '19.10.2026, 14:02', lastgang: 'Beelitz_2025_Strom.csv',
  lastfall: 'ziel', zielJahr: 2030, netzkurve: true, bestandsnetz: true };
const zeile = (z, id) => z.find(x => x.id === id);

describe('grRechenstand', () => {
  it('alles passend: jede Rechnung aktuell, keine Warnungen', () => {
    const z = grRechenstand({ bedarf, netz: { modell: true, frisch: true }, pv: pvOk, resilienz: { berechnet: true } });
    expect(z.map(x => x.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(zeile(z, 'pv').stand).toBe('gerechnet 19.10.2026, 14:02 · Zielausbau 2030');
    expect(grWarnungen(z)).toEqual([]);
  });

  it('Zieten-Fall: PV gegen die Messung und vor dem Ausbaupfad gerechnet → Hinweis mit beiden Gründen', () => {
    const z = grRechenstand({ bedarf, netz: { modell: true, frisch: null },
      pv: { ...pvOk, lastfall: 'basis', netzkurve: false } });
    const pv = zeile(z, 'pv');
    expect(pv.status).toBe('hinweis');
    expect(pv.hinweise[0]).toMatch(/ohne die geplanten Verbraucher \(\+873 kW/);
    expect(pv.hinweise[1]).toMatch(/vor dem Ausbaupfad/);
    expect(zeile(z, 'netz').status).toBe('hinweis');
    expect(grWarnungen(z).map(w => w.stufe)).toEqual(['info', 'info']);
  });

  it('veraltet: geänderte Eingaben, andere Variante oder anderer Lastgang', () => {
    const z = grRechenstand({ bedarf, netz: { modell: true, frisch: false },
      pv: { ...pvOk, stale: true, varianteAbweichend: 'Hauptplan', lastgang: 'Beelitz_2024_Strom.csv' } });
    expect(zeile(z, 'netz').status).toBe('veraltet');
    const pv = zeile(z, 'pv');
    expect(pv.status).toBe('veraltet');
    expect(pv.hinweise).toHaveLength(3);
    expect(pv.hinweise[2]).toBe('Gerechnet mit dem Lastgang „Beelitz_2024_Strom.csv“, aktuell ist „Beelitz_2025_Strom.csv“.');
    expect(grWarnungen(z).every(w => w.stufe === 'warn')).toBe(true);
  });

  it('fehlende Rechnungen und abweichendes Zieljahr', () => {
    const z = grRechenstand({ bedarf: {}, netz: {}, pv: {}, resilienz: { berechnet: false } });
    expect(z.map(x => x.status)).toEqual(['fehlt', 'fehlt', 'fehlt', 'fehlt']);
    const z2 = grRechenstand({ bedarf, netz: { modell: true, frisch: true }, pv: { ...pvOk, zielJahr: 2035 } });
    expect(zeile(z2, 'pv').hinweise).toEqual(['Zielausbau 2035 der PV-Analyse weicht vom Zieljahr 2030 der Bedarfsprognose ab.']);
  });
});
