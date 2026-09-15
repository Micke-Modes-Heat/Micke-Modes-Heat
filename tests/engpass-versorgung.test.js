// Vitest-Tests für engpassVersorgung (lib/engpass-core.js) — versorgende Verteilung/Trafo eines Ladeparks (Gutachten 3.4.4).
import { describe, it, expect } from 'vitest';
import { engpassVersorgung } from '../src/lib/engpass-core.js';

const RANG = { NAP: 0, Trafo: 2, NSHV: 3, UV: 4, KVS: 4, Lade: 5, Verbraucher: 5 };
const assets = [
  { id: 'nap', type: 'NAP' }, { id: 't1', type: 'Trafo' }, { id: 'ns', type: 'NSHV' }, { id: 'uv', type: 'UV' },
  { id: 'lp', type: 'Lade' }, { id: 'v', type: 'Verbraucher' }, { id: 't2', type: 'Trafo' }, { id: 'ns2', type: 'NSHV' },
];
const edges = [
  { id: 'e1', u: 'nap', v: 't1' }, { id: 'e2', u: 't1', v: 'ns' }, { id: 'e3', u: 'ns', v: 'uv' }, { id: 'e4', u: 'uv', v: 'lp' },
  { id: 'e5', u: 'ns', v: 'v' }, { id: 'e6', u: 'nap', v: 't2' }, { id: 'e7', u: 't2', v: 'ns2' },
];

describe('engpassVersorgung', () => {
  it('läuft vom Ladepark stromaufwärts: nächste Verteilung und Trafo', () => {
    const r = engpassVersorgung('lp', assets, edges, RANG);
    expect(r.verteilung.id).toBe('uv');
    expect(r.trafo.id).toBe('t1');
  });

  it('läuft nicht stromabwärts in fremde Stränge', () => {
    const r = engpassVersorgung('v', assets, edges, RANG);
    expect(r.verteilung.id).toBe('ns');
    expect(r.trafo.id).toBe('t1');
  });

  it('liefert null ohne Anbindung', () => {
    expect(engpassVersorgung('frei', assets, edges, RANG)).toEqual({ verteilung: null, trafo: null });
  });
});
