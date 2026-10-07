import { describe, it, expect } from 'vitest';
import { msSpannungen } from '../src/lib/ms-spannung.js';

const kv = a => a.props?.spannungKV;

describe('msSpannungen', () => {
  it('nimmt die Spannung des NAP statt 20 kV', () => {
    const ms = msSpannungen([{ id: 'n', props: { spannungKV: 10 } }],
      [{ u: 'n', v: 'sa', msLevel: true }], kv);
    expect(ms.standardV).toBe(10000);
    expect(ms.kanteV({ u: 'n', v: 'sa' })).toBe(10000);
  });
  it('liest Text mit Komma', () => {
    expect(msSpannungen([{ id: 'n', props: { spannungKV: '10,0' } }], [], kv).standardV).toBe(10000);
  });
  it('ohne NAP-Eintrag gilt die Vorgabe 20 kV', () => {
    const ms = msSpannungen([{ id: 'n', props: {} }], [], kv);
    expect(ms.standardV).toBe(20000);
    expect(ms.ausNap).toBe(false);
  });
  it('mehrere NAPs: jedes MS-Kabel rechnet mit seinem NAP', () => {
    const naps = [{ id: 'a', props: { spannungKV: 20 } }, { id: 'b', props: { spannungKV: 10 } }];
    const kanten = [
      { u: 'a', v: 'sa1', msLevel: true }, { u: 'sa1', v: 't1', msLevel: true },
      { u: 'b', v: 'sa2', msLevel: true }, { u: 'sa2', v: 't2', msLevel: true },
    ];
    const ms = msSpannungen(naps, kanten, kv);
    expect(ms.kanteV(kanten[1])).toBe(20000);
    expect(ms.kanteV(kanten[3])).toBe(10000);
    // Kabel ohne Weg zum NAP: erster NAP mit Eintrag
    expect(ms.kanteV({ u: 'x', v: 'y' })).toBe(20000);
  });
});
