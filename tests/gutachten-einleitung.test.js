// Vitest-Tests für lib/gutachten-einleitung.js — 1.1 Ziele und Grundsätze, 1.2, Einstieg Ist-Zustand.
import { describe, it, expect } from 'vitest';
import { geTextZiele, geTextLiegenschaft, geTextIstEinstieg, geWaehle, geStartwert } from '../src/lib/gutachten-einleitung.js';
import { wtKlartext } from '../src/lib/gutachten-waerme-texte.js';

const text = abs => wtKlartext(abs);

describe('Formulierungsvarianten', () => {
  it('fest je Startwert, wechselt mit dem Zähler', () => {
    const o = { liegenschaft: 'Musterkaserne', ort: 'Musterstadt' };
    expect(text(geTextZiele(o))).toBe(text(geTextZiele(o)));
    const texte = new Set([0, 1, 2].map(v => text(geTextZiele({ ...o, variante: v }))));
    expect(texte.size).toBe(3);
    expect(geWaehle(['a', 'b', 'c'], -5)).toMatch(/[abc]/);
    expect(geStartwert('x')).toBe(geStartwert('x'));
  });
});

describe('1.1 Ziele und Grundsätze', () => {
  it('Liegenschaft und Ort aus den Projektdaten, sonst Platzhalter', () => {
    const t = text(geTextZiele({ liegenschaft: 'Musterkaserne', ort: 'Musterstadt' }));
    expect(t).toContain('Musterkaserne');
    expect(t).toContain('Musterstadt');
    expect(t).toContain('Gebäudeenergiegesetz');
    expect(t).toContain('Resilienz');
    const leer = text(geTextZiele({}));
    expect(leer).toContain('[Name der Liegenschaft]');
    expect(leer).toContain('[Ort]');
  });
  it('Vorgaben aus der lokalen Vorlage, sonst gelber Platzhalter', () => {
    const mit = geTextZiele({ vorgaben: 'Absatz eins.\n\nAbsatz zwei.' });
    expect(text(mit)).toContain('Absatz eins.\n\nAbsatz zwei.');
    expect(text(geTextZiele({}))).toContain('[Vorgaben des Auftraggebers');
  });
  it('Resilienz entfällt auf Wunsch', () => {
    expect(text(geTextZiele({ mitResilienz: false }))).not.toContain('Resilienz');
  });
  it('Aufzählung der Ziele', () => {
    expect(text(geTextZiele({})).match(/^• /gm)).toHaveLength(3);
  });
});

describe('1.2 und Einstieg Ist-Zustand', () => {
  it('1.2 ist nur ein Platzhalter', () => {
    expect(text(geTextLiegenschaft())).toMatch(/^\[Kapitelerstellung ausstehend/);
  });
  it('Energieträger und Lastgang', () => {
    const t = text(geTextIstEinstieg({ traeger: ['Erdgas', 'Heizöl', 'Strom'], lastgang: true }));
    expect(t).toContain('Lastgangdaten und der monatlichen Erdgas-, Heizöl- und Stromverbräuche');
    expect(text(geTextIstEinstieg({ traeger: ['Erdgas'] }))).toContain('der monatlichen Erdgasverbräuche');
    expect(text(geTextIstEinstieg({}))).toContain('der vorliegenden Verbrauchsdaten');
  });
});
