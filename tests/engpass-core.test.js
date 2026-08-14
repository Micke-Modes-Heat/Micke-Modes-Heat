// Vitest-Tests für lib/engpass-core.js — Stützjahre, Engpassbewertung, Klassen.
// engpass-core ist importfrei/DOM-frei → direkt als ESM importierbar.
import { describe, it, expect } from 'vitest';
import {
  ENGPASS_GRENZEN, engpassStuetzjahre, engpassBewerte, engpassKlassifiziere,
} from '../src/lib/engpass-core.js';

describe('engpassStuetzjahre', () => {
  it('enthält immer das Startjahr, auch ohne jedes Ereignis', () => {
    expect(engpassStuetzjahre(2026, 2050, [], [])).toEqual([2026]);
  });

  it('sammelt Bau- und Abrissjahre aus Assets und Kabeln, sortiert und eindeutig', () => {
    const assets = [{ baujahr: 2030, abrissjahr: 2045 }, { baujahr: 2030 }];
    const edges  = [{ baujahr: 2035 }];
    expect(engpassStuetzjahre(2026, 2050, assets, edges)).toEqual([2026, 2030, 2035, 2045]);
  });

  it('ignoriert Jahre außerhalb des Horizonts', () => {
    const assets = [{ baujahr: 2020, abrissjahr: 2099 }, { baujahr: 2040 }];
    expect(engpassStuetzjahre(2026, 2050, assets, [])).toEqual([2026, 2040]);
  });

  it('berücksichtigt nur umgesetzte Maßnahmen', () => {
    const assets = [{
      massnahmen: [
        { jahr: 2032, status: 'umgesetzt' },
        { jahr: 2036, status: 'geplant' },
      ],
    }];
    expect(engpassStuetzjahre(2026, 2050, assets, [])).toEqual([2026, 2032]);
  });

  it('löst das Maßnahmenjahr über die injizierte jahrFn auf (Phasenbezug)', () => {
    const assets = [{ massnahmen: [{ phaseId: 'p1', status: 'umgesetzt' }] }];
    const jahrFn = m => (m.phaseId === 'p1' ? 2033 : null);
    expect(engpassStuetzjahre(2026, 2050, assets, [], jahrFn)).toEqual([2026, 2033]);
  });

  it('verträgt fehlende Felder und leere Eingaben', () => {
    expect(engpassStuetzjahre(2026, 2050, null, null)).toEqual([2026]);
    expect(engpassStuetzjahre(2026, 2050, [{}], [{ massnahmen: [] }])).toEqual([2026]);
  });
});

describe('engpassBewerte', () => {
  it('meldet keinen Engpass, solange beide Grenzen eingehalten sind', () => {
    const r = engpassBewerte([
      { jahr: 2026, auslastungPct: 40, deltaUKumPct: 1.0 },
      { jahr: 2030, auslastungPct: 95, deltaUKumPct: 2.9 },
    ]);
    expect(r.engpassJahr).toBeNull();
    expect(r.ursache).toBeNull();
    expect(r.maxAuslPct).toBe(95);
    expect(r.maxDuPct).toBe(2.9);
  });

  it('erkennt einen Strom-Engpass beim ersten Überschreiten', () => {
    const r = engpassBewerte([
      { jahr: 2026, auslastungPct: 80,  deltaUKumPct: 1 },
      { jahr: 2032, auslastungPct: 120, deltaUKumPct: 1 },
      { jahr: 2040, auslastungPct: 150, deltaUKumPct: 1 },
    ]);
    expect(r.engpassJahr).toBe(2032);
    expect(r.ursache).toBe('strom');
    expect(r.maxAuslPct).toBe(150); // Maximum über den ganzen Horizont
  });

  it('erkennt einen reinen Spannungs-Engpass', () => {
    const r = engpassBewerte([
      { jahr: 2026, auslastungPct: 50, deltaUKumPct: 2.0 },
      { jahr: 2035, auslastungPct: 60, deltaUKumPct: 3.4 },
    ]);
    expect(r.engpassJahr).toBe(2035);
    expect(r.ursache).toBe('spannung');
  });

  it('meldet beide Ursachen, wenn sie im selben Jahr auftreten', () => {
    const r = engpassBewerte([{ jahr: 2033, auslastungPct: 110, deltaUKumPct: 4 }]);
    expect(r.ursache).toBe('strom+spannung');
  });

  it('behält das FRÜHESTE Engpassjahr, auch wenn später Schlimmeres kommt', () => {
    const r = engpassBewerte([
      { jahr: 2028, auslastungPct: 101, deltaUKumPct: 0 },
      { jahr: 2031, auslastungPct: 100, deltaUKumPct: 9 },
    ]);
    expect(r.engpassJahr).toBe(2028);
    expect(r.ursache).toBe('strom');
  });

  it('behandelt genau 100 % / genau 3 % noch als zulässig', () => {
    const r = engpassBewerte([{ jahr: 2026, auslastungPct: 100, deltaUKumPct: 3 }]);
    expect(r.engpassJahr).toBeNull();
  });

  it('akzeptiert abweichende Grenzwerte', () => {
    const reihe = [{ jahr: 2026, auslastungPct: 85, deltaUKumPct: 1 }];
    expect(engpassBewerte(reihe).engpassJahr).toBeNull();
    expect(engpassBewerte(reihe, { ...ENGPASS_GRENZEN, auslastungPct: 80 }).engpassJahr).toBe(2026);
  });

  it('verträgt leere und fehlende Reihen', () => {
    expect(engpassBewerte([]).engpassJahr).toBeNull();
    expect(engpassBewerte(null).maxAuslPct).toBe(0);
  });
});

describe('engpassKlassifiziere', () => {
  it('ordnet die Dringlichkeit relativ zum Bezugsjahr ein', () => {
    expect(engpassKlassifiziere(null, 2026)).toBe('keiner');
    expect(engpassKlassifiziere(2026, 2026)).toBe('akut');   // schon jetzt
    expect(engpassKlassifiziere(2020, 2026)).toBe('akut');   // längst überschritten
    expect(engpassKlassifiziere(2030, 2026)).toBe('kurz');   // < 5 Jahre
    expect(engpassKlassifiziere(2031, 2026)).toBe('mittel'); // Grenze 5 Jahre
    expect(engpassKlassifiziere(2040, 2026)).toBe('mittel'); // < 15 Jahre
    expect(engpassKlassifiziere(2041, 2026)).toBe('lang');   // Grenze 15 Jahre
  });
});

// ── Maßnahmen-Generator ──────────────────────────────────────────────────────
import {
  ENGPASS_VORLAUF_J, engpassNoetigerLeitwert, engpassDimensionierung,
  engpassKabelKosten, engpassKabelAlternativen, engpassWaehleAlternative,
  engpassMassnahmeJahr,
} from '../src/lib/engpass-core.js';

// Vereinfachte Ausschnitte aus KABEL_TYPEN (injiziert → Test unabhängig von der Config)
const NAYY = [
  { mm2: 35, Iz: 110, eurM: 10 }, { mm2: 50, Iz: 128, eurM: 14 },
  { mm2: 95, Iz: 186, eurM: 24 }, { mm2: 240, Iz: 314, eurM: 60 },
];
const NYY = [
  { mm2: 16, Iz: 91,  eurM: 12 }, { mm2: 35, Iz: 140, eurM: 20 },
  { mm2: 50, Iz: 167, eurM: 28 }, { mm2: 240, Iz: 405, eurM: 100 },
];
const P = { typen: { NAYY: { sections: NAYY }, NYY: { sections: NYY } }, tiefbauEurM: 100 };

describe('engpassNoetigerLeitwert', () => {
  it('ist 0, solange der Spannungsfall die Grenze einhält', () => {
    expect(engpassNoetigerLeitwert(50, 1, 2.5, 3)).toBe(0);
    expect(engpassNoetigerLeitwert(50, 1, 3.0, 3)).toBe(0);
  });
  it('skaliert A·n mit dem Verhältnis Ist/Grenze', () => {
    expect(engpassNoetigerLeitwert(50, 1, 6, 3)).toBe(100);
    expect(engpassNoetigerLeitwert(50, 2, 6, 3)).toBe(200);
  });
});

describe('engpassDimensionierung', () => {
  it('erhöht zuerst den Querschnitt eines EINZELNEN Kabels', () => {
    expect(engpassDimensionierung(NAYY, 180, 0)).toEqual({ n: 1, sec: NAYY[2] }); // 95 mm²
  });

  it('nimmt den kleinsten ausreichenden Querschnitt, nicht den größten', () => {
    expect(engpassDimensionierung(NAYY, 120, 0).sec.mm2).toBe(50);
  });

  it('geht erst auf zwei Stränge, wenn der größte Einzelquerschnitt nicht reicht', () => {
    // 314 A ist das Maximum eines Einzelkabels → 400 A braucht zwei Stränge …
    const d = engpassDimensionierung(NAYY, 400, 0);
    expect(d.n).toBe(2);
    // … und dort wieder den KLEINSTEN ausreichenden Querschnitt (2 × 240 = 628 A
    // wäre Verschwendung; 2 × 240 ist nötig, da 2 × 186 = 372 < 400)
    expect(d.sec.mm2).toBe(240);
  });

  it('wählt bei zwei Strängen einen kleineren Querschnitt, wenn er reicht', () => {
    const d = engpassDimensionierung(NAYY, 350, 0);
    expect(d.n).toBe(2);
    expect(d.sec.mm2).toBe(95); // 2 × 186 = 372 A ≥ 350 A
  });

  it('steigert die Strangzahl weiter, bis der Bedarf gedeckt ist', () => {
    expect(engpassDimensionierung(NAYY, 900, 0).n).toBe(3); // 3 × 314 = 942 A
  });

  it('gibt null zurück, wenn selbst maxN Stränge nicht reichen', () => {
    expect(engpassDimensionierung(NAYY, 5000, 0)).toBeNull();
  });

  it('berücksichtigt den Leitwert-Bedarf aus dem Spannungsfall', () => {
    // Strom unkritisch, aber A·n ≥ 200 gefordert
    expect(engpassDimensionierung(NAYY, 50, 200).sec.mm2).toBe(240);
  });
});

describe('engpassKabelKosten', () => {
  it('rechnet alle Stränge im neuen Querschnitt, Tiefbau nur für zusätzliche', () => {
    const sec = { mm2: 95, eurM: 24 };
    // 1 → 1 Strang: nur Kabel, kein Tiefbau
    expect(engpassKabelKosten(sec, 1, 1, 100, 100)).toBe(2400);
    // 1 → 2 Stränge: 2 × Kabel + 1 × Tiefbau
    expect(engpassKabelKosten(sec, 2, 1, 100, 100)).toBe(2 * 2400 + 10000);
  });
});

describe('engpassKabelAlternativen', () => {
  const ist = { crossSection: 35, nParallel: 1, cableType: 'NAYY', lengthM: 100 };

  it('schlägt bei moderater Überlast einen größeren EINZELquerschnitt vor', () => {
    const beste = engpassWaehleAlternative(engpassKabelAlternativen(ist, { benoetigtA: 180 }, P));
    expect(beste.newProps).toEqual({ crossSection: 95, nParallel: 1 });
    expect(beste.label).toContain('Querschnitt 35 → 95');
  });

  it('schlägt NIE viele Stränge im alten kleinen Querschnitt vor (Regression)', () => {
    // Früher entstand hier "Parallelkabel 1 → 8 × 35 mm²" statt größerer Adern.
    const alts = engpassKabelAlternativen(ist, { benoetigtA: 400 }, P);
    const beste = engpassWaehleAlternative(alts);
    expect(beste.nParallel).toBe(2);
    expect(beste.newProps.crossSection).toBe(240); // mitdimensioniert, nicht 35
    expect(alts.every(a => (a.nParallel ?? 1) <= 2)).toBe(true);
  });

  it('dimensioniert im Kabeltyp des Bestands, nicht pauschal in Aluminium', () => {
    const cu = { crossSection: 16, nParallel: 1, cableType: 'NYY', lengthM: 50 };
    const alts = engpassKabelAlternativen(cu, { benoetigtA: 130 }, P);
    const beste = engpassWaehleAlternative(alts);
    expect(beste.newProps.crossSection).toBe(35);   // NYY 35 = 140 A
    expect(beste.newProps.cableType).toBeUndefined(); // Typ bleibt NYY
  });

  it('bietet den anderen Kabeltyp als Materialalternative an', () => {
    const alts = engpassKabelAlternativen(ist, { benoetigtA: 180 }, P);
    const mat = alts.find(a => a.newProps.cableType === 'NYY');
    expect(mat).toBeTruthy();
    expect(mat.newProps.crossSection).toBe(240); // NYY 50 = 167 A < 180 A → erst 240
  });

  it('enthält immer Lastmanagement als Referenz, deckt den Bedarf aber nicht', () => {
    const lm = engpassKabelAlternativen(ist, { benoetigtA: 180 }, P).find(a => a.id === 'lastmanagement');
    expect(lm.investEUR).toBe(0);
    expect(lm.deckungOk).toBe(false);
  });

  it('schlägt nichts vor, wenn der Bestand bereits ausreicht', () => {
    const alts = engpassKabelAlternativen({ ...ist, crossSection: 240 }, { benoetigtA: 300 }, P);
    expect(alts.filter(a => a.deckungOk && a.newProps.cableType === undefined)).toEqual([]);
  });

  it('dimensioniert bei Spannungs-Engpass nach dem Leitwert, nicht nur nach Strom', () => {
    const alts = engpassKabelAlternativen(ist, { benoetigtA: 50, maxDuPct: 6 }, { ...P, grenzDuPct: 3 });
    const beste = engpassWaehleAlternative(alts);
    expect(beste.newProps.crossSection).toBe(95); // A·n ≥ 70 nötig → 95 mm²
    expect(beste.nParallel).toBe(1);
  });
});

describe('engpassWaehleAlternative', () => {
  it('bevorzugt weniger Parallelstränge vor geringfügig niedrigeren Kosten', () => {
    const gewaehlt = engpassWaehleAlternative([
      { deckungOk: true, investEUR: 1000, nParallel: 3, gleicherTyp: true },
      { deckungOk: true, investEUR: 1200, nParallel: 1, gleicherTyp: true },
    ]);
    expect(gewaehlt.nParallel).toBe(1);
  });

  it('plant keinen stillen Materialwechsel ein, auch wenn er günstiger wäre', () => {
    const gewaehlt = engpassWaehleAlternative([
      { deckungOk: true, investEUR:  900, nParallel: 1, gleicherTyp: false },
      { deckungOk: true, investEUR: 2500, nParallel: 2, gleicherTyp: true  },
    ]);
    expect(gewaehlt.gleicherTyp).toBe(true);
  });
  it('gibt null zurück, wenn nichts ausreicht', () => {
    expect(engpassWaehleAlternative([{ deckungOk: false, investEUR: 0 }])).toBeNull();
    expect(engpassWaehleAlternative([])).toBeNull();
  });
});

describe('engpassMassnahmeJahr', () => {
  it('plant den Vorlauf vor dem Engpass ein', () => {
    expect(engpassMassnahmeJahr(2038, 2026)).toBe(2038 - ENGPASS_VORLAUF_J);
    expect(engpassMassnahmeJahr(2038, 2026, 5)).toBe(2033);
  });
  it('geht nie vor das Bezugsjahr zurück', () => {
    expect(engpassMassnahmeJahr(2026, 2026)).toBe(2026); // akuter Engpass → sofort
    expect(engpassMassnahmeJahr(2027, 2026, 5)).toBe(2026);
  });
  it('liefert null ohne Engpass', () => {
    expect(engpassMassnahmeJahr(null, 2026)).toBeNull();
  });
});

describe('engpassStuetzjahre — Regression: historischer Horizont', () => {
  // _initYearSliderFromBaujahr() setzt globalYear auf das älteste Gebäude-Baujahr
  // (z. B. 1970). Wird das als Planungsstart genommen, liegen alle realen
  // Ereignisse (2030+) außerhalb des Horizonts → nur EIN Stützjahr → jede
  // Zeitstrahl-Zeile wird einfarbig und das Eintrittsjahr ist immer das Startjahr.
  const assets = [{ baujahr: 2033 }, { baujahr: 2040 }];

  it('kollabiert auf ein einziges Stützjahr, wenn der Horizont historisch liegt', () => {
    expect(engpassStuetzjahre(1970, 1995, assets, [])).toEqual([1970]);
  });

  it('erfasst die Ereignisse bei korrektem Planungshorizont', () => {
    expect(engpassStuetzjahre(2026, 2051, assets, [])).toEqual([2026, 2033, 2040]);
  });
});

describe('engpassKabelAlternativen — Eskalationsreihe (Nutzerregel)', () => {
  const K = { typen: { NYY: { sections: [
    { mm2: 16, Iz: 91, eurM: 12 }, { mm2: 35, Iz: 140, eurM: 20 },
    { mm2: 120, Iz: 275, eurM: 55 }, { mm2: 240, Iz: 405, eurM: 100 },
  ] } }, tiefbauEurM: 100 };
  const ist = { crossSection: 16, nParallel: 1, cableType: 'NYY', lengthM: 100 };
  const wahl = A => engpassWaehleAlternative(engpassKabelAlternativen(ist, { benoetigtA: A }, K));

  it('erhöht bis zum größten Einzelquerschnitt, bevor ein zweiter Strang kommt', () => {
    expect(wahl(120)).toMatchObject({ nParallel: 1, newProps: { crossSection: 35 } });
    expect(wahl(300)).toMatchObject({ nParallel: 1, newProps: { crossSection: 240 } });
    expect(wahl(405)).toMatchObject({ nParallel: 1, newProps: { crossSection: 240 } });
  });

  it('legt erst danach einen zweiten Strang — mit neu dimensioniertem Querschnitt', () => {
    const w = wahl(500);
    expect(w.nParallel).toBe(2);
    expect(w.newProps.crossSection).toBe(120); // 2 × 275 = 550 A, nicht 2 × 16
    expect(w.label).toContain('+1 Strang');
  });

  it('formuliert den Plural korrekt', () => {
    expect(wahl(900).label).toContain('+2 Stränge');
    expect(wahl(900).label).not.toContain('Strangstränge');
  });
});
