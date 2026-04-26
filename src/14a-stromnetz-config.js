// ── 14a-stromnetz-config.js — Konfiguration: Kabel-Kataloge, Kosten ─────────
// Portiert aus Standalone-Elektroteil (Energiekarte1.1_Elektro_260414.html ~5000–5060).
// Keine Logik, nur Daten. Konstanten werden von 14b/14c/zukünftigen Modulen genutzt.

// ── Niederspannung (NS) ────────────────────────────────────────────────────
export const KABEL_NS_QS        = [16,25,35,50,70,95,120,150,185,240]; // mm²
export const KABEL_NS_R_OHM_KM  = {16:1.15,25:0.727,35:0.524,50:0.387,70:0.268,95:0.193,120:0.153,150:0.124,185:0.099,240:0.0754};
export const KABEL_NS_I_MAX_A   = {16:70,25:90,35:110,50:140,70:175,95:210,120:245,150:280,185:320,240:370};
export const KABEL_NS_KOSTEN_M  = {16:35,25:42,35:48,50:58,70:72,95:90,120:108,150:130,185:155,240:190}; // €/m

// Normsicherungsreihe NH/gL (A) – für Schutzkonzept
export const SICHERUNG_A = [16,20,25,32,40,50,63,80,100,125,160,200,250,315,400,500,630];

// ── Mittelspannung (MS, 20 kV) ──────────────────────────────────────────────
export const KABEL_MS_QS        = [35,50,70,95,120,150,185,240]; // mm²
export const KABEL_MS_R_OHM_KM  = {35:0.524,50:0.387,70:0.268,95:0.193,120:0.153,150:0.124,185:0.099,240:0.0754};
export const KABEL_MS_X_OHM_KM  = {35:0.11,50:0.10,70:0.10,95:0.09,120:0.09,150:0.09,185:0.08,240:0.08};
export const KABEL_MS_I_MAX_A   = {35:140,50:175,70:220,95:260,120:300,150:340,185:385,240:445};
export const KABEL_MS_KOSTEN_M  = {35:85,50:105,70:130,95:160,120:190,150:220,185:260,240:310}; // €/m

// ── Editierbare Kosten-Konfiguration ────────────────────────────────────────
// basis: Fixanteil (€), per*: Skalierungsparameter (€/Einheit)
// Wird mit dem Projekt gespeichert (serialisiert in State).
export const KOSTEN_CFG = {
  kabel: { ...KABEL_NS_KOSTEN_M },  // €/m (NS-Default, editierbar)
  assets: {
    NAP:          { basis: 5000 },
    Schaltanlage: { basis: 35000, perFeld:    8000 },  // 35k + 8000 €/Feld
    Trafo:        { basis: 20000, perKVA:     60   },  // 20k + 60 €/kVA
    NSHV:         { basis: 8000,  perAbgang:  1500 },  // 8k + 1500 €/Abgang
    UV:           { basis: 3000,  perAbgang:  600  },  // 3k + 600 €/Abgang
    Verbraucher:  { basis: 1500 },
    Lade:         { basis: 500,   perPunkt:   3000 },  // 500 + 3000 €/Ladepunkt
    Batterie:     { basis: 0,     perKWh:     900  },  // 900 €/kWh
    Nsa:          { basis: 5000,  perKW:      300  },  // 5k + 300 €/kW
    Reserve:      { basis: 0 },
    // ── DEPRECATED: PV, WP, KWK kommen jetzt aus CalcEngine (KWW-Kostenkurven) ──
    // Werte hier nur als Fallback wenn CalcEngine nicht verfügbar (z.B. Tests).
    PV:           { basis: 0,     perKWp:     1300 },  // Fallback — CalcEngine nutzt PV_INVEST_TABELLE
    WP:           { basis: 3000,  perKW:      500  },  // Fallback — CalcEngine nutzt LuftWP-Kurve
    // KWK gibt es hier nicht; CalcEngine.investEurProKw('BHKW', kW_th) ist die Quelle.
  },
};

// ── Simulationsrelevante Maßnahmen-Eigenschaften je Komponententyp ──────────
// sim:true = Eigenschaft geht in Strom-Berechnung ein (z.B. Leistung)
// sim:false = nur dokumentarisch (z.B. Zähler-Typ, Kraftstoff)
export const MASSNAHMEN_SIM_PROPS = {
  NAP:          [],
  Schaltanlage: [{ key:'felder',            label:'Anzahl Felder',           sim:true  },
                 { key:'nennstromA',         label:'Nennstrom (A)',           sim:false }],
  Trafo:        [{ key:'leistungKVA',        label:'Leistung (kVA)',          sim:true  }],
  NSHV:         [{ key:'leistungKVA',        label:'Leistung (kVA)',          sim:true  },
                 { key:'abgaenge',           label:'Abgänge',                 sim:false }],
  UV:           [{ key:'leistungKW',         label:'Durchgangsleistung (kW)', sim:true  },
                 { key:'zaehler',            label:'Zähler',                  sim:false },
                 { key:'kommunikation',      label:'Kommunikation',           sim:false }],
  Verbraucher:  [{ key:'leistungKW',         label:'Leistung (kW)',           sim:true  }],
  PV:           [{ key:'leistungKWp',        label:'Leistung (kWp)',          sim:true  }],
  Batterie:     [{ key:'leistungKW',         label:'Leistung (kW)',           sim:true  },
                 { key:'kapazitaetKWh',      label:'Kapazität (kWh)',         sim:false }],
  Lade:         [{ key:'anzahlPunkte',       label:'Anzahl Ladepunkte',       sim:true  },
                 { key:'leistungProPunktKW', label:'Leistung/Punkt (kW)',     sim:true  }],
  WP:           [{ key:'leistungKW',         label:'Leistung (kW)',           sim:true  }],
  Nsa:          [{ key:'leistungKW',         label:'Leistung (kW)',           sim:true  },
                 { key:'autonomieH',         label:'Autonomie (h)',           sim:false },
                 { key:'kraftstoff',         label:'Kraftstoff',              sim:false }],
  Reserve:      [],
  // Leitung ist kein Asset-Typ, aber Maßnahmen haben dieselbe Struktur:
  Leitung:      [{ key:'qs',                 label:'Querschnitt (mm²)',       sim:true  },
                 { key:'parallelCount',      label:'Parallelkabel',           sim:true  }],
};
