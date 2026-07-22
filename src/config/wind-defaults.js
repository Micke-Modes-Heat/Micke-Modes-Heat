// DOM-freie Anlagenklassen für Wind-Platzierung und Restriktionsabstände.
export const _WINDA_KLASSEN = Object.freeze([
  { id: 'klein',       label: 'Klein · ≤ 50 m Gesamthöhe',       ratedKw: 150,  rotorD: 30,  nabenhoehe: 35  },
  { id: 'mittel',      label: 'Mittel · Standard-Binnenland',    ratedKw: 500,  rotorD: 60,  nabenhoehe: 100 },
  { id: 'mittelgross', label: 'Mittelgroß · 2,5-MW-Klasse',      ratedKw: 2500, rotorD: 110, nabenhoehe: 120 },
  { id: 'gross',       label: 'Groß · moderne Anlage',           ratedKw: 4200, rotorD: 140, nabenhoehe: 150 },
]);
