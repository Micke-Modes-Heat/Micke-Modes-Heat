// Vitest-Tests für lib/autarkie-h2-core.js — Autarkieziel (Mindestdeckung je Stunde)
// mit Batterie und Wasserstoffkette.
import { describe, it, expect } from 'vitest';
import {
  AH2_STANDARD, H2_KWH_PRO_KG, ah2AnnF, ah2Mischen, ah2MonatVonStunde, ah2BatDispatch, ah2BzLeistung,
  ah2TankBedarf, ah2ElyMin, ah2Bilanz, ah2H2Auslegen, ah2Optimieren, ah2Simulieren, ah2OhneH2, ah2Zielkurve, ah2ZielKosten, ah2BhkwGrenzkosten, AH2_BRENNSTOFFE, ah2Nachweis,
} from '../src/lib/autarkie-h2-core.js';

const N = 8760;
const summe = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

/** Konstante Last 100 kW, PV nur tagsüber 8–16 Uhr mit Sommerbetonung (kW/kWp). */
function jahr({ sommerFaktor = 1, winterFaktor = 0.3 } = {}) {
  const last = new Float32Array(N).fill(100);
  const pv = new Float32Array(N);
  for (let t = 0; t < N; t++) {
    const h = t % 24, tag = Math.floor(t / 24);
    const saison = winterFaktor + (sommerFaktor - winterFaktor) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (tag - 10) / 365));
    if (h >= 8 && h < 16) pv[t] = 0.7 * saison * Math.sin(Math.PI * (h - 8 + 0.5) / 8);
  }
  return { last, pvKwProKwp: pv, windKw: null };
}

describe('Grundfunktionen', () => {
  it('Annuität und Mischen', () => {
    expect(ah2AnnF(0, 20)).toBeCloseTo(0.05);
    expect(ah2AnnF(0.035, 20)).toBeCloseTo(0.07036, 4);
    const c = ah2Mischen({ zielPct: 140, ely: { eta: 0.55, quatsch: 3 }, toleranzH: 2.6 });
    expect(c.zielPct).toBe(100);
    expect(c.ely.eta).toBe(0.55);
    expect(c.ely.quatsch).toBeUndefined();
    expect(c.bz.eta).toBe(AH2_STANDARD.bz.eta);
    expect(c.toleranzH).toBe(3);
  });

  it('Monatsindex', () => {
    expect(ah2MonatVonStunde(0)).toBe(0);
    expect(ah2MonatVonStunde(31 * 24)).toBe(1);
    expect(ah2MonatVonStunde(8759)).toBe(11);
  });

  it('Brennstoffzelle ohne die schlechtesten Stunden', () => {
    const r = new Float32Array([0, 50, 10, 30, 0]);
    expect(ah2BzLeistung(r, 0)).toBe(50);
    expect(ah2BzLeistung(r, 1)).toBe(30);
    expect(ah2BzLeistung(r, 3)).toBe(0);
  });

  it('Tank = größter zyklischer Fehlbetrag, auch über den Jahreswechsel', () => {
    // +10 in der Mitte, −5 am Anfang und Ende → Fehlbetrag über den Wechsel = 10
    const prod = new Float32Array([0, 0, 10, 0, 0]);
    const verbr = new Float32Array([5, 0, 0, 0, 5]);
    expect(ah2TankBedarf(prod, verbr).kapKwh).toBeCloseTo(10);
    expect(ah2TankBedarf(new Float32Array([1]), new Float32Array([2])).kapKwh).toBe(Infinity);
  });

  it('Mindest-Elektrolyseur schließt die Jahresbilanz', () => {
    const ueber = new Float32Array([100, 100, 0, 0]);
    const p = ah2ElyMin(ueber, 60, 0.6);  // 2 h × P × 0,6 ≥ 60 → P ≥ 50
    expect(p).toBeGreaterThanOrEqual(50);
    expect(p).toBeLessThan(50.5);
    expect(ah2ElyMin(ueber, 1000, 0.6)).toBe(Infinity);
  });
});

describe('Batterie-Dispatch', () => {
  it('Energie bleibt erhalten', () => {
    const inp = jahr();
    const d = ah2BatDispatch(inp, { pvKwp: 400, batKwh: 500, batReserve: 0, ziel: 0.3 }, AH2_STANDARD.bat);
    expect(d.direktKwh + d.batEntlKwh + summe(d.lastRest)).toBeCloseTo(d.lastKwh, -1);
    // Erzeugung = Direkt + Laden + Überschuss
    expect(d.direktKwh + d.batLadKwh + summe(d.ueber)).toBeCloseTo(d.erzKwh, -1);
  });

  it('Reserve 1 hält die Batterie für das Ziel zurück', () => {
    const inp = jahr();
    const ev = ah2BatDispatch(inp, { pvKwp: 400, batKwh: 400, batReserve: 0, ziel: 0.3 }, AH2_STANDARD.bat);
    const zi = ah2BatDispatch(inp, { pvKwp: 400, batKwh: 400, batReserve: 1, ziel: 0.3 }, AH2_STANDARD.bat);
    expect(summe(zi.zielRest)).toBeLessThan(summe(ev.zielRest));
    expect(zi.batEntlKwh).toBeLessThanOrEqual(ev.batEntlKwh + 1);
  });
});

describe('Wasserstoffkette', () => {
  it('ohne Batterie deckt die Brennstoffzelle jede Nacht das Ziel', () => {
    const inp = jahr();
    const cfg = ah2Mischen({ zielPct: 30 });
    const d = ah2BatDispatch(inp, { pvKwp: 2500, batKwh: 0, ziel: 0.3 }, cfg.bat);
    const h2 = ah2H2Auslegen(d, cfg);
    expect(h2.machbar).toBe(true);
    expect(h2.bzKw).toBeCloseTo(30, 3);             // 30 % von 100 kW in der Nacht
    expect(h2.tankKwh).toBeGreaterThan(0);
    const bil = ah2Bilanz(d, h2, cfg, { exakt: true });
    expect(bil.stundenUnter).toBe(0);
    // H2-Bilanz im zyklischen Betrieb geschlossen: Erzeugung ≥ Verbrauch
    expect(bil.h2ProdMwh).toBeGreaterThanOrEqual(bil.h2VerbrMwh - 1e-3);
    expect(bil.autarkiePct).toBeGreaterThanOrEqual(30 - 1e-6);
  });

  it('saisonal: schwacher Winter braucht einen deutlich größeren Tank', () => {
    const cfg = ah2Mischen({ zielPct: 30 });
    const aus = (inp) => ah2H2Auslegen(ah2BatDispatch(inp, { pvKwp: 5000, batKwh: 0, ziel: 0.3 }, cfg.bat), cfg);
    const gleich = aus(jahr({ winterFaktor: 1 }));
    const saison = aus(jahr({ winterFaktor: 0.05 }));
    expect(saison.machbar).toBe(true);
    expect(saison.tankKwh).toBeGreaterThan(gleich.tankKwh * 5);
  });

  it('zu wenig Überschuss → nicht machbar', () => {
    const cfg = ah2Mischen({ zielPct: 60 });
    const d = ah2BatDispatch(jahr(), { pvKwp: 100, batKwh: 0, ziel: 0.6 }, cfg.bat);
    const h2 = ah2H2Auslegen(d, cfg);
    expect(h2.machbar).toBe(false);
    expect(h2.fehltH2Mwh).toBeGreaterThan(0);
  });
});

describe('Optimierung', () => {
  const inp = { ...jahr(), pvMaxKwp: 4000, napEinspKw: null };

  it('erfüllt das Ziel in jeder Stunde und rechnet schnell', () => {
    const t0 = performance.now();
    const r = ah2Optimieren(inp, { zielPct: 30 });
    const ms = performance.now() - t0;
    expect(r.machbar).toBe(true);
    const b = r.best;
    expect(b.bilanz.stundenUnter).toBe(0);
    expect(b.minDeckungPct).toBeGreaterThanOrEqual(30 - 0.1);
    expect(b.kosten.gesamt).toBeGreaterThan(0);
    expect(b.ausl.tankKg).toBeCloseTo(b.ausl.tankKwh / H2_KWH_PRO_KG);
    expect(b.monate).toHaveLength(12);
    expect(ms).toBeLessThan(8000);
  });

  it('Ziel 0 braucht keinen Wasserstoff', () => {
    const r = ah2Optimieren(inp, { zielPct: 0 });
    expect(r.machbar).toBe(true);
    expect(r.best.ausl.bzKw).toBe(0);
    expect(r.best.ausl.tankKwh).toBe(0);
  });

  it('Toleranzstunden verkleinern die Brennstoffzelle nicht über das Ziel hinaus', () => {
    const streng = ah2Optimieren(inp, { zielPct: 30 }).best;
    const tol = ah2Optimieren(inp, { zielPct: 30, toleranzH: 200 }).best;
    expect(tol.bilanz.stundenUnter).toBeLessThanOrEqual(200);
    expect(tol.kosten.gesamt).toBeLessThanOrEqual(streng.kosten.gesamt + 1);
  });

  it('ohne PV-Potenzial nicht machbar', () => {
    const r = ah2Optimieren({ ...inp, pvMaxKwp: 0 }, { zielPct: 30 });
    expect(r.machbar).toBe(false);
    expect(r.grund).toMatch(/PV/);
  });

  it('Referenz ohne H2 verfehlt das Ziel, Simulation mit H2 nicht', () => {
    const b = ah2Optimieren(inp, { zielPct: 30 }).best;
    const ohne = ah2OhneH2(inp, b.ausl, { zielPct: 30 });
    if (b.ausl.bzKw > 0) expect(ohne.stundenUnter).toBeGreaterThan(0);
    const nach = ah2Simulieren(inp, b.ausl, { zielPct: 30 });
    expect(nach.bilanz.stundenUnter).toBe(0);
  });

  it('Zielkurve: Kosten steigen mit dem Ziel', () => {
    const k = ah2Zielkurve(inp, {}, [0, 20, 40]);
    expect(k.every(p => p.machbar)).toBe(true);
    expect(k[2].kostenJk).toBeGreaterThan(k[0].kostenJk);
  });
});

describe('Kosten des Ziels und Stundenreihen', () => {
  const inp = { ...jahr(), pvMaxKwp: 4000, napEinspKw: null };

  it('Stundenreihen schließen die Bilanz je Stunde', () => {
    const b = ah2Optimieren(inp, { zielPct: 30 }).best;
    const R = b.bilanz.reihen;
    for (const t of [0, 3000, 4500, 8000]) {
      const L = inp.last[t];
      // Last = Direkt + Batterie + Brennstoffzelle + Netz
      expect(b.direkt[t] + b.batEntl[t] + R.bz[t] + R.netz[t]).toBeCloseTo(L, 2);
      expect(R.einsp[t] + R.abreg[t] + R.ely[t]).toBeGreaterThanOrEqual(0);
    }
    expect(summe(b.batLad)).toBeGreaterThan(0);
  });

  it('Preis des Ziels gegenüber der Auslegung ohne Ziel', () => {
    const mit = ah2Optimieren(inp, { zielPct: 30 }).best;
    const ohne = ah2Optimieren(inp, { zielPct: 0 }).best;
    const zk = ah2ZielKosten(mit, ohne, 100);
    expect(zk.dJk).toBeCloseTo(mit.kosten.gesamt - ohne.kosten.gesamt, 3);
    const summePosten = Object.values(zk.posten).reduce((a, x) => a + x, 0);
    expect(summePosten).toBeCloseTo(zk.dJk, 0);
    expect(zk.gesichertKw).toBeCloseTo(30);
    expect(zk.eurJeProzentpunkt).toBeCloseTo(zk.dJk / 30);
    if (zk.speicherKwh > 0) expect(zk.ctJeSpeicherKwh).toBeCloseTo(zk.dJk / zk.speicherKwh * 100);
  });
});

describe('Tank-Obergrenze und BHKW', () => {
  const inp = { ...jahr({ winterFaktor: 0.1 }), pvMaxKwp: 4000, napEinspKw: null };

  it('Brennstoff-Vorlage setzt Preis und Wirkungsgrade, eigene Werte gehen vor', () => {
    const c = ah2Mischen({ bhkwBrennstoff: 'hvo', bhkw: { etaEl: 0.42 } });
    expect(c.bhkw.brennstoffCt).toBe(AH2_BRENNSTOFFE.hvo.brennstoffCt);
    expect(c.bhkw.etaEl).toBe(0.42);
    expect(ah2BhkwGrenzkosten(c)).toBeCloseTo(20 / 0.42 + 2, 5);
  });

  it('Obergrenze wird eingehalten oder das Ziel gilt als nicht machbar', () => {
    const frei = ah2Optimieren(inp, { zielPct: 30 }).best;
    const grenzeKg = Math.round(frei.ausl.tankKg * 0.4);
    const r = ah2Optimieren(inp, { zielPct: 30, tankMaxKg: grenzeKg });
    if (r.machbar) {
      expect(r.best.ausl.tankKg).toBeLessThanOrEqual(grenzeKg + 1e-6);
      expect(r.best.bilanz.stundenUnter).toBe(0);
      expect(r.best.kosten.gesamt).toBeGreaterThanOrEqual(frei.kosten.gesamt - 1);
    } else {
      expect(r.grund).toMatch(/Obergrenze/);
    }
  });

  it('nur BHKW erfüllt das Ziel ohne Wasserstoff', () => {
    const r = ah2Optimieren(inp, { zielPct: 30, h2Aktiv: false, bhkwAktiv: true });
    expect(r.machbar).toBe(true);
    const b = r.best;
    expect(b.ausl.tankKwh).toBe(0);
    expect(b.ausl.bhkwKw).toBeGreaterThan(0);
    expect(b.bilanz.stundenUnter).toBe(0);
    expect(b.kosten.brennstoff).toBeGreaterThan(0);
    // Brennstoff = Strom ÷ η_el
    expect(b.bilanz.bhkwBrennstoffMwh).toBeCloseTo(b.bilanz.bhkwMwh / 0.38, 3);
  });

  it('mit beiden Optionen: alle Varianten verglichen, die günstigste gewinnt', () => {
    const r = ah2Optimieren(inp, { zielPct: 30, bhkwAktiv: true, tankMaxKg: 2990 });
    expect(r.machbar).toBe(true);
    const v = r.varianten;
    expect(v.bhkw).toBeDefined();
    for (const x of Object.values(v)) {
      expect(x.bilanz.stundenUnter).toBe(0);
      expect(x.ausl.tankKg).toBeLessThanOrEqual(2990 + 1e-6);
      expect(r.best.kosten.gesamt).toBeLessThanOrEqual(x.kosten.gesamt + 1e-6);
    }
    if (v.kombi) {
      expect(v.kombi.ausl.bhkwKw).toBeGreaterThan(0);
      expect(v.kombi.ausl.tankKwh).toBeGreaterThan(0);
    }
  });

  it('BHKW läuft bei günstigem Brennstoff und Wärmegutschrift auch außerhalb der Zielstunden', () => {
    const basis = { zielPct: 30, h2Aktiv: false, bhkwAktiv: true };
    const nurZiel = ah2Optimieren(inp, basis).best;
    const a = nurZiel.ausl;
    const voll = ah2Simulieren(inp, a, { ...basis, bhkw: { brennstoffCt: 5 }, preise: { pWaerme: 8 } });
    expect(nurZiel.bilanz.bhkwVoll).toBe(false);
    expect(voll.bilanz.bhkwVoll).toBe(true);
    expect(voll.bilanz.bhkwMwh).toBeGreaterThan(nurZiel.bilanz.bhkwMwh);
    expect(voll.bilanz.netzMwh).toBeLessThan(nurZiel.bilanz.netzMwh);
  });
});

describe('Auslegungsnachweis', () => {
  it('nennt die bestimmende Stunde und die Entnahmephase', () => {
    const inp = { ...jahr({ winterFaktor: 0.1 }), pvMaxKwp: 4000, napEinspKw: null };
    const r = ah2Optimieren(inp, { zielPct: 30 }).best;
    const n = ah2Nachweis(inp, r, { zielPct: 30 });
    expect(n.bz.kw).toBeCloseTo(r.ausl.bzKw, 3);
    // In der bestimmenden Stunde: Ziel = Direkt + Batterie + BZ
    expect(n.bz.direkt + n.bz.bat + n.bz.bz).toBeCloseTo(n.bz.ziel, 1);
    expect(n.tank.entnahmeKwh).toBeGreaterThan(n.tank.kwh * 0.9);
    expect(n.tank.dauerH).toBeGreaterThan(24 * 30);        // saisonal: über einen Monat
    expect(n.ely.minKw).toBeLessThanOrEqual(n.ely.kw + 1e-6);
  });
});
