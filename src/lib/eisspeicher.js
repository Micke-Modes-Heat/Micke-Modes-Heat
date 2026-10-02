// ── lib/eisspeicher.js — Eisspeicher als Wärmequelle einer Sole-Wasser-Wärmepumpe ──
// DOM-frei. Ein erdverlegter, ungedämmter Wasserspeicher dient der Wärmepumpe als Quelle. Die WP entzieht
// zuerst fühlbare Wärme (Wasser kühlt bis 0 °C ab), danach Kristallisationswärme (Wasser gefriert bei 0 °C).
// Regeneriert wird über Solar-Luftabsorber (Sonne und Umgebungsluft) und über das umgebende Erdreich.
// Ist der zulässige Vereisungsgrad erreicht, steht die Quelle nicht mehr zur Verfügung; andere Erzeuger
// (Luft-WP, Gaskessel, Auto-Kessel) übernehmen dann über die Merit-Order.
//
// Zustand w [kWh] = Energieinhalt bezogen auf „gesamtes Wasser flüssig bei 0 °C“:
//   w > 0 → flüssig, T = w / (V · c_p)        w < 0 → teilweise gefroren, T = 0 °C, Eisanteil = −w / (V · L)
//
// Annahmen (plausible Literatur- und Herstellerwerte, im Panel überschreibbar bzw. dokumentiert):
//   Schmelzwärme Wasser 334 kJ/kg → 92,8 kWh/m³; c_p 4,19 kJ/(kg·K) → 1,163 kWh/(m³·K)
//   Faustwerte Auslegung: ≈ 1 m³ Speicher und ≈ 2,6 m² Solar-Luftabsorber je kW WP-Heizleistung
//   (Hersteller-Planungsregeln Einfamilien- bis Quartiersanlagen); max. Vereisungsgrad 85 % (konservativ,
//   manche Hersteller erlauben Vollvereisung); Speicher bis 25 °C regenerierbar.
//   Absorber unverglast im Solekreis vor dem Speicher (Direkt- und Regenerationsbetrieb): η₀ = 0,85,
//   Wärmeübergang Luft 15 W/(m²·K), mittlere Fluidtemperatur 3 K unter Speichertemperatur.
//   Damit bestätigt das Modell die Herstellerregel: 2,6 m²/kW reichen, ~1,5 m²/kW wird knapp.
//   Erdreich: ungedämmter Zylinder (Höhe = Durchmesser), U = 0,9 W/(m²·K), Erdreich in 3 m Tiefe 10 ± 4 °C.
//   Soletemperatur 4 K unter Speichertemperatur. Einstrahlung: Monats-Sinusmodell (Süd, geneigt) mit
//   Bewölkungsfaktor 0,65. Kosten: Speicher 750 €/m³ inkl. Erdarbeiten, Absorber 350 €/m² inkl. Montage.

export const EIS = Object.freeze({
  latentKwhProM3: 334 * 1000 / 3600,       // 92,8 kWh/m³
  cpKwhProM3K: 4.187 * 1000 / 3600,        // 1,163 kWh/(m³·K)
  m3ProKw: 1.0,
  absorberM2ProKw: 2.6,
  maxVereisung: 0.85,
  tMax: 25,
  tStart: 10,
  absorberEta0: 0.85,
  absorberUL: 15,
  absorberDeltaT: -3,
  erdU: 0.9,
  erdMittel: 10,
  erdAmplitude: 4,
  soleDeltaT: 4,
  bewoelkung: 0.65,
  kostenSpeicherProM3: 750,
  kostenAbsorberProM2: 350,
});

/** Faustwert-Auslegung aus der WP-Heizleistung (kW). */
export function eisAuslegungVorschlag(wpKw) {
  const kw = Math.max(0, Number(wpKw) || 0);
  return {
    volumenM3: Math.max(5, Math.round(kw * EIS.m3ProKw / 5) * 5),
    absorberM2: Math.max(10, Math.round(kw * EIS.absorberM2ProKw / 5) * 5),
  };
}

/** Zylinder mit Höhe = Durchmesser: Durchmesser und erdberührte Oberfläche. */
export function eisGeometrie(volumenM3) {
  const v = Math.max(0, Number(volumenM3) || 0);
  const d = Math.cbrt(4 * v / Math.PI);
  return { durchmesserM: d, oberflaecheM2: 1.5 * Math.PI * d * d };
}

const G_PEAK = [280, 400, 550, 700, 800, 850, 830, 750, 600, 400, 280, 230];
const SONNE = [[8, 16], [7, 17], [7, 18], [6, 20], [5, 21], [5, 21], [5, 21], [6, 20], [7, 19], [7, 18], [8, 16], [8, 16]];
const MONATSSTART_TAG = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function monatAusTag(tag) {
  let m = 0;
  while (m < 11 && tag >= MONATSSTART_TAG[m + 1]) m++;
  return m;
}

/** Mittlere Einstrahlung auf die Absorberfläche [W/m²] in Jahresstunde t (Sinusmodell × Bewölkung). */
export function eisEinstrahlung(t) {
  const tag = Math.floor(t / 24) % 365, h = t % 24, m = monatAusTag(tag);
  const [auf, unter] = SONNE[m];
  if (h < auf || h >= unter) return 0;
  return G_PEAK[m] * Math.sin(Math.PI * (h - auf + 0.5) / (unter - auf)) * EIS.bewoelkung;
}

/** Erdreichtemperatur in Speichertiefe (gedämpft und verzögert: Minimum Mitte Februar). */
export function eisErdreichTemp(t) {
  const tag = Math.floor(t / 24) % 365;
  return EIS.erdMittel + EIS.erdAmplitude * Math.sin(2 * Math.PI * (tag - 135) / 365);
}

/** Grobe Quelltemperatur ohne Simulation (für Auslegungs-/Schnellrechnungen): Winter Eisbetrieb, Sommer warm. */
export function eisQuellTempNaeherung(t) {
  const m = monatAusTag(Math.floor(t / 24) % 365);
  const winter = m <= 2 || m >= 10;
  return (winter ? 0 : 8) - EIS.soleDeltaT;
}

/** Parameter vervollständigen und begrenzen. */
export function eisParameter(p = {}) {
  const volumenM3 = Math.max(0, Number(p.volumenM3) || 0);
  const absorberM2 = Math.max(0, Number(p.absorberM2) || 0);
  const maxVereisung = Math.min(1, Math.max(0.1, (Number(p.maxVereisungPct) || EIS.maxVereisung * 100) / 100));
  const geo = eisGeometrie(volumenM3);
  const cp = volumenM3 * EIS.cpKwhProM3K;
  return {
    volumenM3, absorberM2, maxVereisung, ...geo,
    cpKwhK: cp,
    latentKwh: volumenM3 * EIS.latentKwhProM3 * maxVereisung,
    wMin: -volumenM3 * EIS.latentKwhProM3 * maxVereisung,
    wMax: cp * EIS.tMax,
    erdUAKwK: EIS.erdU * geo.oberflaecheM2 / 1000,
    startW: p.startW != null && Number.isFinite(Number(p.startW)) ? Number(p.startW) : cp * EIS.tStart,
  };
}

/**
 * Zustandsautomat für die Stundensimulation. Ablauf je Stunde: regenerieren(t, tLuft) → WP fragt quellTemp(),
 * verfuegbarKwh() und meldet entziehen(kWh) → am Ende stundeAbschliessen().
 */
export function erstelleEisZustand(param) {
  const p = eisParameter(param);
  let w = Math.min(p.wMax, Math.max(p.wMin, p.startW));
  const st = {
    entzugKwh: 0, absorberKwh: 0, erdreichKwh: 0, erdVerlustKwh: 0,
    maxVereisung: 0, minTemp: Infinity, maxTemp: -Infinity, gesperrtH: 0, eisStunden: 0,
    vereisungMonat: new Float32Array(12), tempMonat: new Float32Array(12),
  };
  let entzugDieseStunde = 0, gesperrtGemeldet = false;
  const temp = () => (w > 0 ? w / p.cpKwhK : 0);
  const vereisung = () => (w < 0 ? -w / (p.volumenM3 * EIS.latentKwhProM3) : 0);
  const zustand = {
    param: p,
    get w() { return w; },
    temp, vereisung,
    regenerieren(t, tLuft) {
      entzugDieseStunde = 0; gesperrtGemeldet = false;
      const ts = temp();
      // Erdreich: in beide Richtungen (im Sommer gibt ein warmer Speicher Wärme ab)
      const qErd = p.erdUAKwK * (eisErdreichTemp(t) - ts);
      if (qErd >= 0) st.erdreichKwh += Math.min(qErd, p.wMax - w); else st.erdVerlustKwh -= qErd;
      w = Math.min(p.wMax, w + qErd);
      // Absorber: nur Betrieb, wenn er Wärme liefert und der Speicher Platz hat
      if (p.absorberM2 > 0 && w < p.wMax) {
        const tFluid = temp() + EIS.absorberDeltaT;   // negativ: Absorber im kalten Solerücklauf
        const qW = EIS.absorberEta0 * eisEinstrahlung(t) + EIS.absorberUL * (tLuft - tFluid);
        if (qW > 0) {
          const q = Math.min(p.absorberM2 * qW / 1000, p.wMax - w);
          w += q; st.absorberKwh += q;
        }
      }
    },
    quellTemp() { return temp() - EIS.soleDeltaT; },
    verfuegbarKwh() { return Math.max(0, w - p.wMin); },
    gesperrt() { return w - p.wMin < 0.01; },
    entziehen(kwh) {
      const q = Math.max(0, Math.min(kwh, w - p.wMin));
      w -= q; st.entzugKwh += q; entzugDieseStunde += q;
      return q;
    },
    /** Stunde zählen, in der die Quelle die WP begrenzt hat (Vereisungsgrenze erreicht). */
    meldeGesperrt() { if (!gesperrtGemeldet) { st.gesperrtH++; gesperrtGemeldet = true; } },
    stundeAbschliessen(t) {
      const v = vereisung(), ts = temp(), m = monatAusTag(Math.floor(t / 24) % 365);
      if (v > st.maxVereisung) st.maxVereisung = v;
      if (ts < st.minTemp) st.minTemp = ts;
      if (ts > st.maxTemp) st.maxTemp = ts;
      if (v > 0) st.eisStunden++;
      if (v > st.vereisungMonat[m]) st.vereisungMonat[m] = v;
      st.tempMonat[m] += ts / ((m === 1 ? 28 : [3, 5, 8, 10].includes(m) ? 30 : 31) * 24);
    },
    statistik() {
      return {
        ...st, vereisungMonat: [...st.vereisungMonat], tempMonat: [...st.tempMonat],
        endW: w, minTemp: Number.isFinite(st.minTemp) ? st.minTemp : temp(), maxTemp: Number.isFinite(st.maxTemp) ? st.maxTemp : temp(),
        volumenM3: p.volumenM3, absorberM2: p.absorberM2, latentKwh: p.latentKwh, maxVereisungZulaessig: p.maxVereisung,
      };
    },
  };
  return zustand;
}

/** Investition Quellenanlage (ohne Wärmepumpe). */
export function eisInvest(volumenM3, absorberM2) {
  return Math.round((Number(volumenM3) || 0) * EIS.kostenSpeicherProM3 + (Number(absorberM2) || 0) * EIS.kostenAbsorberProM2);
}

/** Bewertung der Jahressimulation für Panel und Gutachten. */
export function eisBewertung(stat) {
  if (!stat) return null;
  const regen = stat.absorberKwh + stat.erdreichKwh;
  const status = stat.gesperrtH > 200 ? 'unterdimensioniert' : stat.gesperrtH > 0 ? 'knapp' : stat.maxVereisung > 0.6 ? 'gut ausgelastet' : 'ausreichend';
  return {
    status,
    absorberAnteil: regen > 0 ? stat.absorberKwh / regen : 0,
    erdreichAnteil: regen > 0 ? stat.erdreichKwh / regen : 0,
    latentGenutzt: stat.maxVereisung,
  };
}
