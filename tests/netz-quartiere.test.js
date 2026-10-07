// Vitest-Tests für lib/netz-quartiere.js — Versorgungsquartiere mit eigenem Hauptstrang.
import { describe, it, expect } from 'vitest';
import { strangGruppen, sackgassenEntfernen, hauptstraenge, quartierJeGebaeude } from '../src/lib/netz-quartiere.js';

describe('strangGruppen', () => {
  it('übrige Gebäude gemeinsam, je Quartier eine Gruppe, Zentrale ausgelassen', () => {
    const q = [{ id: 'a', gebIds: [2, 3, 1] }, { id: 'b', gebIds: [3, 4] }];
    expect(strangGruppen([1, 2, 3, 4, 5, 6], q, 1)).toEqual([
      { id: null, gebIds: [5, 6] }, { id: 'a', gebIds: [2, 3] }, { id: 'b', gebIds: [4] },
    ]);
    expect(quartierJeGebaeude(q, 1).get(3)).toBe('a');   // ein Gebäude gehört nur einem Quartier
  });
  it('ohne Restgebäude keine leere Gruppe', () => {
    expect(strangGruppen([1, 2], [{ id: 'a', gebIds: [2] }], 1)).toEqual([{ id: 'a', gebIds: [2] }]);
  });
});

describe('sackgassenEntfernen', () => {
  it('entfernt Trassenäste ohne Abnehmer, behält den Weg zu den Gebäuden', () => {
    // Z(1) – t10 – t11 – G2 ; t11 – t12 – t13 (Sackgasse)
    const k = [{ u: 1, v: 10 }, { u: 10, v: 11 }, { u: 11, v: 2 }, { u: 11, v: 12 }, { u: 12, v: 13 }];
    const frei = id => id >= 10;
    expect(sackgassenEntfernen(k, frei)).toEqual(k.slice(0, 3));
  });
});

describe('hauptstraenge', () => {
  // Zentrale 1; Abgang über t10 versorgt 2 und 3, Abgang über t20 versorgt 4
  const kanten = [{ u: 1, v: 10 }, { u: 10, v: 2 }, { u: 10, v: 3 }, { u: 1, v: 20 }, { u: 20, v: 4 }];
  const istGeb = id => id < 10;
  it('ordnet Knoten ihrem Abgang zu und erkennt eigene Stränge', () => {
    const h = hauptstraenge(kanten, 1, new Map([[2, 'a'], [3, 'a'], [4, 'b']]), istGeb);
    expect(h.abgangVon.get(3)).toBe(10);
    expect(h.abgangVon.get(4)).toBe(20);
    expect(h.quartierVonAbgang.get(10)).toBe('a');
    expect(h.gemischt).toEqual([]);
  });
  it('erkennt einen Strang, der zwei Quartiere versorgt', () => {
    const h = hauptstraenge(kanten, 1, new Map([[2, 'a'], [3, 'b']]), istGeb);
    expect(h.gemischt).toEqual([10]);
    expect(h.quartierVonAbgang.get(20)).toBe(null);   // Gebäude ohne Quartier
  });
});
