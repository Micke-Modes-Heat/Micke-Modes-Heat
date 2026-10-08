import { describe, it, expect, beforeAll } from 'vitest';
import { runInNewContext } from 'vm';
import { loadScript } from './load-script.js';

// Führt den echten Worker-Quelltext (wie im Browser) mit einem synthetischen Jahr aus.
beforeAll(() => {
  loadScript('config/netz-kosten.js');
  loadScript('config/erzeuger-cfg.js');
  loadScript('config/optimizer-defaults.js');
  loadScript('01-globals-varianten.js');
  globalThis.recalcNetz = () => {};
  globalThis.recalcStromNetz = () => {};
  globalThis.redrawErzeugerIcons = () => {};
  globalThis.calcStromPanel = () => {};
  globalThis.saSetTab = () => {};
  globalThis.saCurrentTab = 'lastgang';
  globalThis.gebaeude = [];
  globalThis.isExcluded = () => false;
  globalThis.getComputedStats = () => ({ waerme: 0, heizlast: 0 });
  globalThis.glLastgangKw = null;
  globalThis.thermSpeicherAktiv = false;
  if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
  loadScript('08-calc-engine.js');
  loadScript('06c-dispatch-core.js');
  loadScript('07b-analysis-economics.js');
  loadScript('lib/pv-battery-core.js');
  loadScript('lib/battery-aging.js');
  loadScript('lib/optimierer-suche.js');
  loadScript('10d-optimizer-worker.js');
});

function jahr() {
  const tempH = new Float32Array(8760), vlH = new Float32Array(8760), last = new Float32Array(8760);
  const pv = new Float32Array(8760), q = new Float32Array(8760);
  for (let t = 0; t < 8760; t++) {
    const d = Math.floor(t / 24), h = t % 24;
    tempH[t] = 9 - 11 * Math.cos(2 * Math.PI * (d - 15) / 365) + 3 * Math.sin(2 * Math.PI * (h - 9) / 24);
    vlH[t] = 70 - 0.6 * Math.max(0, tempH[t]);
    last[t] = Math.max(25, (17 - tempH[t]) * 32) + (h >= 6 && h <= 21 ? 40 : 15);
    const sonne = Math.max(0, Math.sin(Math.PI * (h - 6) / 13)) * (0.45 + 0.4 * Math.sin(2 * Math.PI * (d - 80) / 365));
    pv[t] = h >= 6 && h <= 19 ? Math.max(0, sonne) : 0;
    q[t] = 60 + (h >= 7 && h <= 18 ? 40 : 0);
  }
  let s = 0; for (let t = 0; t < 8760; t++) s += pv[t];
  for (let t = 0; t < 8760; t++) pv[t] /= s;   // normiert: Σ = 1 → × kWp × spez = Jahresertrag
  return { tempH, vlH, last, pv, q };
}

function dom(pvWp = false, pvInvest = 900) {
  const typen = {}; for (const [k, v] of Object.entries(ERZEUGER_CFG)) typen[k] = v.typ;
  return {
    bhkwSkz: 0.45, skEta: 0.99, lwwpMinCop: 0, geoDtAbsenkung: 0, geoTiefe: 100, geoQPerM: 31,
    tsDt: 40, tsVerlust: 0.5, tsEntladeKw: 200, tsLadeKw: 200, tsTyp: 'puffer',
    etaGk: 0.92, etaHko: 0.9, etaPk: 0.88, etaHhs: 0.85, etaBhkw: 0.88, pvSpez: 950, stSpez: 400,
    guetegrade: { lwwp: 0.42, fg: 0.56, geo: 0.5 }, investKurven: {}, pvWp, pvInvPerKwpPlan: pvInvest, batKw: 0,
    batInvest: 400, batCalendarFade: 1.5, batCycleLife: 6000, batEolPct: 80, batLife: 15,
    stromEmF: 363, gasEmF: 240, heizoelEmF: 310, pelletsEmF: 20, hhsEmF: 20, fernwaermeEmF: 180,
    pCo2: 0, co2Alle: true, bhkwGutschrift: false, verdraengungEf: 400,
    OPT_INVEST_DEFAULT: { ...OPT_INVEST_DEFAULT }, OPT_NUTZUNG: { ...OPT_NUTZUNG }, OPT_IH: { ...OPT_IH },
    ERZEUGER_TYP: typen, lohn: 45, bohrMeter: 0, nGeb: 0, netzInvest: 0, ohneNetz: false,
  };
}

function lauf({ aktiv, pvWp = false, pvInvest = 900, pvKwp = 0, mode = 'full', seeds, zusatzSeeds }) {
  const J = jahr();
  let peak = 0; for (const v of J.last) peak = Math.max(peak, v);
  const raum = optSuchraum({ aktiv, constraints: {}, jahr: 2026, peak, typen: dom().ERZEUGER_TYP, meritOrder: OPT_MERIT_ORDER });
  const kombis = raum.kombis.map(k => ({ ...k, punkte: optGrobPunkte(k.grenzen, optRasterStufen('schnell'), peak) }));
  const suche = { peak, backupMode: raum.backupMode, gasImplizit: raum.gasImplizit, kombis,
    pv: { lo: pvKwp, hi: pvKwp }, bat: { lo: 0, hi: 0 }, st: { lo: 0, hi: 0 }, ts: { lo: 0, hi: 0 },
    gasMaxKw: 0, minSchrittErz: Math.max(1, Math.round(peak * 0.005)), maxEvalFein: 250, anzahlFein: 4 };
  const msgs = [];
  const ctx = { self: { postMessage: m => msgs.push(m) }, Math, Float32Array, Map, Set, Number, Infinity, Object, Array, Date, isFinite, console };
  runInNewContext(_buildOptWorkerCode(), ctx);
  ctx.self.onmessage({ data: {
    mode, dom: dom(pvWp, pvInvest), suche, ziel: 'min-wgk', seeds, zusatzSeeds,
    params: { pStrom: 30, pStromWp: 25, pGas: 9, pPk: 7, pHhs: 5, pHko: 10, pFw: 15, pBhkwEinsp: 8, pBhkwKwkE: 8, pBhkwKwkEig: 4, zinssatz: 0.035 },
    lastgangKw: J.last, tempH: J.tempH, vlH: J.vlH, pvProfile: J.pv, stNormProfile: null, quartierH: J.q,
  } });
  return { done: msgs.find(m => m.type === 'done'), raum, peak };
}

describe('Optimierer-Worker: vollständiger Lauf', () => {
  it('jedes Anlagenkonzept nur einmal, Gaskessel nie doppelt', () => {
    const { done } = lauf({ aktiv: ['lwwp', 'gaskessel', 'pellets'] });
    const kanons = done.topFein.map(r => r.kanon);
    expect(new Set(kanons).size).toBe(kanons.length);
    expect(kanons.filter(k => k === 'gaskessel+lwwp').length).toBeLessThanOrEqual(1);
    // explizite Erzeuger enthalten nie den Gaskessel — er ist der Spitzenlastkessel
    for (const r of done.topFein) expect(r.config.some(c => c.key === 'gaskessel')).toBe(false);
  }, 60000);

  it('Feinsuche ist nie schlechter als der beste Grobpunkt ihres Konzepts', () => {
    const { done } = lauf({ aktiv: ['lwwp', 'gaskessel'] });
    for (const r of done.topFein) {
      const grob = Math.min(...done.grobResults.filter(g => g.kanon === r.kanon).map(g => g.score));
      expect(r.score).toBeLessThanOrEqual(grob + 1e-9);
    }
  }, 60000);

  it('Ausgangsplanung als Startpunkt: Ergebnis mindestens so gut wie die Planung', () => {
    const { done } = lauf({ aktiv: ['lwwp', 'gaskessel'], mode: 'fein',
      seeds: [{ keys: ['lwwp'], x: [173, 37, 0, 0, 0], kanon: null, ausgangsplanung: true }] });
    const r = done.topFein[0];
    expect(r.ausgangsplanung).toBe(true);
    expect(r.start.x).toEqual([173, 37, 0, 0, 0]);
    expect(r.score).toBeLessThanOrEqual(r.start.score);
  }, 60000);

  it('PV wird nicht dimensioniert: ohne Schalter bleibt sie außen vor', () => {
    const { done } = lauf({ aktiv: ['lwwp', 'gaskessel'], pvKwp: 400, pvWp: false });
    for (const r of done.topFein) expect(r.kw.pvZuWpMwh || 0).toBe(0);
    const ohne = lauf({ aktiv: ['lwwp', 'gaskessel'] }).done.topFein;
    const best = l => l.slice().sort((x, y) => x.score - y.score)[0];
    expect(best(done.topFein).kw.wgk).toBeCloseTo(best(ohne).kw.wgk, 6);
  }, 60000);

  it('mit Schalter: PV der Planung senkt die WGK, höchstens um (WP-Preis − PV-Preis) × PV-Strom an WP', () => {
    const seed = [{ keys: ['lwwp'], x: [400, 400, 0, 0, 0], kanon: null }];
    const mit = lauf({ aktiv: ['lwwp', 'gaskessel'], pvKwp: 400, pvWp: true, mode: 'fein', seeds: seed }).done.topFein[0];
    const ohne = lauf({ aktiv: ['lwwp', 'gaskessel'], pvKwp: 400, pvWp: false, mode: 'fein', seeds: seed }).done.topFein[0];
    expect(mit.pvKwp).toBe(400);
    expect(mit.kw.pvZuWpMwh).toBeGreaterThan(0);
    expect(mit.kw.wgk).toBeLessThan(ohne.kw.wgk);
    const vorteilEur = (ohne.kw.wgk - mit.kw.wgk) * 10 * mit.gesamtMwh;
    expect(vorteilEur).toBeLessThanOrEqual(mit.kw.pvZuWpMwh * (25 - mit.kw.pvCt) * 10 * 1.5 + 1);
    expect(ohne.kw.wgk - mit.kw.wgk).toBeLessThan(2);
  }, 60000);
});
