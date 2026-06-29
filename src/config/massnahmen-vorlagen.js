// @ts-check
// ── Maßnahmen-Vorlagen-Katalog ───────────────────────────────────────────────
// Standard-Vorlagen für Maßnahmen-Typen: Kosten-Richtwerte, newProps-Schemas
// und dependsOn-Muster für den automatischen Ausbauplaner (Step 3–5).
//
// Kosten-Richtwerte sind Platzhalter (0) bis M3 — dort werden reale Werte
// aus PV_INFRA_STUFEN (09d), netz-kosten.js und Erfahrungswerten ergänzt.
//
// Struktur je Vorlage:
//   label        — Anzeigename
//   icon         — Emoji-Icon (identisch mit MASSN_TYP in 13e)
//   hasNewProps  — ob newProps-Felder relevant sind
//   newPropsSchema — Felder analog ASSET_PROPS_SCHEMA (13a), leer = kein Schema
//   kostenRichtwert — pauschaler Richtwert in € (0 = noch nicht hinterlegt)
//   kostenHinweis   — Quelle / Berechnungshinweis für den Richtwert
//   dependsOnTypen  — Maßnahmen-Typen, die typischerweise vorher stehen

export const MASSN_VORLAGEN = {

  Sanierung: {
    label: 'Sanierung',
    icon: '🔧',
    hasNewProps: true,
    newPropsSchema: [],   // variantenspezifisch — kein Einheits-Schema
    kostenRichtwert: 0,
    kostenHinweis: 'projektspezifisch',
    dependsOnTypen: [],
  },

  Abriss: {
    label: 'Abriss',
    icon: '🏚',
    hasNewProps: false,
    newPropsSchema: [],
    kostenRichtwert: 0,
    kostenHinweis: 'projektspezifisch',
    dependsOnTypen: [],
  },

  Bau: {
    label: 'Neubau/Bau',
    icon: '🏗',
    hasNewProps: false,
    newPropsSchema: [],
    kostenRichtwert: 0,
    kostenHinweis: 'Investitionskosten PV-Anlage (€/kWp × Leistung) — Wert folgt M3',
    dependsOnTypen: ['Ertuechtigung'],  // Ertüchtigung muss vor PV-Bau stehen
  },

  Ertuechtigung: {
    label: 'Ertüchtigung',
    icon: '⚡',
    hasNewProps: true,
    // newProps-Keys entsprechen ASSET_PROPS_SCHEMA-Schlüsseln des Ziel-Assets:
    //   Trafo:  leistungKVA, ukProzent
    //   NAP:    spannungKV
    //   NSHV/UV/KVS: nennstromA, abgaenge
    newPropsSchema: [
      { key: 'leistungKVA', label: 'Neue Trafo-Leistung (kVA)' },
      { key: 'nennstromA',  label: 'Neuer Nennstrom (A)' },
    ],
    kostenRichtwert: 0,
    kostenHinweis: 'Trafo-Ersatz / NAP-Erweiterung — Wert folgt M3 aus PV_INFRA_STUFEN (09d)',
    dependsOnTypen: [],
  },

};

// Reihenfolge der Typen für UI-Dropdowns
export const MASSN_VORLAGEN_REIHENFOLGE = ['Sanierung', 'Abriss', 'Bau', 'Ertuechtigung'];
