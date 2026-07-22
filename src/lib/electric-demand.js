// @ts-check

/**
 * @param {Float32Array} demandH
 * @param {ArrayLike<number> | null | undefined} additionalH
 */
export function addHourlyElectricLoad(demandH, additionalH) {
  if (!additionalH) return demandH;
  if (demandH.length !== additionalH.length) {
    throw new RangeError(`Elektrische Zeitreihenlängen stimmen nicht überein: ${demandH.length} / ${additionalH.length}`);
  }
  for (let t = 0; t < demandH.length; t++) demandH[t] += Number(additionalH[t]) || 0;
  return demandH;
}

/** @param {ArrayLike<number> | null | undefined} values */
export function hourlyEnergyMwh(values) {
  if (!values) return 0;
  let kwh = 0;
  for (let t = 0; t < values.length; t++) kwh += Number(values[t]) || 0;
  return kwh / 1000;
}
