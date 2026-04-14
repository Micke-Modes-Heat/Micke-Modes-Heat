import { describe, it, expect, beforeAll } from 'vitest';
import { loadScript } from './load-script.js';

beforeAll(() => {
  // performance.now() wird von CalcEngine.run() genutzt
  if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
  loadScript('08-calc-engine.js');
});

describe('CalcEngine.quellenTemp', () => {
  it('Luft-WP: Quelltemperatur = Außentemperatur', () => {
    const tempH = new Float32Array(24);
    for (let i = 0; i < 24; i++) tempH[i] = 5 + i * 0.5;
    const tq = CalcEngine.quellenTemp('Luft', tempH);
    expect(tq.length).toBe(24);
    for (let i = 0; i < 24; i++) {
      expect(tq[i]).toBeCloseTo(tempH[i], 4);
    }
  });

  it('Geothermie: Quelltemperatur ca. 10°C mit ±2K Swing', () => {
    const tempH = new Float32Array(8760).fill(0);
    const tq = CalcEngine.quellenTemp('Geothermie', tempH);
    expect(tq.length).toBe(8760);
    for (let i = 0; i < 8760; i++) {
      expect(tq[i]).toBeGreaterThan(7);
      expect(tq[i]).toBeLessThan(13);
    }
    let sum = 0;
    for (let i = 0; i < 8760; i++) sum += tq[i];
    expect(sum / 8760).toBeCloseTo(10, 0);
  });

  it('Fließgewässer: saisonal, Minimum > 0.5°C', () => {
    const tempH = new Float32Array(8760).fill(0);
    const tq = CalcEngine.quellenTemp('Fließgewässer', tempH);
    for (let i = 0; i < 8760; i++) {
      expect(tq[i]).toBeGreaterThanOrEqual(0.5);
      expect(tq[i]).toBeLessThan(20);
    }
  });

  it('Fließgewässer: Sommer wärmer als Winter', () => {
    const tempH = new Float32Array(8760).fill(0);
    const tq = CalcEngine.quellenTemp('Fließgewässer', tempH);
    const winter = tq[12];
    const sommer = tq[4392];
    expect(sommer).toBeGreaterThan(winter);
  });
});

describe('CalcEngine.run — Lastgang-Synthese', () => {
  function makeTempH() {
    const tempH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = i / 24;
      tempH[i] = 8 - 10 * Math.cos(2 * Math.PI * (d - 15) / 365);
    }
    return tempH;
  }

  it('erzeugt 8760-Stunden-Lastgang', async () => {
    const st = await CalcEngine.run({
      tempH: makeTempH(),
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 2.0,
    });

    expect(st.lastgangMwhH).toBeInstanceOf(Float32Array);
    expect(st.lastgangMwhH.length).toBe(8760);
  });

  it('Gesamtenergie stimmt überein', async () => {
    const st = await CalcEngine.run({
      tempH: makeTempH(),
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 5.0,
    });

    let sum = 0;
    for (let i = 0; i < 8760; i++) sum += st.lastgangMwhH[i];
    expect(sum).toBeCloseTo(5.0, 1);
  });

  it('Winter hat höheren Verbrauch als Sommer', async () => {
    const st = await CalcEngine.run({
      tempH: makeTempH(),
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 10.0,
    });

    let sumJan = 0;
    for (let i = 0; i < 744; i++) sumJan += st.lastgangMwhH[i];
    let sumJul = 0;
    for (let i = 4344; i < 4344 + 744; i++) sumJul += st.lastgangMwhH[i];
    expect(sumJan).toBeGreaterThan(sumJul);
  });

  it('keine negativen Werte im Lastgang', async () => {
    const st = await CalcEngine.run({
      tempH: makeTempH(),
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 5.0,
    });

    for (let i = 0; i < 8760; i++) {
      expect(st.lastgangMwhH[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('verschiedene SigLinDe-Profile erzeugen unterschiedliche Lastgänge', async () => {
    const tempH = makeTempH();
    const st1 = await CalcEngine.run({ tempH: new Float32Array(tempH), sigProfil1: 'HEF34', gesamtenergieMwh: 10.0 });
    const st2 = await CalcEngine.run({ tempH: new Float32Array(tempH), sigProfil1: 'GKO34', gesamtenergieMwh: 10.0 });

    let diffSum = 0;
    for (let i = 0; i < 8760; i++) diffSum += Math.abs(st1.lastgangMwhH[i] - st2.lastgangMwhH[i]);
    expect(diffSum).toBeGreaterThan(0.1);
  });
});

describe('CalcEngine.run — Analyse', () => {
  it('berechnet Spitzenlast, Gesamtenergie und Tmin', async () => {
    const tempH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = i / 24;
      tempH[i] = 8 - 10 * Math.cos(2 * Math.PI * (d - 15) / 365);
    }

    const st = await CalcEngine.run({
      tempH,
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 10.0,
    });

    expect(st.gesamtMwh).toBeCloseTo(10.0, 1);
    expect(st.pMaxKw).toBeGreaterThan(0);
    expect(st.tMin).toBeLessThan(0);
    expect(st.p65Kw).toBeLessThan(st.pMaxKw);
    expect(st.p90Kw).toBeLessThan(st.pMaxKw);
    expect(st.p65Kw).toBeLessThan(st.p90Kw);
  });

  it('Jahresdauerlinie ist absteigend sortiert', async () => {
    const tempH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = i / 24;
      tempH[i] = 8 - 10 * Math.cos(2 * Math.PI * (d - 15) / 365);
    }

    const st = await CalcEngine.run({
      tempH,
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 5.0,
    });

    expect(st.jahresdauerlinie).toBeDefined();
    expect(st.jahresdauerlinie.length).toBe(8760);
    for (let i = 1; i < 8760; i++) {
      expect(st.jahresdauerlinie[i]).toBeLessThanOrEqual(st.jahresdauerlinie[i - 1]);
    }
  });
});

describe('CalcEngine.run — Vorlaufprofil', () => {
  it('VL-Profil wird aus Heizgrenze berechnet', async () => {
    const tempH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = i / 24;
      tempH[i] = 8 - 10 * Math.cos(2 * Math.PI * (d - 15) / 365);
    }

    const st = await CalcEngine.run({
      tempH,
      vlMinus5: 70,
      vl15: 35,
      sigProfil1: 'HEF34',
      gesamtenergieMwh: 1.0,
    });

    expect(st.vlH).toBeDefined();
    expect(st.vlH.length).toBe(8760);
    // Alle Werte zwischen 35 und 70
    for (let i = 0; i < 8760; i++) {
      expect(st.vlH[i]).toBeGreaterThanOrEqual(35);
      expect(st.vlH[i]).toBeLessThanOrEqual(70);
    }
  });
});

describe('CalcEngine.findKaeltesteWoche', () => {
  it('findet die kälteste 168h-Periode', () => {
    const tempH = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) {
      const d = i / 24;
      tempH[i] = 8 - 10 * Math.cos(2 * Math.PI * (d - 15) / 365);
    }
    const start = CalcEngine.findKaeltesteWoche(tempH);
    // Kälteste Woche sollte um Tag 15 herum sein (Januar)
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(8760 - 168);
    // Kälteste Woche im Winter (Tag 0-90 oder 330-365)
    const day = Math.floor(start / 24);
    expect(day < 90 || day > 330).toBe(true);
  });
});

describe('CalcEngine.buildJahresdauerlinie', () => {
  it('sortiert absteigend', () => {
    const st = { lastgangMwhH: new Float32Array([5, 2, 8, 1, 4, 9, 3, 7, 6]) };
    CalcEngine.buildJahresdauerlinie(st);
    expect(st.jahresdauerlinie[0]).toBe(9);
    expect(st.jahresdauerlinie[st.jahresdauerlinie.length - 1]).toBe(1);
  });
});
