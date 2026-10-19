// @ts-check
// Diagramme erst zeichnen, wenn man sie sieht.
//
// Viele Canvas-Diagramme hängen an Berechnungen, die bei jeder Änderung laufen (Dispatch, Strombilanz,
// Wirtschaftlichkeit) — auch wenn ihr Reiter oder Fenster gerade zu ist. Bisher zeichneten sie dann einen
// Frame später trotzdem, mit geschätzter Breite und einer erzwungenen Layout-Berechnung der ganzen Seite.
// zeichneWennSichtbar() merkt sich stattdessen den jüngsten Zeichenauftrag je Element und führt ihn aus,
// sobald das Element eine Größe bekommt (ResizeObserver: Reiter/Fenster geht auf).
//
// Exporte, die Canvas-Inhalte direkt auslesen (z. B. 05a Transformationsplan), rufen vorher
// ausstehendeZeichnen() auf.

/** @type {Map<Element, () => void>} */
const _auftraege = new Map();
/** @type {ResizeObserver|null} */
let _beobachter = null;

/** Wird das Element dargestellt (kein display:none in der Kette) und hat es eine brauchbare Breite? */
export function istSichtbar(/** @type {Element|null|undefined} */ el) {
  if (!el?.isConnected) return false;
  // checkVisibility braucht nur den Stil, keine Layout-Berechnung
  if (typeof el.checkVisibility === 'function' ? !el.checkVisibility() : !el.getClientRects().length) return false;
  return el.clientWidth > 10 || (el.parentElement?.clientWidth || 0) > 10;
}

function _erledigt(/** @type {Element} */ el) {
  if (_auftraege.delete(el)) _beobachter?.unobserve(el);
}

function _ausfuehren(/** @type {() => void} */ zeichne) {
  try { zeichne(); } catch (err) { console.error('Diagramm-Fehler:', err); }
}

/**
 * Sichtbar → sofort zeichnen. Ausgeblendet → Auftrag merken (ein späterer ersetzt ihn) und beim Einblenden zeichnen.
 * @param {Element|null|undefined} el  Canvas oder Container, dessen Sichtbarkeit zählt
 * @param {() => void} zeichne
 */
export function zeichneWennSichtbar(el, zeichne) {
  if (!el) return;
  if (typeof ResizeObserver !== 'function' || istSichtbar(el)) {
    _erledigt(el);
    zeichne();
    return;
  }
  if (!_beobachter) {
    _beobachter = new ResizeObserver(eintraege => {
      for (const e of eintraege) {
        const zeichneJetzt = _auftraege.get(e.target);
        if (!zeichneJetzt || !istSichtbar(e.target)) continue;
        _erledigt(e.target);
        _ausfuehren(zeichneJetzt);
      }
    });
  }
  if (!_auftraege.has(el)) _beobachter.observe(el);
  _auftraege.set(el, zeichne);
}

/** Alle gemerkten Aufträge sofort ausführen, auch ausgeblendete (vor Exporten, die Canvas-Bilder lesen). */
export function ausstehendeZeichnen() {
  for (const [el, zeichne] of [..._auftraege]) {
    _erledigt(el);
    _ausfuehren(zeichne);
  }
}

/** Anzahl wartender Aufträge (Tests, Diagnose). */
export function ausstehendeAnzahl() { return _auftraege.size; }
