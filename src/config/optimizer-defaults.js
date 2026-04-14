// ── Optimizer-Defaults ──────────────────────────────────────────────────
// Investkosten-Fallback (€/kW bzw. €/kWh), falls CalcEngine-Kurven nicht verfügbar
const OPT_INVEST_DEFAULT = {
  lwwp: 600, fg: 700, geo: 900, gaskessel: 120, bhkw: 800,
  stromkessel: 80, pellets: 300, hhs: 350, heizoel: 130, fernwaerme: 100,
  pv: 1200, bat: 400
};

// Nutzungsdauern (Jahre) — VDI 2067
const OPT_NUTZUNG = {
  lwwp: 20, fg: 20, geo: 20, gaskessel: 20, bhkw: 15,
  stromkessel: 20, pellets: 15, hhs: 15, heizoel: 20, fernwaerme: 20,
  pv: 20, bat: 15
};

// Instandhaltung (Anteil vom Invest p.a.)
const OPT_IH = {
  lwwp: 0.02, fg: 0.02, geo: 0.02, gaskessel: 0.02, bhkw: 0.04,
  stromkessel: 0.01, pellets: 0.03, hhs: 0.03, heizoel: 0.02, fernwaerme: 0.02,
  pv: 0.01, bat: 0.01
};

// EE-Erzeuger (Wärme)
const OPT_EE_KEYS = ['lwwp', 'fg', 'geo', 'pellets', 'hhs', 'solarthermie'];

// Merit-Order-Sortierung: Grundlast zuerst (WP, BHKW, Biomasse), dann Kessel/Spitzenlast
const OPT_MERIT_ORDER = ['bhkw', 'geo', 'fg', 'lwwp', 'pellets', 'hhs', 'stromkessel', 'fernwaerme', 'gaskessel', 'heizoel'];
