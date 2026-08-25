// ── lib/bestand-check.js — Plausibilitätsprüfung des Bestands ────────────────
//
// Das Tor vor jeder Planungsanalyse: Solange der Bestand nicht stimmt, ist alles
// Nachgelagerte wertlos — und zwar auf die gefährliche Art, weil ein Fahrplan
// aus falschen Bestandsdaten plausibel AUSSIEHT. Konkrete Fälle aus dem Projekt:
//   • Kabel ohne Länge → Ertüchtigungskosten kommen als 0 € heraus
//   • Betriebsmittel schon heute überlastet → landet als „Maßnahme im Startjahr"
//     im Fahrplan, obwohl es nie ausreichend dimensioniert war
//
// Die Prüfungen sind bewusst NICHT blockierend: in echten Projekten sind die
// Daten immer unvollständig. Stattdessen sagt der Reifegrad, welche Analyse mit
// dem aktuellen Datenstand trägt und welche noch Kaffeesatz ist.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar. Die app-seitige
// Schicht (elCalcAssets, Panel) liegt in 13w-bestand-panel.js.

export const SCHWERE = { FEHLER: 'fehler', WARNUNG: 'warnung', HINWEIS: 'hinweis' };

const _SCHWERE_RANG = { fehler: 0, warnung: 1, hinweis: 2 };

function befund(id, schwere, titel, detail, betroffene) {
  return { id, schwere, titel, detail, betroffene: betroffene || [] };
}

const _label = (o, fallback) => o?.name || o?.label || fallback;

// ── Einzelprüfungen ──────────────────────────────────────────────────────────

/**
 * Kabellängen. Eine Länge von 0 ist kein Schönheitsfehler: Kabel- UND
 * Tiefbaukosten werden mit der Länge multipliziert, jede Ertüchtigung dieses
 * Kabels kostet damit 0 €. Der Fahrplan wirkt vollständig und ist es nicht.
 */
export function pruefeKabellaengen(edges) {
  const ohne = [];
  const winzig = [];
  for (const e of (edges || [])) {
    // Stationsinterne Verbindungen (beide Enden im selben Gebäude, z.B.
    // Trafo↔NSHV in einer Kompaktstation): Länge ≈ 0 ist real, kein Mangel.
    if (e?.stationsintern) continue;
    const l = Number(e?.lengthM);
    if (!Number.isFinite(l) || l <= 0) ohne.push({ id: e.id, art: 'kabel', label: _label(e, e.id) });
    else if (l < 1) winzig.push({ id: e.id, art: 'kabel', label: `${_label(e, e.id)} (${l.toFixed(2)} m)` });
  }
  const out = [];
  if (ohne.length) out.push(befund('laenge-null', SCHWERE.FEHLER,
    'Kabel ohne Länge',
    'Kosten werden mit der Länge multipliziert — jede Ertüchtigung dieser Kabel ergibt 0 €.',
    ohne));
  if (winzig.length) out.push(befund('laenge-winzig', SCHWERE.WARNUNG,
    'Kabel unter 1 m',
    'Vermutlich übereinanderliegende Endpunkte. Spannungsfall und Kosten werden dadurch zu klein.',
    winzig));
  return out;
}

/**
 * Querschnitte. Fehlt der Querschnitt bei einem NICHT auto-dimensionierten
 * Kabel, hat die Berechnung keine Grundlage. Auto-dimensionierte Kabel sind
 * unkritisch — sie bekommen ihren Querschnitt bei jeder Rechnung neu.
 */
export function pruefeQuerschnitte(edges) {
  const fehlend = (edges || [])
    .filter(e => !e?.autoSized && !(Number(e?.crossSection) > 0))
    .map(e => ({ id: e.id, art: 'kabel', label: _label(e, e.id) }));
  return fehlend.length
    ? [befund('querschnitt-fehlt', SCHWERE.FEHLER,
        'Kabel ohne Querschnitt',
        'Ohne Querschnitt gibt es weder Strombelastbarkeit noch Spannungsfall — diese Kabel fehlen faktisch in der Netzberechnung.',
        fehlend)]
    : [];
}

/**
 * Topologie. Geprüft wird, ob überhaupt eine Quelle existiert und ob jedes
 * Betriebsmittel von ihr aus erreichbar ist. Nicht erreichbare Assets tragen
 * nichts zur Lastflussrechnung bei und fallen aus jeder Auswertung heraus,
 * ohne dass es irgendwo auffällt.
 */
export function pruefeTopologie(assets, edges, quellTypen) {
  const quellen = new Set(quellTypen || ['NAP']);
  const items = assets || [];
  const kanten = edges || [];
  const out = [];

  const wurzeln = items.filter(a => quellen.has(a.type));
  if (!wurzeln.length) {
    out.push(befund('keine-quelle', SCHWERE.FEHLER,
      'Kein Netzanknüpfungspunkt',
      'Ohne NAP gibt es keine Einspeisequelle — Lastfluss und Spannungsfall haben keinen Bezugspunkt.',
      []));
    return out;   // ohne Wurzel ist die Erreichbarkeitsprüfung sinnlos
  }

  // Erreichbarkeit ungerichtet ab allen Quellen
  const nachbarn = new Map();
  for (const e of kanten) {
    if (!nachbarn.has(e.u)) nachbarn.set(e.u, []);
    if (!nachbarn.has(e.v)) nachbarn.set(e.v, []);
    nachbarn.get(e.u).push(e.v);
    nachbarn.get(e.v).push(e.u);
  }
  const erreicht = new Set(wurzeln.map(a => a.id));
  const queue = [...erreicht];
  while (queue.length) {
    for (const nb of (nachbarn.get(queue.shift()) || [])) {
      if (erreicht.has(nb)) continue;
      erreicht.add(nb);
      queue.push(nb);
    }
  }

  const ohneKante = [];
  const unerreichbar = [];
  for (const a of items) {
    if (quellen.has(a.type)) continue;
    if (!nachbarn.has(a.id)) ohneKante.push({ id: a.id, art: 'asset', label: _label(a, a.id) });
    else if (!erreicht.has(a.id)) unerreichbar.push({ id: a.id, art: 'asset', label: _label(a, a.id) });
  }

  if (ohneKante.length) out.push(befund('ohne-kante', SCHWERE.WARNUNG,
    'Anlagen ohne Leitung',
    'Nicht verkabelt — sie erscheinen in keiner Lastfluss- oder Engpassauswertung.',
    ohneKante));
  if (unerreichbar.length) out.push(befund('unerreichbar', SCHWERE.WARNUNG,
    'Anlagen ohne Verbindung zur Quelle',
    'Verkabelt, aber kein Pfad zum NAP — ihre Last taucht in keiner Auswertung auf.',
    unerreichbar));
  return out;
}

/**
 * Widersprüche zwischen Lebenszyklus und Planungsschicht.
 *
 * Erst durch die Schichten (lib/schichten.js) überhaupt prüfbar: Ein Objekt der
 * Schicht „Bestand" mit Baujahr in der Zukunft behauptet zwei Dinge gleichzeitig
 * — es existiert heute und wird erst gebaut. Vorher war das nicht erkennbar,
 * weil Bestand und Planung nicht unterscheidbar waren.
 */
export function pruefeLebenszyklus(objekte, heute) {
  const jahr = heute ?? new Date().getFullYear();
  const verdreht = [];
  const bestandZukunft = [];
  for (const o of (objekte || [])) {
    const bj = parseInt(o?.baujahr);
    const aj = parseInt(o?.abrissjahr);
    if (Number.isFinite(bj) && Number.isFinite(aj) && bj > aj) {
      verdreht.push({ id: o.id, art: o._art || 'asset', label: `${_label(o, o.id)} (${bj} → ${aj})` });
    }
    if (o?.schicht === 'bestand' && Number.isFinite(bj) && bj > jahr) {
      bestandZukunft.push({ id: o.id, art: o._art || 'asset', label: `${_label(o, o.id)} (${bj})` });
    }
  }
  const out = [];
  if (verdreht.length) out.push(befund('lebenszyklus-verdreht', SCHWERE.FEHLER,
    'Abriss vor Baujahr',
    'Das Objekt existiert in keinem Jahr — es fällt aus jeder jahresbezogenen Auswertung heraus.',
    verdreht));
  if (bestandZukunft.length) out.push(befund('bestand-zukunft', SCHWERE.WARNUNG,
    'Bestand mit Baujahr in der Zukunft',
    'Als Bestand eingestuft, aber erst später gebaut. Entweder gehört es in die Entwicklungsschicht, oder das Baujahr stimmt nicht.',
    bestandZukunft));
  return out;
}

/**
 * Überlastung im Basisjahr. Was heute schon über der Grenze liegt, ist kein
 * Ausbaubedarf, sondern eine zu klein erfasste Bestandsdimensionierung.
 * Erwartet Kanten NACH einer Netzberechnung für das Basisjahr.
 */
export function pruefeAuslastungHeute(edges, grenzAuslastungPct) {
  const grenze = grenzAuslastungPct ?? 100;
  const ueber = (edges || [])
    .filter(e => Number(e?.auslastungPct) > grenze)
    .map(e => ({ id: e.id, art: 'kabel', label: `${_label(e, e.id)} (${Number(e.auslastungPct).toFixed(0)} %)` }));
  return ueber.length
    ? [befund('ueberlast-heute', SCHWERE.WARNUNG,
        'Schon heute überlastet',
        'Kein Ausbaubedarf, sondern vermutlich eine zu klein erfasste Bestandsdimensionierung — sonst erscheint der erste Zubau als Auslöser einer längst überfälligen Ertüchtigung.',
        ueber)]
    : [];
}

// ── Reifegrad ────────────────────────────────────────────────────────────────

/**
 * Welche Analyse trägt mit dem aktuellen Datenstand?
 *
 * Bewusst als Stufenleiter statt als Ja/Nein: In echten Projekten kommen die
 * Daten schrittweise herein (Feldapp!), und die Frage lautet nie „ist der
 * Bestand fertig", sondern „was kann ich jetzt schon belastbar auswerten".
 *
 * daten: { gebaeude, assets, edges }
 * Rückgabe: [{ id, label, erfuellt, fehlt }] in aufsteigender Anspruchshöhe.
 */
export function bestandReifegrad(daten) {
  const geb  = daten?.gebaeude || [];
  const ass  = daten?.assets   || [];
  const edg  = daten?.edges    || [];

  const mitFlaeche = geb.filter(g => Number(g?.flaeche) > 0 && g?.nutzung).length;
  const hatQuelle  = ass.some(a => a.type === 'NAP');
  const mitLaenge  = edg.filter(e => Number(e?.lengthM) > 0).length;
  const mitQs      = edg.filter(e => e?.autoSized || Number(e?.crossSection) > 0).length;
  const mitJahr    = ass.filter(a => a?.baujahr).length;

  const stufe = (id, label, erfuellt, fehlt) => ({ id, label, erfuellt, fehlt: erfuellt ? '' : fehlt });

  return [
    stufe('bedarf', 'Bedarfsabschätzung',
      geb.length > 0 && mitFlaeche === geb.length,
      geb.length === 0 ? 'keine Gebäude erfasst' : `${geb.length - mitFlaeche} Gebäude ohne Fläche oder Nutzung`),
    stufe('topologie', 'Netzstruktur & Cluster',
      hatQuelle && edg.length > 0,
      !hatQuelle ? 'kein NAP' : 'keine Leitungen'),
    stufe('lastfluss', 'Lastfluss & Spannungsfall',
      edg.length > 0 && mitLaenge === edg.length && mitQs === edg.length,
      edg.length === 0 ? 'keine Leitungen'
        : [mitLaenge < edg.length ? `${edg.length - mitLaenge} ohne Länge` : '',
           mitQs < edg.length ? `${edg.length - mitQs} ohne Querschnitt` : ''].filter(Boolean).join(', ')),
    stufe('engpass', 'Engpass-Fahrplan',
      ass.length > 0 && mitJahr > 0 && edg.length > 0 && mitLaenge === edg.length,
      mitJahr === 0 ? 'keine Lebenszyklusjahre gepflegt' : 'setzt einen belastbaren Lastfluss voraus'),
  ];
}

// ── Gesamtprüfung ────────────────────────────────────────────────────────────

/**
 * Alle Prüfungen, nach Schwere sortiert.
 *
 * daten: { assets, edges, gebaeude, heute, quellTypen, grenzAuslastungPct }
 * Rückgabe: { befunde, reifegrad, zaehler: { fehler, warnung, hinweis } }
 */
export function bestandPruefen(daten) {
  const { assets = [], edges = [], gebaeude = [], heute, quellTypen, grenzAuslastungPct } = daten || {};

  // Gebäude für die Lebenszyklusprüfung markieren, damit der Sprung auf der
  // Karte später weiß, worum es sich handelt.
  const lebenszyklusObjekte = [
    ...assets,
    ...gebaeude.map(g => ({ ...g, _art: 'gebaeude' })),
  ];

  const befunde = [
    ...pruefeKabellaengen(edges),
    ...pruefeQuerschnitte(edges),
    ...pruefeTopologie(assets, edges, quellTypen),
    ...pruefeLebenszyklus(lebenszyklusObjekte, heute),
    ...pruefeAuslastungHeute(edges, grenzAuslastungPct),
  ].sort((a, b) => _SCHWERE_RANG[a.schwere] - _SCHWERE_RANG[b.schwere]);

  const zaehler = { fehler: 0, warnung: 0, hinweis: 0 };
  for (const b of befunde) zaehler[b.schwere]++;

  return { befunde, reifegrad: bestandReifegrad({ assets, edges, gebaeude }), zaehler };
}
