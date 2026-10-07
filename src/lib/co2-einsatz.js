// ── lib/co2-einsatz.js — CO₂-Emissionen aus den Energiemengen der Einsatzplanung ──
// DOM-frei. Eine Rechnung für alle Erzeuger der Wärmeversorgung, damit Variantenvergleich, Gutachten und
// Bewertungsmatrix dieselben Tonnen zeigen. Einheiten: MWh × g/kWh = kg → / 1000 = t.

/**
 * en: { key: { waermeMwh, elMwh } } (window._dispatchEnergy), ef: g CO₂e/kWh { gas, oel, pellets, hhs, fw, strom },
 * eta: { gaskessel, heizoel, pellets, hhs, stromkessel, bhkwTh }, bhkw: { gutschrift, sigma, verdraengungEf }.
 * Ergebnis: { t (t/a), proErzeuger: { key: t } }. Speicher und Solarthermie verursachen keine Emissionen.
 */
export function co2AusEinsatz(en, ef = {}, eta = {}, bhkw = {}) {
  const proErzeuger = {};
  let t = 0;
  const f = x => (Number.isFinite(Number(x)) ? Number(x) : 0);
  for (const [k, e] of Object.entries(en || {})) {
    const w = f(e?.waermeMwh), el = f(e?.elMwh);
    if (k === '_thermSpeicher' || k === 'solarthermie' || (w < 0.1 && el < 0.1)) continue;
    let kg = 0;
    if (k === 'gaskessel' || k === '_autoGk') kg = (w / (eta.gaskessel || 0.92)) * f(ef.gas);
    else if (k === 'heizoel') kg = (w / (eta.heizoel || 0.9)) * f(ef.oel);
    else if (k === 'pellets') kg = (w / (eta.pellets || 0.88)) * f(ef.pellets);
    else if (k === 'hhs') kg = (w / (eta.hhs || 0.85)) * f(ef.hhs);
    else if (k === 'fernwaerme') kg = w * f(ef.fw);
    else if (k === 'lwwp' || k === 'geo' || k === 'fg') kg = el * f(ef.strom);
    else if (k === 'stromkessel') kg = (el > 0 ? el : w / (eta.stromkessel || 0.99)) * f(ef.strom);
    else if (k === 'bhkw') {
      const brutto = (w / (eta.bhkwTh || 0.5)) * f(ef.gas);
      const gutschrift = bhkw.gutschrift ? w * f(bhkw.sigma) * f(bhkw.verdraengungEf) : 0;
      kg = Math.max(0, brutto - gutschrift);
    } else continue;
    proErzeuger[k] = kg / 1000;
    t += kg / 1000;
  }
  return { t, proErzeuger };
}
