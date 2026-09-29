// ── lib/autarkie-h2-core.js — Autarkieziel mit Batterie und Wasserstoff ─────
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.
// Die app-seitige Schicht (Ansicht in der PV-Analyse) liegt in 31-autarkieziel.js.
//
// Fragestellung: In JEDER Stunde des Jahres soll mindestens ein Anteil z (z. B.
// 30 %) der elektrischen Last aus eigener erneuerbarer Erzeugung oder aus
// Speichern gedeckt werden. Gesucht ist die kostengünstigste Kombination aus
// PV, Batterie und Wasserstoffkette (Elektrolyseur → Drucktank → Brennstoffzelle).
//
// Rechenweg (stündlich, 8.760 h):
//   1. Direktverbrauch: min(Erzeugung, Last)
//   2. Überschuss lädt zuerst die Batterie (Wirkungsgrad hoch), der Rest steht
//      dem Elektrolyseur zur Verfügung, was dann noch übrig ist, wird eingespeist
//      (bis zur NAP-Grenze) oder abgeregelt.
//   3. Die Batterie deckt die Zielunterdeckung vorrangig aus dem ganzen Ladestand,
//      Last oberhalb des Ziels nur aus dem Teil über einer Reserve. Reserve 0 =
//      reiner Eigenverbrauch, Reserve 1 = Batterie arbeitet nur für das Ziel.
//   4. Was dann am Ziel noch fehlt, liefert die Brennstoffzelle, den Rest das Netz.
// Die Batterie hängt nicht vom Wasserstoff ab (sie lädt vor dem Elektrolyseur und
// entlädt vor der Brennstoffzelle) — deshalb lässt sich die H2-Kette je PV/Batterie-
// Kombination geschlossen auslegen:
//   Brennstoffzelle = größte verbleibende Zielunterdeckung (optional ohne die
//                     n schlechtesten Stunden, Toleranz)
//   Tank            = größter zyklischer Fehlbetrag der H2-Bilanz über das Jahr
//   Elektrolyseur   = Leistung, bei der Tank + Elektrolyseur am wenigsten kosten
//                     (mindestens so groß, dass die Jahresbilanz aufgeht)
//
// Energiegrößen des Wasserstoffs beziehen sich auf den unteren Heizwert (Hu).
//
// Alternative/Ergänzung: ein BHKW mit biogenem Brennstoff (Biomethan, HVO,
// Pflanzenöl). Es läuft NACH der Brennstoffzelle: erst wird der aus Überschuss
// erzeugte Wasserstoff genutzt, erst bei leerem (oder begrenztem) Tank der
// zugekaufte Brennstoff. Varianten: nur H₂, nur BHKW, Kombination (kleiner Tank +
// BHKW). Eine Tank-Obergrenze (z. B. unter 3 t / 5 t H₂ wegen BImSchG bzw.
// Störfall-Verordnung) wirkt als harte Nebenbedingung.

/** Heizwert Wasserstoff (Hu): 33,33 kWh/kg */
export const H2_KWH_PRO_KG = 33.33;

/** Dichte von Wasserstoff bei 15 °C (kg/m³) je Speicherdruck — Richtwerte */
export const H2_DICHTE_KG_M3 = Object.freeze({ 30: 2.5, 200: 14.9, 300: 20.8, 500: 31.0 });

/**
 * Standardannahmen. Kosten sind Richtwerte für kleine bis mittlere Anlagen
 * (Stand 2025/26) und im Projekt überschreibbar.
 */
export const AH2_STANDARD = Object.freeze({
  zielPct: 30,             // Mindestdeckung je Stunde in % der Last
  toleranzH: 0,            // zulässige Stunden/a unter dem Ziel (schlechteste Stunden)
  zins: 0.035,
  pv:   Object.freeze({ investKwp: 1200, life: 20, ih: 0.01 }),
  bat:  Object.freeze({ investKwh: 400, life: 15, ih: 0.01, eta: 0.90, cRate: 0.5 }),
  // Elektrolyseur (PEM) inkl. Verdichtung auf Speicherdruck: ≈ 55–58 kWh_el/kg
  ely:  Object.freeze({ investKw: 1800, life: 20, ih: 0.03, eta: 0.60, abwaerme: 0.20 }),
  // Brennstoffzelle (PEM, stationär): el. Wirkungsgrad bezogen auf Hu
  bz:   Object.freeze({ investKw: 2500, life: 15, ih: 0.03, eta: 0.50, abwaerme: 0.35 }),
  // Drucktank inkl. Armaturen: 20 €/kWh ≈ 670 €/kg
  tank: Object.freeze({ investKwh: 20, life: 30, ih: 0.01, druckBar: 300 }),
  preise: Object.freeze({ pStrom: 30, pEinsp: 8, pWaerme: 0 }),   // ct/kWh; Wärme 0 = nicht angerechnet
  h2Aktiv: true,
  tankMaxKg: 0,            // Obergrenze des H₂-Tanks in kg; 0 = unbegrenzt
  bhkwAktiv: false,
  bhkwBrennstoff: 'biomethan',
  // BHKW (Motor) mit biogenem Brennstoff; Brennstoffpreis je kWh Hu, Wartung je kWh Strom
  bhkw: Object.freeze({ investKw: 1600, life: 15, ih: 0.01, wartungCt: 2.0, etaEl: 0.38, etaTh: 0.48, brennstoffCt: 12 }),
});

/** Brennstoff-Vorlagen für das BHKW (Richtwerte, Hu-bezogen; im Projekt überschreibbar) */
export const AH2_BRENNSTOFFE = Object.freeze({
  biomethan:   Object.freeze({ label: 'Biomethan (Gasnetz)', brennstoffCt: 12, etaEl: 0.38, etaTh: 0.48,
    hinweis: 'bilanziell über das Gasnetz bezogen — physisch Netzgas; braucht Gasanschluss' }),
  hvo:         Object.freeze({ label: 'HVO (hydriertes Pflanzenöl)', brennstoffCt: 20, etaEl: 0.40, etaTh: 0.45,
    hinweis: 'flüssig, lange lagerfähig, auch für Notstromaggregate; Lagerung nach AwSV' }),
  pflanzenoel: Object.freeze({ label: 'Pflanzenöl (Raps)', brennstoffCt: 13, etaEl: 0.40, etaTh: 0.45,
    hinweis: 'flüssig lagerfähig, Motor muss pflanzenöltauglich sein; Lagerung nach AwSV' }),
});

/** Annuitätenfaktor */
export function ah2AnnF(z, n) {
  if (!(n > 0)) return 0;
  if (!z || z <= 0) return 1 / n;
  const q = Math.pow(1 + z, n);
  return z * q / (q - 1);
}

/** Einstellungen tief mit den Standardwerten mischen (nur gültige Zahlen übernehmen). */
export function ah2Mischen(e) {
  const out = JSON.parse(JSON.stringify(AH2_STANDARD));
  const zahl = v => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  if (!e || typeof e !== 'object') return out;
  for (const k of ['zielPct', 'toleranzH', 'zins', 'tankMaxKg']) if (zahl(e[k]) != null) out[k] = e[k];
  for (const k of ['h2Aktiv', 'bhkwAktiv']) if (typeof e[k] === 'boolean') out[k] = e[k];
  if (AH2_BRENNSTOFFE[e.bhkwBrennstoff]) {
    out.bhkwBrennstoff = e.bhkwBrennstoff;
    // Vorlage des Brennstoffs zuerst, eigene Abweichungen (e.bhkw) danach
    const v = AH2_BRENNSTOFFE[e.bhkwBrennstoff];
    for (const k of ['brennstoffCt', 'etaEl', 'etaTh']) out.bhkw[k] = v[k];
  }
  for (const g of ['pv', 'bat', 'ely', 'bz', 'tank', 'preise', 'bhkw']) {
    if (!e[g] || typeof e[g] !== 'object') continue;
    for (const k of Object.keys(out[g])) if (zahl(e[g][k]) != null) out[g][k] = e[g][k];
  }
  out.zielPct = Math.min(100, Math.max(0, out.zielPct));
  out.toleranzH = Math.max(0, Math.round(out.toleranzH));
  out.tankMaxKg = Math.max(0, out.tankMaxKg || 0);
  return out;
}

/**
 * Grenzkosten des BHKW-Stroms (ct/kWh): Brennstoff ÷ η_el + Wartung − Wärmegutschrift.
 * Liegt er unter dem Strombezugspreis, läuft das BHKW nicht nur für das Ziel,
 * sondern deckt im Rahmen seiner Leistung die ganze Restlast (wirtschaftlicher Betrieb).
 */
export function ah2BhkwGrenzkosten(cfg) {
  const b = cfg.bhkw;
  const gutschrift = (cfg.preise.pWaerme || 0) * (b.etaTh / b.etaEl);
  return b.brennstoffCt / b.etaEl + b.wartungCt - gutschrift;
}

const _MONATSTAGE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Monatsindex (0–11) je Stunde eines 8.760-h-Jahres */
export function ah2MonatVonStunde(t) {
  let tag = Math.floor(t / 24);
  for (let m = 0; m < 12; m++) { if (tag < _MONATSTAGE[m]) return m; tag -= _MONATSTAGE[m]; }
  return 11;
}

// ══════════════════════════════════════════════════════════════════════════════
// BATTERIE-DISPATCH (unabhängig vom Wasserstoff)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Stündlicher Dispatch aus Erzeugung, Last und Batterie.
 *
 * @param {{last:ArrayLike<number>, pvKwProKwp:ArrayLike<number>, windKw?:ArrayLike<number>|null}} inp
 *   last in kW je Stunde, pvKwProKwp = PV-Leistung je kWp (kW/kWp) je Stunde
 * @param {{pvKwp:number, batKwh:number, batReserve?:number, ziel:number}} ausl  ziel als Anteil 0..1
 * @param {{eta:number, cRate:number}} bat
 * @returns {{ueber:Float32Array, zielRest:Float32Array, lastRest:Float32Array,
 *   direktKwh:number, batLadKwh:number, batEntlKwh:number, batVerlustKwh:number,
 *   lastKwh:number, erzKwh:number, batSoc:Float32Array}}
 *   ueber    = Überschuss nach Batterie (für Elektrolyseur / Einspeisung)
 *   zielRest = Zielunterdeckung nach Batterie (für die Brennstoffzelle)
 *   lastRest = gesamte verbleibende Last nach Batterie (Netz + Brennstoffzelle)
 *   batSoc/batLad/batEntl/direkt = Stundenreihen (Ladestand am Stundenende, kWh je Stunde)
 */
export function ah2BatDispatch(inp, ausl, bat) {
  const N = inp.last.length;
  const cap = Math.max(0, ausl.batKwh || 0);
  const pBat = cap * (bat.cRate || 0.5);
  const eta = bat.eta || 0.9;
  const reserve = cap * Math.min(1, Math.max(0, ausl.batReserve || 0));
  const z = Math.min(1, Math.max(0, ausl.ziel));
  const ueber = new Float32Array(N), zielRest = new Float32Array(N), lastRest = new Float32Array(N);
  const batSoc = new Float32Array(N), batLad = new Float32Array(N), batEntl = new Float32Array(N), direkt = new Float32Array(N);
  let direktKwh = 0, batLadKwh = 0, batEntlKwh = 0, batVerlustKwh = 0, lastKwh = 0, erzKwh = 0;

  // Zwei Durchläufe: der erste bringt den Ladestand auf den zyklischen Jahreswert,
  // gezählt wird nur der zweite (sonst startet der 1. Januar künstlich leer).
  let soc = 0;
  for (let pass = 0; pass < (cap > 0 ? 2 : 1); pass++) {
    const zaehlen = pass === (cap > 0 ? 1 : 0);
    for (let t = 0; t < N; t++) {
      const L = Math.max(0, inp.last[t] || 0);
      const G = Math.max(0, (inp.pvKwProKwp[t] || 0) * ausl.pvKwp + (inp.windKw ? (inp.windKw[t] || 0) : 0));
      const d = Math.min(G, L);
      let rL = L - d, rG = G - d;
      let zr = Math.max(0, z * L - d);
      let lad = 0, entl = 0;
      if (cap > 0) {
        if (rG > 0 && soc < cap) {
          lad = Math.min(rG, pBat, (cap - soc) / eta);
          soc += lad * eta; rG -= lad;
        }
        if (rL > 0 && soc > 0) {
          // a: Zielunterdeckung aus dem gesamten Ladestand
          const a = Math.min(zr, pBat, soc * eta);
          // b: Last über dem Ziel nur aus dem Teil oberhalb der Reserve
          const frei = Math.max(0, soc - a / eta - reserve) * eta;
          const b = Math.max(0, Math.min(rL - a, pBat - a, frei));
          entl = a + b;
          soc -= entl / eta; rL -= entl; zr = Math.max(0, zr - entl);
          if (soc < 0) soc = 0;
        }
      }
      if (zaehlen) {
        ueber[t] = rG; zielRest[t] = zr; lastRest[t] = rL; batSoc[t] = soc;
        batLad[t] = lad; batEntl[t] = entl; direkt[t] = d;
        direktKwh += d; batLadKwh += lad; batEntlKwh += entl;
        batVerlustKwh += lad * (1 - eta) + (entl / eta - entl);
        lastKwh += L; erzKwh += G;
      }
    }
  }
  return { ueber, zielRest, lastRest, direktKwh, batLadKwh, batEntlKwh, batVerlustKwh, lastKwh, erzKwh,
           batSoc, batLad, batEntl, direkt };
}

// ══════════════════════════════════════════════════════════════════════════════
// WASSERSTOFFKETTE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Brennstoffzellen-Leistung: größte Zielunterdeckung, ohne die `toleranzH`
 * schlechtesten Stunden (dort bleibt ein Rest ungedeckt).
 */
export function ah2BzLeistung(zielRest, toleranzH = 0) {
  const pos = [];
  for (let t = 0; t < zielRest.length; t++) if (zielRest[t] > 1e-6) pos.push(zielRest[t]);
  if (pos.length <= toleranzH) return 0;
  pos.sort((a, b) => b - a);
  return pos[toleranzH];
}

/**
 * Kleinster Tank für einen zyklischen Jahresbetrieb.
 * Bei Jahressaldo ≥ 0 ist das der größte Fehlbetrag über ein beliebiges
 * (auch über den Jahreswechsel reichendes) Zeitfenster: Man startet das Fenster
 * mit vollem Tank, Überschuss bei vollem Tank geht verloren (wird eingespeist).
 * @param {ArrayLike<number>} prod  H2-Erzeugung je Stunde (kWh Hu)
 * @param {ArrayLike<number>} verbr H2-Verbrauch je Stunde (kWh Hu)
 * @returns {{kapKwh:number, saldoKwh:number}}  kapKwh = Infinity, wenn die Jahresbilanz nicht aufgeht
 */
export function ah2TankBedarf(prod, verbr) {
  const N = prod.length;
  let saldo = 0;
  for (let t = 0; t < N; t++) saldo += prod[t] - verbr[t];
  if (saldo < -1e-6) return { kapKwh: Infinity, saldoKwh: saldo };
  let cum = 0, peak = 0, maxDD = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < N; t++) {
      cum += prod[t] - verbr[t];
      if (cum > peak) peak = cum;
      else if (peak - cum > maxDD) maxDD = peak - cum;
    }
  }
  return { kapKwh: maxDD, saldoKwh: saldo };
}

/** Jährliche H2-Erzeugung (kWh Hu) bei Elektrolyseurleistung P */
function _h2Prod(ueber, P, eta) {
  let s = 0;
  for (let t = 0; t < ueber.length; t++) s += Math.min(ueber[t], P);
  return s * eta;
}

/** Kleinste Elektrolyseurleistung, bei der die Jahresbilanz aufgeht (Binärsuche) */
export function ah2ElyMin(ueber, bedarfH2Kwh, eta) {
  if (bedarfH2Kwh <= 0) return 0;
  let maxU = 0;
  for (let t = 0; t < ueber.length; t++) if (ueber[t] > maxU) maxU = ueber[t];
  if (_h2Prod(ueber, maxU, eta) < bedarfH2Kwh) return Infinity;
  let lo = 0, hi = maxU;
  for (let i = 0; i < 40 && hi - lo > Math.max(0.1, hi * 1e-4); i++) {
    const m = (lo + hi) / 2;
    if (_h2Prod(ueber, m, eta) >= bedarfH2Kwh) hi = m; else lo = m;
  }
  return hi;
}

// ══════════════════════════════════════════════════════════════════════════════
// BILANZ + KOSTEN EINER AUSLEGUNG
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Jahresbilanz einer vollständigen Auslegung. Reihenfolge je Stunde nach der
 * Batterie: Elektrolyseur aus dem Überschuss → Brennstoffzelle für das Ziel →
 * BHKW für den Rest des Ziels (bei wirtschaftlichem Betrieb für die ganze
 * Restlast) → Netz. Mit `exakt` wird der Tank stündlich mitgeführt (zwei Jahre
 * ab vollem Tank, gezählt das zweite). Ohne `exakt` (Suche, nur H₂) gilt: der
 * Tank ist groß genug, und der Elektrolyseur nimmt, was er kann.
 *
 * @param {object} disp   Ergebnis von ah2BatDispatch
 * @param {{elyKw:number, bzKw:number, tankKwh:number, bhkwKw?:number, bhkwZuerst?:boolean}} h2
 *   bhkwZuerst = BHKW als Grundlast vor der Brennstoffzelle (Wasserstoff nur für die Spitzen)
 * @param {object} cfg    gemischte Einstellungen (ah2Mischen)
 * @param {{napEinspKw?:number|null, exakt?:boolean, reihen?:boolean, nachBz?:boolean}} opt
 *   nachBz = Reihe der Zielunterdeckung nach der Brennstoffzelle zurückgeben (BHKW-Auslegung)
 */
export function ah2Bilanz(disp, h2, cfg, opt = {}) {
  const N = disp.ueber.length;
  const etaE = cfg.ely.eta, etaB = cfg.bz.eta;
  const nap = opt.napEinspKw != null && opt.napEinspKw >= 0 ? opt.napEinspKw : Infinity;
  const tankKap = h2.tankKwh || 0;
  const bhkwKw = h2.bhkwKw || 0;
  const bhkwVoll = bhkwKw > 0 && ah2BhkwGrenzkosten(cfg) < cfg.preise.pStrom;
  const reihen = opt.reihen ? {
    bz: new Float32Array(N), ely: new Float32Array(N), netz: new Float32Array(N), bhkw: new Float32Array(N),
    tank: new Float32Array(N), einsp: new Float32Array(N), ungedeckt: new Float32Array(N), abreg: new Float32Array(N),
  } : null;
  const nachBz = opt.nachBz ? new Float32Array(N) : null;
  let elyInKwh = 0, bzOutKwh = 0, netzKwh = 0, einspKwh = 0, abregKwh = 0, bhkwKwh = 0;
  let h2ProdKwh = 0, h2VerbrKwh = 0, stundenUnter = 0, ungedecktKwh = 0;
  let tank = tankKap;
  const passes = opt.exakt ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const zaehlen = pass === passes - 1;
    for (let t = 0; t < N; t++) {
      // Elektrolyse aus dem Überschuss
      let elyIn = Math.min(disp.ueber[t], h2.elyKw || 0);
      if (opt.exakt) elyIn = Math.min(elyIn, Math.max(0, tankKap - tank) / etaE);
      const prod = elyIn * etaE;
      // BHKW als Grundlast (Variante „BHKW zuerst"): für das Ziel bzw. bei günstigem Strom für die Restlast
      const bhVor = h2.bhkwZuerst && bhkwKw > 0 ? Math.min(bhkwKw, bhkwVoll ? disp.lastRest[t] : disp.zielRest[t]) : 0;
      // Brennstoffzelle für die (verbleibende) Zielunterdeckung
      let bz = Math.min(Math.max(0, disp.zielRest[t] - bhVor), h2.bzKw || 0);
      if (opt.exakt) bz = Math.min(bz, Math.max(0, tank + prod) * etaB);
      const verbr = bz / etaB;
      if (opt.exakt) tank = Math.min(tankKap, Math.max(0, tank + prod - verbr));
      if (!zaehlen) continue;
      const zielNachBz = Math.max(0, disp.zielRest[t] - bhVor - bz);
      // BHKW nach der Brennstoffzelle: für das Ziel — oder, wenn sein Strom billiger als Netzstrom ist, für die Restlast
      const bh = h2.bhkwZuerst ? bhVor
        : bhkwKw > 0 ? Math.min(bhkwKw, bhkwVoll ? Math.max(0, disp.lastRest[t] - bz) : zielNachBz) : 0;
      const rest = disp.ueber[t] - elyIn;
      const einsp = Math.min(rest, nap);
      const netz = Math.max(0, disp.lastRest[t] - bz - bh);
      const luecke = h2.bhkwZuerst ? zielNachBz : Math.max(0, zielNachBz - bh);
      elyInKwh += elyIn; bzOutKwh += bz; h2ProdKwh += prod; h2VerbrKwh += verbr; bhkwKwh += bh;
      einspKwh += einsp; abregKwh += rest - einsp; netzKwh += netz;
      if (luecke > 1e-3) { stundenUnter++; ungedecktKwh += luecke; }
      if (nachBz) nachBz[t] = zielNachBz;
      if (reihen) {
        reihen.bz[t] = bz; reihen.ely[t] = elyIn; reihen.netz[t] = netz; reihen.bhkw[t] = bh;
        reihen.tank[t] = tank; reihen.einsp[t] = einsp; reihen.ungedeckt[t] = luecke; reihen.abreg[t] = rest - einsp;
      }
    }
  }
  const lastKwh = disp.lastKwh;
  const b = cfg.bhkw;
  const bhkwWaermeKwh = b.etaEl > 0 ? bhkwKwh * b.etaTh / b.etaEl : 0;
  return {
    lastMwh: lastKwh / 1000, erzMwh: disp.erzKwh / 1000,
    direktMwh: disp.direktKwh / 1000, batEntlMwh: disp.batEntlKwh / 1000, batVerlustMwh: disp.batVerlustKwh / 1000,
    elyInMwh: elyInKwh / 1000, bzOutMwh: bzOutKwh / 1000, h2ProdMwh: h2ProdKwh / 1000, h2VerbrMwh: h2VerbrKwh / 1000,
    bhkwMwh: bhkwKwh / 1000, bhkwBrennstoffMwh: b.etaEl > 0 ? bhkwKwh / b.etaEl / 1000 : 0, bhkwWaermeMwh: bhkwWaermeKwh / 1000,
    bhkwVoll,
    netzMwh: netzKwh / 1000, einspMwh: einspKwh / 1000, abregMwh: abregKwh / 1000,
    waermeMwh: (elyInKwh * cfg.ely.abwaerme + h2VerbrKwh * cfg.bz.abwaerme + bhkwWaermeKwh) / 1000,
    autarkiePct: lastKwh > 0 ? (1 - netzKwh / lastKwh) * 100 : 0,
    stundenUnter, ungedecktMwh: ungedecktKwh / 1000,
    reihen, nachBz,
  };
}

/**
 * Jahreskosten (€/a) einer Auslegung: Kapital + Instandhaltung aller Komponenten,
 * BHKW-Brennstoff und -Wartung, Netzbezug, abzüglich Einspeise- und (optional) Wärmeerlös.
 * @param {{pvKwp:number,batKwh:number,elyKw:number,bzKw:number,tankKwh:number,bhkwKw?:number}} a
 * @param {object} bil     Ergebnis von ah2Bilanz
 * @param {object} cfg
 * @param {number} infraJk  PV-Infrastruktur €/a (Netzanschluss-Stufen der PV-Analyse)
 */
export function ah2Kosten(a, bil, cfg, infraJk = 0) {
  const z = cfg.zins;
  const k = (invest, g) => invest * (ah2AnnF(z, g.life) + g.ih);
  const inv = {
    pv: a.pvKwp * cfg.pv.investKwp,
    bat: a.batKwh * cfg.bat.investKwh,
    ely: a.elyKw * cfg.ely.investKw,
    bz: a.bzKw * cfg.bz.investKw,
    tank: a.tankKwh * cfg.tank.investKwh,
    bhkw: (a.bhkwKw || 0) * cfg.bhkw.investKw,
  };
  const jk = {
    pv: k(inv.pv, cfg.pv), bat: k(inv.bat, cfg.bat), ely: k(inv.ely, cfg.ely),
    bz: k(inv.bz, cfg.bz), tank: k(inv.tank, cfg.tank), bhkw: k(inv.bhkw, cfg.bhkw), infra: infraJk || 0,
  };
  const p = cfg.preise;
  const netz = bil.netzMwh * p.pStrom * 10;
  const einsp = bil.einspMwh * p.pEinsp * 10;
  const waerme = bil.waermeMwh * (p.pWaerme || 0) * 10;
  // Brennstoff + Wartung des BHKW (verbrauchsabhängig)
  const brennstoff = (bil.bhkwBrennstoffMwh || 0) * cfg.bhkw.brennstoffCt * 10;
  const wartung = (bil.bhkwMwh || 0) * cfg.bhkw.wartungCt * 10;
  const kapital = jk.pv + jk.bat + jk.ely + jk.bz + jk.tank + jk.bhkw + jk.infra;
  const gesamt = kapital + netz + brennstoff + wartung - einsp - waerme;
  const referenz = bil.lastMwh * p.pStrom * 10;             // alles aus dem Netz
  const investGes = inv.pv + inv.bat + inv.ely + inv.bz + inv.tank + inv.bhkw;
  const h2Jk = jk.ely + jk.bz + jk.tank;
  return {
    invest: inv, investGes, jk, kapital, netz, einsp, waerme, brennstoff, wartung, gesamt, referenz,
    mehrkosten: gesamt - referenz,
    // Kosten der H2-Kette je kWh aus der Brennstoffzelle (ohne den Strom, der sonst eingespeist würde)
    h2CtKwh: bil.bzOutMwh > 0 ? h2Jk / (bil.bzOutMwh * 1000) * 100 : null,
    // Vollkosten je kWh aus dem BHKW (Anlage + Brennstoff + Wartung)
    bhkwCtKwh: bil.bhkwMwh > 0 ? (jk.bhkw + brennstoff + wartung) / (bil.bhkwMwh * 1000) * 100 : null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AUSLEGUNG DER SPEICHER / DES BHKW BEI GEGEBENER PV/BATTERIE
// ══════════════════════════════════════════════════════════════════════════════

const _ELY_FAKTOREN = [1.0, 1.1, 1.25, 1.5, 2, 2.5, 3.5, 5, 8];

/** Tank-Obergrenze in kWh (Infinity = unbegrenzt) */
function _tankKap(cfg) {
  return cfg.tankMaxKg > 0 ? cfg.tankMaxKg * H2_KWH_PRO_KG : Infinity;
}

/**
 * H2-Kette (ohne BHKW) für einen Batterie-Dispatch auslegen (kostenminimal).
 * Mit `ohneObergrenze` wird die Tank-Obergrenze ignoriert (Referenz für die Kombination).
 * @returns {{machbar:boolean, elyKw:number, bzKw:number, tankKwh:number, grund?:string, obergrenze?:boolean}}
 */
export function ah2H2Auslegen(disp, cfg, opt = {}) {
  const N = disp.zielRest.length;
  const bzKw = ah2BzLeistung(disp.zielRest, cfg.toleranzH);
  if (bzKw <= 0) return { machbar: true, elyKw: 0, bzKw: 0, tankKwh: 0 };
  const etaE = cfg.ely.eta, etaB = cfg.bz.eta;
  const kap = opt.ohneObergrenze ? Infinity : _tankKap(cfg);
  const verbr = new Float32Array(N);
  let bedarf = 0;
  for (let t = 0; t < N; t++) { verbr[t] = Math.min(disp.zielRest[t], bzKw) / etaB; bedarf += verbr[t]; }
  const pMin = ah2ElyMin(disp.ueber, bedarf, etaE);
  if (!Number.isFinite(pMin)) {
    let prodMax = 0;
    for (let t = 0; t < N; t++) prodMax += disp.ueber[t];
    return { machbar: false, elyKw: 0, bzKw, tankKwh: 0,
      fehltH2Mwh: (bedarf - prodMax * etaE) / 1000,
      grund: 'Der Überschuss reicht nicht, um den Wasserstoff für das Ziel zu erzeugen.' };
  }
  let maxU = 0;
  for (let t = 0; t < N; t++) if (disp.ueber[t] > maxU) maxU = disp.ueber[t];
  const z = cfg.zins;
  const kEly = cfg.ely.investKw * (ah2AnnF(z, cfg.ely.life) + cfg.ely.ih);
  const kTank = cfg.tank.investKwh * (ah2AnnF(z, cfg.tank.life) + cfg.tank.ih);
  const prod = new Float32Array(N);
  let best = null, zuGross = false;
  const probiert = new Set();
  // Etwas über pMin anfangen: exakt auf der Grenze wird der Tank unendlich groß.
  // Mit Obergrenze auch große Elektrolyseure probieren — sie füllen den Tank in kürzeren Fenstern.
  const leistungen = _ELY_FAKTOREN.map(f => pMin * f * 1.002);
  if (Number.isFinite(kap)) for (const f of [0.25, 0.5, 0.75, 1]) leistungen.push(maxU * f);
  for (const P0 of leistungen) {
    const P = Math.min(maxU, P0);
    const key = Math.round(P * 10);
    if (probiert.has(key) || P < pMin) continue;
    probiert.add(key);
    for (let t = 0; t < N; t++) prod[t] = Math.min(disp.ueber[t], P) * etaE;
    const tb = ah2TankBedarf(prod, verbr);
    if (!Number.isFinite(tb.kapKwh)) continue;
    // Kleiner Sicherheitszuschlag gegen Rundung bei der stündlichen Nachrechnung
    const tankKwh = tb.kapKwh * 1.01 + 1;
    if (tankKwh > kap) { zuGross = true; continue; }
    const kosten = P * kEly + tankKwh * kTank;
    if (!best || kosten < best.kosten) best = { elyKw: P, tankKwh, kosten };
  }
  if (!best) {
    return zuGross
      ? { machbar: false, elyKw: 0, bzKw, tankKwh: 0, obergrenze: true, grund: 'Der nötige Tank überschreitet die Obergrenze.' }
      : { machbar: false, elyKw: 0, bzKw, tankKwh: 0, grund: 'Tank lässt sich nicht schließen.' };
  }
  return { machbar: true, elyKw: best.elyKw, bzKw, tankKwh: best.tankKwh };
}

/**
 * Kombination: begrenzter Tank + BHKW für die Stunden, in denen der Wasserstoff
 * nicht reicht. Probiert Tankgrößen (bis zur Obergrenze) und dazu passende
 * Elektrolyseure, rechnet jede Variante stündlich exakt und legt das BHKW auf
 * die verbleibende Zielunterdeckung aus.
 * @returns {{machbar:boolean, a?:object, bil?:object, kosten?:object}}
 */
export function ah2KombiAuslegen(disp, cfg, inp, basis, opt = {}) {
  const N = disp.zielRest.length;
  const bzKw = ah2BzLeistung(disp.zielRest, cfg.toleranzH);
  if (bzKw <= 0) return { machbar: false };
  const etaE = cfg.ely.eta;
  let maxU = 0, ueberSumme = 0;
  for (let t = 0; t < N; t++) { if (disp.ueber[t] > maxU) maxU = disp.ueber[t]; ueberSumme += disp.ueber[t]; }
  if (maxU <= 0) return { machbar: false };
  const kap = _tankKap(cfg);
  // Bezugstank: der unbegrenzte H₂-Tank, sonst die Obergrenze, sonst ein Wochenbedarf
  const frei = ah2H2Auslegen(disp, cfg, { ohneObergrenze: true });
  let cRef = frei.machbar ? frei.tankKwh : Infinity;
  if (Number.isFinite(kap)) cRef = Math.min(cRef, kap);
  if (!Number.isFinite(cRef)) cRef = Math.min(ueberSumme * etaE, bzKw / cfg.bz.eta * 24 * 7);
  const tankFak = opt.grob ? [0.15, 0.5, 1] : [0.05, 0.15, 0.35, 0.6, 1];
  const fuellH = opt.grob ? [100, 400] : [50, 150, 400];     // Elektrolyseur füllt den Tank in etwa so vielen Überschussstunden
  const infraJk = typeof inp.infraJk === 'function' && basis.pvKwp > 0 ? inp.infraJk(basis.pvKwp) : 0;
  let best = null;
  const probiert = new Set();
  for (const f of tankFak) {
    const C = cRef * f;
    if (!(C > 1)) continue;
    const leist = fuellH.map(h => C / etaE / h);
    if (frei.machbar && frei.elyKw > 0) leist.push(frei.elyKw);
    for (const P0 of leist) {
      const P = Math.min(maxU, Math.max(1, P0));
      const key = Math.round(C) + ':' + Math.round(P);
      if (probiert.has(key)) continue;
      probiert.add(key);
      const h2 = { elyKw: P, bzKw, tankKwh: C, bhkwKw: 0 };
      const b0 = ah2Bilanz(disp, h2, cfg, { napEinspKw: inp.napEinspKw, exakt: true, nachBz: true });
      h2.bhkwKw = ah2BzLeistung(b0.nachBz, cfg.toleranzH);
      if (h2.bhkwKw <= 0) continue;          // reiner H₂-Fall — den deckt ah2H2Auslegen ab
      const a = { ...basis, ...h2 };
      const bil = ah2Bilanz(disp, h2, cfg, { napEinspKw: inp.napEinspKw, exakt: true });
      const kosten = ah2Kosten(a, bil, cfg, infraJk);
      if (!best || kosten.gesamt < best.kosten.gesamt) best = { a, bil, kosten };
    }
  }
  // Strategie 2 — BHKW als Grundlast, Wasserstoff nur für die Spitzen darüber: der Tank
  // schrumpft mit dem BHKW-Anteil, deshalb hilft das gerade bei einer Tank-Obergrenze.
  for (const f of (opt.grob ? [0.5] : [0.25, 0.5, 0.75])) {
    const pb = bzKw * f;
    const zielRest = new Float32Array(N);
    for (let t = 0; t < N; t++) zielRest[t] = Math.max(0, disp.zielRest[t] - pb);
    const h2 = ah2H2Auslegen({ ...disp, zielRest }, cfg);
    if (!h2.machbar || h2.bzKw <= 0) continue;
    const teil = { elyKw: h2.elyKw, bzKw: h2.bzKw, tankKwh: h2.tankKwh, bhkwKw: pb, bhkwZuerst: true };
    const a = { ...basis, ...teil };
    const bil = ah2Bilanz(disp, teil, cfg, { napEinspKw: inp.napEinspKw, exakt: true });
    if (bil.stundenUnter > cfg.toleranzH) continue;
    const kosten = ah2Kosten(a, bil, cfg, infraJk);
    if (!best || kosten.gesamt < best.kosten.gesamt) best = { a, bil, kosten };
  }
  return best ? { machbar: true, ...best } : { machbar: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// OPTIMIERUNG
// ══════════════════════════════════════════════════════════════════════════════

const _RESERVEN = [0, 0.5, 1];

/** Anzeigenamen der Varianten */
export const AH2_MODI = Object.freeze({
  pvbat: 'nur PV + Batterie',
  h2: 'nur Wasserstoff',
  bhkw: 'nur BHKW',
  kombi: 'Wasserstoff + BHKW',
});

/**
 * Kostenoptimale Auslegung für das Autarkieziel.
 *
 * @param {{last:ArrayLike<number>, pvKwProKwp:ArrayLike<number>, windKw?:ArrayLike<number>|null,
 *          pvMaxKwp:number, napEinspKw?:number|null, infraJk?:(kwp:number)=>number}} inp
 * @param {object} einst  Einstellungen (werden mit AH2_STANDARD gemischt)
 * @param {{grob?:boolean}} opt  grob = weniger Stützstellen (Zielkurve)
 * @returns {{machbar:boolean, best:object|null, varianten:object, kandidaten:object[], cfg:object, grund?:string, ausgewertet:number}}
 */
export function ah2Optimieren(inp, einst, opt = {}) {
  const cfg = ah2Mischen(einst);
  const ziel = cfg.zielPct / 100;
  const pvMax = Math.max(0, inp.pvMaxKwp || 0);
  const infraJk = typeof inp.infraJk === 'function' ? inp.infraJk : () => 0;
  let lastKwh = 0;
  for (let t = 0; t < inp.last.length; t++) lastKwh += Math.max(0, inp.last[t] || 0);
  const tagKwh = lastKwh / 365;

  const pvFak = opt.grob ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const batFak = opt.grob ? [0, 0.1, 0.25, 0.5, 1] : [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5];
  const pvStufen = pvMax > 0 ? [...new Set(pvFak.map(f => Math.round(pvMax * f)))] : [0];
  const batStufen = [...new Set(batFak.map(f => Math.round(tagKwh * f)))];

  const kandidaten = [];
  const dispBest = new Map();      // Schlüssel pv|bat|res → günstigste Einzelvariante (für die Kombination)
  let ausgewertet = 0, obergrenzeGriff = false;
  const schluessel = (pv, bat, r) => `${pv}|${bat}|${r}`;
  const bewerte = (pvKwp, batKwh, batReserve) => {
    const key = schluessel(pvKwp, batKwh, batReserve);
    if (dispBest.has(key)) return;
    ausgewertet++;
    const disp = ah2BatDispatch(inp, { pvKwp, batKwh, batReserve, ziel }, cfg.bat);
    const basis = { pvKwp, batKwh, batReserve };
    const pInfra = pvKwp > 0 ? infraJk(pvKwp) : 0;
    const merkeK = (modus, h2, exaktBil = null) => {
      const a = { ...basis, elyKw: 0, bzKw: 0, tankKwh: 0, bhkwKw: 0, ...h2, modus };
      const bil = exaktBil || ah2Bilanz(disp, a, cfg, { napEinspKw: inp.napEinspKw });
      const kosten = ah2Kosten(a, bil, cfg, pInfra);
      const k = { ...a, machbar: true, kostenJk: kosten.gesamt };
      kandidaten.push(k);
      const alt = dispBest.get(key);
      if (!alt || k.kostenJk < alt.kostenJk) dispBest.set(key, k);
      return k;
    };
    dispBest.set(key, null);
    const peak = ah2BzLeistung(disp.zielRest, cfg.toleranzH);
    if (peak <= 0) { merkeK('pvbat', {}); return; }
    if (cfg.h2Aktiv) {
      const h2 = ah2H2Auslegen(disp, cfg);
      if (h2.machbar) merkeK('h2', { elyKw: h2.elyKw, bzKw: h2.bzKw, tankKwh: h2.tankKwh });
      else if (h2.obergrenze) obergrenzeGriff = true;
    }
    if (cfg.bhkwAktiv) merkeK('bhkw', { bhkwKw: peak });
  };

  const bester = () => kandidaten.reduce((m, k) => (!m || k.kostenJk < m.kostenJk ? k : m), null);
  for (const pv of pvStufen) for (const bat of batStufen) {
    for (const r of (bat > 0 ? _RESERVEN : [0])) bewerte(pv, bat, r);
  }
  // Verfeinerung um das beste Raster-Ergebnis (zwei Runden, halbe Schrittweite)
  if (bester() && !opt.grob) {
    let dPv = pvMax * 0.05, dBat = Math.max(tagKwh * 0.05, 1);
    for (let runde = 0; runde < 2; runde++) {
      const b0 = bester();
      for (const fp of [-1, 0, 1]) for (const fb of [-1, 0, 1]) {
        if (!fp && !fb) continue;
        const pv = Math.round(Math.min(pvMax, Math.max(0, b0.pvKwp + fp * dPv)));
        const bat = Math.round(Math.max(0, b0.batKwh + fb * dBat));
        for (const r of (bat > 0 ? _RESERVEN : [0])) bewerte(pv, bat, r);
      }
      dPv /= 2; dBat /= 2;
    }
  }
  // Kombination (begrenzter Tank + BHKW) nur um die aussichtsreichsten PV/Batterie-Punkte —
  // sie braucht je Punkt einige exakte Jahresrechnungen.
  if (cfg.h2Aktiv && cfg.bhkwAktiv) {
    const top = [...dispBest.values()].filter(k => k && k.modus !== 'pvbat')
      .sort((a, b) => a.kostenJk - b.kostenJk).slice(0, opt.grob ? 3 : 6);
    for (const k of top) {
      const disp = ah2BatDispatch(inp, { pvKwp: k.pvKwp, batKwh: k.batKwh, batReserve: k.batReserve, ziel }, cfg.bat);
      const r = ah2KombiAuslegen(disp, cfg, inp, { pvKwp: k.pvKwp, batKwh: k.batKwh, batReserve: k.batReserve }, opt);
      if (r.machbar) kandidaten.push({ ...r.a, modus: 'kombi', machbar: true, kostenJk: r.kosten.gesamt });
    }
  }
  if (!kandidaten.length) {
    const grund = obergrenzeGriff
      ? `Mit der Tank-Obergrenze von ${Math.round(cfg.tankMaxKg)} kg H₂ lässt sich das Ziel allein mit Wasserstoff nicht erreichen — BHKW zulassen, Obergrenze anheben oder Ziel senken.`
      : !cfg.h2Aktiv && !cfg.bhkwAktiv
        ? 'Weder Wasserstoff noch BHKW zugelassen — PV und Batterie allein erreichen das Ziel nicht.'
        : pvMax > 0
          ? `Mit dem Dachpotenzial von ${Math.round(pvMax)} kWp lässt sich das Ziel nicht erreichen: der Überschuss reicht nicht für den Wasserstoff.`
          : 'Kein PV-Potenzial: ohne eigene Erzeugung ist kein Autarkieziel möglich.';
    return { machbar: false, best: null, varianten: {}, kandidaten, cfg, ausgewertet, grund };
  }
  // Je Variante die günstigsten stündlich exakt nachrechnen und danach entscheiden
  const varianten = {};
  for (const modus of Object.keys(AH2_MODI)) {
    const liste = kandidaten.filter(k => k.modus === modus).sort((a, b) => a.kostenJk - b.kostenJk).slice(0, modus === 'kombi' ? 1 : 4);
    let sieger = null;
    for (const k of liste) {
      const erg = ah2Simulieren(inp, k, cfg);
      if (erg.bilanz.stundenUnter > cfg.toleranzH) continue;
      if (!sieger || erg.kosten.gesamt < sieger.kosten.gesamt) sieger = erg;
    }
    if (!sieger && liste.length) sieger = ah2Simulieren(inp, liste[0], cfg);
    if (sieger) varianten[modus] = sieger;
  }
  const best = Object.values(varianten).reduce((m, v) => (!m || v.kosten.gesamt < m.kosten.gesamt ? v : m), null);
  return { machbar: true, best, varianten, kandidaten, cfg, ausgewertet, obergrenzeGriff };
}

/**
 * Eine Auslegung stündlich exakt durchrechnen (mit Tankverlauf und Reihen).
 * @param {object} inp  wie ah2Optimieren
 * @param {{pvKwp:number,batKwh:number,batReserve?:number,elyKw:number,bzKw:number,tankKwh:number,bhkwKw?:number,modus?:string}} a
 * @param {object} cfg  gemischte Einstellungen
 */
export function ah2Simulieren(inp, a, cfg) {
  const c = ah2Mischen(cfg);
  const ziel = c.zielPct / 100;
  const disp = ah2BatDispatch(inp, { pvKwp: a.pvKwp, batKwh: a.batKwh, batReserve: a.batReserve || 0, ziel }, c.bat);
  const bil = ah2Bilanz(disp, a, c, { napEinspKw: inp.napEinspKw, exakt: true, reihen: true });
  const infraJk = typeof inp.infraJk === 'function' && a.pvKwp > 0 ? inp.infraJk(a.pvKwp) : 0;
  const kosten = ah2Kosten(a, bil, c, infraJk);
  const tankKg = a.tankKwh / H2_KWH_PRO_KG;
  const dichte = H2_DICHTE_KG_M3[c.tank.druckBar] || null;
  // Monatsbilanz (MWh): Last, Direkt, Batterie, BHKW, Brennstoffzelle, Netz, Ziel
  const monate = Array.from({ length: 12 }, () => ({ last: 0, direkt: 0, bat: 0, bhkw: 0, bz: 0, netz: 0, ziel: 0, ely: 0 }));
  const N = inp.last.length;
  let minDeckung = 1, minStunde = 0;
  for (let t = 0; t < N; t++) {
    const m = monate[ah2MonatVonStunde(t % 8760)];
    const L = Math.max(0, inp.last[t] || 0);
    const R = bil.reihen;
    m.last += L / 1000; m.direkt += disp.direkt[t] / 1000; m.bat += disp.batEntl[t] / 1000;
    m.bz += R.bz[t] / 1000; m.bhkw += R.bhkw[t] / 1000; m.netz += R.netz[t] / 1000;
    m.ziel += ziel * L / 1000; m.ely += R.ely[t] / 1000;
    if (L > 0) {
      const deck = (L - R.netz[t]) / L;
      if (deck < minDeckung) { minDeckung = deck; minStunde = t; }
    }
  }
  const bhkwKw = a.bhkwKw || 0;
  const modus = a.modus || (bhkwKw > 0 ? (a.bzKw > 0 ? 'kombi' : 'bhkw') : a.bzKw > 0 ? 'h2' : 'pvbat');
  return {
    modus,
    ausl: { pvKwp: a.pvKwp, batKwh: a.batKwh, batReserve: a.batReserve || 0, batKw: a.batKwh * c.bat.cRate,
      elyKw: a.elyKw, bzKw: a.bzKw, tankKwh: a.tankKwh, tankKg, bhkwKw, modus, bhkwZuerst: !!a.bhkwZuerst,
      tankM3: dichte ? tankKg / dichte : null, druckBar: c.tank.druckBar, bhkwBrennstoff: c.bhkwBrennstoff },
    bilanz: bil, kosten, monate,
    minDeckungPct: minDeckung * 100, minStunde,
    batSoc: disp.batSoc, batLad: disp.batLad, batEntl: disp.batEntl, direkt: disp.direkt,
    // Vollbenutzungsstunden
    elyVbh: a.elyKw > 0 ? bil.elyInMwh * 1000 / a.elyKw : 0,
    bzVbh: a.bzKw > 0 ? bil.bzOutMwh * 1000 / a.bzKw : 0,
    bhkwVbh: bhkwKw > 0 ? bil.bhkwMwh * 1000 / bhkwKw : 0,
    zielPct: c.zielPct, toleranzH: c.toleranzH,
  };
}

/**
 * Was kostet das Ziel? Vergleich einer Auslegung mit Ziel gegen die günstigste
 * Auslegung ohne Ziel (Ziel 0 %, also rein wirtschaftlich gewählte PV/Batterie).
 * Bezugsgrößen, damit die Differenz lesbar wird:
 *   je kWh aus Brennstoffzelle + BHKW — was jede kWh aus dem „Winterspeicher" das System kostet
 *   je kW gesicherter Eigenleistung — Ziel × Lastspitze, vergleichbar mit einem Leistungspreis
 *   je Prozentpunkt Ziel
 *   je zusätzlich autark gedeckter kWh — nur, wenn der Autarkiegrad nennenswert steigt
 * @param {object} mit   Ergebnis von ah2Simulieren (mit Ziel)
 * @param {object} ohne  Ergebnis von ah2Simulieren (Ziel 0 %)
 * @param {number} lastSpitzeKw
 */
export function ah2ZielKosten(mit, ohne, lastSpitzeKw) {
  const dJk = mit.kosten.gesamt - ohne.kosten.gesamt;
  const dInvest = mit.kosten.investGes - ohne.kosten.investGes;
  const speicherKwh = (mit.bilanz.bzOutMwh + (mit.bilanz.bhkwMwh || 0)) * 1000;
  const gesichertKw = mit.zielPct / 100 * lastSpitzeKw;
  const dAutKwh = (mit.bilanz.lastMwh - mit.bilanz.netzMwh - (ohne.bilanz.lastMwh - ohne.bilanz.netzMwh)) * 1000;
  const posten = {};
  for (const k of ['pv', 'infra', 'bat', 'ely', 'tank', 'bz', 'bhkw']) posten[k] = (mit.kosten.jk[k] || 0) - (ohne.kosten.jk[k] || 0);
  posten.brennstoff = (mit.kosten.brennstoff + mit.kosten.wartung) - (ohne.kosten.brennstoff + ohne.kosten.wartung);
  posten.netz = mit.kosten.netz - ohne.kosten.netz;
  posten.erloese = -(mit.kosten.einsp + mit.kosten.waerme - ohne.kosten.einsp - ohne.kosten.waerme);
  return {
    dJk, dInvest, posten,
    ctJeSpeicherKwh: speicherKwh > 0 ? dJk / speicherKwh * 100 : null,
    speicherKwh,
    eurJeKwGesichert: gesichertKw > 0 ? dJk / gesichertKw : null,
    gesichertKw,
    eurJeProzentpunkt: mit.zielPct > 0 ? dJk / mit.zielPct : null,
    dAutarkieKwh: dAutKwh,
    // Nur aussagekräftig, wenn der Autarkiegrad um mehr als 1 % der Last steigt
    ctJeAutarkieKwh: dAutKwh > mit.bilanz.lastMwh * 10 ? dJk / dAutKwh * 100 : null,
  };
}

/**
 * Auslegungsnachweis: WONACH jede Anlage bemessen ist — die Stunde bzw. der
 * Zeitraum, der die Größe bestimmt, mit den Zahlen dieser Stunde.
 *   Brennstoffzelle — Stunde mit der größten Zielunterdeckung nach Batterie (und BHKW-Grundlast)
 *   BHKW            — Stunde mit der größten Zielunterdeckung, die es decken muss
 *   Tank            — längste Entnahmephase: vom letzten vollen Stand bis zum tiefsten Stand
 *   Elektrolyseur   — Mindestleistung für die Jahresbilanz vs. gewählte Leistung
 * @param {object} inp  wie ah2Optimieren
 * @param {object} erg  Ergebnis von ah2Simulieren
 * @param {object} cfg
 */
export function ah2Nachweis(inp, erg, cfg) {
  const c = ah2Mischen(cfg);
  const a = erg.ausl, R = erg.bilanz.reihen, N = R.netz.length, z = c.zielPct / 100;
  const stunde = t => {
    const L = Math.max(0, inp.last[t] || 0);
    return { t, last: L, ziel: z * L, direkt: erg.direkt[t], bat: erg.batEntl[t], bz: R.bz[t], bhkw: R.bhkw[t], netz: R.netz[t] };
  };
  const argmax = arr => { let m = -1, i = -1; for (let t = 0; t < arr.length; t++) if (arr[t] > m) { m = arr[t]; i = t; } return i; };
  const out = { ziel: c.zielPct, toleranzH: c.toleranzH, tankMaxKg: c.tankMaxKg };
  if (a.bzKw > 0) out.bz = { kw: a.bzKw, ...stunde(argmax(R.bz)), stunden: R.bz.reduce((n, v) => n + (v > 0.05 ? 1 : 0), 0) };
  if (a.bhkwKw > 0) out.bhkw = { kw: a.bhkwKw, ...stunde(argmax(R.bhkw)), zuerst: !!a.bhkwZuerst, voll: erg.bilanz.bhkwVoll };
  if (a.tankKwh > 0) {
    // tiefster Stand und davor (zyklisch) der letzte volle Stand
    let tMin = 0;
    for (let t = 1; t < N; t++) if (R.tank[t] < R.tank[tMin]) tMin = t;
    let tVoll = tMin;
    for (let k = 1; k < N; k++) {
      const t = (tMin - k + N) % N;
      if (R.tank[t] >= a.tankKwh * 0.99) { tVoll = t; break; }
    }
    const dauerH = (tMin - tVoll + N) % N;
    out.tank = { kwh: a.tankKwh, kg: a.tankKwh / H2_KWH_PRO_KG, tVoll, tLeer: tMin, dauerH,
      entnahmeKwh: R.tank[tVoll] - R.tank[tMin], minPct: R.tank[tMin] / a.tankKwh * 100 };
  }
  if (a.elyKw > 0) {
    const disp = ah2BatDispatch(inp, { pvKwp: a.pvKwp, batKwh: a.batKwh, batReserve: a.batReserve || 0, ziel: z }, c.bat);
    let ueberH = 0;
    for (let t = 0; t < N; t++) if (disp.ueber[t] > 0.05) ueberH++;
    const bedarf = erg.bilanz.h2VerbrMwh * 1000;
    out.ely = { kw: a.elyKw, minKw: ah2ElyMin(disp.ueber, bedarf, c.ely.eta), ueberStunden: ueberH,
      vbh: erg.elyVbh, h2Mwh: erg.bilanz.h2ProdMwh };
  }
  return out;
}

/**
 * Referenz „ohne Wasserstoff und BHKW": wie gut erfüllt dieselbe PV/Batterie das Ziel allein?
 */
export function ah2OhneH2(inp, a, cfg) {
  const c = ah2Mischen(cfg);
  const disp = ah2BatDispatch(inp, { pvKwp: a.pvKwp, batKwh: a.batKwh, batReserve: a.batReserve || 0, ziel: c.zielPct / 100 }, c.bat);
  const bil = ah2Bilanz(disp, { elyKw: 0, bzKw: 0, tankKwh: 0 }, c, { napEinspKw: inp.napEinspKw });
  return { stundenUnter: bil.stundenUnter, ungedecktMwh: bil.ungedecktMwh, autarkiePct: bil.autarkiePct };
}

/**
 * Zielkurve: kostenoptimale Auslegung je Zielwert (grobes Raster).
 * @returns {{zielPct:number, machbar:boolean, kostenJk?:number, mehrkosten?:number, tankKwh?:number, bzKw?:number, elyKw?:number, pvKwp?:number, batKwh?:number, bhkwKw?:number, modus?:string}[]}
 */
export function ah2Zielkurve(inp, einst, ziele = [0, 10, 20, 30, 40, 50, 60]) {
  return ziele.map(zp => {
    const r = ah2Optimieren(inp, { ...einst, zielPct: zp }, { grob: true });
    if (!r.machbar) return { zielPct: zp, machbar: false };
    const b = r.best;
    return { zielPct: zp, machbar: true, kostenJk: b.kosten.gesamt, mehrkosten: b.kosten.mehrkosten,
      tankKwh: b.ausl.tankKwh, bzKw: b.ausl.bzKw, elyKw: b.ausl.elyKw, pvKwp: b.ausl.pvKwp, batKwh: b.ausl.batKwh,
      bhkwKw: b.ausl.bhkwKw, modus: b.modus, autarkiePct: b.bilanz.autarkiePct };
  });
}
