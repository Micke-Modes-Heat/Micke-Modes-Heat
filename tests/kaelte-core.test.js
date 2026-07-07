import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  // Gestripptes "import { DAYS_PER_YEAR }" → global bereitstellen
  globalThis.DAYS_PER_YEAR = 365;
  loadScript('06d-kaelte-core.js');
});

describe('calcEER', () => {
  it('Referenzpunkt A35/W7 mit η=0.4 → EER ≈ 4.0', () => {
    expect(calcEER(7, 35, 0.4)).toBeCloseTo(4.0, 1);
  });

  it('kühlere Rückkühlung → höherer EER (vor Cap)', () => {
    const warm = calcEER(7, 35, 0.4);
    const kuehl = calcEER(7, 25, 0.4);
    expect(kuehl).toBeGreaterThan(warm);
  });

  it('Cap begrenzt EER bei sehr kleinem Temperaturhub', () => {
    // tKw=7, tRw=12 → Carnot riesig, muss auf cap=10 begrenzt werden
    expect(calcEER(7, 12, 0.4)).toBe(10);
  });

  it('eerRef entspricht calcEER bei A35/W7', () => {
    expect(eerRef(0.4)).toBeCloseTo(calcEER(7, 35, 0.4, Infinity), 4);
  });
});

describe('_rueckkuehlTemp', () => {
  it('luftgekühlt = Außentemperatur + Approach', () => {
    expect(_rueckkuehlTemp('luft', 'luft', 30, 0, 5)).toBeCloseTo(35, 4);
  });
  it('quelle (geo) ≈ 10 °C unabhängig von der Außentemperatur', () => {
    const v = _rueckkuehlTemp('quelle', 'geo', 35, 4000, 0);
    expect(v).toBeGreaterThan(7);
    expect(v).toBeLessThan(13);
  });
});

describe('synthKaelteLastgang', () => {
  it('Summe = vorgegebene Jahresmenge', () => {
    const tempH = new Float32Array(8760).fill(25); // dauerhaft warm
    const lg = synthKaelteLastgang(tempH, 12, 100); // 100 MWh/a
    let s = 0; for (let i = 0; i < lg.length; i++) s += lg[i];
    expect(s).toBeCloseTo(100000, 0); // kWh
  });

  it('kein Kühlbedarf wenn dauerhaft unter Kühlgrenze', () => {
    const tempH = new Float32Array(8760).fill(5);
    const lg = synthKaelteLastgang(tempH, 12, 100);
    let s = 0; for (let i = 0; i < lg.length; i++) s += lg[i];
    expect(s).toBe(0);
  });

  it('Nachmittags-Peak: 15 Uhr > 3 Uhr', () => {
    const tempH = new Float32Array(48).fill(25);
    const lg = synthKaelteLastgang(tempH, 12, 1);
    expect(lg[15]).toBeGreaterThan(lg[3]);
  });
});

describe('kaelteDispatch8760', () => {
  function warmerSommer() {
    // Sinus-Tagesgang, Sommer warm: Mittel ~28 °C im Juli, ~2 °C im Januar
    const t = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = Math.floor(i / 24), h = i % 24;
      const saison = 15 + 13 * Math.sin(2 * Math.PI * (d - 119) / 365);
      t[i] = saison + 5 * Math.sin(2 * Math.PI * (h - 9) / 24);
    }
    return t;
  }

  it('Energiebilanz: gedeckte Kälte + Rest = Last, SEER = K/Strom', () => {
    const tempH = warmerSommer();
    const lastKw = synthKaelteLastgang(tempH, 12, 200); // 200 MWh/a
    const erzList = [{
      key: 'revwp', art: 'reversibel', leistKw: 500, guetegradK: 0.38,
      rueckkuehlModus: 'luft', quelleKey: 'luft', approachLuft: 0,
    }];
    const r = kaelteDispatch8760({ lastKw, tempH, tKwC: 7, erzList, recordHourly: false });
    let lastSum = 0; for (let i = 0; i < lastKw.length; i++) lastSum += lastKw[i];
    expect(r.kaelteTotKwh + r.restKwh).toBeCloseTo(lastSum, 0);
    expect(r.seerGesamt).toBeCloseTo(r.kaelteTotKwh / r.stromTotKwh, 4);
    expect(r.seerGesamt).toBeGreaterThan(2.5); // luftgekühlte Klimakälte realistisch
    expect(r.seerGesamt).toBeLessThan(7);
  });

  it('Merit-Order: erster Erzeuger deckt zuerst, zweiter füllt Spitzen', () => {
    const tempH = warmerSommer();
    const lastKw = synthKaelteLastgang(tempH, 12, 200);
    const erzList = [
      { key: 'a', art: 'reversibel', leistKw: 50, guetegradK: 0.38, rueckkuehlModus: 'luft', quelleKey: 'luft' },
      { key: 'b', art: 'chiller', leistKw: 1000, guetegradK: 0.40, rueckkuehlModus: 'luft', quelleKey: 'luft' },
    ];
    const r = kaelteDispatch8760({ lastKw, tempH, tKwC: 7, erzList, recordHourly: false });
    // a (50 kW) trägt die Grundlast über viele Stunden, b (1000 kW) füllt die Spitzen
    expect(r.kaelteKwh['a']).toBeGreaterThan(0);
    expect(r.kaelteKwh['b']).toBeGreaterThan(0);
    expect(r.restKwh).toBeCloseTo(0, 0); // b ist groß genug → keine Lücke
    // a wird durch seine (gederateten) ~50 kW begrenzt: kann nie die volle Last decken
    let lastSum = 0; for (let i = 0; i < lastKw.length; i++) lastSum += lastKw[i];
    expect(r.kaelteKwh['a']).toBeLessThan(lastSum);
  });

  it('Freie Kühlung: Hochtemperatur-Kälte (16 °C) aus Erdsonde nutzt Pumpenstrom', () => {
    const tempH = warmerSommer();
    const lastKw = synthKaelteLastgang(tempH, 12, 100);
    const erzList = [{
      key: 'geo', art: 'chiller', leistKw: 2000, guetegradK: 0.45,
      rueckkuehlModus: 'quelle', quelleKey: 'geo',
      freecool: true, freecoolDtMin: 2, eerFreecool: 20,
    }];
    const r = kaelteDispatch8760({ lastKw, tempH, tKwC: 16, erzList, recordHourly: false });
    expect(r.freecoolKwh['geo']).toBeGreaterThan(0);     // Erdsonde 10 °C < 16−2 → freie Kühlung greift
    expect(r.seerGesamt).toBeGreaterThan(10);            // dank freier Kühlung sehr effizient
  });

  it('Monats-EER: Sommer-Monate haben definierten EER, Winter 0 (kein Bedarf)', () => {
    const tempH = warmerSommer();
    const lastKw = synthKaelteLastgang(tempH, 12, 200);
    const erzList = [{ key: 'a', art: 'reversibel', leistKw: 500, guetegradK: 0.38, rueckkuehlModus: 'luft', quelleKey: 'luft' }];
    const r = kaelteDispatch8760({ lastKw, tempH, tKwC: 7, erzList, recordHourly: false });
    expect(r.monthlyEer[6]).toBeGreaterThan(0); // Juli
    expect(r.monthlyEer[0]).toBe(0);            // Januar kein Bedarf → 0
  });
});
