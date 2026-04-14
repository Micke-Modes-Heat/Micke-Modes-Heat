// ── Erzeuger-Konfiguration ──────────────────────────────────────────────
// Mapping Erzeuger-Key → UI-IDs, Farben, Typen, Gütegrade
export const ERZEUGER_CFG = {
  lwwp:       { label: 'Luft-WP',     leistungId: 'lwwp-leistung', wrapId: 'lwwp-deckung-wrap', color: '#66bb6a', typ: 'wp',  guetegrad: 0.42, guetegradId: 'lwwp-guetegrad' },
  fg:         { label: 'FG-WP',       leistungId: 'fg-leistung',   wrapId: 'fg-deckung-wrap',   color: '#29b6f6', typ: 'wp',  guetegrad: 0.56, guetegradId: 'fg-guetegrad'   },
  geo:        { label: 'Geo-WP',      leistungId: 'geo-leistung-eff', wrapId: 'geo-deckung-wrap',  color: '#a1887f', typ: 'wp',  guetegrad: 0.50, guetegradId: 'geo-guetegrad'  },
  fernwaerme: { label: 'Fernwärme',   leistungId: 'fw-leistung',   wrapId: 'fw-deckung-wrap',   color: '#e53935', typ: 'fix' },
  pellets:    { label: 'Pellets',     leistungId: 'pk-leistung',   wrapId: 'pk-deckung-wrap',   color: '#ff7043', typ: 'fix' },
  hhs:        { label: 'HHS',         leistungId: 'hhs-leistung',  wrapId: 'hhs-deckung-wrap',  color: '#8d6e63', typ: 'fix' },
  heizoel:    { label: 'Heizöl',      leistungId: 'hko-leistung',  wrapId: 'hko-deckung-wrap',  color: '#455a64', typ: 'fix' },
  gaskessel:  { label: 'Gaskessel',   leistungId: 'gk-leistung',      wrapId: 'gk-deckung-wrap',   color: '#78909c', typ: 'fix' },
  bhkw:        { label: 'BHKW/KWK',   leistungId: 'bhkw-leistung-th', wrapId: 'bhkw-deckung-wrap', color: '#ff69b4', typ: 'kwk' },
  stromkessel: { label: 'Stromkessel', leistungId: 'sk-leistung',     wrapId: 'sk-deckung-wrap',   color: '#ff8f00', typ: 'fix' },
};

// Nutzungstyp-Kennwerte (spez. Wärmebedarf kWh/m²a, spez. Heizlast W/m²)
export const NUTZUNG_DEFAULTS = {
  efh:        { spez: 180, spezHL: 55,  label: 'EFH' },
  mfh:        { spez: 120, spezHL: 40,  label: 'MFH' },
  ghd:        { spez: 100, spezHL: 50,  label: 'GHD' },
  schule:     { spez: 80,  spezHL: 40,  label: 'Schule' },
  buero:      { spez: 90,  spezHL: 45,  label: 'Büro' },
  industrie:  { spez: 200, spezHL: 35,  label: 'Industrie' },
  oeffentlich:{ spez: 110, spezHL: 50,  label: 'Öffentlich' },
};
