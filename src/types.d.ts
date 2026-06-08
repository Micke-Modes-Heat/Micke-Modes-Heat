// ── Domain-Typen — Micke-Modes-Heat ─────────────────────────────────────
// Interfaces für die Kernobjekte des Tools. Werden schrittweise erweitert
// wenn JS-Module nach TypeScript migriert werden.

// ── Gebäude ───────────────────────────────────────────────────────────────

export interface Gebaeude {
  id: number;
  name?: string;
  adresse?: string;
  flaeche?: number | null;       // Grundfläche m²
  stockwerke?: number;
  baujahr?: number | null;
  abrissjahr?: number | null;
  waerme?: string;               // MWh/a (als String aus Input)
  heizlast?: string;             // kW (als String aus Input)
  strom?: string;                // MWh/a
  spezStrom?: number;            // kWh/(m²·a)
  waermeManual?: boolean;
  heizlastManual?: boolean;
  nutzungstyp?: string;
  spezWaerme?: number;
  selected?: boolean;
  excluded?: boolean;
  polygon?: [number, number][];
  lat?: number;
  lng?: number;
  marker?: import('leaflet').Marker;
  layer?: import('leaflet').Polygon;
  feldVorgemerkt?: boolean;
  [key: string]: unknown;        // Zusatzfelder (Planung, Assets, etc.)
}

// ── Netz ──────────────────────────────────────────────────────────────────

export interface NetzEdge {
  u: number;                     // Gebäude-ID Anfang
  v: number;                     // Gebäude-ID Ende
  laenge?: number;               // m
  dn?: string;                   // Rohrdurchmesser (z.B. "DN50")
  waermeverlust?: number;        // W/(m·K)
  trasse?: boolean;
  layer?: import('leaflet').Polyline;
  [key: string]: unknown;
}

// ── Dispatch-Ergebnis ─────────────────────────────────────────────────────

export interface DispatchResult {
  thKwh: number;                 // Thermische Energie gesamt kWh/a
  elKwh: number;                 // Elektrischer Verbrauch kWh/a
  autoGkKwh: number;             // Auto-Gaskessel-Anteil kWh/a
  autoGkPeakKw: number;          // Auto-Gaskessel Spitzenlast kW
  co2Kg: number;                 // CO₂ gesamt kg/a
  kostenEur: number;             // Betriebskosten €/a
  deckungen: ErzeugerDeckung[];
  hourly?: HourlyDispatch;
}

export interface ErzeugerDeckung {
  key: string;
  label: string;
  color: string;
  pct: number;                   // Energetische Deckung %
  hlPct?: number;                // Leistungsdeckung im Heizlastfall %
  mwh: number;                   // MWh/a
  kw?: number;                   // Installierte Leistung kW
  jaz?: number;                  // Jahresarbeitszahl (WP)
  vbh?: number;                  // Vollbenutzungsstunden h/a
}

export interface HourlyDispatch {
  [key: string]: Float32Array;   // key = Erzeuger-Key, Float32Array[8760]
}

// ── Auto-GK-Ergebnis ──────────────────────────────────────────────────────

export interface AutoGkResult {
  leistungKw: number;
  deckungPct: number;
  waermeMwh: number;
}

// ── System-State (nach Hauptberechnung) ───────────────────────────────────

export interface SystemState {
  lastgangKw: Float32Array;      // 8760 Stunden-Lastgang kW
  tempH: Float32Array;           // 8760 Außentemperaturen °C
  vlH: Float32Array;             // 8760 Vorlauftemperaturen °C
  jahresdauerlinie: Float32Array;
  gesamtMwhMitNV: number;        // MWh/a inkl. Netzverluste
  nutzwaermeMwh: number;         // MWh/a Nutzwärme
  netzverlustPct: number;
  nurGebaeude: boolean;
  pMaxKw: number;                // Spitzenlast kW
  tMin: number;                  // Minimale Außentemperatur °C
  stadt: string;
  normAussentemp: number;
  vlMinus5: number;
  vl15: number;
  sigProfil1: string;
  sigProfil2?: string | null;
  gewicht1: number;
  gewicht2: number;
  berechnetAm: string;           // ISO-String
}

// ── Variante ──────────────────────────────────────────────────────────────

export interface Variante {
  id: string;
  name: string;
  erstelltAm?: string;
}

export interface VariantResult {
  netzVerbrauch: number;
  totalLoss: number;
  co2Val: number;
  investGes: number;
  jkGes: number;
  wgk?: number;
  [key: string]: unknown;
}

// ── Window-Erweiterungen ──────────────────────────────────────────────────
// Globale Variablen die per window.* gesetzt werden (Übergangszeit ES-Module → TS)

declare global {
  interface Window {
    // System-State
    systemState?: SystemState;
    _basisLastgangKw?: Float32Array;
    _basisYear?: number;
    _basisGebWaermeSumme?: number;

    // Dispatch
    _dispatchHourly?: { [key: string]: Float32Array };
    _dispatchActiveKeys?: string[];
    _dimJdlSorted?: Float32Array | null;
    _autoGkResult?: AutoGkResult | false | null;
    _lastInvestGes?: number;
    _lastJkGes?: number;
    _lastWgk?: number;
    _dispatchEnergy?: number;

    // Optimizer
    _optRunning?: boolean;
    _optAborted?: boolean;
    _optWorker?: Worker | null;
    _optWorkers?: Worker[];
    _optGrobResults?: unknown[];

    // Elektrisches Netz (stündliche Profile)
    elQuartierH?: Float32Array | null;
    elPvH?: Float32Array | null;
    _wpElHourly?: Float32Array | null;
    _skElHourly?: Float32Array | null;
    _bhkwElHourly?: Float32Array | null;
    _elQuartierFromGeb?: Float32Array | null;

    // UI / State
    gebaeude?: Gebaeude[];
    edgeStartId?: number | null;
    _optAbort?: boolean;

    // Wirtschaftlichkeit
    _wirtVdiOverrides?: Record<string, unknown>;
    _wirtBausteineOverrides?: Record<string, unknown>;

    // 3D-Visualisierung
    _ekroneDragging?: boolean;
    _ekroneMode?: string;
    _ekroneMaxKw?: number;

    // Leaflet-Map (globaler Zugriff aus älterem Code)
    L: typeof import('leaflet');
  }
}

export {};
