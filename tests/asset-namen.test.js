import { describe, it, expect } from 'vitest';
import { bildeAssetName, deuteAltenNamen, deuteNamensEingabe } from '../src/lib/asset-namen.js';

describe('bildeAssetName', () => {
  it('Typ · Nummer · Name', () => {
    expect(bildeAssetName('UV', { id: 'g1', name: 'Werkstatt', gebaeudenummer: '4711' })).toBe('UV 4711 Werkstatt');
  });
  it('fehlende Nummer entfällt, Nummer am Namensanfang nicht doppelt', () => {
    expect(bildeAssetName('Trafo', { id: 'g1', name: 'Werkstatt' })).toBe('Trafo Werkstatt');
    expect(bildeAssetName('Trafo', { id: 'g1', name: '4711 Werkstatt', gebaeudenummer: '4711' })).toBe('Trafo 4711 Werkstatt');
    expect(bildeAssetName('Trafo', { id: 'g1', name: '4711', gebaeudenummer: '4711' })).toBe('Trafo 4711');
  });
  it('ohne Name und Nummer: Gebäude-Id; ohne Gebäude: null', () => {
    expect(bildeAssetName('UV', { id: 'g9' })).toBe('UV g9');
    expect(bildeAssetName('UV', null)).toBe(null);
  });
});

describe('deuteNamensEingabe', () => {
  const auto = 'Trafo 4711 Werkstatt';
  it('leer oder gebildeter Name → automatisch', () => {
    expect(deuteNamensEingabe('', auto)).toEqual({ auto: true, zusatz: '' });
    expect(deuteNamensEingabe(auto, auto)).toEqual({ auto: true, zusatz: '' });
  });
  it('gebildeter Name + Text → automatisch mit Zusatz', () => {
    expect(deuteNamensEingabe(auto + ' (Einsp.)', auto)).toEqual({ auto: true, zusatz: '(Einsp.)' });
  });
  it('eigener Name → fest; ohne Gebäude leer → automatisch', () => {
    expect(deuteNamensEingabe('T1 Süd', auto)).toEqual({ auto: false, zusatz: '' });
    expect(deuteNamensEingabe('', null)).toEqual({ auto: true, zusatz: '' });
    expect(deuteNamensEingabe('PV Freifläche', null)).toEqual({ auto: false, zusatz: '' });
  });
});

describe('deuteAltenNamen', () => {
  const p = ['Trafo', 'Trafo'];
  it('aus dem Gebäudenamen gebildet → automatisch', () => {
    expect(deuteAltenNamen('Trafo Altbau', p)).toEqual({ auto: true, zusatz: '' });
    expect(deuteAltenNamen('Trafo Altbau (Einsp.)', p)).toEqual({ auto: true, zusatz: '(Einsp.)' });
    expect(deuteAltenNamen('Verbraucher Halle', ['Verbraucher', 'Verbraucher'])).toEqual({ auto: true, zusatz: '' });
    expect(deuteAltenNamen('Lade Halle', ['Lade', 'Ladeinfrastruktur'])).toEqual({ auto: true, zusatz: '' });
  });
  it('laufende Nummer oder fremder Name → fest', () => {
    expect(deuteAltenNamen('Trafo 2a', p).auto).toBe(false);
    expect(deuteAltenNamen('Trafo 3 (Einsp.)', p).auto).toBe(false);
    expect(deuteAltenNamen('NEA Werkstatt', ['Nsa', 'Notstromaggregat']).auto).toBe(false);
  });
});
