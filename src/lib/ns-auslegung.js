// ── lib/ns-auslegung.js — Auslegung und elektrische Kennwerte einer NS-Kante ──
//
// EINE Implementierung für beide Rechenpfade:
//   • _recalcStromNetzInner (05b) — szenarioabhängiger Lastfluss, läuft bei
//     jeder UI-Aktion
//   • elCalcAssets/_sizeNsCable (05b) — asset-basierte Netzberechnung
//
// Vorher hatte jeder Pfad seine eigene Auslegung: der Altpfad ohne Parallel-
// stränge und ohne ΔU-Kriterium, der Asset-Pfad ohne Iz-Derating (kIz) und ohne
// Temperaturkorrektur, dazu mit abweichendem cos φ. Da beide auf dieselbe Kante
// schreiben, hing das angezeigte Ergebnis davon ab, wer zuletzt gelaufen war.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.

import { calcRhoKorr } from './elektro-formeln.js';

/** Normreihe für die Auto-Sicherung (VDE 0298 — Kabelschutz). */
export const FUSE_NORM = [16, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250];

/** Obergrenze für automatisch gelegte Parallelstränge. */
export const MAX_PARALLEL = 8;

/**
 * Legt eine NS-Kante aus und berechnet ihre elektrischen Kennwerte.
 *
 * Auslegung (nur wenn autoSized oder noch kein Querschnitt gesetzt ist):
 *   1. Reicht der größte Querschnitt strommäßig nicht, werden Parallelstränge
 *      gelegt: n = ceil(I / (Iz_max · kIz)), gedeckelt auf maxN.
 *   2. Aus den strommäßig ausreichenden Querschnitten wird der kleinste gewählt,
 *      der zusätzlich das ΔU-Budget dieses Abschnitts einhält.
 *   3. Hält auch der größte Querschnitt das Budget nicht, werden weitere Stränge
 *      gelegt (R und X sinken ≈ 1/n), bis das Budget passt oder maxN erreicht ist.
 *
 * Ist autoSized false und ein Querschnitt gesetzt, wird NICHT umdimensioniert —
 * es werden nur die Kennwerte zum vorhandenen Kabel gerechnet.
 *
 * @param {object}   o
 * @param {object}   o.kt            Kabeltyp aus KABEL_TYPEN ({ sections, rhoOhmMm2pM, alphaK })
 * @param {number}   o.I_A           Strombetrag (Worst Case) [A]
 * @param {number}  [o.I_A_sign]     vorzeichenbehafteter Strom für ΔU-Richtung (Default I_A)
 * @param {number}  [o.crossSection] Ist-Querschnitt [mm²] (0/undefined = keiner)
 * @param {number}  [o.nParallel]    Ist-Strangzahl
 * @param {boolean} [o.autoSized]    darf umdimensioniert werden?
 * @param {number}  [o.lengthM]      Länge [m]
 * @param {number}  [o.duBudgetPct]  ΔU-Budget für DIESEN Abschnitt [%]
 * @param {number}  [o.kIz]          Iz-Korrekturfaktor (Temperatur/Häufung/Verlegeart)
 * @param {number}  [o.tLeiter]      Leitertemperatur [°C]
 * @param {number}  [o.cosPhi]
 * @param {number}  [o.U_V]          Nennspannung [V]
 * @param {number}  [o.maxN]         max. Parallelstränge
 * @param {number}  [o.fuseA]        vorhandene Sicherung (0/undefined → Auto-Sicherung)
 * @returns {{crossSection:number, nParallel:number, section:object,
 *            ratedCurrentA:number, izEffA:number, auslastungPct:number,
 *            dU_V:number, deltaUPct:number, R_totalOhm:number, X_totalOhm:number,
 *            fuseA:number, gedeckelt:boolean}}
 *   gedeckelt = auch mit maxN Strängen bleibt Strom oder ΔU über der Grenze.
 */
export function nsKabelAuslegen(o) {
  const kt      = o.kt;
  const secs    = kt.sections;
  const maxSec  = secs[secs.length - 1];
  const I_A     = Math.abs(o.I_A || 0);
  const I_sign  = o.I_A_sign != null ? o.I_A_sign : I_A;
  const lengthM = o.lengthM || 0;
  const kIz     = o.kIz > 0 ? o.kIz : 1;
  const tLeiter = o.tLeiter != null ? o.tLeiter : 70;
  const cosPhi  = o.cosPhi > 0 ? o.cosPhi : 0.95;
  const sinPhi  = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
  const U_V     = o.U_V > 0 ? o.U_V : 400;
  const maxN    = o.maxN || MAX_PARALLEL;
  const budget  = o.duBudgetPct > 0 ? o.duBudgetPct : Infinity;

  // Widerstandsbelag bei Betriebstemperatur (IEC 60228) — je Strang
  const rhoKorr = calcRhoKorr(kt.rhoOhmMm2pM, kt.alphaK || 0.004, tLeiter);
  const _rSeg = (mm2, nPar) => (rhoKorr / mm2) * lengthM / nPar;
  const _xSeg = (sec, nPar) => ((sec.xMuOhmPerM ?? 80) / 1e6) * lengthM / nPar;
  const _dU_V = (sec, nPar, strom) =>
    Math.sqrt(3) * (_rSeg(sec.mm2, nPar) * cosPhi + _xSeg(sec, nPar) * sinPhi) * strom;
  const _duPct = (sec, nPar) => Math.abs(_dU_V(sec, nPar, I_A) / U_V * 100);

  const npIst = Math.max(1, o.nParallel || 1);
  let cs = o.crossSection || 0;
  let gedeckelt = false;

  // Bei einer Auto-Auslegung wird die Strangzahl IMMER neu aus der Last
  // bestimmt (Start bei 1), nie aus dem letzten Ergebnis fortgeschrieben.
  // Sonst wirkt sie als Ratsche: sie wächst mit jeder Lastspitze und geht nie
  // zurück, sodass das Ergebnis von der Reihenfolge der Rechenläufe abhängt
  // (z. B. 8 × 50 mm² nach einem Einspeise-Jahr statt 2 × 240 mm²).
  let np = (o.autoSized || !cs) ? 1 : npIst;

  if (o.autoSized || !cs) {
    // 1. Strangzahl aus der Stromtragfähigkeit
    if (I_A > maxSec.Iz * kIz * np) {
      const noetig = Math.ceil(I_A / (maxSec.Iz * kIz));
      np = Math.min(maxN, noetig);
      if (noetig > maxN) gedeckelt = true;
    }
    // 2. kleinster Querschnitt, der Strom UND ΔU-Budget hält
    const okCurrent = secs.filter(s => s.Iz * kIz * np >= I_A);
    const pool = okCurrent.length ? okCurrent : [maxSec];
    let chosen = pool.find(s => _duPct(s, np) <= budget);
    if (!chosen) {
      // 3. ΔU auch mit dem größten Querschnitt zu hoch → weitere Stränge
      let tryNp = np;
      while (tryNp < maxN && _duPct(maxSec, tryNp) > budget) tryNp++;
      if (_duPct(maxSec, tryNp) > budget) gedeckelt = true;
      np = tryNp;
      chosen = maxSec;
    }
    cs = chosen.mm2;
  }

  const section = secs.find(s => s.mm2 === cs) || maxSec;
  cs = section.mm2;

  const ratedCurrentA = section.Iz * np;
  const izEffA        = ratedCurrentA * kIz;
  const dU_V          = _dU_V(section, np, I_sign);

  let fuseA = o.fuseA || 0;
  if ((o.autoSized || !o.crossSection) && !fuseA) {
    fuseA = [...FUSE_NORM].reverse().find(f => f <= izEffA) || 0;
  }

  return {
    crossSection: cs, nParallel: np, section,
    ratedCurrentA, izEffA,
    auslastungPct: izEffA > 0 ? (I_A / izEffA) * 100 : 0,
    dU_V, deltaUPct: Math.abs(dU_V / U_V * 100),
    R_totalOhm: _rSeg(cs, np), X_totalOhm: _xSeg(section, np),
    fuseA, gedeckelt,
  };
}
