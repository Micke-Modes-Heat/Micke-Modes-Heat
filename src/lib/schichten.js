// ── lib/schichten.js — Planungsschichten (Bestand / Entwicklung / Entscheidung) ──
//
// Trennt die drei fachlich verschiedenen Gründe, aus denen ein Objekt im Modell
// existiert. Bisher waren sie über `baujahr` vermischt und mussten für die
// Ursachenanalyse aus Jahreszahlen zurückgerechnet werden:
//
//   bestand       — ist heute da, unabhängig von jeder Planung
//   entwicklung   — kommt ohnehin (Neubau, Abriss, Nutzungsänderung, E-Flotte);
//                   gilt für alle Varianten gleich, ist also die faire
//                   Vergleichsbasis zwischen ihnen
//   entscheidung  — habe ich in DIESER Variante so geplant
//
// `schicht` ERSETZT nichts: baujahr/abrissjahr/massnahmen und damit auch
// getAssetStatus/getAssetPropsForYear bleiben unverändert. Die Schicht sagt nur,
// WARUM ein Objekt da ist — nicht, ab wann.
//
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar. Der Modus- und
// Sichtbarkeitszustand am Dateiende ist bewusst über Funktionen zugänglich
// (nicht als `export let`), damit Importeure keine veralteten Bindings lesen.

export const SCHICHT = {
  BESTAND:      'bestand',
  ENTWICKLUNG:  'entwicklung',
  ENTSCHEIDUNG: 'entscheidung',
};

export const SCHICHT_META = {
  [SCHICHT.BESTAND]: {
    label: 'Bestand', icon: '🏛', farbe: '#4fc3f7',
    hinweis: 'Was heute da ist. Kein Planungsjahr, keine Variante.',
  },
  [SCHICHT.ENTWICKLUNG]: {
    label: 'Entwicklung', icon: '📈', farbe: '#f9a825',
    hinweis: 'Was ohnehin kommt — Neubau, Abriss, Nutzungsänderung. Gilt in allen Varianten gleich.',
  },
  [SCHICHT.ENTSCHEIDUNG]: {
    label: 'Planung', icon: '🎯', farbe: '#66bb6a',
    hinweis: 'Was in dieser Variante geplant ist.',
  },
};

// Rangfolge für die Kantenvererbung: höher = später/planerischer
const _RANG = {
  [SCHICHT.BESTAND]:      0,
  [SCHICHT.ENTWICKLUNG]:  1,
  [SCHICHT.ENTSCHEIDUNG]: 2,
};

export const SCHICHT_REIHENFOLGE = [SCHICHT.BESTAND, SCHICHT.ENTWICKLUNG, SCHICHT.ENTSCHEIDUNG];

export function istSchicht(s) {
  return Object.prototype.hasOwnProperty.call(_RANG, s);
}

/** Unbekannte/fehlende Werte gelten als Bestand — der neutrale Ausgangszustand. */
export function normSchicht(s) {
  return istSchicht(s) ? s : SCHICHT.BESTAND;
}

export function schichtRang(s) {
  return _RANG[normSchicht(s)];
}

/**
 * Schicht einer Leitung aus ihren Endpunkten: die "späteste" gewinnt.
 * Ein Kabel zu einem Neubau ist Entwicklung, auch wenn es an einem
 * Bestandsverteiler beginnt — es existiert ja nur wegen des Neubaus.
 * Bewusst abgeleitet statt gespeichert: so kann die Zuordnung nicht
 * auseinanderlaufen, wenn sich ein Endpunkt später ändert.
 */
export function schichtAusEndpunkten(schichtU, schichtV) {
  return schichtRang(schichtU) >= schichtRang(schichtV) ? normSchicht(schichtU) : normSchicht(schichtV);
}

/**
 * Rückfüllung für Projekte, die noch ohne Schicht gespeichert wurden.
 *
 * Bewusst konservativ: alles, was heute schon existiert, ist Bestand; alles mit
 * Baujahr in der Zukunft ist Entwicklung. Als Entscheidung wird NICHTS
 * automatisch eingestuft — die Zuordnung zu einer Variante lässt sich aus den
 * Altdaten nicht erschließen, und falsch zugeordnete Entscheidungen wären
 * schwerer zu bemerken als eine zu neutrale Einstufung.
 */
export function schichtBackfill(obj, heute) {
  if (istSchicht(obj?.schicht)) return obj.schicht;
  const bj = parseInt(obj?.baujahr);
  const h  = heute ?? new Date().getFullYear();
  return (Number.isFinite(bj) && bj > h) ? SCHICHT.ENTWICKLUNG : SCHICHT.BESTAND;
}

// ── Aktiver Eingabemodus ─────────────────────────────────────────────────────
// Der Modus ist reine Eingabedisziplin: er bestimmt, welche Schicht neu
// angelegte Objekte bekommen. Er wird NICHT gespeichert — beim Öffnen eines
// Projekts startet man immer im Bestandsmodus.

let _aktiv = SCHICHT.BESTAND;

export function getAktiveSchicht() { return _aktiv; }

export function setAktiveSchicht(s) {
  _aktiv = normSchicht(s);
  return _aktiv;
}

// ── Sichtbarkeit ─────────────────────────────────────────────────────────────
// Welche Schichten auf der Karte gezeigt werden. Default: alle.

const _sichtbar = new Set(SCHICHT_REIHENFOLGE);

export function schichtSichtbar(s) { return _sichtbar.has(normSchicht(s)); }

export function setSchichtSichtbar(s, an) {
  const k = normSchicht(s);
  if (an) _sichtbar.add(k); else _sichtbar.delete(k);
  return schichtSichtbar(k);
}

export function getSichtbareSchichten() { return new Set(_sichtbar); }
