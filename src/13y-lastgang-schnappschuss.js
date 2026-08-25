// ── 13y-lastgang-schnappschuss.js — Knotenlastgänge einfrieren ───────────────
//
// App-seitige Schicht zu lib/lastgang-schnappschuss.js: liest die Profile aus
// 13r (getNodeProfile8760) und friert sie ein.
//
// Der Grund für das Einfrieren: getNodeProfile8760 rechnet aus dem globalen
// Zustand — es liefert also immer nur die Profile der GERADE aktiven Variante.
// Für einen Vergleich müssen mehrere Stände gleichzeitig vorliegen.
//
// Für nicht-aktive Varianten gibt es keinen Weg daran vorbei, sie kurz zu
// aktivieren: Die Profile hängen an Topologie und Anlagen, und beides lebt im
// globalen Zustand. Deshalb wird durchgeschaltet und am Ende der Ausgangs-
// zustand wiederhergestellt — bewusst sichtbar gemacht, statt es zu verstecken.

import {
  erstelleSchnappschuss, vergleicheSchnappschuesse, schnappschussUeberlast,
} from './lib/lastgang-schnappschuss.js';
import { getNodeProfile8760, getNodeCapacityKW, isInfraNode, invalidateKnotenProfileCache } from './13r-knotenpunkt-analyse.js';
import { ASSETS, getAssetStatus } from './13a-assets-core.js';
import { varianten, activeVariantId, activateVariant, globalYear } from './01-globals-varianten.js';

export { vergleicheSchnappschuesse, schnappschussUeberlast };

// Eingefrorene Stände, je Variante einer (Schlüssel: variantId, null = Basisdaten)
const _schnappschuesse = new Map();

export function lastgangSchnappschuesse() { return _schnappschuesse; }
export function lastgangSchnappschussFuer(variantId) { return _schnappschuesse.get(variantId ?? null) || null; }
export function lastgangSchnappschuesseLeeren() { _schnappschuesse.clear(); }

/** Name der Variante für die Beschriftung. */
function _variantenName(id) {
  if (id == null) return 'Basisdaten';
  return varianten.find(v => v.id === id)?.name || 'Variante';
}

/**
 * Friert die Knotenprofile des AKTUELLEN Zustands ein.
 *
 * Erfasst werden die Infrastrukturknoten (NAP/Trafo/NSHV/UV/KVS) — dort greifen
 * die Kapazitätsgrenzen, und ihr Profil fasst über die Topologie bereits alles
 * zusammen, was daran hängt.
 *
 * opts.jahr — Bezugsjahr (Standard: globalYear). Nur aktive Assets zählen.
 */
export function lastgangSchnappschussErstellen(opts = {}) {
  const jahr = opts.jahr ?? globalYear ?? new Date().getFullYear();
  // Der Profil-Cache in 13r ist nicht jahresabhängig — vor einem Lauf für ein
  // anderes Jahr muss er weg, sonst kämen Profile des vorigen Standes zurück.
  invalidateKnotenProfileCache();

  const knoten = (ASSETS.items || [])
    .filter(a => isInfraNode(a) && getAssetStatus(a, jahr) === 'active')
    .map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      kapazitaetKW: getNodeCapacityKW(a),
      profil: getNodeProfile8760(a),
    }));

  const s = erstelleSchnappschuss({
    jahr,
    varianteId: activeVariantId ?? null,
    varianteName: _variantenName(activeVariantId),
    knoten,
  }, { mitProfilen: !!opts.mitProfilen });

  _schnappschuesse.set(s.varianteId, s);
  return s;
}

/**
 * Friert alle Varianten ein — schaltet dafür nacheinander durch und stellt den
 * Ausgangszustand am Ende wieder her.
 *
 * Teuer (jeder Wechsel baut das Stromnetz neu auf), deshalb nichts, was
 * nebenbei laufen sollte. Der Aufrufer zeigt das an.
 *
 * Gibt die erzeugten Schnappschüsse in Reihenfolge zurück.
 */
export function lastgangSchnappschuesseAlleVarianten(opts = {}) {
  const zurueck = activeVariantId ?? null;
  const ziele = [null, ...varianten.map(v => v.id)];
  const out = [];

  try {
    for (const id of ziele) {
      if ((activeVariantId ?? null) !== id) activateVariant(id);
      out.push(lastgangSchnappschussErstellen(opts));
    }
  } finally {
    // Ausgangszustand in jedem Fall wiederherstellen — auch wenn ein Lauf wirft.
    if ((activeVariantId ?? null) !== zurueck) activateVariant(zurueck);
  }
  return out;
}
