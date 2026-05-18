// ── Kostenkomponenten-Konfiguration (VDI 2067) ──────────────────────────
// Default-Nutzungsdauer + Inst./Wart./Bedien-Sätze pro Komponententyp.
// Pro Variante können die Werte überschrieben werden — siehe varianten[i].kostenpunkte.
//
// Werte gemäß VDI 2067 Blatt 1 + Anhang, Stand-Mix aus internen Projekten.
// Eine User-Override-Schicht (eigene Vorlagen) liegt in localStorage unter
// 'ep_user_kostenvorlagen' — siehe loadUserVorlagen().

export const KATEGORIEN = {
  erzeuger:   { label: 'Wärmeerzeuger',     color: '#ff9800', order: 1 },
  speicher:   { label: 'Speicher / Quelle', color: '#26a69a', order: 2 },
  netz:       { label: 'Netz / Übergabe',   color: '#4fc3f7', order: 3 },
  peripherie: { label: 'Peripherie',        color: '#ab47bc', order: 4 },
  sonst:      { label: 'Sonstiges',         color: '#78909c', order: 5 },
};

// ── Default-Werte pro typeKey ──
// Felder: kategorie, name, n (a), inst (%/a), wart (%/a), bedien (h/a), spez (€/kW, optional)
export const KOSTENKOMP_DEFAULTS = {
  // ── Wärmeerzeuger ──
  wp_solewasser:    { kategorie: 'erzeuger', name: 'Wärmepumpe (Sole/Wasser)',   n: 20, inst: 1.0, wart: 1.5, bedien: 5,   spez: 759 },
  wp_luftwasser:    { kategorie: 'erzeuger', name: 'Wärmepumpe (Luft/Wasser)',   n: 18, inst: 1.5, wart: 2.0, bedien: 5,   spez: 550 },
  wp_wasserwasser:  { kategorie: 'erzeuger', name: 'Wärmepumpe (Wasser/Wasser)', n: 20, inst: 1.0, wart: 1.5, bedien: 5,   spez: 800 },
  bhkw:             { kategorie: 'erzeuger', name: 'BHKW',                       n: 15, inst: 6.0, wart: 2.0, bedien: 100 },
  gaskessel:        { kategorie: 'erzeuger', name: 'Gaskessel',                  n: 20, inst: 1.0, wart: 2.0, bedien: 20 },
  heizoelkessel:    { kategorie: 'erzeuger', name: 'Heizölkessel',               n: 20, inst: 1.0, wart: 2.0, bedien: 20 },
  pelletkessel:     { kategorie: 'erzeuger', name: 'Pelletkessel',               n: 15, inst: 3.0, wart: 3.0, bedien: 408 },
  hhs_kessel:       { kategorie: 'erzeuger', name: 'Hackschnitzelkessel',        n: 15, inst: 3.0, wart: 3.0, bedien: 612 },
  solarthermie:     { kategorie: 'erzeuger', name: 'Solarthermie',               n: 25, inst: 1.5, wart: 1.0, bedien: 0 },
  flusswasser_wt:   { kategorie: 'erzeuger', name: 'Flusswasser-Wärmetauscher',  n: 20, inst: 2.0, wart: 1.0, bedien: 0 },
  stromkessel:      { kategorie: 'erzeuger', name: 'Stromkessel',                n: 20, inst: 1.0, wart: 1.0, bedien: 0 },

  // ── Speicher / Quellen ──
  sondenbohrung:    { kategorie: 'speicher', name: 'Sondenbohrungen',            n: 50, inst: 2.0, wart: 1.0, bedien: 0,   spez: 1260 },
  pufferspeicher:   { kategorie: 'speicher', name: 'Pufferspeicher',             n: 20, inst: 1.0, wart: 1.0, bedien: 0 },
  pellet_lager:     { kategorie: 'speicher', name: 'Pellet-Lager',               n: 20, inst: 3.0, wart: 2.0, bedien: 204 },
  hhs_lager:        { kategorie: 'speicher', name: 'HHS-Lager',                  n: 20, inst: 3.0, wart: 2.0, bedien: 204 },
  batterie:         { kategorie: 'speicher', name: 'Batteriespeicher',           n: 15, inst: 1.0, wart: 1.0, bedien: 0 },

  // ── Netz / Übergabe ──
  nahwaermenetz:    { kategorie: 'netz',     name: 'Nahwärmenetz',               n: 40, inst: 1.0, wart: 0.0, bedien: 0 },
  pumpstation:      { kategorie: 'netz',     name: 'Pumpstation',                n: 18, inst: 2.0, wart: 1.0, bedien: 0 },
  uebergabestation: { kategorie: 'netz',     name: 'Übergabestation',            n: 20, inst: 2.0, wart: 1.0, bedien: 0 },
  hausanschluss:    { kategorie: 'netz',     name: 'Hausanschlussstation',       n: 20, inst: 2.0, wart: 1.0, bedien: 0 },
  wasser_zuleitung: { kategorie: 'netz',     name: 'Wasser-Zuleitung',           n: 40, inst: 1.0, wart: 0.0, bedien: 0 },

  // ── Peripherie ──
  msr:              { kategorie: 'peripherie', name: 'MSR-Technik',              n: 40, inst: 1.0, wart: 1.0, bedien: 0 },
  hydr_anbindung:   { kategorie: 'peripherie', name: 'Hydraulische Anbindung',   n: 40, inst: 1.0, wart: 0.0, bedien: 0 },
  elt_anbindung:    { kategorie: 'peripherie', name: 'Elektrische Anbindung',    n: 40, inst: 1.0, wart: 1.0, bedien: 0 },
  schornstein:      { kategorie: 'peripherie', name: 'Schornstein',              n: 40, inst: 1.0, wart: 2.0, bedien: 0 },
  bauteil:          { kategorie: 'peripherie', name: 'Bauteil / Hülle',          n: 50, inst: 1.0, wart: 1.0, bedien: 0 },
  elt_warmwasser:   { kategorie: 'peripherie', name: 'Elektrifizierung Warmwasser', n: 20, inst: 1.0, wart: 1.0, bedien: 0 },
  pv_anlage:        { kategorie: 'peripherie', name: 'PV-Anlage',                n: 25, inst: 1.5, wart: 1.0, bedien: 0 },

  // ── Sonstiges ──
  sonstiges:        { kategorie: 'sonst',    name: 'Sonstiges (Planung etc.)',   n: 20, inst: 0.0, wart: 0.0, bedien: 0 },
  planung:          { kategorie: 'sonst',    name: 'Planung',                    n: 20, inst: 0.0, wart: 0.0, bedien: 0 },
};

// ── Helpers ──

// Liefert effektive VDI-Werte für einen Kostenpunkt: Override hat Vorrang vor Default.
export function effectiveVdi(kp) {
  const def = KOSTENKOMP_DEFAULTS[kp.typeKey] || {};
  return {
    n:      kp.ndOverride   ?? def.n      ?? 20,
    inst:   kp.instOverride ?? def.inst   ?? 0,
    wart:   kp.wartOverride ?? def.wart   ?? 0,
    bedien: kp.bedOverride  ?? def.bedien ?? 0,
  };
}

// Liefert effektiven Anzeigenamen (Override vor Default).
export function effectiveName(kp) {
  if (kp.name) return kp.name;
  return KOSTENKOMP_DEFAULTS[kp.typeKey]?.name || 'Unbekannte Position';
}

// User-eigene Vorlagen aus localStorage laden (Phase 5).
// Format identisch zu KOSTENKOMP_DEFAULTS, gemerged auf Lese-Ebene.
export function loadUserVorlagen() {
  try {
    return JSON.parse(localStorage.getItem('ep_user_kostenvorlagen') || '{}');
  } catch {
    return {};
  }
}

// User-Vorlage speichern (Phase 5).
export function saveUserVorlage(typeKey, def) {
  const all = loadUserVorlagen();
  all[typeKey] = def;
  localStorage.setItem('ep_user_kostenvorlagen', JSON.stringify(all));
}

// Komplette Vorlagen-Liste (Defaults + User), für UI-Dropdown.
// Zurückgegeben als sortiertes Array nach Kategorie + Name.
export function getAllVorlagen() {
  const user = loadUserVorlagen();
  const merged = { ...KOSTENKOMP_DEFAULTS, ...user };
  return Object.entries(merged)
    .map(([typeKey, def]) => ({ typeKey, ...def, isUser: !!user[typeKey] }))
    .sort((a, b) => {
      const oA = KATEGORIEN[a.kategorie]?.order ?? 99;
      const oB = KATEGORIEN[b.kategorie]?.order ?? 99;
      if (oA !== oB) return oA - oB;
      return (a.name || '').localeCompare(b.name || '', 'de');
    });
}
