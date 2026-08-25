// ── lib/phasen-core.js — Pure Logik für Phasen-Zeiträume ─────────────────────
// Importfrei und DOM-frei → direkt in Unit-Tests nutzbar.
// Phase = { id, name, jahrVon, jahrBis, variantId, reihenfolge }

/**
 * Repariert Phasen-Zeiträume, damit sie validatePlanningState passieren.
 *
 * Hintergrund (echter Fehlerfall): `validatePlanningState` wirft bei
 * `Number(jahrVon) > Number(jahrBis)`. Ein leeres Endjahr ergibt dabei
 * `Number('') === 0`, die Phase gilt also als „Start nach Ende". Da die
 * Validierung bei JEDER Planungstransaktion läuft, blockiert eine einzige
 * solche Phase danach auch völlig unbeteiligte Aktionen — etwa das Löschen
 * eines Assets — und die Meldung verrät nicht, wo man es geradezieht.
 * Aus einer Projektdatei geladen macht das ein Projekt praktisch unbenutzbar.
 * Deshalb wird beim Laden repariert statt abgelehnt.
 *
 * Regeln: nicht lesbares/fehlendes Startjahr → Bezugsjahr; Endjahr fehlend
 * oder vor dem Startjahr → gleich dem Startjahr (einjährige Phase). Die Jahre
 * bleiben Strings, wie sie überall sonst angelegt werden.
 *
 * Gibt ein neues Array zurück; die Eingabe bleibt unverändert.
 */
export function repairPhasen(phasenArr, bezugsjahr) {
  const jahr0 = bezugsjahr ?? new Date().getFullYear();
  return (phasenArr || []).map(p => {
    const von = parseInt(p?.jahrVon);
    const bis = parseInt(p?.jahrBis);
    const vonOk = Number.isFinite(von) ? von : jahr0;
    const bisOk = Number.isFinite(bis) && bis >= vonOk ? bis : vonOk;
    return { ...p, jahrVon: String(vonOk), jahrBis: String(bisOk) };
  });
}

/**
 * Ein einzelnes Jahresfeld einer Phase setzen, ohne einen ungültigen Zeitraum
 * entstehen zu lassen: der jeweils andere Wert wird mitgezogen.
 * Gibt die geänderten Felder zurück oder null, wenn die Eingabe unbrauchbar war.
 */
export function phaseJahrSetzen(phase, feld, wert) {
  const jahr = parseInt(wert);
  if (!Number.isFinite(jahr)) return null;
  const next = { jahrVon: phase?.jahrVon, jahrBis: phase?.jahrBis, [feld]: String(jahr) };
  if (feld === 'jahrVon' && parseInt(next.jahrBis) < jahr) next.jahrBis = String(jahr);
  if (feld === 'jahrBis' && parseInt(next.jahrVon) > jahr) next.jahrVon = String(jahr);
  return next;
}
