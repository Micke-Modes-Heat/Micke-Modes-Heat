import { describe, it, expect } from 'vitest';
import { nsKabelAuslegen, MAX_PARALLEL } from '../src/lib/ns-auslegung.js';
import { KABEL_TYPEN } from '../src/config/netz-kosten.js';

const NYY  = KABEL_TYPEN.NYY;
const NAYY = KABEL_TYPEN.NAYY;

// Basisfall: kurze Leitung, ΔU unkritisch → reine Stromauslegung
const basis = (over = {}) => nsKabelAuslegen({
  kt: NYY, I_A: 100, lengthM: 20, autoSized: true,
  kIz: 1, tLeiter: 70, cosPhi: 0.95, U_V: 400, duBudgetPct: 3, ...over,
});

describe('nsKabelAuslegen — Stromauslegung', () => {
  it('wählt den kleinsten ausreichenden Querschnitt', () => {
    const r = basis({ I_A: 100 });
    expect(r.crossSection).toBe(25);   // Iz 119 ≥ 100, 16er (91) reicht nicht
    expect(r.nParallel).toBe(1);
    expect(r.auslastungPct).toBeCloseTo(100 / 119 * 100, 6);
  });

  it('legt Parallelstränge, wenn der größte Querschnitt nicht reicht', () => {
    const r = basis({ I_A: 1215.5 });  // 240 mm² = 405 A → 4 Stränge nötig
    expect(r.nParallel).toBe(4);
    expect(r.ratedCurrentA).toBe(r.section.Iz * 4);
    expect(r.auslastungPct).toBeLessThanOrEqual(100);
  });

  it('deckelt bei MAX_PARALLEL und meldet das', () => {
    const r = basis({ I_A: 99999 });
    expect(r.nParallel).toBe(MAX_PARALLEL);
    expect(r.gedeckelt).toBe(true);
    expect(r.auslastungPct).toBeGreaterThan(100);
  });

  it('berücksichtigt kIz — Derating verlangt mehr Querschnitt', () => {
    const voll = basis({ I_A: 100, kIz: 1.0 });
    const derat = basis({ I_A: 100, kIz: 0.7 });
    expect(derat.crossSection).toBeGreaterThan(voll.crossSection);
  });

  it('Alu braucht bei gleichem Strom mindestens so viel Querschnitt wie Kupfer', () => {
    const cu = basis({ kt: NYY,  I_A: 200 });
    const al = basis({ kt: NAYY, I_A: 200 });
    expect(al.crossSection).toBeGreaterThanOrEqual(cu.crossSection);
  });
});

describe('nsKabelAuslegen — Spannungsfall', () => {
  it('hält das ΔU-Budget durch größeren Querschnitt ein', () => {
    const r = basis({ I_A: 100, lengthM: 400, duBudgetPct: 1 });
    expect(r.deltaUPct).toBeLessThanOrEqual(1);
    expect(r.crossSection).toBeGreaterThan(basis({ I_A: 100, lengthM: 400, duBudgetPct: 3 }).crossSection);
  });

  it('legt Stränge nach, wenn auch der größte Querschnitt das Budget reißt', () => {
    const r = basis({ I_A: 300, lengthM: 2000, duBudgetPct: 1 });
    expect(r.nParallel).toBeGreaterThan(1);
  });

  it('ΔU sinkt etwa mit 1/n bei Parallelsträngen', () => {
    const ein  = nsKabelAuslegen({ kt: NYY, I_A: 200, lengthM: 300, autoSized: false, crossSection: 240, nParallel: 1, cosPhi: 0.95 });
    const zwei = nsKabelAuslegen({ kt: NYY, I_A: 200, lengthM: 300, autoSized: false, crossSection: 240, nParallel: 2, cosPhi: 0.95 });
    expect(zwei.deltaUPct).toBeCloseTo(ein.deltaUPct / 2, 6);
  });

  it('übernimmt das Vorzeichen von I_A_sign für dU_V (Rückspeisung)', () => {
    const bezug = basis({ I_A: 200, I_A_sign:  200 });
    const einsp = basis({ I_A: 200, I_A_sign: -200 });
    expect(bezug.dU_V).toBeGreaterThan(0);
    expect(einsp.dU_V).toBeLessThan(0);
    expect(einsp.deltaUPct).toBeCloseTo(bezug.deltaUPct, 9);
  });

  it('höhere Leitertemperatur erhöht den Spannungsfall', () => {
    const kalt = nsKabelAuslegen({ kt: NYY, I_A: 200, lengthM: 300, crossSection: 240, nParallel: 1, tLeiter: 20, cosPhi: 0.95 });
    const warm = nsKabelAuslegen({ kt: NYY, I_A: 200, lengthM: 300, crossSection: 240, nParallel: 1, tLeiter: 70, cosPhi: 0.95 });
    expect(warm.deltaUPct).toBeGreaterThan(kalt.deltaUPct);
  });
});

describe('nsKabelAuslegen — Bestandskabel (autoSized aus)', () => {
  it('dimensioniert ein gesetztes Kabel NICHT um und meldet Überlast', () => {
    const r = nsKabelAuslegen({
      kt: NYY, I_A: 1215.5, lengthM: 33, autoSized: false,
      crossSection: 240, nParallel: 1, kIz: 1, cosPhi: 0.95,
    });
    expect(r.crossSection).toBe(240);
    expect(r.nParallel).toBe(1);
    expect(r.auslastungPct).toBeCloseTo(1215.5 / 405 * 100, 4);
  });

  it('rechnet nParallel eines Bestandskabels in die Auslastung ein', () => {
    const r = nsKabelAuslegen({
      kt: NYY, I_A: 800, lengthM: 33, autoSized: false,
      crossSection: 240, nParallel: 3, kIz: 1, cosPhi: 0.95,
    });
    expect(r.ratedCurrentA).toBe(405 * 3);
    expect(r.auslastungPct).toBeCloseTo(800 / 1215 * 100, 4);
  });

  it('legt aus, wenn gar kein Querschnitt gesetzt ist — auch ohne autoSized', () => {
    const r = nsKabelAuslegen({ kt: NYY, I_A: 100, lengthM: 20, autoSized: false, crossSection: 0, cosPhi: 0.95 });
    expect(r.crossSection).toBe(25);
  });
});

describe('nsKabelAuslegen — Sicherung', () => {
  it('wählt die größte Normgröße ≤ Iz_eff', () => {
    const r = basis({ I_A: 100 });         // 25 mm², Iz 119, kIz 1
    expect(r.fuseA).toBe(100);
  });
  it('lässt eine gesetzte Sicherung unangetastet', () => {
    expect(basis({ I_A: 100, fuseA: 63 }).fuseA).toBe(63);
  });
});

describe('nsKabelAuslegen — verlaufsunabhängig (keine nParallel-Ratsche)', () => {
  const lang = { kt: NYY, lengthM: 740, autoSized: true, kIz: 1, tLeiter: 70, cosPhi: 0.95, U_V: 400, duBudgetPct: 3 };

  it('ignoriert die Strangzahl aus einem früheren Lauf', () => {
    const frisch  = nsKabelAuslegen({ ...lang, I_A: 160.4, nParallel: 1 });
    const geerbt  = nsKabelAuslegen({ ...lang, I_A: 160.4, nParallel: 8 });
    expect(geerbt.nParallel).toBe(frisch.nParallel);
    expect(geerbt.crossSection).toBe(frisch.crossSection);
    expect(geerbt.auslastungPct).toBeCloseTo(frisch.auslastungPct, 9);
  });

  it('liefert dasselbe Ergebnis, egal in welcher Reihenfolge Lastfälle gerechnet werden', () => {
    const direkt = nsKabelAuslegen({ ...lang, I_A: 160.4, nParallel: 1 });
    // erst Einspeisespitze rechnen, deren Ergebnis übernehmen, dann Schwachlast
    const spitze = nsKabelAuslegen({ ...lang, I_A: 1215.5, nParallel: 1 });
    const danach = nsKabelAuslegen({ ...lang, I_A: 160.4, nParallel: spitze.nParallel, crossSection: 0 });
    expect(danach.nParallel).toBe(direkt.nParallel);
    expect(danach.crossSection).toBe(direkt.crossSection);
  });

  it('meldet gedeckelt, wenn 8 Stränge das ΔU-Budget nicht halten', () => {
    const r = nsKabelAuslegen({ ...lang, I_A: 1215.5, nParallel: 1 });
    expect(r.nParallel).toBe(MAX_PARALLEL);
    expect(r.gedeckelt).toBe(true);
    expect(r.deltaUPct).toBeGreaterThan(3);
  });

  it('Bestandskabel (autoSized false) bleibt unverändert, auch bei Überlast', () => {
    const r = nsKabelAuslegen({ ...lang, I_A: 1215.5, autoSized: false, crossSection: 50, nParallel: 1 });
    expect(r.crossSection).toBe(50);
    expect(r.nParallel).toBe(1);
    expect(r.auslastungPct).toBeGreaterThan(100);
  });
});
