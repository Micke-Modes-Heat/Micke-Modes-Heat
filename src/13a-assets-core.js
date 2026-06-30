// ── 13a-assets-core.js — Unified Asset-System (Strom + später Wärme) ─────────
// Datenstruktur & CRUD für Anlagen. Neutral benannt (ASSETS, nicht EL.assets),
// damit Wärme-Erzeuger später in dasselbe System einziehen können.

import { globalYear, massnahmeJahr } from './01-globals-varianten.js';

// ── Asset-Typ-Katalog ──────────────────────────────────────────────────────
// domain: 'strom' | 'waerme' | 'hybrid' (z.B. WP, BHKW später)
// energy_in/out: welche Energieflüsse hat der Typ?
export const ASSET_CFG = {
  // ── Strom-Infrastruktur ──
  NAP:          { label:'NAP',               icon:'⚡', color:'#e53935', domain:'strom', kategorie:'infrastruktur', energy_in:['netz'], energy_out:['strom'],
                  beschreibung:'NAP = Netzanknüpfungspunkt. Übergabe-/Einspeisepunkt vom vorgelagerten Mittelspannungsnetz — i. d. R. der erste Knoten im Stromnetz.' },
  Schaltanlage: { label:'Schaltanlage',      icon:'⊞', color:'#ff9800', domain:'strom', kategorie:'infrastruktur', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Mittelspannungs-Schaltanlage: schaltet und sichert die MS-Abgänge zwischen NAP und Trafo (Anzahl Felder, Nennstrom).' },
  Trafo:        { label:'Trafo',             icon:'🔁', color:'#f9a825', domain:'strom', kategorie:'infrastruktur', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Transformator: wandelt Mittelspannung in Niederspannung (oder umgekehrt bei Einspeisung). Leistung in kVA, uk in % bestimmen Auslastung und Spannungsfall.' },
  NSHV:         { label:'NSHV',              icon:'🗄', color:'#4fc3f7', domain:'strom', kategorie:'infrastruktur', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Niederspannungs-Hauptverteilung: verteilt den Strom vom Trafo auf die einzelnen Abgänge zu Gebäuden/Verbrauchern.' },
  UV:           { label:'UV',                icon:'📦', color:'#64b5f6', domain:'strom', kategorie:'infrastruktur', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Unterverteilung: zweigt von einer NSHV oder Hauptleitung ab, um weiter entfernte Verbraucher zu erschließen.' },
  KVS:          { label:'KVS',              icon:'▣',  color:'#607d8b', domain:'strom', kategorie:'infrastruktur', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Kabelverteilerschrank: Verzweigungspunkt im Niederspannungsnetz zur Aufteilung auf mehrere Hausanschlüsse.' },
  // ── Strom-Verbraucher ──
  Verbraucher:  { label:'Verbraucher',       icon:'🏠', color:'#81c784', domain:'strom', kategorie:'verbraucher', energy_in:['strom'], energy_out:[],
                  beschreibung:'Allgemeiner Stromverbraucher (z. B. Gebäude/Anschlussnehmer ohne eigenes Asset). Anschlussleistung in kW bestimmt die Last.' },
  Lade:         { label:'Ladeinfrastruktur', icon:'🔌', color:'#4dd0e1', domain:'strom', kategorie:'verbraucher', energy_in:['strom'], energy_out:[],
                  beschreibung:'Ladeinfrastruktur (z. B. Wallboxen, Ladesäulen): Last ergibt sich aus Anzahl Ladepunkte × Leistung je Punkt.' },
  // ── Strom-Erzeuger ──
  PV:           { label:'PV',                icon:'☀', color:'#ffee58', domain:'strom', kategorie:'erzeuger', energy_in:['solar'], energy_out:['strom'],
                  beschreibung:'Photovoltaik-Anlage: erzeugt Strom aus Solarstrahlung. Speist je nach Eigenverbrauch/Überschuss ins Netz ein.' },
  Wind:         { label:'Windkraftanlage',   icon:'🌀', color:'#80deea', domain:'strom', kategorie:'erzeuger', energy_in:['wind'], energy_out:['strom'],
                  beschreibung:'Windkraftanlage: erzeugt Strom aus Windenergie — typischerweise mit hoher Einspeiseleistung ins Mittelspannungsnetz.' },
  Nsa:          { label:'Notstromaggregat',  icon:'⚙', color:'#ff7043', domain:'strom', kategorie:'erzeuger', energy_in:['diesel'], energy_out:['strom'],
                  beschreibung:'Notstromaggregat: Backup-Erzeuger (z. B. Diesel) zur Versorgungssicherheit bei Netzausfall.' },
  // ── Strom-Speicher ──
  Batterie:     { label:'Batterie',          icon:'🔋', color:'#aed581', domain:'strom', kategorie:'speicher', energy_in:['strom'], energy_out:['strom'],
                  beschreibung:'Batteriespeicher: speichert überschüssigen Strom (z. B. PV-Erzeugung) zwischen und entlastet damit Netzanschluss und Trafo bei Lastspitzen.' },
  // ── Hybrid (Strom + Wärme) — werden über Erzeuger-Tab gesteuert, nicht manuell platzierbar ──
  WP:           { label:'Luft-WP',           icon:'💨', color:'#66bb6a', domain:'hybrid', kategorie:'erzeuger', energy_in:['strom'], energy_out:['waerme'],
                  beschreibung:'Luft-Wärmepumpe: wandelt Strom in Wärme um — wird über den Erzeuger-Tab verwaltet.' },
  Geo:          { label:'Geothermie',         icon:'♨',  color:'#a1887f', domain:'hybrid', kategorie:'erzeuger', energy_in:['strom'], energy_out:['waerme'],
                  beschreibung:'Geothermie-Wärmepumpe: nutzt Erdwärme als Quelle — wird über den Erzeuger-Tab verwaltet.' },
  FG:           { label:'Fließgew.-WP',       icon:'∼',  color:'#29b6f6', domain:'hybrid', kategorie:'erzeuger', energy_in:['strom'], energy_out:['waerme'],
                  beschreibung:'Fließgewässer-Wärmepumpe: nutzt Flusswasser als Wärmequelle — wird über den Erzeuger-Tab verwaltet.' },
  KWK:          { label:'KWK-Anlage',         icon:'🔥', color:'#f48fb1', domain:'hybrid', kategorie:'erzeuger', energy_in:['gas'], energy_out:['strom','waerme'],
                  beschreibung:'Blockheizkraftwerk (Kraft-Wärme-Kopplung): erzeugt gleichzeitig Strom und Wärme — wird über den Erzeuger-Tab verwaltet.' },
  Stromkessel:  { label:'Stromkessel',        icon:'⚡',  color:'#ff8f00', domain:'hybrid', kategorie:'erzeuger', energy_in:['strom'], energy_out:['waerme'],
                  beschreibung:'Elektrischer Heizkessel: wandelt Strom direkt in Wärme — wird über den Erzeuger-Tab verwaltet.' },
  // ── Reserve ──
  Reserve:      { label:'Reserve',           icon:'◻', color:'#90a4ae', domain:'strom', kategorie:'sonstiges', energy_in:[], energy_out:[],
                  beschreibung:'Reserve-Asset: Platzhalter für zukünftige Erweiterungen oder noch nicht klassifizierte Komponenten.' },
};

// Typrangfolge für Sortierung/Topologie: niedriger = versorgungsseitig
export const TYPE_RANK = {
  NAP:0, Schaltanlage:1, Trafo:2, NSHV:3, UV:4, KVS:4,
  Verbraucher:5, WP:5, Geo:5, FG:5, Stromkessel:5, Lade:5, Nsa:5, KWK:5,
  Wind:6, PV:6, Batterie:6, Reserve:7,
};

// Simulationsrelevante Props pro Typ (für elCalcAssets)
export const ASSET_PROPS_SCHEMA = {
  NAP:          [{ key:'spannungKV',         label:'Nennspannung (kV)' }],
  Schaltanlage: [{ key:'felder',             label:'Anzahl Felder' },
                 { key:'nennstromA',          label:'Nennstrom (A)' },
                 { key:'trennstelle',         label:'Trennstelle' }],
  Trafo:        [{ key:'leistungKVA',         label:'Leistung (kVA)' },
                 { key:'ukProzent',           label:'UK (%)' }],
  NSHV:         [{ key:'nennstromA',          label:'Nennstrom (A)' },
                 { key:'abgaenge',            label:'Abgänge' }],
  UV:           [{ key:'nennstromA',          label:'Nennstrom (A)' },
                 { key:'abgaenge',            label:'Abgänge' }],
  KVS:          [{ key:'nennstromA',          label:'Nennstrom (A)' },
                 { key:'abgaenge',            label:'Abgänge' }],
  Verbraucher:  [{ key:'leistungKW',          label:'Leistung (kW)' }],
  PV:           [{ key:'leistungKWp',  label:'Leistung (kWp)' },
                 { key:'ausrichtung', label:'Ausrichtung' },
                 { key:'pvSpez',      label:'Ertrag (kWh/kWp·a)' }],
  Batterie:     [{ key:'leistungKW',          label:'Leistung (kW)' },
                 { key:'kapazitaetKWh',       label:'Kapazität (kWh)' },
                 { key:'betriebsmodus',       label:'Betriebsmodus' }],
  Lade:         [{ key:'anzahlPunkte',        label:'Anz. Standardladepunkte' },
                 { key:'leistungProPunktKW',  label:'Leistung/Punkt (kW)' },
                 { key:'gleichzeitigFaktor',  label:'Gleichzeitigkeitsfaktor (0–1)' },
                 { key:'anzahlSchnell',       label:'Anz. Schnelllader' },
                 { key:'leistungSchnellKW',   label:'Leistung Schnelllader (kW)' }],
  WP:           [{ key:'leistungThKW',  label:'Th. Leistung (kW)' },
                 { key:'leistungElKW',  label:'El. Bedarf (kW)' },
                 { key:'jaz',           label:'JAZ' }],
  Geo:          [{ key:'leistungThKW',  label:'Th. Leistung (kW)' },
                 { key:'leistungElKW',  label:'El. Bedarf (kW)' },
                 { key:'jaz',           label:'JAZ' }],
  FG:           [{ key:'leistungThKW',  label:'Th. Leistung (kW)' },
                 { key:'leistungElKW',  label:'El. Bedarf (kW)' },
                 { key:'jaz',           label:'JAZ' }],
  Stromkessel:  [{ key:'leistungKW',    label:'El. Leistung (kW)' }],
  Nsa:          [{ key:'leistungKW',          label:'Leistung (kW)' },
                 { key:'autonomieH',          label:'Autonomie (h)' },
                 { key:'kraftstoff',          label:'Kraftstoff' }],
  Wind:         [{ key:'leistungKW',          label:'Nennleistung (kW)' },
                 { key:'nabenhoheM',          label:'Nabenhöhe (m)' },
                 { key:'rotordurchmesserM',   label:'Rotordurchmesser (m)' }],
  KWK:          [{ key:'leistungElKW',        label:'El. Leistung (kW)' },
                 { key:'leistungThKW',        label:'Th. Leistung (kW)' },
                 { key:'wirkungsgradEl',      label:'El. Wirkungsgrad (%)' },
                 { key:'brennstoff',          label:'Brennstoff' }],
  Reserve:      [],
};

// ── Single Source of Truth — alle Anlagen, alle Domains ────────────────────
export const ASSETS = {
  items:    [],  // Asset-Objekte: {id,type,domain,lat,lng,buildingId,name,props,baujahr,abrissjahr,massnahmen,_marker}
  edges:    [],  // Leitungen (Strom + später Wärme): {id,aId,bId,domain,route,qs,...}
  selectedId: null,
};

// ── Hilfsfunktionen ────────────────────────────────────────────────────────
export function assetUid() {
  return 'a_' + Math.random().toString(36).slice(2, 9);
}

// Lebenszyklus-Status eines Assets/Edges bezogen auf ein Jahr
export function getAssetStatus(item, year) {
  const y = year ?? globalYear ?? new Date().getFullYear();
  const bj = item.baujahr ? parseInt(item.baujahr) : null;
  const aj = item.abrissjahr ? parseInt(item.abrissjahr) : null;
  if (bj && y < bj) return 'planned';
  if (aj && y >= aj) return 'demolished';
  return 'active';
}

// Effektive Props für ein Jahr: Basis-Props + alle umgesetzten Maßnahmen mit newProps
// (chronologisch akkumuliert bis zum angegebenen Jahr)
export function getAssetPropsForYear(asset, year) {
  const y = year ?? globalYear ?? new Date().getFullYear();
  const props = { ...(asset.props || {}) };
  const measures = (asset.massnahmen || [])
    .filter(m => m.status === 'umgesetzt' && m.newProps && Object.keys(m.newProps).length > 0)
    .filter(m => { const mj = massnahmeJahr(m); return mj === null || mj <= y; })
    .sort((a, b) => (massnahmeJahr(a) ?? 0) - (massnahmeJahr(b) ?? 0));
  for (const m of measures) {
    Object.assign(props, m.newProps);
  }
  return props;
}

// ── CRUD ───────────────────────────────────────────────────────────────────
export function createAsset(type, lat, lng, opts = {}) {
  const cfg = ASSET_CFG[type];
  if (!cfg) { console.warn('Unbekannter Asset-Typ:', type); return null; }

  // Index pro Typ für Default-Namen ("PV 1", "PV 2", ...)
  const idx = ASSETS.items.filter(a => a.type === type).length + 1;

  // Baujahr/Abrissjahr aus verknüpftem Gebäude übernehmen, falls nicht explizit
  let baujahr    = opts.baujahr    ?? null;
  let abrissjahr = opts.abrissjahr ?? null;
  if (opts.buildingId && (!baujahr || !abrissjahr)) {
    const geb = (typeof window !== 'undefined' && window.gebaeude)
      ? window.gebaeude.find(g => g.id === opts.buildingId) : null;
    if (geb) {
      if (!baujahr    && geb.baujahr)    baujahr    = geb.baujahr;
      if (!abrissjahr && geb.abrissjahr) abrissjahr = geb.abrissjahr;
    }
  }

  const asset = {
    id:         opts.id         || assetUid(),
    type,
    domain:     cfg.domain,
    lat, lng,
    name:       opts.name       || `${cfg.label} ${idx}`,
    buildingId: opts.buildingId || null,
    props:      opts.props      || {},
    baujahr,
    abrissjahr,
    massnahmen: opts.massnahmen || [],
    _marker:    null,
  };

  ASSETS.items.push(asset);
  return asset;
}

export function deleteAsset(id) {
  const i = ASSETS.items.findIndex(a => a.id === id);
  if (i < 0) return false;
  const a = ASSETS.items[i];
  // Marker entfernen (falls Renderer gesetzt hat)
  if (a._marker    && a._marker.remove)    a._marker.remove();
  if (a._ladeLayer && a._ladeLayer.remove) a._ladeLayer.remove();
  // Zugehörige Leitungen löschen
  ASSETS.edges = ASSETS.edges.filter(e => e.aId !== id && e.bId !== id);
  ASSETS.items.splice(i, 1);
  // Registrierten Strom-Knoten mitsamt Marker entfernen — sonst bleibt ein
  // verwaister Knoten in window.stromNodes zurück, der beim Speichern persistiert
  // und beim Laden als grauer „Geister"-Marker (klickt nicht zum Inspektor) erscheint.
  if (typeof window !== 'undefined' && Array.isArray(window.stromNodes)) {
    const ni = window.stromNodes.findIndex(n => n.id === id);
    if (ni >= 0) {
      const sn = window.stromNodes[ni];
      if (sn.marker && sn.marker.remove) sn.marker.remove();
      window.stromNodes.splice(ni, 1);
    }
  }
  if (ASSETS.selectedId === id) ASSETS.selectedId = null;
  return true;
}

export function getAsset(id) {
  return ASSETS.items.find(a => a.id === id) || null;
}

// Filter-Liste: nach Domain ('strom'/'waerme'/'hybrid'), Typ, Gebäude
export function listAssets({ domain, type, buildingId } = {}) {
  return ASSETS.items.filter(a => {
    if (domain && a.domain !== domain && !(domain === 'strom' && a.domain === 'hybrid')) return false;
    if (type && a.type !== type) return false;
    if (buildingId !== undefined && a.buildingId !== buildingId) return false;
    return true;
  });
}

// Alle Assets eines Gebäudes (per-Building-View)
export function getAssetsForBuilding(buildingId) {
  return ASSETS.items.filter(a => a.buildingId === buildingId);
}

// Komplette Asset-Liste leeren (z.B. beim Projekt-Laden)
export function clearAssets() {
  for (const a of ASSETS.items) {
    if (a._marker && a._marker.remove) a._marker.remove();
  }
  ASSETS.items.length = 0;
  ASSETS.edges.length = 0;
  ASSETS.selectedId = null;
}
