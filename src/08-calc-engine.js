import { _getEtaMap } from './01-globals-varianten.js';
import { redrawErzeugerIcons } from './03a-erzeuger.js';
import { glInit } from './06a-gbi-lastgang.js';
import { DA_LABELS, _daColor } from './07a-analysis-charts.js';

export const CalcEngine = (() => {
  'use strict';

  // ── Konstanten ────────────────────────────────────────────────────────────
  const THETA_0 = 40.0;

  const SCHABLONE_24H = [
    0.84, 0.93, 1.02, 1.11, 1.13, 1.16, 1.22, 1.23,
    1.22, 1.21, 1.17, 1.14, 1.12, 1.10, 1.06, 1.00,
    0.93, 0.89, 0.82, 0.78, 0.73, 0.72, 0.71, 0.76
  ];

  // SigLinDe-Parameter (BDEW, Ausprägungen 33 + 34, alle 14 Profiltypen)
  const SIGLINDE = {
    HEF33:{A:1.6209544,B:-37.1833141,C:5.6727847,D:0.0716431,mh:-0.04957,bh:0.8401015,mw:-0.002209,bw:0.1074468},
    HMF33:{A:1.2328655,B:-34.7213605,C:5.8164304,D:0.0873352,mh:-0.0409284,bh:0.767292,mw:-0.002232,bw:0.1199207},
    GMK33:{A:1.4202419,B:-34.880613,C:6.5951899,D:0.0385317,mh:-0.0521084,bh:0.8647919,mw:-0.0014369,bw:0.0637602},
    GHA33:{A:1.9724775,B:-36.9650065,C:7.2256947,D:0.0345782,mh:-0.0742174,bh:1.0448869,mw:-0.0008295,bw:0.0461795},
    GKO33:{A:1.3554515,B:-35.1412563,C:7.1303395,D:0.0990619,mh:-0.0526487,bh:0.8626086,mw:-0.0008808,bw:0.0964014},
    GBD33:{A:1.4633682,B:-36.1794117,C:5.9265162,D:0.0808835,mh:-0.04758,bh:0.8230754,mw:-0.0019273,bw:0.1077046},
    GGA33:{A:1.1582082,B:-36.2878584,C:6.5885126,D:0.223568,mh:-0.0410335,bh:0.7526451,mw:-0.0009088,bw:0.1916641},
    GBH33:{A:0.9874283,B:-35.2532124,C:6.1544406,D:0.2265716,mh:-0.033902,bh:0.6938234,mw:-0.0012849,bw:0.2029732},
    GWA33:{A:0.3337838,B:-36.0237912,C:4.8662747,D:0.491228,mh:-0.0092263,bh:0.4595757,mw:-0.0009676,bw:0.3964291},
    GGB33:{A:1.8213778,B:-37.5,C:6.3462148,D:0.0678118,mh:-0.0607666,bh:0.9308159,mw:-0.0013967,bw:0.0850399},
    GBA33:{A:0.2770087,B:-33.0,C:5.7212303,D:0.4865118,mh:-0.0094849,bh:0.4630237,mw:-0.0007134,bw:0.3856589},
    GPD33:{A:1.7110739,B:-35.8,C:8.4,D:0.0702546,mh:-0.0745381,bh:1.0463005,mw:-0.0003672,bw:0.0621882},
    GMF33:{A:1.2328655,B:-34.7213605,C:5.8164304,D:0.0873352,mh:-0.0409284,bh:0.767292,mw:-0.002232,bw:0.1199207},
    GHD33:{A:1.3010623,B:-35.6816144,C:6.6857976,D:0.1409267,mh:-0.0473428,bh:0.8141691,mw:-0.0010601,bw:0.1325092},
    HEF34:{A:1.3819663,B:-37.4124155,C:6.1723179,D:0.0396284,mh:-0.0672159,bh:1.1167138,mw:-0.0019982,bw:0.135507},
    HMF34:{A:1.0443538,B:-35.0333754,C:6.2240634,D:0.0502917,mh:-0.053583,bh:0.9995901,mw:-0.0021758,bw:0.1633299},
    GMK34:{A:1.3284913,B:-35.8715062,C:7.5186829,D:0.017554,mh:-0.0758983,bh:1.1942555,mw:-0.000898,bw:0.0603337},
    GHA34:{A:1.8398455,B:-37.8282037,C:8.1593369,D:0.025971,mh:-0.1069262,bh:1.455224,mw:-0.000492,bw:0.0691851},
    GKO34:{A:1.4256684,B:-36.6590504,C:7.6083226,D:0.0371116,mh:-0.0809359,bh:1.2364527,mw:-0.0007628,bw:0.1002979},
    GBD34:{A:1.5175792,B:-37.5,C:6.8,D:0.0295801,mh:-0.0788559,bh:1.216125,mw:-0.0013134,bw:0.0968721},
    GGA34:{A:1.184832,B:-36.0,C:7.7368518,D:0.0793107,mh:-0.0687383,bh:1.130857,mw:-0.0006587,bw:0.1910301},
    GBH34:{A:0.9872585,B:-35.2532124,C:6.0587001,D:0.0793512,mh:-0.0495013,bh:0.9637999,mw:-0.0022304,bw:0.2288398},
    GWA34:{A:0.3925339,B:-35.3,C:4.8662747,D:0.3045099,mh:-0.0167993,bh:0.6710889,mw:-0.0020301,bw:0.5614623},
    GGB34:{A:1.6266812,B:-37.8825368,C:6.983607,D:0.0297136,mh:-0.0854333,bh:1.2709629,mw:-0.0011319,bw:0.0928124},
    GBA34:{A:0.353764,B:-33.35,C:5.7212303,D:0.3033305,mh:-0.0177463,bh:0.6825699,mw:-0.0013912,bw:0.5434624},
    GPD34:{A:1.8834609,B:-37.0,C:10.2405021,D:0.027547,mh:-0.12531,bh:1.6275999,mw:-0.0001105,bw:0.0635119},
    GMF34:{A:1.0443538,B:-35.0333754,C:6.2240634,D:0.0502917,mh:-0.053583,bh:0.9995901,mw:-0.0021758,bw:0.1633299},
    GHD34:{A:1.25696,B:-36.6078453,C:7.321187,D:0.077696,mh:-0.0696826,bh:1.1379702,mw:-0.0008522,bw:0.1921068},
  };

  // Städte-Klimadaten für synthetische Temperaturprofile
  // {tMean [°C], amp [°C], phase [Tage seit Jahresbeginn bis kältestem Tag], tNorm [°C], tryReal}
  const STAEDTE = {
    // ── Norddeutschland ──────────────────────────────────────────────────────
    'Hamburg':           {tMean:10.0,amp:12.0,phase:15,tNorm:-12},
    'Kiel':              {tMean:9.5, amp:11.5,phase:15,tNorm:-12},
    'Lübeck':            {tMean:10.0,amp:12.0,phase:15,tNorm:-12},
    'Flensburg':         {tMean:9.5, amp:11.0,phase:16,tNorm:-12},
    'Rostock':           {tMean:9.5, amp:12.5,phase:13,tNorm:-12},
    'Greifswald':        {tMean:9.0, amp:13.0,phase:13,tNorm:-12},
    'Schwerin':          {tMean:9.8, amp:13.0,phase:14,tNorm:-12},
    'Bremen':            {tMean:10.2,amp:12.0,phase:15,tNorm:-12},
    'Osnabrück':         {tMean:10.5,amp:12.0,phase:15,tNorm:-12},
    // ── Nordrhein-Westfalen ──────────────────────────────────────────────────
    'Münster':           {tMean:10.8,amp:12.0,phase:15,tNorm:-10},
    'Bielefeld':         {tMean:10.5,amp:13.0,phase:14,tNorm:-12},
    'Paderborn':         {tMean:10.0,amp:13.5,phase:14,tNorm:-12},
    'Dortmund':          {tMean:11.0,amp:12.0,phase:15,tNorm:-10},
    'Bochum':            {tMean:11.0,amp:12.0,phase:15,tNorm:-10},
    'Duisburg':          {tMean:11.5,amp:12.0,phase:15,tNorm:-10},
    'Köln':              {tMean:11.5,amp:12.0,phase:15,tNorm:-10},
    'Bonn':              {tMean:11.5,amp:12.0,phase:15,tNorm:-10},
    'Wuppertal':         {tMean:10.5,amp:12.0,phase:15,tNorm:-10},
    'Aachen':            {tMean:11.0,amp:11.5,phase:15,tNorm:-10},
    // ── Niedersachsen / Mitte ────────────────────────────────────────────────
    'Hannover':          {tMean:10.5,amp:13.0,phase:14,tNorm:-12},
    'Braunschweig':      {tMean:10.0,amp:13.5,phase:14,tNorm:-12},
    'Göttingen':         {tMean:10.0,amp:13.5,phase:14,tNorm:-12},
    'Kassel':            {tMean:10.0,amp:14.0,phase:14,tNorm:-12,tryReal:true},
    // ── Ostdeutschland ───────────────────────────────────────────────────────
    'Berlin':            {tMean:10.5,amp:14.0,phase:13,tNorm:-15},
    'Potsdam':           {tMean:10.5,amp:14.0,phase:13,tNorm:-15},
    'Frankfurt (Oder)':  {tMean:10.0,amp:14.5,phase:12,tNorm:-18},
    'Cottbus':           {tMean:10.0,amp:15.0,phase:12,tNorm:-18},
    'Magdeburg':         {tMean:10.0,amp:14.5,phase:13,tNorm:-15},
    'Halle (Saale)':     {tMean:10.5,amp:14.5,phase:13,tNorm:-15},
    'Leipzig':           {tMean:10.5,amp:14.0,phase:13,tNorm:-15},
    'Erfurt':            {tMean:9.5, amp:15.0,phase:13,tNorm:-15},
    'Jena':              {tMean:10.0,amp:15.0,phase:13,tNorm:-15},
    'Dresden':           {tMean:10.5,amp:15.0,phase:13,tNorm:-15},
    'Chemnitz':          {tMean:9.5, amp:15.0,phase:13,tNorm:-15},
    // ── Rheinland-Pfalz / Saarland ───────────────────────────────────────────
    'Koblenz':           {tMean:11.0,amp:13.0,phase:14,tNorm:-12},
    'Trier':             {tMean:11.0,amp:13.0,phase:14,tNorm:-12},
    'Mainz':             {tMean:11.5,amp:13.0,phase:13,tNorm:-12},
    'Kaiserslautern':    {tMean:10.5,amp:13.0,phase:14,tNorm:-12},
    'Saarbrücken':       {tMean:11.0,amp:13.0,phase:14,tNorm:-12},
    // ── Hessen ───────────────────────────────────────────────────────────────
    'Frankfurt a.M.':    {tMean:11.5,amp:13.0,phase:13,tNorm:-12},
    'Wiesbaden':         {tMean:11.5,amp:13.0,phase:13,tNorm:-12},
    // ── Baden-Württemberg ─────────────────────────────────────────────────────
    'Mannheim':          {tMean:12.0,amp:13.0,phase:13,tNorm:-12},
    'Heidelberg':        {tMean:12.0,amp:13.0,phase:13,tNorm:-12},
    'Karlsruhe':         {tMean:12.0,amp:13.0,phase:13,tNorm:-12},
    'Heilbronn':         {tMean:11.5,amp:14.0,phase:13,tNorm:-12},
    'Stuttgart':         {tMean:11.0,amp:14.0,phase:13,tNorm:-12},
    'Reutlingen':        {tMean:10.5,amp:14.0,phase:13,tNorm:-16},
    'Ulm':               {tMean:10.5,amp:14.0,phase:13,tNorm:-15},
    'Freiburg':          {tMean:13.0,amp:13.0,phase:13,tNorm:-10},
    // ── Bayern ────────────────────────────────────────────────────────────────
    'Würzburg':          {tMean:11.0,amp:14.0,phase:13,tNorm:-15},
    'Bamberg':           {tMean:10.0,amp:15.0,phase:13,tNorm:-15},
    'Bayreuth':          {tMean:9.5, amp:15.0,phase:13,tNorm:-15},
    'Nürnberg':          {tMean:10.5,amp:15.0,phase:13,tNorm:-15},
    'Ingolstadt':        {tMean:9.5, amp:15.0,phase:13,tNorm:-16},
    'Regensburg':        {tMean:10.5,amp:15.0,phase:13,tNorm:-15},
    'Augsburg':          {tMean:10.0,amp:15.0,phase:13,tNorm:-16},
    'Landshut':          {tMean:9.5, amp:15.0,phase:13,tNorm:-16},
    'München':           {tMean:9.5, amp:15.0,phase:13,tNorm:-16},
    'Rosenheim':         {tMean:9.0, amp:15.0,phase:13,tNorm:-16},
    'Passau':            {tMean:9.5, amp:15.0,phase:13,tNorm:-16},
  };

  // Emissionen [g CO2eq/kWh]
  const EMISSIONEN = {
    Strom:363, Erdgas:240, Heizoel:310,
    Fernwaerme:180, Pellets:20, Hackschnitzel:20
  };

  // Wirkungsgrade (thermisch/Brennwert)
  const WIRKUNGSGRAD = {
    Gaskessel:0.92, Heizoel:0.91, Pellets:0.88,
    Hackschnitzel:0.85, Fernwaerme:1.0
  };

  // KWW-Kostenkurven: Invest[€] = a × P[kW]^(b-1)  →  €/kW bei Leistung P
  // {aDez, bDez, maxDez, aZen, bZen, minZen, maxZen, cap}
  const INVEST_KURVEN = {
    LuftWP:        {aDez:5909, bDez:0.71,maxDez:100, aZen:2848, bZen:0.86,minZen:300,  maxZen:20000},
    GeoWP:         {aDez:8429, bDez:0.75,maxDez:100, aZen:3200, bZen:0.82,minZen:100,  maxZen:5000},
    FlussWP:       {aDez:9472, bDez:0.51,maxDez:100, aZen:70917,bZen:0.55,minZen:10000,maxZen:50000},
    Gaskessel:     {aDez:4634, bDez:0.46,maxDez:100, aZen:804,  bZen:0.72,minZen:500,  maxZen:30000},
    Heizoel:       {aDez:4886, bDez:0.50,maxDez:100, aZen:307,  bZen:0.91,minZen:100,  maxZen:1000},
    BHKW:          {aDez:14000,bDez:0.52,maxDez:100, aZen:4200, bZen:0.75,minZen:100,  maxZen:5000},
    Pellets:       {aDez:13124,bDez:0.43,maxDez:100, aZen:5500, bZen:0.68,minZen:100,  maxZen:2000, cap:550},
    Hackschnitzel: {aDez:16541,bDez:0.37,maxDez:100, aZen:6200, bZen:0.65,minZen:100,  maxZen:3000, cap:550},
    Stromkessel:   {aDez:null, bDez:null,maxDez:null,aZen:300,  bZen:0.65,minZen:100,  maxZen:10000},
  };

  // VDI 2067: {n [a], inst [%/a], wart [%/a], bedien [h/a]}
  const VDI2067 = {
    LuftWP:        {n:20,inst:1.0,wart:1.5,bedien:5},
    GeoWP:         {n:20,inst:1.0,wart:1.5,bedien:5},
    FlussWP:       {n:20,inst:2.0,wart:1.0,bedien:5},
    Gaskessel:     {n:20,inst:1.0,wart:2.0,bedien:20},
    Heizoel:       {n:20,inst:1.0,wart:2.0,bedien:20},
    Pellets:       {n:15,inst:3.0,wart:3.0,bedien:408},
    Hackschnitzel: {n:15,inst:3.0,wart:3.0,bedien:612},
    Fernwaerme:    {n:20,inst:2.0,wart:1.0,bedien:0},
  };

  // ── TRY Kassel 2045 (gzip + base64, Int16 × 10 = 0.1°C Auflösung) ────────
  const TRY_KASSEL_B64 =
    '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' +
    'P0ieTr6TPJV8l8/TyfM8/z9tYUuYcEQAAA==';

  let _kasselCache = null;

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────
  function arrSum(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }
  function arrMax(arr) {
    let m = -Infinity;
    for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
  }

  // ── SigLinDe h(θ) ─────────────────────────────────────────────────────────
  function sigH(theta, p) {
    const diff = theta - THETA_0;
    const sd = Math.abs(diff) < 1e-10 ? (diff < 0 ? -1e-10 : 1e-10) : diff;
    const term1 = p.A / (1 + Math.pow(p.B / sd, p.C));
    return term1 + p.D + Math.max(p.mh * theta + p.bh, p.mw * theta + p.bw);
  }

  // ── TRY Kassel dekomprimieren (async, gecacht) ────────────────────────────
  async function ladeTRYKassel() {
    if (_kasselCache) return _kasselCache;
    const b64 = TRY_KASSEL_B64.replace(/\s/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    const r = ds.readable.getReader();
    w.write(bytes); w.close();
    const chunks = [];
    for (;;) { const {done, value} = await r.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    const int16 = new Int16Array(buf.buffer);
    const temps = new Float32Array(8760);
    for (let i = 0; i < 8760; i++) temps[i] = int16[i] / 10;
    _kasselCache = temps;
    return temps;
  }

  // Synthetisches Temperaturprofil: T(h) = tMean - amp × cos(2π×(d−phase)/365)
  function synthetischTemp(tMean, amp, phase) {
    const t = new Float32Array(8760);
    for (let h = 0; h < 8760; h++) {
      const d = h / 24;
      t[h] = tMean - amp * Math.cos(2 * Math.PI * (d - phase) / 365);
    }
    return t;
  }

  function tagesMittel(tempH) {
    const nd = Math.floor(tempH.length / 24);
    const tm = new Float32Array(nd);
    for (let d = 0; d < nd; d++) {
      let s = 0;
      for (let h = 0; h < 24; h++) s += tempH[d * 24 + h];
      tm[d] = s / 24;
    }
    return tm;
  }

  // ── Heizkurve ─────────────────────────────────────────────────────────────
  function vorlaufTemp(T, vl5, vl15) {
    const lo = Math.min(vl5, vl15), hi = Math.max(vl5, vl15);
    return Math.max(lo, Math.min(hi, vl5 + (vl15 - vl5) * (T + 5) / 20));
  }

  // ── Quellentemperatur ─────────────────────────────────────────────────────
  function quellenTemp(wpTyp, tempH) {
    const n = tempH.length, nd = Math.floor(n / 24);
    const tq = new Float32Array(n);
    if (wpTyp === 'Luft') {
      for (let i = 0; i < n; i++) tq[i] = tempH[i];
    } else if (wpTyp === 'Geothermie') {
      // Erdsonden ~100m: nahezu konstant ~10°C, saisonaler Swing ±2°C
      for (let d = 0; d < nd; d++) {
        const T = 10 + 2 * Math.sin(2 * Math.PI * (d - 75) / 365);
        for (let h = 0; h < 24 && d * 24 + h < n; h++) tq[d * 24 + h] = T;
      }
    } else { // Fließgewässer
      for (let d = 0; d < nd; d++) {
        const T = Math.max(0.5, 10 + 8 * Math.sin(2 * Math.PI * (d - 119) / 365));
        for (let h = 0; h < 24 && d * 24 + h < n; h++) tq[d * 24 + h] = T;
      }
    }
    return tq;
  }

  // ── WP COP stundenscharf ──────────────────────────────────────────────────
  function calcCOP(vlH, tqH, guetegrad) {
    const n = vlH.length;
    const cop = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const hub = Math.max(vlH[i] - tqH[i], 0.1);
      cop[i] = Math.min(((273.15 + vlH[i]) / hub) * guetegrad, 8);
    }
    const copRef = (273.15 + 35) / (35 - 2) * guetegrad;
    return {cop, copRef};
  }

  // ── Lastgang-Synthese ─────────────────────────────────────────────────────
  function calcLastgang(st) {
    const n = st.tempH.length, nd = Math.floor(n / 24);
    const tm = tagesMittel(st.tempH);
    const p1 = SIGLINDE[st.sigProfil1 || 'HEF34'] || SIGLINDE.HEF34;
    const p2 = st.sigProfil2 ? (SIGLINDE[st.sigProfil2] || SIGLINDE.HEF34) : null;
    const g1 = p2 ? (st.gewicht1 ?? 50) : 1;
    const g2 = p2 ? (st.gewicht2 ?? 50) : 0;

    // Tägliche SigLinDe-Werte
    const hTage = new Float32Array(nd);
    let hSum = 0;
    for (let d = 0; d < nd; d++) {
      hTage[d] = Math.max(0, g1 * sigH(tm[d], p1) + (p2 ? g2 * sigH(tm[d], p2) : 0));
      hSum += hTage[d];
    }

    // 24h-Schablone normieren
    const schSum = arrSum(SCHABLONE_24H);
    const shape = new Float32Array(n);
    for (let d = 0; d < nd; d++) {
      const tagAnteil = hSum > 0 ? hTage[d] / hSum : 1 / nd;
      for (let h = 0; h < 24; h++)
        shape[d * 24 + h] = tagAnteil * (SCHABLONE_24H[h] / schSum);
    }
    const shapeSum = arrSum(shape);
    if (shapeSum > 0) for (let i = 0; i < n; i++) shape[i] /= shapeSum;

    // Priorität: Upload → Monatswerte → Synthese
    let lg;
    const E = st.gesamtenergieMwh || 1;
    if (st.lastgangUpload && st.lastgangUpload.length >= n) {
      lg = new Float32Array(st.lastgangUpload.slice(0, n));
    } else if (st.monatswerte && st.monatswerte.length === 12) {
      lg = new Float32Array(shape);
      const tpm = [31, nd > 365 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      let h = 0;
      for (let m = 0; m < 12; m++) {
        const nH = tpm[m] * 24;
        const s = arrSum(lg.slice(h, h + nH));
        if (s > 0) { const f = st.monatswerte[m] / s; for (let i = h; i < h + nH; i++) lg[i] *= f; }
        h += nH;
      }
    } else {
      lg = new Float32Array(n);
      for (let i = 0; i < n; i++) lg[i] = shape[i] * E;
    }
    st.lastgangMwhH = lg;
    return st;
  }

  // ── TWW & Netzverlust ─────────────────────────────────────────────────────
  function calcTWW(st) {
    const last = st.lastgangMwhH, n = last.length, nd = Math.floor(n / 24);
    const temp = st.tempH;
    const tpm = [31, nd > 365 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const sommertage = [];
    let dayOff = 0;
    for (let m = 0; m < 12; m++) {
      for (let d = 0; d < tpm[m]; d++) {
        if (m === 6 || m === 7) {
          const h0 = dayOff * 24;
          let tMin = Infinity;
          for (let h = h0; h < Math.min(h0 + 24, n); h++) if (temp[h] < tMin) tMin = temp[h];
          if (tMin >= 12) sommertage.push(dayOff);
        }
        dayOff++;
      }
    }
    const gesamtE = arrSum(last);
    let tww, netz;
    if (sommertage.length >= 10) {
      const sh = []; for (const d of sommertage) for (let h = d*24; h < d*24+24 && h<n; h++) sh.push(h);
      let eSom = 0; for (const h of sh) eSom += last[h];
      const eTN = Math.min(eSom * (nd / sommertage.length), gesamtE);
      const minPD = sommertage.map(d => { let m = Infinity; for (let h=d*24;h<d*24+24&&h<n;h++) if(last[h]<m) m=last[h]; return m; });
      const refP = minPD.reduce((a,b)=>a+b,0) / minPD.length;
      netz = new Float32Array(n).fill(refP);
      const eN = Math.min(arrSum(netz), eTN * 0.8);
      if (arrSum(netz) > 0) { const f = eN / arrSum(netz); for (let i = 0; i < n; i++) netz[i] *= f; }
      tww = new Float32Array(n).fill(Math.max(0, eTN - eN) / n);
    } else {
      const ant = st.twwNetzAnteil ?? 0.15;
      const tAnt = st.twwAnteilVonTwwNetz ?? 0.5;
      const eTN = gesamtE * ant;
      tww  = new Float32Array(n).fill(eTN * tAnt / n);
      netz = new Float32Array(n).fill(eTN * (1 - tAnt) / n);
    }
    st.twwMwhH = tww;
    st.netzMwhH = netz;
    st.energieTwwMwh = arrSum(tww);
    st.energieNetzMwh = arrSum(netz);
    return st;
  }

  // ── Lastgang-Analyse ──────────────────────────────────────────────────────
  function calcAnalyse(st) {
    const last = st.lastgangMwhH, n = last.length;
    if (!n) return st;
    const gesamt = arrSum(last);
    const pMax = arrMax(last);
    function eGedeckt(P) { let s=0; for(let i=0;i<n;i++) s+=Math.min(last[i],P); return s; }
    function lFuerAbdeckung(z) {
      if (z <= 0) return 0; if (z >= 1) return pMax;
      const zE = z * gesamt; let lo=0, hi=pMax;
      for (let it=0; it<60; it++) { const m=(lo+hi)/2; if(eGedeckt(m)>=zE) hi=m; else lo=m; }
      return (lo+hi)/2;
    }
    const p65 = lFuerAbdeckung(0.65), p90 = lFuerAbdeckung(0.90);
    const temp = st.tempH;
    let hMin = 0;
    for (let i=1; i<n; i++) if (temp[i] < temp[hMin]) hMin = i;
    const tMin = temp[hMin];
    const pBeiTMin = last[hMin] * 1000; // kW
    const tNorm = st.normAussentemp ?? -12;
    const pNorm = tMin < 21 ? pBeiTMin * (21 - tNorm) / (21 - tMin) : NaN;
    st.gesamtMwh = gesamt;
    st.pMaxKw  = pMax * 1000;
    st.p65Kw   = p65  * 1000;
    st.p90Kw   = p90  * 1000;
    st.pNormKw = pNorm;
    st.tMin = tMin; st.hMin = hMin;
    st._lFuerAbdeckung = lFuerAbdeckung;
    return st;
  }

  // ── Erzeuger-Profile ──────────────────────────────────────────────────────
  function calcErzeugerProfile(st) {
    const erz = st.erzeuger || [];
    const n = st.lastgangMwhH.length;
    const vlH = st.vlH;
    for (const e of erz) {
      const isWP = e.typ === 'LuftWP' || e.typ === 'GeoWP' || e.typ === 'FlussWP';
      if (isWP) {
        const wpTyp = e.typ === 'LuftWP' ? 'Luft' : (e.typ === 'GeoWP' ? 'Geothermie' : 'Fließgewässer');
        const tqH = quellenTemp(wpTyp, st.tempH);
        const gg = e.guetegrad ?? (wpTyp === 'Luft' ? 0.42 : (wpTyp === 'Geothermie' ? 0.50 : 0.56));
        const {cop, copRef} = calcCOP(vlH, tqH, gg);
        const kw = e.leistungKw || 0;
        const waerme = new Float32Array(n);
        const strom  = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const erreichbar = kw * (cop[i] / copRef);
          const frost = wpTyp === 'Fließgewässer' && tqH[i] < 2;
          waerme[i] = frost ? 0 : erreichbar;
          strom[i]  = cop[i] > 0 ? waerme[i] / cop[i] : 0;
        }
        e.profile = {waerme, strom, cop, tq: tqH};
        e.copRef = copRef;
      } else {
        // Nicht-WP: konstante Nennleistung
        e.profile = {
          waerme: new Float32Array(n).fill(e.leistungKw || 0),
          strom:  new Float32Array(n)
        };
      }
    }
    return st;
  }

  // ── Merit-Order Dispatch ──────────────────────────────────────────────────
  function calcDispatch(st) {
    const erz = st.erzeuger || [];
    const n = st.lastgangMwhH.length;
    const lastKw = new Float32Array(n);
    for (let i = 0; i < n; i++) lastKw[i] = st.lastgangMwhH[i] * 1000;

    const rest = lastKw.slice();
    // Merit-Order: Indizes aus st.meritOrder oder Reihenfolge in erzeuger[]
    const order = st.meritOrder || erz.map((_, i) => i);
    for (const idx of order) {
      const e = erz[idx];
      if (!e || !e.profile) continue;
      const cap = e.profile.waerme;
      const abnahme = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        abnahme[i] = Math.min(rest[i], cap[i]);
        rest[i] -= abnahme[i];
      }
      e.profile.abnahme = abnahme;
    }
    // Gaskessel füllt Rest
    st.gasKw = rest;
    st.gasLeistungKw = arrMax(rest);
    return st;
  }

  // ── Invest-Kosten (KWW) ───────────────────────────────────────────────────
  function investEurProKw(techKey, kw) {
    const k = INVEST_KURVEN[techKey];
    if (!k || kw <= 0) return 0;
    if (kw <= k.maxDez) return k.aDez * Math.pow(kw, k.bDez - 1);
    if (k.aZen && kw >= k.minZen && kw <= k.maxZen) return k.aZen * Math.pow(kw, k.bZen - 1);
    if (k.aZen && kw > k.maxZen) return k.aZen * Math.pow(kw, k.bZen - 1);
    let eur = k.aDez * Math.pow(kw, k.bDez - 1);
    if (k.cap) eur = Math.min(eur, k.cap);
    return eur;
  }

  // ── Dynamische PV-Investkosten nach Anlagengröße ───────────────────────
  // Interpolationstabelle €/kWp netto (Stand 2024/25, Fraunhofer ISE Studie)
  const PV_INVEST_TABELLE = [
    { kwp:    5, eurKwp: 1400 },
    { kwp:   10, eurKwp: 1300 },
    { kwp:   30, eurKwp: 1150 },
    { kwp:   50, eurKwp: 1050 },
    { kwp:  100, eurKwp:  950 },
    { kwp:  300, eurKwp:  850 },
    { kwp:  750, eurKwp:  780 },
    { kwp: 1000, eurKwp:  750 },
    { kwp: 5000, eurKwp:  650 },
    { kwp:10000, eurKwp:  600 },
  ];

  function getPvInvestPerKwp(kwp) {
    if (kwp <= 0) return PV_INVEST_TABELLE[0].eurKwp;
    const tab = PV_INVEST_TABELLE;
    if (kwp <= tab[0].kwp) return tab[0].eurKwp;
    if (kwp >= tab[tab.length-1].kwp) return tab[tab.length-1].eurKwp;
    for (let i = 0; i < tab.length - 1; i++) {
      if (kwp >= tab[i].kwp && kwp <= tab[i+1].kwp) {
        const t = (kwp - tab[i].kwp) / (tab[i+1].kwp - tab[i].kwp);
        return Math.round(tab[i].eurKwp + t * (tab[i+1].eurKwp - tab[i].eurKwp));
      }
    }
    return tab[tab.length-1].eurKwp;
  }

  function annuitaet(r, n) {
    if (n <= 0) return 0;
    if (r <= 0) return 1 / n;
    return r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1);
  }

  // ── Metriken ──────────────────────────────────────────────────────────────
  function calcMetriken(st) {
    const erz = st.erzeuger || [];
    const n = st.lastgangMwhH.length;
    const preise = st.energiepreise || {Strom:35,Erdgas:10,Heizoel:10,Pellets:8,Hackschnitzel:6,Fernwaerme:17};
    const kz = st.kapitalzins ?? 0.034;
    const lohnSatz = st.lohnSatz ?? 45;

    for (const e of erz) {
      if (!e.profile || !e.profile.abnahme) { e.metriken = null; continue; }
      const ab = e.profile.abnahme;
      const waermeKwh = arrSum(ab);
      const isWP = e.typ==='LuftWP'||e.typ==='GeoWP'||e.typ==='FlussWP';
      let verbrauchKwh = 0;
      if (isWP) {
        const sw = e.profile.waerme;
        const ss = e.profile.strom;
        for (let i = 0; i < n; i++) {
          const ant = sw[i] > 0 ? ab[i] / sw[i] : 0;
          verbrauchKwh += ss[i] * ant;
        }
      } else {
        const eta = WIRKUNGSGRAD[e.typ] ?? 0.92;
        verbrauchKwh = eta > 0 ? waermeKwh / eta : waermeKwh;
      }
      const em = isWP ? EMISSIONEN.Strom : (EMISSIONEN[e.typ] ?? 0);
      const co2TJahr = verbrauchKwh * em / 1e6;
      const prKey = isWP ? 'Strom' : e.typ;
      const preis = preise[prKey] ?? 0;
      const energiekosten = verbrauchKwh * preis / 100;
      const techMap = {LuftWP:'LuftWP',GeoWP:'GeoWP',FlussWP:'FlussWP',Gaskessel:'Gaskessel',Heizoel:'Heizoel',Pellets:'Pellets',Hackschnitzel:'Hackschnitzel'};
      const techKey = techMap[e.typ] || 'Gaskessel';
      const eur_kw = investEurProKw(techKey, e.leistungKw || 0);
      const investEur = (e.leistungKw || 0) * eur_kw;
      let vdi = VDI2067[techKey] || {n:20,inst:1,wart:1,bedien:0};
      // Bedienungsstunden nach Leistung skalieren (Pellets, HHS, BHKW)
      const _ekw = e.leistungKw || 0;
      if (techKey==='Pellets') vdi = {...vdi, bedien:_ekw<50?100:_ekw<200?200:_ekw<500?300:408};
      else if (techKey==='Hackschnitzel') vdi = {...vdi, bedien:_ekw<50?150:_ekw<200?250:_ekw<500?350:408};
      const ann = annuitaet(kz, vdi.n);
      const jahreskosten = investEur * (ann + vdi.inst/100 + vdi.wart/100) + vdi.bedien * lohnSatz + energiekosten;
      const jaz = verbrauchKwh > 0 ? waermeKwh / verbrauchKwh : null;
      const vbs = (e.leistungKw||0) > 0 ? waermeKwh / (e.leistungKw||1) : 0;
      e.metriken = {
        waermeKwh, verbrauchKwh, jaz, vollbstd: vbs,
        co2TJahr, energiekosten, investEur, jahreskosten,
        anteilPct: st.gesamtMwh > 0 ? waermeKwh / (st.gesamtMwh * 1000) * 100 : 0,
      };
    }
    // Gaskessel-Metriken
    const gasKwh = arrSum(st.gasKw);
    const gasEta = 0.92;
    const gasVerb = gasEta > 0 ? gasKwh / gasEta : gasKwh;
    const gasEurKw = investEurProKw('Gaskessel', st.gasLeistungKw || 0);
    const gasInvest = (st.gasLeistungKw || 0) * gasEurKw;
    const gasVdi = VDI2067.Gaskessel;
    const gasAnn = annuitaet(kz, gasVdi.n);
    st.gasMetriken = {
      waermeKwh: gasKwh,
      verbrauchKwh: gasVerb,
      co2TJahr: gasVerb * EMISSIONEN.Erdgas / 1e6,
      energiekosten: gasVerb * (preise.Erdgas || 10) / 100,
      investEur: gasInvest,
      jahreskosten: gasInvest * (gasAnn + gasVdi.inst/100 + gasVdi.wart/100)
                    + gasVdi.bedien * lohnSatz
                    + gasVerb * (preise.Erdgas || 10) / 100,
      anteilPct: st.gesamtMwh > 0 ? gasKwh / (st.gesamtMwh * 1000) * 100 : 0,
    };
    return st;
  }

  // ── Jahresdauerlinie ──────────────────────────────────────────────────────
  function buildJahresdauerlinie(st) {
    st.jahresdauerlinie = Float32Array.from(st.lastgangMwhH).sort((a, b) => b - a);
    return st;
  }

  // ── Kälteste Woche (168h) ─────────────────────────────────────────────────
  function findKaeltesteWoche(tempH) {
    const n = tempH.length;
    if (n < 168) return 0;
    let s = 0, minS = Infinity, minI = 0;
    for (let i = 0; i < 168; i++) s += tempH[i];
    minS = s; minI = 0;
    for (let i = 168; i < n; i++) {
      s += tempH[i] - tempH[i - 168];
      if (s < minS) { minS = s; minI = i - 167; }
    }
    return minI;
  }

  // ── Haupt-Funktion ────────────────────────────────────────────────────────
  async function run(state) {
    const t0 = performance.now();

    // 1. Temperaturprofil (wird immer von außen übergeben; Fallback: TRY Kassel)
    if (!state.tempH) {
      state.tempH = await ladeTRYKassel();
    }

    // 2. Vorlaufprofil
    const vl5  = state.vlMinus5 ?? 90;
    const vl15 = state.vl15 ?? 60;
    state.vlH = new Float32Array(state.tempH.length);
    for (let i = 0; i < state.tempH.length; i++)
      state.vlH[i] = vorlaufTemp(state.tempH[i], vl5, vl15);

    // 3–9: Berechnungsschritte
    calcLastgang(state);
    calcTWW(state);
    calcAnalyse(state);
    calcErzeugerProfile(state);
    calcDispatch(state);
    calcMetriken(state);
    buildJahresdauerlinie(state);

    state._kaeltesteWocheStart = findKaeltesteWoche(state.tempH);
    state._rechenzeit = Math.round(performance.now() - t0);
    return state;
  }

  // ── Öffentliche API ───────────────────────────────────────────────────────
  return {
    run,
    ladeTRYKassel,
    sigH, vorlaufTemp, quellenTemp, calcCOP,
    annuitaet, investEurProKw, getPvInvestPerKwp,
    findKaeltesteWoche, buildJahresdauerlinie,
    SIGLINDE, STAEDTE, EMISSIONEN, INVEST_KURVEN, VDI2067, PV_INVEST_TABELLE,
  };
})();

// ══════════════════════════════════════════════════════════════════════════
// SENSITIVITÄTSANALYSE — Preisentwicklung, Tornado, Preisstabilität
// ══════════════════════════════════════════════════════════════════════════

// ── Sensitivitäts-Slider / Carrier-Inputs ─────────────────────────────────
function sensSliderChanged(val) {
  document.getElementById('sens-global-label').textContent = '±' + val + '%';
  // Alle Carrier-Inputs auf Slider-Wert setzen
  ['sens-t-gas','sens-t-strom','sens-t-pk','sens-t-hhs','sens-t-hko','sens-t-fw'].forEach(id => {
    document.getElementById(id).value = val;
  });
  runSensitivitaet();
}
function sensCarrierChanged() {
  runSensitivitaet();
}

function runSensitivitaet() {
  const keys = window._dispatchActiveKeys || [];
  const en   = window._dispatchEnergy || {};
  if (!keys.length) return;

  // Basispreise
  const basePreise = {
    Erdgas:        parseFloat(document.getElementById('wirt-p-gas')?.value) || 10,
    Strom:         parseFloat(document.getElementById('wirt-p-strom')?.value) || 30,
    Pellets:       parseFloat(document.getElementById('wirt-p-pk')?.value) || 8,
    Hackschnitzel: parseFloat(document.getElementById('wirt-p-hhs')?.value) || 6,
    Heizoel:       parseFloat(document.getElementById('wirt-p-hko')?.value) || 9.5,
    Fernwaerme:    parseFloat(document.getElementById('wirt-p-fw')?.value) || 8,
  };

  // Verbrauch je Energieträger [MWh/a] aus aktuellem Dispatch
  const ETA = _getEtaMap();
  const TRAEGER_MAP = { gaskessel:'Erdgas', _autoGk:'Erdgas', heizoel:'Heizoel', pellets:'Pellets', hhs:'Hackschnitzel',
    fernwaerme:'Fernwaerme', lwwp:'Strom', fg:'Strom', geo:'Strom', stromkessel:'Strom', bhkw:'Erdgas' };
  const verbrauch = {};
  keys.forEach(k => {
    const e = en[k] || {};
    const w = e.waermeMwh || 0;
    if (w < 0.1) return;
    const tr = TRAEGER_MAP[k];
    if (!tr) return;
    let v = w;
    if (ETA[k]) v = w / ETA[k];
    else if (k === 'bhkw') {
      const sigma = parseFloat(document.getElementById('bhkw-skz')?.value) || 0.45;
      const etaGes = (parseFloat(document.getElementById('bhkw-eta')?.value) || 88) / 100;
      const etaTh = etaGes / (1 + sigma);
      v = etaTh > 0 ? w / etaTh : w;
    } else if (['lwwp','fg','geo'].includes(k)) {
      v = e.elMwh || 0;
    } else if (k === 'stromkessel') {
      v = w;
    } else if (k === 'fernwaerme') {
      v = w;
    }
    verbrauch[tr] = (verbrauch[tr] || 0) + v;
  });

  const bhkwErl = window._bhkwStromErloes || 0;

  // Basisenergiekosten
  let basisEnergie = 0;
  Object.keys(verbrauch).forEach(tr => {
    basisEnergie += verbrauch[tr] * (basePreise[tr] || 0) * 10;
  });
  basisEnergie -= bhkwErl;

  // ── Tornado: Bidirektional (±X%) ────────────────────────────────────
  const tornadoIncr = {
    Erdgas:        parseFloat(document.getElementById('sens-t-gas')?.value) || 30,
    Strom:         parseFloat(document.getElementById('sens-t-strom')?.value) || 30,
    Pellets:       parseFloat(document.getElementById('sens-t-pk')?.value) || 30,
    Hackschnitzel: parseFloat(document.getElementById('sens-t-hhs')?.value) || 30,
    Heizoel:       parseFloat(document.getElementById('sens-t-hko')?.value) || 30,
    Fernwaerme:    parseFloat(document.getElementById('sens-t-fw')?.value) || 30,
  };
  const tornadoBars = [];
  Object.keys(tornadoIncr).forEach(tr => {
    if (!verbrauch[tr]) return;
    const incr = tornadoIncr[tr] / 100;
    let deltaPlus = verbrauch[tr] * (basePreise[tr] || 0) * 10 * incr;
    let deltaMinus = -verbrauch[tr] * (basePreise[tr] || 0) * 10 * incr;
    // BHKW-Erlös hängt am Strompreis (Eigenverbrauch spart Strombezug, Einspeisung ≈ Marktpreis)
    // → Wenn Strom teurer: Erlös steigt → netto weniger Mehrkosten
    if (tr === 'Strom') {
      const eigAnteil = (window._stromBilanz?.bhkwEigenMwh > 0) ?
        window._stromBilanz.bhkwEigenMwh / (window._stromBilanz.bhkwEigenMwh + window._stromBilanz.bhkwEinspMwh) : 0.6;
      const bhkwStromSens = bhkwErl * eigAnteil; // Nur Eigenverbrauchsanteil reagiert auf Strompreis
      deltaPlus -= bhkwStromSens * incr;
      deltaMinus += bhkwStromSens * incr;
    }
    tornadoBars.push({ traeger: tr, deltaPlus, deltaMinus, incr: tornadoIncr[tr] });
  });
  tornadoBars.sort((a, b) => Math.abs(b.deltaPlus) - Math.abs(a.deltaPlus));

  // ── Fächer: Jeder Träger einzeln variiert (-50% bis +100%) ──────────
  const fanData = {};
  const nSteps = 40;
  const fanRange = { min: -50, max: 100 };
  Object.keys(verbrauch).forEach(tr => {
    if (!verbrauch[tr]) return;
    const points = [];
    for (let i = 0; i <= nSteps; i++) {
      const pct = fanRange.min + (fanRange.max - fanRange.min) * i / nSteps;
      const faktor = 1 + pct / 100;
      let ek = 0;
      Object.keys(verbrauch).forEach(t2 => {
        const f = (t2 === tr) ? faktor : 1;
        ek += verbrauch[t2] * (basePreise[t2] || 0) * 10 * f;
      });
      // BHKW-Erlös: Eigenverbrauchsanteil skaliert mit Strompreis, Rest konstant
      if (tr === 'Strom') {
        const eigA = (window._stromBilanz?.bhkwEigenMwh > 0) ?
          window._stromBilanz.bhkwEigenMwh / (window._stromBilanz.bhkwEigenMwh + window._stromBilanz.bhkwEinspMwh) : 0.6;
        ek -= bhkwErl * (eigA * faktor + (1 - eigA));
      } else {
        ek -= bhkwErl;
      }
      points.push({ pct, kosten: ek });
    }
    fanData[tr] = points;
  });

  window._lastSensData = { basisEnergie, tornadoBars, verbrauch, basePreise, bhkwErl, fanData, fanRange };

  _renderSensTornado(tornadoBars, basisEnergie);
  _renderSensFan(fanData, fanRange, basisEnergie, verbrauch);
  _sensRenderBump();
}

// ── Bidirektionaler Tornado ─────────────────────────────────────────────
function _renderSensTornado(bars, basisEnergie) {
  const canvas = document.getElementById('sens-tornado-canvas');
  if (!canvas || !bars.length) return;
  const _doDraw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 400;
    const barH = 22, gap = 6;
    const H = Math.max(140, bars.length * (barH + gap) + 50);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const COLORS = { Erdgas:'#ff9800', Strom:'#42a5f5', Pellets:'#ff7043', Hackschnitzel:'#8d6e63', Heizoel:'#546e7a', Fernwaerme:'#e53935' };
    const pad = { l: 80, r: 80, t: 24, b: 22 };
    const plotW = W - pad.l - pad.r;
    const cx = pad.l + plotW / 2; // Basislinie Mitte
    const maxDelta = Math.max(1, ...bars.map(b => Math.max(Math.abs(b.deltaPlus), Math.abs(b.deltaMinus))));

    // Titel
    ctx.fillStyle = '#90a4ae'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Basis: ' + Math.round(basisEnergie).toLocaleString('de-DE') + ' €/a Energiekosten', W / 2, 14);

    // Basislinie (vertikal, Mitte)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, pad.t); ctx.lineTo(cx, H - pad.b); ctx.stroke();
    ctx.setLineDash([]);

    // Achsenbeschriftungen
    ctx.fillStyle = '#546e7a'; ctx.font = '8px system-ui';
    ctx.textAlign = 'left'; ctx.fillText('Preissenkung', pad.l, H - 6);
    ctx.textAlign = 'right'; ctx.fillText('Preiserhöhung', W - pad.r, H - 6);
    ctx.textAlign = 'center'; ctx.fillText('Basis', cx, H - 6);

    bars.forEach((b, i) => {
      const y = pad.t + i * (barH + gap);
      const color = COLORS[b.traeger] || '#78909c';

      // Rechter Balken (+)
      const wPlus = (Math.abs(b.deltaPlus) / maxDelta) * (plotW / 2);
      ctx.fillStyle = color; ctx.globalAlpha = 0.9;
      ctx.fillRect(cx, y, wPlus, barH);
      // Linker Balken (-)
      const wMinus = (Math.abs(b.deltaMinus) / maxDelta) * (plotW / 2);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(cx - wMinus, y, wMinus, barH);
      ctx.globalAlpha = 1.0;

      // Label links
      ctx.fillStyle = '#b0bec5'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(b.traeger, pad.l - 4, y + barH / 2 + 3);

      // ±% rechts
      ctx.fillStyle = '#78909c'; ctx.font = '9px "DM Mono",monospace'; ctx.textAlign = 'left';
      ctx.fillText('±' + b.incr + '%', W - pad.r + 4, y + barH / 2 + 3);

      // Werte an Balkenenden
      ctx.font = '8px "DM Mono",monospace';
      // Plus-Seite
      ctx.fillStyle = '#e0e0e0'; ctx.textAlign = 'left';
      const plusLabel = '+' + Math.round(b.deltaPlus).toLocaleString('de-DE') + ' €';
      if (wPlus > 50) { ctx.fillText(plusLabel, cx + wPlus - ctx.measureText(plusLabel).width - 3, y + barH / 2 + 3); }
      else { ctx.fillText(plusLabel, cx + wPlus + 3, y + barH / 2 + 3); }
      // Minus-Seite
      ctx.textAlign = 'right';
      const minusLabel = Math.round(b.deltaMinus).toLocaleString('de-DE') + ' €';
      if (wMinus > 50) { ctx.fillText(minusLabel, cx - wMinus + ctx.measureText(minusLabel).width + 3, y + barH / 2 + 3); }
      else { ctx.fillText(minusLabel, cx - wMinus - 3, y + barH / 2 + 3); }
    });
  };
  if (canvas.clientWidth > 10) _doDraw();
  else requestAnimationFrame(_doDraw);
}

// ── Preissensitivitäts-Fächer ───────────────────────────────────────────
function _renderSensFan(fanData, fanRange, basisEnergie, verbrauch) {
  const canvas = document.getElementById('sens-fan-canvas');
  if (!canvas) return;
  const _doDraw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 400;
    const H = 200;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const COLORS = { Erdgas:'#ff9800', Strom:'#42a5f5', Pellets:'#ff7043', Hackschnitzel:'#8d6e63', Heizoel:'#546e7a', Fernwaerme:'#e53935' };
    const pad = { l: 55, r: 15, t: 15, b: 30 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    // Min/Max Kosten über alle Linien
    let minK = basisEnergie, maxK = basisEnergie;
    Object.values(fanData).forEach(pts => {
      pts.forEach(p => { if (p.kosten < minK) minK = p.kosten; if (p.kosten > maxK) maxK = p.kosten; });
    });
    const kRange = maxK - minK;
    minK -= kRange * 0.05; maxK += kRange * 0.05;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
    const nGrid = 4;
    for (let i = 0; i <= nGrid; i++) {
      const y = pad.t + plotH * (1 - i / nGrid);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
      ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
      const val = minK + (maxK - minK) * i / nGrid;
      ctx.fillText(Math.round(val / 1000) + 'T€', pad.l - 4, y + 3);
    }

    // X-Achse
    const xTicks = [-50, -25, 0, 25, 50, 75, 100];
    xTicks.forEach(pct => {
      const x = pad.l + ((pct - fanRange.min) / (fanRange.max - fanRange.min)) * plotW;
      ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText((pct >= 0 ? '+' : '') + pct + '%', x, H - 6);
      // Vertikale Gitterlinien
      ctx.strokeStyle = pct === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)';
      ctx.lineWidth = pct === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    });

    // Linien pro Energieträger
    const trKeys = Object.keys(fanData).sort((a, b) => {
      // Steilste Linie zuletzt (oben im Z-Order)
      const slopeA = Math.abs((fanData[a][fanData[a].length-1]?.kosten || 0) - (fanData[a][0]?.kosten || 0));
      const slopeB = Math.abs((fanData[b][fanData[b].length-1]?.kosten || 0) - (fanData[b][0]?.kosten || 0));
      return slopeA - slopeB;
    });

    trKeys.forEach(tr => {
      const pts = fanData[tr];
      const color = COLORS[tr] || '#78909c';
      ctx.beginPath();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      pts.forEach((p, i) => {
        const x = pad.l + ((p.pct - fanRange.min) / (fanRange.max - fanRange.min)) * plotW;
        const y = pad.t + plotH * (1 - (p.kosten - minK) / (maxK - minK));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Label am rechten Ende
      const last = pts[pts.length - 1];
      const lx = pad.l + plotW + 2;
      const ly = pad.t + plotH * (1 - (last.kosten - minK) / (maxK - minK));
      ctx.fillStyle = color; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(tr, lx, ly + 3);
    });

    // Basispunkt
    const bx = pad.l + ((0 - fanRange.min) / (fanRange.max - fanRange.min)) * plotW;
    const by = pad.t + plotH * (1 - (basisEnergie - minK) / (maxK - minK));
    ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#66bb6a'; ctx.fill();
    ctx.strokeStyle = '#1b5e20'; ctx.lineWidth = 1; ctx.stroke();

    // Legende (HTML)
    const legendEl = document.getElementById('sens-fan-legend');
    if (legendEl) {
      legendEl.innerHTML = trKeys.map(tr =>
        '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:10px;height:3px;background:' +
        (COLORS[tr]||'#78909c') + ';border-radius:1px;display:inline-block;"></span><span style="color:var(--muted);">' +
        tr + '</span></span>'
      ).join('') + '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;"><span style="width:6px;height:6px;background:#66bb6a;border-radius:50%;display:inline-block;"></span><span style="color:var(--muted);">Basis ' + Math.round(basisEnergie).toLocaleString('de-DE') + ' €/a</span></span>';
    }
  };
  if (canvas.clientWidth > 10) _doDraw();
  else requestAnimationFrame(_doDraw);
}

// ── Bump Chart (Technologie-Ranking bei Preisänderung) ──────────────────
function _sensRenderBump() {
  const canvas = document.getElementById('sens-bump-canvas');
  if (!canvas) return;
  const _doDraw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || canvas.parentElement?.clientWidth || 400;
    const H = 180;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const keys = window._dispatchActiveKeys || [];
    const en   = window._dispatchEnergy || {};
    if (!keys.length) return;

    // Compute annual cost per key at several gas/strom multipliers
    const multipliers = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
    const mLabels = multipliers.map(m => (m * 100 - 100 >= 0 ? '+' : '') + Math.round(m * 100 - 100) + '%');

    const pGas   = parseFloat(document.getElementById('wirt-p-gas')?.value)   || 10;
    const pStrom = parseFloat(document.getElementById('wirt-p-strom')?.value) || 35;
    const pHko   = parseFloat(document.getElementById('wirt-p-hko')?.value)   || 10;
    const pFw    = parseFloat(document.getElementById('wirt-p-fw')?.value)    || 17;
    const pPk    = parseFloat(document.getElementById('wirt-p-pk')?.value)    || 8;
    const pHhs   = parseFloat(document.getElementById('wirt-p-hhs')?.value)   || 6;

    // Map key -> carrier price function
    const priceFor = (k, mult) => {
      if (k === 'lwwp' || k === 'fg' || k === 'geo') return (en[k]?.elMwh || 0) * pStrom * 10 * mult;
      if (k === 'gaskessel' || k === '_autoGk') return (en[k]?.waermeMwh || 0) / (0.92) * pGas * 10 * mult;
      if (k === 'pellets') return (en[k]?.waermeMwh || 0) / (0.85) * pPk * 10 * mult;
      if (k === 'hhs') return (en[k]?.waermeMwh || 0) / (0.80) * pHhs * 10 * mult;
      if (k === 'heizoel') return (en[k]?.waermeMwh || 0) / (0.90) * pHko * 10 * mult;
      if (k === 'fernwaerme') return (en[k]?.waermeMwh || 0) * pFw * 10 * mult;
      if (k === 'bhkw') return (en[k]?.waermeMwh || 0) / (0.45) * pGas * 10 * mult;
      return 0;
    };

    // Filter to keys that have energy
    const activeKeys = keys.filter(k => {
      const wMwh = en[k]?.waermeMwh || 0;
      return wMwh > 0.01;
    });
    if (activeKeys.length < 2) {
      ctx.fillStyle = '#78909c'; ctx.font = '10px system-ui';
      ctx.fillText('Mind. 2 Erzeuger mit Wärmeproduktion nötig.', 20, H / 2);
      return;
    }

    // Compute ranks per multiplier
    const rankings = {}; // key -> [ranks]
    multipliers.forEach((mult, mi) => {
      const costs = activeKeys.map(k => ({ k, cost: priceFor(k, mult) }));
      costs.sort((a, b) => a.cost - b.cost);
      costs.forEach((c, rank) => {
        if (!rankings[c.k]) rankings[c.k] = [];
        rankings[c.k][mi] = rank + 1;
      });
    });

    const nRanks = activeKeys.length;
    const pad = { top: 20, right: 90, bottom: 28, left: 90 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;
    function xPos(i) { return pad.left + (i / (multipliers.length - 1)) * pw; }
    function yPos(rank) { return pad.top + ((rank - 1) / Math.max(1, nRanks - 1)) * ph; }

    // Grid
    for (let r = 1; r <= nRanks; r++) {
      const y = yPos(r);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui'; ctx.textAlign = 'right';
      ctx.fillText('Rang ' + r, pad.left - 8, y + 3);
    }

    // X labels
    ctx.textAlign = 'center';
    multipliers.forEach((m, i) => {
      ctx.fillStyle = '#78909c'; ctx.font = '9px system-ui';
      ctx.fillText(mLabels[i], xPos(i), H - pad.bottom + 16);
    });
    ctx.fillText('Energiepreise', pad.left + pw / 2, H - 4);

    // Lines
    activeKeys.forEach(k => {
      const ranks = rankings[k];
      const color = _daColor(k);
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      ranks.forEach((rank, i) => {
        const x = xPos(i), y = yPos(rank);
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = xPos(i - 1), prevY = yPos(ranks[i - 1]);
          const cpx = (prevX + x) / 2;
          ctx.bezierCurveTo(cpx, prevY, cpx, y, x, y);
        }
      });
      ctx.stroke();

      // Dots
      ranks.forEach((rank, i) => {
        ctx.fillStyle = color; ctx.beginPath();
        ctx.arc(xPos(i), yPos(rank), 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#23262f'; ctx.beginPath();
        ctx.arc(xPos(i), yPos(rank), 1.5, 0, Math.PI * 2); ctx.fill();
      });

      // Left label
      ctx.fillStyle = color; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(DA_LABELS[k] || k, pad.left - 12, yPos(ranks[0]) + 3);
      // Right label
      ctx.textAlign = 'left';
      ctx.fillText(DA_LABELS[k] || k, W - pad.right + 12, yPos(ranks[ranks.length - 1]) + 3);
    });
  };
  if (canvas.clientWidth > 10) _doDraw();
  else requestAnimationFrame(_doDraw);
}

// ── Init (CalcEngine now available) ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof glInit === 'function') glInit();
  if (typeof redrawErzeugerIcons === 'function') redrawErzeugerIcons();
});
if (document.readyState !== 'loading') {
  if (typeof glInit === 'function') glInit();
  if (typeof redrawErzeugerIcons === 'function') redrawErzeugerIcons();
}
