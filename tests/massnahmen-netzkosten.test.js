// Vitest-Tests: Kostenpositionen des internen Netzes (lib/elektro-kosten.js) und Jahr einer Maßnahme (lib/phasen-core.js).
import { describe, it, expect } from 'vitest';
import { ekNetzPositionen, ekAuswertung } from '../src/lib/elektro-kosten.js';
import { massnahmeJahrAus } from '../src/lib/phasen-core.js';

const vorschlagTrafo = { art: 'trafo', label: 'Trafo 630 → 1000 kVA', investEUR: 38000, jahr: 2029 };
const vorschlagKabel = { art: 'kabel', label: 'NAYY 4×240', investEUR: 12000, jahr: 2030 };

describe('ekNetzPositionen', () => {
  it('nimmt ohne geplante Maßnahme den Vorschlag und meldet ihn', () => {
    const r = ekNetzPositionen({ engpaesse: [{ id: 't1', label: 'T1', v: vorschlagTrafo }], geplant: [], heute: 2026 });
    expect(r.positionen).toEqual([expect.objectContaining({ quelle: 'vorschlag', objId: 't1', investEur: 38000, jahr: 2029, art: 'trafo' })]);
    expect(r.vorschlaege).toEqual(['T1']);
  });

  it('bevorzugt die geplante Maßnahme mit ihrem Betrag und Jahr und meldet die Abweichung', () => {
    const r = ekNetzPositionen({
      engpaesse: [{ id: 't1', label: 'T1', v: vorschlagTrafo }],
      geplant: [{ objId: 't1', objLabel: 'T1', art: 'trafo', m: { id: 'm1', titel: 'Trafotausch 1000 kVA', kosten: 52000, jahr: 2028, status: 'geplant' } }],
      heute: 2026,
    });
    expect(r.positionen).toHaveLength(1);
    expect(r.positionen[0]).toMatchObject({ quelle: 'plan', investEur: 52000, jahr: 2028, massnahmeId: 'm1', label: 'T1: Trafotausch 1000 kVA' });
    expect(r.vorschlaege).toEqual([]);
    expect(r.abweichend).toEqual([{ label: 'T1', plan: { investEur: 52000, jahr: 2028 }, vorschlag: { label: vorschlagTrafo.label, investEur: 38000, jahr: 2029 } }]);
  });

  it('meldet keine Abweichung, wenn die übernommene Maßnahme dem Vorschlag entspricht', () => {
    const r = ekNetzPositionen({
      engpaesse: [{ id: 'k1', label: 'K1', v: vorschlagKabel }],
      geplant: [{ objId: 'k1', objLabel: 'K1', art: 'kabel', m: { id: 'auto_k1', titel: 'NAYY 4×240', kosten: 12000, jahr: 2030, status: 'geplant' } }],
    });
    expect(r.abweichend).toEqual([]);
  });

  it('übernimmt geplante Maßnahmen an Betriebsmitteln ohne Engpass', () => {
    const r = ekNetzPositionen({ geplant: [{ objId: 'v1', objLabel: 'NSHV 3', art: 'verteilung', m: { id: 'm2', titel: 'Feld ergänzen', kosten: 9000, jahr: 2031, status: 'geplant' } }] });
    expect(r.positionen).toEqual([expect.objectContaining({ quelle: 'plan', art: 'verteilung', investEur: 9000 })]);
  });

  it('lässt abgelehnte und bereits gebaute Maßnahmen weg, zählt künftige umgesetzte mit', () => {
    const m = (id, status, jahr) => ({ objId: 'k1', objLabel: 'K1', art: 'kabel', m: { id, titel: id, kosten: 1000, jahr, status } });
    const r = ekNetzPositionen({ geplant: [m('ab', 'abgelehnt', 2030), m('alt', 'umgesetzt', 2020), m('neu', 'umgesetzt', 2027)], heute: 2026 });
    expect(r.positionen.map(p => p.massnahmeId)).toEqual(['neu']);
  });

  it('ordnet Engpässe ohne Maßnahme wie bisher den offenen Punkten zu und zählt Maßnahmen ohne Kosten', () => {
    const r = ekNetzPositionen({
      engpaesse: [
        { id: 'b', label: 'B', bestand: true, v: vorschlagKabel },
        { id: 'ms', label: 'MS', ms: true, v: null },
        { id: 'u', label: 'U', v: { ungeloest: true, jahr: 2030 } },
        { id: 'x', label: 'X', v: null },
        { id: 'p', label: 'P', bestand: true, v: vorschlagKabel },
      ],
      geplant: [{ objId: 'p', objLabel: 'P', art: 'kabel', m: { id: 'm', titel: 'Querschnitt prüfen', kosten: 0, jahr: null, status: 'geplant' } }],
    });
    expect(r.offen).toEqual({ bestand: 1, ungeloest: 1, ms: 1, ohneKosten: 1 });
    expect(r.positionen).toHaveLength(1);
    // Positionen ohne Betrag fallen in der Auswertung weg
    expect(ekAuswertung(r.positionen, null).positionen).toHaveLength(0);
  });
});

describe('massnahmeJahrAus', () => {
  const phasen = [{ id: 'p1', jahrVon: '2031', jahrBis: '2033' }, { id: 'p2', jahrVon: '' }];
  it('eigenes Jahr vor Phase, sonst Phase, sonst null', () => {
    expect(massnahmeJahrAus({ jahr: 2029, phaseId: 'p1' }, phasen)).toBe(2029);
    expect(massnahmeJahrAus({ jahr: '2030' }, phasen)).toBe(2030);
    expect(massnahmeJahrAus({ phaseId: 'p1' }, phasen)).toBe(2031);
    expect(massnahmeJahrAus({ jahr: '', phaseId: 'p1' }, phasen)).toBe(2031);
    expect(massnahmeJahrAus({ jahr: null, phaseId: 'p2' }, phasen)).toBe(null);
    expect(massnahmeJahrAus({ phaseId: 'fehlt' }, phasen)).toBe(null);
    expect(massnahmeJahrAus({}, null)).toBe(null);
  });
});
