// @ts-check

/**
 * Transparente Screening-Näherung aus Kalender- und linearer Zyklusalterung.
 * @param {{capacityKwh:number,annualDischargeKwh:number,calendarFadePctPerYear:number,cycleLife:number,eolCapacityPct:number,studyYears?:number}} input
 */
export function estimateBatteryAging(input) {
  const capacity = Math.max(0, Number(input.capacityKwh) || 0);
  const cyclesPerYear = capacity > 0 ? Math.max(0, Number(input.annualDischargeKwh) || 0) / capacity : 0;
  const eolFraction = Math.max(0.5, Math.min(1, (Number(input.eolCapacityPct) || 80) / 100));
  const calendarFade = Math.max(0, Number(input.calendarFadePctPerYear) || 0) / 100;
  const cycleLife = Math.max(1, Number(input.cycleLife) || 6000);
  const cycleFade = cyclesPerYear * (1 - eolFraction) / cycleLife;
  const annualFadeFraction = calendarFade + cycleFade;
  const lifeYears = annualFadeFraction > 0 ? (1 - eolFraction) / annualFadeFraction : Infinity;
  const studyYears = Math.max(0, Number(input.studyYears) || 20);
  const replacements = Number.isFinite(lifeYears) && lifeYears > 0 ? Math.max(0, Math.ceil(studyYears / lifeYears) - 1) : 0;
  const ageWithinCurrent = Number.isFinite(lifeYears) ? studyYears - Math.floor(studyYears / lifeYears) * lifeYears : studyYears;
  const retainedCapacityPct = Math.max(eolFraction * 100, (1 - annualFadeFraction * ageWithinCurrent) * 100);
  return {cyclesPerYear, annualFadePct:annualFadeFraction * 100, expectedLifeYears:lifeYears, replacements, retainedCapacityPct, eolCapacityPct:eolFraction * 100};
}
