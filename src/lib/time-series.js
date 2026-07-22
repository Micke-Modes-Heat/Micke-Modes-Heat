// @ts-check
export const HOURS_NORMAL_YEAR = 8760;
export const HOURS_LEAP_YEAR = 8784;

// Entfernt beim stündlichen Schaltjahr ausschließlich den 29. Februar. Damit
// bleiben Monats-, Wetter- und PV-Zuordnung ab März kalendergleich.
/** @param {ArrayLike<number>} values @param {{source?: string, timezone?: string}} [options] */
export function normalizeHourlyYear(values, {source = 'measured', timezone = 'Europe/Berlin'} = {}) {
  if (!values || (values.length !== HOURS_NORMAL_YEAR && values.length !== HOURS_LEAP_YEAR)) {
    throw new RangeError(`Zeitreihe muss genau ${HOURS_NORMAL_YEAR} oder ${HOURS_LEAP_YEAR} Stunden enthalten`);
  }
  const history = [];
  const input = Float32Array.from(values);
  let normalized;
  if (values.length === HOURS_LEAP_YEAR) {
    const feb29Start = 59 * 24;
    normalized = new Float32Array(HOURS_NORMAL_YEAR);
    normalized.set(input.slice(0, feb29Start), 0);
    normalized.set(input.slice(feb29Start + 24), feb29Start);
    history.push({operation: 'remove-leap-day', removedStartHour: feb29Start, removedHours: 24});
  } else normalized = input;
  return {
    values: normalized,
    meta: {intervalMinutes: 60, timezone, unit: 'kW', source, quality: source === 'measured' ? 'measured' : 'synthetic', history}
  };
}
