// ── lib/netz-schwellen.js — Schwellentreppe: Bestand ertüchtigen oder Erzeugungsnetz? ──
//
// Beantwortet die Portfoliofrage über der Einzelanlage: Bis wohin trägt das
// bestehende Netz die geplante Erzeugung, wo reißt es, und was kostet die
// Auflösung — Bestand ertüchtigen, eigenes Erzeugungsnetz, oder eine Mischung.
//
// ── Zwei Ebenen, zwei Topologien ────────────────────────────────────────────
// Die Liegenschaft betreibt ein eigenes Netz mit 20-kV-Einspeisung. Entscheidend
// ist, dass die beiden Ebenen NICHT gleich aufgebaut sind:
//
//   MS-Ebene:  Ring. Die Trafos hängen im Ring am NAP. Wer hier radial von
//              jedem NAP abwärts sucht, zählt Trafos MEHRFACH — Auslastungen
//              jenseits 150 % sind das typische Symptom. Deshalb: Cluster =
//              zusammenhängende Netzkomponente, Kapazität am 20-kV-Punkt.
//   NS-Ebene:  radial. Jede Erzeugungsanlage hängt über NSHV/UV/KVS an genau
//              EINEM Trafo. Diese Zuordnung ist eindeutig, solange man beim
//              Aufwärtslaufen den Ring nicht überquert.
//
// ── Die Treppe ──────────────────────────────────────────────────────────────
// Die Grenzen greifen kumulativ, nicht alternativ:
//   1. Trafo-Rückspeisegrenze  (je Trafo, NS-Ebene)
//   2. 20-kV-NAP-Limit         (je Komponente, MS-Ebene)
// Der Spannungsfall auf den Strängen ist die dritte Stufe; die deckt der
// zeitliche Engpass-Sweep (14h) ab und wird hier bewusst nicht verdoppelt.
//
// Ein Erzeugungsnetz ist ein Sprungkostenblock: Es lohnt erst, wenn genug
// Erzeugung dahintersteht. Deshalb ist die eigentliche Entscheidung je Cluster
// nicht "welche von drei Optionen", sondern: unter der Schwelle bleiben und
// stückeln — oder die Schwelle bewusst auslösen und bündeln.
//
// Die ZAHLEN (Rückspeisung je Knoten) kommen aus lib/lastgang-schnappschuss.js;
// dieses Modul liefert Struktur und Kaskade. Importfrei und DOM-frei.

/** Verteilebenen, die beim Aufwärtslaufen durchquert werden dürfen. */
const LV_PASS = new Set(['NSHV', 'UV', 'KVS']);

/** Kostenannahmen — grob, bewusst injizierbar. */
export const SCHWELLEN_KOSTEN = {
  trafoEurProKVA:          150,
  napEurProKW:             200,
  erzeugungsnetzEurProKW:  400,
};

/** Anteil der Trafo-Scheinleistung, der rückwärts nutzbar ist. */
export const TRAFO_RUECK_FAKTOR = 0.9;

// ── Struktur ─────────────────────────────────────────────────────────────────

function _assetMap(assets) { return new Map((assets || []).map(a => [a.id, a])); }

function _nachbarn(edges, { ohneMs = false } = {}) {
  const m = new Map();
  for (const e of (edges || [])) {
    if (ohneMs && e.msLevel) continue;
    if (!m.has(e.u)) m.set(e.u, []);
    if (!m.has(e.v)) m.set(e.v, []);
    m.get(e.u).push(e.v);
    m.get(e.v).push(e.u);
  }
  return m;
}

/**
 * Zusammenhängende Netzkomponenten ("Cluster").
 *
 * Bewusst ungerichtet und über ALLE Kanten inklusive Ring: Ein Ring ist genau
 * eine Komponente, egal von welchem Knoten aus man startet. Das ist die
 * Korrektur gegen den radialen Ansatz, der Ring-Trafos doppelt zählt.
 *
 * Rückgabe: [{ id, assetIds, napIds, trafoIds, blattIds }]
 */
export function netzKomponenten(assets, edges) {
  const map = _assetMap(assets);
  const nb = _nachbarn(edges);
  const gesehen = new Set();
  const komponenten = [];

  for (const a of (assets || [])) {
    if (gesehen.has(a.id)) continue;
    const mitglieder = [];
    const queue = [a.id];
    gesehen.add(a.id);
    while (queue.length) {
      const cur = queue.shift();
      if (map.has(cur)) mitglieder.push(cur);
      for (const n of (nb.get(cur) || [])) {
        if (gesehen.has(n)) continue;
        gesehen.add(n);
        queue.push(n);
      }
    }
    const typVon = id => map.get(id)?.type;
    komponenten.push({
      id: `k_${mitglieder[0]}`,
      assetIds: mitglieder,
      napIds:   mitglieder.filter(id => typVon(id) === 'NAP'),
      trafoIds: mitglieder.filter(id => typVon(id) === 'Trafo'),
      blattIds: mitglieder.filter(id => { const t = typVon(id); return t && t !== 'NAP' && t !== 'Trafo' && !LV_PASS.has(t) && t !== 'Schaltanlage'; }),
    });
  }
  return komponenten;
}

/**
 * Der Trafo, an dem ein Blattknoten hängt.
 *
 * Läuft über die NS-Verteilebenen (NSHV/UV/KVS) aufwärts bis zum ERSTEN Trafo
 * und überquert dabei KEINE MS-Kante — sonst liefe man in den Ring und die
 * Zuordnung würde mehrdeutig. Gibt null zurück, wenn kein Trafo erreichbar ist
 * (Anlage direkt an MS oder gar nicht verkabelt).
 */
export function blattZuTrafo(blattId, assets, edges) {
  const map = _assetMap(assets);
  const nb = _nachbarn(edges, { ohneMs: true });
  const gesehen = new Set([blattId]);
  const queue = [blattId];

  while (queue.length) {
    for (const n of (nb.get(queue.shift()) || [])) {
      if (gesehen.has(n)) continue;
      gesehen.add(n);
      const a = map.get(n);
      if (!a) continue;                       // Gebäudeknoten o. Ä.
      if (a.type === 'Trafo') return a.id;
      if (LV_PASS.has(a.type)) queue.push(n);  // weiter aufwärts
    }
  }
  return null;
}

/**
 * Kapazität einer Komponente am Einspeisepunkt.
 *
 * Das NAP-Limit gewinnt, wenn es bekannt ist: Es ist die harte Zusage des
 * vorgelagerten Netzbetreibers und liegt regelmäßig UNTER der Summe der
 * Trafoleistungen. Fehlt es, bleibt nur die Summe der Trafos als Näherung —
 * dann ist das Ergebnis eine Obergrenze, keine Zusage.
 */
export function komponenteKapazitaetKW(komponente, assets, opts = {}) {
  const napLimitKw = Number(opts.napLimitKw);
  if (Number.isFinite(napLimitKw) && napLimitKw > 0) {
    return { kW: napLimitKw, quelle: 'nap' };
  }
  const map = _assetMap(assets);
  const summe = (komponente?.trafoIds || []).reduce((s, id) => {
    const kva = parseFloat(map.get(id)?.props?.leistungKVA);
    return s + (Number.isFinite(kva) ? kva : 0);
  }, 0);
  return { kW: summe * 0.95, quelle: 'trafos' };
}

// ── Treppe ───────────────────────────────────────────────────────────────────

/**
 * Prüft eine Komponente gegen beide Stufen der Treppe.
 *
 * rueckJeKnoten: { [assetId]: rueckspeisungKW }  — aus dem Lastgang-Schnappschuss
 * Rückgabe: {
 *   rueckKW, kapazitaetKW, quelle, ausgeschoepftPct,
 *   trafoVerletzungen: [{ id, name, kvA, grenzeKW, rueckKW, ueberKW }],
 *   napVerletzung: { grenzeKW, rueckKW, ueberKW } | null,
 *   stufe: 'frei' | 'trafo' | 'nap'
 * }
 */
export function pruefeSchwellen(komponente, assets, rueckJeKnoten, opts = {}) {
  const map = _assetMap(assets);
  const rueck = id => Math.max(0, Number(rueckJeKnoten?.[id]) || 0);
  const faktor = opts.trafoRueckFaktor ?? TRAFO_RUECK_FAKTOR;

  const trafoVerletzungen = [];
  for (const id of (komponente?.trafoIds || [])) {
    const a = map.get(id);
    const kvA = parseFloat(a?.props?.leistungKVA) || 0;
    const grenzeKW = kvA * faktor;
    const r = rueck(id);
    if (grenzeKW > 0 && r > grenzeKW) {
      trafoVerletzungen.push({ id, name: a?.name || id, kvA, grenzeKW, rueckKW: r, ueberKW: r - grenzeKW });
    }
  }

  // Rückspeisung der Komponente: am NAP gemessen, sonst Summe der Trafos.
  // NICHT beides addieren — im Ring wäre das eine Doppelzählung.
  const napIds = komponente?.napIds || [];
  const rueckKW = napIds.length
    ? napIds.reduce((s, id) => s + rueck(id), 0)
    : (komponente?.trafoIds || []).reduce((s, id) => s + rueck(id), 0);

  const { kW: kapazitaetKW, quelle } = komponenteKapazitaetKW(komponente, assets, opts);
  const napVerletzung = (kapazitaetKW > 0 && rueckKW > kapazitaetKW)
    ? { grenzeKW: kapazitaetKW, rueckKW, ueberKW: rueckKW - kapazitaetKW }
    : null;

  return {
    rueckKW, kapazitaetKW, quelle,
    ausgeschoepftPct: kapazitaetKW > 0 ? (rueckKW / kapazitaetKW) * 100 : null,
    trafoVerletzungen,
    napVerletzung,
    stufe: napVerletzung ? 'nap' : (trafoVerletzungen.length ? 'trafo' : 'frei'),
  };
}

// ── Auflösung: drei Wege ─────────────────────────────────────────────────────

const _eur = n => Math.round(n);

/**
 * Kosten, den Bestand so zu ertüchtigen, dass die geplante Erzeugung passt.
 *
 * Reihenfolge nach Bindungswirkung: erst der NAP, wenn er die bindende Grenze
 * ist — eine Trafoertüchtigung darunter bringt nichts, solange der
 * Einspeisepunkt dichtmacht. Danach die verletzten Trafos.
 */
export function bestandErtuechtigen(befund, kosten = SCHWELLEN_KOSTEN) {
  const schritte = [];
  if (befund?.napVerletzung) {
    const kw = befund.napVerletzung.ueberKW;
    schritte.push({
      art: 'nap', titel: `NAP-Einspeiseleistung +${_eur(kw)} kW`,
      kostenEUR: _eur(kw * kosten.napEurProKW),
      hinweis: 'Zusage des vorgelagerten Netzbetreibers nötig — nicht allein planbar.',
    });
  }
  for (const t of (befund?.trafoVerletzungen || [])) {
    const noetigKVA = t.rueckKW / TRAFO_RUECK_FAKTOR;
    const zusatzKVA = Math.max(0, noetigKVA - t.kvA);
    schritte.push({
      art: 'trafo', id: t.id,
      titel: `${t.name}: ${_eur(t.kvA)} → ${_eur(noetigKVA)} kVA`,
      kostenEUR: _eur(zusatzKVA * kosten.trafoEurProKVA),
    });
  }
  return { schritte, kostenEUR: schritte.reduce((s, x) => s + x.kostenEUR, 0) };
}

/**
 * Die drei Wege im Vergleich.
 *
 * bestand      — alles im vorhandenen Netz ertüchtigen
 * erzeugungsnetz — eigener Abgang am NAP für die Erzeugung; das Bestandsnetz
 *                bleibt unangetastet, dafür ein Sprungkostenblock
 * hybrid       — so viel Erzeugung im Bestand lassen, wie ohne Ertüchtigung
 *                passt; nur der Überschuss geht aufs Erzeugungsnetz
 *
 * Die günstigste wird markiert. „Günstigste" heißt hier ausschließlich
 * Investition — Betrieb, Redundanz und Genehmigungsaufwand stehen nicht drin.
 */
export function schwellenVarianten(befund, kosten = SCHWELLEN_KOSTEN) {
  const rueckKW = befund?.rueckKW || 0;
  const kapKW = befund?.kapazitaetKW || 0;

  const b = bestandErtuechtigen(befund, kosten);
  const varianten = [
    { id: 'bestand', label: 'Bestand ertüchtigen',
      kostenEUR: b.kostenEUR, schritte: b.schritte,
      moeglich: true },
    { id: 'erzeugungsnetz', label: 'Eigenes Erzeugungsnetz',
      kostenEUR: _eur(rueckKW * kosten.erzeugungsnetzEurProKW),
      schritte: [{ art: 'erzeugungsnetz', titel: `Eigener MS-Abgang für ${_eur(rueckKW)} kW`,
                   kostenEUR: _eur(rueckKW * kosten.erzeugungsnetzEurProKW) }],
      moeglich: rueckKW > 0 },
  ];

  // Hybrid lohnt nur, wenn im Bestand überhaupt Reserve steckt
  const freiKW = Math.max(0, kapKW - 0);
  const ueberschussKW = Math.max(0, rueckKW - freiKW);
  if (ueberschussKW > 0 && ueberschussKW < rueckKW) {
    varianten.push({
      id: 'hybrid', label: 'Bestand ausnutzen + Rest auf Erzeugungsnetz',
      kostenEUR: _eur(ueberschussKW * kosten.erzeugungsnetzEurProKW),
      schritte: [
        { art: 'hinweis', titel: `${_eur(freiKW)} kW bleiben im Bestandsnetz`, kostenEUR: 0 },
        { art: 'erzeugungsnetz', titel: `Erzeugungsnetz für ${_eur(ueberschussKW)} kW`,
          kostenEUR: _eur(ueberschussKW * kosten.erzeugungsnetzEurProKW) },
      ],
      moeglich: true,
    });
  }

  const moegliche = varianten.filter(v => v.moeglich);
  const guenstigste = moegliche.reduce((min, v) => (min == null || v.kostenEUR < min.kostenEUR ? v : min), null);
  return varianten.map(v => ({ ...v, guenstigste: v === guenstigste }));
}

/**
 * Verdichtet einen Analyselauf zu einer Aussage über die ganze Variante.
 *
 * WICHTIG für die Lesart: Ein Fazit „frei" heißt NUR, dass Trafos und
 * Einspeisepunkt tragen. Strombelastbarkeit und Spannungsfall der einzelnen
 * Kabel sind hier NICHT geprüft — die findet erst der zeitliche Engpass-Sweep.
 * Eine im Screening unauffällige Variante kann also trotzdem Kabelengpässe
 * haben; deshalb lohnt die Vertiefung auch dann.
 *
 * Rückgabe: { stufe, kritisch, gesamt, guenstigsteSummeEUR, text }
 */
export function schwellenFazit(analyse) {
  const eintraege = analyse || [];
  const kritisch = eintraege.filter(e => e.befund.stufe !== 'frei');
  const hatNap = kritisch.some(e => e.befund.stufe === 'nap');

  const guenstigsteSummeEUR = kritisch.reduce((s, e) => {
    const g = (e.varianten || []).find(v => v.guenstigste);
    return s + (g?.kostenEUR || 0);
  }, 0);

  const stufe = hatNap ? 'nap' : (kritisch.length ? 'trafo' : 'frei');
  const text = stufe === 'frei'
    ? 'Einspeisepunkt und Trafos tragen'
    : stufe === 'trafo'
      ? `${kritisch.length} Cluster über der Trafo-Grenze`
      : `${kritisch.length} Cluster über dem NAP-Limit`;

  return { stufe, kritisch: kritisch.length, gesamt: eintraege.length, guenstigsteSummeEUR, text };
}

/**
 * Gesamtlauf über alle Komponenten.
 *
 * eingabe: { assets, edges, rueckJeKnoten, napLimitKw, kosten }
 * Rückgabe: [{ komponente, befund, varianten }] — kritische zuerst.
 */
export function schwellenAnalyse({ assets, edges, rueckJeKnoten, napLimitKw, kosten } = {}) {
  const komponenten = netzKomponenten(assets, edges);
  const k = kosten || SCHWELLEN_KOSTEN;

  return komponenten
    .filter(komp => komp.trafoIds.length || komp.napIds.length)   // reine Blattinseln sind hier ohne Aussage
    .map(komponente => {
      const befund = pruefeSchwellen(komponente, assets, rueckJeKnoten, { napLimitKw });
      return {
        komponente, befund,
        varianten: befund.stufe === 'frei' ? [] : schwellenVarianten(befund, k),
      };
    })
    .sort((a, b) => (b.befund.ausgeschoepftPct ?? 0) - (a.befund.ausgeschoepftPct ?? 0));
}
